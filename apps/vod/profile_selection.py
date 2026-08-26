"""Prepared VOD profile selections used by XC output and profile previews."""

import logging
import uuid
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .catalog_cache import selection_catalog_generation
from .models import (
    M3UMovieRelation,
    M3USeriesRelation,
    VODAccessPolicy,
    VODMovieProfileSelection,
    VODSeriesProfileSelection,
)
from .metadata import normalize_source_metadata
from .policies import (
    _vertical_resolution,
    allowed_category_query,
    policy_category_map,
    relation_metadata,
    select_relation_ids_for_policy,
)

logger = logging.getLogger(__name__)
BUILD_CHUNK_SIZE = 5000
PROGRESS_SCAN_INTERVAL = 5000
PROFILE_REBUILD_ENQUEUE_KEY = "vod_profile_selection:rebuild-all-enqueued"


class CatalogChangedDuringBuild(RuntimeError):
    pass


class ProfileBuildAlreadyRunning(RuntimeError):
    pass


def _progress_payload(phase, percent, **details):
    return {
        "phase": phase,
        "percent": max(0, min(int(percent), 100)),
        "updated_at": timezone.now().isoformat(),
        **{key: value for key, value in details.items() if value is not None},
    }


def _set_profile_progress(policy_id, phase, percent, **details):
    """Persist coarse build progress without firing policy invalidation signals."""
    VODAccessPolicy.objects.filter(pk=policy_id).update(
        selection_progress=_progress_payload(phase, percent, **details)
    )


def enqueue_profile_selection_rebuild(policy_id):
    """Mark a profile stale and enqueue its build after the transaction."""
    updated = VODAccessPolicy.objects.filter(
        pk=policy_id,
        is_active=True,
    ).exclude(
        selection_status=VODAccessPolicy.SelectionStatus.BUILDING,
    ).update(
        selection_status=VODAccessPolicy.SelectionStatus.PENDING,
        selection_started_at=timezone.now(),
        selection_error="",
        selection_progress=_progress_payload(
            "Publishing background task", 0, queue="celery"
        ),
    )
    if not updated:
        return False

    def enqueue():
        from .tasks import rebuild_vod_profile_selection

        try:
            result = rebuild_vod_profile_selection.delay(policy_id)
            queued_at = timezone.now().isoformat()
            VODAccessPolicy.objects.filter(
                pk=policy_id,
                selection_status=VODAccessPolicy.SelectionStatus.PENDING,
            ).update(
                selection_progress=_progress_payload(
                    "Waiting in Celery queue",
                    0,
                    queue="celery",
                    task_id=result.id,
                    queued_at=queued_at,
                )
            )
        except Exception as exc:
            logger.exception(
                "Could not enqueue VOD profile selection %s", policy_id
            )
            VODAccessPolicy.objects.filter(
                pk=policy_id,
                selection_status=VODAccessPolicy.SelectionStatus.PENDING,
            ).update(
                selection_status=VODAccessPolicy.SelectionStatus.FAILED,
                selection_error=str(exc)[:2000],
                selection_progress=_progress_payload(
                    "Could not publish background task", 100, queue="celery"
                ),
                selection_completed_at=timezone.now(),
            )

    transaction.on_commit(enqueue)
    return True


