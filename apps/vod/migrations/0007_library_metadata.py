import django.utils.timezone
from django.db import migrations, models
from django.db.models import F


def backfill_library_added_at(apps, schema_editor):
    for model_name in ("Movie", "Series", "Episode"):
        apps.get_model("vod", model_name).objects.update(
            library_added_at=F("created_at")
        )


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0006_source_metadata"),
    ]

    operations = [
        *[
            migrations.AddField(
                model_name=model_name,
                name=name,
                field=field,
            )
            for model_name in ("movie", "series")
            for name, field in (
                ("display_name", models.CharField(max_length=255, blank=True)),
                ("clean_title", models.CharField(max_length=255, blank=True)),
                (
                    "tmdb_lookup_excluded",
                    models.BooleanField(default=False, db_index=True),
                ),
                ("tmdb_metadata", models.JSONField(default=dict, blank=True)),
                (
                    "tmdb_match_id",
                    models.CharField(max_length=50, blank=True, db_index=True),
                ),
                (
                    "tmdb_imdb_id",
                    models.CharField(max_length=50, blank=True, db_index=True),
                ),
                (
                    "tmdb_poster_url",
                    models.CharField(max_length=500, blank=True),
                ),
                (
                    "tmdb_backdrop_url",
                    models.CharField(max_length=500, blank=True),
                ),
                (
                    "tmdb_status",
                    models.CharField(max_length=16, blank=True, db_index=True),
                ),
                (
                    "tmdb_enriched_at",
                    models.DateTimeField(null=True, blank=True, db_index=True),
                ),
                (
                    "tmdb_enrichment_signature",
                    models.CharField(max_length=64, blank=True, db_index=True),
                ),
            )
        ],
        *[
            migrations.AddField(
                model_name=model_name,
                name="library_added_at",
                field=models.DateTimeField(
                    default=django.utils.timezone.now,
                    db_index=True,
                ),
            )
            for model_name in ("movie", "series", "episode")
        ],
        migrations.RunPython(
            backfill_library_added_at,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
