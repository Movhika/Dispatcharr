import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  default: {
    getVODMetadataStatus: vi.fn(),
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
    Box: Wrapper,
    Button: ({ children, onClick, disabled, loading }) => (
      <button disabled={disabled || loading} onClick={onClick}>
        {children}
      </button>
    ),
    Flex: Wrapper,
    Group: Wrapper,
    Modal: ({ opened, title, children }) =>
      opened ? (
        <div>
          <h2>{title}</h2>
          {children}
        </div>
      ) : null,
    ScrollArea: Wrapper,
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
    Tabs: Wrapper,
    TabsList: Wrapper,
    TabsPanel: Wrapper,
    TabsTab: ({ children }) => <button>{children}</button>,
    Text: Wrapper,
    TextInput: ({ label, value, onChange, description }) => (
      <label>
        {label}
        {description}
        <input aria-label={label} value={value} onChange={onChange} />
      </label>
    ),
    Tooltip: Wrapper,
  };
});

import API from '../../api';
import VODMetadataModal from '../VODMetadataModal';

const savedRule = {
  pattern: '4K-D+ -',
  replacement: ' ',
  enabled: true,
};
const statusResponse = {
  settings: { title_rules: [savedRule] },
};

describe('VODMetadataModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getVODMetadataStatus.mockResolvedValue(statusResponse);
    API.previewVODMetadataTitles.mockResolvedValue({
      results: [
        {
          id: 7,
          content_type: 'movie',
          before: '4K-D+ - Bliss (2021)',
          after: '4K-D+ - Bliss',
          changed: true,
          year: 2021,
        },
      ],
    });
    API.updateVODMetadataSettings.mockResolvedValue(statusResponse);
  });

  it('contains only TMDB settings and title cleanup tabs', async () => {
    render(<VODMetadataModal opened onClose={vi.fn()} />);
    expect(await screen.findByText('TMDB settings active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'TMDB settings' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Title cleanup' })).toBeVisible();
    expect(screen.queryByText('Enrich selected')).not.toBeInTheDocument();
    expect(screen.queryByText('Reload selected')).not.toBeInTheDocument();
  });

  it('warns when a plus sign is acting as a regex quantifier', async () => {
    render(<VODMetadataModal opened onClose={vi.fn()} />);
    expect(
      await screen.findByText(/repeats the preceding regex token/i)
    ).toBeInTheDocument();
  });

  it('previews ordered cleanup rules against stored VOD titles', async () => {
    render(<VODMetadataModal opened onClose={vi.fn()} />);
    await screen.findByDisplayValue('4K-D+ -');
    fireEvent.change(screen.getByLabelText('Preview titles containing'), {
      target: { value: 'Bliss' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview titles' }));

    await waitFor(() =>
      expect(API.previewVODMetadataTitles).toHaveBeenCalledWith(
        [savedRule],
        null,
        'Bliss'
      )
    );
    expect(await screen.findByText('4K-D+ - Bliss')).toBeInTheDocument();
  });

  it('saves title cleanup independently from TMDB settings', async () => {
    render(<VODMetadataModal opened onClose={vi.fn()} />);
    const input = await screen.findByLabelText('Rule 1 · regular expression');
    fireEvent.change(input, {
      target: { value: '^4K-D\\+\\s*-\\s*' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() =>
      expect(API.updateVODMetadataSettings).toHaveBeenCalledWith({
        title_rules: [
          {
            pattern: '^4K-D\\+\\s*-\\s*',
            replacement: ' ',
            enabled: true,
          },
        ],
      })
    );
  });
});
