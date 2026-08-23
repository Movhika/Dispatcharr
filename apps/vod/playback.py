"""Playback history helpers shared by redirect, proxy, and player telemetry."""

import logging

from django.utils import timezone

from .metadata import sync_relation_declared_metadata
from .models import VODPlaybackSession, VODSourceAsset
from .policies import relation_category


logger = logging.getLogger(__name__)


def _relation_content(relation):
    if hasattr(relation, "movie"):
        return VODSourceAsset.AssetType.MOVIE, relation.movie
    if hasattr(relation, "episode"):
        return VODSourceAsset.AssetType.EPISODE, relation.episode
    return VODSourceAsset.AssetType.SERIES, relation.series


def _provider_asset_id(relation):
    return str(
        getattr(relation, "stream_id", None)
        or getattr(relation, "external_series_id", None)
        or ""
    )


def record_playback_selection(
    *,
    session_id,
    user,
    relation,
    mode,
    status,
    client_ip=None,
    user_agent="",
    failover_chain=None,
    custom_properties=None,
):
    """Create/update the auditable choice without probing provider media."""
    asset_type, content = _relation_content(relation)
    # Playback history must remain useful even when lazy source-asset creation
    # fails (for example while a refresh holds a conflicting row lock).  The
    # relation/account/category still identify the exact source and a later
    # playback or manual bulk edit can create the asset.
    try:
        # This is not a media probe. It snapshots metadata the provider already
        # supplied (including the container extension) into the indexed source
        # library when that exact edition is actually used.
        asset = sync_relation_declared_metadata(relation)
    except Exception as exc:
        asset = None
        logger.warning(
            "Could not attach a source asset to playback %s (relation %s): %s",
            session_id,
            getattr(relation, "id", None),
            exc,
        )
    category = relation_category(relation)
    values = {
        "user": user if getattr(user, "is_authenticated", False) else None,
        "source_asset": asset,
        "m3u_account": relation.m3u_account,
        "category": category,
        "content_type": asset_type,
        "canonical_id": content.id,
        "relation_id": relation.id,
        "provider_asset_id": _provider_asset_id(relation),
        "content_name": str(content)[:500],
        "mode": mode,
        "status": status,
        "client_ip": client_ip or None,
        "user_agent": user_agent or "",
        "failover_chain": failover_chain or [],
        "custom_properties": custom_properties or {},
    }
    playback, created = VODPlaybackSession.objects.update_or_create(
        session_id=session_id,
        defaults=values,
    )
    if not created and status in {
        VODPlaybackSession.Status.COMPLETED,
        VODPlaybackSession.Status.STOPPED,
        VODPlaybackSession.Status.FAILED,
    }:
        playback.ended_at = timezone.now()
        playback.save(update_fields=["ended_at"])
    return playback
