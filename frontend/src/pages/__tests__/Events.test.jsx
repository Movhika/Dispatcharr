import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import EventsPage from '../Events';
import API from '../../api';

vi.mock('../../api', () => ({
  default: {
    getEventChannels: vi.fn(),
    getEventGroups: vi.fn(),
    getEventGroupSourceOptions: vi.fn(),
    saveEventGroup: vi.fn(),
    deleteEventGroup: vi.fn(),
    buildEventGroup: vi.fn(),
    previewEventGroup: vi.fn(),
    requeryChannels: vi.fn(),
  },
}));

vi.mock('../../store/auth', () => ({
  default: vi.fn((selector) => selector({ user: { user_level: 10 } })),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

vi.mock('../../store/channels', () => ({
  default: vi.fn((selector) =>
    selector({
      channelGroups: { 7: { id: 7, name: 'Events' } },
      profiles: {
        0: { id: 0, name: 'All' },
        2: { id: 2, name: 'Living room' },
      },
    })
  ),
}));

const GROUP = {
  id: 1,
  name: 'PPV events',
  enabled: true,
  channel_group: 7,
  sources: [11],
  start_number: 2950,
  end_number: 2999,
  lookahead_hours: 24,
  include_untimed: false,
  name_format: 'title_time',
  channel_profile_ids: [],
  channel_count: 3,
};

const EVENT = {
  channel_id: 40,
  channel_number: 2950,
  channel_name: 'Inter - Stuttgart · 27 Nov 20:00',
  source: 'group',
  source_name: 'PPV events',
  title: 'Inter - Stuttgart',
  competition: 'Serie A',
  start: '2026-11-27T19:00:00Z',
  end: '2026-11-27T21:00:00Z',
  status: 'live',
  stream_count: 2,
};

const renderPage = () =>
  render(
    <MantineProvider>
      <MemoryRouter>
        <EventsPage />
      </MemoryRouter>
    </MantineProvider>
  );

describe('EventsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getEventChannels.mockResolvedValue([EVENT]);
    API.getEventGroups.mockResolvedValue([GROUP]);
    API.getEventGroupSourceOptions.mockResolvedValue([
      {
        id: 11,
        label: 'ProviderC · PPV',
        account: 'ProviderC',
        is_event: true,
      },
    ]);
  });

  it('lists event channels with their event and source', async () => {
    renderPage();
    expect(await screen.findByText('Inter - Stuttgart')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
    expect(screen.getByText('Serie A')).toBeInTheDocument();
    expect(
      screen.getByText('2950 · Inter - Stuttgart · 27 Nov 20:00')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Settings → Live TV → Events and fixtures',
      })
    ).toHaveAttribute('href', '/settings#live-events');
  });

  it('explains how event channels appear when there are none', async () => {
    API.getEventChannels.mockResolvedValue([]);
    API.getEventGroups.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/No event channels/)).toBeInTheDocument();
    expect(screen.getByText('No event groups yet.')).toBeInTheDocument();
  });

  it('lists groups and builds one on request', async () => {
    API.buildEventGroup.mockResolvedValue({
      events: 2,
      created: 1,
      updated: 1,
      removed: 0,
      skipped: 0,
    });
    renderPage();
    expect(await screen.findByText('2950–2999')).toBeInTheDocument();
    expect(screen.getByText('Events', { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Build PPV events'));
    await waitFor(() => expect(API.buildEventGroup).toHaveBeenCalledWith(1));
    await waitFor(() => expect(API.requeryChannels).toHaveBeenCalled());
  });

  it('edits, previews and saves a group with numeric ids', async () => {
    API.previewEventGroup.mockResolvedValue([
      {
        title: 'Lille - Bayern Munich',
        competition: 'Champions League',
        start: '2026-11-25T19:55:00Z',
        status: 'upcoming',
        streams: [
          { id: 1, name: 'a', account: 'ProviderC' },
          { id: 2, name: 'b', account: 'ProviderT' },
        ],
      },
    ]);
    API.saveEventGroup.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByLabelText('Edit PPV events'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Preview events' })
    );
    expect(
      await screen.findByText('Lille - Bayern Munich')
    ).toBeInTheDocument();
    expect(screen.getByText('2 from ProviderC, ProviderT')).toBeInTheDocument();
    expect(screen.getByText('Champions League')).toBeInTheDocument();
    expect(API.previewEventGroup).toHaveBeenCalledWith(
      expect.objectContaining({ sources: [11], channel_group: 7 })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(API.saveEventGroup).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          name: 'PPV events',
          sources: [11],
        })
      )
    );
  });

  it('asks before deleting a group with its channels', async () => {
    API.deleteEventGroup.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByLabelText('Delete PPV events'));
    expect(
      await screen.findByText(
        /and its 3 event channels\? This cannot be undone/
      )
    ).toBeInTheDocument();
    expect(API.deleteEventGroup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(API.deleteEventGroup).toHaveBeenCalledWith(1));
  });
});
