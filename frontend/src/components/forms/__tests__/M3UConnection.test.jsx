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
import M3U from '../M3U.jsx';
import API from '../../../api.js';
import { addPlaylist, updatePlaylist } from '../../../utils/forms/M3uUtils.js';
import editorClasses from '../AccountEditor.module.css';

vi.mock('../../../api.js', () => ({
  default: { checkM3UConnection: vi.fn() },
}));
vi.mock('../../../store/userAgents', () => ({
  default: (select) => select({ userAgents: [] }),
}));
vi.mock('../../../store/serverGroups', () => ({
  default: (select) => select({ serverGroups: [] }),
}));
vi.mock('../../../store/playlists', () => ({
  default: (select) => select({ playlists: [] }),
}));
vi.mock('../../../utils/forms/M3uUtils.js', async () => ({
  ...(await vi.importActual('../../../utils/forms/M3uUtils.js')),
  addPlaylist: vi.fn(),
  updatePlaylist: vi.fn(),
}));
vi.mock('../../../utils/dateTimeUtils.js', () => ({
  useDateTimeFormat: () => ({
    fullDateTimeFormat: 'YYYY-MM-DD HH:mm',
    timeFormat: 'HH:mm',
    dateYearFormat: 'YYYY-MM-DD',
  }),
  useTimeHelpers: () => ({ toUserTime: () => ({ format: () => '' }) }),
}));
vi.mock('../M3UProfiles', () => ({ default: () => null }));
vi.mock('../M3UGroupFilter', () => ({ default: () => null }));
vi.mock('../M3UAccountCategories.jsx', () => ({ default: () => null }));
vi.mock('../M3UAccountEPG.jsx', () => ({ default: () => null }));
vi.mock('../../ServerGroupsManagerModal', () => ({ default: () => null }));

const account = {
  id: 7,
  name: 'Example account',
  account_type: 'XC',
  server_url: 'https://example.invalid',
  username: 'example',
  is_active: true,
  enable_vod: false,
  max_streams: 1,
  refresh_interval: 24,
};

const open = (props = {}) => {
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <M3U isOpen onClose={onClose} {...props} />
    </MantineProvider>
  );
  return onClose;
};
const fill = () => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Example account' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), {
    target: { value: account.server_url },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), {
    target: { value: 'example' },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: 'synthetic' },
  });
};
const next = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('button', { name: 'Back' });
};
const selectSource = (label) => {
  fireEvent.click(screen.getByRole('textbox', { name: 'Account Type' }));
  fireEvent.click(screen.getByRole('option', { name: label, exact: true }));
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  API.checkM3UConnection.mockResolvedValue({ success: true });
  addPlaylist.mockResolvedValue({ ...account, setup_step: 'epg' });
  updatePlaylist.mockResolvedValue(account);
});

