import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import EventGroupsModal from '../EventGroupsModal';
import API from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    getEventGroups: vi.fn(),
    getEventGroupSourceOptions: vi.fn(),
    getEventTeamAliases: vi.fn(),
    saveEventGroup: vi.fn(),
    deleteEventGroup: vi.fn(),
    buildEventGroup: vi.fn(),
    previewEventGroup: vi.fn(),
    saveEventTeamAliases: vi.fn(),
  },
}));

vi.mock('../../forms/EventFixtureSettings', () => ({
  default: () => <div>Fixture settings</div>,
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

vi.mock('../../../store/channels', () => ({
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
  epg_enabled: true,
  channel_count: 3,
};

const renderModal = () =>
  render(
    <MantineProvider>
      <EventGroupsModal opened onClose={vi.fn()} />
    </MantineProvider>
  );

describe('EventGroupsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getEventGroups.mockResolvedValue([GROUP]);
    API.getEventGroupSourceOptions.mockResolvedValue([
      {
        id: 11,
        label: 'ProviderC · PPV',
        account: 'ProviderC',
        is_event: true,
      },
    ]);
    API.getEventTeamAliases.mockResolvedValue({
      aliases: [['Bayern Munich', 'FC Bayern']],
    });
  });

  it('lists groups and builds one on request', async () => {
    API.buildEventGroup.mockResolvedValue({
      events: 2,
      created: 1,
      updated: 1,
      removed: 0,
      skipped: 0,
    });
    renderModal();
    expect(await screen.findByText('PPV events')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('2950–2999')).toBeInTheDocument();
    expect(screen.getByLabelText('Team aliases')).toHaveValue(
      'Bayern Munich = FC Bayern'
    );
    fireEvent.click(screen.getByLabelText('Build PPV events'));
    await waitFor(() => expect(API.buildEventGroup).toHaveBeenCalledWith(1));
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
    renderModal();
    fireEvent.click(await screen.findByLabelText('Edit PPV events'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview events' }));
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
          epg_enabled: true,
        })
      )
    );
  });

  it('asks before deleting a group with its channels', async () => {
    API.deleteEventGroup.mockResolvedValue({});
    renderModal();
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
