from django.db.models.signals import m2m_changed, post_delete, post_save
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


CATALOG_MODELS = (
    Movie,
    Series,
    Episode,
    M3UMovieRelation,
    M3USeriesRelation,
    M3UEpisodeRelation,
    M3UVODCategoryRelation,
    VODAccessPolicy,
    VODPolicyCategory,
    VODSourceAsset,
    M3UAccount,
)


@receiver(post_save)
@receiver(post_delete)
def invalidate_vod_catalog(
    sender,
    instance=None,
    created=False,
    update_fields=None,
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
    if sender in CATALOG_MODELS:
        bump_catalog_generation()
        VODAccessPolicy.objects.filter(is_active=True).exclude(
            selection_status=VODAccessPolicy.SelectionStatus.BUILDING,
        ).update(
            selection_status=VODAccessPolicy.SelectionStatus.PENDING,
            selection_error="",
        )


@receiver(m2m_changed, sender=VODAccessPolicy.users.through)
def invalidate_vod_policy_users(**kwargs):
    # Assignment changes which prepared profile a user consumes, not the
    # contents of any prepared profile.
    bump_catalog_generation(invalidate_selections=False)
