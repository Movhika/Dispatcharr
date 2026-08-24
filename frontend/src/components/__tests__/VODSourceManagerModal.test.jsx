import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  default: {
    getVODPlaybackSessions: vi.fn(),
    deleteVODPlaybackSessions: vi.fn(),
    bulkUpdateVODPlaybackMetadata: vi.fn(),
    updateVODSourceManualMetadata: vi.fn(),
  },
}));
vi.mock('../../utils/notificationUtils', () => ({
  showNotification: vi.fn(),
}));
vi.mock('../LanguagePicker.jsx', () => ({
  default: ({ label, value = [], onChange, disabled }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value.join(',')}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value.split(',').filter(Boolean))
        }
      />
    </label>
  ),
}));
vi.mock('lucide-react', () => ({
  RefreshCw: () => null,
  Trash2: () => null,
  Wrench: () => null,
}));
vi.mock('@mantine/hooks', () => ({
  useDebouncedValue: (value) => [value],
}));
vi.mock('../ConfirmationDialog.jsx', () => ({
  default: ({ opened, onConfirm, title }) =>
    opened ? (
      <div>
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm delete</button>
      </div>
    ) : null,
}));
vi.mock('@mantine/core', () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  const Modal = Object.assign(
    ({ opened, children, title }) =>
      opened ? (
        <div>
          <h2>{title}</h2>
          {children}
        </div>
      ) : null,
    { NativeScrollArea: Wrapper }
  );
  return {
    ActionIcon: ({ children, onClick, disabled, 'aria-label': ariaLabel }) => (
      <button aria-label={ariaLabel} onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
    Alert: Wrapper,
    Button: ({ children, onClick, loading, disabled }) => (
      <button onClick={onClick} disabled={loading || disabled}>
        {children}
      </button>
    ),
    Checkbox: ({ checked, onChange, 'aria-label': ariaLabel }) => (
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        onChange={onChange}
      />
    ),
    Group: Wrapper,
    Modal,
    Pagination: ({ value, onChange }) => (
      <button aria-label="Next page" onClick={() => onChange(value + 1)} />
    ),
    ScrollArea: Wrapper,
    SegmentedControl: ({ 'aria-label': ariaLabel, value, onChange, data }) => (
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {data.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    ),
    Select: ({ label, value, onChange, data = [], disabled }) => (
      <label>
        {label}
        <select
          aria-label={label}
          value={value || ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" />
          {data.map((item) => (
            <option
              key={typeof item === 'string' ? item : item.value}
              value={typeof item === 'string' ? item : item.value}
            >
              {typeof item === 'string' ? item : item.label}
            </option>
          ))}
        </select>
      </label>
    ),
    Stack: Wrapper,
    Table: Wrapper,
    TableTbody: Wrapper,
    TableTd: Wrapper,
    TableTh: Wrapper,
    TableThead: Wrapper,
    TableTr: Wrapper,
    Text: Wrapper,
    TextInput: ({ label, value, onChange, type = 'text' }) => (
      <label>
        {label}
        <input
          type={type}
          aria-label={label}
          value={value}
          onChange={onChange}
        />
      </label>
    ),
  };
});

import API from '../../api';
import VODSourceManagerModal from '../VODSourceManagerModal';

const playback = {
  id: 1,
  started_at: '2026-08-23T12:00:00Z',
  content_name: 'Avatar - S01E01',
  account_name: 'provider-a',
  category_name: 'GERMANY KIDS',
  username: 'Maria',
  status: 'completed',
  watched_seconds: 125,
  bytes_sent: 1048576,
  source_asset: 9,
  source_effective_metadata: {
    values: {
      resolution: '1080p',
      audio_languages: ['ger'],
      subtitle_languages: ['eng'],
    },
    provenance: {
      resolution: 'observed',
      audio_languages: 'manual',
      subtitle_languages: 'observed',
    },
  },
};

describe('VODSourceManagerModal playback history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getVODPlaybackSessions.mockResolvedValue({ results: [playback] });
    API.deleteVODPlaybackSessions.mockResolvedValue({ deleted_sessions: 1 });
    API.bulkUpdateVODPlaybackMetadata.mockResolvedValue({
      selected_sessions: 1,
      updated_sources: 1,
    });
    API.updateVODSourceManualMetadata.mockResolvedValue({});
  });

  it('shows the exact source, transfer data and technical metadata', async () => {
    render(<VODSourceManagerModal opened onClose={vi.fn()} />);
    expect(
      await screen.findByText('provider-a — GERMANY KIDS')
    ).toBeInTheDocument();
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();
    expect(
      screen.getByText('1080p • Audio: ger • Subs: eng')
    ).toBeInTheDocument();
  });

  it('saves manual metadata as locked source data', async () => {
    render(<VODSourceManagerModal opened onClose={vi.fn()} />);
    await screen.findByText('Avatar - S01E01');
    fireEvent.click(screen.getByLabelText('Edit source metadata'));
    fireEvent.change(screen.getByLabelText('DUB languages'), {
      target: { value: 'ger,eng' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and lock' }));
    await waitFor(() =>
      expect(API.updateVODSourceManualMetadata).toHaveBeenCalledWith(
        9,
        { audio_languages: ['ger', 'eng'] },
        ['audio_languages']
      )
    );
  });

  it('sends user and date filters to the paginated server endpoint', async () => {
    render(<VODSourceManagerModal opened onClose={vi.fn()} />);
    await screen.findByText('Avatar - S01E01');

    fireEvent.change(screen.getByLabelText('User'), {
      target: { value: 'Maria' },
    });
    fireEvent.change(screen.getByLabelText('Started after'), {
      target: { value: '2026-08-23T10:00' },
    });

    await waitFor(() =>
      expect(API.getVODPlaybackSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          username: 'Maria',
          started_after: expect.stringContaining('2026-08-23'),
          page: 1,
          page_size: 50,
        })
      )
    );
  });

  it('deletes all history matching the current server filters', async () => {
    render(<VODSourceManagerModal opened onClose={vi.fn()} />);
    await screen.findByText('Avatar - S01E01');
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'completed' },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear filtered' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() =>
      expect(API.deleteVODPlaybackSessions).toHaveBeenCalledWith({
        ids: [],
        select_all: true,
        exclude_ids: [],
        filters: { status: 'completed' },
      })
    );
  });

  it('mass edits each distinct source represented by selected history rows', async () => {
    render(<VODSourceManagerModal opened onClose={vi.fn()} />);
    await screen.findByText('Avatar - S01E01');
    fireEvent.click(screen.getByLabelText('Select Avatar - S01E01'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit selected (1)' }));
    fireEvent.change(screen.getByLabelText('Resolution update mode'), {
      target: { value: 'set' },
    });
    fireEvent.change(screen.getByLabelText('Resolution'), {
      target: { value: '1080p' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply metadata' }));

    await waitFor(() =>
      expect(API.bulkUpdateVODPlaybackMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ ids: [1] }),
        { resolution: { mode: 'set', value: '1080p' } }
      )
    );
  });
});