def enqueue_all_profile_selection_rebuilds(*, pending_only=False):
    """Enqueue one debounced rebuild task for active profiles.

    Normal catalog invalidations mark every ready profile pending. Incremental
    metadata updates use ``pending_only`` so an already-stranded pending
    profile can be republished without invalidating profiles that were updated
    synchronously.
    """
    queued_progress = _progress_payload("Waiting for worker", 0)
    newly_pending = 0
    if not pending_only:
        newly_pending = VODAccessPolicy.objects.filter(is_active=True).exclude(
            selection_status__in=(
                VODAccessPolicy.SelectionStatus.PENDING,
                VODAccessPolicy.SelectionStatus.BUILDING,
            ),
        ).update(
            selection_status=VODAccessPolicy.SelectionStatus.PENDING,
            selection_started_at=timezone.now(),
            selection_error="",
            selection_progress=queued_progress,
        )
    # Repeated catalog invalidations are common when one UI operation updates
    # several related source rows.  A pending worker reads the latest catalog
    # generation when it starts, while an active build detects a changed
    # generation and retries itself.  Resetting either state here would erase
    # its task/progress metadata and could publish duplicate recovery work.
    pending_exists = VODAccessPolicy.objects.filter(
        is_active=True,
        selection_status=VODAccessPolicy.SelectionStatus.PENDING,
    ).exists()
    if not newly_pending and not pending_exists:
        return False

    def enqueue():
        from django.core.cache import cache
        from .tasks import rebuild_all_vod_profile_selections

        try:
            acquired = cache.add(
                PROFILE_REBUILD_ENQUEUE_KEY,
                "1",
                timeout=60,
            )
        except Exception:
            acquired = True
        if not acquired:
            return
        try:
            result = rebuild_all_vod_profile_selections.delay()
            VODAccessPolicy.objects.filter(
                is_active=True,
                selection_status=VODAccessPolicy.SelectionStatus.PENDING,
            ).update(
                selection_progress=_progress_payload(
                    "Waiting in Celery queue",
                    0,
                    queue="celery",
                    task_id=result.id,
                    queued_at=timezone.now().isoformat(),
                    batch=True,
                )
            )
        except Exception as exc:
            try:
                cache.delete(PROFILE_REBUILD_ENQUEUE_KEY)
            except Exception:
                pass
            logger.exception("Could not enqueue all VOD profile selections")
            VODAccessPolicy.objects.filter(
                is_active=True,
                selection_status=VODAccessPolicy.SelectionStatus.PENDING,
            ).update(
                selection_status=VODAccessPolicy.SelectionStatus.FAILED,
                selection_error=str(exc)[:2000],
                selection_progress=_progress_payload(
                    "Could not publish background task", 100, queue="celery"
                ),
                selection_completed_at=timezone.now(),
            )

    transaction.on_commit(enqueue)
    return True


def _selection_rows_for_canonical_ids(
    policy,
    generation,
    relation_model,
    selection_model,
    canonical_field,
    canonical_ids,
):
    """Prepare selected rows for a small set of canonical titles."""
    if not canonical_ids:
        return []
    category_mapping = policy_category_map(policy)
    candidates = (
        relation_model.objects.filter(
            m3u_account__is_active=True,
            **{f"{canonical_field}__in": canonical_ids},
        )
        .filter(allowed_category_query(policy))
        .select_related("m3u_account", "source_asset")
        .order_by("pk")
    )
    selected_ids = select_relation_ids_for_policy(
        candidates.iterator(chunk_size=500),
        policy,
        canonical_field,
    )
    relations = relation_model.objects.filter(pk__in=selected_ids).select_related(
        "source_asset"
    )
    rows = []
    for relation in relations:
        metadata = relation_metadata(
            relation,
            category_mapping.get(
                (relation.m3u_account_id, relation.category_id)
            ),
        )
        rows.append(
            selection_model(
                policy=policy,
                generation=generation,
                relation=relation,
                category_id=relation.category_id,
                **{canonical_field: getattr(relation, canonical_field)},
                **_metadata_columns(metadata, relation),
            )
        )
    return rows


