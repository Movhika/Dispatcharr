from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0011_vodaccesspolicy_selection_progress"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="vodplaybacksession",
            index=models.Index(
                fields=["-started_at"],
                name="vod_playback_started_idx",
            ),
        ),
    ]
