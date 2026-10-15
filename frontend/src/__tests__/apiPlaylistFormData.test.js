import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../store/auth', () => ({
  default: { getState: () => ({ getToken: () => Promise.resolve('token') }) },
}));
vi.mock('../store/channels', () => ({ default: vi.fn() }));
vi.mock('../store/logos', () => ({ default: vi.fn() }));
vi.mock('../store/userAgents', () => ({ default: vi.fn() }));
vi.mock('../store/serverGroups', () => ({ default: vi.fn() }));
vi.mock('../store/playlists', () => ({
  default: {
    getState: () => ({
      addPlaylist: vi.fn(),
      updatePlaylist: vi.fn(),
    }),
  },
}));
vi.mock('../store/epgs', () => ({ default: vi.fn() }));
vi.mock('../store/streams', () => ({ default: vi.fn() }));
vi.mock('../store/streamProfiles', () => ({ default: vi.fn() }));
vi.mock('../store/outputProfiles', () => ({ default: vi.fn() }));
vi.mock('../store/settings', () => ({ default: vi.fn() }));
vi.mock('../store/channelsTable', () => ({ default: vi.fn() }));
vi.mock('../store/streamsTable', () => ({ default: vi.fn() }));
vi.mock('../store/users', () => ({ default: vi.fn() }));
vi.mock('../store/connect', () => ({ default: vi.fn() }));
vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));
vi.mock('../utils', () => ({
  default: { all: vi.fn() },
  formatApiError: vi.fn(() => 'error'),
}));

import API from '../api';
import { notifications } from '@mantine/notifications';

describe('account import rule requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ updated: 1, results: [] }),
    });
  });
  it.each([
    ['load', () => API.getM3URules(7, 'group-rules', 'live')],
    [
      'save',
      () => API.saveM3URule(7, 'group-rules', 1, { regex_pattern: '[' }),
    ],
    ['delete', () => API.deleteM3URule(7, 'filters', 1)],
    ['preview', () => API.previewM3URules(7, 'group-rules', [], 1, 1, 50)],
    ['reorder', () => API.reorderM3URules(7, 'group-rules', [1], 'live', [0])],
    ['apply', () => API.saveApplyM3UGroupRules(7, [], 1)],
  ])(
    'already emits exactly one API error notification on %s failure',
    async (_operation, request) => {
      globalThis.fetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({ regex_pattern: ['Invalid regular expression.'] }),
      });
      await expect(request()).rejects.toMatchObject({ status: 400 });
      expect(notifications.show).toHaveBeenCalledTimes(1);
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error', color: 'red' })
      );
    }
  );
  it('loads rules from the selected account and content scope', async () => {
    await API.getM3URules(7, 'group-rules', 'movie');
    expect(globalThis.fetch.mock.calls[0][0]).toContain(
      '/api/m3u/accounts/7/group-rules/?scope=movie'
    );
  });
  it('saves edited rows with PATCH, and new rows with POST', async () => {
    await API.saveM3URule(7, 'filters', 2, { regex_pattern: '###' });
    expect(globalThis.fetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ regex_pattern: '###' }),
      })
    );
    await API.saveM3URule(7, 'filters', null, { regex_pattern: 'Sport' });
    expect(globalThis.fetch.mock.calls[1][1].method).toBe('POST');
  });
  it('sends the full ordered draft and selected row to the paginated preview', async () => {
    const rules = [{ preview_id: 'new', regex_pattern: 'Sport' }];
    await API.previewM3URules(7, 'group-rules', rules, 'new', 5, 50);
    expect(globalThis.fetch.mock.calls[0][0]).toContain(
      '/preview-draft/?page=5&page_size=50'
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      rules,
      target_id: 'new',
    });
  });
  it('saves and applies the previewed draft in one request', async () => {
    const rules = [{ preview_id: '2', action: 'enable' }];
    await API.saveApplyM3UGroupRules(7, rules, 2);
    expect(globalThis.fetch.mock.calls[0][0]).toContain(
      '/group-rules/save-apply/'
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      rules,
      target_id: '2',
    });
  });
  it('changes only IDs and positions during reordering', async () => {
    await API.reorderM3URules(7, 'group-rules', [2, 1], 'live', [0, 2]);
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      ids: [2, 1],
      positions: [0, 2],
      scope: 'live',
    });
  });
  it('encodes the search and exact group in content preview requests', async () => {
    await API.getM3UGroupContent(7, 'series', 9, 2, 25, 'Football & Boxing');
    const query = new URL(globalThis.fetch.mock.calls[0][0], 'http://localhost')
      .searchParams;
    expect(Object.fromEntries(query)).toEqual({
      scope: 'series',
      group_id: '9',
      page: '2',
      page_size: '25',
      search: 'Football & Boxing',
    });
  });
  it('propagates rejected group saves rather than reporting false success', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid settings',
    });
    await expect(API.updateM3UGroupSettings(7, [], [])).rejects.toThrow();
  });
});

describe('playlist FormData hash_key clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends an empty string for null hash_key when updating with a file', async () => {
    const appended = [];
    const formData = {
      append: (key, value) => {
        appended.push([key, value]);
      },
    };
    vi.stubGlobal(
      'FormData',
      vi.fn(function FormDataMock() {
        return formData;
      })
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ id: 1, name: 'A' })),
    });

    await API.updatePlaylist({
      id: 1,
      name: 'A',
      hash_key: null,
      file: new Blob(['#EXTM3U'], { type: 'text/plain' }),
    });

    expect(appended).toContainEqual(['hash_key', '']);
    vi.unstubAllGlobals();
  });

  it('sends an empty string for null hash_key when creating with a file', async () => {
    const appended = [];
    const formData = {
      append: (key, value) => {
        appended.push([key, value]);
      },
    };
    vi.stubGlobal(
      'FormData',
      vi.fn(function FormDataMock() {
        return formData;
      })
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ id: 2, name: 'B' })),
    });

    await API.addPlaylist({
      name: 'B',
      hash_key: null,
      file: new Blob(['#EXTM3U'], { type: 'text/plain' }),
    });

    expect(appended).toContainEqual(['hash_key', '']);
    vi.unstubAllGlobals();
  });
});
