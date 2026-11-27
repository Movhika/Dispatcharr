"""Streams of manual accounts: entered in Dispatcharr instead of fetched.

A manual account works like any other account afterwards: its categories
choose their use, channel rules find its streams. Every change refreshes the
account so auto sync, event groups and stream rules follow at once.
"""

from urllib.parse import urlsplit

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import serializers, viewsets

from apps.accounts.permissions import IsAdmin
from apps.channels.models import ChannelGroup, ChannelGroupM3UAccount, Stream

from .models import M3UAccount

URL_SCHEMES = {"http", "https", "rtmp", "rtmps", "rtsp", "rtp", "udp", "srt"}


class ManualStreamSerializer(serializers.ModelSerializer):
    url = serializers.CharField(max_length=8192)
    category = serializers.CharField(
        max_length=255,
        write_only=True,
        help_text="Category of the stream; created when new. Returned as its name.",
    )

    class Meta:
        model = Stream
        fields = ["id", "name", "url", "category", "logo_url", "tvg_id", "stream_chno"]
        extra_kwargs = {
            "logo_url": {"required": False, "allow_blank": True, "allow_null": True},
            "tvg_id": {"required": False, "allow_blank": True, "allow_null": True},
            "stream_chno": {"required": False, "allow_null": True},
        }

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value

    def validate_url(self, value):
        value = value.strip()
        parts = urlsplit(value)
        if parts.scheme.lower() not in URL_SCHEMES or not (parts.netloc or parts.path):
            raise serializers.ValidationError(
                "Enter a stream URL such as http://, https://, rtmp://, rtsp://, udp:// or srt://."
            )
        return value

    def validate_category(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a category.")
        return value

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["category"] = instance.channel_group.name if instance.channel_group_id else ""
        return data

    def _category(self, name):
        account = self.context["account"]
        group, _created = ChannelGroup.objects.get_or_create(name=name)
        ChannelGroupM3UAccount.objects.get_or_create(
            channel_group=group,
            m3u_account=account,
            defaults={"enabled": True},
        )
        return group

    def create(self, validated_data):
        category = validated_data.pop("category")
        return Stream.objects.create(
            m3u_account=self.context["account"],
            channel_group=self._category(category),
            is_custom=True,
            last_seen=timezone.now(),
            **validated_data,
        )

    def update(self, instance, validated_data):
        category = validated_data.pop("category", None)
        if category is not None:
            instance.channel_group = self._category(category)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        instance.save()
        return instance


@extend_schema_view(
    list=extend_schema(description="Streams of a manual account."),
    create=extend_schema(description="Add a stream to a manual account."),
)
class ManualStreamViewSet(viewsets.ModelViewSet):
    serializer_class = ManualStreamSerializer
    permission_classes = [IsAdmin]
    pagination_class = None
    http_method_names = ["get", "post", "put", "patch", "delete"]

    def get_account(self):
        if not hasattr(self, "_account"):
            self._account = get_object_or_404(
                M3UAccount, id=self.kwargs["account_id"], account_type=M3UAccount.Types.MANUAL
            )
        return self._account

    def get_queryset(self):
        return (
            Stream.objects.filter(m3u_account=self.get_account())
            .select_related("channel_group")
            .order_by("channel_group__name", "name", "id")
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if "account_id" in self.kwargs:
            context["account"] = self.get_account()
        return context

    def _refresh(self):
        from .tasks import refresh_single_m3u_account

        account_id = self.get_account().id
        transaction.on_commit(lambda: refresh_single_m3u_account.delay(account_id))

    def perform_create(self, serializer):
        serializer.save()
        self._refresh()

    def perform_update(self, serializer):
        serializer.save()
        self._refresh()

    def perform_destroy(self, instance):
        instance.delete()
        self._refresh()
