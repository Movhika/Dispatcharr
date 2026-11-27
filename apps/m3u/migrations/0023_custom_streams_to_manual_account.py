"""Move the streams of the hidden custom account into a manual account.

Custom streams were created on the channel page and kept in a hidden, locked
account. Manual accounts replace that: the streams keep their ids and hashes,
so channels keep them, and they become editable like any manual stream.
"""

from django.db import migrations
from django.utils import timezone

ACCOUNT_NAME = "Custom streams"
FALLBACK_CATEGORY = "Custom streams"


def move_custom_streams(apps, schema_editor):
    M3UAccount = apps.get_model("m3u", "M3UAccount")
    M3UAccountProfile = apps.get_model("m3u", "M3UAccountProfile")
    Stream = apps.get_model("dispatcharr_channels", "Stream")
    ChannelGroup = apps.get_model("dispatcharr_channels", "ChannelGroup")
    ChannelGroupM3UAccount = apps.get_model("dispatcharr_channels", "ChannelGroupM3UAccount")

    custom = M3UAccount.objects.filter(name="custom", locked=True).first()
    if custom is None:
        return
    streams = Stream.objects.filter(m3u_account=custom)
    if not streams.exists():
        return

    name, number = ACCOUNT_NAME, 1
    while M3UAccount.objects.filter(name=name).exists():
        number += 1
        name = f"{ACCOUNT_NAME} ({number})"
    account = M3UAccount.objects.create(
        name=name,
        account_type="MAN",
        is_active=True,
        max_streams=0,
        refresh_interval=0,
        custom_properties={},
    )
    # Signals do not run in migrations: the default profile is created here.
    M3UAccountProfile.objects.get_or_create(
        m3u_account=account,
        is_default=True,
        defaults={
            "name": f"{name} Default",
            "max_streams": 0,
            "is_active": True,
            "search_pattern": "^(.*)$",
            "replace_pattern": "$1",
        },
    )

    if streams.filter(channel_group__isnull=True).exists():
        fallback, _created = ChannelGroup.objects.get_or_create(name=FALLBACK_CATEGORY)
        streams.filter(channel_group__isnull=True).update(channel_group=fallback)
    now = timezone.now()
    for group_id in streams.values_list("channel_group_id", flat=True).distinct():
        ChannelGroupM3UAccount.objects.get_or_create(
            channel_group_id=group_id,
            m3u_account=account,
            defaults={"enabled": True, "last_seen": now},
        )
    streams.update(m3u_account=account, is_custom=True, last_seen=now, is_stale=False)


class Migration(migrations.Migration):

    dependencies = [
        ("m3u", "0022_manual_account_type"),
        ("dispatcharr_channels", "0047_event_channel_guide"),
    ]

    operations = [
        migrations.RunPython(move_custom_streams, migrations.RunPython.noop),
    ]
