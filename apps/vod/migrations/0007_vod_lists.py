import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("vod", "0006_vod_management_upgrade"),
    ]

    operations = [
        migrations.CreateModel(
            name="VODList",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255, unique=True)),
                ("description", models.TextField(blank=True)),
                ("list_type", models.CharField(choices=[("manual", "Manual"), ("dynamic", "Dynamic rules"), ("external", "External provider"), ("system", "System")], default="manual", max_length=12)),
                ("content_type", models.CharField(choices=[("all", "Movies and series"), ("movie", "Movies"), ("series", "Series")], default="all", max_length=10)),
                ("provider", models.CharField(blank=True, help_text="Integration identifier such as tmdb, mdblist, trakt or simkl. It remains open-ended so new providers do not require a schema change.", max_length=32)),
                ("external_key", models.CharField(blank=True, help_text="Provider-specific list identifier.", max_length=255)),
                ("rules", models.JSONField(blank=True, default=list)),
                ("settings", models.JSONField(blank=True, default=dict)),
                ("active_generation", models.PositiveBigIntegerField(default=1)),
                ("is_enabled", models.BooleanField(default=True)),
                ("is_visible", models.BooleanField(default=True)),
                ("is_system", models.BooleanField(default=False)),
                ("sort_order", models.IntegerField(default=0)),
                ("sync_status", models.CharField(choices=[("idle", "Idle"), ("queued", "Queued"), ("running", "Running"), ("complete", "Complete"), ("failed", "Failed")], default="idle", max_length=12)),
                ("sync_progress", models.JSONField(blank=True, default=dict)),
                ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                ("sync_error", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ("sort_order", "name", "id"),
                "indexes": [
                    models.Index(fields=["is_enabled", "sort_order"], name="vod_list_enabled_order_idx"),
                    models.Index(fields=["provider", "external_key"], name="vod_list_external_idx"),
                ],
            },
        ),
        migrations.CreateModel(
            name="VODListItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("generation", models.PositiveBigIntegerField(default=1)),
                ("content_type", models.CharField(choices=[("movie", "Movie"), ("series", "Series")], max_length=10)),
                ("include_all_sources", models.BooleanField(default=False, help_text="Include every otherwise eligible source for the canonical title. When false, source memberships identify the exact variants.")),
                ("external_provider", models.CharField(blank=True, max_length=32)),
                ("external_id", models.CharField(blank=True, max_length=255)),
                ("title", models.CharField(blank=True, max_length=500)),
                ("year", models.IntegerField(blank=True, null=True)),
                ("poster_url", models.CharField(blank=True, max_length=1000)),
                ("position", models.PositiveIntegerField(default=0)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("list", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="items", to="vod.vodlist")),
                ("movie", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="vod_list_items", to="vod.movie")),
                ("series", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="vod_list_items", to="vod.series")),
            ],
            options={
                "ordering": ("position", "id"),
                "indexes": [
                    models.Index(fields=["list", "generation", "position"], name="vod_list_item_order_idx"),
                    models.Index(fields=["external_provider", "external_id"], name="vod_list_item_external_idx"),
                ],
            },
        ),
        migrations.CreateModel(
            name="VODListSourceMembership",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("item", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="source_memberships", to="vod.vodlistitem")),
                ("movie_relation", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="vod_list_memberships", to="vod.m3umovierelation")),
                ("series_relation", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="vod_list_memberships", to="vod.m3useriesrelation")),
            ],
        ),
        migrations.AddConstraint(
            model_name="vodlistitem",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(content_type="movie", series__isnull=True)
                    | models.Q(content_type="series", movie__isnull=True)
                ),
                name="vod_list_item_content_fk",
            ),
        ),
        migrations.AddConstraint(
            model_name="vodlistitem",
            constraint=models.UniqueConstraint(
                condition=models.Q(movie__isnull=False),
                fields=("list", "generation", "movie"),
                name="unique_vod_list_movie_generation",
            ),
        ),
        migrations.AddConstraint(
            model_name="vodlistitem",
            constraint=models.UniqueConstraint(
                condition=models.Q(series__isnull=False),
                fields=("list", "generation", "series"),
                name="unique_vod_list_series_generation",
            ),
        ),
        migrations.AddConstraint(
            model_name="vodlistitem",
            constraint=models.UniqueConstraint(
                condition=~models.Q(external_id=""),
                fields=("list", "generation", "content_type", "external_provider", "external_id"),
                name="unique_vod_list_external_generation",
            ),
        ),
        migrations.AddConstraint(
            model_name="vodlistsourcemembership",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(movie_relation__isnull=False, series_relation__isnull=True)
                    | models.Q(movie_relation__isnull=True, series_relation__isnull=False)
                ),
                name="vod_list_membership_one_source",
            ),
        ),
        migrations.AddConstraint(
            model_name="vodlistsourcemembership",
            constraint=models.UniqueConstraint(
                condition=models.Q(movie_relation__isnull=False),
                fields=("item", "movie_relation"),
                name="unique_vod_list_movie_source",
            ),
        ),
        migrations.AddConstraint(
            model_name="vodlistsourcemembership",
            constraint=models.UniqueConstraint(
                condition=models.Q(series_relation__isnull=False),
                fields=("item", "series_relation"),
                name="unique_vod_list_series_source",
            ),
        ),
    ]
