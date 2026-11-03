from django.conf import settings
from django.db import models
from django.db.models import Q
from django.db.models.functions import Now
from django.utils import timezone
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from apps.m3u.models import M3UAccount
import uuid


def _clamp_vod_char_field(obj, field_name, *, label):
    """Clamp a CharField on a VOD row so bulk writes cannot abort on varchar limits."""
    from core.utils import truncate_with_warning

    value = getattr(obj, field_name, None)
    if value is None:
        return
    max_length = obj._meta.get_field(field_name).max_length
    setattr(
        obj,
        field_name,
        truncate_with_warning(value, max_length=max_length, label=label),
    )


class VODLogoQuerySet(models.QuerySet):
    def bulk_create(self, objs, *args, **kwargs):
        # bulk_create bypasses Model.save(); clamp names here so provider
        # movie/series titles longer than varchar(255) cannot abort VOD ingest.
        for obj in objs:
            _clamp_vod_char_field(obj, "name", label="Logo name")
        return super().bulk_create(objs, *args, **kwargs)


class VODLogo(models.Model):
    """Logo model specifically for VOD content (movies and series)"""
    name = models.CharField(max_length=255)
    url = models.TextField(unique=True)

    objects = VODLogoQuerySet.as_manager()

    def save(self, *args, **kwargs):
        _clamp_vod_char_field(self, "name", label="Logo name")
        super().save(*args, **kwargs)

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


class VODCatalogQuerySet(models.QuerySet):
    """Clamp name/genre on bulk paths; bulk_create/bulk_update bypass Model.save()."""

    _clamp_fields = ("name", "genre")

    def _clamp_objs(self, objs, fields=None):
        label_prefix = self.model.__name__
        for obj in objs:
            for field_name in self._clamp_fields:
                if fields is not None and field_name not in fields:
                    continue
                _clamp_vod_char_field(
                    obj,
                    field_name,
                    label=f"{label_prefix} {field_name}",
                )

    def bulk_create(self, objs, *args, **kwargs):
        self._clamp_objs(objs)
        return super().bulk_create(objs, *args, **kwargs)

    def bulk_update(self, objs, fields, *args, **kwargs):
        self._clamp_objs(objs, fields=fields)
        return super().bulk_update(objs, fields, *args, **kwargs)


class VODSourceMetadataMixin(models.Model):
    """Metadata belongs to an exact account/provider relation, not a title."""

    declared_metadata = models.JSONField(default=dict, blank=True)
    observed_metadata = models.JSONField(default=dict, blank=True)
    manual_metadata = models.JSONField(default=dict, blank=True)
    locked_fields = models.JSONField(default=list, blank=True)
    last_observed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True

    def effective_metadata(self, category_defaults=None):
        from .metadata import effective_source_metadata

        return effective_source_metadata(self, category_defaults=category_defaults)


class VODLibraryMetadataMixin(models.Model):
    """Canonical library annotations, independent of exact provider sources."""

    library_blocked = models.BooleanField(
        default=False, db_default=False, db_index=True
    )

    display_name = models.CharField(
        max_length=255, blank=True, default="", db_default=""
    )
    clean_title = models.CharField(
        max_length=255, blank=True, default="", db_default=""
    )
    tmdb_lookup_excluded = models.BooleanField(
        default=False, db_default=False, db_index=True
    )
    tmdb_metadata = models.JSONField(default=dict, db_default={}, blank=True)
    tmdb_match_id = models.CharField(
        max_length=50, blank=True, default="", db_default="", db_index=True
    )
    tmdb_imdb_id = models.CharField(
        max_length=50, blank=True, default="", db_default=""
    )
    tmdb_poster_url = models.CharField(
        max_length=500, blank=True, default="", db_default=""
    )
    tmdb_backdrop_url = models.CharField(
        max_length=500, blank=True, default="", db_default=""
    )
    tmdb_status = models.CharField(
        max_length=16, blank=True, default="", db_default="", db_index=True
    )
    tmdb_enriched_at = models.DateTimeField(null=True, blank=True)
    library_added_at = models.DateTimeField(
        default=timezone.now, db_default=Now(), db_index=True
    )
    # The canonical title in the Library languages, lowercased, so the Library
    # can sort by an index instead of reading every title's metadata.
    sort_title = models.CharField(
        max_length=255, blank=True, default="", db_default="", db_index=True
    )
    # Every title the Library search matches, for the same reason.
    search_title = models.TextField(blank=True, default="", db_default="")
    # Streaming services from the TMDB data ({region, id, name}), so the Library
    # can filter by service without reading every title's metadata.
    streaming_services = models.JSONField(
        default=list, db_default=[], blank=True
    )

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        fields = kwargs.get("update_fields")
        if fields is None or set(fields) & TITLE_FIELDS:
            from .presentation import refresh_library_titles

            refresh_library_titles(type(self), [self.pk])


