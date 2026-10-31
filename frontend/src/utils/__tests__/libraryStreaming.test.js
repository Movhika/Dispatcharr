import { describe, expect, it } from 'vitest';
import {
  includedServices,
  streamingGroups,
  streamingSummary,
} from '../libraryStreaming.js';

const providers = {
  DE: {
    link: '',
    flatrate: [
      { id: 8, name: 'Netflix' },
      { id: 9, name: 'Prime Video' },
    ],
    ads: [{ id: 8, name: 'Netflix' }],
    rent: [{ id: 2, name: 'Apple TV' }],
  },
  US: { buy: [{ id: 2, name: 'Apple TV' }] },
  FR: { free: [{ id: 337, name: 'Arte' }] },
};

describe('libraryStreaming', () => {
  it('lists included offers per region without rent or buy', () => {
    expect(streamingSummary(providers)).toBe(
      'Netflix, Prime Video (DE) · Arte (FR)'
    );
    expect(includedServices(providers).map((row) => row.value)).toEqual([
      'DE:8',
      'DE:9',
      'FR:337',
    ]);
  });

  it('ignores missing or malformed data', () => {
    expect(streamingSummary(undefined)).toBe('');
    expect(streamingSummary([])).toBe('');
    expect(streamingSummary({ DE: { flatrate: 'Netflix' } })).toBe('');
    expect(includedServices({ DE: { flatrate: [{ name: 'No ID' }] } })).toEqual(
      []
    );
  });

  it('groups services by region and keeps unknown selections', () => {
    expect(
      streamingGroups(
        [
          { value: 'DE:8', region: 'DE', name: 'Netflix' },
          { value: 'US:9', region: 'US', name: 'Prime Video' },
        ],
        ['DE:8', 'FR:337']
      )
    ).toEqual([
      { group: 'Germany', items: [{ value: 'DE:8', label: 'Netflix' }] },
      {
        group: 'United States',
        items: [{ value: 'US:9', label: 'Prime Video' }],
      },
      { group: 'France', items: [{ value: 'FR:337', label: 'FR:337' }] },
    ]);
  });
});
