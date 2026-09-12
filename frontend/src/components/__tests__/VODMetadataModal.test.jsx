import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  default: {
    getVODMetadataStatus: vi.fn(),
    getAllContent: vi.fn(),
    refreshVODMetadata: vi.fn(),
    previewVODMetadataTitles: vi.fn(),
    updateVODMetadataSettings: vi.fn(),
  },
}));
vi.mock('../../utils/notificationUtils', () => ({
  showNotification: vi.fn(),
}));
vi.mock('../forms/settings/VODMetadataSettingsForm', () => ({
  default: ({ active }) => (
    <div data-testid="tmdb-settings-form">
      TMDB settings {active ? 'active' : 'inactive'}
    </div>
  ),
}));
vi.mock('lucide-react', () => ({
  Eye: () => null,
  Plus: () => null,
  RefreshCw: () => null,
  Search: () => null,
  Settings2: () => null,
  Trash2: () => null,
}));
vi.mock('@mantine/core', () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  const Table = ({ children }) => <table>{children}</table>;
  Table.Thead = ({ children }) => <thead>{children}</thead>;
  Table.Tbody = ({ children }) => <tbody>{children}</tbody>;
  Table.Tr = ({ children }) => <tr>{children}</tr>;
  Table.Th = ({ children }) => <th>{children}</th>;
  Table.Td = ({ children }) => <td>{children}</td>;
  return {
    ActionIcon: ({ children, onClick, 'aria-label': label }) => (
      <button aria-label={label} onClick={onClick}>
        {children}
      </button>
    ),
    Badge: Wrapper,
    Button: ({ children, onClick, disabled, loading }) => (
      <button disabled={disabled || loading} onClick={onClick}>
        {children}
      </button>
    ),
    Checkbox: ({ checked, onChange, 'aria-label': label }) => (
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        onChange={onChange}
      />
    ),
    Group: Wrapper,
    Modal: ({ opened, title, children }) =>
      opened ? (
        <div>
          <h2>{title}</h2>
          {children}
        </div>
      ) : null,
    Pagination: () => null,
    Progress: ({ value }) => <div data-testid="progress">{value}</div>,
    SegmentedControl: ({ data, onChange }) => (
      <div>
        {data.map((row) => (
          <button key={row.value} onClick={() => onChange(row.value)}>
            {row.label}
          </button>
        ))}
      </div>
    ),
    Select: ({ label, data = [], value, onChange }) => (
      <label>
        {label}
        <select
          value={value || ''}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="" />
          {data.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </select>
      </label>
    ),
    Stack: Wrapper,
    Switch: ({ checked, onChange, 'aria-label': label }) => (
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        onChange={onChange}
      />
    ),
    Table,
    Text: Wrapper,
    TextInput: ({ label, value, onChange }) => (
      <label>
        {label}
        <input aria-label={label} value={value} onChange={onChange} />
      </label>
    ),
  };
});

import API from '../../api';
import VODMetadataModal from '../VODMetadataModal';

const statusResponse = {
  settings: { title_rules: [] },
  catalog: {
    movies: 100,
    series: 20,
    enriched_movies: 80,
    enriched_series: 10,
  },
  state: { status: 'complete', progress: { percent: 100 } },
};
const contentResponse = {
  count: 1,
  results: [
    {
      id: 7,
      content_type: 'movie',
      name: 'Bliss',
      year: 2021,
      tmdb_id: '613911',
      tmdb_status: '',
    },
  ],
};

describe('VODMetadataModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getVODMetadataStatus.mockResolvedValue(statusResponse);
    API.getAllContent.mockResolvedValue(contentResponse);
    API.refreshVODMetadata.mockResolvedValue({ status: 'queued' });
    API.previewVODMetadataTitles.mockResolvedValue({
      results: [
        {
          id: 7,
          content_type: 'movie',
          before: 'Bliss',
          after: 'Clean Bliss',
        },
      ],
    });
    API.updateVODMetadataSettings.mockResolvedValue(statusResponse);
  });

  it('lists canonical titles and refreshes an explicit selection', async () => {
    render(<VODMetadataModal opened onClose={vi.fn()} />);
    expect((await screen.findAllByText('Bliss')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText('Select Bliss'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Enrich selected (1)' })
    );
    await waitFor(() =>
      expect(API.refreshVODMetadata).toHaveBeenCalledWith([
        { id: 7, content_type: 'movie' },
      ])
    );
  });

  it('shows durable progress and disables refresh while active', async () => {
    API.getVODMetadataStatus.mockResolvedValue({
      ...statusResponse,
      state: {
        status: 'running',
        progress: {
          phase: 'Fetching TMDB metadata',
          percent: 32,
          processed: 32,
          total: 100,
        },
      },
    });
    render(<VODMetadataModal opened onClose={vi.fn()} />);
    expect(
      await screen.findByText('Fetching TMDB metadata')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Enrich pending' })
    ).toBeDisabled();
    expect(screen.getByTestId('progress')).toHaveTextContent('32');
  });

  it('keeps TMDB configuration inside the VOD metadata dialog', async () => {
    render(<VODMetadataModal opened onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'TMDB settings' }));
    expect(await screen.findByTestId('tmdb-settings-form')).toHaveTextContent(
      'TMDB settings active'
    );
  });

  it('previews lookup rename rules against the visible canonical page', async () => {
    render(<VODMetadataModal opened onClose={vi.fn()} />);
    expect((await screen.findAllByText('Bliss')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Lookup rename' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    fireEvent.change(screen.getByLabelText('Regular expression'), {
      target: { value: '\\s+Extended Cut$' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview current page' })
    );

    await waitFor(() =>
      expect(API.previewVODMetadataTitles).toHaveBeenCalledWith(
        [
          {
            pattern: '\\s+Extended Cut$',
            replacement: '',
            enabled: true,
          },
        ],
        [{ id: 7, content_type: 'movie' }]
      )
    );
    expect(await screen.findByText('Clean Bliss')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }));
    await waitFor(() =>
      expect(API.updateVODMetadataSettings).toHaveBeenCalledWith({
        title_rules: [
          {
            pattern: '\\s+Extended Cut$',
            replacement: '',
            enabled: true,
          },
        ],
      })
    );
  });
});
