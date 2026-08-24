import { describe, expect, it } from 'vitest';

import { normalizeVODFailoverRanking } from '../../utils/vodFailoverRanking';

describe('VODFailoverRanking', () => {
  it('migrates the legacy resolution criterion to highest first', () => {
    expect(normalizeVODFailoverRanking(['resolution'])).toEqual([
      'resolution_desc',
      'audio_language',
      'subtitle_language',
      'bitrate_desc',
      'metadata_completeness',
    ]);
  });

  it('keeps lowest first as the only resolution direction', () => {
    expect(
      normalizeVODFailoverRanking([
        'audio_language',
        'resolution_asc',
        'metadata_completeness',
      ])
    ).toEqual([
      'audio_language',
      'resolution_asc',
      'metadata_completeness',
      'subtitle_language',
      'bitrate_desc',
    ]);
  });

  it('keeps lowest first as the only bitrate direction', () => {
    expect(
      normalizeVODFailoverRanking([
        'bitrate_asc',
        'audio_language',
        'metadata_completeness',
      ])
    ).toEqual([
      'bitrate_asc',
      'audio_language',
      'metadata_completeness',
      'subtitle_language',
      'resolution_desc',
    ]);
  });
});
