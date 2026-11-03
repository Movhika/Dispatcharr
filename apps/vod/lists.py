"""Curated VOD lists that profiles can offer as client categories.

Manual lists are filled from the Library, rules lists are saved Library
filters and TMDB lists follow a TMDB chart, a TMDB list, a streaming service
or a discover query. Lists only
choose titles; the profile decides which source of a title a client gets.
"""

import hashlib
import json
import time

from django.db import transaction
from django.db.models import Case, CharField, F, IntegerField, Q, When
from django.db.models.fields.json import KeyTextTransform
from django.utils import timezone

from .library_filters import season_name
from .models import Movie, Series, VODList, VODListItem

# Client category IDs of list output, as on the original installation.
LIST_CATEGORY_BASE = 1_000_000_000
UNSORTED_CATEGORY_ID = LIST_CATEGORY_BASE
UNSORTED_NAME = "Unsorted"
# Manual lists are picked by hand; rules lists hold every matching title.
MAX_ITEMS = 10000
MAX_TMDB_PAGES = 25
PREVIEW_ITEMS = 24
TITLE_MODELS = {"movie": Movie, "series": Series}
# TMDB sources and the list content they serve; the list's content chooses
# between movies, series or both.
TMDB_SOURCES = {
    "trending": ("all", "movie", "series"),
    "popular": ("movie", "series"),
    "now-playing": ("movie",),
    "list": ("all", "movie", "series"),
    "watch-provider": ("movie", "series"),
    "discover": ("movie", "series"),
}
TMDB_MEDIA = {"all": "all", "movie": "movie", "series": "tv"}
MONETIZATION = ("flatrate", "free", "ads", "rent", "buy")
# TMDB's keyword for anime, used by the Anime switch of discover lists.
TMDB_ANIME_KEYWORD = "210024"
RELEASE_MODES = ("range", "days", "week", "month", "season", "year", "yearly")
# Library filters a list does not store: they shape the Library view, or the
# file data the profile chooses sources by.
RULES_IGNORED = (
    "type",
    "view",
    "content_id",
    "audio_language",
    "subtitle_language",
    "resolution",
    "video_feature",
    "container_extension",
)


def list_category_id(list_id):
    return LIST_CATEGORY_BASE + int(list_id)


def category_list_id(category_id):
    """The list of a client category ID, 0 for Unsorted, None for others."""
    try:
        value = int(category_id)
    except (TypeError, ValueError):
        return None
    return value - LIST_CATEGORY_BASE if value >= LIST_CATEGORY_BASE else None


def content_types(vod_list):
    if vod_list.content_type == VODList.ContentType.ALL:
        return ("movie", "series")
    return (vod_list.content_type,)


def display_name(vod_list, today=None):
    """The client name with {year} and {season} of the current anime season."""
    today = today or timezone.localdate()
    return vod_list.name.replace("{year}", str(today.year)).replace(
        "{season}", season_name(today)
    )


def is_visible(vod_list, today=None):
    """Whether clients see the list today; a period may span the year end."""
    if not vod_list.is_enabled:
        return False
    start, end = vod_list.visible_from, vod_list.visible_until
    if not (start and end):
        return True
    day = (today or timezone.localdate()).strftime("%m-%d")
    return start <= day <= end if start <= end else day >= start or day <= end


def rules_filters(filters, content_type):
    """Validated Library filters of a rules list for one content type."""
    from .library_serializers import LibraryFilterSerializer

    data = {
        key: value
        for key, value in (filters or {}).items()
        if key not in RULES_IGNORED and value not in ("", None)
    }
    serializer = LibraryFilterSerializer(data={**data, "type": content_type})
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def stored_filters(filters):
    """Library filters as a rules list stores them, after validation."""
    from .library_serializers import LibraryFilterSerializer

    data = {
        key: value
        for key, value in (filters or {}).items()
        if key not in RULES_IGNORED and value not in ("", None)
    }
    serializer = LibraryFilterSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    return {
        key: value
        for key, value in LibraryFilterSerializer(serializer.validated_data).data.items()
        if key in data
    }


# Library filters whose matches move on with the date.
def follows_date(filters):
    """Whether Library filters cover the last days or the current period."""
    return any(
        filters.get(f"{prefix}_{days}")
        or (filters.get(f"{prefix}_period") and not filters.get(f"{prefix}_period_anchor"))
        for prefix, days in (("added", "after_days"), ("released", "last_days"))
    )


