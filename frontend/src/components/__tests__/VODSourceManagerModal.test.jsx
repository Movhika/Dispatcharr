import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  default: {
    getVODPlaybackSessions: vi.fn(),
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
  Wrench: () => null,
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
    Button: ({ children, onClick, loading }) => (
      <button onClick={onClick} disabled={loading}>
        {children}
      </button>
    ),
    Group: Wrapper,
    Modal,
    ScrollArea: Wrapper,
    Select: ({ label, value, onChange, data = [] }) => (
      <label>
        {label}
        <select
          aria-label={label}
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" />
          {data.map((item) => (
            <option key={item} value={item}>
              {item}
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
    fireEvent.change(screen.getByLabelText('Audio languages'), {
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
});
