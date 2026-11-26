from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("dispatcharr_channels", "0044_event_channel_groups"),
    ]

    operations = [
        migrations.AddField(
            model_name="eventchannelgroup",
            name="epg_enabled",
            field=models.BooleanField(
                default=True,
                help_text="Give the channels a programme guide with upcoming, live and ended entries.",
            ),
        ),
    ]
