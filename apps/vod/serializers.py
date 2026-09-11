import re
import string

from rest_framework import serializers
from django.db import transaction
from core.utils import truncate_with_warning
from .image_proxy import vodlogo_cache_url
from .models import (
    Series, VODCategory, Movie, Episode, VODLogo,
    M3USeriesRelation, M3UMovieRelation, M3UEpisodeRelation, M3UVODCategoryRelation,
    VODSourceAsset, VODAccessPolicy, VODPolicyCategory, VODPlaybackSession,
)
from apps.m3u.serializers import M3UAccountSerializer
from .metadata import (
    normalize_language_list,
    normalize_source_metadata,
    relation_declared_metadata,
    summarize_relation_metadata,
    validate_source_metadata,
    normalize_video_features,
)
from .policies import enabled_category_map


class VODLogoSerializer(serializers.ModelSerializer):
    name = serializers.CharField()
    cache_url = serializers.SerializerMethodField()
    movie_count = serializers.SerializerMethodField()
    series_count = serializers.SerializerMethodField()
    is_used = serializers.SerializerMethodField()
    item_names = serializers.SerializerMethodField()

    class Meta:
        model = VODLogo
        fields = ["id", "name", "url", "cache_url", "movie_count", "series_count", "is_used", "item_names"]

    def validate_name(self, value):
        return truncate_with_warning(
            value,
            max_length=VODLogo._meta.get_field("name").max_length,
            label="Logo name",
        )

    def validate_url(self, value):
        """Validate that the URL is unique for creation or update"""
        if self.instance and self.instance.url == value:
            return value

        if VODLogo.objects.filter(url=value).exists():
            raise serializers.ValidationError("A VOD logo with this URL already exists.")

        return value

    def create(self, validated_data):
        """Handle logo creation with proper URL validation"""
        return VODLogo.objects.create(**validated_data)

    def update(self, instance, validated_data):
        """Handle logo updates"""
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance

    def get_cache_url(self, obj):
        return vodlogo_cache_url(self.context.get("request"), obj)

    def get_movie_count(self, obj):
        """Get the number of movies using this logo"""
        return obj.movie.count() if hasattr(obj, 'movie') else 0

    def get_series_count(self, obj):
        """Get the number of series using this logo"""
        return obj.series.count() if hasattr(obj, 'series') else 0

    def get_is_used(self, obj):
        """Check if this logo is used by any movies or series"""
        return (hasattr(obj, 'movie') and obj.movie.exists()) or (hasattr(obj, 'series') and obj.series.exists())

    def get_item_names(self, obj):
        """Get the list of movies and series using this logo"""
        names = []

        if hasattr(obj, 'movie'):
            for movie in obj.movie.all()[:10]:  # Limit to 10 items for performance
                names.append(f"Movie: {movie.name}")

        if hasattr(obj, 'series'):
            for series in obj.series.all()[:10]:  # Limit to 10 items for performance
                names.append(f"Series: {series.name}")

        return names


