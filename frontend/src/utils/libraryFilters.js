// Library filters besides search and view, shared by the filter popover and
// the content rules of VOD profiles.
export const LIBRARY_EXTRA_FILTERS = [
  'account',
  'category',
  'category_match',
  'content_id',
  'metadata_status',
  'locked',
  'blocked',
  'audio_language',
  'subtitle_language',
  'resolution',
  'resolution_min',
  'resolution_max',
  'video_feature',
  'container_extension',
  'genre',
  'streaming_service',
  'anime_mode',
  'adult_mode',
  'added_since',
  'added_until',
  'released_since',
  'released_until',
];

export const libraryFilterCount = (filters, bothTypes = true) =>
  LIBRARY_EXTRA_FILTERS.filter(
    (field) => filters[field] !== '' && filters[field] != null
  ).length + (bothTypes && filters.type && filters.type !== 'all' ? 1 : 0);

// Resolution tiers from the highest down, as the server orders them.
export const RESOLUTION_TIERS = [
  '4320p',
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '576p',
  '480p',
  '360p',
  'SD',
];

const MODES = {
  only: (label) => `Only ${label}`,
  exclude: (label) => `No ${label}`,
};
const METADATA = {
  enriched: 'Enriched',
  missing_metadata: 'Not enriched',
  missing_id: 'No TMDB ID',
  missing_external_ids: 'No external ID',
};

// One line for a filter, e.g. "Category ~ WWE · DUB GER · 1080p and up".
export const libraryFilterSummary = (filters = {}, options = {}) => {
  const names = (field, key) =>
    String(filters[field])
      .split(',')
      .map(
        (id) =>
          (options[key] || []).find((row) => String(row.id) === id)?.name ||
          `#${id}`
      )
      .join(' or ');
  const parts = [];
  if (filters.account) parts.push(names('account', 'accounts'));
  if (filters.category) parts.push(names('category', 'categories'));
  if (filters.category_match)
    parts.push(`Category ~ ${filters.category_match}`);
  if (filters.search) parts.push(`Title ~ ${filters.search}`);
  if (filters.audio_language)
    parts.push(`DUB ${filters.audio_language.toUpperCase()}`);
  if (filters.subtitle_language)
    parts.push(`SUB ${filters.subtitle_language.toUpperCase()}`);
  const low = filters.resolution_min;
  const high = filters.resolution_max;
  if (filters.resolution) parts.push(filters.resolution);
  if (low && high) parts.push(low === high ? low : `${low} to ${high}`);
  else if (low) parts.push(`${low} and up`);
  else if (high) parts.push(`Up to ${high}`);
  if (filters.video_feature)
    parts.push(filters.video_feature.replace(/^custom:/, '').toUpperCase());
  if (filters.container_extension)
    parts.push(filters.container_extension.toUpperCase());
  if (filters.genre)
    parts.push(`Genre ${filters.genre.split(',').join(' or ')}`);
  if (filters.streaming_service)
    parts.push(
      filters.streaming_service
        .split(',')
        .map((value) => {
          const service = (options.streaming_services || []).find(
            (row) => row.value === value
          );
          return service ? `${service.name} (${service.region})` : value;
        })
        .join(' or ')
    );
  if (filters.anime_mode) parts.push(MODES[filters.anime_mode]('anime'));
  if (filters.adult_mode)
    parts.push(MODES[filters.adult_mode]('adult content'));
  if (filters.metadata_status) parts.push(METADATA[filters.metadata_status]);
  if (filters.added_since || filters.added_until)
    parts.push('Added in a period');
  if (filters.released_since || filters.released_until)
    parts.push('Released in a period');
  if (filters.type && filters.type !== 'all')
    parts.push(filters.type === 'movie' ? 'Movies' : 'Series');
  return parts.join(' · ');
};
