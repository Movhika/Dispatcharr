from django.db import models
from django.db.models import Q
from django.contrib.postgres.indexes import GinIndex
from django.utils import timezone
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from apps.m3u.models import M3UAccount
from django.conf import settings
import uuid


class VODLogo(models.Model):
    """Logo model specifically for VOD content (movies and series)"""
    name = models.CharField(max_length=255)
    url = models.TextField(unique=True)

    def __str__(self):
        return self.name

    class Meta:
        verbose_name = 'VOD Logo'
        verbose_name_plural = 'VOD Logos'


class VODCategory(models.Model):
    """Categories for organizing VODs (e.g., Action, Comedy, Drama)"""

    CATEGORY_TYPE_CHOICES = [
        ('movie', 'Movie'),
        ('series', 'Series'),
    ]

    name = models.CharField(max_length=255)
    category_type = models.CharField(
        max_length=10,
        choices=CATEGORY_TYPE_CHOICES,
        default='movie',
        help_text="Type of content this category contains"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'VOD Category'
        verbose_name_plural = 'VOD Categories'
        ordering = ['name']
        unique_together = [('name', 'category_type')]

    @classmethod
    def bulk_create_and_fetch(cls, objects, ignore_conflicts=False):
        # Perform the bulk create operation
        cls.objects.bulk_create(objects, ignore_conflicts=ignore_conflicts)

        # Use the unique fields to fetch the created objects
        # Since we have unique_together on ('name', 'category_type'), we need both fields
        filter_conditions = []
        for obj in objects:
            filter_conditions.append(
                Q(name=obj.name, category_type=obj.category_type)
            )

        if filter_conditions:
            # Combine all conditions with OR
            combined_condition = filter_conditions[0]
            for condition in filter_conditions[1:]:
                combined_condition |= condition

            created_objects = cls.objects.filter(combined_condition)
        else:
            created_objects = cls.objects.none()

        return created_objects

    def __str__(self):
        return f"{self.name} ({self.get_category_type_display()})"


class Series(models.Model):
    """Series information for TV shows"""
    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    name = models.CharField(max_length=255)
    display_name = models.CharField(
        max_length=255,
        blank=True,
        help_text="Optional canonical title used for compact client output.",
    )
    description = models.TextField(blank=True, null=True)
    year = models.IntegerField(blank=True, null=True)
    rating = models.CharField(max_length=10, blank=True, null=True)
    genre = models.CharField(max_length=255, blank=True, null=True)
    logo = models.ForeignKey(VODLogo, on_delete=models.SET_NULL, null=True, blank=True, related_name='series')

    # Metadata IDs for deduplication - these should be globally unique when present
    tmdb_id = models.CharField(max_length=50, blank=True, null=True, unique=True, help_text="TMDB ID for metadata")
    imdb_id = models.CharField(max_length=50, blank=True, null=True, unique=True, help_text="IMDB ID for metadata")

    # Additional metadata and properties
    custom_properties = models.JSONField(blank=True, null=True, help_text='Additional metadata and properties for the series')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Series'
        verbose_name_plural = 'Series'
        ordering = ['name']
        # Only enforce name+year uniqueness when no external IDs are present
        constraints = [
            models.UniqueConstraint(
                fields=['name', 'year'],
                condition=models.Q(tmdb_id__isnull=True) & models.Q(imdb_id__isnull=True),
                name='unique_series_name_year_no_external_id'
            ),
        ]

    def __str__(self):
        year_str = f" ({self.year})" if self.year else ""
        return f"{self.name}{year_str}"


class Movie(models.Model):
    """Movie content"""
    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    name = models.CharField(max_length=255)
    display_name = models.CharField(
        max_length=255,
        blank=True,
        help_text="Optional canonical title used for compact client output.",
    )
    description = models.TextField(blank=True, null=True)
    year = models.IntegerField(blank=True, null=True)
    rating = models.CharField(max_length=10, blank=True, null=True)
    genre = models.CharField(max_length=255, blank=True, null=True)
    duration_secs = models.IntegerField(blank=True, null=True, help_text="Duration in seconds")
    logo = models.ForeignKey(VODLogo, on_delete=models.SET_NULL, null=True, blank=True, related_name='movie')

    # Metadata IDs for deduplication - these should be globally unique when present
    tmdb_id = models.CharField(max_length=50, blank=True, null=True, unique=True, help_text="TMDB ID for metadata")
    imdb_id = models.CharField(max_length=50, blank=True, null=True, unique=True, help_text="IMDB ID for metadata")

    is_adult = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Whether this movie contains adult content",
    )

    # Additional metadata and properties
    custom_properties = models.JSONField(blank=True, null=True, help_text='Additional metadata and properties for the movie')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Movie'
        verbose_name_plural = 'Movies'
        ordering = ['name']
        # Only enforce name+year uniqueness when no external IDs are present
        constraints = [
            models.UniqueConstraint(
                fields=['name', 'year'],
                condition=models.Q(tmdb_id__isnull=True) & models.Q(imdb_id__isnull=True),
                name='unique_movie_name_year_no_external_id'
            ),
        ]

    def __str__(self):
        year_str = f" ({self.year})" if self.year else ""
        return f"{self.name}{year_str}"


