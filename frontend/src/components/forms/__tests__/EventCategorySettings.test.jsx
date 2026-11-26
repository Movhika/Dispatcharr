import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import EventCategorySettings from '../EventCategorySettings';
import API from '../../../api';

vi.mock('../../../api', () => ({
  default: { previewEventCategory: vi.fn() },
}));

const group = (values = {}) => ({
  channel_group: 5,
  name: 'PPV┃ UFC PPV',
  custom_properties: { event_timezone: 'ET', name_regex_pattern: 'x' },
  metadata_defaults: { is_event: true },
  ...values,
});

const renderSettings = (props = {}) =>
  render(
    <MantineProvider>
      <EventCategorySettings
        group={group()}
        playlist={{ id: 3 }}
        onApplyGroupChange={vi.fn()}
        {...props}
      />
    </MantineProvider>
  );

describe('EventCategorySettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hides the settings until the category is an event category', () => {
    const onApplyGroupChange = vi.fn();
    renderSettings({
      group: group({ metadata_defaults: {} }),
      onApplyGroupChange,
    });
    expect(screen.queryByText('Preview events')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Event category/));
    expect(onApplyGroupChange).toHaveBeenCalledWith(
      expect.objectContaining({ metadata_defaults: { is_event: true } })
    );
  });

  it('stores the filter and naming options in the category properties', () => {
    const onApplyGroupChange = vi.fn();
    renderSettings({ onApplyGroupChange });
    fireEvent.click(
      screen.getByLabelText(/Only create channels for current events/)
    );
    expect(onApplyGroupChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        custom_properties: {
          event_timezone: 'ET',
          name_regex_pattern: 'x',
          event_filter: 'current',
        },
      })
    );
    fireEvent.click(screen.getByLabelText(/Name channels after the event/));
    expect(onApplyGroupChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        custom_properties: expect.objectContaining({
          event_channel_name: true,
        }),
      })
    );
  });

  it('previews the parsed events with only the event settings', async () => {
    API.previewEventCategory.mockResolvedValue({
      counts: { live: 1, none: 1 },
      rows: [
        {
          id: 1,
          name: 'UFC event: 1 name: Fight Night',
          title: 'Fight Night',
          status: 'live',
          start: '2026-11-25T18:00:00+00:00',
          kept: true,
        },
        {
          id: 2,
          name: 'UFC 05 :',
          title: '',
          status: 'none',
          start: null,
          kept: false,
        },
      ],
    });
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Preview events' }));
    expect(await screen.findByText('Fight Night')).toBeInTheDocument();
    expect(API.previewEventCategory).toHaveBeenCalledWith(3, 5, {
      event_timezone: 'ET',
    });
    expect(screen.getByText('1 live · 1 no event')).toBeInTheDocument();
    expect(screen.getByText('No event')).toBeInTheDocument();
  });

  it('lets the category editor choose own event channels or an event group', () => {
    const onApplyGroupChange = vi.fn();
    const { rerender } = render(
      <MantineProvider>
        <EventCategorySettings
          group={group({ auto_channel_sync: false, event_group: null })}
          playlist={{ id: 3 }}
          onApplyGroupChange={onApplyGroupChange}
          eventGroups={[{ id: 7, name: 'Fights' }]}
          showToggle={false}
        />
      </MantineProvider>
    );
    expect(screen.queryByLabelText(/Event category/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Only create channels for current events/)
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Combined with other providers/));
    expect(onApplyGroupChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ auto_channel_sync: false, event_group: 7 })
    );
    fireEvent.click(screen.getByLabelText(/One channel per event/));
    expect(onApplyGroupChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ auto_channel_sync: true, event_group: null })
    );
    rerender(
      <MantineProvider>
        <EventCategorySettings
          group={group({ auto_channel_sync: true, event_group: null })}
          playlist={{ id: 3 }}
          onApplyGroupChange={onApplyGroupChange}
          eventGroups={[]}
          showToggle={false}
        />
      </MantineProvider>
    );
    expect(
      screen.getByLabelText(/Only create channels for current events/)
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Combined with other providers/)
    ).toBeDisabled();
    expect(
      screen.getByText(/Create event groups on the Events page/)
    ).toBeInTheDocument();
  });

  it('shows preview errors', async () => {
    API.previewEventCategory.mockRejectedValue(
      new Error('Invalid event pattern')
    );
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Preview events' }));
    expect(
      await screen.findByText(/Invalid event pattern/)
    ).toBeInTheDocument();
  });
});
