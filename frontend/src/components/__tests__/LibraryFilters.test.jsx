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
import LibraryFilters from '../LibraryFilters.jsx';

const options = {
  accounts: [{ id: 3, name: 'Provider' }],
  categories: [{ id: 4, name: 'English category', category_type: 'movie' }],
  audio_languages: ['eng'],
  subtitle_languages: ['ger'],
  resolution: ['1080p'],
  video_features: ['hdr'],
  container_extensions: ['mkv'],
  genres: ['Drama'],
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
    ['DUB', 'audio_language', 'English (eng)', 'eng'],
    ['SUB', 'subtitle_language', 'German (ger)', 'ger'],
    ['Resolution', 'resolution', '1080p', '1080p'],
    ['Feature', 'video_feature', 'HDR', 'hdr'],
    ['Format', 'container_extension', 'mkv', 'mkv'],
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
  it('uses a date and genre search instead of relative days or an exact genre selection', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    fireEvent.change(screen.getByLabelText('Added from'), {
      target: { value: '2026-10-01' },
    });
    expect(changed).toHaveBeenLastCalledWith({ added_since: '2026-10-01' });
    fireEvent.change(screen.getByLabelText('Added from'), {
      target: { value: '' },
    });
    expect(changed).toHaveBeenLastCalledWith({ added_since: '' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Genre contains' }), {
      target: { value: 'fiction' },
    });
    expect(changed).toHaveBeenLastCalledWith({ genre: 'fiction' });
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
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter library' }));
    expect(
      within(
        screen.getByRole('region', { name: 'Provider filters' })
      ).getByRole('textbox', { name: 'Provider account', exact: true })
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole('region', { name: 'Metadata filters' })
      ).getByRole('textbox', { name: 'Metadata protection', exact: true })
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole('region', { name: 'File data filters' })
      ).getByRole('textbox', { name: 'Resolution', exact: true })
    ).toBeInTheDocument();
    for (const [label, key, value] of [
      ['Added from', 'added_since', '2026-10-01'],
      ['Added to', 'added_until', '2026-10-31'],
      ['Released from', 'released_since', '2000-01-01'],
      ['Released to', 'released_until', '2020-12-31'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      expect(changed).toHaveBeenLastCalledWith({ [key]: value });
    }
    expect(
      screen.getByRole('button', { name: 'Filter library' })
    ).toHaveAccessibleDescription('4 filters active');
    fireEvent.change(screen.getByLabelText('Added to'), {
      target: { value: '2026-09-01' },
    });
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
