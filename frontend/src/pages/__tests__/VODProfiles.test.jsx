import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import VODProfilesPage from '../VODProfiles';
import useScreenshotMode from '../../store/useScreenshotMode.js';
import api from '../../api';
import { showNotification } from '../../utils/notificationUtils.js';

vi.mock('../../components/LibraryPreviewModal.jsx', () => ({
  default: ({ item, sourceNotes }) => (
    <div role="dialog" aria-label="Library preview">
      {JSON.stringify({ item, sourceNotes })}
    </div>
  ),
}));
vi.mock('../../utils/notificationUtils.js', () => ({
  showNotification: vi.fn(),
  updateNotification: vi.fn(),
  hideNotification: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: { user_level: 10 } }));
vi.mock('../../store/auth', () => ({ default: (selector) => selector(auth) }));
vi.mock('../../api', () => ({
  default: {
    getVODProfiles: vi.fn(),
    getVODProfileOptions: vi.fn(),
    getVODProfileValues: vi.fn(),
    saveVODProfile: vi.fn(),
    deleteVODProfile: vi.fn(),
    rebuildVODProfile: vi.fn(),
    previewVODProfileCatalog: vi.fn(),
    countVODProfileEditions: vi.fn(),
    getVODLibraryOptions: vi.fn(),
    getVODLibrary: vi.fn(),
  },
}));

const profile = (fields = {}) => ({
  id: 1,
  name: 'Default',
  is_default: true,
  is_active: true,
  output_mode: 'compact',
  output_groups: 'provider',
  name_template: '{title}',
  title_source: 'provider',
  metadata_source: 'provider',
  content_rules: [],
  excluded_titles: [],
  edition_rules: [],
  ranking: ['provider'],
  audio_language_order: [],
  subtitle_language_order: [],
  provider_order: [],
  users: [],
  catalog_status: 'ready',
  catalog_counts: {
    movie: { titles: 33163, entries: 36727 },
    series: { titles: 5712, entries: 6106 },
  },
  catalog_started_at: '2026-11-03T08:00:00Z',
  catalog_progress: {},
  catalog_completed_at: '2026-11-03T08:00:07.9Z',
  catalog_error: '',
  ...fields,
});

const options = {
  users: [
    { id: 7, name: 'kid' },
    { id: 8, name: 'guest' },
  ],
  accounts: [{ id: 3, name: 'Provider' }],
  languages: [
    { value: 'ger', label: 'German (ger)' },
    { value: 'eng', label: 'English (eng)' },
  ],
  metadata_languages: ['en-US', 'de-DE'],
  resolutions: ['2160p', '1080p', '720p', 'SD'],
  video_features: ['3d', 'dv', 'hdr'],
};

const renderPage = () =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/vods/profiles']}>
        <Routes>
          <Route path="/vods/profiles" element={<VODProfilesPage />} />
          <Route path="/channels" element={<div>Channels</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>
  );

