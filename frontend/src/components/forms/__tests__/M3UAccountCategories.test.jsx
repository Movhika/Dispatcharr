import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3UAccountCategories from '../M3UAccountCategories.jsx';
import API from '../../../api.js';
import useVODStore from '../../../store/useVODStore';
import { showNotification } from '../../../utils/notificationUtils.js';

const mocks = vi.hoisted(() => ({
  fetchChannelGroups: vi.fn(),
  channelGroups: {},
}));
vi.mock('../../../api.js', () => ({
  default: {
    getPlaylist: vi.fn(),
    getVODCategories: vi.fn(),
  },
}));
vi.mock('../../../store/channels', () => ({
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
const cached = {
  10: {
    id: 10,
    category_type: 'movie',
    m3u_accounts: [
      { m3u_account: 7, enabled: true },
      { m3u_account: 99, enabled: false },
    ],
  },
  11: {
    id: 11,
    category_type: 'movie',
    m3u_accounts: [{ m3u_account: 7, enabled: false }],
  },
  12: {
    id: 12,
    category_type: 'series',
    m3u_accounts: [{ m3u_account: 7, enabled: true }],
  },
};
const show = (props = {}) =>
  render(
    <MantineProvider>
      <M3UAccountCategories account={account} onEdit={vi.fn()} {...props} />
    </MantineProvider>
  );

describe('immediate saved category selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.channelGroups = { 1: { id: 1 }, 2: { id: 2 } };
    mocks.fetchChannelGroups.mockResolvedValue(undefined);
    API.getVODCategories.mockReset();
    useVODStore.setState({
      categories: cached,
      categoriesLoaded: true,
      categoriesLoading: false,
      categoriesError: null,
    });
  });

  it('shows cached selections synchronously without any data request or hint', () => {
    show();
    expect(screen.getAllByText('1 of 2 categories selected')).toHaveLength(2);
    expect(screen.getByText('1 of 1 categories selected')).toBeInTheDocument();
    expect(
      screen.queryByText(/Refresh actions use|Loading category selection/)
    ).toBeNull();
    expect(API.getPlaylist).not.toHaveBeenCalled();
    expect(API.getVODCategories).not.toHaveBeenCalled();
    expect(mocks.fetchChannelGroups).not.toHaveBeenCalled();
  });

  it('keeps Live TV visible while only missing VOD data is loaded', async () => {
    useVODStore.setState({ categories: {}, categoriesLoaded: false });
    let finish;
    API.getVODCategories.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    show();
    expect(screen.getByText('1 of 2 categories selected')).toBeInTheDocument();
    expect(screen.getAllByText('…')).toHaveLength(2);
    expect(screen.queryByText('0 of 0 categories selected')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Edit selection' })
    ).toBeEnabled();
    await act(async () => finish(Object.values(cached)));
    expect(screen.getAllByText('1 of 2 categories selected')).toHaveLength(2);
    expect(API.getVODCategories).toHaveBeenCalledOnce();
    expect(API.getPlaylist).not.toHaveBeenCalled();
    expect(mocks.fetchChannelGroups).not.toHaveBeenCalled();
  });

  it('does not reload successfully loaded empty categories when reopened', () => {
    useVODStore.setState({ categories: {}, categoriesLoaded: true });
    const first = show();
    expect(screen.getAllByText('0 of 0 categories selected')).toHaveLength(2);
    first.unmount();
    show();
    expect(API.getVODCategories).not.toHaveBeenCalled();
  });

  it('does not duplicate a VOD request already in progress', () => {
    useVODStore.setState({
      categories: {},
      categoriesLoaded: false,
      categoriesLoading: true,
    });
    show();
    expect(API.getVODCategories).not.toHaveBeenCalled();
    expect(screen.getByText('1 of 2 categories selected')).toBeInTheDocument();
  });

  it('does not duplicate a missing-data request during Strict Mode effect replay', async () => {
    useVODStore.setState({ categories: {}, categoriesLoaded: false });
    let finish;
    API.getVODCategories.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    render(
      <StrictMode>
        <MantineProvider>
          <M3UAccountCategories account={account} onEdit={vi.fn()} />
        </MantineProvider>
      </StrictMode>
    );
    expect(API.getVODCategories).toHaveBeenCalledOnce();
    await act(async () => finish(Object.values(cached)));
  });

  it('keeps cached data visible during a background refresh', () => {
    useVODStore.setState({ categoriesLoading: true });
    show();
    expect(screen.getAllByText('1 of 2 categories selected')).toHaveLength(2);
    expect(screen.queryByText('…')).toBeNull();
    expect(API.getVODCategories).not.toHaveBeenCalled();
  });

  it('updates saved Live and VOD selections directly without reloading', () => {
    const view = show();
    const changed = {
      ...account,
      channel_groups: account.channel_groups.map((row) => ({
        ...row,
        enabled: false,
      })),
    };
    act(() =>
      useVODStore
        .getState()
        .updateCategorySelections(7, [{ id: 10, enabled: false }])
    );
    view.rerender(
      <MantineProvider>
        <M3UAccountCategories account={changed} onEdit={vi.fn()} />
      </MantineProvider>
    );
    expect(screen.getAllByText('0 of 2 categories selected')).toHaveLength(2);
    expect(API.getPlaylist).not.toHaveBeenCalled();
    expect(API.getVODCategories).not.toHaveBeenCalled();
  });

  it.each([
    { ...account, account_type: 'STD' },
    { ...account, enable_vod: false },
  ])('only shows Live TV without loading unavailable VOD (%j)', (saved) => {
    useVODStore.setState({ categoriesLoaded: false });
    show({ account: saved });
    expect(screen.getByText('1 of 2 categories selected')).toBeInTheDocument();
    expect(screen.queryByText('Movies')).toBeNull();
    expect(API.getVODCategories).not.toHaveBeenCalled();
  });

  it('loads missing names only when opening the selection editor', async () => {
    mocks.channelGroups = {};
    mocks.fetchChannelGroups.mockImplementation(async () => {
      mocks.channelGroups = { 1: {}, 2: {} };
    });
    const onEdit = vi.fn();
    show({ onEdit });
    expect(mocks.fetchChannelGroups).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit selection' }));
    await waitFor(() =>
      expect(onEdit).toHaveBeenCalledExactlyOnceWith(account)
    );
    expect(mocks.fetchChannelGroups).toHaveBeenCalledOnce();
  });

  it('opens the editor immediately with cached names', () => {
    const onEdit = vi.fn();
    show({ onEdit });
    fireEvent.click(screen.getByRole('button', { name: 'Edit selection' }));
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(account);
    expect(mocks.fetchChannelGroups).not.toHaveBeenCalled();
  });

  it('keeps name-loading failures retryable', async () => {
    mocks.channelGroups = {};
    const onEdit = vi.fn();
    show({ onEdit });
    fireEvent.click(screen.getByRole('button', { name: 'Edit selection' }));
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({ color: 'red', autoClose: false })
      )
    );
    expect(onEdit).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Edit selection' })
    ).toBeEnabled();
  });

  it('keeps Live visible and retries only missing VOD data after an error', async () => {
    useVODStore.setState({
      categories: {},
      categoriesLoaded: false,
      categoriesError: 'VOD unavailable',
    });
    API.getVODCategories.mockResolvedValue([]);
    show();
    expect(screen.getByText('1 of 2 categories selected')).toBeInTheDocument();
    expect(API.getVODCategories).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findAllByText('0 of 0 categories selected');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(API.getVODCategories).toHaveBeenCalledOnce();
  });
});