# Fields the canonical title is resolved from.
TITLE_FIELDS = {"display_name", "tmdb_metadata", "clean_title", "name"}


class Series(VODLibraryMetadataMixin):
    """Series information for TV shows"""
    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    year = models.IntegerField(blank=True, null=True)
    rating = models.CharField(max_length=10, blank=True, null=True)
    genre = models.CharField(max_length=255, blank=True, null=True)
    logo = models.ForeignKey(VODLogo, on_delete=models.SET_NULL, null=True, blank=True, related_name='series')

    # Content identity is independent of source languages and technical features.
    tmdb_id = models.CharField(max_length=50, blank=True, null=True, db_index=True, help_text="TMDB ID for metadata")
    imdb_id = models.CharField(max_length=50, blank=True, null=True, db_index=True, help_text="IMDB ID for metadata")

    # Additional metadata and properties
    custom_properties = models.JSONField(blank=True, null=True, help_text='Additional metadata and properties for the series')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = VODCatalogQuerySet.as_manager()

    class Meta:
        verbose_name = 'Series'
        verbose_name_plural = 'Series'
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['tmdb_id'],
                condition=models.Q(tmdb_id__isnull=False),
                name='unique_series_tmdb_id'
            ),
            models.UniqueConstraint(
                fields=['imdb_id'],
                condition=models.Q(imdb_id__isnull=False),
                name='unique_series_imdb_id'
            ),
            models.UniqueConstraint(
                fields=['name', 'year'],
                condition=models.Q(tmdb_id__isnull=True) & models.Q(imdb_id__isnull=True),
                name='unique_series_name_year_no_external_id'
            ),
        ]

    def save(self, *args, **kwargs):
        _clamp_vod_char_field(self, "name", label="Series name")
        _clamp_vod_char_field(self, "genre", label="Series genre")
        super().save(*args, **kwargs)

    def __str__(self):
        year_str = f" ({self.year})" if self.year else ""
        return f"{self.name}{year_str}"


class Movie(VODLibraryMetadataMixin):
    """Movie content"""
    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    year = models.IntegerField(blank=True, null=True)
    rating = models.CharField(max_length=10, blank=True, null=True)
    genre = models.CharField(max_length=255, blank=True, null=True)
    duration_secs = models.IntegerField(blank=True, null=True, help_text="Duration in seconds")
    logo = models.ForeignKey(VODLogo, on_delete=models.SET_NULL, null=True, blank=True, related_name='movie')

    # Content identity is independent of source languages and technical features.
    tmdb_id = models.CharField(max_length=50, blank=True, null=True, db_index=True, help_text="TMDB ID for metadata")
    imdb_id = models.CharField(max_length=50, blank=True, null=True, db_index=True, help_text="IMDB ID for metadata")

    is_adult = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Whether this movie contains adult content",
    )

    # Additional metadata and properties
    custom_properties = models.JSONField(blank=True, null=True, help_text='Additional metadata and properties for the movie')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = VODCatalogQuerySet.as_manager()

    class Meta:
        verbose_name = 'Movie'
        verbose_name_plural = 'Movies'
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['tmdb_id'],
                condition=models.Q(tmdb_id__isnull=False),
                name='unique_movie_tmdb_id'
            ),
            models.UniqueConstraint(
                fields=['imdb_id'],
                condition=models.Q(imdb_id__isnull=False),
                name='unique_movie_imdb_id'
            ),
            models.UniqueConstraint(
                fields=['name', 'year'],
                condition=models.Q(tmdb_id__isnull=True) & models.Q(imdb_id__isnull=True),
                name='unique_movie_name_year_no_external_id'
            ),
        ]

    def save(self, *args, **kwargs):
        _clamp_vod_char_field(self, "name", label="Movie name")
        _clamp_vod_char_field(self, "genre", label="Movie genre")
        super().save(*args, **kwargs)

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


