import { tmdbUrl } from './externalUrls.js';
import { dateRules } from './libraryFilters.js';

export const LIST_TYPES = [
  { value: 'manual', label: 'Manual' },
  { value: 'rules', label: 'Rules' },
  { value: 'tmdb', label: 'TMDB' },
];

export const LIST_CONTENT = [
  { value: 'all', label: 'Movies & Series' },
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'Series' },
];

// "list" is the order the list brings: yours, TMDB's or A–Z for rules.
const LIST_ORDER = {
  manual: 'Manual order',
  rules: 'Title',
  tmdb: 'TMDB order',
};

export const sortModes = (listType) => [
  { value: 'list', label: LIST_ORDER[listType] || 'List order' },
  { value: 'release', label: 'Newest release first' },
  { value: 'added', label: 'Recently added first' },
];

export const NAME_PLACEHOLDERS = [
  { value: 'year', help: 'The current year, e.g. 2026' },
  {
    value: 'season',
    help: 'The current season: Winter from January, Spring from April, Summer from July, Fall from October',
  },
];

// TMDB sources and the list content they serve.
export const TMDB_SOURCES = [
  { value: 'trending', label: 'Trending', content: ['all', 'movie', 'series'] },
  { value: 'popular', label: 'Popular', content: ['movie', 'series'] },
  { value: 'now-playing', label: 'Now playing in cinemas', content: ['movie'] },
  { value: 'list', label: 'TMDB list', content: ['all', 'movie', 'series'] },
  {
    value: 'watch-provider',
    label: 'Streaming service',
    content: ['movie', 'series'],
  },
  { value: 'discover', label: 'Discover', content: ['movie', 'series'] },
];

export const tmdbSources = (contentType) =>
  TMDB_SOURCES.filter((source) => source.content.includes(contentType));

export const MONETIZATION = [
  { value: 'flatrate', label: 'Subscription' },
  { value: 'free', label: 'Free' },
  { value: 'ads', label: 'Free with ads' },
  { value: 'rent', label: 'Rent' },
  { value: 'buy', label: 'Buy' },
];

export const BUILD_STATUS = {
  pending: { label: 'Pending', color: 'yellow' },
  building: { label: 'Building', color: 'blue' },
  ready: { label: 'Ready', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
};

export const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Anime seasons as the backend fills in {season}.
const SEASONS = ['Winter', 'Spring', 'Summer', 'Fall'];

export const optionLabel = (options, value) =>
  options.find((option) => option.value === value)?.label || value || '';

export const newList = (listType = 'manual', fields = {}) => ({
  name: '',
  list_type: listType,
  content_type: 'all',
  filters: {},
  tmdb_source: listType === 'tmdb' ? 'trending' : '',
  tmdb_settings: {},
  sort_mode: 'list',
  is_enabled: true,
  visible_from: '',
  visible_until: '',
  // TMDB lists are downloaded daily; the others follow the Library.
  refresh_interval: listType === 'tmdb' ? 24 : 0,
  cron_expression: '',
  ...fields,
});

export const displayName = (name, day = new Date()) =>
  (name || '')
    .replaceAll('{year}', String(day.getFullYear()))
    .replaceAll('{season}', SEASONS[Math.floor(day.getMonth() / 3)]);

export const listPayload = (vodList) => {
  const payload = {
    name: vodList.name,
    content_type: vodList.content_type,
    sort_mode: vodList.sort_mode,
    is_enabled: vodList.is_enabled,
    visible_from: vodList.visible_from || '',
    visible_until: vodList.visible_until || '',
    refresh_interval: vodList.refresh_interval || 0,
    cron_expression: vodList.cron_expression || '',
  };
  if (!vodList.id) payload.list_type = vodList.list_type;
  if (vodList.list_type === 'rules') {
    payload.filters = Object.fromEntries(
      Object.entries(vodList.filters || {}).filter(
        ([key, value]) =>
          value !== '' &&
          value != null &&
          !['type', 'view', ...FILE_DATA_FILTERS].includes(key)
      )
    );
  }
  if (vodList.list_type === 'tmdb') {
    payload.tmdb_source = vodList.tmdb_source;
    payload.tmdb_settings = vodList.tmdb_settings || {};
  }
  return payload;
};

export const listValidation = (vodList) => {
  const errors = {};
  if (!vodList.name?.trim()) errors.name = 'Enter a list name.';
  const { visible_from: from, visible_until: until } = vodList;
  if (from && !MONTH_DAY.test(from)) errors.visible_from = 'Enter DD.MM.';
  if (until && !MONTH_DAY.test(until)) errors.visible_until = 'Enter DD.MM.';
  if (!!from !== !!until && !errors.visible_from && !errors.visible_until)
    errors.visible_until = 'Enter both days of the period.';
  if (
    vodList.list_type === 'rules' &&
    dateRules(vodList.filters || {}) === 'conflict'
  )
    errors.filters =
      'Released starts after the Added period ends, so no title can match.';
  if (vodList.list_type === 'tmdb') {
    const settings = vodList.tmdb_settings || {};
    if (vodList.tmdb_source === 'list' && !/^\d+$/.test(settings.list_id || ''))
      errors.list_id = 'Enter the numeric TMDB list ID.';
    if (vodList.tmdb_source === 'watch-provider') {
      if (!settings.region) errors.region = 'Choose a region.';
      if (!settings.provider_id) errors.provider_id = 'Choose a service.';
    }
    if (vodList.tmdb_source === 'discover') {
      if (settings.release_mode === 'days' && !settings.release_days)
        errors.release_days = 'Enter the number of days.';
      if (
        settings.release_mode === 'range' &&
        !settings.release_since &&
        !settings.release_until
      )
        errors.release_since = 'Enter at least one date.';
      if (settings.release_mode === 'yearly')
        for (const key of ['release_from_day', 'release_until_day'])
          if (!MONTH_DAY.test(settings[key] || ''))
            errors[key] = 'Enter the day as DD.MM.';
    }
  }
  return errors;
};

const message = (value) =>
  typeof value === 'string' ? value : [value].flat().join(' ');

// Field errors of a failed save, keyed like listValidation, and the rest.
export const listErrors = (body) => {
  const errors = {};
  let detail = '';
  if (body && typeof body === 'object') {
    for (const [field, value] of Object.entries(body)) {
      if (field === 'detail' || field === 'non_field_errors')
        detail = message(value);
      else if (field === 'tmdb_settings' && value && !Array.isArray(value))
        for (const [key, text] of Object.entries(value))
          errors[key] = message(text);
      else if (field === 'filters' && value && !Array.isArray(value))
        errors.filters = Object.values(value).map(message).join(' ');
      else errors[field] = message(value);
    }
  }
  return { errors, detail };
};

// File data is chosen by the profile, so lists do not filter by it.
export const FILE_DATA_FILTERS = [
  'audio_language',
  'subtitle_language',
  'resolution',
  'video_feature',
  'container_extension',
];

export const previewItem = (item) => ({
  content_type: item.content_type,
  content_id: item.content_id,
  source_id: null,
  name: item.title,
});

export const itemsText = (counts = {}) =>
  counts.titles == null
    ? ''
    : `${counts.titles.toLocaleString()} ${counts.titles === 1 ? 'title' : 'titles'} · ${counts.available.toLocaleString()} available`;

// The TMDB page of a list title, for titles missing from the Library.
export const tmdbItemUrl = (item) =>
  tmdbUrl(item.tmdb_id, item.content_type === 'series' ? 'tv' : 'movie');
