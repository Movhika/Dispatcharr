import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import API from '../../api';
import useAuthStore from '../../store/auth';
import VODListsPage from '../VODLists';

vi.mock('../../api', () => ({
  default: {
    getVODLists: vi.fn(),
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
    expect(screen.getByText('Not in library')).toBeInTheDocument();
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

  it('offers server-side search and filters in the full preview', async () => {
    renderPage();
    await screen.findByText('TMDB Trending');

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

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
});
