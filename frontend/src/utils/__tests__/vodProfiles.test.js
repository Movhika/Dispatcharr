import { describe, expect, it } from 'vitest';
import {
  firstMessage,
  buildDuration,
  categoryRows,
  countsText,
  editionConflict,
  editionCountText,
  editionOverlap,
  editionSummary,
  editionUnused,
  exampleName,
  featureTagOptions,
  fieldError,
  filterTagOptions,
  labelSelection,
  labelSummary,
  labelUnused,
  labelledValues,
  languageTagOptions,
  profileErrors,
  profileExample,
  profilePayload,
  profileValidation,
  resolutionOptions,
  setCategoryChoices,
} from '../vodProfiles';

describe('vodProfiles', () => {
  it('names the first server message of nested errors', () => {
    expect(
      firstMessage({
        edition_rules: { 1: { title_suffix: 'Enter a suffix.' } },
      })
    ).toBe('Enter a suffix.');
    expect(firstMessage(['Select a category.'])).toBe('Select a category.');
    expect(firstMessage({})).toBe('');
  });

  it('applies name labels like the server', () => {
    const labels = [
      { field: 'resolution', values: ['1080p'], label: 'FHD' },
      { field: 'dub', values: ['eng'], label: 'ENGLISH' },
      { field: 'sub', values: ['several'], label: 'MULTI-SUB' },
      { field: 'features', values: ['hdr'], label: '' },
    ];
    expect(
      exampleName('{title} [{dub} · {resolution} · {features}]', '', labels)
    ).toBe('Sintel [ENGLISH · FHD]');
    expect(labelledValues('sub', ['ger', 'eng'], labels)).toBe('MULTI-SUB');
    expect(labelledValues('sub', ['ger'], labels)).toBe('GER');
    expect(labelledValues('dub', ['ger', 'eng'], labels)).toBe('GER/ENGLISH');
  });

  it('prefers combinations, then several, then single or other values', () => {
    const labels = [
      { field: 'dub', values: ['eng', 'ger'], label: 'DUAL' },
      { field: 'dub', values: ['several'], label: 'MULTI' },
      { field: 'dub', values: ['other'], label: '' },
      { field: 'resolution', values: ['2160p'], label: '4K' },
      { field: 'resolution', values: ['other'], label: '' },
    ];
    expect(labelledValues('dub', ['ger', 'eng'], labels)).toBe('DUAL');
    expect(labelledValues('dub', ['ger', 'eng', 'fre'], labels)).toBe('MULTI');
    expect(labelledValues('dub', ['eng'], labels)).toBe('');
    expect(labelledValues('resolution', ['2160p'], labels)).toBe('4K');
    expect(labelledValues('resolution', ['1080p'], labels)).toBe('');
  });

  it('keeps Several and Any other value on their own', () => {
    expect(labelSelection(['eng'], ['eng', 'several'])).toEqual(['several']);
    expect(labelSelection(['other'], ['other', 'ger'])).toEqual(['ger']);
    expect(labelSelection(['eng'], ['eng', 'ger'])).toEqual(['eng', 'ger']);
  });

  it('shows short tags and finds options by their full name', () => {
    const options = languageTagOptions([
      { value: 'eng', label: 'English (eng)' },
      { value: 'ger', label: 'German (ger)' },
    ]);
    expect(options[0]).toEqual({
      value: 'eng',
      label: 'ENG',
      name: 'English (eng)',
    });
    expect(filterTagOptions({ options, search: 'germ' })).toEqual([options[1]]);
    expect(featureTagOptions(['dv'])[0].label).toBe('DV');
  });

  it('keeps filled name labels and checks their values', () => {
    const payload = profilePayload({
      name_labels: [
        { field: 'dub', values: [], label: '' },
        { field: 'resolution', values: ['1080p'], label: ' FHD ' },
      ],
    });
    expect(payload.name_labels).toEqual([
      { field: 'resolution', values: ['1080p'], label: 'FHD' },
    ]);
    const errors = profileValidation({
      name: 'P',
      name_template: '{title}',
      name_labels: [
        { field: 'dub', values: ['eng', 'ger'], label: 'DUAL' },
        { field: 'dub', values: ['ger', 'eng'], label: 'BOTH' },
        { field: 'sub', values: [], label: 'X' },
      ],
    });
    expect(fieldError(errors, 'name_labels', 1, 'values')).toBe(
      'Label each value only once.'
    );
    expect(fieldError(errors, 'name_labels', 2, 'values')).toBe(
      'Choose a value.'
    );
  });

  it('formats the example like the server', () => {
    const template = '{title} [{dub} · {resolution} · {features}]';
    expect(exampleName(template)).toBe('Sintel [ENG · 1080p · HDR]');
    expect(exampleName('{title} [{edition} · {sub}] ({provider} | )')).toBe(
      'Sintel [GER] (Provider)'
    );
    expect(exampleName('{title} ({year}) {edition}')).toBe('Sintel (2010)');
    expect(exampleName(template, '4K')).toBe('Sintel 4K [ENG · 1080p · HDR]');
    expect(exampleName('{title} - {unknown}')).toBe('Sintel');
  });

  it('shows only the title, year and edition for Compact entries', () => {
    const labels = [{ field: 'dub', values: ['eng'], label: 'ENGLISH' }];
    const compact = {
      output_mode: 'compact',
      name_template: '{title} ({year}) [{dub}]',
      name_labels: labels,
    };
    expect(profileExample(compact)).toBe('Sintel (2010)');
    expect(profileExample({ ...compact, output_mode: 'variants' })).toBe(
      'Sintel (2010) [ENGLISH]'
    );
    expect(profileValidation(compact).name_template).toBe(
      'Compact names only show {title}, {year} and {edition}; use Sources for source details.'
    );
    expect(
      profileValidation({ ...compact, name_template: '{title} {edition}' })
        .name_template
    ).toBeUndefined();
  });

  it('finds editions that could share a source, like the server', () => {
    const uhd = { title_suffix: '4K', min_resolution: 2160 };
    const hdr = {
      title_suffix: '4K HDR',
      min_resolution: 2160,
      required_video_features: ['hdr'],
    };
    expect(editionOverlap(uhd, hdr)).toBe(
      '4K and 4K HDR overlap: 2160p HDR sources fit both. Exclude HDR from 4K.'
    );
    expect(
      editionOverlap({ ...uhd, excluded_video_features: ['hdr'] }, hdr)
    ).toBe('');
    expect(
      editionOverlap(uhd, { title_suffix: 'HD', max_resolution: 1080 })
    ).toBe('');
    expect(
      editionOverlap(
        { title_suffix: 'German', required_audio_languages: ['ger'] },
        { title_suffix: 'English', required_audio_languages: ['eng'] }
      )
    ).toBe(
      'German and English overlap: ENG/GER sources fit both. Exclude ENG from German.'
    );
    expect(editionOverlap(uhd, { ...uhd, title_suffix: 'UHD' })).toBe(
      '4K and UHD have the same conditions.'
    );
    // Editing the earlier edition names the pair in saved order.
    expect(editionConflict([uhd, hdr], 0)).toBe(editionOverlap(uhd, hdr));
    expect(
      profileValidation({ name_template: '{title}', edition_rules: [uhd, hdr] })
        .edition_rules
    ).toEqual({ 1: { conditions: editionOverlap(uhd, hdr) } });
  });

  it('marks editions the content filters never let a source reach', () => {
    const uhd = { min_resolution: 2160 };
    expect(editionUnused(uhd, { resolution_max: 1080 })).toBe(
      'Not used: the content filters allow up to 1080p.'
    );
    expect(
      editionUnused({ max_resolution: 720 }, { resolution_min: 1080 })
    ).toBe('Not used: the content filters need 1080p or more.');
    expect(
      editionUnused(
        { required_video_features: ['hdr'] },
        { excluded_features: ['hdr'] }
      )
    ).toBe('Not used: the content filters exclude HDR.');
    expect(
      editionUnused(
        { excluded_video_features: ['dv'] },
        { required_features: ['dv'] }
      )
    ).toBe('Not used: the content filters require DV.');
    expect(
      editionUnused(
        { excluded_audio_languages: ['ger', 'eng'] },
        { audio_languages: ['ger', 'eng'] }
      )
    ).toBe('Not used: the content filters need GER or ENG audio.');
    // One allowed language is enough for a source to pass.
    expect(
      editionUnused(
        { excluded_audio_languages: ['eng'] },
        { audio_languages: ['ger', 'eng'] }
      )
    ).toBe('');
    expect(editionUnused(uhd, {})).toBe('');
  });

  it('counts the titles of an edition', () => {
    const counts = { movie: { '4K': 1200, '': 5 }, series: { '4K': 1 } };
    expect(editionCountText(counts, '4K')).toBe('1,200 movies · 1 series');
    expect(editionCountText(counts, 'HDR')).toBe('No titles');
    expect(editionCountText(null, '4K')).toBe('');
  });

  it('summarizes saved editions and labels', () => {
    expect(
      editionSummary({
        min_resolution: 2160,
        required_audio_languages: ['ger'],
        excluded_video_features: ['hdr', 'dv'],
      })
    ).toBe('2160p and up · DUB GER · excludes HDR/DV');
    expect(editionSummary({ max_resolution: 1080 })).toBe('Up to 1080p');
    const label = { field: 'dub', values: ['ger', 'eng'], label: 'DUAL' };
    expect(labelSummary(label)).toBe('{dub} GER + ENG → DUAL');
    expect(labelSummary({ ...label, label: '' })).toBe(
      '{dub} GER + ENG → hidden'
    );
    expect(labelUnused(label, '{title} [{dub}]')).toBe('');
    expect(labelUnused(label, '{title}')).toBe(
      'Not used: the format has no {dub}.'
    );
  });

  it('shows the first edition next to the Compact example', () => {
    const profile = {
      output_mode: 'compact',
      name_template: '{title} ({year})',
      edition_rules: [{ title_suffix: ' ' }, { title_suffix: '4K' }],
    };
    expect(profileExample(profile)).toBe('Sintel (2010), Sintel 4K (2010)');
    expect(profileExample({ ...profile, output_mode: 'variants' })).toBe(
      'Sintel (2010)'
    );
  });

  it('summarizes counts and build time', () => {
    const counts = {
      movie: { titles: 1200, entries: 1350 },
      series: { titles: 1, entries: 2 },
    };
    expect(countsText(counts)).toBe('1,200 movies · 1 series');
    expect(countsText(counts, 'entries')).toBe('1,350 movies · 2 series');
    expect(
      buildDuration('2026-11-03T08:00:00Z', '2026-11-03T08:00:06.6Z')
    ).toBe('6.6 s');
    expect(buildDuration('2026-11-03T08:00:00Z', '2026-11-03T08:02:05Z')).toBe(
      '2 min 5 s'
    );
    expect(buildDuration(null, '2026-11-03T08:00:00Z')).toBe('');
  });

  it('resolves categories like the catalogue', () => {
    const categories = [
      {
        id: 1,
        name: 'DE | Kids',
        category_type: 'movie',
        account: 3,
        enabled: true,
      },
      {
        id: 2,
        name: 'EN | Kids',
        category_type: 'movie',
        account: 4,
        enabled: true,
      },
      {
        id: 3,
        name: 'DE | Drama',
        category_type: 'movie',
        account: 3,
        enabled: true,
      },
      {
        id: 4,
        name: 'DE | Off',
        category_type: 'movie',
        account: 3,
        enabled: false,
      },
      {
        id: 5,
        name: 'DE | Series',
        category_type: 'series',
        account: 3,
        enabled: true,
      },
    ];
    // The server evaluates the import rules; unknown categories are disabled.
    const profile = {
      category_choices: [{ relation: 3, enabled: true }],
      category_rule_states: { 1: true, 2: false, 5: true },
    };
    const rows = categoryRows(categories, profile, 'movie');
    expect(rows.map((row) => [row.id, row.enabled, row.manual])).toEqual([
      [1, true, false],
      [2, false, false],
      [3, true, true],
    ]);
    // A choice that matches the automatic result is dropped.
    expect(setCategoryChoices(profile, [rows[0]], true)).toEqual([
      { relation: 3, enabled: true },
    ]);
    expect(setCategoryChoices(profile, [rows[0], rows[1]], false)).toEqual([
      { relation: 1, enabled: false },
      { relation: 3, enabled: true },
    ]);
    // Back to what the rules decide removes the manual choice.
    expect(setCategoryChoices(profile, [rows[2]], false)).toEqual([]);
  });

  it('builds a clean payload', () => {
    const payload = profilePayload({
      name: 'Kids',
      catalog_status: 'ready',
      content_filters: {
        audio_languages: [],
        resolution_min: 0,
        anime_mode: '',
        adult_mode: 'exclude',
        missing_tmdb_mode: 'exclude',
      },
      edition_rules: [
        { title_suffix: '4K', min_resolution: 2160 },
        { title_suffix: ' ', required_audio_languages: [] },
      ],
    });
    expect(payload.catalog_status).toBeUndefined();
    expect(payload.content_filters).toEqual({
      adult_mode: 'exclude',
      missing_tmdb_mode: 'exclude',
    });
    // Blank editions are dropped.
    expect(payload.edition_rules).toEqual([
      { title_suffix: '4K', min_resolution: 2160, name: '4K' },
    ]);
  });

  it('offers resolutions as pixel heights', () => {
    expect(resolutionOptions(['2160p', '1080p', 'SD', '480p'])).toEqual([
      { value: '0', label: 'Any' },
      { value: '2160', label: '2160p' },
      { value: '1080', label: '1080p' },
      { value: '480', label: 'SD' },
    ]);
  });

  it('maps server errors to fields and tabs', () => {
    expect(
      profileErrors({
        ranking: ['Use only supported ranking criteria.'],
        content_filters: { audio_languages: ['Unknown language.'] },
      })
    ).toEqual({
      errors: {
        ranking: 'Use only supported ranking criteria.',
        content_filters: { audio_languages: 'Unknown language.' },
      },
      detail: '',
      tab: 'content',
    });
    expect(profileErrors({ detail: 'Nope' })).toEqual({
      errors: {},
      detail: 'Nope',
      tab: undefined,
    });
  });

  it('checks fields while editing and missing values on save', () => {
    const values = {
      name: '',
      name_template: '{title} {quality}',
      content_filters: {
        resolution_min: 2160,
        resolution_max: 720,
        required_features: ['hdr'],
        excluded_features: ['hdr'],
      },
      edition_rules: [
        { title_suffix: '4K', min_resolution: 2160 },
        { title_suffix: '4k', required_video_features: ['hdr'] },
        { title_suffix: '' },
        { required_video_features: ['3d'] },
        { title_suffix: 'Extended' },
      ],
    };
    const editing = profileValidation(values);
    expect(editing.name).toBeUndefined();
    expect(editing.name_template).toBe('Unsupported placeholders: {quality}');
    expect(fieldError(editing, 'content_filters', 'resolution_max')).toBe(
      'Choose a maximum at or above the minimum.'
    );
    expect(fieldError(editing, 'content_filters', 'excluded_features')).toBe(
      'A feature cannot be required and excluded.'
    );
    expect(fieldError(editing, 'edition_rules', 1, 'title_suffix')).toBe(
      'Use a unique name for each edition.'
    );
    expect(editing.edition_rules[2]).toEqual({
      title_suffix: 'Enter an edition name.',
      conditions: 'Give each edition at least one condition.',
    });
    expect(editing.edition_rules[3]).toEqual({
      title_suffix: 'Enter an edition name.',
    });
    expect(editing.edition_rules[4]).toEqual({
      conditions: 'Give each edition at least one condition.',
    });
    const saving = profileValidation(values, { submitted: true });
    expect(saving.name).toBe('Enter a profile name.');
    expect(
      profileValidation({ name: 'Kids', name_template: '{year}' }).name_template
    ).toBe('Include {title} in the name format.');
  });
});
