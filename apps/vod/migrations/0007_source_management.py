from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import uuid


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("m3u", "0020_m3ugrouprule"),
        ("vod", "0006_source_variant_indexes"),
    ]

    operations = [
        migrations.CreateModel(
            name="VODSourceAsset",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("asset_type", models.CharField(choices=[("movie", "Movie"), ("series", "Series"), ("episode", "Episode")], max_length=10)),
                ("provider_origin_key", models.CharField(blank=True, db_index=True, max_length=255)),
                ("provider_asset_id", models.CharField(blank=True, db_index=True, max_length=255)),
                ("declared_metadata", models.JSONField(blank=True, default=dict)),
                ("observed_metadata", models.JSONField(blank=True, default=dict)),
                ("manual_metadata", models.JSONField(blank=True, default=dict)),
                ("locked_fields", models.JSONField(blank=True, default=list)),
                ("last_observed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddIndex(model_name="vodsourceasset", index=models.Index(fields=["asset_type", "provider_origin_key", "provider_asset_id"], name="vod_asset_provider_idx")),
        migrations.AddField(model_name="m3umovierelation", name="source_asset", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="movie_relations", to="vod.vodsourceasset")),
        migrations.AddField(model_name="m3useriesrelation", name="source_asset", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="series_relations", to="vod.vodsourceasset")),
        migrations.AddField(model_name="m3uepisoderelation", name="source_asset", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="episode_relations", to="vod.vodsourceasset")),
        migrations.AddField(model_name="m3uvodcategoryrelation", name="metadata_defaults", field=models.JSONField(blank=True, default=dict, help_text="Expected languages, subtitles and quality for newly discovered sources.")),
        migrations.CreateModel(
            name="VODAccessPolicy",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255, unique=True)),
                ("export_mode", models.CharField(choices=[("compact", "Compact"), ("variants", "Source variants")], default="compact", max_length=10)),
                ("is_default", models.BooleanField(default=False)),
                ("is_active", models.BooleanField(default=True)),
                ("hard_constraints", models.JSONField(blank=True, default=dict)),
                ("ranking", models.JSONField(blank=True, default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("users", models.ManyToManyField(blank=True, related_name="vod_access_policies", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("name",)},
        ),
        migrations.CreateModel(
            name="VODPolicyCategory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("enabled", models.BooleanField(default=True)),
                ("priority", models.IntegerField(default=0)),
                ("category_relation", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="vod.m3uvodcategoryrelation")),
                ("policy", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="vod.vodaccesspolicy")),
            ],
            options={"ordering": ("-priority", "id")},
        ),
        migrations.AddConstraint(model_name="vodpolicycategory", constraint=models.UniqueConstraint(fields=("policy", "category_relation"), name="unique_vod_policy_category")),
        migrations.AddField(model_name="vodaccesspolicy", name="category_relations", field=models.ManyToManyField(related_name="access_policies", through="vod.VODPolicyCategory", to="vod.m3uvodcategoryrelation")),
        migrations.CreateModel(
            name="VODPlaybackSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("session_id", models.CharField(max_length=255, unique=True)),
                ("content_type", models.CharField(choices=[("movie", "Movie"), ("series", "Series"), ("episode", "Episode")], max_length=10)),
                ("canonical_id", models.PositiveBigIntegerField(blank=True, null=True)),
                ("relation_id", models.PositiveBigIntegerField(blank=True, null=True)),
                ("provider_asset_id", models.CharField(blank=True, max_length=255)),
                ("content_name", models.CharField(blank=True, max_length=500)),
                ("mode", models.CharField(choices=[("redirect", "Redirect"), ("proxy", "Proxy"), ("player", "Player telemetry")], max_length=10)),
                ("status", models.CharField(choices=[("requested", "Requested"), ("redirected", "Redirected (unconfirmed)"), ("proxying", "Proxying"), ("completed", "Completed"), ("stopped", "Stopped"), ("failed", "Failed")], default="requested", max_length=20)),
                ("client_ip", models.GenericIPAddressField(blank=True, null=True)),
                ("user_agent", models.TextField(blank=True)),
                ("started_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
                ("bytes_sent", models.PositiveBigIntegerField(default=0)),
                ("watched_seconds", models.PositiveIntegerField(default=0)),
                ("observed_metadata", models.JSONField(blank=True, default=dict)),
                ("failover_chain", models.JSONField(blank=True, default=list)),
                ("error", models.TextField(blank=True)),
                ("custom_properties", models.JSONField(blank=True, default=dict)),
                ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="vod.vodcategory")),
                ("m3u_account", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="m3u.m3uaccount")),
                ("source_asset", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="playback_sessions", to="vod.vodsourceasset")),
                ("user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="vod_playback_sessions", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-started_at",)},
        ),
        migrations.AddIndex(model_name="vodplaybacksession", index=models.Index(fields=["user", "-started_at"], name="vod_playback_user_idx")),
        migrations.AddIndex(model_name="vodplaybacksession", index=models.Index(fields=["source_asset", "-started_at"], name="vod_playback_asset_idx")),
    ]