class M3UVODCategoryRelationSerializer(serializers.ModelSerializer):
    category = serializers.PrimaryKeyRelatedField(read_only=True)
    m3u_account = serializers.PrimaryKeyRelatedField(read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_type = serializers.CharField(
        source="category.category_type", read_only=True
    )
    account_name = serializers.CharField(source="m3u_account.name", read_only=True)

    class Meta:
        model = M3UVODCategoryRelation
        fields = [
            "id", "category", "category_name", "category_type",
            "m3u_account", "account_name", "enabled", "metadata_defaults",
        ]

    def validate_metadata_defaults(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Must be an object")
        allowed = {
            "audio_languages",
            "subtitle_languages",
            "resolution",
            "height",
            "quality",
            "video_features",
        }
        unknown = set(value) - allowed
        if unknown:
            raise serializers.ValidationError(
                f"Unsupported fields: {', '.join(sorted(unknown))}"
            )
        return value


class VODCategorySerializer(serializers.ModelSerializer):
    category_type_display = serializers.CharField(source='get_category_type_display', read_only=True)
    m3u_accounts = M3UVODCategoryRelationSerializer(many=True, source="m3u_relations", read_only=True)

    class Meta:
        model = VODCategory
        fields = [
            "id",
            "name",
            "category_type",
            "category_type_display",
            "m3u_accounts",
        ]

class SeriesSerializer(serializers.ModelSerializer):
    logo = VODLogoSerializer(read_only=True)
    episode_count = serializers.SerializerMethodField()
    source_metadata = serializers.SerializerMethodField()

    class Meta:
        model = Series
        fields = '__all__'

    def get_episode_count(self, obj):
        return obj.episodes.count()

    def get_source_metadata(self, obj):
        return summarize_relation_metadata(obj.m3u_relations.all())


class MovieSerializer(serializers.ModelSerializer):
    logo = VODLogoSerializer(read_only=True)
    source_metadata = serializers.SerializerMethodField()

    class Meta:
        model = Movie
        fields = '__all__'

    def get_source_metadata(self, obj):
        return summarize_relation_metadata(obj.m3u_relations.all())


class EpisodeSerializer(serializers.ModelSerializer):
    series = SeriesSerializer(read_only=True)

    class Meta:
        model = Episode
        fields = '__all__'


class VODSourceRelationMetadataMixin:
    source_metadata = serializers.SerializerMethodField()

    def get_source_metadata(self, obj) -> dict:
        if not hasattr(self, "_source_category_defaults"):
            self._source_category_defaults = enabled_category_map()
        defaults = self._source_category_defaults.get(
            (obj.m3u_account_id, obj.category_id), {}
        )
        declared = relation_declared_metadata(obj)
        if obj.source_asset_id:
            return obj.source_asset.effective_metadata(
                category_defaults=defaults,
                relation_declared=declared,
            )

        values = {}
        provenance = {}
        for source, payload in (("category", defaults), ("relation", declared)):
            for key, value in (payload or {}).items():
                if value not in (None, "", [], {}):
                    values[key] = value
                    provenance[key] = source
        return {
            "values": normalize_source_metadata(values),
            "provenance": provenance,
        }


class M3USeriesRelationSerializer(
    VODSourceRelationMetadataMixin, serializers.ModelSerializer
):
    series = SeriesSerializer(read_only=True)
    category = VODCategorySerializer(read_only=True)
    m3u_account = M3UAccountSerializer(read_only=True)
    source_metadata = serializers.SerializerMethodField()

    class Meta:
        model = M3USeriesRelation
        fields = '__all__'


class M3UMovieRelationSerializer(
    VODSourceRelationMetadataMixin, serializers.ModelSerializer
):
    movie = MovieSerializer(read_only=True)
    category = VODCategorySerializer(read_only=True)
    m3u_account = M3UAccountSerializer(read_only=True)
    quality_info = serializers.SerializerMethodField()
    source_metadata = serializers.SerializerMethodField()

    class Meta:
        model = M3UMovieRelation
        fields = '__all__'

    def get_quality_info(self, obj):
        """Extract quality information from various sources"""
        quality_info = {}

        # 1. Check custom_properties first
        if obj.custom_properties:
            if obj.custom_properties.get('quality'):
                quality_info['quality'] = obj.custom_properties['quality']
                return quality_info
            elif obj.custom_properties.get('resolution'):
                quality_info['resolution'] = obj.custom_properties['resolution']
                return quality_info

        # 2. Try to get detailed info from the movie if available
        movie = obj.movie
        if hasattr(movie, 'video') and movie.video:
            video_data = movie.video
            if isinstance(video_data, dict) and 'width' in video_data and 'height' in video_data:
                width = video_data['width']
                height = video_data['height']
                quality_info['resolution'] = f"{width}x{height}"

                # Convert to common quality names (prioritize width for ultrawide/cinematic content)
                if width >= 3840:
                    quality_info['quality'] = '4K'
                elif width >= 1920:
                    quality_info['quality'] = '1080p'
                elif width >= 1280:
                    quality_info['quality'] = '720p'
                elif width >= 854:
                    quality_info['quality'] = '480p'
                else:
                    quality_info['quality'] = f"{width}x{height}"
                return quality_info

        # 3. Extract from movie name/title
        if movie and movie.name:
            name = movie.name
            if '4K' in name or '2160p' in name:
                quality_info['quality'] = '4K'
                return quality_info
            elif '1080p' in name or 'FHD' in name:
                quality_info['quality'] = '1080p'
                return quality_info
            elif '720p' in name or 'HD' in name:
                quality_info['quality'] = '720p'
                return quality_info
            elif '480p' in name:
                quality_info['quality'] = '480p'
                return quality_info

        # 4. Try bitrate as last resort
        if hasattr(movie, 'bitrate') and movie.bitrate and movie.bitrate > 0:
            bitrate = movie.bitrate
            if bitrate >= 6000:
                quality_info['quality'] = '4K'
            elif bitrate >= 3000:
                quality_info['quality'] = '1080p'
            elif bitrate >= 1500:
                quality_info['quality'] = '720p'
            else:
                quality_info['bitrate'] = f"{round(bitrate/1000)}Mbps"
            return quality_info

        # 5. Fallback - no quality info available
        return None


class M3UEpisodeRelationSerializer(serializers.ModelSerializer):
    episode = EpisodeSerializer(read_only=True)
    m3u_account = M3UAccountSerializer(read_only=True)
    quality_info = serializers.SerializerMethodField()

    class Meta:
        model = M3UEpisodeRelation
        fields = '__all__'

    def get_quality_info(self, obj):
        """Extract quality information from various sources"""
        quality_info = {}

        # 1. Check custom_properties first
        if obj.custom_properties:
            if obj.custom_properties.get('quality'):
                quality_info['quality'] = obj.custom_properties['quality']
                return quality_info
            elif obj.custom_properties.get('resolution'):
                quality_info['resolution'] = obj.custom_properties['resolution']
                return quality_info

        # 2. Try to get detailed info from the episode if available
        episode = obj.episode
        if hasattr(episode, 'video') and episode.video:
            video_data = episode.video
            if isinstance(video_data, dict) and 'width' in video_data and 'height' in video_data:
                width = video_data['width']
                height = video_data['height']
                quality_info['resolution'] = f"{width}x{height}"

                # Convert to common quality names (prioritize width for ultrawide/cinematic content)
                if width >= 3840:
                    quality_info['quality'] = '4K'
                elif width >= 1920:
                    quality_info['quality'] = '1080p'
                elif width >= 1280:
                    quality_info['quality'] = '720p'
                elif width >= 854:
                    quality_info['quality'] = '480p'
                else:
                    quality_info['quality'] = f"{width}x{height}"
                return quality_info

        # 3. Extract from episode name/title
        if episode and episode.name:
            name = episode.name
            if '4K' in name or '2160p' in name:
                quality_info['quality'] = '4K'
                return quality_info
            elif '1080p' in name or 'FHD' in name:
                quality_info['quality'] = '1080p'
                return quality_info
            elif '720p' in name or 'HD' in name:
                quality_info['quality'] = '720p'
                return quality_info
            elif '480p' in name:
                quality_info['quality'] = '480p'
                return quality_info

        # 4. Try bitrate as last resort
        if hasattr(episode, 'bitrate') and episode.bitrate and episode.bitrate > 0:
            bitrate = episode.bitrate
            if bitrate >= 6000:
                quality_info['quality'] = '4K'
            elif bitrate >= 3000:
                quality_info['quality'] = '1080p'
            elif bitrate >= 1500:
                quality_info['quality'] = '720p'
            else:
                quality_info['bitrate'] = f"{round(bitrate/1000)}Mbps"
            return quality_info

        # 5. Fallback - no quality info available
        return None


class VODSourceAssetSerializer(serializers.ModelSerializer):
    effective_metadata = serializers.SerializerMethodField()
    relation_count = serializers.SerializerMethodField()

    class Meta:
        model = VODSourceAsset
        fields = [
            "id", "uuid", "asset_type", "provider_origin_key",
            "provider_asset_id", "declared_metadata", "observed_metadata",
            "manual_metadata", "locked_fields", "last_observed_at",
            "created_at", "updated_at", "effective_metadata", "relation_count",
        ]
        read_only_fields = [
            "id", "uuid", "asset_type", "provider_origin_key",
            "provider_asset_id", "declared_metadata", "observed_metadata",
            "last_observed_at", "created_at", "updated_at",
        ]

    def get_effective_metadata(self, obj) -> dict:
        return obj.effective_metadata()

    def get_relation_count(self, obj) -> int:
        if hasattr(obj, "movie_relation_count"):
            return (
                obj.movie_relation_count
                + obj.series_relation_count
                + obj.episode_relation_count
            )
        return (
            obj.movie_relations.count()
            + obj.series_relations.count()
            + obj.episode_relations.count()
        )


class VODPolicyCategorySerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(
        source="category_relation.category.name", read_only=True
    )
    account_name = serializers.CharField(
        source="category_relation.m3u_account.name", read_only=True
    )

    class Meta:
        model = VODPolicyCategory
        fields = [
            "category_relation", "category_name", "account_name",
            "enabled", "priority",
        ]


class VODAccessPolicySerializer(serializers.ModelSerializer):
    category_rules = VODPolicyCategorySerializer(
        source="vodpolicycategory_set", many=True, required=False
    )
    selection_current = serializers.SerializerMethodField()
    selection_available = serializers.SerializerMethodField()
    selection_task_state = serializers.SerializerMethodField()
    selection_active_mode = serializers.SerializerMethodField()

    class Meta:
        model = VODAccessPolicy
        fields = [
            "id", "name", "export_mode", "is_default", "is_active",
            "hard_constraints", "ranking", "provider_order", "edition_rules",
            "naming_mode", "name_template", "users",
            "category_rules",
            "selection_status", "selection_current", "selection_available",
            "selection_task_state", "selection_active_mode",
            "selection_counts", "selection_progress",
            "active_selection_generation", "selection_catalog_generation",
            "selection_started_at", "selection_completed_at", "selection_error",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "selection_status", "selection_current",
            "selection_available", "selection_task_state", "selection_counts", "selection_progress",
            "active_selection_generation", "selection_catalog_generation",
            "selection_started_at", "selection_completed_at", "selection_error",
            "created_at", "updated_at",
        ]

    def get_selection_current(self, obj):
        active_mode = self.get_selection_active_mode(obj)

        # ``selection_status`` is the lifecycle authority. Every source
        # invalidation either moves a profile to Pending (and publishes a
        # rebuild) or updates its prepared rows synchronously. Re-checking the
        # global source-generation marker here creates a second, eventually
        # consistent state machine: a catalog which was just activated as
        # Ready can then be presented as Outdated even though its rows and
        # counts are complete. Generation comparisons still protect atomic
        # activation inside the builder. Code upgrades must not create an
        # implicit rebuild just because a newly calculated implementation
        # signature differs from a catalog prepared by the previous version.
        return bool(
            obj.selection_status == VODAccessPolicy.SelectionStatus.READY
            and obj.active_selection_generation
            and (not active_mode or active_mode == obj.export_mode)
        )

    def get_selection_active_mode(self, obj):
        """Identify the mode used for the generation currently being served."""
        counts = obj.selection_counts or {}
        stored_mode = counts.get("export_mode")
        valid_modes = {
            VODAccessPolicy.ExportMode.COMPACT,
            VODAccessPolicy.ExportMode.VARIANTS,
        }
        if stored_mode in valid_modes:
            return stored_mode

        # Older generations predate the explicit mode snapshot. Multiple
        # output rows for one canonical title can only be Variants output.
        for content_type in ("movies", "series"):
            content_counts = counts.get(content_type) or {}
            output_entries = content_counts.get("output_entries")
            canonical_titles = content_counts.get("canonical_titles")
            if (
                output_entries is not None
                and canonical_titles is not None
                and int(output_entries) != int(canonical_titles)
            ):
                return VODAccessPolicy.ExportMode.VARIANTS
        return ""

    def get_selection_available(self, obj):
        """Whether a completed generation can still be served or previewed."""
        return bool(obj.active_selection_generation)

    def get_selection_task_state(self, obj):
        if obj.selection_status not in {
            VODAccessPolicy.SelectionStatus.PENDING,
            VODAccessPolicy.SelectionStatus.BUILDING,
        }:
            return ""
        # Database progress is authoritative for a claimed build. The Celery
        # result backend may legitimately answer PENDING after the embedded
        # Redis was restarted even while a recovered worker is actively
        # writing progress heartbeats.
        if obj.selection_status == VODAccessPolicy.SelectionStatus.BUILDING:
            return "RUNNING"
        task_id = (obj.selection_progress or {}).get("task_id")
        if not task_id:
            return "UNPUBLISHED"
        try:
            from celery.result import AsyncResult

            return str(AsyncResult(task_id).state or "PENDING")
        except Exception:
            return "UNKNOWN"

    def _replace_category_rules(self, policy, rules):
        if rules is None:
            return
        policy.vodpolicycategory_set.all().delete()
        VODPolicyCategory.objects.bulk_create([
            VODPolicyCategory(policy=policy, **rule) for rule in rules
        ])
        # ViewSet querysets prefetch the rules.  Without clearing that cache,
        # the response to PATCH still contains the rules from before the
        # replacement even though the database already contains the new set.
        getattr(policy, "_prefetched_objects_cache", {}).pop(
            "vodpolicycategory_set", None
        )

    def validate_ranking(self, value):
        allowed = {
            "audio_language", "subtitle_language", "provider", "resolution",
            "resolution_desc", "resolution_asc", "bitrate_desc",
            "bitrate_asc", "metadata_completeness",
        }
        if not isinstance(value, list) or set(value) - allowed:
            raise serializers.ValidationError(
                "Use only supported failover ranking criteria"
            )
        normalized = [
            "resolution_desc" if item == "resolution" else item
            for item in value
        ]
        resolution_directions = {
            item for item in normalized
            if item in {"resolution_desc", "resolution_asc"}
        }
        if len(resolution_directions) > 1:
            raise serializers.ValidationError(
                "Choose only one resolution ranking direction"
            )
        bitrate_directions = {
            item for item in normalized
            if item in {"bitrate_desc", "bitrate_asc"}
        }
        if len(bitrate_directions) > 1:
            raise serializers.ValidationError(
                "Choose only one bitrate ranking direction"
            )
        return list(dict.fromkeys(normalized))

    def validate_provider_order(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Use a list of M3U account IDs")
        normalized = []
        for raw_account_id in value:
            try:
                account_id = int(raw_account_id)
            except (TypeError, ValueError):
                raise serializers.ValidationError(
                    "Use only positive M3U account IDs"
                )
            if account_id <= 0:
                raise serializers.ValidationError(
                    "Use only positive M3U account IDs"
                )
            if account_id not in normalized:
                normalized.append(account_id)
        return normalized

    def validate_name_template(self, value):
        template = str(value or "").strip()
        allowed = {
            "canonical", "title", "year", "edition", "edition_name",
            "provider", "source", "dub", "sub", "resolution", "format",
        }
        try:
            fields = {
                field_name
                for _literal, field_name, _format_spec, _conversion in (
                    string.Formatter().parse(template)
                )
                if field_name
            }
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))
        if fields - allowed:
            raise serializers.ValidationError(
                "Unsupported placeholders: " + ", ".join(sorted(fields - allowed))
            )
        return template

    def validate(self, attrs):
        attrs = super().validate(attrs)
        export_mode = attrs.get(
            "export_mode",
            getattr(
                self.instance,
                "export_mode",
                VODAccessPolicy.ExportMode.COMPACT,
            ),
        )
        naming_mode = attrs.get(
            "naming_mode",
            getattr(
                self.instance,
                "naming_mode",
                VODAccessPolicy.NamingMode.MODE_DEFAULT,
            ),
        )
        template = attrs.get(
            "name_template",
            getattr(self.instance, "name_template", ""),
        )
        if naming_mode != VODAccessPolicy.NamingMode.TEMPLATE:
            return attrs
        if not template:
            raise serializers.ValidationError(
                {"name_template": "Enter a custom output title format"}
            )
        if export_mode == VODAccessPolicy.ExportMode.COMPACT:
            fields = {
                field_name
                for _literal, field_name, _format_spec, _conversion in (
                    string.Formatter().parse(template)
                )
                if field_name
            }
            compact_fields = {"canonical", "title", "year", "edition"}
            if fields - compact_fields:
                raise serializers.ValidationError(
                    {
                        "name_template": (
                            "Compact output supports only {canonical}, {title}, "
                            "{year}, and {edition}"
                        )
                    }
                )
        return attrs

    def validate_edition_rules(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Must be an ordered list")
        normalized = []
        seen_ids = set()
        seen_matches = set()
        seen_suffixes = set()
        for index, raw_rule in enumerate(value):
            if not isinstance(raw_rule, dict):
                raise serializers.ValidationError(
                    {index: "Must be an object"}
                )
            rule_id = str(raw_rule.get("id") or f"edition-{index}")[:120]
            if rule_id in seen_ids:
                raise serializers.ValidationError({index: "Duplicate rule ID"})
            seen_ids.add(rule_id)
            suffix = str(
                raw_rule.get("title_suffix") or raw_rule.get("name") or ""
            ).strip()[:120]
            if not suffix:
                raise serializers.ValidationError(
                    {index: {"title_suffix": "Enter an output suffix"}}
                )
            suffix_key = suffix.casefold()
            if suffix_key in seen_suffixes:
                raise serializers.ValidationError(
                    {index: {"title_suffix": "Use a unique output suffix"}}
                )
            seen_suffixes.add(suffix_key)
            try:
                min_resolution = max(
                    0, int(raw_rule.get("min_resolution") or 0)
                )
                max_resolution = max(
                    0, int(raw_rule.get("max_resolution") or 0)
                )
            except (TypeError, ValueError):
                raise serializers.ValidationError(
                    {index: "Resolution values must be non-negative integers"}
                )
            if min_resolution and max_resolution and min_resolution > max_resolution:
                raise serializers.ValidationError(
                    {index: "Minimum resolution cannot exceed maximum resolution"}
                )
            audio = normalize_language_list(
                raw_rule.get("required_audio_languages") or []
            )
            subtitles = normalize_language_list(
                raw_rule.get("required_subtitle_languages") or []
            )
            try:
                validate_source_metadata(
                    {"audio_languages": audio, "subtitle_languages": subtitles}
                )
            except ValueError as exc:
                raise serializers.ValidationError({index: str(exc)})
            features = normalize_video_features(
                raw_rule.get("required_video_features") or []
            )
            duplicate_key = (
                min_resolution,
                max_resolution,
                tuple(audio),
                tuple(subtitles),
                tuple(features),
            )
            if duplicate_key in seen_matches:
                raise serializers.ValidationError(
                    {index: "Duplicate edition match"}
                )
            seen_matches.add(duplicate_key)
            normalized.append(
                {
                    "id": rule_id,
                    "name": suffix,
                    "title_suffix": suffix,
                    "enabled": bool(raw_rule.get("enabled", True)),
                    "min_resolution": min_resolution,
                    "max_resolution": max_resolution,
                    "required_audio_languages": audio,
                    "required_subtitle_languages": subtitles,
                    "required_video_features": features,
                }
            )
        return normalized

    def validate_hard_constraints(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Must be an object")
        requested_fields = set(value)
        allowed = {
            "required_audio_languages", "required_subtitle_languages",
            "excluded_audio_languages", "excluded_subtitle_languages",
            "required_video_features", "excluded_video_features",
            "min_resolution", "max_resolution",
            "allow_unknown_metadata", "language_match_mode",
            "source_rules", "category_import_rules",
            "category_default_actions",
        }
        if set(value) - allowed:
            raise serializers.ValidationError("Contains unsupported fields")
        normalized = dict(value)
        source_rules = normalized.pop("source_rules", [])
        category_import_rules = normalized.pop("category_import_rules", None)
        category_default_actions = normalized.pop(
            "category_default_actions", None
        )
        if not isinstance(source_rules, list):
            raise serializers.ValidationError(
                {"source_rules": "Must be an ordered list"}
            )

        if category_import_rules is not None:
            if not isinstance(category_import_rules, list):
                raise serializers.ValidationError(
                    {"category_import_rules": "Must be an ordered list"}
                )
            normalized_category_rules = []
            seen_category_rule_ids = set()
            for index, rule in enumerate(category_import_rules):
                if not isinstance(rule, dict):
                    raise serializers.ValidationError(
                        {"category_import_rules": {index: "Must be an object"}}
                    )
                rule_id = str(rule.get("id") or f"category-rule-{index}")[:120]
                if rule_id in seen_category_rule_ids:
                    raise serializers.ValidationError(
                        {"category_import_rules": {index: "Duplicate rule ID"}}
                    )
                seen_category_rule_ids.add(rule_id)
                scope = str(rule.get("scope") or "")
                if scope not in {"movie", "series"}:
                    raise serializers.ValidationError(
                        {
                            "category_import_rules": {
                                index: {"scope": "Use movie or series"}
                            }
                        }
                    )
                match_field = str(rule.get("match_field") or "group_name")
                if match_field != "group_name":
                    raise serializers.ValidationError(
                        {
                            "category_import_rules": {
                                index: {
                                    "match_field": "VOD profiles match category names"
                                }
                            }
                        }
                    )
                regex_pattern = str(rule.get("regex_pattern") or "")
                try:
                    re.compile(regex_pattern)
                except re.error as exc:
                    raise serializers.ValidationError(
                        {
                            "category_import_rules": {
                                index: {"regex_pattern": str(exc)}
                            }
                        }
                    )
                action = str(rule.get("action") or "disable")
                if action not in {"enable", "disable"}:
                    raise serializers.ValidationError(
                        {
                            "category_import_rules": {
                                index: {"action": "Use enable or disable"}
                            }
                        }
                    )
                raw_account_id = rule.get("m3u_account_id")
                if raw_account_id is None or raw_account_id == "":
                    account_id = None
                else:
                    try:
                        account_id = int(raw_account_id)
                    except (TypeError, ValueError):
                        raise serializers.ValidationError(
                            {
                                "category_import_rules": {
                                    index: {
                                        "m3u_account_id": (
                                            "Use a positive M3U account ID"
                                        )
                                    }
                                }
                            }
                        )
                    if account_id <= 0:
                        raise serializers.ValidationError(
                            {
                                "category_import_rules": {
                                    index: {
                                        "m3u_account_id": (
                                            "Use a positive M3U account ID"
                                        )
                                    }
                                }
                            }
                        )
                normalized_category_rules.append(
                    {
                        "id": rule_id,
                        "scope": scope,
                        "m3u_account_id": account_id,
                        "match_field": "group_name",
                        "regex_pattern": regex_pattern,
                        "action": action,
                        "case_sensitive": bool(
                            rule.get("case_sensitive", False)
                        ),
                        "enabled": bool(rule.get("enabled", True)),
                        "order": index,
                    }
                )
            category_import_rules = normalized_category_rules

        if category_default_actions is not None:
            if not isinstance(category_default_actions, dict):
                raise serializers.ValidationError(
                    {"category_default_actions": "Must be an object"}
                )
            unsupported_scopes = set(category_default_actions) - {
                "movie", "series"
            }
            if unsupported_scopes:
                raise serializers.ValidationError(
                    {
                        "category_default_actions": (
                            "Use only movie and series defaults"
                        )
                    }
                )
            normalized_defaults = {}
            for scope, action in category_default_actions.items():
                action = str(action)
                if action not in {"enable", "disable"}:
                    raise serializers.ValidationError(
                        {
                            "category_default_actions": {
                                scope: "Use enable or disable"
                            }
                        }
                    )
                normalized_defaults[scope] = action
            category_default_actions = normalized_defaults
        for field in (
            "required_audio_languages",
            "required_subtitle_languages",
            "excluded_audio_languages",
            "excluded_subtitle_languages",
        ):
            languages = normalized.get(field, [])
            if not isinstance(languages, list):
                raise serializers.ValidationError(
                    {field: "Must be a list of language codes"}
                )
            normalized[field] = normalize_language_list(languages)
            try:
                validate_source_metadata(
                    {
                        "audio_languages"
                        if field in {
                            "required_audio_languages",
                            "excluded_audio_languages",
                        }
                        else "subtitle_languages": normalized[field]
                    }
                )
            except ValueError as exc:
                raise serializers.ValidationError({field: str(exc)})
        for field in ("required_video_features", "excluded_video_features"):
            features = normalized.get(field, [])
            if not isinstance(features, list):
                raise serializers.ValidationError({field: "Must be a list"})
            normalized[field] = normalize_video_features(features)
        for field in ("min_resolution", "max_resolution"):
            try:
                normalized[field] = max(0, int(normalized.get(field) or 0))
            except (TypeError, ValueError):
                raise serializers.ValidationError(
                    {field: "Must be a non-negative integer"}
                )
        if (
            normalized["min_resolution"]
            and normalized["max_resolution"]
            and normalized["min_resolution"] > normalized["max_resolution"]
        ):
            raise serializers.ValidationError(
                "min_resolution cannot be greater than max_resolution"
            )
        for field in ("allow_unknown_metadata",):
            if field in normalized and not isinstance(normalized[field], bool):
                raise serializers.ValidationError({field: "Must be a boolean"})
        language_match_mode = normalized.get("language_match_mode", "all")
        if language_match_mode not in {"all", "any"}:
            raise serializers.ValidationError(
                {"language_match_mode": "Use either all or any"}
            )
        normalized["language_match_mode"] = language_match_mode
        normalized_rules = []
        seen_stream_filters = set()
        for index, rule in enumerate(source_rules):
            if not isinstance(rule, dict):
                raise serializers.ValidationError(
                    {"source_rules": {index: "Must be an object"}}
                )
            if rule.get("match_field"):
                match_field = str(rule.get("match_field"))
                if match_field not in {"category", "stream"}:
                    raise serializers.ValidationError(
                        {
                            "source_rules": {
                                index: {"match_field": "Use category or stream"}
                            }
                        }
                    )
                regex_pattern = str(rule.get("regex_pattern") or "")
                try:
                    re.compile(regex_pattern)
                except re.error as exc:
                    raise serializers.ValidationError(
                        {"source_rules": {index: {"regex_pattern": str(exc)}}}
                    )
                result = str(rule.get("result") or "include")
                if result not in {"include", "exclude"}:
                    raise serializers.ValidationError(
                        {
                            "source_rules": {
                                index: {"result": "Use include or exclude"}
                            }
                        }
                    )
                audio_languages = normalize_language_list(
                    rule.get("required_audio_languages") or []
                )
                subtitle_languages = normalize_language_list(
                    rule.get("required_subtitle_languages") or []
                )
                try:
                    validate_source_metadata(
                        {
                            "audio_languages": audio_languages,
                            "subtitle_languages": subtitle_languages,
                        }
                    )
                except ValueError as exc:
                    raise serializers.ValidationError(
                        {"source_rules": {index: str(exc)}}
                    )
                video_features = normalize_video_features(
                    rule.get("required_video_features") or []
                )
                duplicate_key = (
                    match_field,
                    regex_pattern,
                    bool(rule.get("case_sensitive", False)),
                    tuple(audio_languages),
                    tuple(subtitle_languages),
                    tuple(video_features),
                )
                if duplicate_key in seen_stream_filters:
                    raise serializers.ValidationError(
                        {"source_rules": {index: "Duplicate VOD stream filter"}}
                    )
                seen_stream_filters.add(duplicate_key)
                normalized_rules.append(
                    {
                        "id": str(rule.get("id") or index),
                        "match_field": match_field,
                        "regex_pattern": regex_pattern,
                        "case_sensitive": bool(rule.get("case_sensitive", False)),
                        "enabled": bool(rule.get("enabled", True)),
                        "required_audio_languages": audio_languages,
                        "required_subtitle_languages": subtitle_languages,
                        "required_video_features": video_features,
                        "result": result,
                    }
                )
                continue

            category_regex = str(rule.get("category_regex") or ".*")
            try:
                re.compile(category_regex)
            except re.error as exc:
                raise serializers.ValidationError(
                    {"source_rules": {index: {"category_regex": str(exc)}}}
                )
            nested = {
                key: item
                for key, item in rule.items()
                if key in allowed and key != "source_rules"
            }
            nested_normalized = self.validate_hard_constraints(nested)
            nested_normalized.pop("source_rules", None)
            normalized_rules.append(
                {
                    "id": str(rule.get("id") or index),
                    "name": str(rule.get("name") or f"Rule {index + 1}")[:120],
                    "category_regex": category_regex,
                    "case_sensitive": bool(rule.get("case_sensitive", False)),
                    "enabled": bool(rule.get("enabled", True)),
                    **nested_normalized,
                }
            )
        normalized["source_rules"] = normalized_rules
        if category_import_rules is not None:
            normalized["category_import_rules"] = category_import_rules
        if category_default_actions is not None:
            normalized["category_default_actions"] = category_default_actions
        configuration_fields = {
            "source_rules", "category_import_rules", "category_default_actions"
        }
        if requested_fields <= configuration_fields and all(
            rule.get("match_field") for rule in normalized_rules
        ):
            return {
                key: normalized[key]
                for key in configuration_fields
                if key in normalized and key in requested_fields
            }
        return normalized

    def _assign_users(self, policy, users):
        if users is None:
            return
        for other in VODAccessPolicy.objects.exclude(pk=policy.pk).filter(
            users__in=users
        ).distinct():
            other.users.remove(*users)
        policy.users.set(users)

    def _normalize_default(self, policy):
        if policy.is_default:
            VODAccessPolicy.objects.exclude(pk=policy.pk).filter(
                is_default=True
            ).update(is_default=False)

    def create(self, validated_data):
        rules = validated_data.pop("vodpolicycategory_set", [])
        users = validated_data.pop("users", [])
        with transaction.atomic():
            policy = VODAccessPolicy.objects.create(**validated_data)
            self._assign_users(policy, users)
            self._normalize_default(policy)
            self._replace_category_rules(policy, rules)
        from .profile_selection import enqueue_profile_selection_rebuild

        enqueue_profile_selection_rebuild(
            policy.pk,
            trigger_reason="A new VOD output profile was created",
        )
        # In normal autocommit mode the task is published before this refresh,
        # so the mutation response contains its real task ID. A caller-owned
        # outer transaction still keeps publication safely deferred to commit.
        policy.refresh_from_db()
        return policy

    def update(self, instance, validated_data):
        rules = validated_data.pop("vodpolicycategory_set", None)
        users = validated_data.pop("users", None)
        with transaction.atomic():
            instance = super().update(instance, validated_data)
            self._assign_users(instance, users)
            self._normalize_default(instance)
            self._replace_category_rules(instance, rules)
        from .profile_selection import enqueue_profile_selection_rebuild

        enqueue_profile_selection_rebuild(
            instance.pk,
            trigger_reason="VOD output profile settings were saved",
        )
        # Read the task identity/status written during publication instead of
        # returning the pre-commit placeholder to the frontend.
        instance.refresh_from_db()
        return instance


class VODPlaybackSessionSerializer(serializers.ModelSerializer):
    content_name = serializers.SerializerMethodField()
    source_effective_metadata = serializers.SerializerMethodField()
    account_name = serializers.CharField(source="m3u_account.name", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = VODPlaybackSession
        fields = "__all__"
        read_only_fields = [
            "id", "session_id", "user", "source_asset", "m3u_account",
            "category", "content_type", "canonical_id", "relation_id",
            "provider_asset_id", "content_name", "mode", "status",
            "client_ip", "user_agent", "started_at", "ended_at",
            "bytes_sent", "watched_seconds", "observed_metadata",
            "failover_chain", "failover_count", "error", "custom_properties",
        ]

    def get_source_effective_metadata(self, obj) -> dict:
        snapshot = (obj.custom_properties or {}).get(
            "source_effective_metadata", {}
        )
        snapshot = normalize_source_metadata(
            snapshot if isinstance(snapshot, dict) else {}
        )
        current = (
            obj.source_asset.effective_metadata()
            if obj.source_asset_id
            else {"values": {}, "provenance": {}}
        )
        return {
            "values": {**snapshot, **current["values"]},
            "provenance": {
                **{field: "playback" for field in snapshot},
                **current["provenance"],
            },
        }

    def get_content_name(self, obj) -> str:
        if obj.content_type != VODSourceAsset.AssetType.EPISODE:
            return obj.content_name
        from .playback import episode_history_name

        return episode_history_name(
            obj.content_name,
            (obj.custom_properties or {}).get("episode_name", ""),
        )


class EnhancedSeriesSerializer(serializers.ModelSerializer):
    """Enhanced serializer for series with provider information"""
    logo = VODLogoSerializer(read_only=True)
    providers = M3USeriesRelationSerializer(source='m3u_relations', many=True, read_only=True)
    episode_count = serializers.SerializerMethodField()

    class Meta:
        model = Series
        fields = '__all__'

    def get_episode_count(self, obj):
        return obj.episodes.count()