def dated(vod_list, today=None):
    """Whether a rules list follows the date and was not built today."""
    if vod_list.list_type != VODList.ListType.RULES or not follows_date(
        vod_list.filters or {}
    ):
        return False
    today = today or timezone.localdate()
    return not vod_list.built_at or timezone.localtime(vod_list.built_at).date() < today


def revealed(vod_list, today=None):
    """Whether a scheduled TMDB list became visible since its last download.

    Scheduled downloads pause while a list is hidden, so it is downloaded once
    when its visible period starts.
    """
    if vod_list.list_type != VODList.ListType.TMDB or not (
        vod_list.refresh_interval or vod_list.cron_expression
    ):
        return False
    today = today or timezone.localdate()
    if not is_visible(vod_list, today):
        return False
    return not vod_list.built_at or not is_visible(
        vod_list, timezone.localtime(vod_list.built_at).date()
    )


def build_list(vod_list, *, fetch=True):
    """Rebuild the items of a rules or TMDB list and refresh its counts.

    Without fetch, TMDB lists only link their items to titles that reached the
    Library since the last download.
    """
    started = time.monotonic()
    VODList.objects.filter(pk=vod_list.pk).update(
        build_status=VODList.BuildStatus.BUILDING, build_error=""
    )
    try:
        if vod_list.list_type == VODList.ListType.RULES:
            _replace_items(vod_list, _rules_rows(vod_list))
        elif vod_list.list_type == VODList.ListType.TMDB:
            rows = (
                _tmdb_rows(vod_list)
                if fetch or not vod_list.built_at
                else _stored_rows(vod_list)
            )
            _replace_items(vod_list, _link(rows))
    except Exception as error:
        VODList.objects.filter(pk=vod_list.pk).update(
            build_status=VODList.BuildStatus.FAILED, build_error=str(error)[:500]
        )
        raise
    vod_list.build_status = VODList.BuildStatus.READY
    vod_list.build_counts = {
        **_counts(vod_list),
        "seconds": round(time.monotonic() - started, 1),
    }
    vod_list.built_at = timezone.now()
    VODList.objects.filter(pk=vod_list.pk).update(
        build_status=vod_list.build_status,
        build_counts=vod_list.build_counts,
        built_at=vod_list.built_at,
    )
    return vod_list.build_counts


# List categories are ordered at output time; cached client lists follow this.
OUTPUT_VERSION_KEY = "vod_lists_output_version"


def changed_lists():
    """Start new cached client lists after a list or its order changed."""
    from django.core.cache import cache

    cache.set(OUTPUT_VERSION_KEY, time.time_ns(), timeout=None)


def refresh_profiles(vod_list):
    """Queue rebuilds of the active profiles whose output this list changes."""
    from .profile_catalog import refresh_catalog

    changed_lists()
    for profile in vod_list.profiles.filter(is_active=True, output_groups="lists"):
        refresh_catalog(profile)


def _rules_rows(vod_list):
    from .library import relation_queryset

    rows = []
    for content_type in content_types(vod_list):
        filters = rules_filters(vod_list.filters, content_type)
        # In Library order, by the stored canonical title.
        titles = dict.fromkeys(
            relation_queryset(content_type, filters)
            .order_by(f"{content_type}__sort_title", f"{content_type}_id")
            .values_list(f"{content_type}_id", flat=True)
        )
        rows.extend(
            {"content_type": content_type, "content_id": content_id}
            for content_id in titles
        )
    return rows


def _tmdb_request(vod_list):
    """TMDB path, content type and query options of a TMDB list."""
    source = vod_list.tmdb_source
    settings = vod_list.tmdb_settings or {}
    media = TMDB_MEDIA[vod_list.content_type]
    if source == "trending":
        content_type = None if vod_list.content_type == "all" else vod_list.content_type
        return f"trending/{media}/week", content_type, {}
    if source == "popular":
        return f"{media}/popular", vod_list.content_type, {}
    if source == "now-playing":
        return "movie/now_playing", "movie", {}
    if source == "list":
        return f"list/{settings['list_id']}", None, {}
    if source in ("watch-provider", "discover"):
        content_type = vod_list.content_type
        return (
            "discover/movie" if content_type == "movie" else "discover/tv",
            content_type,
            (provider_options if source == "watch-provider" else discover_options)(
                content_type, settings
            ),
        )
    raise ValueError("Choose a TMDB source.")


