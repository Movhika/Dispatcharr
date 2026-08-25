from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("vod", "0012_vod_playback_started_index")]

    operations = [
        migrations.AddField(
            model_name="movie",
            name="display_name",
            field=models.CharField(
                blank=True,
                help_text="Optional canonical title used for compact client output.",
                max_length=255,
            ),
        ),
        migrations.AddField(
            model_name="series",
            name="display_name",
            field=models.CharField(
                blank=True,
                help_text="Optional canonical title used for compact client output.",
                max_length=255,
            ),
        ),
        migrations.AddField(
            model_name="vodplaybacksession",
            name="failover_count",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
