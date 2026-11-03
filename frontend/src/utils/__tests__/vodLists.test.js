import { describe, expect, it } from 'vitest';
import {
  displayName,
  itemsText,
  listErrors,
  listPayload,
  listValidation,
  newList,
} from '../vodLists';

describe('vodLists', () => {
  it('fills {year} and {season} with the anime season of the day', () => {
    expect(displayName('Anime {season} {year}', new Date(2027, 0, 15))).toBe(
      'Anime Winter 2027'
    );
    expect(displayName('Anime {season}', new Date(2027, 9, 1))).toBe(
      'Anime Fall'
    );
  });

  it('downloads only TMDB lists on a schedule', () => {
    expect(newList('manual').refresh_interval).toBe(0);
    expect(newList('rules').refresh_interval).toBe(0);
    expect(newList('tmdb').refresh_interval).toBe(24);
  });

  it('sends only the settings of the list type', () => {
    const rules = listPayload({
      ...newList('rules'),
      name: 'Anime',
      filters: { anime_mode: 'only', genre: '', view: 'titles' },
    });
    expect(rules.filters).toEqual({ anime_mode: 'only' });
    expect(rules).not.toHaveProperty('tmdb_source');
    expect(listPayload(newList('manual'))).not.toHaveProperty('filters');
    expect(rules.list_type).toBe('rules');
    const saved = listPayload({ ...newList('tmdb'), id: 3, name: 'Trending' });
    expect(saved).not.toHaveProperty('list_type');
    expect(saved.tmdb_source).toBe('trending');
  });

  it('checks names, periods and TMDB settings', () => {
    expect(listValidation(newList())).toEqual({ name: 'Enter a list name.' });
    expect(
      listValidation({ ...newList(), name: 'X', visible_from: '13-01' })
    ).toEqual({ visible_from: 'Enter DD.MM.' });
    expect(
      listValidation({
        ...newList('tmdb'),
        name: 'X',
        tmdb_source: 'watch-provider',
        tmdb_settings: { provider_id: '8' },
      })
    ).toEqual({ region: 'Choose a region.' });
    expect(
      listValidation({
        ...newList('tmdb'),
        name: 'X',
        content_type: 'movie',
        tmdb_source: 'discover',
        tmdb_settings: { release_mode: 'days' },
      })
    ).toEqual({ release_days: 'Enter the number of days.' });
  });

  it('rejects Released starting after the Added period', () => {
    const rules = { ...newList('rules'), name: 'X' };
    expect(
      listValidation({
        ...rules,
        filters: { added_until: '2020-12-31', released_since: '2021-01-01' },
      })
    ).toEqual({
      filters:
        'Released starts after the Added period ends, so no title can match.',
    });
    expect(
      listValidation({
        ...rules,
        filters: { added_after_days: 30, released_until: '1990-12-31' },
      })
    ).toEqual({});
  });

  it('maps server errors to the fields', () => {
    expect(
      listErrors({
        tmdb_settings: { list_id: 'Enter the numeric TMDB list ID.' },
        filters: { released_period: ['"x" is not a valid choice.'] },
        detail: 'Nope',
      })
    ).toEqual({
      errors: {
        list_id: 'Enter the numeric TMDB list ID.',
        filters: '"x" is not a valid choice.',
      },
      detail: 'Nope',
    });
  });

  it('summarizes titles', () => {
    expect(itemsText({ titles: 3, available: 2 })).toBe(
      '3 titles · 2 available'
    );
    expect(itemsText({})).toBe('');
  });
});
