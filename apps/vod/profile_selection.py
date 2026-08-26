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


def enqueue_all_profile_selection_rebuilds():
    """Mark active profiles stale and enqueue one debounced rebuild task."""
    queued_progress = _progress_payload("Waiting for worker", 0)
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
    if not newly_pending:
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
