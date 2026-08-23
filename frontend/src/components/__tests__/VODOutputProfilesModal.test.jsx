import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../store/useVODStore', () => ({ default: vi.fn() }));
vi.mock('../../api', () => ({
  default: {
    rebuildVODAccessPolicy: vi.fn(),
    getVODAccessPolicySelections: vi.fn(),
  },
}));
vi.mock('../../utils/notificationUtils', () => ({
  showNotification: vi.fn(),
}));
vi.mock('../forms/VODUserCategorySelector.jsx', () => ({
  default: () => null,
}));
vi.mock('lucide-react', () => ({
  Plus: () => null,
  RefreshCw: () => null,
  Save: () => null,
  Trash2: () => null,
}));
vi.mock('@mantine/core', () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  const Input = ({ label, value = '', onChange, disabled }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </label>
  );
  const Modal = ({ opened, title, children }) =>
    opened ? (
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null;
  Modal.NativeScrollArea = Wrapper;
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
        {data.map((item) => {
          const option =
            typeof item === 'string' ? { value: item, label: item } : item;
          return (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          );
        })}
      </select>
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
    Group: Wrapper,
    Modal,
    NumberInput: Input,
    Pagination: () => null,
    ScrollArea: Wrapper,
    SegmentedControl: () => null,
    Select,
    Stack: Wrapper,
    Switch: ({ label, checked, onChange }) => (
      <label>
        {label}
        <input
          aria-label={label}
          type="checkbox"
          checked={checked}
          onChange={onChange}
        />
      </label>
    ),
    Table: Wrapper,
    TableTbody: Wrapper,
    TableTd: Wrapper,
    TableTh: Wrapper,
    TableThead: Wrapper,
    TableTr: Wrapper,
    Tabs: Wrapper,
    TabsList: Wrapper,
    TabsPanel: Wrapper,
    TabsTab: Wrapper,
    TagsInput: ({ label, value = [], onChange }) => (
      <label>
        {label}
        <input
          aria-label={label}
          value={value.join(',')}
          onChange={(event) =>
            onChange(event.target.value.split(',').filter(Boolean))
          }
        />
      </label>
    ),
    Text: Wrapper,
    TextInput: Input,
  };
});

import API from '../../api';
import useVODStore from '../../store/useVODStore';
import VODOutputProfilesModal from '../VODOutputProfilesModal.jsx';

describe('VODOutputProfilesModal', () => {
  const fetchCategories = vi.fn().mockResolvedValue([]);
  const fetchAccessPolicies = vi.fn().mockResolvedValue([]);
  const profile = {
    id: 7,
    name: 'German HD',
    export_mode: 'compact',
    is_default: true,
    is_active: true,
    hard_constraints: {
      required_audio_languages: ['ger'],
      required_subtitle_languages: ['ger'],
      language_match_mode: 'any',
      preferred_resolutions: ['1080p'],
      min_resolution: 720,
      max_resolution: 1080,
      allow_unknown_metadata: false,
    },
    ranking: ['audio_language', 'subtitle_language', 'resolution'],
    category_rules: [],
    selection_status: 'ready',
    selection_current: true,
    selection_counts: {
      output_entries: 123,
      canonical_titles: 120,
      eligible_sources: 150,
      unknown_metadata: 4,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    API.rebuildVODAccessPolicy.mockResolvedValue({});
    useVODStore.mockImplementation((selector) =>
      selector({
        categories: {},
        accessPolicies: [profile],
        fetchCategories,
        fetchAccessPolicies,
      })
    );
  });

  it('shows prepared counts and can rebuild the selected profile', async () => {
    render(<VODOutputProfilesModal opened onClose={vi.fn()} />);

    expect(await screen.findByDisplayValue('German HD')).toBeInTheDocument();
    expect(screen.getByText('Output entries: 123')).toBeInTheDocument();
    expect(screen.getByText('Canonical titles: 120')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }));

    await waitFor(() =>
      expect(API.rebuildVODAccessPolicy).toHaveBeenCalledWith(7)
    );
    expect(fetchAccessPolicies).toHaveBeenCalled();
  });

  it('keeps a new draft empty instead of reselecting the first profile', async () => {
    render(<VODOutputProfilesModal opened onClose={vi.fn()} />);
    expect(await screen.findByDisplayValue('German HD')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Profile name')).toHaveValue('')
    );
  });
});