def provider_options(content_type, settings, today=None):
    """TMDB discover parameters of everything a streaming service offers."""
    return {
        "sort_by": "popularity.desc",
        "watch_region": settings["region"],
        "with_watch_providers": settings["provider_id"],
        "with_watch_monetization_types": settings.get("monetization") or "flatrate",
    }


def release_window(settings, today=None):
    """First and last release day of a discover list, None when open."""
    from datetime import timedelta

    from django.utils.dateparse import parse_date

    from .library_filters import period_window

    today = today or timezone.localdate()
    mode = settings.get("release_mode") or ""
    if mode == "days":
        return today - timedelta(days=int(settings["release_days"]) - 1), today
    if mode == "range":
        return (
            parse_date(settings.get("release_since") or ""),
            parse_date(settings.get("release_until") or ""),
        )
    if mode:
        anchor = parse_date(settings.get("release_anchor") or "")
        return period_window(
            mode,
            anchor if anchor and mode != "yearly" else today,
            settings.get("release_from_day"),
            settings.get("release_until_day"),
        )
    return None, None


def discover_options(content_type, settings, today=None):
    """TMDB discover parameters, most popular first."""
    field = "primary_release_date" if content_type == "movie" else "first_air_date"
    options = {"sort_by": "popularity.desc"}
    start, end = release_window(settings, today)
    if start:
        options[f"{field}.gte"] = start.isoformat()
    if end:
        options[f"{field}.lte"] = end.isoformat()
    if settings.get("genres"):
        options["with_genres"] = "|".join(settings["genres"])
    keywords = [keyword["id"] for keyword in settings.get("keywords") or []]
    if settings.get("anime"):
        keywords.insert(0, TMDB_ANIME_KEYWORD)
    if keywords:
        # TMDB combines IDs with "|" for any of them, "," for all of them;
        # it cannot mix both, so with Anime every keyword applies.
        every = settings.get("keyword_match") == "all" or settings.get("anime")
        options["with_keywords"] = ("," if every else "|").join(keywords)
    if settings.get("original_language"):
        options["with_original_language"] = settings["original_language"]
    return options


def _tmdb_rows(vod_list):
    from .library import library_settings, tmdb_client
    from .tmdb import image_url

    path, content_type, options = _tmdb_request(vod_list)
    client = tmdb_client()
    language = library_settings()["languages"][0]
    wanted = content_types(vod_list)
    rows, seen = [], set()
    page = pages = 1
    while page <= min(pages, MAX_TMDB_PAGES) and len(rows) < MAX_ITEMS:
        payload = client.get(path, page=page, language=language, **options)
        pages = int(payload.get("total_pages") or 1)
        for entry in payload.get("results") or payload.get("items") or []:
            kind = content_type or (
                "series" if entry.get("media_type") == "tv" else "movie"
            )
            if entry.get("media_type") not in (None, "movie", "tv") or kind not in wanted:
                continue
            key = (kind, str(entry.get("id") or ""))
            if not key[1] or key in seen:
                continue
            seen.add(key)
            released = entry.get("release_date") or entry.get("first_air_date") or ""
            rows.append(
                {
                    "content_type": kind,
                    "tmdb_id": key[1],
                    "title": entry.get("title") or entry.get("name") or "",
                    "year": int(released[:4]) if released[:4].isdigit() else None,
                    "poster_url": image_url(entry.get("poster_path"), "w342") or "",
                }
            )
        page += 1
    return rows


def _local_titles(content_type, tmdb_ids):
    """Library titles by TMDB ID; the Library match wins over the provider ID."""
    model = TITLE_MODELS[content_type]
    found = dict(
        model.objects.filter(tmdb_id__in=tmdb_ids)
        .order_by("-pk")
        .values_list("tmdb_id", "pk")
    )
    found.update(
        model.objects.filter(tmdb_match_id__in=tmdb_ids)
        .order_by("-pk")
        .values_list("tmdb_match_id", "pk")
    )
    return found


