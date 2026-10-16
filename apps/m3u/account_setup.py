"""Persisted, retry-safe transitions for the optional M3U setup flow."""

import logging
from urllib.parse import urlencode

from django.db import transaction
from rest_framework.exceptions import APIException, ValidationError

from core.xtream_codes import normalize_server_url
from .models import M3UAccount

logger = logging.getLogger(__name__)


def queue_setup_categories(account_id):
    from .tasks import prepare_account_setup

    try:
        prepare_account_setup.delay(account_id)
    except Exception as exc:
        M3UAccount.objects.filter(pk=account_id).update(
            status=M3UAccount.Status.ERROR,
            last_message=(
                "Category loading could not be started. Resume setup to retry."
            ),
        )
        raise APIException(
            "Category loading could not be started. Retry setup."
        ) from exc


def discover_setup_categories(account_id):
    """Load category choices only; the user starts importing after selection."""
    from .tasks import refresh_m3u_groups

    account = M3UAccount.objects.get(pk=account_id)
    if not account.setup_step or not account.is_active:
        return
    M3UAccount.objects.filter(pk=account_id).update(
        status=M3UAccount.Status.FETCHING,
        last_message="Loading provider categories for setup.",
    )
    try:
        _, groups = refresh_m3u_groups(account_id, full_refresh=True)
        account.refresh_from_db()
        if not groups or account.status == M3UAccount.Status.ERROR:
            return
        if (
            account.account_type == M3UAccount.Types.XC
            and (account.custom_properties or {}).get("enable_vod")
        ):
            from apps.vod.tasks import refresh_categories

            if refresh_categories(account_id) is None:
                raise ValueError("VOD categories could not be loaded")
        M3UAccount.objects.filter(pk=account_id).update(
            status=M3UAccount.Status.PENDING_SETUP,
            last_message="Categories loaded. Continue setup to select imports.",
        )
    except Exception:
        logger.exception(
            "Could not load setup categories for account %s", account_id
        )
        M3UAccount.objects.filter(pk=account_id).update(
            status=M3UAccount.Status.ERROR,
            last_message=(
                "Categories could not be loaded. "
                "Check the account and retry setup."
            ),
        )


def _queue_initial_import(account_id, include_vod):
    from .tasks import refresh_single_m3u_account

    try:
        refresh_single_m3u_account.delay(account_id, include_vod=include_vod)
    except Exception as exc:
        # Settings are already saved. Leave a resumable step if dispatch fails.
        M3UAccount.objects.filter(pk=account_id, setup_step="").update(
            setup_step=M3UAccount.SetupStep.CATEGORIES
        )
        logger.exception("Could not queue initial import for account %s", account_id)
        raise APIException(
            "Category settings are saved, but the initial import could not be "
            "started. Resume setup and retry."
        ) from exc


def _create_matching_epg(account):
    from apps.epg.models import EPGSource
    from apps.epg.serializers import EPGSourceSerializer

    if account.account_type != M3UAccount.Types.XC:
        raise ValidationError("Automatic EPG setup requires Xtream Codes.")
    if not all((account.server_url, account.username, account.password)):
        raise ValidationError("Complete the account's URL and credentials first.")
    base = normalize_server_url(account.server_url)
    credentials = urlencode(
        {"username": account.username, "password": account.password}
    )
    url = f"{base.rstrip('/')}/xmltv.php?{credentials}"
    if EPGSource.objects.filter(
        name=account.name, source_type="xmltv", url=url
    ).exists():
        return
    serializer = EPGSourceSerializer(
        data={
            "name": account.name,
            "source_type": "xmltv",
            "url": url,
            "is_active": account.is_active,
            "refresh_interval": 24,
        }
    )
    serializer.is_valid(raise_exception=True)
    values = dict(serializer.validated_data)
    cron = values.pop("cron_expression", "")
    source = EPGSource(**values)
    source._cron_expression = cron
    source._defer_initial_refresh = True
    source.save()


def advance_account_setup(account_id, action):
    with transaction.atomic():
        account = M3UAccount.objects.select_for_update().get(pk=account_id)
        if not account.setup_step:
            return account
        if action in {"create_epg", "skip_epg"}:
            if account.setup_step != M3UAccount.SetupStep.EPG:
                return account
            if action == "create_epg":
                _create_matching_epg(account)
            account.setup_step = M3UAccount.SetupStep.CATEGORIES
            account.save(update_fields=["setup_step"])
        elif action == "retry_categories":
            from core.utils import is_task_lock_held

            if account.setup_step != M3UAccount.SetupStep.CATEGORIES:
                raise ValidationError("Finish the optional EPG step first.")
            if not account.is_active:
                raise ValidationError("Enable this account before continuing setup.")
            if is_task_lock_held("prepare_m3u_account_setup", account.id):
                return account
            account.status = M3UAccount.Status.FETCHING
            account.last_message = "Loading provider categories for setup."
            account.save(update_fields=["status", "last_message"])
            transaction.on_commit(lambda: queue_setup_categories(account.id))
        elif action == "complete":
            if account.setup_step != M3UAccount.SetupStep.CATEGORIES:
                raise ValidationError("Finish the optional EPG step first.")
            if not account.is_active:
                raise ValidationError("Enable this account before completing setup.")
            if not account.channel_group.exists():
                raise ValidationError("Load the provider categories first.")
            if account.status in {
                M3UAccount.Status.ERROR,
                M3UAccount.Status.FETCHING,
                M3UAccount.Status.PARSING,
            }:
                raise ValidationError("Finish loading the provider categories first.")
            include_vod = (
                account.account_type == M3UAccount.Types.XC
                and bool((account.custom_properties or {}).get("enable_vod"))
            )
            account.setup_step = ""
            account.save(update_fields=["setup_step"])
            transaction.on_commit(
                lambda: _queue_initial_import(account.id, include_vod)
            )
    return account
