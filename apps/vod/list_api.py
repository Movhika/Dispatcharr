"""Admin API for the VOD lists that profiles offer as client categories."""

from operator import itemgetter

from django.db import transaction
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin

from . import lists
from .list_serializers import (
    VODListAddItemsSerializer,
    VODListItemIdsSerializer,
    VODListItemsQuerySerializer,
    VODListItemsSerializer,
    VODListSerializer,
    VODListOptionSerializer,
    VODListTmdbKeywordQuerySerializer,
    VODListTmdbOptionsQuerySerializer,
    VODListTmdbOptionsSerializer,
)
from .models import VODList


class VODListViewSet(viewsets.ModelViewSet):
    serializer_class = VODListSerializer
    permission_classes = [IsAdmin]
    pagination_class = None

    def get_queryset(self):
        return VODList.objects.all()

    def perform_destroy(self, instance):
        from core.scheduling import delete_periodic_task

        profiles = list(instance.profiles.all())
        if instance.refresh_interval or instance.cron_expression:
            delete_periodic_task(f"vod-list-{instance.pk}-refresh")
        instance.delete()

        def refresh():
            from .profile_catalog import refresh_catalog

            for profile in profiles:
                refresh_catalog(profile)

        transaction.on_commit(refresh)

    @extend_schema(request=None, responses=VODListSerializer)
    @action(detail=True, methods=["post"])
    def rebuild(self, request, pk=None):
        vod_list = self.get_object()
        lists.request_list_build(vod_list)
        return Response(self.get_serializer(vod_list).data)

    @extend_schema(
        parameters=[VODListItemsQuerySerializer], responses=VODListItemsSerializer
    )
    @action(detail=True, methods=["get"])
    def items(self, request, pk=None):
        from .library import library_settings

        vod_list = self.get_object()
        query = VODListItemsQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        data = query.validated_data
        items = vod_list.items.all()
        if data.get("search"):
            term = data["search"]
            items = items.filter(
                Q(title__icontains=term)
                | Q(movie__name__icontains=term)
                | Q(series__name__icontains=term)
            )
        if data.get("content_type"):
            items = items.filter(content_type=data["content_type"])
        available = Q(movie__isnull=False) | Q(series__isnull=False)
        if data.get("available") == "true":
            items = items.filter(available)
        elif data.get("available") == "false":
            items = items.exclude(available)
        items = lists.ordered_items(vod_list, items).select_related(
            "movie__logo", "series__logo"
        )
        start = (data["page"] - 1) * data["page_size"]
        settings = library_settings()
        results = lists.item_documents(
            items[start : start + data["page_size"]], request, settings
        )
        return Response(
            VODListItemsSerializer({"count": items.count(), "results": results}).data
        )

    def _manual(self):
        vod_list = self.get_object()
        if vod_list.list_type != VODList.ListType.MANUAL:
            raise ValidationError({"detail": "Only manual lists are edited by hand."})
        return vod_list

    def _changed(self, vod_list):
        lists.build_list(vod_list)
        transaction.on_commit(lambda: lists.refresh_profiles(vod_list))
        return Response(self.get_serializer(self.get_queryset().get(pk=vod_list.pk)).data)

    @extend_schema(request=VODListAddItemsSerializer, responses=VODListSerializer)
    @action(detail=True, methods=["post"], url_path="add-items")
    def add_items(self, request, pk=None):
        from .library import model_for, selected_content

        vod_list = self._manual()
        serializer = VODListAddItemsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        refs = selected_content(data, sources=data["sources"])
        wanted = lists.content_types(vod_list)
        if data["sources"]:
            refs = [
                (content_type, content_id)
                for content_type in wanted
                for content_id in model_for(content_type, source=True)
                .objects.filter(
                    pk__in=[pk for kind, pk in refs if kind == content_type]
                )
                .order_by("pk")
                .values_list(f"{content_type}_id", flat=True)
            ]
        selection = [(kind, pk) for kind, pk in refs if kind in wanted]
        if not selection:
            raise ValidationError(
                {"detail": "Select movies or series this list can hold."}
            )
        with transaction.atomic():
            try:
                lists.add_items(vod_list, selection)
            except ValueError as error:
                raise ValidationError({"detail": str(error)}) from error
            return self._changed(vod_list)

    @extend_schema(request=VODListItemIdsSerializer, responses=VODListSerializer)
    @action(detail=True, methods=["post"], url_path="remove-items")
    def remove_items(self, request, pk=None):
        vod_list = self._manual()
        serializer = VODListItemIdsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            vod_list.items.filter(pk__in=serializer.validated_data["ids"]).delete()
            return self._changed(vod_list)

    @extend_schema(request=VODListItemIdsSerializer, responses=VODListSerializer)
    @action(detail=True, methods=["post"], url_path="reorder-items")
    def reorder_items(self, request, pk=None):
        vod_list = self._manual()
        serializer = VODListItemIdsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            lists.reorder_items(vod_list, serializer.validated_data["ids"])
            return self._changed(vod_list)

    @extend_schema(
        parameters=[VODListTmdbKeywordQuerySerializer],
        responses=VODListOptionSerializer(many=True),
    )
    @action(detail=False, methods=["get"], url_path="tmdb-keywords")
    def tmdb_keywords(self, request):
        """TMDB keywords whose names contain the search, for discover lists."""
        from .library import tmdb_client
        from .tmdb import TMDBError

        query = VODListTmdbKeywordQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        try:
            results = (
                tmdb_client()
                .get("search/keyword", query=query.validated_data["query"])
                .get("results")
                or []
            )
        except (TMDBError, ValueError) as error:
            raise ValidationError({"detail": str(error)}) from error
        return Response(
            VODListOptionSerializer(
                [
                    {"value": str(row["id"]), "label": row["name"]}
                    for row in results[:25]
                    if row.get("id") and row.get("name")
                ],
                many=True,
            ).data
        )

    @extend_schema(
        parameters=[VODListTmdbOptionsQuerySerializer],
        responses=VODListTmdbOptionsSerializer,
    )
    @action(detail=False, methods=["get"], url_path="tmdb-options")
    def tmdb_options(self, request):
        """Regions, streaming services, genres and languages TMDB knows."""
        from .library import library_settings, tmdb_client
        from .media_languages import MEDIA_LANGUAGE_OPTIONS
        from .tmdb import TMDBError

        query = VODListTmdbOptionsQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        data = query.validated_data
        media = "movie" if data["content_type"] == "movie" else "tv"
        language = library_settings()["languages"][0]
        try:
            client = tmdb_client()
            regions = client.get("watch/providers/regions").get("results") or []
            providers = (
                client.get(
                    f"watch/providers/{media}", watch_region=data["region"].upper()
                ).get("results")
                or []
                if data.get("region")
                else []
            )
            genres = client.get(f"genre/{media}/list", language=language).get(
                "genres"
            ) or []
        except (TMDBError, ValueError) as error:
            raise ValidationError({"detail": str(error)}) from error
        return Response(
            VODListTmdbOptionsSerializer(
                {
                    "regions": sorted(
                        (
                            {
                                "value": row["iso_3166_1"],
                                "label": row.get("english_name") or row["iso_3166_1"],
                            }
                            for row in regions
                            if row.get("iso_3166_1")
                        ),
                        key=itemgetter("label"),
                    ),
                    "providers": [
                        {"value": str(row["provider_id"]), "label": row["provider_name"]}
                        for row in sorted(
                            providers, key=lambda row: row.get("display_priority", 0)
                        )
                        if row.get("provider_id")
                    ],
                    "genres": [
                        {"value": str(row["id"]), "label": row["name"]}
                        for row in genres
                        if row.get("id")
                    ],
                    # TMDB filters by the two-letter original language.
                    "languages": [
                        {"value": row["legacyValue"], "label": row["label"]}
                        for row in MEDIA_LANGUAGE_OPTIONS
                        if row.get("legacyValue")
                    ],
                }
            ).data
        )
