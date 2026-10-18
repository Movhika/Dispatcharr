import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3U from '../M3U.jsx';
import API from '../../../api.js';
import { updatePlaylist } from '../../../utils/forms/M3uUtils.js';

const state = vi.hoisted(() => ({
  playlists: [],
  profiles: {},
  fetchPlaylist: vi.fn(),
}));
vi.mock('../../../api.js', () => ({
  default: {
    queryStreams: vi.fn(),
    addM3UProfile: vi.fn(),
    updateM3UProfile: vi.fn(),
  },
}));
vi.mock('../../../store/userAgents', () => ({
  default: (select) => select({ userAgents: [] }),
}));
vi.mock('../../../store/serverGroups', () => ({
  default: (select) => select({ serverGroups: [] }),
}));
vi.mock('../../../store/playlists', () => ({
  default: (select) => select(state),
}));
vi.mock('../../../WebSocket', () => ({ useWebSocket: () => [false, null] }));
vi.mock('../../../utils/forms/M3uUtils.js', async () => ({
  ...(await vi.importActual('../../../utils/forms/M3uUtils.js')),
  updatePlaylist: vi.fn(),
}));
vi.mock('../../../utils/dateTimeUtils.js', async () => ({
  ...(await vi.importActual('../../../utils/dateTimeUtils.js')),
  useDateTimeFormat: () => ({
    fullDateFormat: 'YYYY-MM-DD',
    fullDateTimeFormat: 'YYYY-MM-DD HH:mm',
    timeFormat: 'HH:mm',
    dateYearFormat: 'YYYY-MM-DD',
  }),
  useTimeHelpers: () => ({ toUserTime: () => ({ format: () => '' }) }),
}));
vi.mock('../AccountInfoModal', () => ({ default: () => null }));
vi.mock('../M3UGroupFilter', () => ({ default: () => null }));
vi.mock('../../ServerGroupsManagerModal', () => ({ default: () => null }));

const account = {
  id: 7,
  name: 'Example account',
  account_type: 'XC',
  server_url: 'https://example.invalid',
  username: 'example',
  password: 'synthetic',
  is_active: true,
  enable_vod: true,
  max_streams: 1,
  refresh_interval: 24,
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  state.profiles = { 7: [] };
  API.queryStreams.mockResolvedValue({ results: [] });
  API.addM3UProfile.mockResolvedValue({ id: 71 });
  API.updateM3UProfile.mockResolvedValue({ id: 71 });
  updatePlaylist.mockResolvedValue(account);
});

const openProfile = async (existing = false) => {
  if (existing)
    state.profiles = {
      7: [
        {
          id: 71,
          name: 'Existing connection',
          max_streams: 1,
          search_pattern: 'example/synthetic',
          replace_pattern: 'alternate/secret',
          custom_properties: { xcMode: 'simple' },
        },
      ],
    };
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <M3U isOpen m3uAccount={account} onClose={onClose} />
    </MantineProvider>
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Profiles' }));
  fireEvent.click(
    await screen.findByRole('button', {
      name: existing ? 'Edit Existing connection' : 'Add connection profile',
    })
  );
  const dialog = await screen.findByRole('dialog', { name: 'M3U Profile' });
  return { dialog, onClose };
};

describe('profile submissions inside the M3U editor', () => {
  it('keeps a name-only profile open and never submits the account behind it', async () => {
    const { dialog, onClose } = await openProfile();
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'New connection' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    expect(
      await within(dialog).findByText('New username is required')
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('New password is required')
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('New connection');
    expect(API.addM3UProfile).not.toHaveBeenCalled();
    expect(updatePlaylist).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('also isolates schema validation failures', async () => {
    const { dialog, onClose } = await openProfile();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    expect(
      await within(dialog).findByText('Name is required')
    ).toBeInTheDocument();
    expect(updatePlaylist).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'saves only the profile and closes only its dialog (existing=%s)',
    async (existing) => {
      const { dialog, onClose } = await openProfile(existing);
      fireEvent.change(within(dialog).getByLabelText('Name'), {
        target: { value: 'New connection' },
      });
      fireEvent.change(within(dialog).getByLabelText('New Username'), {
        target: { value: 'alternate' },
      });
      fireEvent.change(within(dialog).getByLabelText('New Password'), {
        target: { value: 'secret' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
      const action = existing ? API.updateM3UProfile : API.addM3UProfile;
      await waitFor(() => expect(action).toHaveBeenCalledOnce());
      expect(action).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          name: 'New connection',
          search_pattern: 'example/synthetic',
          replace_pattern: 'alternate/secret',
        })
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'M3U Profile' })
        ).not.toBeInTheDocument()
      );
      expect(
        screen.getByRole('dialog', { name: 'Edit M3U account' })
      ).toBeInTheDocument();
      expect(updatePlaylist).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 320));
    }
  );

  it.each([false, true])(
    'keeps the draft on a failed save (existing=%s)',
    async (existing) => {
      API.addM3UProfile.mockRejectedValue(new Error('Save failed'));
      API.updateM3UProfile.mockRejectedValue(new Error('Save failed'));
      const { dialog, onClose } = await openProfile(existing);
      fireEvent.change(within(dialog).getByLabelText('Name'), {
        target: { value: 'Keep this draft' },
      });
      fireEvent.change(within(dialog).getByLabelText('New Username'), {
        target: { value: 'alternate' },
      });
      fireEvent.change(within(dialog).getByLabelText('New Password'), {
        target: { value: 'secret' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
      await waitFor(() =>
        expect(
          existing ? API.updateM3UProfile : API.addM3UProfile
        ).toHaveBeenCalledOnce()
      );
      expect(within(dialog).getByLabelText('Name')).toHaveValue(
        'Keep this draft'
      );
      expect(
        within(dialog).getByRole('button', { name: 'Submit' })
      ).toBeEnabled();
      expect(onClose).not.toHaveBeenCalled();
      expect(updatePlaylist).not.toHaveBeenCalled();
    }
  );
});
