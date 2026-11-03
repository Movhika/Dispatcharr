"""Database-side Library filters using the source metadata precedence."""

import calendar
import hashlib
import json
import time
from datetime import date, timedelta

from django.db.models import (
    Case,
    CharField,
    Exists,
    F,
    JSONField,
    OuterRef,
    Q,
    Subquery,
    Value,
    When,
)
from django.db.models.fields.json import KeyTransform, KeyTextTransform
from django.db.models.expressions import RawSQL
from django.db.models.functions import Coalesce
from django.utils import timezone

from .models import M3UEpisodeRelation, M3UVODCategoryRelation, Movie, Series

TECHNICAL_FILTERS = {
    "audio_language": "audio_languages",
    "subtitle_language": "subtitle_languages",
    "resolution": "resolution",
    "video_feature": "video_features",
}


# Anime seasons as they are announced: Winter starts in January.
SEASONS = ("Winter", "Spring", "Summer", "Fall")


def season_start(day, offset=0):
    """First day of the season of ``day``, moved by ``offset`` seasons."""
    index = day.year * 4 + (day.month - 1) // 3 + offset
    return date(index // 4, index % 4 * 3 + 1, 1)


def season_name(day):
    return SEASONS[(day.month - 1) // 3]


def _day_of(year, month_day):
    month, day = map(int, month_day.split("-"))
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def period_window(period, today, from_day=None, until_day=None):
    """First and last day of the week, month, season or year of ``today``.

    A yearly day range such as 12-01 to 01-06 may span the turn of the year;
    it is the latest occurrence that has started by today.
    """
    if period == "week":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if period == "month":
        return today.replace(day=1), today.replace(
            day=calendar.monthrange(today.year, today.month)[1]
        )
    if period == "season":
        return season_start(today), season_start(today, 1) - timedelta(days=1)
    if period == "year":
        return date(today.year, 1, 1), date(today.year, 12, 31)
    year = today.year if _day_of(today.year, from_day) <= today else today.year - 1
    start = _day_of(year, from_day)
    end = _day_of(year, until_day)
    return start, end if end >= start else _day_of(year + 1, until_day)


def date_window(filters, prefix, today):
    """First and last day a date filter allows; None leaves a side open."""
    period = filters.get(f"{prefix}_period")
    if period:
        # A chosen week, month, season or year stays; else the current one.
        anchor = filters.get(f"{prefix}_period_anchor") if period != "yearly" else None
        return period_window(
            period,
            anchor or today,
            filters.get(f"{prefix}_from_day"),
            filters.get(f"{prefix}_until_day"),
        )
    return filters.get(f"{prefix}_since"), filters.get(f"{prefix}_until")


def date_conflict(filters, today):
    """Whether Released starts after the Added period ends: nothing can match.

    A title reaches the Library at its release at the earliest.
    """
    if not any(
        filters.get(f"added_{key}")
        for key in ("since", "until", "after_days", "period")
    ):
        return False
    added = date_window(filters, "added", today)
    if filters.get("added_after_days"):
        added = narrowed(added, filters["added_after_days"], today)
    released = date_window(filters, "released", today)
    if filters.get("released_last_days"):
        released = narrowed(released, filters["released_last_days"], today)
    return bool(released[0]) and released[0] > (added[1] or today)


def narrowed(window, days, today):
    """A window limited to the last ``days`` days up to today."""
    since, until = window
    start = today - timedelta(days=days - 1)
    return max(filter(None, (since, start))), min(filter(None, (until, today)))


def _age_rating_titles(kind, maximum, country=None):
    """IDs of titles whose numeric age rating is at most ``maximum``.

    With a country only its TMDB rating counts (FSK for DE). Otherwise the
    lowest rating of any country counts, else the single rating, else the
    provider's age; text ratings such as R or TV-MA have no number.
    """
    table = (Movie if kind == "movie" else Series)._meta.db_table
    first_number = "substring({} from '[0-9]+')::int <= %s"
    if country:
        return RawSQL(
            f"SELECT c.id FROM {table} c WHERE "
            + first_number.format("c.tmdb_metadata->'age_ratings'->>%s"),
            [country, maximum],
        )
    sql = (
        f"SELECT c.id FROM {table} c WHERE EXISTS (SELECT 1 FROM jsonb_each_text("
        "CASE WHEN jsonb_typeof(c.tmdb_metadata->'age_ratings') = 'object' "
        "THEN c.tmdb_metadata->'age_ratings' ELSE '{}'::jsonb END) r WHERE "
        + first_number.format("r.value")
        + ") OR "
        + first_number.format("c.tmdb_metadata->>'age_rating'")
        + " OR (NOT c.tmdb_metadata ? 'age_rating' AND "
        + first_number.format("c.custom_properties->>'age'")
        + ")"
    )
    return RawSQL(sql, [maximum, maximum, maximum])


SOURCE_METADATA_PATHS = (
    "manual_metadata",
    "observed_metadata",
    "declared_metadata",
    "custom_properties__detailed_info",
    "custom_properties__basic_data",
    "custom_properties__info",
)


def own_metadata_value(field, default=None):
    """Resolve a value stored on the source itself, above category defaults."""
    cases = []
    for path in SOURCE_METADATA_PATHS:
        present = Q(**{f"{path}__has_key": field}) & ~Q(**{f"{path}__{field}": None})
        cases.append(When(present, then=KeyTransform(field, F(path))))
    return Case(*cases, default=default, output_field=JSONField())


def metadata_value(field):
    category = M3UVODCategoryRelation.objects.filter(
        m3u_account_id=OuterRef("m3u_account_id"),
        category_id=OuterRef("category_id"),
    ).values(f"metadata_defaults__{field}")[:1]
    return own_metadata_value(field, default=Subquery(category))


def _episode_video(*path):
    values = []
    for keys in (("info", "info"), ("info",), ()):
        expression = "custom_properties"
        for key in (*keys, "video", *path[:-1]):
            expression = KeyTransform(key, expression)
        values.append(KeyTextTransform(path[-1], expression))
    return Coalesce(*values, output_field=CharField())


# Provider episode details describe the video stream of a series source. Some
# providers put the episode poster there instead; video_facts rejects those.
EPISODE_VIDEO = {
    "_height": _episode_video("height"),
    "_width": _episode_video("width"),
    "_codec": _episode_video("codec_name"),
    "_cover": _episode_video("disposition", "attached_pic"),
}


def series_episodes(series_relation):
    """Episode sources of the same provider series, as used by the preview."""
    return M3UEpisodeRelation.objects.filter(
        series_relation=series_relation,
        m3u_account_id=F("series_relation__m3u_account_id"),
        episode__series_id=F("series_relation__series_id"),
    ).annotate(**EPISODE_VIDEO)


def episode_videos(episodes=None):
    """The distinct provider video streams of episodes, with their facts.

    Returns (filter, facts) pairs; each filter matches the episodes annotated
    with EPISODE_VIDEO that report exactly that stream.
    """
    from .library_preview import video_facts

    if episodes is None:
        episodes = M3UEpisodeRelation.objects.annotate(**EPISODE_VIDEO)
    rows = (
        episodes.exclude(_height__isnull=True)
        .order_by()
        .values_list(*EPISODE_VIDEO)
        .distinct()
    )
    result = []
    for row in rows:
        values = dict(zip(EPISODE_VIDEO, row))
        stream = Q(
            **{
                (f"{key}__isnull" if value is None else key): (
                    True if value is None else value
                )
                for key, value in values.items()
            }
        )
        facts = video_facts(
            {
                "height": values["_height"],
                "width": values["_width"],
                "codec_name": values["_codec"],
                "disposition": {"attached_pic": values["_cover"]},
            }
        )
        result.append((stream, facts))
    return result


def video_streams(videos, accept):
    """Filter for the episode video streams whose facts pass accept."""
    match = Q(pk__isnull=True)
    for stream, facts in videos:
        if accept(facts):
            match |= stream
    return match


def series_resolution_match(queryset, value):
    """Match the provider episode resolution unless the source sets its own."""
    own, effective = "_library_own_resolution", "_library_resolution"
    queryset = queryset.annotate(
        **{own: own_metadata_value("resolution"), effective: metadata_value("resolution")}
    )
    episodes = series_episodes(OuterRef("pk"))
    videos = episode_videos()
    inherited = Q(**{f"{own}__isnull": True})
    match = (
        Q(**{own: value})
        | (
            inherited
            & ~Exists(
                episodes.filter(video_streams(videos, lambda facts: facts["resolution"]))
            )
            & Q(**{effective: value})
        )
        | (
            inherited
            & Exists(
                episodes.filter(
                    video_streams(videos, lambda facts: facts["resolution"] == value)
                )
            )
        )
    )
    return queryset.filter(match)


def technical_values(queryset):
    return queryset.annotate(
        **{
            f"_library_{field}": metadata_value(field)
            for field in TECHNICAL_FILTERS.values()
        }
    )


def filter_relations(queryset, kind, filters):
    for parameter, field in TECHNICAL_FILTERS.items():
        value = filters.get(parameter)
        if not value:
            continue
        if field == "resolution" and kind == "series":
            queryset = series_resolution_match(queryset, value)
            continue
        name = f"_library_{field}"
        queryset = queryset.annotate(**{name: metadata_value(field)})
        queryset = queryset.filter(
            **{
                name if field == "resolution" else f"{name}__contains": (
                    value if field == "resolution" else [value]
                )
            }
        )
    if filters.get("container_extension"):
        queryset = (
            queryset.filter(container_extension__iexact=filters["container_extension"])
            if kind == "movie"
            else queryset.none()
        )
    genres = [part.strip() for part in (filters.get("genre") or "").split(",")]
    if any(genres):
        field = f"{kind}__tmdb_metadata"
        matching = Q()
        for genre in filter(None, genres):
            matching |= Q(**{f"{field}__genres__icontains": genre}) | (
                ~Q(**{f"{field}__has_key": "genres"})
                & Q(**{f"{kind}__genre__icontains": genre})
            )
        queryset = queryset.filter(matching)
    keywords = [part.strip() for part in (filters.get("keyword") or "").split(",")]
    if any(keywords):
        matching = Q()
        for keyword in filter(None, keywords):
            matching |= Q(**{f"{kind}__tmdb_metadata__keywords__icontains": keyword})
        queryset = queryset.filter(matching)
    if filters.get("max_age_rating") is not None:
        queryset = queryset.filter(
            **{
                f"{kind}_id__in": _age_rating_titles(
                    kind, filters["max_age_rating"], filters.get("age_rating_country")
                )
            }
        )
    if filters.get("anime_mode"):
        anime = Q(**{f"{kind}__tmdb_metadata__is_anime": True}) & Q(
            **{f"{kind}__tmdb_metadata__is_anime__isnull": False}
        )
        queryset = queryset.filter(anime if filters["anime_mode"] == "only" else ~anime)
    if filters.get("adult_mode"):
        adult = Q(**{f"{kind}__tmdb_metadata__adult": True}) & Q(
            **{f"{kind}__tmdb_metadata__adult__isnull": False}
        )
        if kind == "movie":
            adult |= Q(movie__is_adult=True)
        queryset = queryset.filter(adult if filters["adult_mode"] == "only" else ~adult)
    if filters.get("added_after_days"):
        queryset = queryset.filter(
            **{
                f"{kind}__library_added_at__gte": timezone.now()
                - timedelta(days=filters["added_after_days"])
            }
        )
    today = timezone.localdate()
    added = date_window(filters, "added", today)
    if filters.get("added_after_days"):
        added = narrowed(added, filters["added_after_days"], today)
    for value, lookup in zip(added, ("gte", "lte")):
        if value:
            queryset = queryset.filter(
                **{f"{kind}__library_added_at__date__{lookup}": value}
            )
    released = date_window(filters, "released", today)
    if filters.get("released_last_days"):
        released = narrowed(released, filters["released_last_days"], today)
    if any(released):
        queryset = queryset.annotate(
            _library_release_date=Case(
                When(
                    Q(**{f"{kind}__tmdb_metadata__has_key": "release_date"}),
                    then=KeyTextTransform("release_date", F(f"{kind}__tmdb_metadata")),
                ),
                default=KeyTextTransform(
                    "release_date", F(f"{kind}__custom_properties")
                ),
                output_field=CharField(),
            )
        ).filter(_library_release_date__regex=r"^\d{4}-\d{2}-\d{2}$")
        for value, lookup in zip(released, ("gte", "lte")):
            if value:
                queryset = queryset.filter(
                    **{f"_library_release_date__{lookup}": str(value)}
                )
    return queryset


def episode_resolutions(queryset):
    """Provider episode resolutions of series sources without their own value."""
    inherited = queryset.annotate(_own=own_metadata_value("resolution")).filter(
        _own__isnull=True
    )
    episodes = M3UEpisodeRelation.objects.filter(
        series_relation__in=inherited.values("pk"),
        m3u_account_id=F("series_relation__m3u_account_id"),
        episode__series_id=F("series_relation__series_id"),
    ).annotate(**EPISODE_VIDEO)
    return {
        facts["resolution"]
        for _stream, facts in episode_videos(episodes)
        if facts["resolution"]
    }


def available_values(querysets):
    """Read actual source values once, without N+1 category lookups."""
    values = {field: set() for field in TECHNICAL_FILTERS.values()}
    values.update(container_extensions=set())
    # Only real video streams replace an inherited category resolution.
    real_video = video_streams(episode_videos(), lambda facts: facts["resolution"])
    for kind, queryset in querysets:
        fields = [f"_library_{field}" for field in TECHNICAL_FILTERS.values()]
        series = kind == "series"
        rows = (
            technical_values(queryset)
            .annotate(
                # Provider episode resolutions replace an inherited category value.
                _library_episode_video=(
                    Exists(series_episodes(OuterRef("pk")).filter(real_video))
                    if series
                    else Value(False)
                ),
                _library_own_resolution=own_metadata_value("resolution"),
            )
            .annotate(
                _library_container=(
                    F("container_extension")
                    if kind == "movie"
                    else Value("", output_field=CharField())
                ),
            )
            .values(
                *fields,
                "_library_container",
                "_library_episode_video",
                "_library_own_resolution",
            )
        )
        for row in rows.iterator(chunk_size=1000):
            episode_values = (
                row["_library_episode_video"] and row["_library_own_resolution"] is None
            )
            for field in TECHNICAL_FILTERS.values():
                if field == "resolution" and episode_values:
                    continue
                value = row[f"_library_{field}"]
                items = (
                    [value]
                    if field == "resolution"
                    else value if isinstance(value, list) else []
                )
                values[field].update(
                    item for item in items if isinstance(item, str) and item
                )
            if row["_library_container"]:
                values["container_extensions"].add(row["_library_container"].lower())
        if series:
            values["resolution"].update(episode_resolutions(queryset))
    return {field: sorted(items, key=str.casefold) for field, items in values.items()}


OPTIONS_VERSION_KEY = "vod_library_options_version"
OPTIONS_CACHE_SECONDS = 24 * 60 * 60
WARM_KEY = "vod_library_options_warm"
WARM_DELAY_SECONDS = 30


def changed_options():
    """Imports, category metadata and Library edits change which values exist.

    The common choices are collected again in the background, so the next
    visitor does not wait for them.
    """
    from django.core.cache import cache
    from django.db import transaction

    cache.set(OPTIONS_VERSION_KEY, time.time_ns(), timeout=None)
    # One run covers every change until it starts.
    if cache.add(WARM_KEY, True, timeout=WARM_DELAY_SECONDS + 600):
        from .tasks import warm_library_options

        transaction.on_commit(
            lambda: warm_library_options.apply_async(countdown=WARM_DELAY_SECONDS)
        )


def cached_options(key, build):
    """Filter values take seconds to collect from every source; reuse them
    until something changes them."""
    from django.core.cache import cache

    version = cache.get_or_set(OPTIONS_VERSION_KEY, time.time_ns, timeout=None)
    digest = hashlib.sha256(
        json.dumps(key, sort_keys=True, default=str).encode()
    ).hexdigest()
    return cache.get_or_set(
        f"vod_library_options:{version}:{digest}", build, timeout=OPTIONS_CACHE_SECONDS
    )


def option_filters(data):
    """The filters that decide filter values, read like a Library request."""
    from rest_framework.exceptions import ValidationError

    from .library_serializers import LibraryFilterSerializer

    serializer = LibraryFilterSerializer(data=data)
    if not serializer.is_valid():
        raise ValidationError(serializer.errors)
    return {
        key: value
        for key, value in serializer.validated_data.items()
        if key in {"type", "account", "category"}
    }


def option_values(filters, allowed):
    """Values present in the sources the filters choose, shared by every caller."""
    from apps.m3u.models import M3UAccount

    from . import library

    active = sorted(M3UAccount.objects.filter(is_active=True).values_list("pk", flat=True))
    return cached_options(
        [filters, allowed, active],
        lambda: available_values(
            (kind, library.relation_queryset(kind, filters))
            for kind in allowed
            if filters.get("type", "all") in {"all", kind}
        ),
    )
