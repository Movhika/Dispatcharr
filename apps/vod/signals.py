from django.db.models.signals import m2m_changed, post_delete, post_save, pre_save
from django.dispatch import receiver
from apps.m3u.models import M3UAccount

from .catalog_cache import bump_catalog_generation
from .models import (
    Episode,
    Movie,
    Series,
    M3UEpisodeRelation,
    M3UMovieRelation,
    M3USeriesRelation,
    M3UVODCategoryRelation,
    VODAccessPolicy,
    VODPolicyCategory,
    VODSourceAsset,
)


CANONICAL_METADATA_MODELS = (
    Movie,
    Series,
    Episode,
)

SELECTION_CATALOG_MODELS = (
    M3UMovieRelation,
    M3USeriesRelation,
    M3UVODCategoryRelation,
)

M3U_SELECTION_FIELDS = {"is_active", "priority", "custom_properties"}
RELATION_SELECTION_FIELDS = {
    M3UMovieRelation: {
        "m3u_account",
        "m3u_account_id",
        "movie",
        "movie_id",
        "category",
        "category_id",
        "source_asset",
        "source_asset_id",
        "stream_id",
        "container_extension",
        "custom_properties",
    },
    M3USeriesRelation: {
        "m3u_account",
        "m3u_account_id",
        "series",
        "series_id",
        "category",
        "category_id",
        "source_asset",
        "source_asset_id",
        "external_series_id",
        "custom_properties",
    },
}


@receiver(pre_save, sender=M3UAccount)
def remember_m3u_selection_changes(sender, instance, **kwargs):
    """Detect relevant changes even when callers use a full model save."""
    if not instance.pk:
        instance._vod_selection_changed = True
        return
    previous = sender.objects.filter(pk=instance.pk).values(
        *M3U_SELECTION_FIELDS
    ).first()
    instance._vod_selection_changed = previous is None or any(
        previous[field] != getattr(instance, field)
        for field in M3U_SELECTION_FIELDS
    )


@receiver(post_save)
@receiver(post_delete)
def invalidate_vod_catalog(
    sender,
    instance=None,
    created=False,
    update_fields=None,
    signal=None,
    **kwargs,
):
    # Lazy singleton source assets do not alter catalog visibility or ranking.
    # Avoid flushing a large XC cache merely because a title was played for the
    # first time. Later observations/manual metadata still invalidate normally.
    if sender is VODSourceAsset and created:
        return
    if sender is VODSourceAsset:
        bump_catalog_generation()
        from .profile_selection import enqueue_all_profile_selection_rebuilds

        enqueue_all_profile_selection_rebuilds()
        return
    if sender in (M3UMovieRelation, M3USeriesRelation, M3UEpisodeRelation) and (
        update_fields and set(update_fields) == {"source_asset"}
    ):
        return
    if sender in CANONICAL_METADATA_MODELS:
        # Names, artwork and provider detail enrichment affect the normal XC
        # response cache, but never which source edition a profile selects.
        # Keeping the prepared generation valid avoids an opened VOD detail
        # dialog needlessly returning every profile to Pending.
        bump_catalog_generation(invalidate_selections=False)
        return
    if sender is M3UAccount:
        if signal is post_delete:
            bump_catalog_generation()
            from .profile_selection import enqueue_all_profile_selection_rebuilds

            enqueue_all_profile_selection_rebuilds()
            return
        changed_fields = set(update_fields or [])
        if changed_fields and changed_fields.isdisjoint(M3U_SELECTION_FIELDS):
            # Playback counters and refresh status/last_message updates are
            # frequent and do not change VOD visibility or ranking.
            return
        if not changed_fields and not getattr(
            instance, "_vod_selection_changed", True
        ):
            return
        bump_catalog_generation()
        from .profile_selection import enqueue_all_profile_selection_rebuilds

        enqueue_all_profile_selection_rebuilds()
        return
    if sender is M3UEpisodeRelation:
        # Episode inventory and playback metadata change the normal XC response,
        # but profile selection is based on movie/series source relations only.
        bump_catalog_generation(invalidate_selections=False)
        return
    if sender is VODAccessPolicy:
        # Policy semantics only invalidate this profile. User-output caches are
        # still globally versioned, but other prepared profiles remain valid.
        if instance and instance.pk:
            VODAccessPolicy.objects.filter(pk=instance.pk).exclude(
                selection_status=VODAccessPolicy.SelectionStatus.BUILDING,
            ).update(
                selection_status=VODAccessPolicy.SelectionStatus.PENDING,
                selection_error="",
            )
        bump_catalog_generation(invalidate_selections=False)
        return
    if sender is VODPolicyCategory:
        policy_id = getattr(instance, "policy_id", None)
        if policy_id:
            VODAccessPolicy.objects.filter(pk=policy_id).exclude(
                selection_status=VODAccessPolicy.SelectionStatus.BUILDING,
            ).update(
                selection_status=VODAccessPolicy.SelectionStatus.PENDING,
                selection_error="",
            )
        bump_catalog_generation(invalidate_selections=False)
        return
    if sender in SELECTION_CATALOG_MODELS:
        relevant_fields = RELATION_SELECTION_FIELDS.get(sender)
        if relevant_fields and update_fields and set(update_fields).isdisjoint(
            relevant_fields
        ):
            return
        bump_catalog_generation()
        from .profile_selection import enqueue_all_profile_selection_rebuilds

        enqueue_all_profile_selection_rebuilds()


@receiver(m2m_changed, sender=VODAccessPolicy.users.through)
def invalidate_vod_policy_users(**kwargs):
    # Assignment changes which prepared profile a user consumes, not the
    # contents of any prepared profile.
    bump_catalog_generation(invalidate_selections=False)
