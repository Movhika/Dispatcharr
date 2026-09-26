from django.db import transaction

from apps.m3u.models import M3UAccount
from core.utils import ensure_custom_properties_dict


def record_refresh_metrics(account_id, kind, counts, duration_seconds, completed_at):
    """Keep the latest successful refresh summary without overwriting other account settings."""
    if kind not in ("live", "vod"):
        raise ValueError(f"Unsupported refresh kind: {kind}")

    with transaction.atomic():
        account = M3UAccount.objects.select_for_update().only("custom_properties").get(pk=account_id)
        custom = ensure_custom_properties_dict(account.custom_properties).copy()
        custom[f"{kind}_catalog_counts"] = counts
        timings = dict(custom.get("refresh_timings") or {})
        timings[f"{kind}_seconds"] = round(duration_seconds, 2)
        timings[f"{kind}_completed_at"] = completed_at.isoformat()
        custom["refresh_timings"] = timings
        M3UAccount.objects.filter(pk=account_id).update(custom_properties=custom)
