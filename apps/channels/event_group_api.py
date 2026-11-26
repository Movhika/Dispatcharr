"""API of event groups: one channel per event from several providers."""

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin

from .event_groups import build, preview
from .event_groups import team_aliases as saved_team_aliases
from .models import ChannelGroupM3UAccount, EventChannelGroup
from .serializers import (
    EventChannelGroupSerializer,
    EventGroupBuildResultSerializer,
    EventGroupPreviewSerializer,
)
from .stream_matching import normalize_alias_groups

PREVIEW_LIMIT = 300


class TeamAliasSerializer(serializers.Serializer):
    aliases = serializers.JSONField(
        help_text="Lists of team names that mean the same team, first name first."
    )

    def validate_aliases(self, value):
        try:
            return normalize_alias_groups(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc


class FixtureSettingsSerializer(serializers.Serializer):
    openligadb_leagues = serializers.ListField(
        child=serializers.RegexField(r"^[A-Za-z0-9_-]{1,40}$"), required=False,
        help_text="OpenLigaDB league shortcuts, e.g. bl1, bl2, dfb, ucl.",
    )
    thesportsdb_leagues = serializers.ListField(
        child=serializers.RegexField(r"^\d{1,8}$"), required=False,
        help_text="TheSportsDB league ids.",
    )
    thesportsdb_key = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, write_only=True,
        help_text="Personal TheSportsDB API key; omit or null to keep, empty to remove.",
    )
    thesportsdb_key_set = serializers.BooleanField(read_only=True)


class EventChannelGroupViewSet(viewsets.ModelViewSet):
    queryset = EventChannelGroup.objects.prefetch_related("sources")
    serializer_class = EventChannelGroupSerializer
    permission_classes = [IsAdmin]

    def perform_destroy(self, instance):
        from apps.m3u.tasks import _delete_channels_stopping_streams

        with transaction.atomic():
            _delete_channels_stopping_streams(
                [event_channel.channel for event_channel in instance.event_channels.select_related("channel")]
            )
            instance.delete()

    @extend_schema(
        description=(
            "Group the current events of event categories without saving. Takes "
            "the fields of an event group; nothing is written."
        ),
        request=EventChannelGroupSerializer,
        responses=EventGroupPreviewSerializer(many=True),
    )
    @action(detail=False, methods=["post"])
    def preview(self, request):
        serializer = self.get_serializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        sources = data.pop("sources", [])
        data.pop("name", None)
        group = EventChannelGroup(name="preview", **data)
        clusters = preview(group, sources=sources)
        return Response(EventGroupPreviewSerializer(clusters[:PREVIEW_LIMIT], many=True).data)

    @extend_schema(
        description="Create, update and remove the channels of this event group now.",
        request=None,
        responses=EventGroupBuildResultSerializer,
    )
    @action(detail=True, methods=["post"], url_path="build")
    def build_channels(self, request, pk=None):
        group = self.get_object()
        if group.channel_group_id is None:
            return Response(
                {"error": "Choose a channel group for the event channels first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not group.enabled:
            return Response(
                {"error": "Enable the event group before building its channels."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(EventGroupBuildResultSerializer(build(group)).data)

    @extend_schema(
        methods=["GET"],
        description="Team aliases used to group events of all event groups.",
        responses=TeamAliasSerializer,
    )
    @extend_schema(methods=["PUT"], request=TeamAliasSerializer, responses=TeamAliasSerializer)
    @action(detail=False, methods=["get", "put"], url_path="team-aliases")
    def team_aliases(self, request):
        from core.models import CoreSettings

        if request.method == "PUT":
            serializer = TeamAliasSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            CoreSettings.set_event_team_aliases(serializer.validated_data["aliases"])
        return Response({"aliases": saved_team_aliases()})

    @extend_schema(
        methods=["GET"],
        description="Public fixture sources that correct event names and kick-off times.",
        responses=FixtureSettingsSerializer,
    )
    @extend_schema(methods=["PUT"], request=FixtureSettingsSerializer, responses=FixtureSettingsSerializer)
    @action(detail=False, methods=["get", "put"], url_path="fixture-settings")
    def fixture_settings(self, request):
        from django.core.cache import cache

        from core.models import CoreSettings

        from .fixtures import fixture_settings

        settings = fixture_settings()
        if request.method == "PUT":
            serializer = FixtureSettingsSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            for key in ("openligadb_leagues", "thesportsdb_leagues"):
                if key in data:
                    settings[key] = list(dict.fromkeys(data[key]))
            if data.get("thesportsdb_key") is not None:
                settings["thesportsdb_key"] = data["thesportsdb_key"].strip()
            CoreSettings.set_event_fixture_settings(settings)
            # Changed sources take effect now instead of after the cache time.
            if hasattr(cache, "delete_pattern"):
                cache.delete_pattern("event-fixtures:*")
        return Response({
            "openligadb_leagues": settings["openligadb_leagues"],
            "thesportsdb_leagues": settings["thesportsdb_leagues"],
            "thesportsdb_key_set": bool(settings["thesportsdb_key"]),
        })

    @extend_schema(
        description="Live TV categories that can feed event groups, marked event categories first.",
        responses=serializers.ListSerializer(child=serializers.DictField()),
    )
    @action(detail=False, methods=["get"], url_path="source-options")
    def source_options(self, request):
        relations = (
            ChannelGroupM3UAccount.objects.filter(enabled=True, ignored=False)
            .select_related("channel_group", "m3u_account")
            .order_by("m3u_account__name", "channel_group__name")
        )
        options = [
            {
                "id": relation.id,
                "label": f"{relation.m3u_account.name} · {relation.channel_group.name}",
                "account": relation.m3u_account.name,
                "is_event": bool((relation.metadata_defaults or {}).get("is_event")),
            }
            for relation in relations
        ]
        options.sort(key=lambda option: not option["is_event"])
        return Response(options)
