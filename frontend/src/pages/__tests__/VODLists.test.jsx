import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import API from '../../api';
import useAuthStore from '../../store/auth';
import VODListsPage from '../VODLists';

vi.mock('../../components/VODListItemDetails.jsx', () => ({
  default: ({ item }) =>
    item ? (
      <div data-testid="list-item-details">{item.display_title}</div>
    ) : null,
}));

vi.mock('../../api', () => ({
  default: {
    getVODLists: vi.fn(),
    getVODListUsage: vi.fn(),
    getVODListRuleOptions: vi.fn(),
    getVODListExternalOptions: vi.fn(),
    getVODFilterOptions: vi.fn(),
    getVODListItems: vi.fn(),
    getVODListFilterOptions: vi.fn(),
    createVODList: vi.fn(),
    updateVODList: vi.fn(),
    deleteVODList: vi.fn(),
    rebuildVODList: vi.fn(),
    removeVODListItems: vi.fn(),
  },
}));

vi.mock('../../store/auth', () => ({ default: vi.fn() }));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const list = {
  id: 12,
  name: 'TMDB Trending',
  description: '',
  list_type: 'external',
  content_type: 'movie',
  provider: 'tmdb',
  external_key: 'trending',
  is_enabled: true,
  is_visible: true,
  is_system: false,
  sort_order: 0,
  item_count: 2,
  available_item_count: 1,
  preview: [
    {
      id: 1,
      canonical_id: 7,
      content_type: 'movie',
      display_title: 'Available title',
      display_year: 2026,
      display_poster: '',
      is_available: true,
    },
    {
      id: 2,
      display_title: 'Remote only title',
      display_year: 2025,
      display_poster: '',
      is_available: false,
    },
  ],
};

const renderPage = () =>
  render(
    <MantineProvider>
      <MemoryRouter>
        <VODListsPage />
      </MemoryRouter>
    </MantineProvider>
  );

