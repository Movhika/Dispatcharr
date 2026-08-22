import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  default: {
    getVODAccessPolicies: vi.fn(),
    getVODCategoryRelations: vi.fn(),
    getUsers: vi.fn(),
    getVODPlaybackSessions: vi.fn(),
    updateVODAccessPolicy: vi.fn(),
    createVODAccessPolicy: vi.fn(),
    deleteVODAccessPolicy: vi.fn(),
    updateVODSourceManualMetadata: vi.fn(),
  },
}));

vi.mock('../../utils/notificationUtils', () => ({
  showNotification: vi.fn(),
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
    Checkbox: ({ label, checked, onChange }) => (
      <label>
        <input type="checkbox" checked={checked} onChange={onChange} />
        {label}
      </label>
    ),
    Group: Wrapper,
    Modal,
    MultiSelect: ({ label, value, onChange, data }) => (
      <label>
        {label}
        <select
          multiple
          aria-label={label}
          value={value}
          onChange={(event) =>
            onChange(
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
    NumberInput: ({ label, value, onChange, disabled }) => (
      <label>
        {label || 'Category priority'}
        <input
          type="number"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
    ),
    ScrollArea: Wrapper,
    Select: ({ label, value, onChange, data }) => (
      <label>
        {label}
        <select
          aria-label={label}
          value={value || ''}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="" />
          {data.map((item) => {
            const value = typeof item === 'string' ? item : item.value;
            return (
              <option key={value} value={value}>
                {typeof item === 'string' ? item : item.label}
              </option>
            );
          })}
        </select>
      </label>
    ),
    Stack: Wrapper,
    Tabs: Wrapper,
    TabsList: Wrapper,
    TabsPanel: Wrapper,
    TabsTab: Wrapper,
    Table: Wrapper,
    TableTbody: Wrapper,
    TableTd: Wrapper,
    TableTh: Wrapper,
    TableThead: Wrapper,
    TableTr: Wrapper,
    TagsInput: ({ label, value, onChange }) => (
      <label>
        {label}
        <input
          aria-label={label}
          value={(value || []).join(',')}
          onChange={(event) =>
            onChange(event.target.value.split(',').filter(Boolean))
          }
        />
      </label>
    ),
    Text: Wrapper,
    TextInput: ({ label, value, onChange, placeholder }) => (
      <label>
        {label}
        <input
          aria-label={label || placeholder}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
        />
      </label>
    ),
  };
});

vi.mock('lucide-react', () => ({
  Plus: () => null,
  Save: () => null,
  Trash2: () => null,
  Wrench: () => null,
}));

import API from '../../api';
import VODSourceManagerModal from '../VODSourceManagerModal';

const policy = {
  id: 7,
  name: 'German family',
  export_mode: 'compact',
  is_default: true,
  is_active: true,
  users: [1],
  hard_constraints: {
    required_audio_languages: ['deu'],
    required_subtitle_languages: [],
    min_height: 720,
    max_height: 2160,
    allow_unknown_metadata: false,
    cross_category_failover: false,
  },
  ranking: ['category_priority', 'resolution', 'account_priority'],
  category_rules: [{ category_relation: 12, enabled: true, priority: 25 }],
};

describe('VODSourceManagerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getVODAccessPolicies.mockResolvedValue([policy]);
    API.getVODCategoryRelations.mockResolvedValue([
      {
        id: 12,
        enabled: true,
        account_name: 'provider-a',
        category_name: 'GERMANY KINDER',
        category_type: 'movie',
      },
    ]);
    API.getUsers.mockResolvedValue([{ id: 1, username: 'Maria' }]);
    API.getVODPlaybackSessions.mockResolvedValue({ results: [] });
    API.updateVODAccessPolicy.mockImplementation(async (_id, payload) => ({
      id: 7,
      ...payload,
    }));
  });

  it('saves catalog, category and failover rules as one policy', async () => {
    render(<VODSourceManagerModal opened onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByLabelText('Name')).toHaveValue('German family')
    );
    fireEvent.change(screen.getByLabelText('XC catalog mode'), {
      target: { value: 'variants' },
    });
    fireEvent.click(
      screen.getByLabelText('Allow failover across selected categories')
    );
    fireEvent.change(screen.getByLabelText('Allowed audio languages'), {
      target: { value: 'deu,eng' },
    });
    fireEvent.change(screen.getByLabelText('Category priority'), {
      target: { value: '80' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));

    await waitFor(() =>
      expect(API.updateVODAccessPolicy).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          export_mode: 'variants',
          hard_constraints: expect.objectContaining({
            required_audio_languages: ['deu', 'eng'],
            cross_category_failover: true,
          }),
          category_rules: [
            { category_relation: 12, enabled: true, priority: 80 },
          ],
        })
      )
    );
  });
});
