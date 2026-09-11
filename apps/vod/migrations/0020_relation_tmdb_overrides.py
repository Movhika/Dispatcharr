from django.db import migrations, models


def move_canonical_overrides_to_relations(apps, schema_editor):
    Movie = apps.get_model("vod", "Movie")
    Series = apps.get_model("vod", "Series")
    MovieRelation = apps.get_model("vod", "M3UMovieRelation")
    SeriesRelation = apps.get_model("vod", "M3USeriesRelation")

    for canonical_id, override_id in Movie.objects.exclude(
        tmdb_override_id=""
    ).values_list("id", "tmdb_override_id").iterator(chunk_size=1000):
        MovieRelation.objects.filter(movie_id=canonical_id).update(
            tmdb_override_id=override_id
        )
    for canonical_id, override_id in Series.objects.exclude(
        tmdb_override_id=""
    ).values_list("id", "tmdb_override_id").iterator(chunk_size=1000):
        SeriesRelation.objects.filter(series_id=canonical_id).update(
            tmdb_override_id=override_id
        )


def restore_relation_overrides_to_canonical(apps, schema_editor):
    Movie = apps.get_model("vod", "Movie")
    Series = apps.get_model("vod", "Series")
    MovieRelation = apps.get_model("vod", "M3UMovieRelation")
    SeriesRelation = apps.get_model("vod", "M3USeriesRelation")

    for canonical_id, override_id in MovieRelation.objects.exclude(
        tmdb_override_id=""
    ).values_list("movie_id", "tmdb_override_id").iterator(chunk_size=1000):
        Movie.objects.filter(pk=canonical_id, tmdb_override_id="").update(
            tmdb_override_id=override_id
        )
    for canonical_id, override_id in SeriesRelation.objects.exclude(
        tmdb_override_id=""
    ).values_list("series_id", "tmdb_override_id").iterator(chunk_size=1000):
        Series.objects.filter(pk=canonical_id, tmdb_override_id="").update(
            tmdb_override_id=override_id
        )


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0019_tmdb_override_artwork_and_rerun"),
    ]

    operations = [
        migrations.AddField(
            model_name="m3umovierelation",
            name="tmdb_override_id",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="Administrator-selected TMDB ID for this provider source.",
                max_length=50,
            ),
        ),
        migrations.AddField(
            model_name="m3useriesrelation",
            name="tmdb_override_id",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="Administrator-selected TMDB ID for this provider source.",
                max_length=50,
            ),
        ),
        migrations.RunPython(
            move_canonical_overrides_to_relations,
            restore_relation_overrides_to_canonical,
        ),
        migrations.RemoveField(
            model_name="movie",
            name="tmdb_override_id",
        ),
        migrations.RemoveField(
            model_name="series",
            name="tmdb_override_id",
        ),
    ]
