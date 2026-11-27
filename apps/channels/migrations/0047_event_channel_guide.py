from django.db import migrations, models

MANAGED_SOURCE = "Event channels"


def detach_managed_guide(apps, schema_editor):
    """Event channels now get their guide from the event data itself."""
    EPGSource = apps.get_model("epg", "EPGSource")
    Channel = apps.get_model("dispatcharr_channels", "Channel")
    source = EPGSource.objects.filter(name=MANAGED_SOURCE, source_type="dummy").first()
    if source is None:
        return
    Channel.objects.filter(
        event_channel__isnull=False, epg_data__epg_source=source
    ).update(epg_data=None)
    if not Channel.objects.filter(epg_data__epg_source=source).exists():
        source.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("dispatcharr_channels", "0046_channel_stream_rules"),
        ("epg", "0028_programdata_epg_end_index"),
    ]

    operations = [
        migrations.AddField(
            model_name="eventchannel",
            name="competition",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="eventchannel",
            name="end",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RemoveField(model_name="eventchannelgroup", name="epg_enabled"),
        migrations.RunPython(detach_managed_guide, migrations.RunPython.noop),
    ]