def _adjusted_selection_counts(
    counts,
    type_key,
    old_queryset,
    new_rows,
    canonical_field,
):
    """Apply counters for only the replaced title rows as a small delta."""
    counts = dict(counts or {})
    type_counts = dict(counts.get(type_key) or {})
    old_output = old_queryset.count()
    old_canonical = old_queryset.values(canonical_field).distinct().count()
    old_unknown = old_queryset.filter(
        audio_languages=[],
        subtitle_languages=[],
        resolution_height=0,
    ).count()
    new_output = len(new_rows)
    new_canonical = len(
        {getattr(row, canonical_field) for row in new_rows}
    )
    new_unknown = sum(
        not (
            row.audio_languages
            or row.subtitle_languages
            or row.resolution_height
        )
        for row in new_rows
    )
    for key, old_value, new_value in (
        ("output_entries", old_output, new_output),
        ("canonical_titles", old_canonical, new_canonical),
        ("unknown_metadata", old_unknown, new_unknown),
    ):
        type_counts[key] = max(
            int(type_counts.get(key) or 0) - old_value + new_value,
            0,
        )
    counts[type_key] = type_counts
    counts.update(
        output_entries=sum(
            (counts.get(key) or {}).get("output_entries", 0)
            for key in ("movies", "series")
        ),
        canonical_titles=sum(
            (counts.get(key) or {}).get("canonical_titles", 0)
            for key in ("movies", "series")
        ),
        unknown_metadata=sum(
            (counts.get(key) or {}).get("unknown_metadata", 0)
            for key in ("movies", "series")
        ),
    )
    return counts


def refresh_profile_selections_for_content(*, movie_ids=(), series_ids=()):
    """Synchronously re-evaluate only manually edited canonical titles.

    A single metadata correction normally affects one movie or series and its
    handful of competing provider relations. Rebuilding every prepared VOD
    profile would rescan the complete provider catalog, so replace just those
    prepared rows and advance ready profiles to the new catalog generation.
    Imports and large bulk edits continue to use the background full rebuild;
    small manual bulk edits may reuse this bounded path.
    """
    movie_ids = {int(value) for value in movie_ids if value is not None}
    series_ids = {int(value) for value in series_ids if value is not None}
    if not movie_ids and not series_ids:
        return {"profiles_updated": 0, "queued_full_rebuild": False}

    from .catalog_cache import bump_catalog_generation

    bump_catalog_generation()
    source_generation = str(selection_catalog_generation())
    updated_profiles = 0
    try:
        with transaction.atomic():
            policies = list(
                VODAccessPolicy.objects.select_for_update().filter(
                    is_active=True,
                    selection_status=VODAccessPolicy.SelectionStatus.READY,
                ).exclude(active_selection_generation="")
            )
            for policy in policies:
                generation = policy.active_selection_generation
                movie_rows = _selection_rows_for_canonical_ids(
                    policy,
                    generation,
                    M3UMovieRelation,
                    VODMovieProfileSelection,
                    "movie_id",
                    movie_ids,
                )
                series_rows = _selection_rows_for_canonical_ids(
                    policy,
                    generation,
                    M3USeriesRelation,
                    VODSeriesProfileSelection,
                    "series_id",
                    series_ids,
                )
                if movie_ids:
                    old_rows = VODMovieProfileSelection.objects.filter(
                        policy=policy,
                        generation=generation,
                        movie_id__in=movie_ids,
                    )
                    policy.selection_counts = _adjusted_selection_counts(
                        policy.selection_counts,
                        "movies",
                        old_rows,
                        movie_rows,
                        "movie_id",
                    )
                    old_rows.delete()
                    VODMovieProfileSelection.objects.bulk_create(
                        movie_rows, batch_size=500
                    )
                if series_ids:
                    old_rows = VODSeriesProfileSelection.objects.filter(
                        policy=policy,
                        generation=generation,
                        series_id__in=series_ids,
                    )
                    policy.selection_counts = _adjusted_selection_counts(
                        policy.selection_counts,
                        "series",
                        old_rows,
                        series_rows,
                        "series_id",
                    )
                    old_rows.delete()
                    VODSeriesProfileSelection.objects.bulk_create(
                        series_rows, batch_size=500
                    )
                policy.selection_catalog_generation = source_generation
                policy.selection_status = VODAccessPolicy.SelectionStatus.READY
                policy.selection_error = ""
                policy.selection_completed_at = timezone.now()
                policy.selection_progress = _progress_payload(
                    "Ready after metadata update", 100, incremental=True
                )
                # Avoid the VODAccessPolicy post-save invalidation signal. This
                # updates prepared bookkeeping, not the profile definition.
                VODAccessPolicy.objects.filter(pk=policy.pk).update(
                    selection_counts=policy.selection_counts,
                    selection_catalog_generation=source_generation,
                    selection_status=VODAccessPolicy.SelectionStatus.READY,
                    selection_error="",
                    selection_completed_at=policy.selection_completed_at,
                    selection_progress=policy.selection_progress,
                )
                updated_profiles += 1
    except Exception:
        logger.exception(
            "Incremental VOD profile refresh failed for movies=%s series=%s",
            sorted(movie_ids),
            sorted(series_ids),
        )
        enqueue_all_profile_selection_rebuilds()
        return {"profiles_updated": 0, "queued_full_rebuild": True}

    # Profiles already pending/building will consume the new generation in
    # their active task. This also repairs any unpublished pending state.
    queued_full_rebuild = enqueue_all_profile_selection_rebuilds(
        pending_only=True
    )
    return {
        "profiles_updated": updated_profiles,
        "queued_full_rebuild": queued_full_rebuild,
    }


