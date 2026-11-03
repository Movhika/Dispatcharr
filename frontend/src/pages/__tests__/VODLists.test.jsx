import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import VODListsPage from '../VODLists';
import api from '../../api';
import { showNotification } from '../../utils/notificationUtils.js';

vi.mock('../../utils/notificationUtils.js', () => ({
  showNotification: vi.fn(),
  updateNotification: vi.fn(),
  hideNotification: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: { user_level: 10 } }));
vi.mock('../../store/auth', () => ({ default: (selector) => selector(auth) }));
vi.mock('../../api', () => ({
  default: {
    getVODLists: vi.fn(),
    saveVODList: vi.fn(),
    deleteVODList: vi.fn(),
    rebuildVODList: vi.fn(),
    getVODListItems: vi.fn(),
    editVODListItems: vi.fn(),
    getVODTmdbOptions: vi.fn(),
    getVODTmdbKeywords: vi.fn(),
    getVODLibrary: vi.fn(),
    getVODLibraryOptions: vi.fn(),
  },
}));

const vodList = (fields = {}) => ({
  id: 1,
  name: 'Picks',
  display_name: 'Picks',
  list_type: 'manual',
  content_type: 'all',
  filters: {},
  tmdb_source: '',
  tmdb_settings: {},
  sort_mode: 'list',
  is_enabled: true,
  visible: true,
  visible_from: '',
  visible_until: '',
  refresh_interval: 0,
  cron_expression: '',
  profiles: [],
  build_status: 'ready',
  build_counts: { titles: 2, available: 2 },
  build_error: '',
  built_at: '2026-11-03T08:00:00Z',
  ...fields,
});