describe('VODListsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.mockImplementation((selector) =>
      selector({ user: { user_level: 10 } })
    );
    API.getVODLists.mockResolvedValue([list]);
    API.getVODListUsage.mockResolvedValue({ profiles: [] });
    API.getVODListRuleOptions.mockResolvedValue({
      genres: [],
    });
    API.getVODListExternalOptions.mockResolvedValue({
      region: 'DE',
      watch_providers: [],
    });
    API.getVODFilterOptions.mockResolvedValue({
      audio_languages: [],
      subtitle_languages: [],
      resolutions: [],
      container_extensions: [],
      video_features: [],
    });
    API.getVODListFilterOptions.mockResolvedValue({
      audio_languages: [],
      subtitle_languages: [],
      resolutions: [],
      container_extensions: [],
      video_features: [],
    });
    API.getVODListItems.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 1,
          content_type: 'movie',
          canonical_id: 7,
          display_title: 'Available title',
          display_year: 2026,
          is_available: true,
          include_all_sources: false,
          relation_ids: [17],
          source_count: 1,
        },
      ],
    });
    API.createVODList.mockResolvedValue({ id: 13 });
  });

  it('shows the poster preview and marks unavailable external titles', async () => {
    renderPage();

    expect(await screen.findByText('TMDB Trending')).toBeInTheDocument();
    expect(screen.getByText('2 titles · 1 available')).toBeInTheDocument();
    expect(screen.getByText('TMDB')).toBeInTheDocument();
    expect(screen.getByText('Not in library')).toBeInTheDocument();
  });

  it('opens the detail view when an available poster is selected', async () => {
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(
      screen.getByRole('button', { name: 'Open details for Available title' })
    );

    expect(screen.getByTestId('list-item-details')).toHaveTextContent(
      'Available title'
    );
    expect(
      screen.queryByRole('button', {
        name: 'Open details for Remote only title',
      })
    ).not.toBeInTheDocument();
  });

  it('creates a manual list from the large add button', async () => {
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(screen.getByRole('button', { name: 'Add another list' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Name/ }), {
      target: { value: 'Seasonal Anime' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));

    await waitFor(() => {
      expect(API.createVODList).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Seasonal Anime',
          list_type: 'manual',
          content_type: 'all',
        })
      );
    });
  });

  it('also opens the list editor from the top-right button', async () => {
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(screen.getByRole('button', { name: 'Add list' }));

    expect(
      await screen.findByRole('textbox', { name: /Name/ })
    ).toBeInTheDocument();
  });

  it('toggles a list outside the editor without rebuilding its entries', async () => {
    API.updateVODList.mockResolvedValue({ ...list, is_enabled: false });
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }));

    await waitFor(() =>
      expect(API.updateVODList).toHaveBeenCalledWith(list.id, {
        is_enabled: false,
      })
    );
    expect(API.getVODListUsage).toHaveBeenCalledWith(list.id);
    expect(API.rebuildVODList).not.toHaveBeenCalled();
  });

  it('warns before disabling a list used by VOD profiles', async () => {
    API.getVODListUsage.mockResolvedValue({
      profiles: [{ id: 4, name: 'Family', is_active: true }],
    });
    API.updateVODList.mockResolvedValue({ ...list, is_enabled: false });
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }));

    expect(await screen.findByText('Family')).toBeInTheDocument();
    expect(API.updateVODList).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Disable list' }));
    await waitFor(() =>
      expect(API.updateVODList).toHaveBeenCalledWith(list.id, {
        is_enabled: false,
      })
    );
  });

  it('confirms deletion and names profiles that use the list', async () => {
    API.getVODListUsage.mockResolvedValue({
      profiles: [{ id: 4, name: 'Family', is_active: true }],
    });
    API.deleteVODList.mockResolvedValue({});
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete TMDB Trending' })
    );

    expect(await screen.findByText('Family')).toBeInTheDocument();
    expect(API.deleteVODList).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete list' }));
    await waitFor(() =>
      expect(API.deleteVODList).toHaveBeenCalledWith(list.id)
    );
  });

  it('shows a disabled manual sync control and a greyed-out disabled list', async () => {
    API.getVODLists.mockResolvedValue([
      { ...list, list_type: 'manual', provider: '', is_enabled: false },
    ]);
    renderPage();
    await screen.findByText('TMDB Trending');

    expect(
      screen.getByRole('button', { name: 'Sync TMDB Trending' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Preview TMDB Trending' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('TMDB Trending').closest('.mantine-Paper-root')
    ).toHaveStyle({ opacity: '0.55' });
  });

  it('shows only the selected date source for dynamic lists', async () => {
    API.getVODLists.mockResolvedValue([
      {
        ...list,
        list_type: 'dynamic',
        provider: '',
        external_key: '',
        rules: [{ release_date_after: '2026-01-01' }],
      },
    ]);
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(screen.getByRole('button', { name: 'Edit TMDB Trending' }));

    expect(await screen.findByLabelText('Released from')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Added to library from')
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText('How age ratings are matched')
    ).toBeInTheDocument();
  });

  it('clears inactive dates when saving a legacy dynamic list', async () => {
    const dynamicList = {
      ...list,
      list_type: 'dynamic',
      provider: '',
      external_key: '',
      rules: [
        {
          release_date_after: '2026-01-01',
          library_added_after: '2026-09-01',
        },
      ],
    };
    API.getVODLists.mockResolvedValue([dynamicList]);
    API.updateVODList.mockResolvedValue(dynamicList);
    API.rebuildVODList.mockResolvedValue(dynamicList);
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(screen.getByRole('button', { name: 'Edit TMDB Trending' }));
    await screen.findByLabelText('Released from');
    fireEvent.click(screen.getByRole('button', { name: 'Save list' }));

    await waitFor(() =>
      expect(API.updateVODList).toHaveBeenCalledWith(
        list.id,
        expect.objectContaining({
          rules: [
            expect.objectContaining({
              release_date_after: '2026-01-01',
              library_added_after: '',
            }),
          ],
        })
      )
    );
  });

  it('offers server-side search and filters in the full preview', async () => {
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(
      screen.getByRole('button', { name: 'Preview TMDB Trending' })
    );

    expect(
      await screen.findByRole('textbox', { name: 'Search' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    await waitFor(() => {
      expect(API.getVODListItems).toHaveBeenCalledWith(
        list.id,
        expect.objectContaining({
          page: 1,
          page_size: 50,
          type: 'all',
          availability: 'any',
        })
      );
      expect(API.getVODListFilterOptions).toHaveBeenCalledWith(list.id);
    });
  });

  it('updates list text without rebuilding its entries', async () => {
    API.updateVODList.mockResolvedValue({ ...list, name: 'TMDB Picks' });
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(screen.getByRole('button', { name: 'Edit TMDB Trending' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Name/ }), {
      target: { value: 'TMDB Picks' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save list' }));

    await waitFor(() => expect(API.updateVODList).toHaveBeenCalled());
    expect(API.rebuildVODList).not.toHaveBeenCalled();
  });

  it('preserves a list sorting choice without rebuilding its entries', async () => {
    const sortedList = {
      ...list,
      settings: { sort_mode: 'release_date_desc' },
    };
    API.getVODLists.mockResolvedValue([sortedList]);
    API.updateVODList.mockResolvedValue(sortedList);
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(screen.getByRole('button', { name: 'Edit TMDB Trending' }));
    expect(
      await screen.findByRole('textbox', { name: 'Sort titles' })
    ).toHaveValue('Newest release first');
    fireEvent.click(screen.getByRole('button', { name: 'Save list' }));

    await waitFor(() =>
      expect(API.updateVODList).toHaveBeenCalledWith(
        sortedList.id,
        expect.objectContaining({
          settings: { sort_mode: 'release_date_desc' },
        })
      )
    );
    expect(API.rebuildVODList).not.toHaveBeenCalled();
  });
});
