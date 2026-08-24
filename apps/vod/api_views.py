from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.exceptions import ValidationError as DRFValidationError
from django_filters.rest_framework import DjangoFilterBackend
from django.db import connection
from django.db.models import Count, Prefetch, Q
from django.db.models.expressions import RawSQL
import django_filters
import logging
from types import SimpleNamespace
from apps.accounts.permissions import (
    Authenticated,
    permission_classes_by_action,
)
from .models import (
    Series, VODCategory, Movie, Episode, VODLogo,
    M3USeriesRelation, M3UMovieRelation, M3UEpisodeRelation, M3UVODCategoryRelation,
    VODSourceAsset, VODAccessPolicy, VODPlaybackSession,
    VODMovieProfileSelection, VODSeriesProfileSelection,
)
from .serializers import (
    MovieSerializer,
    EpisodeSerializer,
    SeriesSerializer,
    VODCategorySerializer,
    VODLogoSerializer,
    M3UMovieRelationSerializer,
    M3USeriesRelationSerializer,
    M3UEpisodeRelationSerializer,
    VODSourceAssetSerializer,
    VODAccessPolicySerializer,
    VODPlaybackSessionSerializer,
    M3UVODCategoryRelationSerializer,
)
from .image_proxy import (
    is_proxyable_image_url,
    prefer_relation_artwork,
    rewrite_backdrop_paths,
    rewrite_single_image_url,
    serve_vod_image,
    vod_image_action,
    vod_image_url_parts,
    vodlogo_cache_url,
)
from .tasks import refresh_series_episodes, refresh_movie_advanced_data
from .utils import get_series_display_name
from .metadata import normalize_language_code
from django.utils import timezone
from datetime import timedelta

logger = logging.getLogger(__name__)


def _effective_json_array_match(field, value, asset_alias="asset"):
    """PostgreSQL SQL for one effective-metadata array membership check."""
    # Keep the key/membership operators directly on the indexed JSONB columns.
    # COALESCE around the column would prevent PostgreSQL from using their GIN
    # indexes.  Only the boolean existence result needs a NULL fallback for a
    # relation which has no source asset yet.
    manual = f"{asset_alias}.manual_metadata"
    observed = f"{asset_alias}.observed_metadata"
    declared = f"{asset_alias}.declared_metadata"
    category = "category_relation.metadata_defaults"
    sql = f"""(
        ({manual} ? %s AND ({manual} -> %s) ? %s)
        OR (
            NOT COALESCE({manual} ? %s, false)
            AND {observed} ? %s
            AND ({observed} -> %s) ? %s
        )
        OR (
            NOT COALESCE({manual} ? %s, false)
            AND NOT COALESCE({observed} ? %s, false)
            AND {declared} ? %s
            AND ({declared} -> %s) ? %s
        )
        OR (
            NOT COALESCE({manual} ? %s, false)
            AND NOT COALESCE({observed} ? %s, false)
            AND NOT COALESCE({declared} ? %s, false)
            AND ({category} -> %s) ? %s
        )
    )"""
    params = [
        field, field, value,
        field, field, field, value,
        field, field, field, field, value,
        field, field, field, field, value,
    ]
    return sql, params


def _effective_json_scalar_match(
    field, value, relation_fallback="NULL", asset_alias="asset"
):
    """PostgreSQL SQL for a case-insensitive effective scalar match."""
    manual = f"{asset_alias}.manual_metadata"
    observed = f"{asset_alias}.observed_metadata"
    declared = f"{asset_alias}.declared_metadata"
    category = "category_relation.metadata_defaults"
    expression = f"""CASE
        WHEN COALESCE({manual} ? %s, false) THEN {manual} ->> %s
        WHEN COALESCE({observed} ? %s, false) THEN {observed} ->> %s
        WHEN COALESCE({declared} ? %s, false) THEN {declared} ->> %s
        WHEN COALESCE({category} ? %s, false) THEN {category} ->> %s
        ELSE {relation_fallback}
    END"""
    return f"LOWER(COALESCE(({expression}), '')) = LOWER(%s)", [
        field, field,
        field, field,
        field, field,
        field, field,
        value,
    ]


def _vod_relation_sql(filters, relation_type):
    """Build one relation-exact SQL source predicate for VOD list/bulk use."""
    filters = filters if isinstance(filters, dict) else {}
    if relation_type == "movie":
        table = "vod_m3umovierelation"
        canonical_column = "movie_id"
        container_fallback = "relation.container_extension"
    else:
        table = "vod_m3useriesrelation"
        canonical_column = "series_id"
        container_fallback = "NULL"
    joins = f"""
        {table} relation
        JOIN m3u_m3uaccount account
          ON relation.m3u_account_id = account.id
        LEFT JOIN vod_vodcategory category
          ON relation.category_id = category.id
        LEFT JOIN vod_vodsourceasset asset
          ON relation.source_asset_id = asset.id
        LEFT JOIN vod_m3uvodcategoryrelation category_relation
          ON category_relation.m3u_account_id = relation.m3u_account_id
         AND category_relation.category_id = relation.category_id
    """
    conditions = ["account.is_active = true"]
    params = []
    technical_conditions = []
    technical_params = []
    episode_conditions = []
    episode_params = []

    m3u_account = str(filters.get("m3u_account") or "").strip()
    if m3u_account.isdigit():
        conditions.append("relation.m3u_account_id = %s")
        params.append(int(m3u_account))

    category_value = str(filters.get("category") or "").strip()
    if category_value:
        category_name = category_value
        category_type = None
        if "|" in category_value:
            category_name, category_type = category_value.rsplit("|", 1)
        if category_type and category_type != relation_type:
            conditions.append("1 = 0")
        else:
            conditions.append("category.name = %s")
            params.append(category_name)

    for parameter, field in (
        ("audio_language", "audio_languages"),
        ("subtitle_language", "subtitle_languages"),
    ):
        value = normalize_language_code(filters.get(parameter))
        if value:
            sql, sql_params = _effective_json_array_match(field, value)
            technical_conditions.append(sql)
            technical_params.extend(sql_params)
            if relation_type == "series":
                sql, sql_params = _effective_json_array_match(
                    field, value, asset_alias="episode_asset"
                )
                episode_conditions.append(sql)
                episode_params.extend(sql_params)

    resolution = str(filters.get("resolution") or "").strip().lower()
    if resolution:
        sql, sql_params = _effective_json_scalar_match("resolution", resolution)
        technical_conditions.append(sql)
        technical_params.extend(sql_params)
        if relation_type == "series":
            sql, sql_params = _effective_json_scalar_match(
                "resolution", resolution, asset_alias="episode_asset"
            )
            episode_conditions.append(sql)
            episode_params.extend(sql_params)

    container = str(filters.get("container_extension") or "").strip().lower()
    if container:
        sql, sql_params = _effective_json_scalar_match(
            "container_extension", container, container_fallback
        )
        technical_conditions.append(sql)
        technical_params.extend(sql_params)
        if relation_type == "series":
            sql, sql_params = _effective_json_scalar_match(
                "container_extension",
                container,
                "episode_relation.container_extension",
                asset_alias="episode_asset",
            )
            episode_conditions.append(sql)
            episode_params.extend(sql_params)

    if relation_type == "series" and technical_conditions:
        # Series-level defaults/assets are cheap to test. Technical data that
        # was learned from actual episode playback lives on episode assets, so
        # use one correlated EXISTS for the complete filter set. This ensures
        # DUB/SUB/resolution/format all describe the same source edition.
        episode_sql = f"""EXISTS (
            SELECT 1
            FROM vod_m3uepisoderelation episode_relation
            LEFT JOIN vod_vodsourceasset episode_asset
              ON episode_relation.source_asset_id = episode_asset.id
            WHERE episode_relation.series_relation_id = relation.id
              AND {' AND '.join(episode_conditions)}
        )"""
        conditions.append(
            f"(({' AND '.join(technical_conditions)}) OR {episode_sql})"
        )
        params.extend(technical_params)
        params.extend(episode_params)
    else:
        conditions.extend(technical_conditions)
        params.extend(technical_params)

    return joins, conditions, params, canonical_column


