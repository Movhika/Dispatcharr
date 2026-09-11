import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  default: {
    getVODMetadataStatus: vi.fn(),
    updateVODMetadataSettings: vi.fn(),
    refreshVODMetadata: vi.fn(),
  },
}));
vi.mock('../../utils/notificationUtils', () => ({
  showNotification: vi.fn(),
}));
vi.mock('lucide-react', () => ({
  RefreshCw: () => null,
  Save: () => null,
}));
vi.mock('@mantine/core', () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  const Modal = ({ opened, title, children }) =>
    opened ? (
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null;
  const Select = ({ label, value, onChange, data = [], disabled }) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value || ''}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value || null)}
      >
        <option value="" />
        {data.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
  const Toggle = ({ label, checked, onChange, disabled }) => (
    <label>
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {label}
    </label>
  );
  return {
    Alert: Wrapper,
    Badge: Wrapper,
    Button: ({ children, onClick, disabled, loading }) => (
      <button disabled={disabled || loading} onClick={onClick}>
        {children}
      </button>
    ),
    Checkbox: Toggle,
    Group: Wrapper,
    Modal,
    PasswordInput: ({ label, value, onChange, disabled, readOnly }) => (
      <label>
        {label}
        <input
          aria-label={label}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          onChange={onChange}
        />
      </label>
    ),
    Progress: ({ value }) => <div data-testid="progress">{value}</div>,
    Select,
    Stack: Wrapper,
    Switch: Toggle,
    Text: Wrapper,
  };
});

import API from '../../api';
import VODMetadataModal from '../VODMetadataModal';

const response = {
  settings: {
    token_configured: true,
    token_source: 'stored',
    languages: ['de-DE', 'en-US'],
    auto_enrich: true,
    match_missing: false,
    prefer_artwork: true,
  },
  catalog: {
    movies: 100,
    series: 20,
    enriched_movies: 80,
    enriched_series: 10,
  },
  state: { status: 'complete', progress: { percent: 100 } },
};

describe('VODMetadataModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getVODMetadataStatus.mockResolvedValue(response);
    API.updateVODMetadataSettings.mockResolvedValue(response);
    API.refreshVODMetadata.mockResolvedValue({ status: 'queued' });
  });

  it('shows durable coverage and starts a saved refresh', async () => {
    render(<VODMetadataModal opened onClose={vi.fn()} />);

    expect(await screen.findByText(/movies 80\/100/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save and refresh' }));

    await waitFor(() =>
      expect(API.updateVODMetadataSettings).toHaveBeenCalledWith({
        languages: ['de-DE', 'en-US'],
        match_missing: false,
        prefer_artwork: true,
      })
    );
    expect(API.refreshVODMetadata).toHaveBeenCalledWith();
  });

  it('disables editing while the recorded task is active', async () => {
    API.getVODMetadataStatus.mockResolvedValue({
      ...response,
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
      screen.getByRole('button', { name: 'Save and refresh' })
    ).toBeDisabled();
    expect(screen.getByTestId('progress')).toHaveTextContent('32');
  });
});
