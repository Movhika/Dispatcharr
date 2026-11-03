import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import LibraryFilters, { LibraryFilterFields } from '../LibraryFilters.jsx';

const options = {
  accounts: [
    { id: 3, name: 'Provider' },
    { id: 5, name: 'Backup' },
  ],
  categories: [{ id: 4, name: 'English category', category_type: 'movie' }],
  audio_languages: ['eng'],
  subtitle_languages: ['ger'],
  resolution: ['2160p', '1080p', '720p'],
  video_features: ['hdr'],
  container_extensions: ['mkv'],
  streaming_services: [
    { value: 'DE:8', region: 'DE', name: 'Netflix', titles: 4 },
    { value: 'US:9', region: 'US', name: 'Prime Video', titles: 2 },
  ],
};
const changed = vi.fn();
function Harness({ initial = {}, admin = true }) {
  const [filters, setFilters] = useState(initial);
  return (
    <MantineProvider env="test">
      <LibraryFilters
        admin={admin}
        filters={filters}
        options={options}
        onChange={(patch) => {
          changed(patch);
          setFilters((current) => ({ ...current, ...patch }));
        }}
      />
    </MantineProvider>
  );
}
beforeEach(() => vi.clearAllMocks());

describe('Library filter popover', () => {
  it.each([
    [
      { added_after_days: 30, released_until: '1990-12-31' },
      'Titles need to match both Added and Released.',
    ],
    [
      { added_until: '2020-12-31', released_since: '2021-01-01' },
      'Released starts after the Added period ends, so no title can match.',
    ],
  ])('explains combined Added and Released rules', (filters, message) => {
    render(
      <MantineProvider env="test">
        <LibraryFilterFields filters={filters} periods onChange={changed} />
      </MantineProvider>
    );
    expect(screen.getByText(message)).toBeTruthy();
  });

  it('checks category name patterns', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Category name (regex)' }),
      { target: { value: 'amazon|(' } }
    );
    expect(screen.getByText('Invalid regular expression.')).toBeTruthy();
  });

  it('offers lists one date over a period that follows the date', async () => {
    function Fields() {
      const [filters, setFilters] = useState({});
      return (
        <MantineProvider env="test">
          <LibraryFilterFields
            filters={filters}
            periods
            onChange={(patch) => {
              changed(patch);
              setFilters((current) => ({ ...current, ...patch }));
            }}
          />
        </MantineProvider>
      );
    }
    render(<Fields />);
    const dates = screen.getByRole('region', { name: 'Metadata filters' });
    expect(
      within(
        screen.getByRole('region', { name: 'Provider filters' })
      ).getByRole('textbox', { name: 'Added' })
    ).toBeTruthy();
    fireEvent.click(within(dates).getByRole('textbox', { name: 'Released' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Season' }));
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ released_period: 'season', released_since: '' })
    );
    expect(within(dates).getByText(/^Now: /)).toBeTruthy();
    // A chosen season stays, e.g. a past one.
    fireEvent.click(within(dates).getByRole('textbox', { name: 'Which' }));
    fireEvent.click(
      await screen.findByRole('option', { name: 'Choose a season' })
    );
    expect(changed).toHaveBeenLastCalledWith({
      released_period_anchor: expect.stringMatching(/^\d{4}-(01|04|07|10)-01$/),
    });
    expect(within(dates).getByText(/^Covers: /)).toBeTruthy();
    expect(within(dates).getByRole('textbox', { name: 'Season' })).toBeTruthy();
    fireEvent.click(within(dates).getByRole('textbox', { name: 'Released' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Every year' }));
    fireEvent.change(
      within(dates).getByRole('textbox', { name: 'Every year from' }),
      { target: { value: '01.12' } }
    );
    expect(changed).toHaveBeenLastCalledWith({ released_from_day: '12-01' });
    // The Library itself keeps plain date ranges.
    expect(screen.queryByLabelText('Released from')).toBeNull();
  });

  it.each([
    ['DUB', 'audio_language', 'English (eng)', 'eng'],
    ['SUB', 'subtitle_language', 'German (ger)', 'ger'],
    ['Feature', 'video_feature', 'HDR', 'hdr'],
    ['Format', 'container_extension', 'mkv', 'mkv'],
    ['Streaming service', 'streaming_service', 'Netflix', 'DE:8'],
    ['Anime', 'anime_mode', 'Only anime', 'only'],
    ['Adult content', 'adult_mode', 'Exclude adult content', 'exclude'],
    ['Metadata', 'metadata_status', 'No TMDB ID', 'missing_id'],
    ['Metadata', 'metadata_status', 'Enriched', 'enriched'],
    ['Metadata', 'metadata_status', 'Not enriched', 'missing_metadata'],
    ['Metadata', 'metadata_status', 'No external ID', 'missing_external_ids'],
    ['Metadata protection', 'locked', 'Unlocked', 'false'],
  ])(
    'applies %s and marks the active count',
    async (label, field, option, value) => {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
      fireEvent.click(
        screen.getByRole('textbox', { name: label, exact: true })
      );
      fireEvent.click(
        await screen.findByRole('option', { name: option, exact: true })
      );
      expect(changed).toHaveBeenLastCalledWith({ [field]: value });
      expect(
        screen.getByRole('button', { name: 'Filter library' })
      ).toHaveAccessibleDescription('1 filter active');
    }
  );
  it('groups streaming services by region and adds several', async () => {
    render(<Harness initial={{ streaming_service: 'DE:8' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    fireEvent.click(
      screen.getByRole('textbox', { name: 'Streaming service', exact: true })
    );
    fireEvent.click(await screen.findByRole('option', { name: 'Prime Video' }));
    expect(changed).toHaveBeenLastCalledWith({
      streaming_service: 'DE:8,US:9',
    });
    expect(screen.getByText('Germany')).toBeInTheDocument();
    expect(screen.getByText('United States')).toBeInTheDocument();
  });
  it('keeps a stored streaming service missing from the options', () => {
    render(<Harness initial={{ streaming_service: 'FR:337' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    expect(screen.getAllByText('FR:337').length).toBeGreaterThan(0);
  });
  it('searches several typed genre terms without a fixed list', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    const genre = screen.getByRole('textbox', {
      name: 'Genre contains',
      exact: true,
    });
    fireEvent.change(genre, { target: { value: 'Action' } });
    fireEvent.keyDown(genre, { key: 'Enter' });
    expect(changed).toHaveBeenLastCalledWith({ genre: 'Action' });
    fireEvent.change(genre, { target: { value: 'Abenteuer' } });
    fireEvent.keyDown(genre, { key: 'Enter' });
    expect(changed).toHaveBeenLastCalledWith({ genre: 'Action,Abenteuer' });
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Filter library' })
    ).toHaveAccessibleDescription('1 filter active');
  });
  it('picks dates with the date picker instead of browser inputs', async () => {
    render(<Harness initial={{ added_since: '2026-10-01' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    expect(screen.getByLabelText('Added from')).toHaveTextContent(
      'Oct 1, 2026'
    );
    fireEvent.click(screen.getByLabelText('Added to'));
    fireEvent.click(
      (await screen.findAllByText('15', { selector: 'button' }))[0]
    );
    expect(changed).toHaveBeenLastCalledWith({
      added_until: expect.stringMatching(/^\d{4}-\d{2}-15$/),
    });
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });
  it('clears all popover filters but preserves search and representation', () => {
    render(
      <Harness
        initial={{
          search: 'Film',
          account: '3',
          category: '4',
          audio_language: 'eng',
          resolution: '1080p',
          locked: 'false',
          added_since: '2026-10-01',
        }}
      />
    );
    const filter = screen.getByRole('button', { name: 'Filter library' });
    expect(filter).toHaveAccessibleDescription('6 filters active');
    fireEvent.click(filter);
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    const patch = changed.mock.calls.at(-1)[0];
    expect(patch).toMatchObject({
      audio_language: '',
      resolution: '',
      locked: '',
      added_since: '',
      account: '',
      category: '',
      type: 'all',
    });
    expect(patch).not.toHaveProperty('search');
    expect(patch).not.toHaveProperty('view');
    expect(filter).not.toHaveAttribute('data-filter-active');
  });
  it.each([
    ['Provider account', 'Provider', { account: '3' }],
    ['Provider category', 'English category', { category: '4' }],
    ['Content type', 'Movies', { type: 'movie', category: '', content_id: '' }],
  ])('keeps %s in the shared filter popover', async (label, option, patch) => {
    render(<Harness />);
    expect(
      screen.queryByRole('textbox', { name: label })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    fireEvent.click(screen.getByRole('textbox', { name: label }));
    fireEvent.click(
      await screen.findByRole('option', { name: option, exact: true })
    );
    expect(changed).toHaveBeenLastCalledWith(patch);
    expect(
      screen.getByRole('button', { name: 'Filter library' })
    ).toHaveAccessibleDescription('1 filter active');
  });
  it('combines several provider accounts', async () => {
    render(<Harness initial={{ account: '3' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    fireEvent.click(screen.getByRole('textbox', { name: 'Provider account' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Backup' }));
    expect(changed).toHaveBeenLastCalledWith({ account: '3,5' });
  });
  it('filters a resolution range and shows an exact one as a range', async () => {
    render(<Harness initial={{ resolution: '1080p' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    expect(
      screen.getByRole('textbox', { name: 'Resolution from', exact: true })
    ).toHaveValue('1080p');
    fireEvent.click(
      screen.getByRole('textbox', { name: 'Resolution to', exact: true })
    );
    fireEvent.click(await screen.findByRole('option', { name: '2160p' }));
    expect(changed).toHaveBeenLastCalledWith({
      resolution: '',
      resolution_min: '1080p',
      resolution_max: '2160p',
    });
    fireEvent.click(
      screen.getByRole('textbox', { name: 'Resolution from', exact: true })
    );
    fireEvent.click(await screen.findByRole('option', { name: '2160p' }));
    fireEvent.click(
      screen.getByRole('textbox', { name: 'Resolution to', exact: true })
    );
    fireEvent.click(await screen.findByRole('option', { name: '720p' }));
    expect(
      screen.getByText('Choose a maximum at or above the minimum.')
    ).toBeTruthy();
  });
  it('preserves a selected value absent from new scoped options', () => {
    render(<Harness initial={{ audio_language: 'ger' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    expect(
      screen.getByRole('textbox', { name: 'DUB', exact: true })
    ).toHaveValue('German (ger)');
  });
  it('closes with Escape and returns focus to the filter button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const filter = screen.getByRole('button', { name: 'Filter library' });
    await user.click(filter);
    expect(
      screen.getByRole('textbox', { name: 'DUB', exact: true })
    ).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'DUB', exact: true })
      ).not.toBeInTheDocument()
    );
    await waitFor(() => expect(filter).toHaveFocus());
  });
  it('groups provider, metadata and file data separately and provides inclusive date ranges', () => {
    render(
      <Harness
        initial={{
          added_since: '2026-10-01',
          added_until: '2026-09-01',
          released_since: '2000-01-01',
          released_until: '2020-12-31',
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    const provider = screen.getByRole('region', { name: 'Provider filters' });
    const metadata = screen.getByRole('region', { name: 'Metadata filters' });
    expect(
      within(provider).getByRole('textbox', {
        name: 'Provider account',
        exact: true,
      })
    ).toBeInTheDocument();
    expect(
      within(metadata).getByRole('textbox', {
        name: 'Metadata protection',
        exact: true,
      })
    ).toBeInTheDocument();
    expect(within(provider).getByLabelText('Added from')).toBeInTheDocument();
    expect(within(provider).getByLabelText('Added to')).toBeInTheDocument();
    expect(
      within(metadata).getByLabelText('Released from')
    ).toBeInTheDocument();
    expect(within(metadata).getByLabelText('Released to')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Dates filters' })
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole('region', { name: 'File data filters' })
      ).getByRole('textbox', { name: 'Resolution from', exact: true })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Filter library' })
    ).toHaveAccessibleDescription('4 filters active');
    expect(
      screen.getByText('End date precedes start date.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(changed.mock.calls.at(-1)[0]).toMatchObject({
      blocked: '',
      added_since: '',
      added_until: '',
      released_since: '',
      released_until: '',
    });
  });
  it('offers output availability independently of metadata protection only to administrators', async () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    fireEvent.click(
      screen.getByRole('textbox', { name: 'Availability', exact: true })
    );
    fireEvent.click(
      await screen.findByRole('option', { name: 'Blocked', exact: true })
    );
    expect(changed).toHaveBeenLastCalledWith({ blocked: 'true' });
    unmount();
    render(<Harness admin={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    expect(
      screen.queryByRole('textbox', { name: 'Availability', exact: true })
    ).not.toBeInTheDocument();
  });
});