def _vod_source_relation_prefetch(model):
    return Prefetch(
        "m3u_relations",
        queryset=model.objects.filter(
            m3u_account__is_active=True,
        ).select_related("m3u_account", "category", "source_asset"),
    )


def _validated_source_metadata(value):
    from .metadata import validate_source_metadata

    try:
        return validate_source_metadata(value)
    except ValueError as exc:
        raise DRFValidationError({"metadata": str(exc)})


def _is_admin(user):
    return bool(user and getattr(user, "user_level", 0) >= 10)


def _filtered_vod_content(filters):
    """Return Movie/Series querysets matching the VOD list controls."""
    filters = filters if isinstance(filters, dict) else {}
    content_type = filters.get("type") or "all"
    search = str(filters.get("search") or "").strip()

    movie_joins, movie_conditions, movie_params, movie_column = (
        _vod_relation_sql(filters, "movie")
    )
    series_joins, series_conditions, series_params, series_column = (
        _vod_relation_sql(filters, "series")
    )
    movies = Movie.objects.filter(
        id__in=RawSQL(
            f"SELECT relation.{movie_column} FROM {movie_joins} "
            f"WHERE {' AND '.join(movie_conditions)}",
            movie_params,
        )
    )
    series = Series.objects.filter(
        id__in=RawSQL(
            f"SELECT relation.{series_column} FROM {series_joins} "
            f"WHERE {' AND '.join(series_conditions)}",
            series_params,
        )
    )
    if content_type == "movies":
        series = series.none()
    elif content_type == "series":
        movies = movies.none()

    if search:
        # The unified "All" endpoint currently searches names only, while
        # the dedicated movie and series endpoints also search description
        # and genre. Mirror those list endpoints exactly so a bulk operation
        # never reaches rows that were not included in the visible result set.
        if content_type == "all":
            movies = movies.filter(name__icontains=search)
            series = series.filter(name__icontains=search)
        else:
            movies = movies.filter(
                Q(name__icontains=search)
                | Q(description__icontains=search)
                | Q(genre__icontains=search)
            )
            series = series.filter(
                Q(name__icontains=search)
                | Q(description__icontains=search)
                | Q(genre__icontains=search)
            )

    return movies.distinct(), series.distinct()


def _filtered_vod_relation_query(filters, relation_type):
    """Limit bulk edits to the source relations represented by list filters.

    Search and content-type filters select canonical Movie/Series rows. Account
    and category filters additionally describe which concrete source relations
    made those rows visible, so they must remain in force during mass editing.
    """
    filters = filters if isinstance(filters, dict) else {}
    query = Q(m3u_account__is_active=True)

    m3u_account = str(filters.get("m3u_account") or "").strip()
    if m3u_account.isdigit():
        query &= Q(m3u_account_id=int(m3u_account))

    category = str(filters.get("category") or "").strip()
    technical_filters = any(
        filters.get(key)
        for key in (
            "audio_language",
            "subtitle_language",
            "resolution",
            "container_extension",
        )
    )
    if not category and not technical_filters:
        return query

    category_name = category
    category_type = None
    if "|" in category:
        category_name, category_type = category.rsplit("|", 1)

    expected_type = "movie" if relation_type == "movie" else "series"
    if category_type and category_type != expected_type:
        return Q(pk__in=[])

    category_field = (
        "category__name"
        if relation_type in {"movie", "series"}
        else "series_relation__category__name"
    )
    if category:
        query &= Q(**{category_field: category_name})
    if technical_filters and relation_type in {"movie", "series"}:
        joins, conditions, params, _canonical_column = _vod_relation_sql(
            filters, relation_type
        )
        query &= Q(
            pk__in=RawSQL(
                f"SELECT relation.id FROM {joins} "
                f"WHERE {' AND '.join(conditions)}",
                params,
            )
        )
    return query


class VODSourceAssetViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = VODSourceAsset.objects.annotate(
        movie_relation_count=Count("movie_relations", distinct=True),
        series_relation_count=Count("series_relations", distinct=True),
        episode_relation_count=Count("episode_relations", distinct=True),
    ).order_by("-updated_at")
    serializer_class = VODSourceAssetSerializer
    pagination_class = None

    def get_permissions(self):
        return [Authenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset.none()
        return self.queryset if _is_admin(self.request.user) else self.queryset.none()

    @action(detail=True, methods=["patch"], url_path="manual-metadata")
    def manual_metadata(self, request, pk=None):
        if not _is_admin(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        asset = self.get_object()
        metadata = request.data.get("metadata", {})
        locked_fields = request.data.get("locked_fields", list(metadata))
        if not isinstance(metadata, dict) or not isinstance(locked_fields, list):
            return Response(
                {"detail": "metadata must be an object and locked_fields a list"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        asset.manual_metadata = _validated_source_metadata(metadata)
        asset.locked_fields = sorted({str(field) for field in locked_fields})
        asset.save(update_fields=["manual_metadata", "locked_fields", "updated_at"])
        return Response(self.get_serializer(asset).data)

    @action(detail=False, methods=["patch"], url_path="bulk-manual-metadata")
    def bulk_manual_metadata(self, request):
        """Set locked metadata on source relations matching the list selection."""
        if not _is_admin(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        selections = request.data.get("selections", [])
        exclude_selections = request.data.get("exclude_selections", [])
        select_all = request.data.get("select_all") is True
        filters = request.data.get("filters")
        filters = filters if isinstance(filters, dict) else {}
        metadata = request.data.get("metadata", {})
        if (
            not isinstance(selections, list)
            or not isinstance(exclude_selections, list)
            or not isinstance(metadata, dict)
        ):
            return Response(
                {
                    "detail": (
                        "selections and exclude_selections must be lists and "
                        "metadata an object"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if any(
            not isinstance(item, dict)
            for item in selections + exclude_selections
        ):
            return Response(
                {"detail": "Every selection must be an object"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from .metadata import ensure_source_assets

        metadata = _validated_source_metadata(metadata)
        explicit_movie_ids = {
            int(item["id"])
            for item in selections
            if item.get("content_type") == "movie" and str(item.get("id", "")).isdigit()
        }
        explicit_series_ids = {
            int(item["id"])
            for item in selections
            if item.get("content_type") == "series" and str(item.get("id", "")).isdigit()
        }
        excluded_movie_ids = {
            int(item["id"])
            for item in exclude_selections
            if item.get("content_type") == "movie"
            and str(item.get("id", "")).isdigit()
        }
        excluded_series_ids = {
            int(item["id"])
            for item in exclude_selections
            if item.get("content_type") == "series"
            and str(item.get("id", "")).isdigit()
        }

        if select_all:
            movies, series = _filtered_vod_content(filters)
            if excluded_movie_ids:
                movies = movies.exclude(id__in=excluded_movie_ids)
            if excluded_series_ids:
                series = series.exclude(id__in=excluded_series_ids)
            movie_ids = movies.values("id")
            series_ids = series.values("id")
        else:
            movie_ids = explicit_movie_ids
            series_ids = explicit_series_ids

        relation_querysets = [
            M3UMovieRelation.objects.filter(
                _filtered_vod_relation_query(filters, "movie"),
                movie_id__in=movie_ids,
            ).select_related("m3u_account__server_group"),
            M3USeriesRelation.objects.filter(
                _filtered_vod_relation_query(filters, "series"),
                series_id__in=series_ids,
            ).select_related("m3u_account__server_group"),
            M3UEpisodeRelation.objects.filter(
                _filtered_vod_relation_query(filters, "episode"),
                episode__series_id__in=series_ids,
            ).select_related("m3u_account__server_group"),
        ]
        updated_asset_ids = set()
        updated_at = timezone.now()

        def update_assets(asset_ids):
            new_ids = set(asset_ids) - updated_asset_ids
            if not new_ids:
                return
            assets = list(VODSourceAsset.objects.filter(id__in=new_ids))
            for asset in assets:
                asset.manual_metadata = {
                    **(asset.manual_metadata or {}),
                    **metadata,
                }
                asset.locked_fields = sorted(
                    set(asset.locked_fields or []) | set(metadata)
                )
                asset.updated_at = updated_at
            if assets:
                VODSourceAsset.objects.bulk_update(
                    assets,
                    ["manual_metadata", "locked_fields", "updated_at"],
                    batch_size=1000,
                )
                updated_asset_ids.update(asset.id for asset in assets)

        for queryset in relation_querysets:
            batch = []
            for relation in queryset.iterator(chunk_size=1000):
                batch.append(relation)
                if len(batch) == 1000:
                    update_assets(ensure_source_assets(batch))
                    batch = []
            if batch:
                update_assets(ensure_source_assets(batch))
        from .catalog_cache import bump_catalog_generation
        from .profile_selection import enqueue_all_profile_selection_rebuilds

        bump_catalog_generation()
        enqueue_all_profile_selection_rebuilds()
        return Response({"updated_sources": len(updated_asset_ids)})

    @action(detail=True, methods=["post"], url_path="link-relations")
    def link_relations(self, request, pk=None):
        """Explicitly mark account-scoped relations as the same media edition."""
        if not _is_admin(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        asset = self.get_object()
        relation_type = request.data.get("relation_type")
        relation_ids = request.data.get("relation_ids", [])
        model_map = {
            "movie": M3UMovieRelation,
            "series": M3USeriesRelation,
            "episode": M3UEpisodeRelation,
        }
        model = model_map.get(relation_type)
        if model is None or relation_type != asset.asset_type:
            return Response(
                {"detail": "relation_type must match the target asset"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        relations = list(model.objects.filter(id__in=relation_ids))
        if len(relations) != len(set(relation_ids)):
            return Response(
                {"detail": "One or more relations do not exist"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        canonical_ids = {
            getattr(relation, f"{relation_type}_id", None)
            if relation_type != "episode"
            else relation.episode_id
            for relation in relations
        }
        if len(canonical_ids) > 1:
            return Response(
                {"detail": "Only relations for the same canonical content may be linked"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        existing_canonical_ids = set()
        for related_name, canonical_field in (
            ("movie_relations", "movie_id"),
            ("series_relations", "series_id"),
            ("episode_relations", "episode_id"),
        ):
            if related_name.startswith(relation_type):
                existing_canonical_ids.update(
                    getattr(asset, related_name).values_list(canonical_field, flat=True)
                )
        if existing_canonical_ids and canonical_ids and (
            canonical_ids != existing_canonical_ids
        ):
            return Response(
                {"detail": "Only relations for the same canonical content may be linked"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        model.objects.filter(id__in=relation_ids).update(source_asset=asset)
        from .catalog_cache import bump_catalog_generation
        from .profile_selection import enqueue_all_profile_selection_rebuilds

        bump_catalog_generation()
        enqueue_all_profile_selection_rebuilds()
        return Response(self.get_serializer(asset).data)


class M3UVODCategoryRelationViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = M3UVODCategoryRelation.objects.select_related(
        "m3u_account", "category"
    )
    serializer_class = M3UVODCategoryRelationSerializer
    pagination_class = None

    def get_permissions(self):
        return [Authenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset.none()
        return self.queryset if _is_admin(self.request.user) else self.queryset.none()

    @action(detail=True, methods=["patch"], url_path="metadata-defaults")
    def metadata_defaults(self, request, pk=None):
        if not _is_admin(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        relation = self.get_object()
        serializer = self.get_serializer(
            relation,
            data={
                "metadata_defaults": _validated_source_metadata(
                    request.data.get("metadata_defaults", {})
                )
            },
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        from .profile_selection import enqueue_all_profile_selection_rebuilds

        enqueue_all_profile_selection_rebuilds()
        return Response(serializer.data)

    @action(detail=False, methods=["patch"], url_path="bulk-metadata-defaults")
    def bulk_metadata_defaults(self, request):
        if not _is_admin(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        relation_ids = request.data.get("relation_ids", [])
        metadata = request.data.get("metadata_defaults", {})
        if not isinstance(relation_ids, list) or not isinstance(metadata, dict):
            return Response(
                {"detail": "relation_ids must be a list and metadata_defaults an object"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            relation_ids = [int(relation_id) for relation_id in relation_ids]
        except (TypeError, ValueError):
            return Response(
                {"detail": "relation_ids must contain integers"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        normalized = _validated_source_metadata(metadata)
        relations = list(self.get_queryset().filter(pk__in=relation_ids))
        updated_at = timezone.now()
        for relation in relations:
            relation.metadata_defaults = {
                **(relation.metadata_defaults or {}),
                **normalized,
            }
            relation.updated_at = updated_at
        M3UVODCategoryRelation.objects.bulk_update(
            relations, ["metadata_defaults", "updated_at"], batch_size=1000
        )
        from .catalog_cache import bump_catalog_generation
        from .profile_selection import enqueue_all_profile_selection_rebuilds

        bump_catalog_generation()
        enqueue_all_profile_selection_rebuilds()
        return Response({"updated_categories": len(relations)})


class VODAccessPolicyViewSet(viewsets.ModelViewSet):
    queryset = VODAccessPolicy.objects.prefetch_related(
        "users",
        "vodpolicycategory_set__category_relation__category",
        "vodpolicycategory_set__category_relation__m3u_account",
    )
    serializer_class = VODAccessPolicySerializer
    pagination_class = None

    def get_permissions(self):
        return [Authenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset.none()
        if _is_admin(self.request.user):
            return self.queryset
        return self.queryset.filter(
            Q(users=self.request.user) | Q(is_default=True)
        ).distinct()

    def _admin_only(self, request):
        return None if _is_admin(request.user) else Response(status=status.HTTP_403_FORBIDDEN)

    def create(self, request, *args, **kwargs):
        denied = self._admin_only(request)
        if denied is not None:
            return denied
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        denied = self._admin_only(request)
        if denied is not None:
            return denied
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        denied = self._admin_only(request)
        if denied is not None:
            return denied
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        denied = self._admin_only(request)
        if denied is not None:
            return denied
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="rebuild")
    def rebuild(self, request, pk=None):
        denied = self._admin_only(request)
        if denied is not None:
            return denied
        policy = self.get_object()
        from .profile_selection import enqueue_profile_selection_rebuild

        if not enqueue_profile_selection_rebuild(policy.pk):
            return Response(
                {"detail": "Activate the profile before rebuilding it"},
                status=status.HTTP_409_CONFLICT,
            )
        policy.refresh_from_db()
        return Response(self.get_serializer(policy).data, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["get"], url_path="selections")
    def selections(self, request, pk=None):
        denied = self._admin_only(request)
        if denied is not None:
            return denied
        policy = self.get_object()
        content_type = request.query_params.get("type", "movie")
        if content_type not in {"movie", "series"}:
            return Response(
                {"detail": "type must be movie or series"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        selection_state = VODAccessPolicySerializer(policy).data
        if not selection_state["selection_available"]:
            return Response(
                {
                    "status": policy.selection_status,
                    "current": False,
                    "available": False,
                    "counts": policy.selection_counts or {},
                    "results": [],
                    "count": 0,
                },
                status=status.HTTP_409_CONFLICT,
            )

        is_movie = content_type == "movie"
        selection_model = (
            VODMovieProfileSelection if is_movie else VODSeriesProfileSelection
        )
        canonical = "movie" if is_movie else "series"
        queryset = selection_model.objects.filter(
            policy=policy,
            generation=policy.active_selection_generation,
        ).select_related(
            canonical,
            "relation__m3u_account",
            "category",
        )
        search = request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(**{f"{canonical}__name__icontains": search})
        if request.query_params.get("m3u_account"):
            queryset = queryset.filter(
                relation__m3u_account_id=request.query_params["m3u_account"]
            )
        if request.query_params.get("category"):
            queryset = queryset.filter(category_id=request.query_params["category"])
        if request.query_params.get("container_extension"):
            queryset = queryset.filter(
                container_extension__iexact=request.query_params[
                    "container_extension"
                ]
            )
        resolution = request.query_params.get("resolution", "").lower().rstrip("p")
        if resolution:
            try:
                queryset = queryset.filter(resolution_height=int(resolution))
            except ValueError:
                return Response(
                    {"detail": "resolution must be a vertical pixel count"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        audio = normalize_language_code(
            request.query_params.get("audio_language", "")
        )
        subtitles = normalize_language_code(
            request.query_params.get("subtitle_language", "")
        )
        python_language_filter = connection.vendor != "postgresql" and (
            audio or subtitles
        )
        if not python_language_filter:
            if audio:
                queryset = queryset.filter(audio_languages__contains=[audio])
            if subtitles:
                queryset = queryset.filter(subtitle_languages__contains=[subtitles])

        queryset = queryset.order_by(f"{canonical}__name", "id")
        try:
            page = max(int(request.query_params.get("page", 1)), 1)
            page_size = min(
                max(int(request.query_params.get("page_size", 50)), 1), 200
            )
        except ValueError:
            return Response(
                {"detail": "page and page_size must be integers"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if python_language_filter:
            matching = [
                row
                for row in queryset
                if (not audio or audio in (row.audio_languages or []))
                and (
                    not subtitles
                    or subtitles in (row.subtitle_languages or [])
                )
            ]
            matching_count = len(matching)
            rows = matching[(page - 1) * page_size : page * page_size]
        else:
            matching_count = queryset.count()
            rows = list(queryset[(page - 1) * page_size : page * page_size])

        from .utils import get_vod_source_name

        results = []
        for row in rows:
            content = getattr(row, canonical)
            relation = row.relation
            results.append(
                {
                    "id": row.id,
                    "content_type": content_type,
                    "canonical_id": content.id,
                    "name": content.name,
                    "year": content.year,
                    "relation_id": relation.id,
                    "source_name": get_vod_source_name(relation, content.name),
                    "m3u_account_id": relation.m3u_account_id,
                    "m3u_account_name": relation.m3u_account.name,
                    "category_id": row.category_id,
                    "category_name": row.category.name if row.category else "",
                    "metadata": row.effective_metadata,
                    "resolution": row.resolution_height,
                    "container_extension": row.container_extension,
                }
            )
        return Response(
            {
                "status": policy.selection_status,
                "current": selection_state["selection_current"],
                "available": True,
                "counts": policy.selection_counts or {},
                "count": matching_count,
                "page": page,
                "page_size": page_size,
                "results": results,
            }
        )


class VODPlaybackSessionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = VODPlaybackSession.objects.select_related(
        "user", "source_asset", "m3u_account", "category"
    )
    serializer_class = VODPlaybackSessionSerializer

    class Pagination(PageNumberPagination):
        page_size = 50
        page_size_query_param = "page_size"
        max_page_size = 200

    pagination_class = Pagination

    def get_permissions(self):
        return [Authenticated()]

    def get_queryset(self):
        queryset = self.queryset
        if getattr(self, "swagger_fake_view", False):
            return queryset.none()
        if not _is_admin(self.request.user):
            queryset = queryset.filter(user=self.request.user)
        return queryset

    @action(detail=True, methods=["post"], url_path="telemetry")
    def telemetry(self, request, pk=None):
        playback = self.get_object()
        event = request.data.get("event")
        metadata = request.data.get("metadata", {})
        if metadata and not isinstance(metadata, dict):
            return Response(
                {"detail": "metadata must be an object"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        status_by_event = {
            "started": VODPlaybackSession.Status.PROXYING,
            "progress": playback.status,
            "stopped": VODPlaybackSession.Status.STOPPED,
            "completed": VODPlaybackSession.Status.COMPLETED,
            "failed": VODPlaybackSession.Status.FAILED,
        }
        if event not in status_by_event:
            return Response(
                {"detail": "Unsupported telemetry event"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        playback.mode = VODPlaybackSession.Mode.PLAYER
        playback.status = status_by_event[event]
        try:
            bytes_sent = int(request.data.get("bytes_sent") or 0)
            watched_seconds = int(request.data.get("watched_seconds") or 0)
        except (TypeError, ValueError):
            return Response(
                {"detail": "bytes_sent and watched_seconds must be integers"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        playback.bytes_sent = max(playback.bytes_sent, bytes_sent)
        playback.watched_seconds = max(
            playback.watched_seconds, watched_seconds
        )
        playback.observed_metadata = {
            **(playback.observed_metadata or {}),
            **metadata,
        }
        if event in {"stopped", "completed", "failed"}:
            playback.ended_at = timezone.now()
        if event == "failed":
            playback.error = str(request.data.get("error") or "")[:2000]
        playback.save()
        if metadata and playback.source_asset_id:
            playback.source_asset.apply_observation(metadata)
        return Response(self.get_serializer(playback).data)


class VODPagination(PageNumberPagination):
    page_size = 20  # Default page size to match frontend default
    page_size_query_param = "page_size"  # Allow clients to specify page size
    max_page_size = 100  # Prevent excessive page sizes for VOD content


class MovieFilter(django_filters.FilterSet):
    name = django_filters.CharFilter(lookup_expr="icontains")
    m3u_account = django_filters.NumberFilter(field_name="m3u_relations__m3u_account__id")
    category = django_filters.CharFilter(method='filter_category')
    year = django_filters.NumberFilter()
    year_gte = django_filters.NumberFilter(field_name="year", lookup_expr="gte")
    year_lte = django_filters.NumberFilter(field_name="year", lookup_expr="lte")
    is_adult = django_filters.BooleanFilter()

    class Meta:
        model = Movie
        fields = ['name', 'm3u_account', 'category', 'year', 'is_adult']

    def filter_category(self, queryset, name, value):
        """Custom category filter that handles 'name|type' format"""
        if not value:
            return queryset

        # Handle the format 'category_name|category_type'
        if '|' in value:
            category_name, category_type = value.rsplit('|', 1)
            return queryset.filter(
                m3u_relations__category__name=category_name,
                m3u_relations__category__category_type=category_type
            )
        else:
            # Fallback: treat as category name only
            return queryset.filter(m3u_relations__category__name=value)


class MovieViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for Movie content"""
    queryset = Movie.objects.all()
    serializer_class = MovieSerializer
    pagination_class = VODPagination

    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = MovieFilter
    search_fields = ['name', 'description', 'genre']
    ordering_fields = ['name', 'year', 'created_at']
    ordering = ['name']

    def get_permissions(self):
        try:
            return [perm() for perm in permission_classes_by_action[self.action]]
        except KeyError:
            if self.action == 'image':
                return [AllowAny()]
            return [Authenticated()]

    def get_queryset(self):
        # Apply active account, selected account, and category to the same
        # concrete source relation. The filter backend may repeat the latter
        # two predicates, but cannot broaden this relation-exact result set.
        filters = {
            "m3u_account": self.request.query_params.get("m3u_account", ""),
            "category": self.request.query_params.get("category", ""),
            "audio_language": self.request.query_params.get("audio_language", ""),
            "subtitle_language": self.request.query_params.get("subtitle_language", ""),
            "resolution": self.request.query_params.get("resolution", ""),
            "container_extension": self.request.query_params.get(
                "container_extension", ""
            ),
        }
        movies, _ = _filtered_vod_content(filters)
        qs = movies.select_related('logo').prefetch_related(
            _vod_source_relation_prefetch(M3UMovieRelation)
        )
        user = getattr(self.request, 'user', None)
        if (
            user is not None
            and getattr(user, 'is_authenticated', False)
            and user.user_level < 10
            and (user.custom_properties or {}).get('hide_adult_content', False)
        ):
            qs = qs.filter(is_adult=False)
        return qs

    @action(detail=True, methods=['get'], url_path='providers')
    def get_providers(self, request, pk=None):
        """Get all providers (M3U accounts) that have this movie"""
        movie = self.get_object()
        relations = M3UMovieRelation.objects.filter(
            movie=movie,
            m3u_account__is_active=True
        ).select_related('m3u_account', 'category')

        serializer = M3UMovieRelationSerializer(relations, many=True)
        return Response(serializer.data)


    @action(detail=True, methods=['get'], url_path='provider-info')
    def provider_info(self, request, pk=None):
        """Get detailed movie information from the original provider, throttled to 24h."""
        movie = self.get_object()

        relation_id = request.query_params.get('relation_id')
        if relation_id is not None:
            try:
                relation_id = int(relation_id)
            except (TypeError, ValueError):
                return Response(
                    {'error': 'Invalid relation_id'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        qs = M3UMovieRelation.objects.filter(
            movie=movie,
            m3u_account__is_active=True
        ).select_related('m3u_account')

        if relation_id is not None:
            relation = qs.filter(id=relation_id).first()
            if not relation:
                return Response(
                    {'error': 'Relation not found or not active'},
                    status=status.HTTP_404_NOT_FOUND
                )
        else:
            relation = qs.order_by('-m3u_account__priority', 'id').first()

        if not relation:
            return Response(
                {'error': 'No active M3U account associated with this movie'},
                status=status.HTTP_400_BAD_REQUEST
            )

        force_refresh = request.query_params.get('force_refresh', 'false').lower() == 'true'
        now = timezone.now()
        detailed_fetched = (relation.custom_properties or {}).get('detailed_fetched', False)
        needs_refresh = (
            force_refresh or
            not detailed_fetched or
            not relation.last_advanced_refresh or
            (now - relation.last_advanced_refresh).total_seconds() > 86400
        )

        if needs_refresh:
            # Trigger advanced data refresh
            logger.debug(f"Refreshing advanced data for movie {movie.id} (relation ID: {relation.id})")
            refresh_movie_advanced_data(relation.id, force_refresh=force_refresh)

            # Refresh objects from database after task completion
            movie.refresh_from_db()
            relation.refresh_from_db()

        # Use refreshed data from database
        custom_props = relation.custom_properties or {}
        info = custom_props.get('detailed_info', {})
        movie_data = custom_props.get('movie_data', {})

        movie_props = movie.custom_properties or {}
        artwork = prefer_relation_artwork(custom_props, movie_props)
        account_id = relation.m3u_account_id
        backdrop_path = rewrite_backdrop_paths(
            request,
            'movie',
            movie.id,
            artwork['backdrop_path'],
            m3u_account_id=account_id,
        )
        # Relation/object still first; synced VODLogo only when none is available.
        if is_proxyable_image_url(artwork['movie_image']):
            movie_image = rewrite_single_image_url(
                request,
                'movie',
                movie.id,
                'movie_image',
                artwork['movie_image'],
                m3u_account_id=account_id,
            )
        elif movie.logo:
            movie_image = vodlogo_cache_url(request, movie.logo)
        else:
            movie_image = ''

        # Build response with available data
        response_data = {
            'id': movie.id,
            'uuid': movie.uuid,
            'stream_id': relation.stream_id,
            'name': info.get('name', movie.name),
            'o_name': info.get('o_name', ''),
            'description': info.get('description', info.get('plot', movie.description)),
            'plot': info.get('plot', info.get('description', movie.description)),
            'year': movie.year or info.get('year'),
            'release_date': (movie.custom_properties or {}).get('release_date') or info.get('release_date') or info.get('releasedate', ''),
            'genre': movie.genre or info.get('genre', ''),
            'director': (movie.custom_properties or {}).get('director') or info.get('director', ''),
            'actors': (movie.custom_properties or {}).get('actors') or info.get('actors', ''),
            'country': (movie.custom_properties or {}).get('country') or info.get('country', ''),
            'rating': movie.rating or info.get('rating', movie.rating or 0),
            'tmdb_id': movie.tmdb_id or info.get('tmdb_id', ''),
            'imdb_id': movie.imdb_id or info.get('imdb_id', ''),
            'youtube_trailer': (movie.custom_properties or {}).get('youtube_trailer') or info.get('youtube_trailer') or info.get('trailer', ''),
            'duration_secs': movie.duration_secs or info.get('duration_secs'),
            'age': info.get('age', ''),
            'backdrop_path': backdrop_path,
            # All three mirror the resolved cover so the UI never falls back to a
            # raw provider URL that bypasses the proxy.
            'cover': movie_image,
            'cover_big': movie_image,
            'movie_image': movie_image,
            'bitrate': info.get('bitrate', 0),
            'video': info.get('video', {}),
            'audio': info.get('audio', {}),
            'container_extension': movie_data.get('container_extension', 'mp4'),
            'direct_source': movie_data.get('direct_source', ''),
            'category_id': movie_data.get('category_id', ''),
            'added': movie_data.get('added', ''),
            'm3u_account': {
                'id': relation.m3u_account.id,
                'name': relation.m3u_account.name,
                'account_type': relation.m3u_account.account_type
            }
        }
        return Response(response_data)

    @action(detail=True, methods=['get'], url_path='image', permission_classes=[AllowAny])
    def image(self, request, pk=None):
        """Proxy a stored movie image (backdrop, movie_image, poster_path)."""
        return vod_image_action(self, request, 'movie')


class EpisodeFilter(django_filters.FilterSet):
    name = django_filters.CharFilter(lookup_expr="icontains")
    series = django_filters.NumberFilter(field_name="series__id")
    m3u_account = django_filters.NumberFilter(field_name="m3u_relations__m3u_account__id")
    season_number = django_filters.NumberFilter()
    episode_number = django_filters.NumberFilter()

    class Meta:
        model = Episode
        fields = ['name', 'series', 'm3u_account', 'season_number', 'episode_number']


class SeriesFilter(django_filters.FilterSet):
    name = django_filters.CharFilter(lookup_expr="icontains")
    m3u_account = django_filters.NumberFilter(field_name="m3u_relations__m3u_account__id")
    category = django_filters.CharFilter(method='filter_category')
    year = django_filters.NumberFilter()
    year_gte = django_filters.NumberFilter(field_name="year", lookup_expr="gte")
    year_lte = django_filters.NumberFilter(field_name="year", lookup_expr="lte")

    class Meta:
        model = Series
        fields = ['name', 'm3u_account', 'category', 'year']

    def filter_category(self, queryset, name, value):
        """Custom category filter that handles 'name|type' format"""
        if not value:
            return queryset

        # Handle the format 'category_name|category_type'
        if '|' in value:
            category_name, category_type = value.rsplit('|', 1)
            return queryset.filter(
                m3u_relations__category__name=category_name,
                m3u_relations__category__category_type=category_type
            )
        else:
            # Fallback: treat as category name only
            return queryset.filter(m3u_relations__category__name=value)


class EpisodeViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for Episode content"""
    queryset = Episode.objects.all()
    serializer_class = EpisodeSerializer
    pagination_class = VODPagination

    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = EpisodeFilter
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'season_number', 'episode_number', 'created_at']
    ordering = ['series__name', 'season_number', 'episode_number']

    def get_permissions(self):
        try:
            return [perm() for perm in permission_classes_by_action[self.action]]
        except KeyError:
            if self.action == 'image':
                return [AllowAny()]
            return [Authenticated()]

    def get_queryset(self):
        return Episode.objects.select_related('series').filter(
            m3u_relations__m3u_account__is_active=True
        ).distinct()

    @action(detail=True, methods=['get'], url_path='image', permission_classes=[AllowAny])
    def image(self, request, pk=None):
        """Proxy a stored episode image (movie_image, backdrop, poster_path)."""
        return vod_image_action(self, request, 'episode')


class SeriesViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for Series management"""
    queryset = Series.objects.all()
    serializer_class = SeriesSerializer
    pagination_class = VODPagination

    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = SeriesFilter
    search_fields = ['name', 'description', 'genre']
    ordering_fields = ['name', 'year', 'created_at']
    ordering = ['name']

    def get_permissions(self):
        try:
            return [perm() for perm in permission_classes_by_action[self.action]]
        except KeyError:
            if self.action == 'image':
                return [AllowAny()]
            return [Authenticated()]

    def get_queryset(self):
        filters = {
            "m3u_account": self.request.query_params.get("m3u_account", ""),
            "category": self.request.query_params.get("category", ""),
            "audio_language": self.request.query_params.get("audio_language", ""),
            "subtitle_language": self.request.query_params.get("subtitle_language", ""),
            "resolution": self.request.query_params.get("resolution", ""),
            "container_extension": self.request.query_params.get(
                "container_extension", ""
            ),
        }
        _, series = _filtered_vod_content(filters)
        return series.select_related('logo').prefetch_related(
            _vod_source_relation_prefetch(M3USeriesRelation)
        )

    @action(detail=True, methods=['get'], url_path='providers')
    def get_providers(self, request, pk=None):
        """Get all providers (M3U accounts) that have this series"""
        series = self.get_object()
        relations = M3USeriesRelation.objects.filter(
            series=series,
            m3u_account__is_active=True
        ).select_related('m3u_account', 'category').order_by(
            '-m3u_account__priority', 'id'
        )

        serializer = M3USeriesRelationSerializer(relations, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'], url_path='episodes')
    def get_episodes(self, request, pk=None):
        """Get episodes for this series with provider information"""
        series = self.get_object()
        episodes = Episode.objects.filter(series=series).prefetch_related(
            'm3u_relations__m3u_account'
        ).order_by('season_number', 'episode_number')

        episodes_data = []
        for episode in episodes:
            episode_serializer = EpisodeSerializer(episode)
            episode_data = episode_serializer.data

            # Add provider information
            relations = M3UEpisodeRelation.objects.filter(
                episode=episode,
                m3u_account__is_active=True
            ).select_related('m3u_account')

            episode_data['providers'] = M3UEpisodeRelationSerializer(relations, many=True).data
            episodes_data.append(episode_data)

        return Response(episodes_data)

    @action(detail=True, methods=['get'], url_path='provider-info')
    def series_info(self, request, pk=None):
        """Get detailed series information, refreshing from provider if needed"""
        logger.debug(f"SeriesViewSet.series_info called for series ID: {pk}")
        series = self.get_object()
        logger.debug(f"Retrieved series: {series.name} (ID: {series.id})")

        relation_id = request.query_params.get('relation_id')
        if relation_id is not None:
            try:
                relation_id = int(relation_id)
            except (TypeError, ValueError):
                return Response(
                    {'error': 'Invalid relation_id'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        qs = M3USeriesRelation.objects.filter(
            series=series,
            m3u_account__is_active=True
        ).select_related('m3u_account', 'category')

        if relation_id is not None:
            relation = qs.filter(id=relation_id).first()
            if not relation:
                return Response(
                    {'error': 'Relation not found or not active'},
                    status=status.HTTP_404_NOT_FOUND
                )
        else:
            relation = qs.order_by('-m3u_account__priority', 'id').first()

        if not relation:
            return Response(
                {'error': 'No active M3U account associated with this series'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # Check if we should refresh data (optional force refresh parameter)
            force_refresh = request.query_params.get('force_refresh', 'false').lower() == 'true'
            refresh_interval_hours = int(request.query_params.get("refresh_interval", 24))  # Default to 24 hours

            now = timezone.now()
            last_refreshed = relation.last_episode_refresh

            # Check if detailed data has been fetched
            custom_props = relation.custom_properties or {}
            episodes_fetched = custom_props.get('episodes_fetched', False)
            detailed_fetched = custom_props.get('detailed_fetched', False)

            # Force refresh if episodes have never been fetched or if forced
            if not episodes_fetched or not detailed_fetched or force_refresh:
                force_refresh = True
                logger.debug(f"Series {series.id} needs detailed/episode refresh, forcing refresh")
            elif last_refreshed is None or (now - last_refreshed) > timedelta(hours=refresh_interval_hours):
                force_refresh = True
                logger.debug(f"Series {series.id} refresh interval exceeded or never refreshed, forcing refresh")

            if force_refresh:
                logger.debug(f"Refreshing series {series.id} data from provider")
                # Use existing refresh logic with external_series_id
                from .tasks import refresh_series_episodes
                account = relation.m3u_account
                if account and account.is_active:
                    refresh_series_episodes(account, series, relation.external_series_id)
                    series.refresh_from_db()  # Reload from database after refresh
                    relation.refresh_from_db()  # Reload relation too

            # Return the database data (which should now be fresh)
            custom_props = relation.custom_properties or {}
            series_props = series.custom_properties or {}
            series_artwork = prefer_relation_artwork(custom_props, series_props)
            account_id = relation.m3u_account_id
            # Relation/object cover first; synced VODLogo object only as fallback
            # (UI expects the logo-shaped cover payload when a VODLogo exists).
            if is_proxyable_image_url(series_artwork['movie_image']):
                proxied = rewrite_single_image_url(
                    request,
                    'series',
                    series.id,
                    'movie_image',
                    series_artwork['movie_image'],
                    m3u_account_id=account_id,
                )
                cover = {
                    'id': None,
                    'url': series_artwork['movie_image'],
                    'cache_url': proxied,
                    'name': series.name,
                }
            elif series.logo:
                cover = {
                    'id': series.logo.id,
                    'url': series.logo.url,
                    'cache_url': vodlogo_cache_url(request, series.logo),
                    'name': series.logo.name,
                }
            else:
                cover = None

            response_data = {
                'id': series.id,
                'series_id': relation.external_series_id,
                'name': get_series_display_name(series, relation),
                'description': series.description,
                'year': series.year,
                'genre': series.genre,
                'rating': series.rating,
                'tmdb_id': series.tmdb_id,
                'imdb_id': series.imdb_id,
                'category_id': relation.category.id if relation.category else None,
                'category_name': relation.category.name if relation.category else None,
                'cover': cover,
                'backdrop_path': rewrite_backdrop_paths(
                    request,
                    'series',
                    series.id,
                    series_artwork['backdrop_path'],
                    m3u_account_id=account_id,
                ),
                'last_refreshed': series.updated_at,
                'custom_properties': series.custom_properties,
                'm3u_account': {
                    'id': relation.m3u_account.id,
                    'name': relation.m3u_account.name,
                    'account_type': relation.m3u_account.account_type
                },
                'episodes_fetched': custom_props.get('episodes_fetched', False),
                'detailed_fetched': custom_props.get('detailed_fetched', False)
            }

            # Always include episodes for series info if they've been fetched
            include_episodes = request.query_params.get('include_episodes', 'true').lower() == 'true'
            if include_episodes and custom_props.get('episodes_fetched', False):
                logger.debug(f"Including episodes for series {series.id}")
                episodes_by_season = {}
                episode_image_parts = vod_image_url_parts(request, 'episode')
                episode_relations = M3UEpisodeRelation.objects.filter(
                    series_relation=relation,
                    m3u_account__is_active=True,
                ).select_related('episode').order_by(
                    'episode__season_number', 'episode__episode_number', 'id'
                )

                for episode_relation in episode_relations:
                    episode = episode_relation.episode
                    season_key = str(
                        episode.season_number if episode.season_number is not None else 0
                    )
                    if season_key not in episodes_by_season:
                        episodes_by_season[season_key] = []

                    relation_props = episode_relation.custom_properties or {}
                    provider_episode = relation_props.get('info') or {}
                    if not isinstance(provider_episode, dict):
                        provider_episode = {}
                    provider_info = provider_episode.get('info') or {}
                    if not isinstance(provider_info, dict):
                        provider_info = {}
                    episode_title = (
                        provider_episode.get('title')
                        or provider_info.get('name')
                        or episode.name
                    )
                    episode_description = (
                        provider_info.get('plot')
                        or provider_info.get('overview')
                        or episode.description
                    )
                    episode_artwork = prefer_relation_artwork(
                        relation_props,
                        episode.custom_properties,
                    )
                    raw_episode_image = episode_artwork['movie_image']
                    episode_data = {
                        'id': episode.id,
                        'relation_id': episode_relation.id,
                        'stream_id': episode_relation.stream_id,
                        'uuid': episode.uuid,
                        'name': episode_title,
                        'title': episode_title,
                        'episode_number': provider_episode.get(
                            'episode_num', episode.episode_number
                        ),
                        'season_number': episode.season_number,
                        'description': episode_description,
                        'air_date': provider_info.get('air_date') or episode.air_date,
                        'plot': episode_description,
                        'duration_secs': provider_info.get(
                            'duration_secs', episode.duration_secs
                        ),
                        'rating': provider_info.get('rating') or episode.rating,
                        'tmdb_id': provider_info.get('tmdb_id') or episode.tmdb_id,
                        'imdb_id': provider_info.get('imdb_id') or episode.imdb_id,
                        'movie_image': rewrite_single_image_url(
                            request,
                            'episode',
                            episode.id,
                            'movie_image',
                            raw_episode_image,
                            url_parts=episode_image_parts,
                            m3u_account_id=account_id,
                        ),
                        'container_extension': episode_relation.container_extension or 'mp4',
                        'type': 'episode',
                        'series': {
                            'id': series.id,
                            'name': series.name
                        }
                    }
                    episodes_by_season[season_key].append(episode_data)

                response_data['episodes'] = episodes_by_season
                logger.debug(f"Added {len(episodes_by_season)} seasons of episodes to response")
            elif include_episodes:
                # Episodes not yet fetched, include empty episodes list
                response_data['episodes'] = {}

            logger.debug(f"Returning series info response for series {series.id}")
            return Response(response_data)

        except Exception as e:
            logger.error(f"Error fetching series info for series {pk}: {str(e)}")
            return Response(
                {'error': f'Failed to fetch series information: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['get'], url_path='image', permission_classes=[AllowAny])
    def image(self, request, pk=None):
        """Proxy a stored series image (backdrop, movie_image, poster_path)."""
        return vod_image_action(self, request, 'series')


class VODCategoryFilter(django_filters.FilterSet):
    name = django_filters.CharFilter(lookup_expr="icontains")
    category_type = django_filters.ChoiceFilter(choices=VODCategory.CATEGORY_TYPE_CHOICES)
    m3u_account = django_filters.NumberFilter(field_name="m3u_account__id")

    class Meta:
        model = VODCategory
        fields = ['name', 'category_type', 'm3u_account']


class VODCategoryViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for VOD Categories"""
    queryset = VODCategory.objects.all()
    serializer_class = VODCategorySerializer

    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = VODCategoryFilter
    search_fields = ['name']
    ordering = ['name']

    def get_permissions(self):
        try:
            return [perm() for perm in permission_classes_by_action[self.action]]
        except KeyError:
            return [Authenticated()]

    def list(self, request, *args, **kwargs):
        """Override list to ensure Uncategorized categories and relations exist for all XC accounts with VOD enabled"""
        from apps.m3u.models import M3UAccount

        # Ensure Uncategorized categories exist
        movie_category, _ = VODCategory.objects.get_or_create(
            name="Uncategorized",
            category_type="movie",
            defaults={}
        )

        series_category, _ = VODCategory.objects.get_or_create(
            name="Uncategorized",
            category_type="series",
            defaults={}
        )

        # Get all active XC accounts with VOD enabled
        xc_accounts = M3UAccount.objects.filter(
            account_type=M3UAccount.Types.XC,
            is_active=True
        )

        for account in xc_accounts:
            if account.custom_properties:
                custom_props = account.custom_properties or {}
                vod_enabled = custom_props.get("enable_vod", False)

                if vod_enabled:
                    # Ensure relations exist for this account
                    auto_enable_new = False

                    M3UVODCategoryRelation.objects.get_or_create(
                        category=movie_category,
                        m3u_account=account,
                        defaults={
                            'enabled': auto_enable_new,
                            'custom_properties': {}
                        }
                    )

                    M3UVODCategoryRelation.objects.get_or_create(
                        category=series_category,
                        m3u_account=account,
                        defaults={
                            'enabled': auto_enable_new,
                            'custom_properties': {}
                        }
                    )

        # Now proceed with normal list operation
        return super().list(request, *args, **kwargs)


class UnifiedContentViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet that combines Movies and Series for unified 'All' view"""
    queryset = Movie.objects.none()  # Empty queryset, we override list method
    serializer_class = MovieSerializer  # Default serializer, overridden in list
    pagination_class = VODPagination

    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    search_fields = ['name', 'description', 'genre']
    ordering_fields = ['name', 'year', 'created_at']
    ordering = ['name']

    def get_permissions(self):
        try:
            return [perm() for perm in permission_classes_by_action[self.action]]
        except KeyError:
            return [Authenticated()]

    def list(self, request, *args, **kwargs):
        """Override list to handle unified content properly - database-level approach"""
        from django.db import connection

        try:
            # Get pagination parameters
            page_size = int(request.query_params.get('page_size', 24))
            page_number = int(request.query_params.get('page', 1))

            # Calculate offset for unified pagination
            offset = (page_number - 1) * page_size

            # For high page numbers, use raw SQL for efficiency
            # This avoids loading and sorting massive amounts of data in Python

            search = request.query_params.get('search', '')
            category = request.query_params.get('category', '')
            m3u_account = request.query_params.get('m3u_account', '')
            content_filter = request.query_params.get('type', 'all')
            list_filters = {
                "m3u_account": m3u_account,
                "category": category,
                "audio_language": request.query_params.get(
                    'audio_language', ''
                ),
                "subtitle_language": request.query_params.get(
                    'subtitle_language', ''
                ),
                "resolution": request.query_params.get('resolution', ''),
                "container_extension": request.query_params.get(
                    'container_extension', ''
                ),
            }
            (
                movie_joins,
                movie_source_conditions,
                movie_params,
                _movie_column,
            ) = _vod_relation_sql(list_filters, "movie")
            (
                series_joins,
                series_source_conditions,
                series_params,
                _series_column,
            ) = _vod_relation_sql(list_filters, "series")
            movie_source_conditions.insert(0, "relation.movie_id = movies.id")
            series_source_conditions.insert(0, "relation.series_id = series.id")

            category_type = None
            if category and '|' in category:
                _category_name, category_type = category.rsplit('|', 1)
            movie_enabled = (
                category_type != 'series' and content_filter != 'series'
            )
            series_enabled = (
                category_type != 'movie' and content_filter != 'movies'
            )

            where_conditions = [
                "EXISTS ("
                f"SELECT 1 FROM {movie_joins} "
                f"WHERE {' AND '.join(movie_source_conditions)}"
                ")"
                if movie_enabled else "1=0",
                "EXISTS ("
                f"SELECT 1 FROM {series_joins} "
                f"WHERE {' AND '.join(series_source_conditions)}"
                ")"
                if series_enabled else "1=0",
            ]
            if not movie_enabled:
                movie_params = []
            if not series_enabled:
                series_params = []

            if search:
                search_param = f"%{search.lower()}%"
                if movie_enabled:
                    where_conditions[0] += " AND LOWER(movies.name) LIKE %s"
                    movie_params.append(search_param)
                if series_enabled:
                    where_conditions[1] += " AND LOWER(series.name) LIKE %s"
                    series_params.append(search_param)

            params = movie_params + series_params

            # Use UNION ALL with ORDER BY and LIMIT/OFFSET for true unified pagination
            # This is much more efficient than Python sorting
            sql = f"""
            WITH unified_content AS (
                SELECT
                    movies.id,
                    movies.uuid,
                    movies.name,
                    movies.description,
                    movies.year,
                    movies.rating,
                    movies.genre,
                    movies.duration_secs as duration,
                    movies.created_at,
                    movies.updated_at,
                    movies.custom_properties,
                    movies.logo_id,
                    logo.name as logo_name,
                    logo.url as logo_url,
                    'movie' as content_type
                FROM vod_movie movies
                LEFT JOIN vod_vodlogo logo ON movies.logo_id = logo.id
                WHERE {where_conditions[0]}

                UNION ALL

                SELECT
                    series.id,
                    series.uuid,
                    series.name,
                    series.description,
                    series.year,
                    series.rating,
                    series.genre,
                    NULL as duration,
                    series.created_at,
                    series.updated_at,
                    series.custom_properties,
                    series.logo_id,
                    logo.name as logo_name,
                    logo.url as logo_url,
                    'series' as content_type
                FROM vod_series series
                LEFT JOIN vod_vodlogo logo ON series.logo_id = logo.id
                WHERE {where_conditions[1]}
            )
            SELECT * FROM unified_content
            ORDER BY LOWER(name), id
            LIMIT %s OFFSET %s
            """

            params.extend([page_size, offset])

            with connection.cursor() as cursor:
                cursor.execute(sql, params)
                columns = [col[0] for col in cursor.description]
                results = []

                for row in cursor.fetchall():
                    item_dict = dict(zip(columns, row))

                    # Build logo object in the format expected by frontend
                    logo_data = None
                    if item_dict['logo_id']:
                        logo_data = {
                            'id': item_dict['logo_id'],
                            'name': item_dict['logo_name'],
                            'url': item_dict['logo_url'],
                            'cache_url': vodlogo_cache_url(
                                request,
                                SimpleNamespace(
                                    id=item_dict['logo_id'],
                                    url=item_dict['logo_url'],
                                ),
                            ),
                            'movie_count': 0,  # We don't calculate this in raw SQL
                            'series_count': 0,  # We don't calculate this in raw SQL
                            'is_used': True
                        }

                    # Convert to the format expected by frontend
                    formatted_item = {
                        'id': item_dict['id'],
                        'uuid': str(item_dict['uuid']),
                        'name': item_dict['name'],
                        'description': item_dict['description'] or '',
                        'year': item_dict['year'],
                        'rating': float(item_dict['rating']) if item_dict['rating'] else 0.0,
                        'genre': item_dict['genre'] or '',
                        'duration': item_dict['duration'],
                        'created_at': item_dict['created_at'].isoformat() if item_dict['created_at'] else None,
                        'updated_at': item_dict['updated_at'].isoformat() if item_dict['updated_at'] else None,
                        'custom_properties': item_dict['custom_properties'] or {},
                        'logo': logo_data,
                        'content_type': item_dict['content_type']
                    }
                    results.append(formatted_item)

            # Add technical source summaries with two bounded relation queries
            # for the current page.  This keeps the unified list free of N+1
            # lookups even when a title has several source editions.
            from collections import defaultdict
            from .metadata import summarize_relation_metadata
            from .policies import enabled_category_map

            movie_ids = [
                item["id"] for item in results
                if item["content_type"] == "movie"
            ]
            series_ids = [
                item["id"] for item in results
                if item["content_type"] == "series"
            ]
            relations_by_content = defaultdict(list)
            edition_counts = defaultdict(int)
            if movie_ids:
                for relation in M3UMovieRelation.objects.filter(
                    _filtered_vod_relation_query(list_filters, "movie"),
                    movie_id__in=movie_ids,
                ).select_related("source_asset"):
                    relations_by_content[("movie", relation.movie_id)].append(
                        relation
                    )
                    edition_counts[("movie", relation.movie_id)] += 1
            if series_ids:
                for relation in M3USeriesRelation.objects.filter(
                    _filtered_vod_relation_query(list_filters, "series"),
                    series_id__in=series_ids,
                ).select_related("source_asset"):
                    relations_by_content[("series", relation.series_id)].append(
                        relation
                    )
                    edition_counts[("series", relation.series_id)] += 1
                # Series container formats and learned technical metadata live
                # on concrete episode sources. One page-bounded query folds
                # those values into the series row without an N+1 lookup.
                for relation in M3UEpisodeRelation.objects.filter(
                    _filtered_vod_relation_query(list_filters, "episode"),
                    episode__series_id__in=series_ids,
                ).select_related("episode", "source_asset", "series_relation"):
                    relations_by_content[
                        ("series", relation.episode.series_id)
                    ].append(relation)
            category_mapping = enabled_category_map()
            for item in results:
                key = (item["content_type"], item["id"])
                item["source_metadata"] = summarize_relation_metadata(
                    relations_by_content[key],
                    category_mapping,
                )
                # A series edition is one provider/category series relation,
                # not every episode source used to summarize its formats.
                item["source_count"] = edition_counts[key]
                item["source_metadata"]["source_count"] = edition_counts[key]

            # Get total count estimate (for pagination info)
            # Use a separate efficient count query
            count_sql = f"""
            SELECT COUNT(*) FROM (
                SELECT 1 FROM vod_movie movies WHERE {where_conditions[0]}
                UNION ALL
                SELECT 1 FROM vod_series series WHERE {where_conditions[1]}
            ) as total_count
            """

            count_params = params[:-2]  # Remove LIMIT and OFFSET params

            with connection.cursor() as cursor:
                cursor.execute(count_sql, count_params)
                total_count = cursor.fetchone()[0]

            response_data = {
                'count': total_count,
                'next': offset + page_size < total_count,
                'previous': page_number > 1,
                'results': results
            }

            return Response(response_data)

        except Exception as e:
            logger.error(f"Error in UnifiedContentViewSet.list(): {e}")
            import traceback
            logger.error(traceback.format_exc())
            return Response({'error': str(e)}, status=500)


class VODLogoPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = "page_size"
    max_page_size = 1000


class VODLogoViewSet(viewsets.ModelViewSet):
    """ViewSet for VOD Logo management"""
    queryset = VODLogo.objects.all()
    serializer_class = VODLogoSerializer
    pagination_class = VODLogoPagination
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['name', 'url']
    ordering_fields = ['name', 'id']
    ordering = ['name']

    def get_permissions(self):
        try:
            return [perm() for perm in permission_classes_by_action[self.action]]
        except KeyError:
            if self.action == 'cache':
                return [AllowAny()]
            return [Authenticated()]

    def get_queryset(self):
        """Optimize queryset with prefetch and add filtering"""
        queryset = VODLogo.objects.prefetch_related('movie', 'series').order_by('name')

        # Filter by specific IDs
        ids = self.request.query_params.getlist('ids')
        if ids:
            try:
                id_list = [int(id_str) for id_str in ids if id_str.isdigit()]
                if id_list:
                    queryset = queryset.filter(id__in=id_list)
            except (ValueError, TypeError):
                queryset = VODLogo.objects.none()

        # Filter by usage
        used_filter = self.request.query_params.get('used', None)
        if used_filter == 'true':
            # Return logos that are used by movies OR series
            queryset = queryset.filter(
                Q(movie__isnull=False) | Q(series__isnull=False)
            ).distinct()
        elif used_filter == 'false':
            # Return logos that are NOT used by either
            queryset = queryset.filter(
                movie__isnull=True,
                series__isnull=True
            )
        elif used_filter == 'movies':
            # Return logos that are used by movies (may also be used by series)
            queryset = queryset.filter(movie__isnull=False).distinct()
        elif used_filter == 'series':
            # Return logos that are used by series (may also be used by movies)
            queryset = queryset.filter(series__isnull=False).distinct()


        # Filter by name
        name_query = self.request.query_params.get('name', None)
        if name_query:
            queryset = queryset.filter(name__icontains=name_query)

        # No pagination mode
        if self.request.query_params.get('no_pagination', 'false').lower() == 'true':
            self.pagination_class = None

        return queryset

    @action(detail=True, methods=["get"], permission_classes=[AllowAny])
    def cache(self, request, pk=None):
        """Streams the VOD logo file, whether it's local or remote."""
        logo = self.get_object()
        return serve_vod_image(logo.url)

    @action(detail=False, methods=["delete"], url_path="bulk-delete")
    def bulk_delete(self, request):
        """Delete multiple VOD logos at once"""
        logo_ids = request.data.get('logo_ids', [])

        if not logo_ids:
            return Response(
                {"error": "No logo IDs provided"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # Get logos to delete
            logos = VODLogo.objects.filter(id__in=logo_ids)
            deleted_count = logos.count()

            # Delete them
            logos.delete()

            return Response({
                "deleted_count": deleted_count,
                "message": f"Successfully deleted {deleted_count} VOD logo(s)"
            })
        except Exception as e:
            logger.error(f"Error during bulk VOD logo deletion: {str(e)}")
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=["post"])
    def cleanup(self, request):
        """Delete all VOD logos that are not used by any movies or series"""
        try:
            # Find unused logos
            unused_logos = VODLogo.objects.filter(
                movie__isnull=True,
                series__isnull=True
            )

            deleted_count = unused_logos.count()
            logo_names = list(unused_logos.values_list('name', flat=True))

            # Delete them
            unused_logos.delete()

            logger.info(f"Cleaned up {deleted_count} unused VOD logos: {logo_names}")

            return Response({
                "deleted_count": deleted_count,
                "deleted_logos": logo_names,
                "message": f"Successfully deleted {deleted_count} unused VOD logo(s)"
            })
        except Exception as e:
            logger.error(f"Error during VOD logo cleanup: {str(e)}")
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