describe('guided Settings and connection preflight', () => {
  it('checks only on Next, shows Live and VOD together and creates with one more Next', async () => {
    open();
    fill();
    expect(API.checkM3UConnection).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass(editorClasses.m3uContent);
    await next();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Live TV settings' })
    ).toBeVisible();
    expect(screen.getByRole('group', { name: 'VOD settings' })).toBeVisible();
    fireEvent.click(screen.getByRole('switch', { name: 'Enable VOD' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(addPlaylist).toHaveBeenCalledOnce());
    expect(addPlaylist.mock.calls[0][0]).toMatchObject({
      enable_vod: true,
      start_setup: true,
    });
    expect(API.checkM3UConnection).toHaveBeenCalledOnce();
    expect(updatePlaylist).not.toHaveBeenCalled();
    expect(dialog).toHaveClass(editorClasses.m3uContent);
  });

  it('keeps a failed Next on Account until explicitly confirmed', async () => {
    API.checkM3UConnection.mockResolvedValue({
      success: false,
      message: 'The provider returned HTTP 403.',
    });
    open();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const warning = await screen.findByRole('dialog', {
      name: 'Connection check failed',
    });
    expect(within(warning).getByText(/HTTP 403/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Back', exact: true })
    ).not.toBeInTheDocument();
    expect(addPlaylist).not.toHaveBeenCalled();
    fireEvent.click(
      within(warning).getByRole('button', { name: 'Continue anyway' })
    );
    await screen.findByRole('button', { name: 'Back', exact: true });
    expect(API.checkM3UConnection).toHaveBeenCalledOnce();
    expect(addPlaylist).not.toHaveBeenCalled();
  });

  it('cancels without saving and checks corrected details on the next attempt', async () => {
    API.checkM3UConnection.mockRejectedValueOnce(
      new Error('secret upstream text')
    );
    open();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const warning = await screen.findByRole('dialog', {
      name: 'Connection check failed',
    });
    expect(
      within(warning).queryByText(/secret upstream/)
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(warning).getByRole('button', { name: 'Back to editing' })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Connection check failed' })
      ).not.toBeInTheDocument()
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), {
      target: { value: 'https://corrected.invalid' },
    });
    await next();
    expect(API.checkM3UConnection).toHaveBeenCalledTimes(2);
    expect(API.checkM3UConnection.mock.lastCall[0].server_url).toBe(
      'https://corrected.invalid'
    );
    expect(addPlaylist).not.toHaveBeenCalled();
  });

  it('does not probe invalid entries or block typing with validation', () => {
    open();
    expect(
      screen.queryByText('Enter the provider server URL.')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.getByText('Enter the provider server URL.')
    ).toBeInTheDocument();
    expect(API.checkM3UConnection).not.toHaveBeenCalled();
  });

  it('prevents duplicate checks and ignores results for a changed draft', async () => {
    let resolve;
    API.checkM3UConnection.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    open();
    fill();
    const button = screen.getByRole('button', { name: 'Next' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(
      screen.getByRole('button', { name: 'Checking connection…' })
    ).toBeDisabled();
    expect(API.checkM3UConnection).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), {
      target: { value: 'https://changed.invalid' },
    });
    await act(async () => resolve({ success: true }));
    expect(
      screen.queryByRole('button', { name: 'Back', exact: true })
    ).not.toBeInTheDocument();
    await next();
    expect(API.checkM3UConnection).toHaveBeenCalledTimes(2);
  });

  it('rechecks after returning to Account and changing a previously checked URL', async () => {
    open();
    fill();
    await next();
    fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), {
      target: { value: 'https://changed.invalid' },
    });
    await next();
    expect(API.checkM3UConnection).toHaveBeenCalledTimes(2);
  });

  it('checks changed saved connection data before saving, with an explicit override', async () => {
    API.checkM3UConnection.mockResolvedValue({
      success: false,
      message: 'The provider timed out.',
    });
    open({ m3uAccount: account });
    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), {
      target: { value: 'https://changed.invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const warning = await screen.findByRole('dialog', {
      name: 'Connection check failed',
    });
    expect(updatePlaylist).not.toHaveBeenCalled();
    expect(API.checkM3UConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 7,
        server_url: 'https://changed.invalid',
      })
    );
    expect(API.checkM3UConnection.mock.calls[0][0]).not.toHaveProperty(
      'password'
    );
    fireEvent.click(
      within(warning).getByRole('button', { name: 'Save anyway' })
    );
    await waitFor(() => expect(updatePlaylist).toHaveBeenCalledOnce());
    expect(API.checkM3UConnection).toHaveBeenCalledOnce();
  });

  it('does not check unchanged saved connections when changing only the name', async () => {
    open({ m3uAccount: account });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updatePlaylist).toHaveBeenCalledOnce());
    expect(API.checkM3UConnection).not.toHaveBeenCalled();
  });

  it('prevents duplicate creates when a checked Settings form is submitted twice', async () => {
    open();
    fill();
    await next();
    const footer = screen.getByRole('contentinfo', {
      name: 'M3U account actions',
    });
    fireEvent.submit(footer.closest('form'));
    fireEvent.submit(footer.closest('form'));
    await waitFor(() => expect(addPlaylist).toHaveBeenCalledOnce());
  });

  it('does not show VOD for M3U URL setup and checks the playlist instead of XC', async () => {
    open();
    selectSource('M3U URL');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'URL account' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), {
      target: { value: 'https://example.invalid/list.m3u' },
    });
    await next();
    expect(
      screen.queryByRole('switch', { name: 'Enable VOD' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(API.checkM3UConnection).toHaveBeenCalledWith(
      expect.objectContaining({ account_type: 'STD' })
    );
    expect(API.checkM3UConnection.mock.calls[0][0]).not.toHaveProperty(
      'username'
    );
  });

  it('skips network checks for M3U files and keeps the Settings step', async () => {
    open();
    selectSource('M3U File');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'File account' },
    });
    const file = new File(['#EXTM3U'], 'example.m3u');
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [file] },
    });
    await next();
    expect(
      screen.getByRole('group', { name: 'Live TV settings' })
    ).toBeVisible();
    expect(
      screen.queryByRole('switch', { name: 'Enable VOD' })
    ).not.toBeInTheDocument();
    expect(API.checkM3UConnection).not.toHaveBeenCalled();
  });
});
