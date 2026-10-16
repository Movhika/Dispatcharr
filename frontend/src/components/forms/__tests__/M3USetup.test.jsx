import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3USetup from '../M3USetup.jsx';
import API from '../../../api.js';
import { showNotification } from '../../../utils/notificationUtils.js';

const mocks = vi.hoisted(() => ({
  fetchChannelGroups: vi.fn(),
  fetchEPGs: vi.fn(),
  fetchCategories: vi.fn(),
  updatePlaylist: vi.fn(),
  channelGroups: { 1: { id: 1, name: 'Example category' } },
}));
vi.mock('../../../api.js', () => ({
  default: { getPlaylist: vi.fn(), advanceM3USetup: vi.fn() },
}));
vi.mock('../../../store/channels', () => ({
  default: Object.assign((selector) => selector(mocks), {
    getState: () => mocks,
  }),
}));
vi.mock('../../../store/epgs', () => ({
  default: Object.assign((selector) => selector(mocks), {
    getState: () => mocks,
  }),
}));
vi.mock('../../../store/useVODStore', () => ({
  default: Object.assign((selector) => selector(mocks), {
    getState: () => mocks,
  }),
}));
vi.mock('../../../store/playlists', () => ({
  default: { getState: () => mocks },
}));
vi.mock('../../../utils/notificationUtils.js', () => ({
  showNotification: vi.fn(),
  hideNotification: vi.fn(),
}));
vi.mock('../M3UGroupFilter.jsx', () => ({
  default: ({ onSetupComplete, onClose, onEditAccount, setupHeader }) => (
    <div role="dialog" aria-label="Category setup">
      {setupHeader}
      <button onClick={onSetupComplete}>Finish and start import</button>
      <button onClick={onClose}>Close categories</button>
      <button onClick={onEditAccount}>Edit account</button>
    </div>
  ),
}));

const account = {
  id: 7,
  name: 'Example setup',
  account_type: 'XC',
  setup_step: 'epg',
  status: 'pending_setup',
  channel_groups: [],
};
const renderSetup = (overrides = {}) => {
  const props = {
    account,
    onClose: vi.fn(),
    onEditAccount: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <MantineProvider>
        <M3USetup {...props} />
      </MantineProvider>
    ),
    ...props,
  };
};

describe('persisted M3U setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.advanceM3USetup.mockReset();
    API.getPlaylist.mockReset();
    mocks.fetchEPGs.mockResolvedValue(undefined);
    mocks.fetchChannelGroups.mockResolvedValue(undefined);
    mocks.fetchCategories.mockResolvedValue(undefined);
    API.getPlaylist.mockResolvedValue(account);
  });

  it.each(['skip_epg', 'create_epg'])(
    'advances the existing account with %s',
    async (action) => {
      const { onClose } = renderSetup();
      await screen.findByText('Create matching EPG source?');
      const categories = {
        ...account,
        setup_step: 'categories',
        channel_groups: [{ channel_group: 1 }],
        enable_vod: true,
      };
      API.advanceM3USetup.mockResolvedValue(categories);
      API.getPlaylist.mockResolvedValue(categories);
      fireEvent.click(
        screen.getByRole('button', {
          name: action === 'create_epg' ? 'Create EPG' : 'Skip EPG',
        })
      );
      await screen.findByRole('dialog', { name: 'Category setup' });
      expect(API.advanceM3USetup).toHaveBeenCalledExactlyOnceWith(7, action);
      expect(mocks.fetchEPGs).toHaveBeenCalledTimes(
        action === 'create_epg' ? 1 : 0
      );
      expect(mocks.fetchCategories).toHaveBeenCalled();
      expect(showNotification).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    }
  );

  it('resumes category setup without repeating the EPG decision', async () => {
    const categories = {
      ...account,
      setup_step: 'categories',
      channel_groups: [{ channel_group: 1 }],
    };
    API.getPlaylist.mockResolvedValue(categories);
    renderSetup({ account: categories });
    await screen.findByRole('dialog', { name: 'Category setup' });
    expect(API.advanceM3USetup).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Create matching EPG source?')
    ).not.toBeInTheDocument();
  });

  it('shows a resumable error and retries discovery', async () => {
    const failed = { ...account, setup_step: 'categories', status: 'error' };
    API.getPlaylist.mockResolvedValue(failed);
    renderSetup({ account: failed });
    await screen.findByText(/Categories could not be loaded/);
    const categories = {
      ...failed,
      status: 'pending_setup',
      channel_groups: [{ channel_group: 1 }],
    };
    API.advanceM3USetup.mockResolvedValue(categories);
    API.getPlaylist.mockResolvedValue(categories);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('dialog', { name: 'Category setup' });
    expect(API.advanceM3USetup).toHaveBeenCalledExactlyOnceWith(
      7,
      'retry_categories'
    );
  });

  it('retains the account after an EPG failure and allows skipping', async () => {
    renderSetup();
    await screen.findByText('Create matching EPG source?');
    API.advanceM3USetup.mockRejectedValueOnce(
      new Error('EPG name already exists')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create EPG' }));
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({ color: 'red', autoClose: false })
      )
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Skip EPG' })).toBeEnabled()
    );
    API.advanceM3USetup.mockResolvedValue(account);
    fireEvent.click(screen.getByRole('button', { name: 'Skip EPG' }));
    await waitFor(() =>
      expect(API.advanceM3USetup).toHaveBeenLastCalledWith(7, 'skip_epg')
    );
  });

  it('refreshes persisted progress after an interrupted response', async () => {
    renderSetup();
    await screen.findByText('Create matching EPG source?');
    API.advanceM3USetup.mockRejectedValueOnce(
      new Error('Connection interrupted')
    );
    API.getPlaylist.mockResolvedValue({
      ...account,
      setup_step: 'categories',
      channel_groups: [{ channel_group: 1 }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create EPG' }));
    await screen.findByRole('dialog', { name: 'Category setup' });
    expect(API.advanceM3USetup).toHaveBeenCalledTimes(1);
  });

  it('handles a failed category store load without getting stuck', async () => {
    const categories = {
      ...account,
      setup_step: 'categories',
      channel_groups: [{ channel_group: 1 }],
    };
    API.getPlaylist.mockResolvedValue(categories);
    mocks.fetchChannelGroups.mockRejectedValueOnce(new Error('Unavailable'));
    renderSetup({ account: categories });
    await screen.findByText(/Categories could not be loaded/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('starts the initial import once despite repeated clicks', async () => {
    const categories = {
      ...account,
      setup_step: 'categories',
      channel_groups: [{ channel_group: 1 }],
    };
    API.getPlaylist.mockResolvedValue(categories);
    const { onClose } = renderSetup({ account: categories });
    await screen.findByRole('dialog', { name: 'Category setup' });
    let complete;
    API.advanceM3USetup.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Finish and start import' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Finish and start import' })
    );
    expect(API.advanceM3USetup).toHaveBeenCalledExactlyOnceWith(7, 'complete');
    complete({ ...categories, setup_step: '' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Setup complete', color: 'green' })
    );
  });

  it('closes when another request has already completed setup', async () => {
    API.getPlaylist.mockResolvedValue({ ...account, setup_step: '' });
    const { onClose } = renderSetup();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(API.advanceM3USetup).not.toHaveBeenCalled();
  });
});
