"""API of stream rules: how a channel finds its streams."""

import re

from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdmin

from .channel_rules import RuleMatcher, RuleView, apply_rules, compile_pattern, plan
from .models import Channel, ChannelStream, ChannelStreamRule

RULE_FIELDS = [
    "enabled",
    "match_name",
    "names",
    "include_regex",
    "exclude_regex",
    "catchup",
    "account_ids",
    "countries",
    "excluded_stream_ids",
]


class ChannelStreamRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChannelStreamRule
        fields = RULE_FIELDS + ["last_applied_at"]
        read_only_fields = ["last_applied_at"]

    def _validate_list(self, value, check, message):
        if not isinstance(value, list) or not all(check(item) for item in value):
            raise serializers.ValidationError(message)
        return value

    def validate_names(self, value):
        value = self._validate_list(value, lambda n: isinstance(n, str), "Names must be a list of texts.")
        return list(dict.fromkeys(name.strip() for name in value if name.strip()))

    def validate_account_ids(self, value):
        value = self._validate_list(value, lambda i: str(i).isdigit(), "Accounts must be a list of ids.")
        return [int(i) for i in value]

    def validate_excluded_stream_ids(self, value):
        value = self._validate_list(value, lambda i: str(i).isdigit(), "Streams must be a list of ids.")
        return [int(i) for i in value]

    def validate_countries(self, value):
        value = self._validate_list(
            value,
            lambda c: isinstance(c, str) and re.fullmatch(r"[A-Za-z]{2,3}", c),
            "Countries must be codes such as DE or UK.",
        )
        return [c.upper() for c in value]

    def _validate_pattern(self, value):
        try:
            compile_pattern(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc
        return value

    validate_include_regex = _validate_pattern
    validate_exclude_regex = _validate_pattern


def rule_channel(channel_id):
    channel = get_object_or_404(Channel, id=channel_id)
    if channel.auto_created:
        raise serializers.ValidationError(
            "Auto sync manages the streams of this channel; it cannot have a stream rule."
        )
    return channel


class PlannedStreamSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    account = serializers.CharField(allow_null=True)
    group = serializers.CharField(allow_null=True)
    catchup = serializers.BooleanField()
    origin = serializers.ChoiceField(choices=ChannelStream.Origin.choices)
    status = serializers.ChoiceField(choices=["manual", "kept", "added", "removed"])


class RulePreviewSerializer(serializers.Serializer):
    streams = PlannedStreamSerializer(many=True)
    removed = PlannedStreamSerializer(many=True)


class ChannelStreamRuleView(APIView):
    permission_classes = [IsAdmin]

    @extend_schema(responses=ChannelStreamRuleSerializer, description="The stream rule of a channel.")
    def get(self, request, channel_id):
        rule = get_object_or_404(ChannelStreamRule, channel_id=channel_id)
        return Response(ChannelStreamRuleSerializer(rule).data)

    @extend_schema(
        request=ChannelStreamRuleSerializer,
        responses=ChannelStreamRuleSerializer,
        description="Create or change the stream rule of a channel and apply it.",
    )
    def put(self, request, channel_id):
        channel = rule_channel(channel_id)
        rule = ChannelStreamRule.objects.filter(channel=channel).first()
        serializer = ChannelStreamRuleSerializer(rule, data=request.data, partial=rule is not None)
        serializer.is_valid(raise_exception=True)
        rule = serializer.save(channel=channel)
        if rule.enabled:
            apply_rules([rule])
            rule.refresh_from_db()
        return Response(ChannelStreamRuleSerializer(rule).data)

    @extend_schema(
        description=(
            "Remove the stream rule. Its streams stay on the channel as manual streams."
        ),
        responses={204: None},
    )
    def delete(self, request, channel_id):
        with transaction.atomic():
            ChannelStreamRule.objects.filter(channel_id=channel_id).delete()
            ChannelStream.objects.filter(channel_id=channel_id).update(
                origin=ChannelStream.Origin.MANUAL
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChannelStreamRulePreviewView(APIView):
    permission_classes = [IsAdmin]

    @extend_schema(
        request=ChannelStreamRuleSerializer,
        responses=RulePreviewSerializer,
        description="Show the streams a rule with these values would give the channel. Nothing is saved.",
    )
    def post(self, request, channel_id):
        channel = rule_channel(channel_id)
        serializer = ChannelStreamRuleSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        saved = ChannelStreamRule.objects.filter(channel=channel).first()
        values = {
            field: serializer.validated_data.get(
                field,
                getattr(saved, field) if saved else ChannelStreamRule._meta.get_field(field).get_default(),
            )
            for field in RULE_FIELDS
            if field != "enabled"
        }
        view = RuleView(
            channel_name=channel.name,
            **{key: tuple(value) if isinstance(value, list) else value for key, value in values.items()},
        )
        streams, removed = plan(channel, view, RuleMatcher())
        return Response(RulePreviewSerializer({"streams": streams, "removed": removed}).data)


class BulkStreamRuleSerializer(serializers.Serializer):
    channel_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), allow_empty=False, max_length=5000
    )
    rule = ChannelStreamRuleSerializer()


class BulkStreamRuleView(APIView):
    permission_classes = [IsAdmin]

    @extend_schema(
        request=BulkStreamRuleSerializer,
        responses=serializers.DictField(child=serializers.IntegerField()),
        description=(
            "Give many channels the same rule settings and apply them. Names and "
            "excluded streams of existing rules are kept. Auto sync channels are skipped."
        ),
    )
    def post(self, request):
        serializer = BulkStreamRuleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = {
            key: value
            for key, value in serializer.validated_data["rule"].items()
            if key not in ("names", "excluded_stream_ids")
        }
        channels = Channel.objects.filter(
            id__in=serializer.validated_data["channel_ids"], auto_created=False
        )
        rules = []
        with transaction.atomic():
            for channel in channels:
                rule, _created = ChannelStreamRule.objects.update_or_create(
                    channel=channel, defaults=values
                )
                rules.append(rule)
        summary = apply_rules([rule for rule in rules if rule.enabled])
        summary["rules"] = len(rules)
        return Response(summary)


class StreamOriginSerializer(serializers.Serializer):
    origin = serializers.ChoiceField(choices=[ChannelStream.Origin.MANUAL])


class ChannelStreamOriginView(APIView):
    permission_classes = [IsAdmin]

    @extend_schema(
        request=StreamOriginSerializer,
        responses={204: None},
        description="Keep a rule stream on the channel even when the rule stops finding it.",
    )
    def patch(self, request, channel_id, stream_id):
        serializer = StreamOriginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        updated = ChannelStream.objects.filter(channel_id=channel_id, stream_id=stream_id).update(
            origin=serializer.validated_data["origin"]
        )
        if not updated:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
