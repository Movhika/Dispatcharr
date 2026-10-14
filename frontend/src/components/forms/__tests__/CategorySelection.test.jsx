import { StrictMode, useState } from 'react';
import { MantineProvider } from '@mantine/core';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LiveGroupFilter from '../LiveGroupFilter';
import VODCategoryFilter from '../VODCategoryFilter';

const groups = Array.from({ length: 40 }, (_, index) => ({
  channel_group: index + 1,
  name: `Category ${String(index + 1).padStart(2, '0')}`,
  enabled: false,
  auto_channel_sync: false,
  custom_properties: {},
}));
vi.mock('../../../store/channels', () => ({
  default: (selector) =>
    selector({
      channelGroups: Object.fromEntries(
        groups.map((group) => [group.channel_group, group])
      ),
    }),
}));
vi.mock('../../../store/streamProfiles', () => ({
  default: (selector) => selector({ profiles: [], fetchProfiles: vi.fn() }),
}));
vi.mock('../../../store/useVODStore', () => ({
  default: (selector) => selector({ categories: {} }),
}));
vi.mock('../../../hooks/useSmartLogos', () => ({
  useChannelLogoSelection: () => ({
    logos: {},
    ensureLogosLoaded: vi.fn(),
    isLoading: false,
  }),
}));
vi.mock('../../../utils/forms/LiveGroupFilterUtils.js', async (original) => ({
  ...(await original()),
  getEPGs: vi.fn().mockResolvedValue([]),
}));
vi.mock('../M3UGroupContentPreview.jsx', () => ({ default: () => null }));
vi.mock('../M3UFilters.jsx', () => ({ default: () => null }));
vi.mock('../AutoSyncBasic.jsx', () => ({ default: () => null }));
vi.mock('../AutoSyncAdvanced.jsx', () => ({ default: () => null }));

function Categories({ vod = false }) {
  const [paginationContainer, setPaginationContainer] = useState(null);
  const [rows, setRows] = useState(
    vod ? groups.map((group) => ({ ...group, id: group.channel_group })) : []
  );
  const playlist = { id: 1, channel_groups: groups };
  const content = vod ? (
    <VODCategoryFilter
      playlist={playlist}
      categoryStates={rows}
      setCategoryStates={setRows}
      type="movie"
      paginationContainer={paginationContainer}
    />
  ) : (
    <LiveGroupFilter
      playlist={playlist}
      groupStates={rows}
      setGroupStates={setRows}
      paginationContainer={paginationContainer}
    />
  );
  return (
    <>
      {content}
      <footer aria-label="Category actions" ref={setPaginationContainer} />
    </>
  );
}

describe('Category selection with Mantine controls', () => {
  it.each([false, true])(
    'selects matching Live/VOD rows across pages (VOD=%s)',
    async (vod) => {
      render(
        <StrictMode>
          <MantineProvider>
            <Categories vod={vod} />
          </MantineProvider>
        </StrictMode>
      );
      await waitFor(() =>
        expect(
          screen.getByRole('checkbox', { name: 'Select Category 01' })
        ).toBeInTheDocument()
      );
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Select visible categories' })
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Edit settings (40)' })
        ).toBeEnabled()
      );
      expect(
        screen.getByRole('checkbox', { name: 'Select Category 01' })
      ).toBeChecked();
      expect(
        screen
          .getByRole('checkbox', { name: 'Select Category 01' })
          .closest('tr')
      ).toHaveAttribute('data-selected', 'true');
      expect(
        screen.queryByRole('button', { name: 'Category 01' })
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Enable selected' }));
      expect(
        screen.getByRole('columnheader', { name: 'Status' })
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole('table')).getAllByText('Enabled')
      ).toHaveLength(25);
      expect(
        screen.getByRole('contentinfo', { name: 'Category actions' })
      ).toContainElement(screen.getByRole('button', { name: '2' }));
      fireEvent.click(screen.getByRole('button', { name: '2' }));
      expect(
        screen.getByRole('checkbox', { name: 'Select Category 26' })
      ).toBeChecked();
      expect(
        within(screen.getByRole('table')).getAllByText('Enabled')
      ).toHaveLength(15);
    },
    15000
  );
});
