"""Rate-limited Live-only refresh requests from XC clients."""

import logging
import uuid
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

from apps.accounts.models import User
from apps.channels.models import Channel
from core.utils import is_task_lock_held

from .models import M3UAccount


logger = logging.getLogger(__name__)
DEFAULT_INTERVAL_MINUTES = 55
MAX_INTERVAL_MINUTES = 10080
QUEUE_RESERVATION_SECONDS = 15 * 60


def _bounded_minutes(value, default=DEFAULT_INTERVAL_MINUTES):
    try:
        if isinstance(value, bool):
            raise ValueError
        return max(0, min(MAX_INTERVAL_MINUTES, int(value)))
    except (TypeError, ValueError):
        return default


def _visible_live_accounts(user):
    """Only refresh XC providers that contribute channels this user may see."""
    channels = Channel.objects.filter(
        hidden_from_output=False,
        user_level__lte=user.user_level,
    )
    if user.user_level < User.UserLevel.ADMIN:
        if (user.custom_properties or {}).get("hide_adult_content", False):
            channels = channels.filter(is_adult=False)
        profiles = user.channel_profiles.all()
        if profiles.exists():
            channels = channels.filter(
                channelprofilemembership__enabled=True,
                channelprofilemembership__channel_profile__in=profiles,
            )
    return M3UAccount.objects.filter(
        is_active=True,
        account_type=M3UAccount.Types.XC,
        streams__channels__in=channels,
    ).distinct()


def _release_reservation(key, token=None):
    if not key:
        return
    try:
        if token is None or cache.get(key) == token:
            cache.delete(key)
    except Exception:
        logger.warning("Could not release XC Live refresh reservation", exc_info=True)


def release_client_refresh_reservation(account_id, token):
    """Release only the queue reservation owned by this task."""
    if token:
        _release_reservation(f"xc_live_refresh_request:{account_id}", token)


def handle_xc_live_catalog_request(user):
    """Queue eligible Live-only refreshes after serving an XC Live catalog."""
    properties = user.custom_properties or {}
    if properties.get("xc_live_refresh_on_request") is not True:
        return

    try:
        accounts = list(_visible_live_accounts(user))
    except Exception:
        logger.warning("Could not resolve XC Live accounts for user %s", user.id, exc_info=True)
        return

    now = timezone.now()
    user_interval = _bounded_minutes(
        properties.get("xc_live_refresh_request_interval_minutes")
    )
    for account in accounts:
        min_age = _bounded_minutes(account.xc_live_refresh_min_age_minutes)
        if min_age and account.updated_at and now - account.updated_at < timedelta(minutes=min_age):
            continue
        if account.status in (M3UAccount.Status.FETCHING, M3UAccount.Status.PARSING):
            continue

        user_key = f"xc_live_refresh_user_request:{user.id}:{account.id}"
        queue_key = f"xc_live_refresh_request:{account.id}"
        token = uuid.uuid4().hex
        try:
            if is_task_lock_held("refresh_single_m3u_account", account.id):
                continue
            if user_interval and not cache.add(user_key, token, timeout=user_interval * 60):
                continue
            if not cache.add(queue_key, token, timeout=QUEUE_RESERVATION_SECONDS):
                if user_interval:
                    _release_reservation(user_key, token)
                continue
        except Exception:
            if user_interval:
                _release_reservation(user_key, token)
            logger.warning("Could not coordinate XC Live refresh for account %s", account.id, exc_info=True)
            continue

        try:
            from .tasks import refresh_single_m3u_account

            refresh_single_m3u_account.apply_async(kwargs={
                "account_id": account.id,
                "include_vod": False,
                "minimum_age_seconds": min_age * 60,
                "skip_if_refreshed_after": now.isoformat(),
                "client_request_token": token,
            })
            logger.info("Queued XC Live-only refresh for account %s from user %s", account.id, user.id)
        except Exception:
            _release_reservation(queue_key, token)
            if user_interval:
                _release_reservation(user_key, token)
            logger.warning("Could not queue XC Live refresh for account %s", account.id, exc_info=True)