class Episode(models.Model):
    """Episode content for TV series"""
    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    air_date = models.DateField(blank=True, null=True)
    rating = models.CharField(max_length=10, blank=True, null=True)
    duration_secs = models.IntegerField(blank=True, null=True, help_text="Duration in seconds")

    # Episode specific fields
    series = models.ForeignKey(Series, on_delete=models.CASCADE, related_name='episodes')
    season_number = models.IntegerField(blank=True, null=True)
    episode_number = models.IntegerField(blank=True, null=True)

    # Metadata IDs
    tmdb_id = models.CharField(max_length=50, blank=True, null=True, help_text="TMDB ID for metadata", db_index=True)
    imdb_id = models.CharField(max_length=50, blank=True, null=True, help_text="IMDB ID for metadata", db_index=True)

    # Custom properties for episode
    custom_properties = models.JSONField(blank=True, null=True, help_text="Custom properties for this episode")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Episode'
        verbose_name_plural = 'Episodes'
        ordering = ['series__name', 'season_number', 'episode_number']
        unique_together = [
            ('series', 'season_number', 'episode_number'),
        ]

    def __str__(self):
        season_ep = f"S{self.season_number or 0:02d}E{self.episode_number or 0:02d}"
        return f"{self.series.name} - {season_ep} - {self.name}"


class VODSourceAsset(models.Model):
    """A concrete media edition shared by one or more account relations.

    Relations are never merged merely because provider XC IDs collide. An
    asset is shared only after an explicit alias operation or a future trusted
    fingerprint match.
    """

    class AssetType(models.TextChoices):
        MOVIE = "movie", "Movie"
        SERIES = "series", "Series"
        EPISODE = "episode", "Episode"

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    asset_type = models.CharField(max_length=10, choices=AssetType.choices)
    provider_origin_key = models.CharField(max_length=255, blank=True, db_index=True)
    provider_asset_id = models.CharField(max_length=255, blank=True, db_index=True)
    declared_metadata = models.JSONField(default=dict, blank=True)
    observed_metadata = models.JSONField(default=dict, blank=True)
    manual_metadata = models.JSONField(default=dict, blank=True)
    locked_fields = models.JSONField(default=list, blank=True)
    last_observed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(
                fields=("asset_type", "provider_origin_key", "provider_asset_id"),
                name="vod_asset_provider_idx",
            ),
            GinIndex(fields=("manual_metadata",), name="vod_asset_manual_gin"),
            GinIndex(fields=("observed_metadata",), name="vod_asset_observed_gin"),
            GinIndex(fields=("declared_metadata",), name="vod_asset_declared_gin"),
        ]

    def effective_metadata(self, category_defaults=None, relation_declared=None):
        """Resolve metadata and per-field provenance in priority order."""
        from .metadata import normalize_source_metadata

        values = {}
        provenance = {}
        for source, payload in (
            ("category", category_defaults or {}),
            ("provider", self.declared_metadata or {}),
            ("relation", relation_declared or {}),
            ("observed", self.observed_metadata or {}),
            ("manual", self.manual_metadata or {}),
        ):
            for key, value in payload.items():
                if value not in (None, "", [], {}):
                    values[key] = value
                    provenance[key] = source
        return {
            "values": normalize_source_metadata(values),
            "provenance": provenance,
        }

    def apply_observation(self, metadata):
        """Apply playback telemetry without overwriting manual fields."""
        from .metadata import normalize_source_metadata

        metadata = normalize_source_metadata(metadata)
        manual = self.manual_metadata or {}
        locked = set(self.locked_fields or []) | set(manual)
        observed = dict(self.observed_metadata or {})
        changed = False
        for key, value in (metadata or {}).items():
            if key in locked or value in (None, "", [], {}):
                continue
            if observed.get(key) != value:
                observed[key] = value
                changed = True
        if changed:
            self.observed_metadata = observed
            self.last_observed_at = timezone.now()
            self.save(update_fields=["observed_metadata", "last_observed_at", "updated_at"])
        return changed