def _metadata_list(metadata, *fields):
    for field in fields:
        value = metadata.get(field)
        if isinstance(value, (list, tuple, set)):
            return list(value)
        if value:
            return [str(value)]
    return []


def _metadata_columns(metadata, relation):
    metadata = normalize_source_metadata(metadata)
    audio_languages = _metadata_list(
        metadata,
        "audio_languages",
        "languages",
    )
    subtitle_languages = _metadata_list(metadata, "subtitle_languages")
    container_extension = str(
        metadata.get("container_extension")
        or getattr(relation, "container_extension", "")
        or ""
    ).lower()
    return {
        "effective_metadata": metadata,
        "audio_languages": audio_languages,
        "subtitle_languages": subtitle_languages,
        "resolution_height": _vertical_resolution(metadata),
        "container_extension": container_extension,
    }


def _build_type(
    policy,
    generation,
    relation_model,
    selection_model,
    canonical,
    *,
    scan_progress_range,
    store_progress_range,
    content_label,
):
    category_mapping = policy_category_map(policy)
    candidates = (
        relation_model.objects.filter(
            m3u_account__is_active=True,
        )
        .filter(allowed_category_query(policy))
        .select_related("m3u_account", "source_asset")
        .order_by("pk")
    )
    candidate_total = candidates.count()
    scan_start, scan_end = scan_progress_range

    def report_scan(processed):
        ratio = processed / candidate_total if candidate_total else 1
        _set_profile_progress(
            policy.pk,
            f"Selecting {content_label}",
            scan_start + ((scan_end - scan_start) * ratio),
            processed=processed,
            total=candidate_total,
            content_type=content_label,
        )

    report_scan(0)
    stats = {}
    selected_ids = select_relation_ids_for_policy(
        candidates.iterator(chunk_size=BUILD_CHUNK_SIZE),
        policy,
        canonical,
        stats=stats,
        progress_callback=report_scan,
        progress_interval=PROGRESS_SCAN_INTERVAL,
    )
    report_scan(candidate_total)
    canonical_ids = set()
    unknown_metadata = 0
    created = 0

    store_start, store_end = store_progress_range
    selected_total = len(selected_ids)
    _set_profile_progress(
        policy.pk,
        f"Preparing {content_label}",
        store_start,
        processed=0,
        total=selected_total,
        content_type=content_label,
    )
    for offset in range(0, selected_total, BUILD_CHUNK_SIZE):
        relation_chunk = list(
            relation_model.objects.filter(
                pk__in=selected_ids[offset : offset + BUILD_CHUNK_SIZE]
            ).select_related("source_asset")
        )
        rows = []
        for relation in relation_chunk:
            metadata = relation_metadata(
                relation,
                category_mapping.get(
                    (relation.m3u_account_id, relation.category_id)
                ),
            )
            metadata_columns = _metadata_columns(metadata, relation)
            if not (
                metadata_columns["audio_languages"]
                or metadata_columns["subtitle_languages"]
                or metadata_columns["resolution_height"]
            ):
                unknown_metadata += 1
            canonical_id = getattr(relation, canonical)
            canonical_ids.add(canonical_id)
            values = {
                "policy": policy,
                "generation": generation,
                "relation": relation,
                "category_id": relation.category_id,
                canonical: canonical_id,
                **metadata_columns,
            }
            rows.append(selection_model(**values))
        selection_model.objects.bulk_create(rows, batch_size=1000)
        created += len(rows)
        processed = min(offset + BUILD_CHUNK_SIZE, selected_total)
        ratio = processed / selected_total if selected_total else 1
        _set_profile_progress(
            policy.pk,
            f"Preparing {content_label}",
            store_start + ((store_end - store_start) * ratio),
            processed=processed,
            total=selected_total,
            content_type=content_label,
        )

    if not selected_total:
        _set_profile_progress(
            policy.pk,
            f"Preparing {content_label}",
            store_end,
            processed=0,
            total=0,
            content_type=content_label,
        )

    return {
        "candidate_sources": stats.get("candidates", 0),
        "eligible_sources": stats.get("eligible", 0),
        "output_entries": created,
        "canonical_titles": len(canonical_ids),
        "unknown_metadata": unknown_metadata,
    }


