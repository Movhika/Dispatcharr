"""Source-aware VOD list builders and membership helpers."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, time

from django.db import models, transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from core.models import CoreSettings

from .models import (
    M3UMovieRelation,
    M3USeriesRelation,
    Movie,
    Series,
    VODList,
    VODListItem,
    VODListSourceMembership,
    VODPolicyList,
)
from .policies import (
    _canonical_content_filter_matches,
    _canonical_filter_metadata,
    _stream_filter_metadata_matches,
    enabled_category_map,
    relation_metadata,
)


def _aware_datetime(value, *, end=False):
    if not value:
        return None
    parsed = parse_datetime(str(value))
    if parsed is None:
        day = parse_date(str(value))
        if day is None:
            return None
        parsed = datetime.combine(day, time.max if end else time.min)
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def _age_number(value):
    match = re.search(r"\d+", str(value or ""))
    return int(match.group(0)) if match else None


def dynamic_rule_matches(relation, rule, category_mapping):
    """Match one relation against a combined canonical/source list rule."""
    if not isinstance(rule, dict) or rule.get("enabled", True) is False:
        return False
    canonical = _canonical_filter_metadata(relation)
    if not _canonical_content_filter_matches(rule, canonical):
        return False
    metadata = relation_metadata(
        relation,
        category_mapping.get((relation.m3u_account_id, relation.category_id)),
    )
    if not _stream_filter_metadata_matches(rule, metadata):
        return False

    content = relation.movie if hasattr(relation, "movie_id") else relation.series
    added_after = _aware_datetime(rule.get("library_added_after"))
    added_before = _aware_datetime(rule.get("library_added_before"), end=True)
    added_at = getattr(content, "library_added_at", None)
    if added_after and (not added_at or added_at < added_after):
        return False
    if added_before and (not added_at or added_at > added_before):
        return False

    release_after = parse_date(str(rule.get("release_date_after") or ""))
    release_before = parse_date(str(rule.get("release_date_before") or ""))
    release_date = parse_date(str(canonical.get("release_date") or ""))
    if release_after and (not release_date or release_date < release_after):
        return False
    if release_before and (not release_date or release_date > release_before):
        return False

    required_watch_providers = {
        str(value).strip().casefold()
        for value in rule.get("required_watch_providers") or []
        if str(value).strip()
    }
    if required_watch_providers:
        available_watch_providers = {
            str(value).strip().casefold()
            for value in canonical.get("watch_providers") or []
            if str(value).strip()
        }
        if required_watch_providers.isdisjoint(available_watch_providers):
            return False

    maximum_age = rule.get("max_age_rating")
    if maximum_age not in (None, "", 0, "0"):
        try:
            maximum_age = int(maximum_age)
        except (TypeError, ValueError):
            return False
        observed = [
            number
            for number in map(_age_number, canonical.get("age_ratings") or [])
            if number is not None
        ]
        if not observed or min(observed) > maximum_age:
            return False

    title_pattern = str(rule.get("title_regex") or "").strip()
    if title_pattern:
        try:
            flags = 0 if rule.get("case_sensitive") else re.IGNORECASE
            if not re.search(
                title_pattern,
                content.display_name or content.clean_title or content.name,
                flags,
            ):
                return False
        except re.error:
            return False
    return True


def _publish_relation_matches(vod_list, matches):
    """Atomically publish {content type: {canonical id: relation IDs}}."""
    with transaction.atomic():
        vod_list = VODList.objects.select_for_update().get(pk=vod_list.pk)
        generation = vod_list.active_generation + 1
        items = []
        specs = []
        position = 0
        for content_type, model in (("movie", Movie), ("series", Series)):
            canonical_map = matches.get(content_type) or {}
            canonicals = {
                row.pk: row
                for row in model.objects.filter(pk__in=canonical_map).select_related(
                    "logo"
                )
            }
            for canonical_id, relation_ids in canonical_map.items():
                canonical = canonicals.get(canonical_id)
                if canonical is None:
                    continue
                item = VODListItem(
                    list=vod_list,
                    generation=generation,
                    content_type=content_type,
                    movie=canonical if content_type == "movie" else None,
                    series=canonical if content_type == "series" else None,
                    include_all_sources=False,
                    title=canonical.display_name or canonical.name,
                    year=canonical.year,
                    position=position,
                )
                items.append(item)
                specs.append((content_type, relation_ids))
                position += 1
        VODListItem.objects.bulk_create(items, batch_size=1000)
        memberships = []
        for item, (content_type, relation_ids) in zip(items, specs):
            memberships.extend(
                VODListSourceMembership(
                    item=item,
                    movie_relation_id=(relation_id if content_type == "movie" else None),
                    series_relation_id=(relation_id if content_type == "series" else None),
                )
                for relation_id in sorted(relation_ids)
            )
        VODListSourceMembership.objects.bulk_create(memberships, batch_size=2000)
        vod_list.active_generation = generation
        vod_list.sync_status = VODList.SyncStatus.COMPLETE
        vod_list.sync_progress = {"processed": len(memberships), "percent": 100}
        vod_list.last_synced_at = timezone.now()
        vod_list.sync_error = ""
        vod_list.save(
            update_fields=[
                "active_generation", "sync_status", "sync_progress",
                "last_synced_at", "sync_error", "updated_at",
            ]
        )
        vod_list.items.exclude(generation=generation).delete()
    return vod_list


def rebuild_dynamic_list(vod_list):
    if vod_list.list_type != VODList.ListType.DYNAMIC:
        raise ValueError("Only metadata-rule lists can be rebuilt this way")
    rules = [rule for rule in (vod_list.rules or []) if isinstance(rule, dict)]
    category_mapping = enabled_category_map()
    matches = {"movie": defaultdict(set), "series": defaultdict(set)}
    types = (
        ("movie", M3UMovieRelation, "movie_id"),
        ("series", M3USeriesRelation, "series_id"),
    )
    for content_type, relation_model, canonical_field in types:
        if vod_list.content_type not in {VODList.ContentType.ALL, content_type}:
            continue
        queryset = relation_model.objects.filter(
            m3u_account__is_active=True,
        ).select_related("m3u_account", "category", content_type)
        for relation in queryset.iterator(chunk_size=2000):
            if any(
                dynamic_rule_matches(relation, rule, category_mapping)
                for rule in rules
            ):
                matches[content_type][getattr(relation, canonical_field)].add(
                    relation.pk
                )
    return _publish_relation_matches(vod_list, matches)


def rebuild_tmdb_list(vod_list):
    """Fetch a TMDB list/trend and retain unavailable items for grey previews."""
    if vod_list.list_type != VODList.ListType.EXTERNAL or vod_list.provider != "tmdb":
        raise ValueError("Only TMDB external lists are supported by this builder")
    token = CoreSettings.get_tmdb_api_token()
    if not token:
        raise ValueError("Configure a TMDB API token first")
    from .tmdb import Client, TMDB_IMAGE_ROOT

    key = str(vod_list.external_key or "").strip()
    paths = {
        "trending-movies": ("trending/movie/week", "movie"),
        "trending-series": ("trending/tv/week", "series"),
        "now-playing": ("movie/now_playing", "movie"),
        "popular-movies": ("movie/popular", "movie"),
        "popular-series": ("tv/popular", "series"),
    }
    configured_type = (
        vod_list.content_type
        if vod_list.content_type in {"movie", "series"}
        else ""
    )
    path, forced_type = paths.get(key, (f"list/{key}", configured_type))
    client = Client(token)
    rows = []
    page = 1
    while page <= 20:
        payload = client.get(path, page=page, language=CoreSettings.get_tmdb_languages()[0])
        page_rows = payload.get("results") or payload.get("items") or []
        rows.extend(row for row in page_rows if isinstance(row, dict))
        if page >= int(payload.get("total_pages") or 1):
            break
        page += 1

    movie_ids = {
        str(row.get("id")) for row in rows
        if (forced_type or row.get("media_type") or "movie") == "movie"
        and row.get("id")
    }
    series_ids = {
        str(row.get("id")) for row in rows
        if (forced_type or row.get("media_type") or "movie") in {"series", "tv"}
        and row.get("id")
    }
    movies = {
        str(row.tmdb_match_id or row.tmdb_id): row
        for row in Movie.objects.filter(
            models.Q(tmdb_match_id__in=movie_ids) | models.Q(tmdb_id__in=movie_ids)
        )
    } if movie_ids else {}
    series = {
        str(row.tmdb_match_id or row.tmdb_id): row
        for row in Series.objects.filter(
            models.Q(tmdb_match_id__in=series_ids) | models.Q(tmdb_id__in=series_ids)
        )
    } if series_ids else {}

    with transaction.atomic():
        vod_list = VODList.objects.select_for_update().get(pk=vod_list.pk)
        generation = vod_list.active_generation + 1
        items = []
        for position, row in enumerate(rows):
            media = forced_type or row.get("media_type") or "movie"
            content_type = "series" if media in {"series", "tv"} else "movie"
            tmdb_id = str(row.get("id") or "")
            canonical = (series if content_type == "series" else movies).get(tmdb_id)
            date_value = row.get("release_date") or row.get("first_air_date") or ""
            year = int(date_value[:4]) if len(date_value) >= 4 and date_value[:4].isdigit() else None
            poster_path = row.get("poster_path") or ""
            items.append(VODListItem(
                list=vod_list,
                generation=generation,
                content_type=content_type,
                movie=canonical if content_type == "movie" else None,
                series=canonical if content_type == "series" else None,
                include_all_sources=canonical is not None,
                external_provider="tmdb",
                external_id=tmdb_id,
                title=row.get("title") or row.get("name") or "",
                year=year,
                poster_url=(f"{TMDB_IMAGE_ROOT}/w342{poster_path}" if poster_path else ""),
                position=position,
                metadata={"popularity": row.get("popularity")},
            ))
        VODListItem.objects.bulk_create(items, batch_size=1000)
        vod_list.active_generation = generation
        vod_list.sync_status = VODList.SyncStatus.COMPLETE
        vod_list.sync_progress = {"processed": len(items), "percent": 100}
        vod_list.last_synced_at = timezone.now()
        vod_list.sync_error = ""
        vod_list.save(update_fields=[
            "active_generation", "sync_status", "sync_progress",
            "last_synced_at", "sync_error", "updated_at",
        ])
        vod_list.items.exclude(generation=generation).delete()
    return vod_list


def policy_list_membership_maps(policy, relation_model):
    """Return selected list order plus exact and all-source membership maps."""
    rules = list(
        VODPolicyList.objects.filter(
            policy=policy,
            enabled=True,
            vod_list__is_enabled=True,
        )
        .select_related("vod_list")
        .order_by("-priority", "id")
    )
    list_ids = [rule.vod_list_id for rule in rules]
    exact = defaultdict(list)
    all_sources = defaultdict(list)
    if not list_ids:
        return rules, exact, all_sources
    is_movie = relation_model is M3UMovieRelation
    content_type = "movie" if is_movie else "series"
    item_rows = VODListItem.objects.filter(
        list_id__in=list_ids,
        content_type=content_type,
    ).filter(generation=models.F("list__active_generation"))
    canonical_field = "movie_id" if is_movie else "series_id"
    for list_id, canonical_id in item_rows.filter(
        include_all_sources=True,
        **{f"{canonical_field}__isnull": False},
    ).values_list("list_id", canonical_field):
        all_sources[canonical_id].append(list_id)
    membership_field = "movie_relation_id" if is_movie else "series_relation_id"
    for list_id, relation_id in VODListSourceMembership.objects.filter(
        item__in=item_rows,
        **{f"{membership_field}__isnull": False},
    ).values_list("item__list_id", membership_field):
        exact[relation_id].append(list_id)
    return rules, exact, all_sources