class VODAccessPolicy(models.Model):
    """Per-user XC visibility, compact selection and failover policy."""

    class ExportMode(models.TextChoices):
        COMPACT = "compact", "Compact"
        VARIANTS = "variants", "Source variants"

    class SelectionStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        BUILDING = "building", "Building"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    name = models.CharField(max_length=255, unique=True)
    export_mode = models.CharField(
        max_length=10,
        choices=ExportMode.choices,
        default=ExportMode.COMPACT,
    )
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    hard_constraints = models.JSONField(default=dict, blank=True)
    ranking = models.JSONField(default=list, blank=True)
    users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="vod_access_policies",
    )
    category_relations = models.ManyToManyField(
        "M3UVODCategoryRelation",
        through="VODPolicyCategory",
        related_name="access_policies",
    )
    selection_status = models.CharField(
        max_length=10,
        choices=SelectionStatus.choices,
        default=SelectionStatus.PENDING,
    )
    active_selection_generation = models.CharField(
        max_length=32,
        blank=True,
        db_index=True,
    )
    selection_catalog_generation = models.CharField(max_length=64, blank=True)
    selection_counts = models.JSONField(default=dict, blank=True)
    selection_progress = models.JSONField(default=dict, blank=True)
    selection_started_at = models.DateTimeField(null=True, blank=True)
    selection_completed_at = models.DateTimeField(null=True, blank=True)
    selection_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name",)

    def __str__(self):
        return self.name


# New relation models to link M3U accounts with VOD content

class M3USeriesRelation(models.Model):
    """Links M3U accounts to Series with provider-specific information"""
    m3u_account = models.ForeignKey(M3UAccount, on_delete=models.CASCADE, related_name='series_relations')
    series = models.ForeignKey(Series, on_delete=models.CASCADE, related_name='m3u_relations')
    category = models.ForeignKey(VODCategory, on_delete=models.SET_NULL, null=True, blank=True)
    source_asset = models.ForeignKey(
        VODSourceAsset,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="series_relations",
    )

    # Provider-specific fields - renamed to avoid clash with series ForeignKey
    external_series_id = models.CharField(max_length=255, help_text="External series ID from M3U provider")
    custom_properties = models.JSONField(blank=True, null=True, help_text="Provider-specific data")

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_episode_refresh = models.DateTimeField(blank=True, null=True, help_text="Last time episodes were refreshed")
    last_seen = models.DateTimeField(default=timezone.now, help_text="Last time this relation was seen during VOD scan")

    class Meta:
        verbose_name = 'M3U Series Relation'
        verbose_name_plural = 'M3U Series Relations'
        unique_together = [('m3u_account', 'external_series_id')]
        indexes = [
            models.Index(
                fields=['series', 'category'],
                name='vod_series_category_idx',
            ),
        ]

    def __str__(self):
        return f"{self.m3u_account.name} - {self.series.name}"


class M3UMovieRelation(models.Model):
    """Links M3U accounts to Movies with provider-specific information"""
    m3u_account = models.ForeignKey(M3UAccount, on_delete=models.CASCADE, related_name='movie_relations')
    movie = models.ForeignKey(Movie, on_delete=models.CASCADE, related_name='m3u_relations')
    category = models.ForeignKey(VODCategory, on_delete=models.SET_NULL, null=True, blank=True)
    source_asset = models.ForeignKey(
        VODSourceAsset,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movie_relations",
    )

    # Streaming information (provider-specific)
    stream_id = models.CharField(max_length=255, help_text="External stream ID from M3U provider")
    container_extension = models.CharField(max_length=10, blank=True, null=True)

    # Provider-specific data
    custom_properties = models.JSONField(blank=True, null=True, help_text="Provider-specific data like quality, language, etc.")

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_advanced_refresh = models.DateTimeField(blank=True, null=True, help_text="Last time advanced data was fetched from provider")
    last_seen = models.DateTimeField(default=timezone.now, help_text="Last time this relation was seen during VOD scan")

    class Meta:
        verbose_name = 'M3U Movie Relation'
        verbose_name_plural = 'M3U Movie Relations'
        unique_together = [('m3u_account', 'stream_id')]
        indexes = [
            models.Index(
                fields=['movie', 'category'],
                name='vod_movie_category_idx',
            ),
        ]

    def __str__(self):
        return f"{self.m3u_account.name} - {self.movie.name}"

    def get_stream_url(self):
        """Get the full stream URL for this movie from this provider"""
        if self.m3u_account.account_type == 'XC':
            from core.xtream_codes import normalize_server_url

            normalized_url = normalize_server_url(self.m3u_account.server_url)
            if not normalized_url:
                return None
            username = self.m3u_account.username
            password = self.m3u_account.password
            return f"{normalized_url}/movie/{username}/{password}/{self.stream_id}.{self.container_extension or 'mp4'}"
        else:
            # For other account types, we would need another way to build URLs
            return None