# New relation models to link M3U accounts with VOD content

class M3USeriesRelation(VODSourceMetadataMixin):
    """Links M3U accounts to Series with provider-specific information"""
    m3u_account = models.ForeignKey(M3UAccount, on_delete=models.CASCADE, related_name='series_relations')
    series = models.ForeignKey(Series, on_delete=models.CASCADE, related_name='m3u_relations')
    category = models.ForeignKey(VODCategory, on_delete=models.SET_NULL, null=True, blank=True)

    # Provider-specific fields - renamed to avoid clash with series ForeignKey
    external_series_id = models.CharField(max_length=255, help_text="External series ID from M3U provider")
    tmdb_override_id = models.CharField(
        max_length=50, blank=True, default="", db_default="", db_index=True
    )
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

    def __str__(self):
        return f"{self.m3u_account.name} - {self.series.name}"


class M3UMovieRelation(VODSourceMetadataMixin):
    """Links M3U accounts to Movies with provider-specific information"""
    m3u_account = models.ForeignKey(M3UAccount, on_delete=models.CASCADE, related_name='movie_relations')
    movie = models.ForeignKey(Movie, on_delete=models.CASCADE, related_name='m3u_relations')
    category = models.ForeignKey(VODCategory, on_delete=models.SET_NULL, null=True, blank=True)

    # Streaming information (provider-specific)
    stream_id = models.CharField(max_length=255, help_text="External stream ID from M3U provider")
    container_extension = models.CharField(max_length=10, blank=True, null=True)
    tmdb_override_id = models.CharField(
        max_length=50, blank=True, default="", db_default="", db_index=True
    )

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

    def __str__(self):
        return f"{self.m3u_account.name} - {self.movie.name}"

    def get_stream_url(self, profile=None):
        """Build the XC movie URL using the same credential resolution as playback.

        When *profile* is omitted, the account's first active profile is used
        (identity patterns keep base credentials). Returns None for non-XC
        accounts or when credential transform fails.
        """
        if self.m3u_account.account_type != "XC":
            return None

        from apps.m3u.credentials import (
            build_xc_playback_url,
            get_transformed_credentials,
        )

        server_url, username, password = get_transformed_credentials(
            self.m3u_account, profile
        )
        if not (server_url and username and password and self.stream_id):
            return None

        return build_xc_playback_url(
            server_url,
            username,
            password,
            content_path="movie",
            stream_id=str(self.stream_id),
            extension=self.container_extension or "mp4",
        )


class M3UEpisodeRelation(VODSourceMetadataMixin):
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

    def get_stream_url(self, profile=None):
        """Build the XC series/episode URL using the same credential resolution as playback.

        When *profile* is omitted, the account's first active profile is used
        (identity patterns keep base credentials). Returns None for non-XC
        accounts or when credential transform fails.
        """
        if self.m3u_account.account_type != "XC":
            return None

        from apps.m3u.credentials import (
            build_xc_playback_url,
            get_transformed_credentials,
        )

        server_url, username, password = get_transformed_credentials(
            self.m3u_account, profile
        )
        if not (server_url and username and password and self.stream_id):
            return None

        return build_xc_playback_url(
            server_url,
            username,
            password,
            content_path="series",
            stream_id=str(self.stream_id),
            extension=self.container_extension or "mp4",
        )

