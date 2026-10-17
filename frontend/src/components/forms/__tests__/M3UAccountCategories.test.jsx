import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3UAccountCategories from '../M3UAccountCategories.jsx';
import API from '../../../api.js';
import { showNotification } from '../../../utils/notificationUtils.js';

const mocks = vi.hoisted(() => ({
  fetchChannelGroups: vi.fn(),
  fetchCategories: vi.fn(),
  channelGroups: { 1: { id: 1 }, 2: { id: 2 } },
  categories: {},
  categoriesError: null,
}));
vi.mock('../../../api.js', () => ({ default: { getPlaylist: vi.fn() } }));
vi.mock('../../../store/channels', () => ({
  default: Object.assign((selector) => selector(mocks), {
    getState: () => mocks,
  }),
}));
vi.mock('../../../store/useVODStore', () => ({
  default: Object.assign((selector) => selector(mocks), {
    getState: () => mocks,
  }),
}));
vi.mock('../../../utils/notificationUtils.js', () => ({
  showNotification: vi.fn(),
  hideNotification: vi.fn(),
}));

const account = {
  id: 7,
  account_type: 'XC',
  enable_vod: true,
  channel_groups: [
    { channel_group: 1, enabled: true },
    { channel_group: 2, enabled: false },
  ],
};
const show = (props = {}) =>
  render(
    <MantineProvider>
      <M3UAccountCategories account={account} onEdit={vi.fn()} {...props} />
    </MantineProvider>
  );

describe('saved category selection in the account editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getPlaylist.mockResolvedValue(account);
    mocks.fetchChannelGroups.mockResolvedValue(undefined);
    mocks.fetchCategories.mockResolvedValue(undefined);
    mocks.categoriesError = null;
    mocks.categories = {
      10: {
        category_type: 'movie',
        m3u_accounts: [
          { m3u_account: 7, enabled: true },
          { m3u_account: 99, enabled: false },
        ],
      },
      11: {
        category_type: 'movie',
        m3u_accounts: [{ m3u_account: 7, enabled: false }],
      },
      12: {
        category_type: 'series',
        m3u_accounts: [{ m3u_account: 7, enabled: true }],
      },
    };
  });

  it('shows the shared Live TV, Movies and Series summary without saving or importing', async () => {
    const onEdit = vi.fn();
    show({ onEdit });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit selection' })
    );
    expect(
      screen.getByRole('region', { name: 'Category selection' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('1 of 2 categories selected')).toHaveLength(2);
    expect(screen.getByText('1 of 1 categories selected')).toBeInTheDocument();
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(account);
    expect(API.getPlaylist).toHaveBeenCalledExactlyOnceWith(7);
    expect(mocks.fetchCategories).toHaveBeenCalledOnce();
  });

  it('reloads the summary after returning from the selection editor', async () => {
    const view = show();
    await screen.findByRole('button', { name: 'Edit selection' });
    API.getPlaylist.mockResolvedValue({
      ...account,
      channel_groups: account.channel_groups.map((group) => ({
        ...group,
        enabled: false,
      })),
    });
    view.rerender(
      <MantineProvider>
        <M3UAccountCategories
          account={account}
          onEdit={vi.fn()}
          refreshKey={1}
        />
      </MantineProvider>
    );
    await screen.findByText('0 of 2 categories selected');
    expect(API.getPlaylist).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...account, account_type: 'STD' },
    { ...account, enable_vod: false },
  ])('only shows Live TV when VOD is unavailable (%j)', async (saved) => {
    API.getPlaylist.mockResolvedValue(saved);
    show({ account: saved });
    await screen.findByRole('button', { name: 'Edit selection' });
    expect(screen.getByText('Live TV')).toBeInTheDocument();
    expect(screen.queryByText('Movies')).not.toBeInTheDocument();
    expect(screen.queryByText('Series')).not.toBeInTheDocument();
    expect(mocks.fetchCategories).not.toHaveBeenCalled();
  });

  it('keeps load failures retryable without enabling the editor', async () => {
    API.getPlaylist.mockRejectedValueOnce(new Error('Request failed'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: 'Edit selection' });
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({ color: 'red', autoClose: false })
    );
  });

  it('does not present missing VOD data as an empty selection', async () => {
    mocks.categoriesError = 'VOD categories unavailable';
    show();
    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.queryByRole('button', { name: 'Edit selection' })).toBeNull();
    expect(screen.queryByText(/categories selected/)).toBeNull();
  });
});