def build_vod_profile_selection(policy_id):
    """Build a new generation and switch to it only when fully complete."""
    generation = uuid.uuid4().hex
    source_generation = str(selection_catalog_generation())
    now = timezone.now()
    stale_build = now - timedelta(hours=1)
    acquired = VODAccessPolicy.objects.filter(
        pk=policy_id,
        is_active=True,
    ).filter(
        ~Q(selection_status=VODAccessPolicy.SelectionStatus.BUILDING)
        | Q(selection_started_at__isnull=True)
        | Q(selection_started_at__lt=stale_build)
    ).update(
        selection_status=VODAccessPolicy.SelectionStatus.BUILDING,
        selection_started_at=now,
        selection_completed_at=None,
        selection_error="",
        selection_progress=_progress_payload("Starting", 1),
    )
    if not acquired:
        if VODAccessPolicy.objects.filter(pk=policy_id, is_active=True).exists():
            raise ProfileBuildAlreadyRunning(
                f"VOD profile {policy_id} is already being prepared"
            )
        raise VODAccessPolicy.DoesNotExist
    policy = VODAccessPolicy.objects.get(pk=policy_id, is_active=True)
    policy_updated_at = policy.updated_at

    try:
        movie_counts = _build_type(
            policy,
            generation,
            M3UMovieRelation,
            VODMovieProfileSelection,
            "movie_id",
            scan_progress_range=(2, 36),
            store_progress_range=(36, 50),
            content_label="movies",
        )
        series_counts = _build_type(
            policy,
            generation,
            M3USeriesRelation,
            VODSeriesProfileSelection,
            "series_id",
            scan_progress_range=(50, 84),
            store_progress_range=(84, 98),
            content_label="series",
        )
        _set_profile_progress(policy.pk, "Activating catalog", 99)
        if str(selection_catalog_generation()) != source_generation:
            raise CatalogChangedDuringBuild(
                "The VOD catalog changed while the profile was being built"
            )

        counts = {
            "movies": movie_counts,
            "series": series_counts,
            "output_entries": (
                movie_counts["output_entries"]
                + series_counts["output_entries"]
            ),
            "canonical_titles": (
                movie_counts["canonical_titles"]
                + series_counts["canonical_titles"]
            ),
            "eligible_sources": (
                movie_counts["eligible_sources"]
                + series_counts["eligible_sources"]
            ),
            "unknown_metadata": (
                movie_counts["unknown_metadata"]
                + series_counts["unknown_metadata"]
            ),
        }
        with transaction.atomic():
            locked_policy = VODAccessPolicy.objects.select_for_update().get(
                pk=policy.pk
            )
            if str(selection_catalog_generation()) != source_generation:
                raise CatalogChangedDuringBuild(
                    "The VOD catalog changed before profile activation"
                )
            if locked_policy.updated_at != policy_updated_at:
                raise CatalogChangedDuringBuild(
                    "The VOD profile changed while it was being prepared"
                )
            # QuerySet.update deliberately avoids the catalog-invalidating
            # policy signal: selection bookkeeping does not change policy
            # semantics or source data.
            VODAccessPolicy.objects.filter(pk=policy.pk).update(
                active_selection_generation=generation,
                selection_catalog_generation=source_generation,
                selection_counts=counts,
                selection_status=VODAccessPolicy.SelectionStatus.READY,
                selection_completed_at=timezone.now(),
                selection_error="",
                selection_progress=_progress_payload("Ready", 100),
            )
        VODMovieProfileSelection.objects.filter(policy=policy).exclude(
            generation=generation
        ).delete()
        VODSeriesProfileSelection.objects.filter(policy=policy).exclude(
            generation=generation
        ).delete()
        return counts
    except CatalogChangedDuringBuild as exc:
        VODMovieProfileSelection.objects.filter(
            policy=policy, generation=generation
        ).delete()
        VODSeriesProfileSelection.objects.filter(
            policy=policy, generation=generation
        ).delete()
        VODAccessPolicy.objects.filter(pk=policy.pk).update(
            selection_status=VODAccessPolicy.SelectionStatus.PENDING,
            selection_error=str(exc),
            selection_progress=_progress_payload(
                "Catalog changed; retrying", 0
            ),
        )
        raise
    except Exception as exc:
        logger.exception("Failed to build VOD profile selection %s", policy.pk)
        VODMovieProfileSelection.objects.filter(
            policy=policy, generation=generation
        ).delete()
        VODSeriesProfileSelection.objects.filter(
            policy=policy, generation=generation
        ).delete()
        VODAccessPolicy.objects.filter(pk=policy.pk).update(
            selection_status=VODAccessPolicy.SelectionStatus.FAILED,
            selection_error=str(exc)[:2000],
            selection_completed_at=timezone.now(),
            selection_progress=_progress_payload("Failed", 100),
        )
        raise


def prepared_relation_ids(
    policy,
    relation_model,
    relation_filters,
    selection_filters=None,
):
    """Return prepared relation IDs or ``None`` for a stale/missing build."""
    state = VODAccessPolicy.objects.filter(pk=policy.pk).values(
        "selection_status",
        "active_selection_generation",
        "selection_catalog_generation",
    ).first()
    if not state:
        return None
    # Keep serving the last atomically activated generation while a newer
    # generation is queued or building. Deleted source relations disappear via
    # FK cascades, and the new generation replaces this one only when complete.
    if not state["active_selection_generation"]:
        return None

    if relation_model is M3UMovieRelation:
        selection_model = VODMovieProfileSelection
    elif relation_model is M3USeriesRelation:
        selection_model = VODSeriesProfileSelection
    else:
        return None
    prefixed_filters = {
        f"relation__{key}": value for key, value in relation_filters.items()
    }
    prefixed_filters.update(selection_filters or {})
    return list(
        selection_model.objects.filter(
            policy_id=policy.pk,
            generation=state["active_selection_generation"],
            **prefixed_filters,
        ).values_list("relation_id", flat=True)
    )
