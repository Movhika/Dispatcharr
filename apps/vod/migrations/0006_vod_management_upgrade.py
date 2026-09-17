import time
import uuid

import django.contrib.postgres.indexes
import django.contrib.postgres.operations
import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models
from django.db.models import F


def seed_catalog_state(apps, schema_editor):
    policy_model = apps.get_model("vod", "VODAccessPolicy")
    state_model = apps.get_model("vod", "VODCatalogState")
    generation = (
        policy_model.objects.exclude(selection_catalog_generation="")
        .order_by("-selection_completed_at")
        .values_list("selection_catalog_generation", flat=True)
        .first()
    )
    state_model.objects.update_or_create(
        pk=1,
        defaults={"selection_generation": str(generation or time.time_ns())},
    )


def backfill_library_added_at(apps, schema_editor):
    for model_name in ("Movie", "Series", "Episode"):
        apps.get_model("vod", model_name).objects.update(
            library_added_at=F("created_at")
        )


def create_default_policy(apps, schema_editor):
    policy_model = apps.get_model("vod", "VODAccessPolicy")
    user_model = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    policy_model.objects.filter(is_default=True).update(is_default=False)
    policy, _ = policy_model.objects.update_or_create(
        name="All",
        defaults={
            "export_mode": "compact",
            "is_default": True,
            "is_active": True,
            "hard_constraints": {},
            "ranking": [],
            "naming_mode": "template",
            "name_template": "{title}",
            "metadata_source": "canonical",
            "canonical_title_source": "primary",
        },
    )
    assigned_user_ids = policy_model.users.through.objects.values_list(
        "user_id", flat=True
    )
    policy.users.add(*user_model.objects.exclude(pk__in=assigned_user_ids))