class M3UEpisodeRelation(models.Model):
    """Links M3U accounts to Episodes with provider-specific information"""
    m3u_account = models.ForeignKey(M3UAccount, on_delete=models.CASCADE, related_name='episode_relations')
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name='m3u_relations')
    series_relation = models.ForeignKey(
        'M3USeriesRelation',
        on_delete=models.CASCADE,
        related_name='episode_relations',
        null=True,
        blank=True,
        help_text="The series relation this episode relation belongs to. CASCADE ensures cleanup when the series relation is removed."
    )
    source_asset = models.ForeignKey(
        VODSourceAsset,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="episode_relations",
    )

    # Streaming information (provider-specific)
    stream_id = models.CharField(max_length=255, help_text="External stream ID from M3U provider")
    container_extension = models.CharField(max_length=10, blank=True, null=True)

    # Provider-specific data
    custom_properties = models.JSONField(blank=True, null=True, help_text="Provider-specific data like quality, language, etc.")

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_seen = models.DateTimeField(default=timezone.now, help_text="Last time this relation was seen during VOD scan")

    class Meta:
        verbose_name = 'M3U Episode Relation'
        verbose_name_plural = 'M3U Episode Relations'
        unique_together = [('m3u_account', 'stream_id')]

    def __str__(self):
        return f"{self.m3u_account.name} - {self.episode}"

    def get_stream_url(self):
        """Get the full stream URL for this episode from this provider"""
        if self.m3u_account.account_type == 'XC':
            from core.xtream_codes import normalize_server_url

            normalized_url = normalize_server_url(self.m3u_account.server_url)
            if not normalized_url:
                return None
            username = self.m3u_account.username
            password = self.m3u_account.password
            return f"{normalized_url}/series/{username}/{password}/{self.stream_id}.{self.container_extension or 'mp4'}"
        else:
            # We might support non XC accounts in the future
            # For now, return None
            return None

class M3UVODCategoryRelation(models.Model):
    """Links M3U accounts to categories with provider-specific information"""
    m3u_account = models.ForeignKey(M3UAccount, on_delete=models.CASCADE, related_name='category_relations')
    category = models.ForeignKey(VODCategory, on_delete=models.CASCADE, related_name='m3u_relations')

    enabled = models.BooleanField(
        default=False, help_text="Set to false to deactivate this category for the M3U account"
    )

    custom_properties = models.JSONField(blank=True, null=True, help_text="Provider-specific data like quality, language, etc.")
    metadata_defaults = models.JSONField(
        default=dict,
        blank=True,
        help_text="Expected languages, subtitles and quality for newly discovered sources.",
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'M3U VOD Category Relation'
        verbose_name_plural = 'M3U VOD Category Relations'
        unique_together = [('m3u_account', 'category')]
        indexes = [
            GinIndex(fields=("metadata_defaults",), name="vod_cat_defaults_gin"),
        ]

    def __str__(self):
        return f"{self.m3u_account.name} - {self.category.name}"


class VODPolicyCategory(models.Model):
    policy = models.ForeignKey(VODAccessPolicy, on_delete=models.CASCADE)
    category_relation = models.ForeignKey(
        M3UVODCategoryRelation,
        on_delete=models.CASCADE,
    )
    enabled = models.BooleanField(default=True)
    priority = models.IntegerField(default=0)

    class Meta:
        ordering = ("-priority", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("policy", "category_relation"),
                name="unique_vod_policy_category",
            )
        ]


