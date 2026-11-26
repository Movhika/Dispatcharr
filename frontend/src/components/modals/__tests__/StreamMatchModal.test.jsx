import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import StreamMatchModal from '../StreamMatchModal';
import API from '../../../api';
import {
  aliasesToText,
  textToAliases,
} from '../../../utils/streamMatchAliases';

vi.mock('../../../api', () => ({
  default: { matchChannelStreams: vi.fn() },
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

vi.mock('../../../store/playlists', () => ({
  default: vi.fn((selector) =>
    selector({
      playlists: [
        { id: 1, name: 'Provider T', is_active: true },
        { id: 2, name: 'custom', is_active: true, locked: true },
      ],
    })
  ),
}));

const response = (changed = 1) => ({
  changed,
  applied: false,
  aliases: [['RTL Nitro', 'Nitro']],
  countries: { DE: 3, UK: 1 },
  channels: [
    {
      id: 7,
      name: 'RTL Nitro',
      channel_number: 16,
      changed: true,
      streams: [
        {
          id: 11,
          name: 'DE┃ NITRO FHD',
          match: 'exact',
          new: true,
          catchup: false,
        },
        { id: 12, name: 'Old feed', match: 'kept', new: false, catchup: false },
      ],
      removed: [],
    },
    {
      id: 8,
      name: 'ZDF',
      channel_number: 3,
      changed: false,
      streams: [
        { id: 13, name: 'ZDF HD', match: 'exact', new: false, catchup: false },
      ],
      removed: [],
    },
  ],
});

const renderModal = (props = {}) =>
  render(
    <MantineProvider>
      <StreamMatchModal
        opened
        onClose={vi.fn()}
        channelIds={[7, 8]}
        {...props}
      />
    </MantineProvider>
  );

describe('streamMatchAliases', () => {
  it('converts alias groups to lines and back', () => {
    const groups = [
      ['RTL Nitro', 'Nitro'],
      ['Nickelodeon', 'Nick'],
    ];
    expect(aliasesToText(groups)).toBe('RTL Nitro = Nitro\nNickelodeon = Nick');
    expect(
      textToAliases(' RTL Nitro = Nitro \nlonely\n = \nA = B = C')
    ).toEqual([
      ['RTL Nitro', 'Nitro'],
      ['A', 'B', 'C'],
    ]);
  });
});

describe('StreamMatchModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.matchChannelStreams.mockResolvedValue(response());
  });

  it('previews changed channels and loads the saved aliases', async () => {
    renderModal();
    expect(await screen.findByText('DE┃ NITRO FHD')).toBeInTheDocument();
    expect(API.matchChannelStreams).toHaveBeenCalledWith(
      expect.objectContaining({ channel_ids: [7, 8], dry_run: true })
    );
    expect(API.matchChannelStreams.mock.calls[0][0]).not.toHaveProperty(
      'aliases'
    );
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('No match, kept')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 channels change')).toBeInTheDocument();
    expect(screen.queryByText('ZDF HD')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Aliases')).toHaveValue('RTL Nitro = Nitro');

    fireEvent.click(screen.getByLabelText('Show unchanged'));
    expect(screen.getByText('ZDF HD')).toBeInTheDocument();
  });

  it('applies with the edited aliases and reports the result', async () => {
    const onApplied = vi.fn();
    const onClose = vi.fn();
    renderModal({ onApplied, onClose });
    await screen.findByText('DE┃ NITRO FHD');
    fireEvent.change(screen.getByLabelText('Aliases'), {
      target: { value: 'RTL Nitro = Nitro\nNick = Nickelodeon' },
    });
    API.matchChannelStreams.mockResolvedValueOnce({
      ...response(),
      applied: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(API.matchChannelStreams).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dry_run: false,
        aliases: [
          ['RTL Nitro', 'Nitro'],
          ['Nick', 'Nickelodeon'],
        ],
      })
    );
    expect(onApplied).toHaveBeenCalled();
  });

  it('shows errors and keeps apply disabled without changes', async () => {
    API.matchChannelStreams.mockRejectedValueOnce(new Error('Broken alias'));
    renderModal();
    expect(await screen.findByText(/Broken alias/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });
});