def _link(rows):
    for content_type in TITLE_MODELS:
        local = _local_titles(
            content_type,
            [row["tmdb_id"] for row in rows if row["content_type"] == content_type],
        )
        taken = set()
        for row in rows:
            if row["content_type"] != content_type:
                continue
            content_id = local.get(row["tmdb_id"])
            # Two TMDB entries never share one Library title.
            row["content_id"] = content_id if content_id not in taken else None
            taken.add(content_id)
    return rows


def _stored_rows(vod_list):
    return [
        {
            "content_type": item.content_type,
            "tmdb_id": item.tmdb_id,
            "title": item.title,
            "year": item.year,
            "poster_url": item.poster_url,
        }
        for item in vod_list.items.order_by("position", "id")
    ]


def _replace_items(vod_list, rows):
    with transaction.atomic():
        vod_list.items.all().delete()
        _create_items(vod_list, rows, start=0)


def _create_items(vod_list, rows, *, start):
    VODListItem.objects.bulk_create(
        [
            VODListItem(
                vod_list=vod_list,
                content_type=row["content_type"],
                movie_id=row.get("content_id") if row["content_type"] == "movie" else None,
                series_id=row.get("content_id") if row["content_type"] == "series" else None,
                tmdb_id=row.get("tmdb_id", ""),
                title=row.get("title", "")[:500],
                year=row.get("year"),
                poster_url=row.get("poster_url", "")[:1000],
                position=start + index,
            )
            for index, row in enumerate(rows)
        ],
        batch_size=1000,
    )


def _counts(vod_list):
    items = vod_list.items.all()
    available = items.filter(Q(movie__isnull=False) | Q(series__isnull=False))
    digest = hashlib.sha256(
        json.dumps(
            [
                list(row)
                for row in available.order_by("position", "id").values_list(
                    "content_type", "movie_id", "series_id"
                )
            ]
        ).encode()
    ).hexdigest()
    return {
        "titles": items.count(),
        "available": available.count(),
        "signature": digest,
    }


def item_document(item, request=None, settings=None):
    """Title, year, poster and availability of an item as the Library shows it."""
    from .library import library_settings, poster_url
    from .presentation import canonical_title

    settings = settings or library_settings()
    content = item.content
    if content is None:
        return {
            "title": item.title,
            "year": item.year,
            "poster_url": item.poster_url,
            "available": False,
        }
    return {
        "title": canonical_title(content, settings["languages"]),
        "year": content.year,
        "poster_url": poster_url(
            request, item.content_type, content, settings["prefer_artwork"]
        )
        or item.poster_url,
        "available": True,
    }


def item_documents(items, request=None, settings=None):
    from .library import library_settings

    settings = settings or library_settings()
    return [
        {
            **item_document(item, request, settings),
            "id": item.pk,
            "content_type": item.content_type,
            "content_id": item.content.pk if item.content else None,
            "tmdb_id": item.tmdb_id,
            "position": item.position,
        }
        for item in items
    ]


def add_items(vod_list, refs):
    """Add Library titles, as (content type, ID), to a manual list in order."""
    with transaction.atomic():
        existing = {
            (item.content_type, item.movie_id or item.series_id): item.position
            for item in vod_list.items.select_for_update()
        }
        rows = [
            {"content_type": content_type, "content_id": content_id}
            for content_type, content_id in dict.fromkeys(refs)
            if (content_type, content_id) not in existing
        ]
        if len(existing) + len(rows) > MAX_ITEMS:
            raise ValueError(f"A list holds at most {MAX_ITEMS} titles.")
        _create_items(vod_list, rows, start=1 + max(existing.values(), default=-1))
    return len(rows)


def reorder_items(vod_list, item_ids):
    """Store a manual order; items left out keep their order after these."""
    items = {item.pk: item for item in vod_list.items.all()}
    ordered = [items.pop(pk) for pk in item_ids if pk in items]
    ordered += sorted(items.values(), key=lambda item: (item.position, item.pk))
    for position, item in enumerate(ordered):
        item.position = position
    VODListItem.objects.bulk_update(ordered, ["position"], batch_size=1000)
    changed_lists()