const renderPage = () =>
  render(
    <MantineProvider env="test">
      <MemoryRouter initialEntries={['/vods/lists']}>
        <Routes>
          <Route path="/vods/lists" element={<VODListsPage />} />
          <Route path="/channels" element={<div>Channels</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>
  );

describe('VODListsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { user_level: 10 };
    api.getVODLibrary.mockResolvedValue({ count: 12, results: [] });
    api.getVODLibraryOptions.mockResolvedValue({});
  });

  it('shows one card per list with its first titles', async () => {
    api.getVODLists.mockResolvedValue([
      vodList({
        profiles: [{ id: 2, name: 'Kids' }],
        preview: [
          {
            id: 1,
            content_type: 'movie',
            content_id: 4,
            title: 'Sintel',
            poster_url: '/sintel.jpg',
            available: true,
          },
          {
            id: 2,
            content_type: 'series',
            tmdb_id: '99',
            title: 'Missing',
            poster_url: '',
            available: false,
          },
        ],
      }),
      vodList({
        id: 2,
        name: 'Anime {season} {year}',
        display_name: 'Anime Fall 2026',
        list_type: 'tmdb',
        content_type: 'series',
        tmdb_source: 'discover',
        tmdb_settings: { release_mode: 'current_season', anime: true },
        visible: false,
        visible_from: '12-01',
        visible_until: '01-06',
        refresh_interval: 24,
        build_counts: { titles: 40, available: 25, seconds: 3.2 },
        built_at: '2026-11-03T09:00:00Z',
      }),
    ]);
    renderPage();
    const picks = await screen.findByLabelText('Picks list');
    expect(within(picks).getByText('2 titles · 2 available')).toBeTruthy();
    expect(within(picks).queryByText(/Kids/)).toBeNull();
    expect(within(picks).getByRole('img', { name: 'Sintel' })).toBeTruthy();
    expect(
      within(picks).getByRole('button', { name: 'Preview Sintel' })
    ).toBeTruthy();
    expect(
      within(picks).getByRole('button', { name: 'Preview Picks' })
    ).toBeTruthy();
    expect(within(picks).getByText('Not in library')).toBeTruthy();
    expect(
      within(picks).getByRole('link', { name: 'Open Missing on TMDB' })
    ).toHaveAttribute('href', 'https://www.themoviedb.org/tv/99');
    expect(
      within(picks).getByRole('button', { name: 'Refresh Picks' })
    ).toBeDisabled();
    const anime = screen.getByLabelText('Anime {season} {year} list');
    expect(within(anime).getByText('Anime Fall 2026')).toBeTruthy();
    expect(within(anime).getByText('Hidden until 01.12.')).toBeTruthy();
    expect(within(anime).getByText('Last refresh')).toBeTruthy();
    expect(within(anime).getByText(/ · 3\.2 s$/)).toBeTruthy();
    expect(within(picks).getByText('Last change')).toBeTruthy();
    expect(within(anime).getByText('40 titles · 25 available')).toBeTruthy();
    expect(within(anime).getByText('No titles yet.')).toBeTruthy();
  });

  it('creates a rules list from Library filters', async () => {
    api.getVODLists.mockResolvedValue([]);
    api.saveVODList
      .mockRejectedValueOnce({
        body: { name: ['A list with this name exists.'] },
      })
      .mockResolvedValueOnce(
        vodList({ id: 5, name: 'Anime', list_type: 'rules' })
      );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add list' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Rules' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Anime' },
    });
    expect(
      await within(dialog).findByText(
        '12 matching titles',
        {},
        { timeout: 3000 }
      )
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Rules' }));
    // The profile chooses sources, so lists offer no file data filters.
    expect(within(dialog).queryByRole('textbox', { name: 'DUB' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('textbox', { name: 'Anime' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Only anime' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveVODList).toHaveBeenCalledTimes(1));
    expect(api.saveVODList).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Anime',
        list_type: 'rules',
        filters: { anime_mode: 'only' },
        refresh_interval: 0,
      }),
      undefined
    );
    // The server error returns to the General tab and names the reason.
    expect(
      await within(dialog).findByText('A list with this name exists.')
    ).toBeTruthy();
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'List not saved',
        message: 'A list with this name exists.',
      })
    );
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Anime only' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveVODList).toHaveBeenCalledTimes(2));
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Saved Anime' })
    );
  });

  it('finds TMDB keywords for a discover list', async () => {
    api.getVODLists.mockResolvedValue([]);
    api.getVODTmdbOptions.mockResolvedValue({
      regions: [],
      providers: [],
      genres: [],
      languages: [],
    });
    api.getVODTmdbKeywords.mockResolvedValue([
      { value: '207317', label: 'christmas' },
    ]);
    api.saveVODList.mockResolvedValue(vodList({ id: 7, name: 'Christmas' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add list' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Christmas' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'TMDB' }));
    // Discover offers movies or series, so it appears once one is chosen.
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Movies' }));
    fireEvent.click(within(dialog).getByRole('tab', { name: 'TMDB' }));
    fireEvent.click(within(dialog).getByRole('textbox', { name: 'Source' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Discover' }));
    const keywords = within(dialog).getByRole('textbox', { name: 'Keywords' });
    fireEvent.change(keywords, { target: { value: 'christ' } });
    await waitFor(() =>
      expect(api.getVODTmdbKeywords).toHaveBeenCalledWith('christ')
    );
    fireEvent.click(await screen.findByRole('option', { name: 'christmas' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.saveVODList).toHaveBeenCalledWith(
        expect.objectContaining({
          tmdb_source: 'discover',
          content_type: 'movie',
          tmdb_settings: { keywords: [{ id: '207317', name: 'christmas' }] },
        }),
        undefined
      )
    );
  });

  it('requires both days of a visible period', async () => {
    api.getVODLists.mockResolvedValue([vodList()]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Picks' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Picks' });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Schedule' }));
    fireEvent.click(within(dialog).getByRole('textbox', { name: 'Visible' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Every year' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'From' }), {
      target: { value: '12-01' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('Enter both days of the period.')
    ).toBeTruthy();
    expect(api.saveVODList).not.toHaveBeenCalled();
  });

  it('reports the update of a saved list when its build finishes', async () => {
    const rules = { list_type: 'rules', name: 'Drama', display_name: 'Drama' };
    api.getVODLists
      .mockResolvedValueOnce([vodList(rules)])
      .mockResolvedValueOnce([vodList({ ...rules, build_status: 'pending' })])
      .mockResolvedValue([
        vodList({ ...rules, build_counts: { titles: 5, available: 4 } }),
      ]);
    api.saveVODList.mockResolvedValue(
      vodList({ ...rules, build_status: 'pending' })
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Drama' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Drama' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Saved Drama',
          message: 'Its titles are being updated.',
        })
      )
    );
    // The page follows the pending build and reports when it is done.
    await waitFor(
      () =>
        expect(showNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Updated Drama',
            message: '5 titles · 4 available',
          })
        ),
      { timeout: 6000 }
    );
    expect(api.getVODLists).toHaveBeenCalledTimes(3);
  });

  it('removes titles of a manual list', async () => {
    api.getVODLists.mockResolvedValue([vodList()]);
    api.getVODListItems.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 9,
          content_type: 'movie',
          content_id: 4,
          title: 'Sintel',
          year: 2010,
          poster_url: '',
          tmdb_id: '',
          available: true,
          position: 0,
        },
      ],
    });
    api.editVODListItems.mockResolvedValue(vodList());
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Preview Picks' })
    );
    const dialog = await screen.findByRole('dialog', { name: 'Picks preview' });
    expect(await within(dialog).findByText('Sintel')).toBeTruthy();
    expect(within(dialog).getByText('In library')).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove Sintel' })
    );
    await waitFor(() =>
      expect(api.editVODListItems).toHaveBeenCalledWith(1, 'remove-items', {
        ids: [9],
      })
    );
  });

  it('redirects users who cannot manage lists', async () => {
    auth.user = { user_level: 1 };
    renderPage();
    expect(await screen.findByText('Channels')).toBeTruthy();
    expect(api.getVODLists).not.toHaveBeenCalled();
  });
});
