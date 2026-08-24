from rest_framework import serializers
from django.db import transaction
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
)
from .policies import enabled_category_map


class VODLogoSerializer(serializers.ModelSerializer):
    cache_url = serializers.SerializerMethodField()
    movie_count = serializers.SerializerMethodField()
    series_count = serializers.SerializerMethodField()
    is_used = serializers.SerializerMethodField()
    item_names = serializers.SerializerMethodField()

    class Meta:
        model = VODLogo
        fields = ["id", "name", "url", "cache_url", "movie_count", "series_count", "is_used", "item_names"]

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

    class Meta:
        model = VODAccessPolicy
        fields = [
            "id", "name", "export_mode", "is_default", "is_active",
            "hard_constraints", "ranking", "users", "category_rules",
            "selection_status", "selection_current", "selection_available",
            "selection_counts", "selection_progress",
            "selection_started_at", "selection_completed_at", "selection_error",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "selection_status", "selection_current",
            "selection_available", "selection_counts", "selection_progress",
            "selection_started_at", "selection_completed_at", "selection_error",
            "created_at", "updated_at",
        ]

    def get_selection_current(self, obj):
        from .catalog_cache import selection_catalog_generation

        return bool(
            obj.selection_status == VODAccessPolicy.SelectionStatus.READY
            and obj.active_selection_generation
            and obj.selection_catalog_generation
            == str(selection_catalog_generation())
        )

    def get_selection_available(self, obj):
        """Whether a completed generation can still be served or previewed."""
        return bool(obj.active_selection_generation)

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
        allowed = {"audio_language", "subtitle_language", "resolution"}
        if not isinstance(value, list) or set(value) - allowed:
            raise serializers.ValidationError(
                "Use only audio_language, subtitle_language, and resolution"
            )
        return list(dict.fromkeys(value))

    def validate_hard_constraints(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Must be an object")
        allowed = {
            "required_audio_languages", "required_subtitle_languages",
            "min_resolution", "max_resolution",
            "allow_unknown_metadata", "language_match_mode",
        }
        if set(value) - allowed:
            raise serializers.ValidationError("Contains unsupported fields")
        normalized = dict(value)
        for field in ("required_audio_languages", "required_subtitle_languages"):
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
                        if field == "required_audio_languages"
                        else "subtitle_languages": normalized[field]
                    }
                )
            except ValueError as exc:
                raise serializers.ValidationError({field: str(exc)})
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

    @transaction.atomic
    def create(self, validated_data):
        rules = validated_data.pop("vodpolicycategory_set", [])
        users = validated_data.pop("users", [])
        policy = VODAccessPolicy.objects.create(**validated_data)
        self._assign_users(policy, users)
        self._normalize_default(policy)
        self._replace_category_rules(policy, rules)
        from .profile_selection import enqueue_profile_selection_rebuild

        enqueue_profile_selection_rebuild(policy.pk)
        return policy

    @transaction.atomic
    def update(self, instance, validated_data):
        rules = validated_data.pop("vodpolicycategory_set", None)
        users = validated_data.pop("users", None)
        instance = super().update(instance, validated_data)
        self._assign_users(instance, users)
        self._normalize_default(instance)
        self._replace_category_rules(instance, rules)
        from .profile_selection import enqueue_profile_selection_rebuild

        enqueue_profile_selection_rebuild(instance.pk)
        # enqueue_profile_selection_rebuild updates status/progress with a
        # queryset update, so refresh both those fields and any prefetched
        # category rules before DRF serializes the mutation response.
        instance.refresh_from_db()
        return instance


class VODPlaybackSessionSerializer(serializers.ModelSerializer):
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
            "failover_chain", "error", "custom_properties",
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