def ordered_items(vod_list, queryset=None):
    """Items in the list's sort order; unknown dates go last."""
    queryset = vod_list.items.all() if queryset is None else queryset
    if vod_list.sort_mode == VODList.SortMode.RELEASE:
        release = {
            kind: Case(
                When(
                    Q(**{f"{kind}__tmdb_metadata__has_key": "release_date"}),
                    then=KeyTextTransform("release_date", F(f"{kind}__tmdb_metadata")),
                ),
                default=KeyTextTransform("release_date", F(f"{kind}__custom_properties")),
                output_field=CharField(),
            )
            for kind in TITLE_MODELS
        }
        queryset = queryset.annotate(
            _release=Case(
                When(content_type="movie", then=release["movie"]),
                default=release["series"],
                output_field=CharField(),
            ),
            _year=Case(
                When(movie__isnull=False, then=F("movie__year")),
                When(series__isnull=False, then=F("series__year")),
                default=F("year"),
                output_field=IntegerField(),
            ),
        )
        return queryset.order_by(
            F("_release").desc(nulls_last=True),
            F("_year").desc(nulls_last=True),
            "position",
            "id",
        )
    if vod_list.sort_mode == VODList.SortMode.ADDED:
        return queryset.order_by(
            F("movie__library_added_at").desc(nulls_last=True),
            F("series__library_added_at").desc(nulls_last=True),
            "position",
            "id",
        )
    return queryset.order_by("position", "id")


def list_positions(vod_list, content_type):
    """Rank of each Library title in the list's order."""
    items = ordered_items(
        vod_list,
        vod_list.items.filter(
            content_type=content_type,
            **{f"{content_type}__isnull": False},
        ),
    ).values_list(f"{content_type}_id", flat=True)
    return {content_id: index for index, content_id in enumerate(items)}


def profile_list_ids(profile):
    """Ordered list IDs of a profile; previews pass unsaved ones as draft_list_ids."""
    draft = getattr(profile, "draft_list_ids", None)
    if draft is not None:
        return list(draft)
    if not profile.pk:
        return []
    return list(
        profile.list_links.order_by("order", "id").values_list("vod_list_id", flat=True)
    )


def profile_lists(profile, content_type, today=None):
    """The lists a profile shows clients today for one content type, in order."""
    ids = profile_list_ids(profile)
    found = VODList.objects.in_bulk(ids)
    return [
        found[pk]
        for pk in ids
        if pk in found
        and found[pk].content_type in ("all", content_type)
        and is_visible(found[pk], today)
    ]


def profile_memberships(profile, content_type, today=None):
    """The lists of each title, in the profile's list order."""
    lists = profile_lists(profile, content_type, today)
    order = {vod_list.pk: index for index, vod_list in enumerate(lists)}
    members = {}
    for list_id, content_id in VODListItem.objects.filter(
        vod_list__in=lists,
        content_type=content_type,
        **{f"{content_type}__isnull": False},
    ).values_list("vod_list_id", f"{content_type}_id"):
        members.setdefault(content_id, []).append(list_id)
    for list_ids in members.values():
        list_ids.sort(key=order.__getitem__)
    return members


def sync_schedule(vod_list):
    """Create, update or remove the list's refresh task like M3U accounts."""
    from django_celery_beat.models import PeriodicTask

    from core.scheduling import create_or_update_periodic_task, delete_periodic_task

    name = f"vod-list-{vod_list.pk}-refresh"
    # Only TMDB lists need downloading; the others follow the Library.
    if vod_list.list_type != VODList.ListType.TMDB or not (
        vod_list.refresh_interval or vod_list.cron_expression
    ):
        if PeriodicTask.objects.filter(name=name).exists():
            delete_periodic_task(name)
        return
    create_or_update_periodic_task(
        task_name=name,
        celery_task_path="apps.vod.tasks.refresh_vod_list",
        kwargs={"list_id": vod_list.pk, "scheduled": True},
        interval_hours=vod_list.refresh_interval,
        cron_expression=vod_list.cron_expression,
        enabled=vod_list.is_enabled,
    )


def request_list_build(vod_list, *, fetch=True):
    from .tasks import refresh_vod_list

    # Pending at once, so the page follows the build instead of showing old titles.
    VODList.objects.filter(pk=vod_list.pk).update(
        build_status=VODList.BuildStatus.PENDING
    )
    vod_list.build_status = VODList.BuildStatus.PENDING
    transaction.on_commit(
        lambda: refresh_vod_list.apply_async(
            kwargs={"list_id": vod_list.pk, "fetch": fetch}, countdown=2
        )
    )
