import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import AddChannelStream from '../AddChannelStream';
import API from '../../../api';

vi.mock('../../../api', () => ({
  default: { searchStreams: vi.fn(), addStreamsToChannel: vi.fn() },
}));

vi.mock('../../../store/playlists', () => ({
  default: vi.fn((selector) =>
    selector({ playlists: [{ id: 3, name: 'ProviderC' }] })
  ),
}));

vi.mock('../../../store/channels', () => ({
  default: vi.fn((selector) =>
    selector({ channelGroups: { 8: { id: 8, name: 'DE | Sports' } } })
  ),
}));

const CHANNEL = { id: 12, name: 'Sky Sport 1' };
const EXISTING = [{ id: 1, name: 'Sky Sport 1 HD' }];

const renderSearch = () =>
  render(
    <MantineProvider>
      <AddChannelStream channel={CHANNEL} streams={EXISTING} />
    </MantineProvider>
  );

describe('AddChannelStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.searchStreams.mockResolvedValue([
      { id: 1, name: 'Sky Sport 1 HD', m3u_account: 3, channel_group: 8 },
      { id: 2, name: 'Sky Sport 1 FHD', m3u_account: 3, channel_group: 8 },
    ]);
  });

  it('searches streams without a channel and adds one', async () => {
    renderSearch();
    fireEvent.change(screen.getByLabelText('Search streams'), {
      target: { value: 'sky sport' },
    });
    expect(await screen.findByText('Sky Sport 1 FHD')).toBeInTheDocument();
    expect(API.searchStreams).toHaveBeenCalledWith({
      search: 'sky sport',
      unassigned: true,
    });
    expect(screen.getAllByText('ProviderC')).toHaveLength(2);
    expect(screen.getAllByText('DE | Sports')).toHaveLength(2);
    // A stream the channel already has cannot be added twice.
    expect(screen.getByLabelText('Add Sky Sport 1 HD')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Add Sky Sport 1 FHD'));
    await waitFor(() =>
      expect(API.addStreamsToChannel).toHaveBeenCalledWith(12, EXISTING, [
        expect.objectContaining({ id: 2 }),
      ])
    );
  });

  it('can include streams that already have a channel', async () => {
    renderSearch();
    fireEvent.click(screen.getByLabelText('Only without channel'));
    fireEvent.change(screen.getByLabelText('Search streams'), {
      target: { value: 'sky' },
    });
    await waitFor(() =>
      expect(API.searchStreams).toHaveBeenCalledWith({
        search: 'sky',
        unassigned: false,
      })
    );
  });

  it('waits for at least two characters', async () => {
    renderSearch();
    fireEvent.change(screen.getByLabelText('Search streams'), {
      target: { value: 's' },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(API.searchStreams).not.toHaveBeenCalled();
  });
});
