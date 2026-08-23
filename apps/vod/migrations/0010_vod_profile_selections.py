import django.contrib.postgres.indexes
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("vod", "0009_source_metadata_gin_indexes")]

    operations = [
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="active_selection_generation",
            field=models.CharField(blank=True, db_index=True, max_length=32),
        ),
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="selection_catalog_generation",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="selection_completed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="selection_counts",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="selection_error",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="selection_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="selection_status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("building", "Building"),
                    ("ready", "Ready"),
                    ("failed", "Failed"),
                ],
                default="pending",
                max_length=10,
            ),
        ),
        migrations.CreateModel(
            name="VODMovieProfileSelection",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("generation", models.CharField(max_length=32)),
                ("effective_metadata", models.JSONField(blank=True, default=dict)),
                ("audio_languages", models.JSONField(blank=True, default=list)),
                ("subtitle_languages", models.JSONField(blank=True, default=list)),
                ("resolution_height", models.PositiveIntegerField(default=0)),
                ("container_extension", models.CharField(blank=True, max_length=10)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="vod.vodcategory")),
                ("movie", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="vod.movie")),
                ("policy", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="movie_selections", to="vod.vodaccesspolicy")),
                ("relation", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="vod.m3umovierelation")),
            ],
        ),
        migrations.CreateModel(
            name="VODSeriesProfileSelection",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("generation", models.CharField(max_length=32)),
                ("effective_metadata", models.JSONField(blank=True, default=dict)),
                ("audio_languages", models.JSONField(blank=True, default=list)),
                ("subtitle_languages", models.JSONField(blank=True, default=list)),
                ("resolution_height", models.PositiveIntegerField(default=0)),
                ("container_extension", models.CharField(blank=True, max_length=10)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="vod.vodcategory")),
                ("policy", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="series_selections", to="vod.vodaccesspolicy")),
                ("relation", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="vod.m3useriesrelation")),
                ("series", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="vod.series")),
            ],
        ),
        migrations.AddConstraint(
            model_name="vodmovieprofileselection",
            constraint=models.UniqueConstraint(fields=("policy", "generation", "relation"), name="unique_vod_movie_profile_selection"),
        ),
        migrations.AddConstraint(
            model_name="vodseriesprofileselection",
            constraint=models.UniqueConstraint(fields=("policy", "generation", "relation"), name="unique_vod_series_profile_selection"),
        ),
        migrations.AddIndex(model_name="vodmovieprofileselection", index=models.Index(fields=["policy", "generation", "category"], name="vod_mov_prof_cat_idx")),
        migrations.AddIndex(model_name="vodmovieprofileselection", index=models.Index(fields=["policy", "generation", "movie"], name="vod_mov_prof_movie_idx")),
        migrations.AddIndex(model_name="vodmovieprofileselection", index=models.Index(fields=["policy", "generation", "resolution_height"], name="vod_mov_prof_res_idx")),
        migrations.AddIndex(model_name="vodmovieprofileselection", index=django.contrib.postgres.indexes.GinIndex(fields=["audio_languages"], name="vod_mov_prof_audio_gin")),
        migrations.AddIndex(model_name="vodmovieprofileselection", index=django.contrib.postgres.indexes.GinIndex(fields=["subtitle_languages"], name="vod_mov_prof_sub_gin")),
        migrations.AddIndex(model_name="vodseriesprofileselection", index=models.Index(fields=["policy", "generation", "category"], name="vod_ser_prof_cat_idx")),
        migrations.AddIndex(model_name="vodseriesprofileselection", index=models.Index(fields=["policy", "generation", "series"], name="vod_ser_prof_series_idx")),
        migrations.AddIndex(model_name="vodseriesprofileselection", index=models.Index(fields=["policy", "generation", "resolution_height"], name="vod_ser_prof_res_idx")),
        migrations.AddIndex(model_name="vodseriesprofileselection", index=django.contrib.postgres.indexes.GinIndex(fields=["audio_languages"], name="vod_ser_prof_audio_gin")),
        migrations.AddIndex(model_name="vodseriesprofileselection", index=django.contrib.postgres.indexes.GinIndex(fields=["subtitle_languages"], name="vod_ser_prof_sub_gin")),
    ]
