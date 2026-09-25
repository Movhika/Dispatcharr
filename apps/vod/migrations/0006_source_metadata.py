from django.contrib.postgres.indexes import GinIndex
from django.db import migrations, models


SOURCE_RELATIONS = (
    "m3umovierelation",
    "m3useriesrelation",
    "m3uepisoderelation",
)


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0005_movie_is_adult"),
    ]

    operations = [
        *[
            migrations.AddField(
                model_name=relation,
                name=field,
                field=models.JSONField(default=default, blank=True),
            )
            for relation in SOURCE_RELATIONS
            for field, default in (
                ("declared_metadata", dict),
                ("observed_metadata", dict),
                ("manual_metadata", dict),
                ("locked_fields", list),
            )
        ],
        *[
            migrations.AddField(
                model_name=relation,
                name="last_observed_at",
                field=models.DateTimeField(null=True, blank=True),
            )
            for relation in SOURCE_RELATIONS
        ],
        migrations.AddField(
            model_name="m3umovierelation",
            name="tmdb_override_id",
            field=models.CharField(
                max_length=50,
                blank=True,
                db_index=True,
                help_text="Administrator-selected TMDB ID for this provider source.",
            ),
        ),
        migrations.AddField(
            model_name="m3useriesrelation",
            name="tmdb_override_id",
            field=models.CharField(
                max_length=50,
                blank=True,
                db_index=True,
                help_text="Administrator-selected TMDB ID for this provider source.",
            ),
        ),
        migrations.AddField(
            model_name="m3uvodcategoryrelation",
            name="metadata_defaults",
            field=models.JSONField(
                default=dict,
                blank=True,
                help_text=(
                    "Default DUB, SUB, resolution and features for sources "
                    "in this provider category."
                ),
            ),
        ),
        migrations.AddIndex(
            model_name="m3umovierelation",
            index=models.Index(
                fields=["movie", "category"], name="vod_movie_category_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="m3useriesrelation",
            index=models.Index(
                fields=["series", "category"], name="vod_series_category_idx"
            ),
        ),
        *[
            migrations.AddIndex(
                model_name=relation,
                index=GinIndex(
                    fields=[field],
                    name=f"vod_{label}_rel_{suffix}_gin",
                ),
            )
            for relation, label in (
                ("m3umovierelation", "mov"),
                ("m3useriesrelation", "ser"),
                ("m3uepisoderelation", "ep"),
            )
            for field, suffix in (
                ("manual_metadata", "manual"),
                ("observed_metadata", "observed"),
                ("declared_metadata", "declared"),
            )
        ],
        migrations.AddIndex(
            model_name="m3uvodcategoryrelation",
            index=GinIndex(
                fields=["metadata_defaults"], name="vod_cat_defaults_gin"
            ),
        ),
    ]
