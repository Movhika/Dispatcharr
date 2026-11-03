// Library filters besides search and view, shared by the filter popover and
// the rules of VOD lists.
export const LIBRARY_EXTRA_FILTERS = [
  'account',
  'category',
  'content_id',
  'metadata_status',
  'locked',
  'blocked',
  'audio_language',
  'subtitle_language',
  'resolution',
  'video_feature',
  'container_extension',
  'genre',
  'keyword',
  'anime_mode',
  'adult_mode',
  'max_age_rating',
  'age_rating_country',
  'category_match',
  'added_after_days',
  'added_since',
  'added_until',
  'added_period',
  'added_period_anchor',
  'added_from_day',
  'added_until_day',
  'released_last_days',
  'released_since',
  'released_until',
  'released_period',
  'released_period_anchor',
  'released_from_day',
  'released_until_day',
];

export const libraryFilterCount = (filters, bothTypes = true) =>
  LIBRARY_EXTRA_FILTERS.filter(
    (field) => filters[field] !== '' && filters[field] != null
  ).length + (bothTypes && filters.type && filters.type !== 'all' ? 1 : 0);

// Periods VOD lists filter dates by. The named ones move on with the date;
// seasons start in January, April, July and October.
export const NAMED_PERIODS = ['week', 'month', 'season', 'year', 'yearly'];
// Periods that are either the current one or a chosen one.
export const UNIT_PERIODS = ['week', 'month', 'season', 'year'];
export const PERIOD_OPTIONS = [
  { value: 'range', label: 'Between dates' },
  { value: 'days', label: 'Last days' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'season', label: 'Season' },
  { value: 'year', label: 'Year' },
  { value: 'yearly', label: 'Every year' },
];
export const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Days are stored as MM-DD and typed as DD.MM.
export const toDayMonth = (value) =>
  MONTH_DAY.test(value) ? `${value.slice(3)}.${value.slice(0, 2)}` : value;
export const fromDayMonth = (value) => {
  const match = /^(\d{2})\.(\d{2})$/.exec(value.trim());
  return match ? `${match[2]}-${match[1]}` : value;
};

export const parseDay = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const dayOf = (year, monthDay) => {
  const [month, day] = monthDay.split('-').map(Number);
  const last = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(day, last));
};

// The window a period covers today, like the server computes it.
export const periodWindow = (
  mode,
  { days, fromDay, untilDay } = {},
  today = new Date()
) => {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const year = day.getFullYear();
  const month = day.getMonth();
  if (mode === 'days' && days) {
    const start = new Date(day);
    start.setDate(start.getDate() - (Number(days) - 1));
    return [start, day];
  }
  if (mode === 'week') {
    const start = new Date(day);
    start.setDate(day.getDate() - ((day.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return [start, end];
  }
  if (mode === 'month')
    return [new Date(year, month, 1), new Date(year, month + 1, 0)];
  if (mode === 'season') {
    const first = Math.floor(month / 3) * 3;
    return [new Date(year, first, 1), new Date(year, first + 3, 0)];
  }
  if (mode === 'year') return [new Date(year, 0, 1), new Date(year, 11, 31)];
  if (
    mode === 'yearly' &&
    MONTH_DAY.test(fromDay || '') &&
    MONTH_DAY.test(untilDay || '')
  ) {
    const from = dayOf(year, fromDay) <= day ? year : year - 1;
    const start = dayOf(from, fromDay);
    const end = dayOf(from, untilDay);
    return [start, end >= start ? end : dayOf(from + 1, untilDay)];
  }
  return null;
};

const dayStart = (value) => {
  const day = value instanceof Date ? value : parseDay(value);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
};

// The window an Added or Released filter of a rules list covers today; open
// sides are null.
export const dateWindow = (filters, prefix, today = new Date()) => {
  const period = filters[`${prefix}_period`];
  const anchor = filters[`${prefix}_period_anchor`];
  let window = period
    ? periodWindow(
        period,
        {
          fromDay: filters[`${prefix}_from_day`],
          untilDay: filters[`${prefix}_until_day`],
        },
        anchor && period !== 'yearly' ? parseDay(anchor) : today
      ) || [null, null]
    : [
        filters[`${prefix}_since`]
          ? dayStart(filters[`${prefix}_since`])
          : null,
        filters[`${prefix}_until`]
          ? dayStart(filters[`${prefix}_until`])
          : null,
      ];
  const days =
    filters[prefix === 'added' ? 'added_after_days' : 'released_last_days'];
  if (days) {
    const [start] = periodWindow('days', { days }, today);
    const end = dayStart(today);
    window = [
      window[0] && window[0] > start ? window[0] : start,
      window[1] && window[1] < end ? window[1] : end,
    ];
  }
  return window;
};

const DATE_KEYS = ['since', 'until', 'period'];

const usesDate = (filters, prefix) =>
  [...DATE_KEYS, prefix === 'added' ? 'after_days' : 'last_days'].some(
    (key) => filters[`${prefix}_${key}`]
  );

// Both dates apply; Released starting after the Added period ends matches
// nothing, as a title reaches the Library at its release at the earliest.
export const dateRules = (filters, today = new Date()) => {
  if (!usesDate(filters, 'added') || !usesDate(filters, 'released')) return '';
  const added = dateWindow(filters, 'added', today);
  const released = dateWindow(filters, 'released', today);
  return released[0] && released[0] > (added[1] || dayStart(today))
    ? 'conflict'
    : 'both';
};
