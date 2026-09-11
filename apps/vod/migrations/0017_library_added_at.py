from django.db import migrations, models
from django.db.models import F
import django.utils.timezone


def backfill_library_added_at(apps, schema_editor):
    """Preserve the original import time for every existing library row."""
    for model_name in ("Movie", "Series", "Episode"):
        model = apps.get_model("vod", model_name)
        model.objects.update(library_added_at=F("created_at"))


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0016_vod_catalog_state"),
    ]

    operations = [
        migrations.AddField(
            model_name="movie",
            name="library_added_at",
            field=models.DateTimeField(
                db_index=True,
                default=django.utils.timezone.now,
                help_text=(
                    "First time this canonical movie was imported into the "
                    "VOD library. Provider refreshes must not change this value."
                ),
            ),
        ),
        migrations.AddField(
            model_name="series",
            name="library_added_at",
            field=models.DateTimeField(
                db_index=True,
                default=django.utils.timezone.now,
                help_text=(
                    "First time this canonical series was imported into the "
                    "VOD library. Provider refreshes must not change this value."
                ),
            ),
        ),
        migrations.AddField(
            model_name="episode",
            name="library_added_at",
            field=models.DateTimeField(
                db_index=True,
                default=django.utils.timezone.now,
                help_text=(
                    "First time this canonical episode was imported into the "
                    "VOD library. Provider refreshes must not change this value."
                ),
            ),
        ),
        migrations.RunPython(
            backfill_library_added_at,
            migrations.RunPython.noop,
        ),
    ]