class M3UVODCategoryRelation(models.Model):
    """Links M3U accounts to categories with provider-specific information"""
    m3u_account = models.ForeignKey(M3UAccount, on_delete=models.CASCADE, related_name='category_relations')
    category = models.ForeignKey(VODCategory, on_delete=models.CASCADE, related_name='m3u_relations')

    enabled = models.BooleanField(
        default=False, help_text="Set to false to deactivate this category for the M3U account"
    )
    ignored = models.BooleanField(default=False)

    custom_properties = models.JSONField(blank=True, null=True, help_text="Provider-specific data like quality, language, etc.")
    metadata_defaults = models.JSONField(default=dict, blank=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'M3U VOD Category Relation'
        verbose_name_plural = 'M3U VOD Category Relations'
        unique_together = [('m3u_account', 'category')]
        constraints = [models.CheckConstraint(
            condition=models.Q(ignored=False) | models.Q(enabled=False),
            name="vod_ignored_category_disabled",
        )]

    def __str__(self):
        return f"{self.m3u_account.name} - {self.category.name}"

    def save(self, *args, **kwargs):
        if self.ignored:
            self.enabled = False
            if kwargs.get("update_fields") is not None:
                kwargs["update_fields"] = set(kwargs["update_fields"]) | {"enabled"}
        super().save(*args, **kwargs)


class VODContentAlias(models.Model):
    """Stable public selections and retired IDs retain playback requirements.

    Targets are numeric canonical IDs rather than provider IDs. A missing
    target resolves to 404; an old identifier is never reused for a source.
    """

    content_type = models.CharField(
        max_length=7,
        choices=(("movie", "Movie"), ("series", "Series"), ("episode", "Episode")),
    )
    legacy_id = models.PositiveBigIntegerField()
    legacy_uuid = models.UUIDField()
    target_id = models.PositiveBigIntegerField()
    requirements = models.JSONField(default=dict, blank=True)
    selection_key = models.CharField(max_length=100, unique=True, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("content_type", "legacy_id"), name="vod_alias_legacy_id"
            ),
            models.UniqueConstraint(
                fields=("content_type", "legacy_uuid"), name="vod_alias_legacy_uuid"
            ),
        ]
        indexes = [
            models.Index(fields=("content_type", "target_id"), name="vod_alias_target_idx"),
        ]


