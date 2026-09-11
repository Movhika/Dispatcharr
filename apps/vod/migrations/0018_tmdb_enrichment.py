from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0017_library_added_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="movie",
            name="tmdb_metadata",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="movie",
            name="tmdb_status",
            field=models.CharField(blank=True, db_index=True, max_length=16),
        ),
        migrations.AddField(
            model_name="movie",
            name="tmdb_enriched_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="movie",
            name="tmdb_enrichment_signature",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="TMDB schema/language signature used for the last enrichment.",
                max_length=64,
            ),
        ),
        migrations.AddField(
            model_name="series",
            name="tmdb_metadata",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="series",
            name="tmdb_status",
            field=models.CharField(blank=True, db_index=True, max_length=16),
        ),
        migrations.AddField(
            model_name="series",
            name="tmdb_enriched_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="series",
            name="tmdb_enrichment_signature",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="TMDB schema/language signature used for the last enrichment.",
                max_length=64,
            ),
        ),
        migrations.CreateModel(
            name="VODMetadataState",
            fields=[
                (
                    "id",
                    models.PositiveSmallIntegerField(
                        default=1, editable=False, primary_key=True, serialize=False
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("idle", "Idle"),
                            ("queued", "Queued"),
                            ("running", "Running"),
                            ("complete", "Complete"),
                            ("failed", "Failed"),
                        ],
                        default="idle",
                        max_length=12,
                    ),
                ),
                ("task_id", models.CharField(blank=True, max_length=255)),
                (
                    "rebuild_profiles_after_completion",
                    models.BooleanField(default=False),
                ),
                ("progress", models.JSONField(blank=True, default=dict)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("error", models.TextField(blank=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "VOD metadata state",
                "verbose_name_plural": "VOD metadata state",
            },
        ),
    ]