class Migration(migrations.Migration):
    dependencies = [
        ("m3u", "0020_vod_management_upgrade"),
        ("vod", "0005_movie_is_adult"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddIndex(
            model_name='m3useriesrelation',
            index=models.Index(fields=['series', 'category'], name='vod_series_category_idx'),
        ),
        migrations.AddIndex(
            model_name='m3umovierelation',
            index=models.Index(fields=['movie', 'category'], name='vod_movie_category_idx'),
        ),
        migrations.CreateModel(
            name='VODSourceAsset',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('uuid', models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ('asset_type', models.CharField(choices=[('movie', 'Movie'), ('series', 'Series'), ('episode', 'Episode')], max_length=10)),
                ('provider_origin_key', models.CharField(blank=True, db_index=True, max_length=255)),
                ('provider_asset_id', models.CharField(blank=True, db_index=True, max_length=255)),
                ('declared_metadata', models.JSONField(blank=True, default=dict)),
                ('observed_metadata', models.JSONField(blank=True, default=dict)),
                ('manual_metadata', models.JSONField(blank=True, default=dict)),
                ('locked_fields', models.JSONField(blank=True, default=list)),
                ('last_observed_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'indexes': [models.Index(fields=['asset_type', 'provider_origin_key', 'provider_asset_id'], name='vod_asset_provider_idx')],
            },
        ),
        migrations.AddField(
            model_name='m3umovierelation',
            name='source_asset',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='movie_relations', to='vod.vodsourceasset'),
        ),
        migrations.AddField(
            model_name='m3useriesrelation',
            name='source_asset',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='series_relations', to='vod.vodsourceasset'),
        ),
        migrations.AddField(
            model_name='m3uepisoderelation',
            name='source_asset',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='episode_relations', to='vod.vodsourceasset'),
        ),
        migrations.AddField(
            model_name='m3uvodcategoryrelation',
            name='metadata_defaults',
            field=models.JSONField(blank=True, default=dict, help_text='Default DUB, SUB, resolution and features for sources in this provider category.'),
        ),
        migrations.CreateModel(
            name='VODAccessPolicy',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255, unique=True)),
                ('export_mode', models.CharField(choices=[('compact', 'Compact'), ('variants', 'Source variants')], default='compact', max_length=10)),
                ('is_default', models.BooleanField(default=False)),
                ('is_active', models.BooleanField(default=True)),
                ('hard_constraints', models.JSONField(blank=True, default=dict)),
                ('ranking', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('users', models.ManyToManyField(blank=True, related_name='vod_access_policies', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ('name',),
            },
        ),
        migrations.CreateModel(
            name='VODPolicyCategory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('enabled', models.BooleanField(default=True)),
                ('priority', models.IntegerField(default=0)),
                ('category_relation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='vod.m3uvodcategoryrelation')),
                ('policy', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='vod.vodaccesspolicy')),
            ],
            options={
                'ordering': ('-priority', 'id'),
                'constraints': [models.UniqueConstraint(fields=('policy', 'category_relation'), name='unique_vod_policy_category')],
            },
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='category_relations',
            field=models.ManyToManyField(related_name='access_policies', through='vod.VODPolicyCategory', to='vod.m3uvodcategoryrelation'),
        ),
        migrations.CreateModel(
            name='VODPlaybackSession',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('session_id', models.CharField(max_length=255, unique=True)),
                ('content_type', models.CharField(choices=[('movie', 'Movie'), ('series', 'Series'), ('episode', 'Episode')], max_length=10)),
                ('canonical_id', models.PositiveBigIntegerField(blank=True, null=True)),
                ('relation_id', models.PositiveBigIntegerField(blank=True, null=True)),
                ('provider_asset_id', models.CharField(blank=True, max_length=255)),
                ('content_name', models.CharField(blank=True, max_length=500)),
                ('mode', models.CharField(choices=[('redirect', 'Redirect'), ('proxy', 'Proxy'), ('player', 'Player telemetry')], max_length=10)),
                ('status', models.CharField(choices=[('requested', 'Requested'), ('redirected', 'Redirected (unconfirmed)'), ('proxying', 'Proxying'), ('completed', 'Completed'), ('stopped', 'Stopped'), ('failed', 'Failed')], default='requested', max_length=20)),
                ('client_ip', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.TextField(blank=True)),
                ('started_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('ended_at', models.DateTimeField(blank=True, null=True)),
                ('bytes_sent', models.PositiveBigIntegerField(default=0)),
                ('watched_seconds', models.PositiveIntegerField(default=0)),
                ('observed_metadata', models.JSONField(blank=True, default=dict)),
                ('failover_chain', models.JSONField(blank=True, default=list)),
                ('error', models.TextField(blank=True)),
                ('custom_properties', models.JSONField(blank=True, default=dict)),
                ('category', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='vod.vodcategory')),
                ('m3u_account', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='m3u.m3uaccount')),
                ('source_asset', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='playback_sessions', to='vod.vodsourceasset')),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='vod_playback_sessions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ('-started_at',),
                'indexes': [models.Index(fields=['user', '-started_at'], name='vod_playback_user_idx'), models.Index(fields=['source_asset', '-started_at'], name='vod_playback_asset_idx')],
            },
        ),
        migrations.AddIndex(
            model_name='vodsourceasset',
            index=django.contrib.postgres.indexes.GinIndex(fields=['manual_metadata'], name='vod_asset_manual_gin'),
        ),
        migrations.AddIndex(
            model_name='vodsourceasset',
            index=django.contrib.postgres.indexes.GinIndex(fields=['observed_metadata'], name='vod_asset_observed_gin'),
        ),
        migrations.AddIndex(
            model_name='vodsourceasset',
            index=django.contrib.postgres.indexes.GinIndex(fields=['declared_metadata'], name='vod_asset_declared_gin'),
        ),
        migrations.AddIndex(
            model_name='m3uvodcategoryrelation',
            index=django.contrib.postgres.indexes.GinIndex(fields=['metadata_defaults'], name='vod_cat_defaults_gin'),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='active_selection_generation',
            field=models.CharField(blank=True, db_index=True, max_length=32),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='selection_catalog_generation',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='selection_completed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='selection_counts',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='selection_error',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='selection_started_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='selection_status',
            field=models.CharField(choices=[('pending', 'Pending'), ('building', 'Building'), ('ready', 'Ready'), ('failed', 'Failed')], default='pending', max_length=10),
        ),
        migrations.CreateModel(
            name='VODMovieProfileSelection',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('generation', models.CharField(max_length=32)),
                ('effective_metadata', models.JSONField(blank=True, default=dict)),
                ('audio_languages', models.JSONField(blank=True, default=list)),
                ('subtitle_languages', models.JSONField(blank=True, default=list)),
                ('resolution_height', models.PositiveIntegerField(default=0)),
                ('container_extension', models.CharField(blank=True, max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('category', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='vod.vodcategory')),
                ('movie', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='vod.movie')),
                ('policy', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='movie_selections', to='vod.vodaccesspolicy')),
                ('relation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='vod.m3umovierelation')),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('policy', 'generation', 'relation'), name='unique_vod_movie_profile_selection')],
                'indexes': [models.Index(fields=['policy', 'generation', 'category'], name='vod_mov_prof_cat_idx'), models.Index(fields=['policy', 'generation', 'movie'], name='vod_mov_prof_movie_idx'), models.Index(fields=['policy', 'generation', 'resolution_height'], name='vod_mov_prof_res_idx'), django.contrib.postgres.indexes.GinIndex(fields=['audio_languages'], name='vod_mov_prof_audio_gin'), django.contrib.postgres.indexes.GinIndex(fields=['subtitle_languages'], name='vod_mov_prof_sub_gin')],
            },
        ),
        migrations.CreateModel(
            name='VODSeriesProfileSelection',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('generation', models.CharField(max_length=32)),
                ('effective_metadata', models.JSONField(blank=True, default=dict)),
                ('audio_languages', models.JSONField(blank=True, default=list)),
                ('subtitle_languages', models.JSONField(blank=True, default=list)),
                ('resolution_height', models.PositiveIntegerField(default=0)),
                ('container_extension', models.CharField(blank=True, max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('category', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='vod.vodcategory')),
                ('policy', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='series_selections', to='vod.vodaccesspolicy')),
                ('relation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='vod.m3useriesrelation')),
                ('series', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='vod.series')),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('policy', 'generation', 'relation'), name='unique_vod_series_profile_selection')],
                'indexes': [models.Index(fields=['policy', 'generation', 'category'], name='vod_ser_prof_cat_idx'), models.Index(fields=['policy', 'generation', 'series'], name='vod_ser_prof_series_idx'), models.Index(fields=['policy', 'generation', 'resolution_height'], name='vod_ser_prof_res_idx'), django.contrib.postgres.indexes.GinIndex(fields=['audio_languages'], name='vod_ser_prof_audio_gin'), django.contrib.postgres.indexes.GinIndex(fields=['subtitle_languages'], name='vod_ser_prof_sub_gin')],
            },
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='selection_progress',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddIndex(
            model_name='vodplaybacksession',
            index=models.Index(fields=['-started_at'], name='vod_playback_started_idx'),
        ),
        migrations.AddField(
            model_name='movie',
            name='display_name',
            field=models.CharField(blank=True, help_text='Optional canonical title used for compact client output.', max_length=255),
        ),
        migrations.AddField(
            model_name='series',
            name='display_name',
            field=models.CharField(blank=True, help_text='Optional canonical title used for compact client output.', max_length=255),
        ),
        migrations.AddField(
            model_name='vodplaybacksession',
            name='failover_count',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='provider_order',
            field=models.JSONField(blank=True, default=list, help_text='Profile-specific M3U account preference from highest to lowest. Unlisted accounts remain eligible behind listed accounts.'),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='edition_rules',
            field=models.JSONField(blank=True, default=list, help_text='Ordered first-match rules that classify eligible sources into editions without changing their source categories.'),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='naming_mode',
            field=models.CharField(choices=[('mode_default', 'Default for output mode'), ('provider', 'Provider title'), ('canonical', 'Canonical title and edition'), ('template', 'Custom template')], default='mode_default', max_length=20),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='name_template',
            field=models.CharField(blank=True, default='{canonical} {edition}', help_text='Output title template used when naming_mode is template.', max_length=500),
        ),
        migrations.AddField(
            model_name='vodmovieprofileselection',
            name='edition_key',
            field=models.CharField(blank=True, db_index=True, max_length=48),
        ),
        migrations.AddField(
            model_name='vodmovieprofileselection',
            name='edition_name',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='vodmovieprofileselection',
            name='edition_suffix',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='vodmovieprofileselection',
            name='output_name',
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name='vodseriesprofileselection',
            name='edition_key',
            field=models.CharField(blank=True, db_index=True, max_length=48),
        ),
        migrations.AddField(
            model_name='vodseriesprofileselection',
            name='edition_name',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='vodseriesprofileselection',
            name='edition_suffix',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='vodseriesprofileselection',
            name='output_name',
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.CreateModel(
            name='VODCatalogState',
            fields=[
                ('id', models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ('selection_generation', models.CharField(max_length=64)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'VOD catalog state',
                'verbose_name_plural': 'VOD catalog state',
            },
        ),
        migrations.RunPython(
            code=seed_catalog_state,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AddField(
            model_name='movie',
            name='library_added_at',
            field=models.DateTimeField(db_index=True, default=django.utils.timezone.now, help_text='First time this canonical movie was imported into the VOD library. Provider refreshes must not change this value.'),
        ),
        migrations.AddField(
            model_name='series',
            name='library_added_at',
            field=models.DateTimeField(db_index=True, default=django.utils.timezone.now, help_text='First time this canonical series was imported into the VOD library. Provider refreshes must not change this value.'),
        ),
        migrations.AddField(
            model_name='episode',
            name='library_added_at',
            field=models.DateTimeField(db_index=True, default=django.utils.timezone.now, help_text='First time this canonical episode was imported into the VOD library. Provider refreshes must not change this value.'),
        ),
        migrations.RunPython(
            code=backfill_library_added_at,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AddField(
            model_name='movie',
            name='tmdb_metadata',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='movie',
            name='tmdb_status',
            field=models.CharField(blank=True, db_index=True, max_length=16),
        ),
        migrations.AddField(
            model_name='movie',
            name='tmdb_enriched_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='movie',
            name='tmdb_enrichment_signature',
            field=models.CharField(blank=True, db_index=True, help_text='Persistent automatic cleanup and TMDB processing lock.', max_length=64),
        ),
        migrations.AddField(
            model_name='series',
            name='tmdb_metadata',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='series',
            name='tmdb_status',
            field=models.CharField(blank=True, db_index=True, max_length=16),
        ),
        migrations.AddField(
            model_name='series',
            name='tmdb_enriched_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='series',
            name='tmdb_enrichment_signature',
            field=models.CharField(blank=True, db_index=True, help_text='Persistent automatic cleanup and TMDB processing lock.', max_length=64),
        ),
        migrations.AddField(
            model_name='movie',
            name='tmdb_match_id',
            field=models.CharField(blank=True, db_index=True, max_length=50),
        ),
        migrations.AddField(
            model_name='series',
            name='tmdb_match_id',
            field=models.CharField(blank=True, db_index=True, max_length=50),
        ),
        migrations.AddField(
            model_name='movie',
            name='tmdb_imdb_id',
            field=models.CharField(blank=True, db_index=True, max_length=50),
        ),
        migrations.AddField(
            model_name='series',
            name='tmdb_imdb_id',
            field=models.CharField(blank=True, db_index=True, max_length=50),
        ),
        migrations.AddField(
            model_name='movie',
            name='tmdb_poster_url',
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name='series',
            name='tmdb_poster_url',
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name='movie',
            name='tmdb_backdrop_url',
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name='series',
            name='tmdb_backdrop_url',
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.CreateModel(
            name='VODMetadataState',
            fields=[
                ('id', models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ('status', models.CharField(choices=[('idle', 'Idle'), ('queued', 'Queued'), ('running', 'Running'), ('complete', 'Complete'), ('failed', 'Failed')], default='idle', max_length=12)),
                ('task_id', models.CharField(blank=True, max_length=255)),
                ('rebuild_profiles_after_completion', models.BooleanField(default=False)),
                ('progress', models.JSONField(blank=True, default=dict)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('error', models.TextField(blank=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('rerun_requested', models.BooleanField(default=False)),
            ],
            options={
                'verbose_name': 'VOD metadata state',
                'verbose_name_plural': 'VOD metadata state',
            },
        ),
        migrations.AddField(
            model_name='m3umovierelation',
            name='tmdb_override_id',
            field=models.CharField(blank=True, db_index=True, help_text='Administrator-selected TMDB ID for this provider source.', max_length=50),
        ),
        migrations.AddField(
            model_name='m3useriesrelation',
            name='tmdb_override_id',
            field=models.CharField(blank=True, db_index=True, help_text='Administrator-selected TMDB ID for this provider source.', max_length=50),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='metadata_source',
            field=models.CharField(choices=[('provider', 'Provider metadata'), ('canonical', 'Canonical / TMDB metadata')], default='provider', help_text='Metadata projected to clients for variants output. Compact always uses canonical metadata.', max_length=16),
        ),
        migrations.AlterField(
            model_name='vodaccesspolicy',
            name='selection_status',
            field=models.CharField(choices=[('pending', 'Pending'), ('building', 'Building'), ('ready', 'Ready'), ('outdated', 'Outdated'), ('failed', 'Failed')], default='pending', max_length=10),
        ),
        django.contrib.postgres.operations.TrigramExtension(
        ),
        migrations.RunSQL(
            sql="CREATE INDEX IF NOT EXISTS vod_movie_title_trgm ON vod_movie USING gin ((lower(COALESCE(NULLIF(display_name, ''), name))) gin_trgm_ops)",
            reverse_sql='DROP INDEX IF EXISTS vod_movie_title_trgm',
        ),
        migrations.RunSQL(
            sql="CREATE INDEX IF NOT EXISTS vod_series_title_trgm ON vod_series USING gin ((lower(COALESCE(NULLIF(display_name, ''), name))) gin_trgm_ops)",
            reverse_sql='DROP INDEX IF EXISTS vod_series_title_trgm',
        ),
        migrations.AlterField(
            model_name='vodaccesspolicy',
            name='naming_mode',
            field=models.CharField(choices=[('mode_default', 'Default for output mode'), ('provider', 'Provider title'), ('canonical', 'Canonical title and edition'), ('template', 'Custom template')], default='template', max_length=20),
        ),
        migrations.AlterField(
            model_name='vodaccesspolicy',
            name='name_template',
            field=models.CharField(blank=True, default='{title} ({year}) {edition}', help_text='Output title template used when naming_mode is template.', max_length=500),
        ),
        migrations.AlterField(
            model_name='vodaccesspolicy',
            name='metadata_source',
            field=models.CharField(choices=[('provider', 'Provider metadata'), ('canonical', 'Canonical / TMDB metadata')], default='provider', help_text='Descriptive metadata projected to clients independently of the selected output title.', max_length=16),
        ),
        migrations.AddField(
            model_name='vodaccesspolicy',
            name='canonical_title_source',
            field=models.CharField(choices=[('primary', 'Primary canonical title'), ('secondary', 'Secondary canonical title'), ('provider', 'Provider title')], default='primary', help_text='Title represented by the {title} output placeholder. Provider titles are available only for variants output.', max_length=10),
        ),
        migrations.AddField(
            model_name='movie',
            name='clean_title',
            field=models.CharField(blank=True, help_text='Rule-derived title used for TMDB lookup and title fallback.', max_length=255),
        ),
        migrations.AddField(
            model_name='movie',
            name='tmdb_lookup_excluded',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='series',
            name='clean_title',
            field=models.CharField(blank=True, help_text='Rule-derived title used for TMDB lookup and title fallback.', max_length=255),
        ),
        migrations.AddField(
            model_name='series',
            name='tmdb_lookup_excluded',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.RunPython(
            code=create_default_policy,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
