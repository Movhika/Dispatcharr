"""Coalesced Live TV refresh requests triggered by XC clients."""

from datetime import timedelta
import hashlib
import logging

from django.core.cache import cache
from django.utils import timezone

from apps.accounts.models import User
from apps.channels.models import Channel
from core.utils import get_client_ip, is_task_lock_held, log_system_event

from .models import M3UAccount


logger = logging.getLogger(__name__)

XC_LIVE_REFRESH_USER_PROPERTY = "xc_live_refresh_on_request"
CLIENT_REFRESH_MIN_AGE = timedelta(minutes=55)
CLIENT_REFRESH_MIN_AGE_SECONDS = int(CLIENT_REFRESH_MIN_AGE.total_seconds())
CLIENT_REFRESH_QUEUE_TTL_SECONDS = 15 * 60
CLIENT_REQUEST_EVENT_TTL_SECONDS = 60


def _visible_live_accounts(user):
    """Return active XC accounts contributing Live channels visible to *user*."""
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


def _recently_refreshed(account, now):
    last_success = account.updated_at
    if not last_success:
        return False
    return now - last_success < CLIENT_REFRESH_MIN_AGE


def _log_catalog_request(request, user, outcome):
    """Log at most one readable XC catalog event per client and minute."""
    client_ip = get_client_ip(request) or "unknown"
    user_agent = request.META.get("HTTP_USER_AGENT", "unknown")
    client_key = hashlib.sha256(
        f"{client_ip}:{user_agent}".encode("utf-8")
    ).hexdigest()[:16]
    event_key = f"xc_live_catalog_event:{user.id}:{client_key}"

    try:
        should_log = cache.add(
            event_key,
            True,
            timeout=CLIENT_REQUEST_EVENT_TTL_SECONDS,
        )
    except Exception:
        logger.warning("Could not deduplicate XC Live catalog event", exc_info=True)
        should_log = True

    if not should_log:
        return

    log_system_event(
        "xc_live_catalog_request",
        user=user.username,
        client_ip=client_ip,
        user_agent=user_agent,
        refresh=outcome,
    )


def handle_xc_live_catalog_request(request, user):
    """Optionally queue one Live-only provider refresh after serving XC data.

    Every XC Live catalog request is observable in System Events, but only an
    administrator-enabled user can request provider refreshes. Freshness and
    queue keys are per provider, so several users cannot create duplicate jobs.
    """
    properties = user.custom_properties or {}
    if properties.get(XC_LIVE_REFRESH_USER_PROPERTY) is not True:
        _log_catalog_request(request, user, "disabled for user")
        return {"queued": [], "skipped": ["disabled for user"]}

    now = timezone.now()
    queued = []
    skipped = []

    try:
        accounts = list(_visible_live_accounts(user))
    except Exception:
        logger.warning(
            "Could not resolve XC Live accounts visible to user %s",
            user.id,
            exc_info=True,
        )
        _log_catalog_request(request, user, "account lookup failed")
        return {"queued": [], "skipped": ["account lookup failed"]}

    for account in accounts:
        if _recently_refreshed(account, now):
            skipped.append(f"{account.name}: recently refreshed")
            continue

        if account.status in {
            M3UAccount.Status.FETCHING,
            M3UAccount.Status.PARSING,
        } or is_task_lock_held("refresh_single_m3u_account", account.id):
            skipped.append(f"{account.name}: already running")
            continue

        queue_key = f"xc_live_refresh_request:{account.id}"
        try:
            reserved = cache.add(
                queue_key,
                str(user.id),
                timeout=CLIENT_REFRESH_QUEUE_TTL_SECONDS,
            )
        except Exception:
            logger.warning(
                "Could not reserve XC-triggered Live refresh for account %s",
                account.id,
                exc_info=True,
            )
            skipped.append(f"{account.name}: coordinator unavailable")
            continue

        if not reserved:
            skipped.append(f"{account.name}: already queued")
            continue

        try:
            from .tasks import refresh_single_m3u_account

            refresh_single_m3u_account.apply_async(
                kwargs={
                    "account_id": account.id,
                    "include_vod": False,
                    "minimum_age_seconds": CLIENT_REFRESH_MIN_AGE_SECONDS,
                }
            )
            queued.append(account.name)
        except Exception:
            try:
                cache.delete(queue_key)
            except Exception:
                pass
            logger.warning(
                "Could not queue XC-triggered Live refresh for account %s",
                account.id,
                exc_info=True,
            )
            skipped.append(f"{account.name}: queue failed")

    if queued:
        outcome = f"queued Live-only refresh: {', '.join(queued)}"
    elif skipped:
        outcome = "; ".join(skipped)
    else:
        outcome = "no visible XC Live providers"
    _log_catalog_request(request, user, outcome)
    return {"queued": queued, "skipped": skipped}
