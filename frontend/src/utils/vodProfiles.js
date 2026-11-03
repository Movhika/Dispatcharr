// Shared VOD profile vocabulary for the Profiles page and editor.
import { RESOLUTION_TIERS, libraryFilterSummary } from './libraryFilters.js';
import { metadataLanguageLabel } from './vodMetadataLanguages.js';

// Compact entries fall back to other sources, so their names only use the
// placeholders every source shares.
export const NAME_PLACEHOLDERS = [
  { value: 'title', help: 'Library title', compact: true },
  { value: 'year', help: 'Release year', compact: true },
  {
    value: 'edition',
    help: 'Edition name, e.g. 4K',
    compact: true,
    compactOnly: true,
  },
  { value: 'dub', help: 'Audio languages, e.g. GER/ENG' },
  { value: 'sub', help: 'Subtitle languages, e.g. ENG' },
  { value: 'resolution', help: 'Resolution, e.g. 1080p' },
  { value: 'features', help: 'Video features, e.g. HDR' },
  { value: 'format', help: 'Container, e.g. MKV' },
  { value: 'provider', help: 'M3U account name' },
];

export const OUTPUT_MODES = [
  { value: 'compact', label: 'Compact' },
  { value: 'variants', label: 'Sources' },
];

export const OUTPUT_GROUPS = [
  { value: 'provider', label: 'Provider' },
  { value: 'movie_series', label: 'Movie & Series' },
  { value: 'lists', label: 'Lists' },
];

export const METADATA_SOURCES = [
  { value: 'provider', label: 'Provider' },
  { value: 'enriched', label: 'Enriched' },
];

export const titleSourceLabel = (value) =>
  value === 'clean'
    ? 'Clean title'
    : value && value !== 'provider'
      ? metadataLanguageLabel(value)
      : 'Provider';

export const optionLabel = (choices, value) =>
  choices.find((choice) => choice.value === value)?.label || value;