class VODMetadataState(models.Model):
    """Durable selection and progress for an explicit library enrichment job."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    task_id = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=12, default="idle")
    selection = models.JSONField(default=list, blank=True)
    pending_enrichment = models.JSONField(default=list, db_default=[], blank=True)
    refreshing_accounts = models.JSONField(default=list, db_default=[], blank=True)
    job_heartbeat = models.DateTimeField(default=timezone.now, db_default=Now())
    progress = models.JSONField(default=dict, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class VODProfile(models.Model):
    """Client VOD output for the users assigned to it.

    Profiles only shape Xtream Codes catalogues, details and playback. The
    Library and administration keep showing every source.
    """

    class OutputMode(models.TextChoices):
        COMPACT = "compact", "Compact"
        VARIANTS = "variants", "Sources"

    class OutputGroups(models.TextChoices):
        PROVIDER = "provider", "Provider"
        MOVIE_SERIES = "movie_series", "Movie & Series"
        LISTS = "lists", "Lists"

    class MetadataSource(models.TextChoices):
        PROVIDER = "provider", "Provider"
        ENRICHED = "enriched", "Enriched"

    class CatalogStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        BUILDING = "building", "Building"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    name = models.CharField(max_length=255, unique=True)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    output_mode = models.CharField(
        max_length=10, choices=OutputMode.choices, default=OutputMode.COMPACT
    )
    name_template = models.CharField(max_length=500, default="{title}")
    # Replacement texts for placeholder values, e.g. 1080p shown as FHD.
    name_labels = models.JSONField(default=list, blank=True)
    output_groups = models.CharField(
        max_length=12, choices=OutputGroups.choices, default=OutputGroups.PROVIDER
    )
    # With list output, titles in none of the profile's lists go to "Unsorted".
    include_unsorted = models.BooleanField(default=True)
    lists = models.ManyToManyField(
        "VODList", through="VODProfileList", related_name="profiles", blank=True
    )
    # "provider", "clean" for the cleaned Library titles, or a Library
    # metadata language.
    title_source = models.CharField(max_length=10, default="provider")
    metadata_source = models.CharField(
        max_length=10, choices=MetadataSource.choices, default=MetadataSource.PROVIDER
    )
    # Ordered include/exclude rules; the first match decides each source.
    content_rules = models.JSONField(default=list, blank=True)
    # Titles this profile never offers, whatever the filters allow.
    excluded_titles = models.JSONField(default=list, blank=True)
    edition_rules = models.JSONField(default=list, blank=True)
    ranking = models.JSONField(default=list, blank=True)
    audio_language_order = models.JSONField(default=list, blank=True)
    subtitle_language_order = models.JSONField(default=list, blank=True)
    provider_order = models.JSONField(default=list, blank=True)
    catalog_status = models.CharField(
        max_length=10, choices=CatalogStatus.choices, default=CatalogStatus.PENDING
    )
    catalog_generation = models.CharField(max_length=32, blank=True)
    catalog_signature = models.CharField(max_length=64, blank=True)
    catalog_counts = models.JSONField(default=dict, blank=True)
    catalog_progress = models.JSONField(default=dict, blank=True)
    catalog_started_at = models.DateTimeField(null=True, blank=True)
    catalog_completed_at = models.DateTimeField(null=True, blank=True)
    catalog_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-is_default", "name")
        constraints = [
            models.UniqueConstraint(
                fields=("is_default",),
                condition=Q(is_default=True),
                name="vod_single_default_profile",
            ),
            models.CheckConstraint(
                condition=Q(is_default=False) | Q(is_active=True),
                name="vod_default_profile_active",
            ),
        ]

    def __str__(self):
        return self.name


class VODProfileAssignment(models.Model):
    """At most one profile per user; users without one use the default."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="vod_profile_assignment",
    )
    profile = models.ForeignKey(
        VODProfile, on_delete=models.CASCADE, related_name="assignments"
    )

    def __str__(self):
        return f"{self.user} -> {self.profile}"


class VODProfileEntry(models.Model):
    """One prepared Xtream Codes entry of a profile catalogue generation.

    Titles, artwork and blocks stay live at output time; an entry fixes which
    source represents the title, its public ID and the ordered fallbacks.
    """

    profile = models.ForeignKey(
        VODProfile, on_delete=models.CASCADE, related_name="entries"
    )
    generation = models.CharField(max_length=32)
    content_type = models.CharField(
        max_length=6, choices=(("movie", "Movie"), ("series", "Series"))
    )
    content_id = models.PositiveIntegerField()
    relation_id = models.PositiveIntegerField()
    public_id = models.PositiveBigIntegerField()
    edition = models.CharField(max_length=120, blank=True)
    source_ids = models.JSONField(default=list)
    # Full lists show primary entries; a category request also gets the best
    # source within that category, as the live output always did.
    primary = models.BooleanField(default=True)
    # With list output, the profile lists this entry represents the title in.
    list_ids = models.JSONField(default=list)

    class Meta:
        indexes = [
            models.Index(
                fields=("profile", "generation", "content_type", "relation_id"),
                name="vod_profile_entry_relation",
            ),
            models.Index(
                fields=("profile", "generation", "content_type", "content_id"),
                name="vod_profile_entry_content",
            ),
        ]