class VODMovieProfileSelection(models.Model):
    """Prepared movie output rows for one policy generation."""

    policy = models.ForeignKey(
        VODAccessPolicy,
        on_delete=models.CASCADE,
        related_name="movie_selections",
    )
    generation = models.CharField(max_length=32)
    movie = models.ForeignKey(Movie, on_delete=models.CASCADE)
    relation = models.ForeignKey(M3UMovieRelation, on_delete=models.CASCADE)
    category = models.ForeignKey(
        VODCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    effective_metadata = models.JSONField(default=dict, blank=True)
    audio_languages = models.JSONField(default=list, blank=True)
    subtitle_languages = models.JSONField(default=list, blank=True)
    resolution_height = models.PositiveIntegerField(default=0)
    container_extension = models.CharField(max_length=10, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("policy", "generation", "relation"),
                name="unique_vod_movie_profile_selection",
            )
        ]
        indexes = [
            models.Index(
                fields=("policy", "generation", "category"),
                name="vod_mov_prof_cat_idx",
            ),
            models.Index(
                fields=("policy", "generation", "movie"),
                name="vod_mov_prof_movie_idx",
            ),
            models.Index(
                fields=("policy", "generation", "resolution_height"),
                name="vod_mov_prof_res_idx",
            ),
            GinIndex(fields=("audio_languages",), name="vod_mov_prof_audio_gin"),
            GinIndex(fields=("subtitle_languages",), name="vod_mov_prof_sub_gin"),
        ]


class VODSeriesProfileSelection(models.Model):
    """Prepared series output rows for one policy generation."""

    policy = models.ForeignKey(
        VODAccessPolicy,
        on_delete=models.CASCADE,
        related_name="series_selections",
    )
    generation = models.CharField(max_length=32)
    series = models.ForeignKey(Series, on_delete=models.CASCADE)
    relation = models.ForeignKey(M3USeriesRelation, on_delete=models.CASCADE)
    category = models.ForeignKey(
        VODCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    effective_metadata = models.JSONField(default=dict, blank=True)
    audio_languages = models.JSONField(default=list, blank=True)
    subtitle_languages = models.JSONField(default=list, blank=True)
    resolution_height = models.PositiveIntegerField(default=0)
    container_extension = models.CharField(max_length=10, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("policy", "generation", "relation"),
                name="unique_vod_series_profile_selection",
            )
        ]
        indexes = [
            models.Index(
                fields=("policy", "generation", "category"),
                name="vod_ser_prof_cat_idx",
            ),
            models.Index(
                fields=("policy", "generation", "series"),
                name="vod_ser_prof_series_idx",
            ),
            models.Index(
                fields=("policy", "generation", "resolution_height"),
                name="vod_ser_prof_res_idx",
            ),
            GinIndex(fields=("audio_languages",), name="vod_ser_prof_audio_gin"),
            GinIndex(fields=("subtitle_languages",), name="vod_ser_prof_sub_gin"),
        ]


class VODPlaybackSession(models.Model):
    """Auditable playback selection and optional player/proxy telemetry."""

    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        REDIRECTED = "redirected", "Redirected (unconfirmed)"
        PROXYING = "proxying", "Proxying"
        COMPLETED = "completed", "Completed"
        STOPPED = "stopped", "Stopped"
        FAILED = "failed", "Failed"

    class Mode(models.TextChoices):
        REDIRECT = "redirect", "Redirect"
        PROXY = "proxy", "Proxy"
        PLAYER = "player", "Player telemetry"

    session_id = models.CharField(max_length=255, unique=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="vod_playback_sessions",
    )
    source_asset = models.ForeignKey(
        VODSourceAsset,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="playback_sessions",
    )
    m3u_account = models.ForeignKey(
        M3UAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    category = models.ForeignKey(
        VODCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    content_type = models.CharField(max_length=10, choices=VODSourceAsset.AssetType.choices)
    canonical_id = models.PositiveBigIntegerField(null=True, blank=True)
    relation_id = models.PositiveBigIntegerField(null=True, blank=True)
    provider_asset_id = models.CharField(max_length=255, blank=True)
    content_name = models.CharField(max_length=500, blank=True)
    mode = models.CharField(max_length=10, choices=Mode.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REQUESTED)
    client_ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)
    bytes_sent = models.PositiveBigIntegerField(default=0)
    watched_seconds = models.PositiveIntegerField(default=0)
    observed_metadata = models.JSONField(default=dict, blank=True)
    failover_chain = models.JSONField(default=list, blank=True)
    failover_count = models.PositiveIntegerField(default=0)
    error = models.TextField(blank=True)
    custom_properties = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-started_at",)
        indexes = [
            models.Index(fields=("user", "-started_at"), name="vod_playback_user_idx"),
            models.Index(fields=("source_asset", "-started_at"), name="vod_playback_asset_idx"),
            models.Index(fields=("-started_at",), name="vod_playback_started_idx"),
        ]
