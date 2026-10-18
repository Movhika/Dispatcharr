import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
import M3U from '../M3U.jsx';

vi.mock('../../../store/userAgents', () => ({
  default: (selector) => selector({ userAgents: [] }),
}));
vi.mock('../../../store/serverGroups', () => ({
  default: (selector) => selector({ serverGroups: [] }),
}));
vi.mock('../../../store/playlists', () => ({
  default: (selector) => selector({ playlists: [] }),
}));
vi.mock('../../../store/channels', () => ({
  default: (selector) => selector({ fetchChannelGroups: vi.fn() }),
}));
vi.mock('../../../store/epgs', () => ({
  default: (selector) => selector({ fetchEPGs: vi.fn() }),
}));
vi.mock('../../../store/useVODStore', () => ({
  default: (selector) => selector({ fetchCategories: vi.fn() }),
}));
vi.mock('../../../utils/dateTimeUtils.js', () => ({
  useDateTimeFormat: () => ({
    timeFormat: 'HH:mm',
    dateYearFormat: 'DD.MM.YYYY',
    fullDateTimeFormat: 'DD.MM.YYYY HH:mm',
  }),
  useTimeHelpers: () => ({
    toUserTime: () => ({ format: () => '' }),
  }),
}));
vi.mock('../M3UProfiles', () => ({ default: () => null }));
vi.mock('../M3UGroupFilter', () => ({ default: () => null }));
vi.mock('../ScheduleInput', () => ({ default: () => null }));
vi.mock('../../ServerGroupsManagerModal', () => ({ default: () => null }));

const renderContent = (values = {}) => {
  render(
    <MantineProvider>
      <M3U
        isOpen
        onClose={vi.fn()}
        m3uAccount={{
          id: 1,
          name: 'Example account',
          server_url: 'https://example.invalid',
          account_type: 'XC',
          is_active: true,
          enable_vod: true,
          vod_refresh_after_live: false,
          ...values,
        }}
      />
    </MantineProvider>
  );
  fireEvent.click(screen.getByRole('tab', { name: 'VOD' }));
};

const tabTo = async (target) => {
  const user = userEvent.setup();
  for (
    let index = 0;
    index < 40 && document.activeElement !== target;
    index += 1
  ) {
    await user.tab();
  }
  expect(target).toHaveFocus();
};

describe('M3U content switch tooltips with Mantine controls', () => {
  it.each([
    ['Enable VOD', 'Import movies and series from this Xtream Codes account.'],
    [
      'Enable separate VOD refresh schedule',
      'When disabled, VOD refresh runs after a successful scheduled Live TV refresh.',
    ],
  ])('shows %s help when hovering its visible label', async (name, help) => {
    renderContent();
    const input = screen.getByRole('switch', { name });
    fireEvent.mouseEnter(input.closest('.mantine-Switch-root').parentElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(help);
    expect(input).toBeChecked();
  });

  it('shows help when an enabled switch receives keyboard focus', async () => {
    renderContent();
    await tabTo(screen.getByRole('switch', { name: 'Enable VOD' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Import movies and series from this Xtream Codes account.'
    );
  });

  it.each([[{ enable_vod: false }, 'Enable separate VOD refresh schedule']])(
    'keeps disabled-switch help accessible (%j)',
    async (values, name) => {
      renderContent(values);
      const input = screen.getByRole('switch', { name });
      expect(input).toBeDisabled();
      const target = input.closest('.mantine-Switch-root').parentElement;
      expect(target).toHaveAttribute('tabindex', '0');
      fireEvent.mouseEnter(target);
      expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    }
  );
});
