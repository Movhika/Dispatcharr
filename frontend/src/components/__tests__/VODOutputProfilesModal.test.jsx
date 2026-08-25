import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../store/useVODStore', () => ({ default: vi.fn() }));
vi.mock('../../api', () => ({
  default: {
    createVODAccessPolicy: vi.fn(),
    updateVODAccessPolicy: vi.fn(),
    deleteVODAccessPolicy: vi.fn(),
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
vi.mock('../VODFailoverRanking.jsx', () => ({
  default: () => <div>Failover priority</div>,
}));
vi.mock('../VideoFeaturePicker.jsx', () => ({
  default: ({ label }) => <div>{label}</div>,
}));
vi.mock('lucide-react', () => ({
  Eye: () => null,
  GripVertical: () => null,
  Info: () => null,
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
    Box: Wrapper,
    Button: ({ children, onClick, disabled, loading }) => (
      <button disabled={disabled || loading} onClick={onClick}>
        {children}
      </button>
    ),
    Checkbox: ({ label, checked, onChange }) => (
      <label>
        <input type="checkbox" checked={checked} onChange={onChange} />
        {label}
      </label>
    ),
    Group: Wrapper,
    Modal,
    MultiSelect: ({ label, value = [], onChange, data = [], disabled }) => (
      <label>
        {label}
        <select
          aria-label={label}
          multiple
          value={value}
          disabled={disabled}
          onChange={(event) =>
            onChange?.(
              Array.from(event.target.selectedOptions, (option) => option.value)
            )
          }
        >
          {data.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    ),
    NumberInput: Input,
    Paper: Wrapper,
    Pagination: () => null,
    Progress: ({ value }) => (
      <div aria-label="Catalog preparation progress">{value}</div>
    ),
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
    Tooltip: Wrapper,
  };
});

import API from '../../api';
import useVODStore from '../../store/useVODStore';
import VODOutputProfilesModal from '../VODOutputProfilesModal.jsx';

describe('VODOutputProfilesModal', () => {
  const fetchCategories = vi.fn().mockResolvedValue([]);
  const fetchAccessPolicies = vi.fn().mockResolvedValue([]);
  const removeAccessPolicy = vi.fn();
  const upsertAccessPolicy = vi.fn();
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
      min_resolution: 720,
      max_resolution: 1080,
      allow_unknown_metadata: false,
    },
    ranking: ['audio_language', 'subtitle_language', 'resolution'],
    category_rules: [],
    selection_status: 'ready',
    selection_current: true,
    selection_available: true,
    selection_progress: { phase: 'Ready', percent: 100 },
    selection_counts: {
      movies: {
        output_entries: 80,
        canonical_titles: 78,
      },
      series: {
        output_entries: 43,
        canonical_titles: 42,
      },
      output_entries: 123,
      canonical_titles: 120,
      eligible_sources: 150,
      unknown_metadata: 4,
    },
  };
  let storeProfiles;

  beforeEach(() => {
    vi.clearAllMocks();
    storeProfiles = [profile];
    API.createVODAccessPolicy.mockResolvedValue({
      ...profile,
      id: 8,
      name: 'New profile',
    });
    API.updateVODAccessPolicy.mockResolvedValue(profile);
    API.deleteVODAccessPolicy.mockResolvedValue({});
    API.rebuildVODAccessPolicy.mockResolvedValue({});
    useVODStore.mockImplementation((selector) =>
      selector({
        categories: {},
        accessPolicies: storeProfiles,
        fetchCategories,
        fetchAccessPolicies,
        upsertAccessPolicy,
        removeAccessPolicy,
      })
    );
  });

  it('shows prepared counts and can rebuild the selected profile', async () => {
    render(<VODOutputProfilesModal opened onClose={vi.fn()} />);

    expect(await screen.findByDisplayValue('German HD')).toBeInTheDocument();
    expect(screen.getByText(/Movies: 80 output entries/)).toBeInTheDocument();
    expect(screen.getByText(/Series: 43 output entries/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh catalog' }));

    await waitFor(() =>
      expect(API.rebuildVODAccessPolicy).toHaveBeenCalledWith(7)
    );
    expect(upsertAccessPolicy).toHaveBeenCalled();
    expect(fetchAccessPolicies).toHaveBeenCalled();
  });

  it('removes a deleted profile from the local list before polling again', async () => {
    storeProfiles = [
      { ...profile, id: 9, name: 'Temporary', is_default: false },
    ];
    render(<VODOutputProfilesModal opened onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByLabelText('Profile')).toHaveValue('9')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(API.deleteVODAccessPolicy).toHaveBeenCalledWith(9)
    );
    expect(removeAccessPolicy).toHaveBeenCalledWith(9);
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

  it('creates and saves a new reusable profile', async () => {
    render(<VODOutputProfilesModal opened onClose={vi.fn()} />);
    await screen.findByDisplayValue('German HD');

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.change(screen.getByLabelText('Profile name'), {
      target: { value: 'New profile' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() =>
      expect(API.createVODAccessPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New profile',
          hard_constraints: { source_rules: [] },
        })
      )
    );
    expect(upsertAccessPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8, name: 'New profile' })
    );
  });

  it('does not overwrite an edited draft when profile status is polled', async () => {
    const view = render(<VODOutputProfilesModal opened onClose={vi.fn()} />);
    const name = await screen.findByLabelText('Profile name');
    fireEvent.change(name, { target: { value: 'Unsaved edit' } });

    storeProfiles = [
      {
        ...profile,
        selection_status: 'building',
        selection_current: false,
      },
    ];
    view.rerender(<VODOutputProfilesModal opened onClose={vi.fn()} />);

    expect(screen.getByLabelText('Profile name')).toHaveValue('Unsaved edit');
  });

  it('shows catalog build progress while a previous generation stays available', async () => {
    storeProfiles = [
      {
        ...profile,
        selection_status: 'building',
        selection_current: false,
        selection_available: true,
        selection_started_at: new Date().toISOString(),
        selection_progress: {
          phase: 'Selecting movies',
          percent: 36,
          processed: 5000,
          total: 10000,
        },
      },
    ];

    render(<VODOutputProfilesModal opened onClose={vi.fn()} />);

    expect(await screen.findByText(/Selecting movies/)).toBeInTheDocument();
    expect(
      screen.getByLabelText('Catalog preparation progress')
    ).toHaveTextContent('36');
    expect(
      screen.getByText(/Showing the last completed catalog/)
    ).toBeInTheDocument();
  });
});
