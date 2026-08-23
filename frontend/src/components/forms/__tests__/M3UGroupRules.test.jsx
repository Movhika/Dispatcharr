import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../api', () => ({
  default: {
    getM3UGroupRules: vi.fn(),
    createM3UGroupRule: vi.fn(),
    updateM3UGroupRule: vi.fn(),
    deleteM3UGroupRule: vi.fn(),
  },
}));

vi.mock('../../../utils/notificationUtils', () => ({
  showNotification: vi.fn(),
}));

vi.mock('@mantine/core', () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  return {
    ActionIcon: ({ children, onClick, 'aria-label': ariaLabel }) => (
      <button aria-label={ariaLabel} onClick={onClick}>
        {children}
      </button>
    ),
    Alert: Wrapper,
    Button: ({ children, onClick }) => (
      <button onClick={onClick}>{children}</button>
    ),
    Checkbox: ({ checked, onChange, 'aria-label': ariaLabel }) => (
      <input
        aria-label={ariaLabel}
        type="checkbox"
        checked={checked}
        onChange={onChange}
      />
    ),
    Group: Wrapper,
    NumberInput: ({ value, onChange }) => (
      <input
        aria-label="Rule order"
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    ),
    ScrollArea: Wrapper,
    Select: ({ value, onChange, data, disabled }) => (
      <select
        aria-label={`Select ${value}`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {data.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    ),
    Stack: Wrapper,
    Table: Wrapper,
    TableTbody: Wrapper,
    TableTd: Wrapper,
    TableTh: Wrapper,
    TableThead: Wrapper,
    TableTr: Wrapper,
    Text: Wrapper,
    TagsInput: ({ value = [], onChange }) => (
      <input
        aria-label="Language codes"
        value={value.join(',')}
        onChange={(event) =>
          onChange(event.target.value.split(',').filter(Boolean))
        }
      />
    ),
    TextInput: ({ value, onChange, 'aria-label': ariaLabel }) => (
      <input aria-label={ariaLabel} value={value} onChange={onChange} />
    ),
  };
});

vi.mock('lucide-react', () => ({
  Plus: () => null,
  Save: () => null,
  Trash2: () => null,
}));

import API from '../../../api';
import M3UGroupRules from '../M3UGroupRules';

describe('M3UGroupRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getM3UGroupRules.mockResolvedValue([
      {
        id: 5,
        scope: 'movie',
        match_field: 'group_name',
        match_mode: 'any',
        regex_pattern: '^GERMANY',
        exclude_regex_pattern: '',
        action: 'enable',
        case_sensitive: false,
        enabled: true,
        order: 10,
        metadata_defaults: {},
      },
    ]);
    API.updateM3UGroupRule.mockImplementation(
      async (_account, _id, payload) => ({
        id: 5,
        ...payload,
      })
    );
  });

  it('loads and saves an edited future-discovery rule', async () => {
    render(<M3UGroupRules accountId={49} scope="movie" />);

    const regex = await screen.findByLabelText('Include regular expression');
    fireEvent.change(regex, { target: { value: '^(GERMANY|DE)' } });
    fireEvent.click(screen.getByLabelText('Save rule'));

    await waitFor(() =>
      expect(API.updateM3UGroupRule).toHaveBeenCalledWith(
        49,
        5,
        expect.objectContaining({
          scope: 'movie',
          regex_pattern: '^(GERMANY|DE)',
          action: 'enable',
        })
      )
    );
  });
});
