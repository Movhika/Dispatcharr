import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3USetup from '../M3USetup.jsx';
import { MemoryRouter } from 'react-router-dom';
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
  default: {
    getPlaylist: vi.fn(),
    advanceM3USetup: vi.fn(),
    getM3UEPG: vi.fn(),
    createM3UEPG: vi.fn(),
  },
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
  default: ({ onSetupSave, onClose }) => (
    <div role="dialog" aria-label="Category setup">
      <button onClick={onSetupSave}>Save categories</button>
      <button onClick={onClose}>Close categories</button>
    </div>
  ),
}));
vi.mock('../M3U.jsx', () => ({
  default: ({ m3uAccount, onSetupNext, onSetupBack, onClose }) => (
    <div role="dialog" aria-label="Guided account editor">
      <span>Step: {m3uAccount.setup_step}</span>
      {m3uAccount.setup_step === 'content' && (
        <button onClick={onSetupBack}>Back</button>
      )}
      <button onClick={() => onSetupNext(m3uAccount)}>Next</button>
      <button onClick={onClose}>Close guided editor</button>
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
    ...overrides,
  };
  return {
    ...render(
      <MemoryRouter>
        <MantineProvider>
          <M3USetup {...props} />
        </MantineProvider>
      </MemoryRouter>
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
    API.getM3UEPG.mockResolvedValue({ source: null, can_create: true });
    API.createM3UEPG.mockReset();
  });

  it.each([
    ['XC', 'categories', 'back_to_epg', 'epg'],
    ['XC', 'epg', 'back_to_content', 'content'],
    ['STD', 'categories', 'back_to_content', 'content'],
    ['XC', 'content', 'back_to_account', 'account'],
  ])(
    'moves %s %s back exactly one step',
    async (kind, stage, action, target) => {
      let current = { ...account, account_type: kind, setup_step: stage };
      API.getPlaylist.mockImplementation(async () => current);
      API.advanceM3USetup.mockImplementation(async () => {
        current = { ...current, setup_step: target };
        return current;
      });
      renderSetup({ account: current });
      fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
      await waitFor(() =>
        expect(API.advanceM3USetup).toHaveBeenCalledExactlyOnceWith(7, action)
      );
      if (target !== 'epg') await screen.findByText(`Step: ${target}`);
      expect(showNotification).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['XC', 'account', 'continue_content', 'content'],
    ['XC', 'content', 'continue_epg', 'epg'],
    ['XC', 'epg', 'continue_categories', 'categories'],
    ['STD', 'content', 'continue_categories', 'categories'],
  ])(
    'continues %s %s to its next step',
    async (kind, stage, action, target) => {
      let current = { ...account, account_type: kind, setup_step: stage };
      API.getPlaylist.mockImplementation(async () => current);
      API.advanceM3USetup.mockImplementation(async () => {
        current = { ...current, setup_step: target };
        return current;
      });
      renderSetup({ account: current });
      fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
      await waitFor(() =>
        expect(API.advanceM3USetup).toHaveBeenCalledExactlyOnceWith(7, action)
      );
    }
  );

  it('places Back immediately before the primary footer action', () => {
    renderSetup();
    const actions = within(
      screen.getByRole('contentinfo', { name: 'M3U setup actions' })
    );
    expect(
      actions.getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['Back', 'Next']);
  });

  it.each([false, true])(
    'continues without a Skip choice (create EPG: %s)',
    async (createEPG) => {
      const { onClose } = renderSetup();
      await screen.findByText('No matching EPG source configured.');
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(screen.queryByText('Skip EPG')).not.toBeInTheDocument();
      const categories = {
        ...account,
        setup_step: 'categories',
        channel_groups: [{ channel_group: 1 }],
        enable_vod: true,
      };
      API.advanceM3USetup.mockResolvedValue(categories);
      API.getPlaylist.mockResolvedValue(categories);
      if (createEPG) {
        API.createM3UEPG.mockResolvedValue({
          source: {
            id: 9,
            name: 'Example guide',
            is_active: true,
            status: 'idle',
          },
          can_create: false,
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create EPG' }));
        await screen.findByText('Example guide');
        expect(API.createM3UEPG).toHaveBeenCalledExactlyOnceWith(7);
      }
      expect(API.advanceM3USetup).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByRole('button', { name: 'Edit categories' });
      expect(API.advanceM3USetup).toHaveBeenCalledExactlyOnceWith(
        7,
        'continue_categories'
      );
      expect(mocks.fetchEPGs).toHaveBeenCalledTimes(createEPG ? 1 : 0);
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
    await screen.findByRole('button', { name: 'Edit categories' });
    expect(API.advanceM3USetup).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Create matching EPG source?')
    ).not.toBeInTheDocument();
  });
  it('shows the existing EPG card without a route out of guided setup', async () => {
    API.getM3UEPG.mockResolvedValue({
      source: {
        id: 9,
        name: 'Existing setup guide',
        is_active: true,
        status: 'success',
      },
      can_create: false,
    });
    renderSetup();
    await screen.findByRole('article', {
      name: 'EPG source Existing setup guide',
    });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('does not show an EPG step for standard accounts', async () => {
    const standard = {
      ...account,
      account_type: 'STD',
      setup_step: 'categories',
    };
    API.getPlaylist.mockResolvedValue(standard);
    renderSetup({ account: standard });
    expect(
      screen.queryByRole('button', { name: 'EPG' })
    ).not.toBeInTheDocument();
    expect(API.getM3UEPG).not.toHaveBeenCalled();
  });

  it('blocks navigation while an EPG source is being created', async () => {
    let finish;
    API.createM3UEPG.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const { onClose } = renderSetup();
    fireEvent.click(await screen.findByRole('button', { name: 'Create EPG' }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close M3U setup' }));
    expect(onClose).not.toHaveBeenCalled();
    finish({
      source: { id: 9, name: 'New guide', is_active: true, status: 'idle' },
      can_create: false,
    });
    await screen.findByText('New guide');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(API.advanceM3USetup).not.toHaveBeenCalled();
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
    await screen.findByRole('button', { name: 'Edit categories' });
    expect(API.advanceM3USetup).toHaveBeenCalledExactlyOnceWith(
      7,
      'retry_categories'
    );
  });

  it('retains the account after an EPG failure and allows continuing', async () => {
    renderSetup();
    await screen.findByText('No matching EPG source configured.');
    API.createM3UEPG.mockRejectedValueOnce(
      new Error('EPG name already exists')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create EPG' }));
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({ color: 'red', autoClose: false })
      )
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    );
    API.advanceM3USetup.mockResolvedValue(account);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(API.advanceM3USetup).toHaveBeenLastCalledWith(
        7,
        'continue_categories'
      )
    );
  });

  it('keeps waiting after slow discovery and opens categories when it completes', async () => {
    vi.useFakeTimers();
    try {
      const loading = {
        ...account,
        setup_step: 'categories',
        status: 'fetching',
      };
      API.getPlaylist.mockResolvedValue(loading);
      renderSetup({ account: loading });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100000);
      });
      expect(screen.getByText(/taking longer than usual/)).toBeInTheDocument();
      expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
      expect(API.advanceM3USetup).not.toHaveBeenCalled();
      API.getPlaylist.mockResolvedValue({
        ...loading,
        status: 'pending_setup',
        channel_groups: [{ channel_group: 1 }],
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(
        screen.getByRole('button', { name: 'Edit categories' })
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still shows an actual error after prolonged loading', async () => {
    vi.useFakeTimers();
    try {
      const loading = {
        ...account,
        setup_step: 'categories',
        status: 'parsing',
      };
      API.getPlaylist.mockResolvedValue(loading);
      renderSetup({ account: loading });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100000);
      });
      API.getPlaylist.mockResolvedValue({ ...loading, status: 'error' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(
        screen.getByText(/Categories could not be loaded/)
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/taking longer than usual/)
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes persisted progress after an interrupted response', async () => {
    renderSetup();
    await screen.findByText('No matching EPG source configured.');
    API.advanceM3USetup.mockRejectedValueOnce(
      new Error('Connection interrupted')
    );
    API.getPlaylist.mockResolvedValue({
      ...account,
      setup_step: 'categories',
      channel_groups: [{ channel_group: 1 }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('button', { name: 'Edit categories' });
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
    await screen.findByRole('button', { name: 'Edit categories' });
    let complete;
    API.advanceM3USetup.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(API.advanceM3USetup).toHaveBeenCalledExactlyOnceWith(7, 'complete');
    complete({ ...categories, setup_step: '' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Setup complete', color: 'green' })
    );
  });

  it('edits categories without a second stepper and saves back without importing', async () => {
    const categories = {
      ...account,
      setup_step: 'categories',
      channel_groups: [{ channel_group: 1 }],
    };
    API.getPlaylist.mockResolvedValue(categories);
    renderSetup({ account: categories });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit categories' })
    );
    expect(
      screen.getByRole('dialog', { name: 'Category setup' })
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole('dialog', { name: 'Category setup' })
      ).queryByLabelText('M3U setup progress')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save categories' }));
    await screen.findByText(/Category settings saved/);
    expect(
      screen.queryByRole('dialog', { name: 'Category setup' })
    ).not.toBeInTheDocument();
    expect(API.advanceM3USetup).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
  });

  it('returns to the setup step when category editing is closed', async () => {
    const categories = {
      ...account,
      setup_step: 'categories',
      channel_groups: [{ channel_group: 1 }],
    };
    API.getPlaylist.mockResolvedValue(categories);
    const { onClose } = renderSetup({ account: categories });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit categories' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close categories' }));
    await screen.findByRole('button', { name: 'Finish' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when another request has already completed setup', async () => {
    API.getPlaylist.mockResolvedValue({ ...account, setup_step: '' });
    const { onClose } = renderSetup();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(API.advanceM3USetup).not.toHaveBeenCalled();
  });
});