export const CATALOG_STATUS = {
  pending: { label: 'Pending', color: 'yellow' },
  building: { label: 'Preparing', color: 'blue' },
  ready: { label: 'Ready', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
};

export const RULE_ACTIONS = [
  { value: 'include', label: 'Include' },
  { value: 'exclude', label: 'Exclude' },
];

const FEATURE_LABELS = { '3d': '3D', hdr: 'HDR', dv: 'DV (Dolby Vision)' };
const FEATURE_TAGS = { '3d': '3D', hdr: 'HDR', dv: 'DV' };

export const newProfile = () => ({
  name: '',
  is_active: true,
  is_default: false,
  output_mode: 'compact',
  output_groups: 'provider',
  name_template: '{title}',
  name_labels: [],
  title_source: 'provider',
  metadata_source: 'provider',
  content_rules: [],
  excluded_titles: [],
  edition_rules: [],
  ranking: ['provider'],
  audio_language_order: [],
  subtitle_language_order: [],
  provider_order: [],
  lists: [],
  include_unsorted: true,
});

const EDITABLE_FIELDS = Object.keys(newProfile());

// Placeholders whose values a profile can rename, e.g. 1080p as FHD.
export const NAME_LABEL_FIELDS = [
  { value: 'dub', label: '{dub}' },
  { value: 'sub', label: '{sub}' },
  { value: 'resolution', label: '{resolution}' },
  { value: 'features', label: '{features}' },
];

// Two or more languages of a source, e.g. MULTI-SUB.
export const SEVERAL = 'several';
// Every value without a label of its own, e.g. to hide all but 2160p.
export const OTHER = 'other';
const SPECIAL_VALUES = [SEVERAL, OTHER];

export const newNameLabel = () => ({ field: 'dub', values: [], label: '' });

// An added label nobody filled in is not kept.
export const isBlankLabel = (row) =>
  !(row.values || []).length && !row.label?.trim();

// Several languages and Any other value stand alone in a label.
export const labelSelection = (previous, next) => {
  const added = next.find((value) => !previous.includes(value));
  if (SPECIAL_VALUES.includes(added)) return [added];
  return next.filter((value) => !SPECIAL_VALUES.includes(value));
};

// Each set of source values an edition can require or exclude.
const EDITION_SETS = [
  'audio_languages',
  'subtitle_languages',
  'video_features',
];

export const newEditionRule = () => ({
  title_suffix: '',
  min_resolution: 0,
  max_resolution: 0,
  ...Object.fromEntries(
    EDITION_SETS.flatMap((field) => [
      [`required_${field}`, []],
      [`excluded_${field}`, []],
    ])
  ),
});

const newRuleId = () =>
  `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// A rule is a Library filter and whether it includes or excludes.
export const newContentRule = () => ({
  id: newRuleId(),
  name: '',
  enabled: true,
  action: 'include',
  filters: {},
});

const isEmpty = (value) =>
  value === '' ||
  value === 0 ||
  value == null ||
  (Array.isArray(value) && value.length === 0);

const EDITION_CONDITIONS = [
  'min_resolution',
  'max_resolution',
  ...EDITION_SETS.flatMap((field) => [
    `required_${field}`,
    `excluded_${field}`,
  ]),
];

const valueLabel = (field, value) =>
  field === 'video_features'
    ? value.replace(/^custom:/, '').toUpperCase()
    : value.toUpperCase();

const condition = (rule, key) => {
  const value = rule[key] || 0;
  return Array.isArray(value) ? [...value].sort().join('+') : value;
};

// Mirrors the server: why both editions could take the same source, or ''
// when none fits both, with an exclusion that separates them.
export const editionOverlap = (first, second) => {
  const low = Math.max(first.min_resolution || 0, second.min_resolution || 0);
  const highs = [first.max_resolution, second.max_resolution].filter(Boolean);
  if (highs.length && low > Math.min(...highs)) return '';
  const required = {};
  for (const field of EDITION_SETS) {
    const values = new Set([
      ...(first[`required_${field}`] || []),
      ...(second[`required_${field}`] || []),
    ]);
    const excluded = [
      ...(first[`excluded_${field}`] || []),
      ...(second[`excluded_${field}`] || []),
    ];
    if (excluded.some((value) => values.has(value))) return '';
    required[field] = [...values].sort();
  }
  const a = first.title_suffix?.trim();
  const b = second.title_suffix?.trim();
  if (
    EDITION_CONDITIONS.every(
      (key) => condition(first, key) === condition(second, key)
    )
  )
    return `${a} and ${b} have the same conditions.`;
  const height = low || (highs.length ? Math.min(...highs) : 0);
  const words = height ? [`${height}p`] : [];
  words.push(
    ...required.video_features.map((value) =>
      valueLabel('video_features', value)
    )
  );
  if (required.audio_languages.length)
    words.push(
      required.audio_languages.map((value) => value.toUpperCase()).join('/')
    );
  let example = words.length ? `${words.join(' ')} sources` : 'All sources';
  if (required.subtitle_languages.length)
    example += ` with ${required.subtitle_languages
      .map((value) => value.toUpperCase())
      .join('/')} subtitles`;
  for (const field of [
    'video_features',
    'audio_languages',
    'subtitle_languages',
  ]) {
    for (const [target, other] of [
      [first, second],
      [second, first],
    ]) {
      const extra = (other[`required_${field}`] || []).filter(
        (value) => !(target[`required_${field}`] || []).includes(value)
      );
      if (extra.length)
        return `${a} and ${b} overlap: ${example} fit both. Exclude ${valueLabel(
          field,
          extra[0]
        )} from ${target.title_suffix.trim()}.`;
    }
  }
  return `${a} and ${b} overlap: ${example} fit both. Narrow their conditions.`;
};

// Whether an edition still has its saved name and conditions.
export const sameEdition = (saved, rule) =>
  saved.title_suffix?.trim() === rule.title_suffix?.trim() &&
  EDITION_CONDITIONS.every(
    (key) => condition(saved, key) === condition(rule, key)
  );

// The first overlap of one edition with any other, named in saved order.
export const editionConflict = (rules, index) => {
  for (const [other, rule] of rules.entries()) {
    if (other === index || isBlankEdition(rule)) continue;
    const message =
      other < index
        ? editionOverlap(rule, rules[index])
        : editionOverlap(rules[index], rule);
    if (message) return message;
  }
  return '';
};

const SET_LABELS = {
  audio_languages: 'DUB',
  subtitle_languages: 'SUB',
  video_features: '',
};

const setSummary = (rule, kind) =>
  EDITION_SETS.filter((field) => (rule[`${kind}_${field}`] || []).length)
    .map((field) =>
      [
        SET_LABELS[field],
        rule[`${kind}_${field}`]
          .map((value) => valueLabel(field, value))
          .join('/'),
      ]
        .filter(Boolean)
        .join(' ')
    )
    .join(', ');

// One line for a saved edition, e.g. "2160p and up · HDR · excludes DV".
export const editionSummary = (rule) => {
  const min = rule.min_resolution || 0;
  const max = rule.max_resolution || 0;
  const parts = [];
  if (min && max) parts.push(min === max ? `${min}p` : `${min}p to ${max}p`);
  else if (min) parts.push(`${min}p and up`);
  else if (max) parts.push(`Up to ${max}p`);
  const required = setSummary(rule, 'required');
  if (required) parts.push(required);
  const excluded = setSummary(rule, 'excluded');
  if (excluded) parts.push(`excludes ${excluded}`);
  return parts.join(' · ') || 'No conditions';
};

// Filter values a rule keeps; blanks are left out.
export const ruleFilters = (filters = {}) =>
  Object.fromEntries(
    Object.entries(filters).filter(
      ([key, value]) =>
        value !== '' && value != null && !(key === 'type' && value === 'all')
    )
  );

const ruleType = (rule) => ruleFilters(rule.filters).type || 'all';

// Whether a rule matches every source of its content type.
export const matchesEverything = (rule) =>
  Object.keys(ruleFilters(rule.filters)).every((key) => key === 'type');

// An added rule nobody changed is not worth asking about.
export const isBlankContentRule = (rule) =>
  !rule.name?.trim() && rule.action === 'include' && matchesEverything(rule);

// The name a rule goes by in the editor and the preview.
export const contentRuleName = (rule, index) =>
  rule.name?.trim() || `Rule ${index + 1}`;

// One line for a rule's filter, e.g. "Category ~ WWE · DUB GER · Movies".
export const contentRuleSummary = (rule, options = {}) =>
  libraryFilterSummary(ruleFilters(rule.filters), options) || 'Every source';

// Why no source ever reaches a rule, or '': an earlier enabled rule of the
// same content types matches every source.
export const contentRuleUnused = (rules, index) => {
  const rule = rules[index];
  if (rule.enabled === false) return 'Disabled.';
  const covering = rules
    .slice(0, index)
    .find(
      (other) =>
        other.enabled !== false &&
        matchesEverything(other) &&
        [ruleType(rule), 'all'].includes(ruleType(other))
    );
  return covering
    ? `Not used: ${contentRuleName(covering, rules.indexOf(covering))} matches every source first.`
    : '';
};

// The rules of a profile card, e.g. "2 rules · 1 include, 1 exclude".
export const contentRulesText = (rules = []) => {
  const active = rules.filter((rule) => rule.enabled !== false);
  if (!active.length) return 'No rules · every source';
  const includes = active.filter((rule) => rule.action === 'include').length;
  return [
    `${active.length} ${active.length === 1 ? 'rule' : 'rules'}`,
    [
      includes && `${includes} include`,
      active.length - includes && `${active.length - includes} exclude`,
    ]
      .filter(Boolean)
      .join(', '),
  ].join(' · ');
};

const plural = (count, one, many) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

// Offered titles of an edition from the preview counts, e.g. "3 movies".
export const editionCountText = (counts, name) => {
  if (!counts) return '';
  const movies = counts.movie?.[name] || 0;
  const series = counts.series?.[name] || 0;
  if (!movies && !series) return 'No titles';
  return [
    movies && plural(movies, 'movie', 'movies'),
    series && plural(series, 'series', 'series'),
  ]
    .filter(Boolean)
    .join(' · ');
};

const LABEL_VALUE_NAMES = { several: 'Several', other: 'Any other' };

// One line for a saved label, e.g. "{dub} GER + ENG → DUAL".
export const labelSummary = (row) => {
  const values = (row.values || [])
    .map(
      (value) =>
        LABEL_VALUE_NAMES[value] ||
        (row.field === 'features'
          ? valueLabel('video_features', value)
          : row.field === 'resolution'
            ? value
            : value.toUpperCase())
    )
    .join(' + ');
  const text = row.label?.trim() ? row.label.trim() : 'hidden';
  return `{${row.field}} ${values || '…'} → ${text}`;
};

// Labels only change placeholders the format shows.
export const labelUnused = (row, template) =>
  String(template || '').includes(`{${row.field}}`)
    ? ''
    : `Not used: the format has no {${row.field}}.`;

// An added edition nobody filled in is not kept.
export const isBlankEdition = (rule) =>
  !rule.title_suffix?.trim() &&
  EDITION_CONDITIONS.every((field) => isEmpty(rule[field]));

export const profilePayload = (values) => {
  const payload = Object.fromEntries(
    EDITABLE_FIELDS.map((field) => [field, values[field]])
  );
  payload.content_rules = (values.content_rules || []).map((rule) => ({
    ...rule,
    name: rule.name?.trim() || '',
    filters: ruleFilters(rule.filters),
  }));
  payload.name_labels = (values.name_labels || [])
    .filter((row) => !isBlankLabel(row))
    .map((row) => ({ ...row, label: row.label?.trim() || '' }));
  // The suffix doubles as the edition name.
  payload.edition_rules = (values.edition_rules || [])
    .filter((rule) => !isBlankEdition(rule))
    .map((rule) => ({ ...rule, name: rule.title_suffix }));
  return payload;
};

const resolutionHeight = (value) => {
  if (String(value).toLowerCase() === 'sd') return 480;
  const match = /^(\d{3,4})p$/i.exec(String(value || ''));
  return match ? Number(match[1]) : 0;
};

export const resolutionOptions = (resolutions = [], anyLabel = 'Any') => {
  // 480p and SD share a height; offer each height once.
  const heights = new Map();
  for (const value of resolutions) {
    const height = resolutionHeight(value);
    if (height && !heights.has(height)) heights.set(height, value);
  }
  return [
    { value: '0', label: anyLabel },
    ...[...heights].map(([height, label]) => ({
      value: String(height),
      label,
    })),
  ];
};

export const languageOptions = (languages = []) =>
  languages.map((language) => ({
    value: language.value,
    label: language.label,
  }));

export const featureOptions = (features = []) =>
  features.map((value) => ({ value, label: FEATURE_LABELS[value] || value }));

// Short tags in the field (ENG, DV), full names in the list.
export const languageTagOptions = (languages = []) =>
  languages.map((language) => ({
    value: language.value,
    label: language.value.toUpperCase(),
    name: language.label,
  }));

export const featureTagOptions = (features = []) =>
  features.map((value) => ({
    value,
    label: FEATURE_TAGS[value] || value.replace(/^custom:/, '').toUpperCase(),
    name: FEATURE_LABELS[value] || value,
  }));

export const renderTagOption = ({ option }) => option.name || option.label;

export const filterTagOptions = ({ options, search }) => {
  const term = search.trim().toLowerCase();
  return options.filter((option) =>
    `${option.name || ''} ${option.label}`.toLowerCase().includes(term)
  );
};

// Blender's open movie Sintel, so examples show a real, free title.
const SAMPLE = {
  title: 'Sintel',
  year: '2010',
  format: 'MKV',
  provider: 'Provider',
};
const SAMPLE_VALUES = {
  dub: ['eng'],
  sub: ['ger'],
  resolution: ['1080p'],
  features: ['hdr'],
};
const DEFAULT_TEXT = {
  dub: (value) => value.toUpperCase(),
  sub: (value) => value.toUpperCase(),
  resolution: (value) => value,
  features: (value) => value.replace(/^custom:/, '').toUpperCase(),
};

const combination = (values) => [...values].sort().join('+');

// Mirrors the server: an exact combination wins, then several languages,
// then each value's own label, any other value, or the plain value.
export const labelledValues = (field, values, labels = []) => {
  if (!values.length) return '';
  const rules = new Map(
    labels
      .filter((row) => row.field === field && (row.values || []).length)
      .map((row) => [combination(row.values), row.label?.trim() || ''])
  );
  if (values.length > 1) {
    for (const key of [combination(values), SEVERAL]) {
      if (rules.has(key)) return rules.get(key);
    }
  }
  return values
    .map((value) =>
      rules.has(value)
        ? rules.get(value)
        : rules.has(OTHER)
          ? rules.get(OTHER)
          : DEFAULT_TEXT[field](value)
    )
    .filter(Boolean)
    .join('/');
};

// Drop empty parts inside brackets, e.g. "[ · 1080p · ]" becomes "[1080p]".
const tidyGroup = (match, open, inner, close) => {
  let text = inner;
  for (const separator of ['·', '|']) {
    text = text
      .split(separator)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(` ${separator} `);
  }
  return text ? `${open}${text}${close}` : '';
};

// Mirrors the server formatting so the example matches client output.
// Without sources (Compact), source details and labels are left out.
export const exampleName = (
  template,
  edition = '',
  labels = [],
  sources = true
) => {
  let source = String(template || '');
  if (edition && !source.includes('{edition}')) {
    source = source.replace('{title}', '{title} {edition}');
  }
  const marker = '\u0000';
  const values = sources
    ? { ...SAMPLE, title: marker, edition }
    : { year: SAMPLE.year, title: marker, edition };
  if (sources) {
    for (const [field, items] of Object.entries(SAMPLE_VALUES)) {
      values[field] = labelledValues(field, items, labels);
    }
  }
  const name = source
    .replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : ''))
    .replace(/([[(])([^[\]()]*)([\])])/g, tidyGroup)
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·|-]+|[\s·|-]+$/g, '');
  return name.replace(marker, SAMPLE.title) || SAMPLE.title;
};

// Compact profiles with editions also show the first edition's entry.
export const profileExample = (profile) => {
  const sources = profile.output_mode === 'variants';
  const name = (edition) =>
    exampleName(profile.name_template, edition, profile.name_labels, sources);
  const edition = sources
    ? ''
    : (profile.edition_rules || [])
        .map((rule) => rule.title_suffix?.trim())
        .find(Boolean);
  return edition ? `${name('')}, ${name(edition)}` : name('');
};

// Distinct titles, or the entries clients get in their lists.
export const countsText = (counts, field = 'titles') =>
  [
    ['movie', (count) => (count === 1 ? 'movie' : 'movies')],
    ['series', () => 'series'],
  ]
    .filter(([kind]) => Number.isInteger(counts?.[kind]?.[field]))
    .map(
      ([kind, noun]) =>
        `${counts[kind][field].toLocaleString()} ${noun(counts[kind][field])}`
    )
    .join(' · ');

export const durationText = (seconds) =>
  seconds < 60
    ? `${seconds.toFixed(1)} s`
    : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;

export const buildDuration = (startedAt, completedAt) => {
  const seconds = (new Date(completedAt) - new Date(startedAt)) / 1000;
  if (!startedAt || !completedAt || !(seconds >= 0)) return '';
  return durationText(seconds);
};

const TAB_FIELDS = {
  general: [
    'name',
    'is_default',
    'title_source',
    'metadata_source',
    'output_mode',
    'output_groups',
    'name_template',
  ],
  lists: ['lists'],
  content: ['content_rules'],
  editions: ['edition_rules'],
  failover: [
    'ranking',
    'audio_language_order',
    'subtitle_language_order',
    'provider_order',
  ],
  labels: ['name_labels'],
};

const message = (value) => {
  if (Array.isArray(value)) return value.map(message).join(' ');
  if (value && typeof value === 'object')
    return Object.values(value).map(message).join(' ');
  return String(value ?? '');
};

// Rules and editions report errors per rule and field.
const NESTED_FIELDS = ['content_rules', 'edition_rules'];

const nested = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, nested(item)])
      )
    : message(value);

// Flatten DRF errors per field and name the editor tab that holds them.
export const profileErrors = (body) => {
  const errors = {};
  let detail = '';
  if (body && typeof body === 'object') {
    for (const [field, value] of Object.entries(body)) {
      if (field === 'detail' || field === 'non_field_errors')
        detail = message(value);
      else
        errors[field] = NESTED_FIELDS.includes(field)
          ? nested(value)
          : message(value);
    }
  }
  const tab = Object.keys(TAB_FIELDS).find((name) =>
    TAB_FIELDS[name].some((field) => field in errors)
  );
  return { errors, detail, tab };
};

// The first message of a possibly nested error, for a notification.
export const firstMessage = (value) => {
  if (typeof value === 'string') return value;
  const items = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value)
      : [];
  return items.map(firstMessage).find(Boolean) || '';
};

export const tabHasError = (tab, errors) =>
  TAB_FIELDS[tab]?.some((field) => field in errors) || false;

const PLACEHOLDER_VALUES = new Set(NAME_PLACEHOLDERS.map((item) => item.value));
const COMPACT_VALUES = new Set(
  NAME_PLACEHOLDERS.filter((item) => item.compact).map((item) => item.value)
);

// The server's checks, run while editing so fields show problems right away.
// Missing values are only reported after a save attempt.
export const profileValidation = (values, { submitted = false } = {}) => {
  const errors = {};
  if (submitted && !values.name?.trim()) errors.name = 'Enter a profile name.';

  const template = values.name_template?.trim() || '';
  const fields = [...template.matchAll(/\{([^{}]*)\}/g)].map(
    (match) => match[1]
  );
  const unsupported = fields.filter((field) => !PLACEHOLDER_VALUES.has(field));
  if (!template) {
    if (submitted) errors.name_template = 'Enter a name format.';
  } else if (unsupported.length)
    errors.name_template = `Unsupported placeholders: ${unsupported
      .map((field) => `{${field}}`)
      .join(', ')}`;
  else if (!fields.includes('title'))
    errors.name_template = 'Include {title} in the name format.';
  else if (
    values.output_mode !== 'variants' &&
    fields.some((field) => !COMPACT_VALUES.has(field))
  )
    errors.name_template =
      'Compact names only show {title}, {year} and {edition}; use Sources for source details.';

  const labelErrors = {};
  const labelled = new Set();
  (values.name_labels || []).forEach((row, index) => {
    const key = `${row.field}:${combination(row.values || [])}`;
    if (!(row.values || []).length)
      labelErrors[index] = { values: 'Choose a value.' };
    else if (labelled.has(key))
      labelErrors[index] = { values: 'Label each value only once.' };
    labelled.add(key);
  });
  if (Object.keys(labelErrors).length) errors.name_labels = labelErrors;

  const ruleErrors = {};
  (values.content_rules || []).forEach((rule, index) => {
    const filters = rule.filters || {};
    const rowErrors = {};
    const low = RESOLUTION_TIERS.indexOf(filters.resolution_min);
    const high = RESOLUTION_TIERS.indexOf(filters.resolution_max);
    if (low >= 0 && high >= 0 && low < high)
      rowErrors.resolution_max = 'Choose a maximum at or above the minimum.';
    try {
      new RegExp(filters.category_match || '');
    } catch {
      rowErrors.category_match = 'Enter a valid regular expression.';
    }
    if (Object.keys(rowErrors).length) ruleErrors[index] = rowErrors;
  });
  if (Object.keys(ruleErrors).length) errors.content_rules = ruleErrors;

  // Rows are only blank while they are added; the editor hides their problems
  // until their save is tried.
  const editionErrors = {};
  const suffixes = new Set();
  const rules = values.edition_rules || [];
  rules.forEach((rule, index) => {
    const rowErrors = {};
    const suffix = rule.title_suffix?.trim().toLowerCase() || '';
    if (!suffix) rowErrors.title_suffix = 'Enter an edition name.';
    else if (suffixes.has(suffix))
      rowErrors.title_suffix = 'Use a unique name for each edition.';
    suffixes.add(suffix);
    if (rule.max_resolution && (rule.min_resolution || 0) > rule.max_resolution)
      rowErrors.max_resolution = 'Choose a maximum at or above the minimum.';
    for (const field of EDITION_SETS) {
      const required = rule[`required_${field}`] || [];
      if (
        (rule[`excluded_${field}`] || []).some((value) =>
          required.includes(value)
        )
      )
        rowErrors[`excluded_${field}`] =
          'A value cannot be required and excluded.';
    }
    if (EDITION_CONDITIONS.every((field) => isEmpty(rule[field])))
      rowErrors.conditions = 'Give each edition at least one condition.';
    else if (suffix) {
      // Like the server, an overlap is reported on the later edition.
      const earlier = rules
        .slice(0, index)
        .find((other) => !isBlankEdition(other) && editionOverlap(other, rule));
      if (earlier) rowErrors.conditions = editionOverlap(earlier, rule);
    }
    if (Object.keys(rowErrors).length) editionErrors[index] = rowErrors;
  });
  if (Object.keys(editionErrors).length) errors.edition_rules = editionErrors;
  return errors;
};

// A field's own message from a flat or nested error, e.g. edition 0's suffix.
export const fieldError = (errors, field, ...path) => {
  let value = errors[field];
  for (const key of path) {
    if (!value || typeof value !== 'object') return undefined;
    value = value[key];
  }
  return typeof value === 'string' ? value : undefined;
};

// A field-level message that no single input shows, e.g. a server message.
export const generalError = (errors, field) =>
  typeof errors[field] === 'string' ? errors[field] : undefined;
