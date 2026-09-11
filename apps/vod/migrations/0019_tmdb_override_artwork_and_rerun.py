from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("vod", "0018_tmdb_enrichment")]

    operations = [
        *[
            migrations.AddField(
                model_name=model,
                name="tmdb_override_id",
                field=models.CharField(
                    blank=True,
                    db_index=True,
                    help_text="Administrator-selected TMDB ID; provider identity is preserved.",
                    max_length=50,
                ),
            )
            for model in ("movie", "series")
        ],
        *[
            migrations.AddField(
                model_name=model,
                name="tmdb_match_id",
                field=models.CharField(blank=True, db_index=True, max_length=50),
            )
            for model in ("movie", "series")
        ],
        *[
            migrations.AddField(
                model_name=model,
                name="tmdb_imdb_id",
                field=models.CharField(blank=True, db_index=True, max_length=50),
            )
            for model in ("movie", "series")
        ],
        *[
            migrations.AddField(
                model_name=model,
                name="tmdb_poster_url",
                field=models.CharField(blank=True, max_length=500),
            )
            for model in ("movie", "series")
        ],
        *[
            migrations.AddField(
                model_name=model,
                name="tmdb_backdrop_url",
                field=models.CharField(blank=True, max_length=500),
            )
            for model in ("movie", "series")
        ],
        migrations.AddField(
            model_name="vodmetadatastate",
            name="rerun_requested",
            field=models.BooleanField(default=False),
        ),
    ]
