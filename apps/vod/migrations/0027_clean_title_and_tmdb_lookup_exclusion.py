from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("vod", "0026_vod_profile_output_format")]

    operations = [
        migrations.AddField(
            model_name="movie",
            name="clean_title",
            field=models.CharField(
                blank=True,
                help_text="Rule-derived title used for TMDB lookup and title fallback.",
                max_length=255,
            ),
        ),
        migrations.AddField(
            model_name="movie",
            name="tmdb_lookup_excluded",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="series",
            name="clean_title",
            field=models.CharField(
                blank=True,
                help_text="Rule-derived title used for TMDB lookup and title fallback.",
                max_length=255,
            ),
        ),
        migrations.AddField(
            model_name="series",
            name="tmdb_lookup_excluded",
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