class VODList(models.Model):
    """A curated VOD collection that profiles can offer as client categories.

    Manual lists are filled from the Library, rules lists are saved Library
    filters and TMDB lists follow a TMDB chart or list. Items are rebuilt as a
    whole, so profiles always read a complete list.
    """

    class ListType(models.TextChoices):
        MANUAL = "manual", "Manual"
        RULES = "rules", "Rules"
        TMDB = "tmdb", "TMDB"

    class ContentType(models.TextChoices):
        ALL = "all", "Movies & Series"
        MOVIE = "movie", "Movies"
        SERIES = "series", "Series"

    class SortMode(models.TextChoices):
        LIST = "list", "List order"
        RELEASE = "release", "Newest release first"
        ADDED = "added", "Recently added first"

    class BuildStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        BUILDING = "building", "Building"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    name = models.CharField(max_length=255, unique=True)
    list_type = models.CharField(
        max_length=10, choices=ListType.choices, default=ListType.MANUAL
    )
    content_type = models.CharField(
        max_length=10, choices=ContentType.choices, default=ContentType.ALL
    )
    # Rules lists: the Library filters a source has to match.
    filters = models.JSONField(default=dict, blank=True)
    # TMDB lists: the source ("trending", "list", "discover", ...) and its
    # options such as the list ID, the release period, genres or the
    # streaming service; the list's content picks movies, series or both.
    tmdb_source = models.CharField(max_length=32, blank=True)
    tmdb_settings = models.JSONField(default=dict, blank=True)
    sort_mode = models.CharField(
        max_length=10, choices=SortMode.choices, default=SortMode.LIST
    )
    is_enabled = models.BooleanField(default=True)
    # Clients only see the list every year within this MM-DD period, which
    # may span the turn of the year; empty means always.
    visible_from = models.CharField(max_length=5, blank=True)
    visible_until = models.CharField(max_length=5, blank=True)
    # Rebuild schedule like M3U accounts and EPG sources: every N hours, or a
    # cron expression that takes precedence; 0 without cron means no schedule.
    refresh_interval = models.PositiveIntegerField(default=0)
    cron_expression = models.CharField(max_length=100, blank=True)
    build_status = models.CharField(
        max_length=10, choices=BuildStatus.choices, default=BuildStatus.PENDING
    )
    build_counts = models.JSONField(default=dict, blank=True)
    build_error = models.TextField(blank=True)
    built_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name", "id")

    def __str__(self):
        return self.name


class VODListItem(models.Model):
    """One ordered title of a list; the profile chooses its source.

    TMDB items keep the title, year and poster of titles that are not in the
    Library, so previews can show them as unavailable.
    """

    vod_list = models.ForeignKey(
        VODList, on_delete=models.CASCADE, related_name="items"
    )
    content_type = models.CharField(
        max_length=6, choices=(("movie", "Movie"), ("series", "Series"))
    )
    movie = models.ForeignKey(
        Movie,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="vod_list_items",
    )
    series = models.ForeignKey(
        Series,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="vod_list_items",
    )
    tmdb_id = models.CharField(max_length=50, blank=True)
    title = models.CharField(max_length=500, blank=True)
    year = models.IntegerField(null=True, blank=True)
    poster_url = models.CharField(max_length=1000, blank=True)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("position", "id")
        indexes = [
            models.Index(fields=("vod_list", "position"), name="vod_list_item_order"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(content_type="movie", series__isnull=True)
                | Q(content_type="series", movie__isnull=True),
                name="vod_list_item_content",
            ),
            models.UniqueConstraint(
                fields=("vod_list", "movie"),
                condition=Q(movie__isnull=False),
                name="vod_list_item_unique_movie",
            ),
            models.UniqueConstraint(
                fields=("vod_list", "series"),
                condition=Q(series__isnull=False),
                name="vod_list_item_unique_series",
            ),
        ]

    @property
    def content(self):
        return self.movie if self.content_type == "movie" else self.series

    def __str__(self):
        return self.title or str(self.content or self.tmdb_id)


class VODProfileList(models.Model):
    """A list a profile offers as a client category, in the profile's order."""

    profile = models.ForeignKey(
        VODProfile, on_delete=models.CASCADE, related_name="list_links"
    )
    vod_list = models.ForeignKey(
        VODList, on_delete=models.CASCADE, related_name="profile_links"
    )
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("order", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("profile", "vod_list"), name="vod_profile_list_unique"
            )
        ]
