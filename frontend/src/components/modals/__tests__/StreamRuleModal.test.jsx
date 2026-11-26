import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import StreamRuleModal from '../StreamRuleModal';
import API from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    getChannelStreamRule: vi.fn(),
    saveChannelStreamRule: vi.fn(),
    deleteChannelStreamRule: vi.fn(),
    previewChannelStreamRule: vi.fn(),
    saveStreamRules: vi.fn(),
    requeryChannels: vi.fn(),
  },
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

vi.mock('../../../store/playlists', () => ({
  default: vi.fn((selector) =>
    selector({ playlists: [{ id: 4, name: 'ProviderT', is_active: true }] })
  ),
}));

const CHANNEL = { id: 3, name: 'ZDF' };

const renderModal = (props = {}) =>
  render(
    <MantineProvider>
      <StreamRuleModal opened onClose={vi.fn()} {...props} />
    </MantineProvider>
  );

describe('StreamRuleModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads, previews and saves the rule of one channel', async () => {
    API.getChannelStreamRule.mockResolvedValue({
      enabled: true,
      match_name: true,
      names: ['Zweites'],
      include_regex: '',
      exclude_regex: '',
      catchup: 'include',
      account_ids: [4],
      countries: ['DE'],
      excluded_stream_ids: [9, 10],
      last_applied_at: '2026-11-26T10:00:00Z',
    });
    API.previewChannelStreamRule.mockResolvedValue({
      streams: [
        { id: 1, name: 'My feed', status: 'manual', account: 'C' },
        { id: 2, name: 'DE┃ ZDF FHD', status: 'added', account: 'T' },
      ],
      removed: [{ id: 5, name: 'DE┃ ZDF HD', status: 'removed', account: 'T' }],
    });
    API.saveChannelStreamRule.mockResolvedValue({});
    const onClose = vi.fn();
    renderModal({ channel: CHANNEL, onClose });
    expect(await screen.findByText('Zweites')).toBeInTheDocument();
    expect(
      screen.getByText(/2 streams removed by hand are excluded/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow them again' }));
    fireEvent.click(screen.getByLabelText('Only catch-up'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('DE┃ ZDF FHD')).toBeInTheDocument();
    expect(screen.getByText('Goes')).toBeInTheDocument();
    expect(API.previewChannelStreamRule).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ catchup: 'only', excluded_stream_ids: [] })
    );
    expect(API.previewChannelStreamRule.mock.calls[0][1]).not.toHaveProperty(
      'last_applied_at'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(API.saveChannelStreamRule).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ account_ids: [4], countries: ['DE'] })
    );
    expect(API.requeryChannels).toHaveBeenCalled();
  });

  it('removes a rule and keeps its streams', async () => {
    API.getChannelStreamRule.mockResolvedValue({ enabled: true });
    API.deleteChannelStreamRule.mockResolvedValue(null);
    const onClose = vi.fn();
    renderModal({ channel: CHANNEL, onClose });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove rule' }));
    await waitFor(() =>
      expect(API.deleteChannelStreamRule).toHaveBeenCalledWith(3)
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('applies the same settings to many channels without names', async () => {
    API.saveStreamRules.mockResolvedValue({ rules: 2, added: 5, removed: 0 });
    renderModal({ channelIds: [3, 4] });
    expect(screen.queryByLabelText(/Further names/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Preview' })
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply to 2 channels' })
    );
    await waitFor(() => expect(API.saveStreamRules).toHaveBeenCalled());
    const [ids, rule] = API.saveStreamRules.mock.calls[0];
    expect(ids).toEqual([3, 4]);
    expect(rule).not.toHaveProperty('names');
    expect(rule).not.toHaveProperty('excluded_stream_ids');
    expect(API.getChannelStreamRule).not.toHaveBeenCalled();
  });

  it('shows save errors in the dialog', async () => {
    API.getChannelStreamRule.mockResolvedValue(null);
    API.saveChannelStreamRule.mockRejectedValue(
      new Error('Invalid regular expression')
    );
    renderModal({ channel: CHANNEL });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(/Invalid regular expression/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove rule' })
    ).not.toBeInTheDocument();
  });
});