describe('VODProfilesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { user_level: 10 };
    api.getVODProfileOptions.mockResolvedValue(options);
    api.getVODLibraryOptions.mockResolvedValue({
      accounts: [{ id: 3, name: 'Provider' }],
      categories: [],
      audio_languages: ['ger', 'eng'],
      resolution: ['1080p'],
    });
    api.getVODLibrary.mockResolvedValue({ count: 12, results: [] });
    api.getVODProfileValues.mockResolvedValue({
      languages: options.languages,
      resolutions: options.resolutions,
      video_features: options.video_features,
    });
  });

  it('shows one card per profile with its catalogue state', async () => {
    api.getVODProfiles.mockResolvedValue([
      profile(),
      profile({
        id: 2,
        name: 'Kids',
        is_default: false,
        users: [7],
        title_source: 'de-DE',
        name_template: '{title} ({year})',
        content_rules: [
          {
            id: 'wwe',
            action: 'include',
            name: 'WWE',
            filters: { category_match: 'WWE' },
          },
          { id: 'ger', action: 'include', filters: { audio_language: 'ger' } },
          {
            id: 'off',
            action: 'exclude',
            enabled: false,
            filters: { anime_mode: 'only' },
          },
        ],
        excluded_titles: [{ content_type: 'movie', id: 5 }],
        edition_rules: [{ title_suffix: '4K' }],
        catalog_status: 'failed',
        catalog_error: 'Database unavailable',
        catalog_counts: {},
      }),
    ]);
    renderPage();
    const defaultCard = await screen.findByLabelText('Default profile');
    expect(within(defaultCard).getByText('Ready')).toBeTruthy();
    expect(
      within(defaultCard).getByRole('switch', { name: 'Enable Default' })
    ).toBeDisabled();
    expect(
      await within(defaultCard).findByText('No rules · every source')
    ).toBeTruthy();
    expect(
      within(defaultCard).getByText('Compact · Provider categories')
    ).toBeTruthy();
    expect(within(defaultCard).getByText('Format: {title}')).toBeTruthy();
    expect(within(defaultCard).getByText('Example: Sintel')).toBeTruthy();
    expect(
      within(defaultCard).getByText('Entries: 36,727 movies · 6,106 series')
    ).toBeTruthy();
    expect(
      within(defaultCard).getByText('Titles: 33,163 movies · 5,712 series')
    ).toBeTruthy();
    expect(within(defaultCard).getByText(/^Built in 7\.9 s · /)).toBeTruthy();
    expect(
      within(defaultCard).getByRole('button', { name: 'Delete Default' })
    ).toBeDisabled();
    const kids = screen.getByLabelText('Kids profile');
    expect(within(kids).queryByText(/user/)).toBeNull();
    expect(within(kids).getByText('Failed')).toBeTruthy();
    // Disabled rules are left out of the card.
    expect(within(kids).getByText('2 rules · 2 include')).toBeTruthy();
    expect(within(kids).getByText('Include: WWE')).toBeTruthy();
    expect(within(kids).getByText('Include: DUB GER')).toBeTruthy();
    expect(within(kids).getByText('Editions: 4K')).toBeTruthy();
    expect(
      within(kids).getByText('Title: German (de-DE) · Metadata: Provider')
    ).toBeTruthy();
    expect(
      within(kids).getByText('Example: Sintel (2010), Sintel 4K (2010)')
    ).toBeTruthy();
    expect(within(kids).getByText('Database unavailable')).toBeTruthy();
  });

  it('prepares, disables and deletes a profile from its card', async () => {
    const kids = profile({ id: 2, name: 'Kids', is_default: false });
    api.getVODProfiles.mockResolvedValue([kids]);
    api.rebuildVODProfile.mockResolvedValue({
      ...kids,
      catalog_status: 'building',
      catalog_progress: { titles: 1200 },
    });
    api.saveVODProfile.mockResolvedValue({ ...kids, is_active: false });
    api.deleteVODProfile.mockResolvedValue(null);
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Prepare Kids' })
    );
    await waitFor(() => expect(api.rebuildVODProfile).toHaveBeenCalledWith(2));
    // Preparation is reported as a notification, like an M3U refresh.
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'vod-profile-catalog-2',
        title: 'Preparing Kids',
        message: '1,200 titles prepared…',
        loading: true,
      })
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Kids' }));
    await waitFor(() =>
      expect(api.saveVODProfile).toHaveBeenCalledWith({ is_active: false }, 2)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Kids' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteVODProfile).toHaveBeenCalledWith(2));
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Deleted Kids' })
    );
  });

  it('creates a profile and returns server errors to their tab', async () => {
    api.getVODProfiles.mockResolvedValue([profile()]);
    api.saveVODProfile
      .mockRejectedValueOnce({
        status: 400,
        body: { ranking: ['Use only supported ranking criteria.'] },
      })
      .mockResolvedValueOnce(
        profile({ id: 2, name: 'Kids', catalog_status: 'pending' })
      );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add profile' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: /^Name\s*\*?$/ }),
      {
        target: { value: 'Kids' },
      }
    );
    expect(within(dialog).getByText('Example: Sintel')).toBeTruthy();
    expect(within(dialog).queryByText(/tags/)).toBeNull();
    // Compact names only show what every fallback source shares.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Insert dub' }));
    expect(within(dialog).getByText('Example: Sintel')).toBeTruthy();
    expect(within(dialog).getByRole('tab', { name: 'Labels' })).toBeDisabled();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Insert year' })
    );
    expect(within(dialog).getByText('Example: Sintel 2010')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    // Problems are named in a notification, like elsewhere.
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Profile not saved',
          message: 'Use only supported ranking criteria.',
        })
      )
    );
    expect(
      within(dialog).getByRole('tab', { name: 'Failover', selected: true })
    ).toBeTruthy();
    expect(api.saveVODProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Kids',
        name_template: '{title} {year}',
        ranking: ['provider'],
      }),
      undefined
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Saved Kids' })
      )
    );
  });

  const notified = (title, message) =>
    expect(showNotification).toHaveBeenLastCalledWith(
      expect.objectContaining({ title, message })
    );

  const choose = async (dialog, label, option) => {
    const input = within(dialog).getByRole('textbox', { name: label });
    fireEvent.click(input);
    await waitFor(() =>
      expect(input.getAttribute('aria-controls')).toBeTruthy()
    );
    const list = document.getElementById(input.getAttribute('aria-controls'));
    fireEvent.click(
      within(list).getByRole('option', { name: option, hidden: true })
    );
  };

  it('outlines field problems and names them when saving', async () => {
    api.getVODProfiles.mockResolvedValue([profile()]);
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Default' })
    );
    const dialog = await screen.findByRole('dialog');
    const format = within(dialog).getByRole('textbox', { name: 'Format' });
    fireEvent.change(format, { target: { value: '{title} {quality}' } });
    expect(format.getAttribute('aria-invalid')).toBe('true');
    expect(
      within(dialog).queryByText('Unsupported placeholders: {quality}')
    ).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    notified('Profile not saved', 'Unsupported placeholders: {quality}');
    fireEvent.change(format, { target: { value: '{title} [{dub}]' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    notified(
      'Profile not saved',
      'Compact names only show {title}, {year} and {edition}; use Sources for source details.'
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sources' }));
    expect(format.getAttribute('aria-invalid')).not.toBe('true');
    // Editions only name Compact entries.
    expect(
      within(dialog)
        .getByRole('button', { name: 'Insert edition' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(within(dialog).getByText('Example: Sintel [ENG]')).toBeTruthy();
    expect(
      within(dialog).getByRole('tab', { name: 'Editions' })
    ).toBeDisabled();
    expect(api.saveVODProfile).not.toHaveBeenCalled();
  });

  it('edits labels row by row', async () => {
    api.getVODProfiles.mockResolvedValue([
      profile({ output_mode: 'variants', name_template: '{title} [{dub}]' }),
    ]);
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Default' })
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Labels' }));
    expect(within(dialog).getByText(/No labels/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add label' }));
    expect(
      within(dialog).getByRole('button', { name: 'Add label' })
    ).toBeDisabled();
    // An empty row is not highlighted until its save was tried.
    expect(dialog.querySelector('[data-invalid="true"]')).toBeNull();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save label 1' })
    );
    notified('Label not saved', 'Choose a value.');
    expect(dialog.querySelector('[data-invalid="true"]')).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Discard label 1 changes' })
    );
    expect(within(dialog).getByText(/No labels/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add label' }));
    await choose(dialog, 'Label 1 placeholder', '{sub}');
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Label 1 text' }),
      { target: { value: 'SUBBED' } }
    );
    // Leaving an unsaved row asks first, like unsaved M3U rules.
    fireEvent.click(within(dialog).getByRole('tab', { name: 'General' }));
    expect(
      await screen.findByText(
        'Discard unsaved changes? The affected rows are highlighted.'
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(
      within(dialog).getByRole('tab', { name: 'Labels', selected: true })
    ).toBeTruthy();
  });

  it('edits editions without overlaps and counts their titles', async () => {
    api.getVODProfiles.mockResolvedValue([profile()]);
    api.countVODProfileEditions.mockResolvedValue({
      movie: { '4K': 3, '': 7 },
      series: {},
    });
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Default' })
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Editions' }));
    // An added row nobody filled in closes without asking.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add edition' })
    );
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Content' }));
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(
      within(dialog).getByRole('tab', { name: 'Content', selected: true })
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Editions' }));
    expect(within(dialog).getByText(/No editions/)).toBeTruthy();
    // A started one asks first.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add edition' })
    );
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Edition 1 name' }),
      { target: { value: 'Draft' } }
    );
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Content' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(
      within(dialog).getByRole('tab', { name: 'Content', selected: true })
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Editions' }));
    expect(within(dialog).getByText(/No editions/)).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add edition' })
    );
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Edition 1 name' }),
      { target: { value: '4K' } }
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save 4K' }));
    notified('Edition not saved', 'Give each edition at least one condition.');
    await choose(dialog, 'Edition 1 minimum resolution', '2160p');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save 4K' }));
    // Saving an edition counts the titles of the current settings.
    expect(
      await within(dialog).findByText('2160p and up · 3 movies')
    ).toBeTruthy();
    expect(api.countVODProfileEditions).toHaveBeenLastCalledWith({
      profile: expect.objectContaining({
        edition_rules: [expect.objectContaining({ title_suffix: '4K' })],
      }),
    });

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add edition' })
    );
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Edition 2 name' }),
      { target: { value: 'UHD' } }
    );
    await choose(dialog, 'Edition 2 minimum resolution', '2160p');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save UHD' }));
    notified('Edition not saved', '4K and UHD have the same conditions.');
    await choose(dialog, 'Edition 2 minimum resolution', 'Any');
    await choose(dialog, 'Edition 2 maximum resolution', '1080p');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save UHD' }));
    expect(
      await within(dialog).findByText('Up to 1080p · No titles')
    ).toBeTruthy();
    notified(
      'No titles for UHD',
      'No title gets this edition with the current settings.'
    );
    expect(
      within(dialog).queryByRole('button', { name: 'Preview 4K' })
    ).toBeNull();
    // Many steps; the default 5 s is tight on a busy machine.
  }, 15000);

  it('shows the edition counts of the last build', async () => {
    const uhd = { title_suffix: '4K', min_resolution: 2160 };
    api.getVODProfiles.mockResolvedValue([
      profile({
        edition_rules: [uhd],
        catalog_counts: {
          movie: { titles: 20, entries: 32, editions: { '4K': 12, '': 20 } },
          series: { titles: 0, entries: 0, editions: {} },
        },
      }),
    ]);
    renderPage();
    const card = await screen.findByLabelText('Default profile');
    expect(within(card).getByText('Editions: 4K (12 movies)')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Edit Default' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Editions' }));
    expect(
      within(dialog).getByText('2160p and up · 12 movies (last build)')
    ).toBeTruthy();
    expect(api.countVODProfileEditions).not.toHaveBeenCalled();
  });

  it('previews the built catalogue from the card', async () => {
    api.getVODProfiles.mockResolvedValue([profile()]);
    api.saveVODProfile.mockResolvedValue(
      profile({ excluded_titles: [{ content_type: 'movie', id: 1 }] })
    );
    api.previewVODProfileCatalog.mockResolvedValue({
      count: 2,
      categories: [{ value: 101, label: 'DE | Kids' }],
      accounts: [{ value: 3, label: 'Provider' }],
      results: [
        {
          id: 1,
          title: 'Film',
          year: 2020,
          reason: '',
          excluded: false,
          entries: [
            {
              name: 'Film [GER · 2160p]',
              source_id: 21,
              fallbacks: [21],
              edition: '',
              provider: 'Provider',
              category: 'DE | Kids',
              metadata: { audio_languages: ['ger'], resolution: '2160p' },
              sources: 2,
            },
          ],
          sources: [
            {
              id: 21,
              provider: 'Provider',
              category: 'DE | Kids',
              metadata: { audio_languages: ['ger'], resolution: '2160p' },
              entry: 'Film [GER · 2160p]',
              state: 'selected',
              reason: '',
            },
            {
              id: 22,
              provider: 'Backup',
              category: 'EN | Action',
              metadata: { audio_languages: ['eng'] },
              entry: '',
              state: 'skipped',
              reason: 'Does not match the content filters.',
            },
          ],
        },
        {
          id: 2,
          title: 'Other',
          year: null,
          reason: 'No source matches the content filters.',
          excluded: false,
          entries: [],
          sources: [],
        },
      ],
    });
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Preview Default' })
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Preview Default',
    });
    expect(await within(dialog).findByText('Film [GER · 2160p]')).toBeTruthy();
    expect(within(dialog).getByText('2 movies')).toBeTruthy();
    expect(within(dialog).queryByText('Offered')).toBeNull();
    // Titles the profile does not offer are greyed out, like in the Library.
    const other = within(dialog).getByText('Other').closest('tr');
    expect(other.getAttribute('aria-disabled')).toBe('true');
    expect(api.previewVODProfileCatalog).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        content_type: 'movie',
        page: 1,
        page_size: 25,
        excluded: false,
        edition: null,
      })
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Open Film (2020)' })
    );
    const library = await screen.findByRole('dialog', {
      name: 'Library preview',
    });
    expect(JSON.parse(library.textContent)).toEqual({
      item: {
        content_type: 'movie',
        content_id: 1,
        source_id: 21,
        name: 'Film',
      },
      sourceNotes: {
        21: { order: 1 },
        22: {
          label: 'Excluded',
          reason: 'Does not match the content filters.',
        },
      },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Filter titles' })
    );
    expect(
      (await screen.findAllByLabelText('M3U account')).length
    ).toBeGreaterThan(0);
    // Only the accounts and categories the profile offers.
    fireEvent.click(screen.getAllByLabelText('M3U account').at(-1));
    expect(
      await screen.findByRole('option', { name: 'Provider', hidden: true })
    ).toBeTruthy();
    // Only the categories the profile offers, as the preview reports them.
    fireEvent.click(screen.getAllByLabelText('Category').at(-1));
    expect(
      await screen.findByRole('option', { name: 'DE | Kids', hidden: true })
    ).toBeTruthy();
    expect(
      screen.queryByRole('option', { name: 'EN | Action', hidden: true })
    ).toBeNull();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Exclude Film (2020)' })
    );
    // Excluding saves the profile right away; the preview reloads.
    await waitFor(() =>
      expect(api.saveVODProfile).toHaveBeenCalledWith(
        { excluded_titles: [{ content_type: 'movie', id: 1 }] },
        1
      )
    );
    await waitFor(() =>
      expect(api.previewVODProfileCatalog).toHaveBeenCalledTimes(2)
    );
  });

  it('keeps the latest search when an earlier preview answers late', async () => {
    api.getVODProfiles.mockResolvedValue([profile()]);
    const row = (id, title) => ({
      id,
      title,
      year: 2020,
      reason: '',
      excluded: false,
      entries: [],
      sources: [],
    });
    let answerFirst;
    api.previewVODProfileCatalog
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerFirst = () =>
              resolve({ count: 1, results: [row(1, 'Unfiltered')] });
          })
      )
      .mockResolvedValue({ count: 1, results: [row(2, 'Crank')] });
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Preview Default' })
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Preview Default',
    });
    fireEvent.change(within(dialog).getByPlaceholderText('Search titles...'), {
      target: { value: 'Crank' },
    });
    expect(await within(dialog).findByText(/^Crank/)).toBeTruthy();
    await act(async () => answerFirst());
    expect(within(dialog).getByText(/^Crank/)).toBeTruthy();
    expect(within(dialog).queryByText(/^Unfiltered/)).toBeNull();
  });

  it('edits ordered content rules as Library filters in a dialog', async () => {
    api.getVODProfiles.mockResolvedValue([
      profile({
        content_rules: [
          {
            id: 'ger',
            action: 'include',
            name: '',
            filters: { audio_language: 'ger' },
          },
        ],
      }),
    ]);
    api.saveVODProfile.mockResolvedValue(profile());
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Default' })
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).queryByRole('tab', { name: 'Categories' })
    ).toBeNull();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Content' }));
    expect(within(dialog).getByText('DUB GER')).toBeTruthy();
    // The Library options load once the rules are shown.
    await waitFor(() => expect(api.getVODLibraryOptions).toHaveBeenCalled());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    const ruleDialog = await screen.findByRole('dialog', { name: 'Add rule' });
    fireEvent.change(within(ruleDialog).getByLabelText('Name'), {
      target: { value: 'WWE' },
    });
    fireEvent.change(
      within(ruleDialog).getByRole('textbox', {
        name: 'Category name (regex)',
      }),
      { target: { value: '(' } }
    );
    expect(
      within(ruleDialog).getByRole('button', { name: 'Save rule' })
    ).toBeDisabled();
    fireEvent.change(
      within(ruleDialog).getByRole('textbox', {
        name: 'Category name (regex)',
      }),
      { target: { value: 'WWE' } }
    );
    // The Library counts what the filter matches.
    expect(
      await within(ruleDialog).findByText('12 sources · 12 titles')
    ).toBeTruthy();
    expect(api.getVODLibrary).toHaveBeenCalledWith(
      new URLSearchParams({
        category_match: 'WWE',
        blocked: 'false',
        view: 'sources',
        page: 1,
        page_size: 1,
      })
    );
    fireEvent.click(
      within(ruleDialog).getByRole('button', { name: 'Save rule' })
    );
    expect(await within(dialog).findByText('Category ~ WWE')).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('switch', { name: 'Rule 1 enabled' })
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.saveVODProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          content_rules: [
            expect.objectContaining({ id: 'ger', enabled: false }),
            expect.objectContaining({
              name: 'WWE',
              action: 'include',
              filters: { category_match: 'WWE' },
            }),
          ],
        }),
        1
      )
    );
    expect(api.saveVODProfile.mock.calls[0][0]).not.toHaveProperty('users');
  });

  it('orders the failover criteria and their preferences', async () => {
    api.getVODProfiles.mockResolvedValue([profile()]);
    api.saveVODProfile.mockResolvedValue(profile());
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Default' })
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Failover' }));
    fireEvent.click(
      within(dialog).getByRole('switch', { name: 'Use Resolution' })
    );
    fireEvent.click(
      within(dialog).getByRole('switch', { name: 'Use Provider order' })
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.saveVODProfile).toHaveBeenCalledWith(
        expect.objectContaining({ ranking: ['resolution_desc'] }),
        1
      )
    );
  });

  it('keeps editions and failover for Compact entries only', async () => {
    api.getVODProfiles.mockResolvedValue([profile()]);
    api.saveVODProfile.mockResolvedValue(profile());
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Default' })
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getAllByText('Sources')[0]);
    fireEvent.click(within(dialog).getByText('Movie & Series'));
    fireEvent.click(within(dialog).getByText('Enriched'));
    // Every source is its own entry, so editions and failover do not apply.
    expect(
      within(dialog).getByRole('tab', { name: 'Editions' })
    ).toBeDisabled();
    expect(
      within(dialog).getByRole('tab', { name: 'Failover' })
    ).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.saveVODProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          output_mode: 'variants',
          output_groups: 'movie_series',
          metadata_source: 'enriched',
          title_source: 'provider',
        }),
        1
      )
    );
  });

  it('lists the users that receive a profile', async () => {
    api.getVODProfiles.mockResolvedValue([
      profile(),
      profile({ id: 2, name: 'Kids', is_default: false, users: [7] }),
    ]);
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Default' })
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Users' }));
    expect(within(dialog).getByText('guest')).toBeTruthy();
    expect(within(dialog).getByText('No active profile assigned')).toBeTruthy();
    expect(within(dialog).queryByText('kid')).toBeNull();
    // Screenshot mode hides usernames, as in the user list.
    act(() => useScreenshotMode.setState({ enabled: true }));
    expect(within(dialog).queryByText('guest')).toBeNull();
    act(() => useScreenshotMode.setState({ enabled: false }));
  });

  it('redirects users who cannot manage profiles', async () => {
    auth.user = { user_level: 1 };
    renderPage();
    expect(await screen.findByText('Channels')).toBeTruthy();
    expect(api.getVODProfiles).not.toHaveBeenCalled();
  });
});
