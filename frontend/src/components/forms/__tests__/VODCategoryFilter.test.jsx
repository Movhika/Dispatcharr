import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Store mock ─────────────────────────────────────────────────────────────────
vi.mock('../M3UGroupContentPreview.jsx', () => ({ default: () => null }));
vi.mock('../../ListPagination.jsx', () => ({ default: () => null }));
vi.mock('../../../store/useVODStore', () => ({ default: vi.fn() }));

// ── lucide-react ───────────────────────────────────────────────────────────────
vi.mock('lucide-react', () => ({
  Eye: () => <svg />,
  Settings: () => <svg />,
  CircleCheck: () => <svg data-testid="icon-circle-check" />,
  CircleX: () => <svg data-testid="icon-circle-x" />,
}));

// ── Mantine core ───────────────────────────────────────────────────────────────
vi.mock('@mantine/core', () => ({
  Badge: ({ children, color, variant }) => (
    <span data-color={color} data-variant={variant}>
      {children}
    </span>
  ),
  Modal: ({ children, opened, title }) =>
    opened ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
  Table: ({ children }) => <table>{children}</table>,
  TableThead: ({ children }) => <thead>{children}</thead>,
  TableTbody: ({ children }) => <tbody>{children}</tbody>,
  TableTr: ({ children }) => <tr>{children}</tr>,
  TableTh: ({ children }) => <th>{children}</th>,
  TableTd: ({ children }) => <td>{children}</td>,
  ScrollArea: ({ children }) => <div>{children}</div>,
  Tooltip: ({ children }) => <>{children}</>,
  ActionIcon: ({ children, onClick, ...props }) => (
    <button aria-label={props['aria-label']} onClick={onClick}>
      {children}
    </button>
  ),
  Box: ({ children }) => <div>{children}</div>,
  Button: ({ children, onClick, disabled, color, variant }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-color={color}
      data-variant={variant}
    >
      {children}
    </button>
  ),
  Checkbox: ({
    label,
    checked,
    onChange,
    disabled,
    'aria-label': ariaLabel,
  }) => (
    <label>
      <input
        type="checkbox"
        aria-label={ariaLabel || label}
        checked={checked}
        onChange={(e) =>
          onChange?.({ currentTarget: { checked: e.target.checked } })
        }
        disabled={disabled}
      />
      {label}
    </label>
  ),
  Flex: ({ children }) => <div>{children}</div>,
  Group: ({ children }) => <div>{children}</div>,
  SimpleGrid: ({ children }) => <div data-testid="simple-grid">{children}</div>,
  Stack: ({ children }) => <div>{children}</div>,
  Text: ({ children }) => <span>{children}</span>,
  TextInput: ({ label, value, onChange, placeholder }) => (
    <input
      aria-label={label ?? placeholder}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  ),
  SegmentedControl: ({ value, onChange, data }) => (
    <div data-testid="segmented-control">
      {data.map((item) => (
        <button
          key={item.value ?? item}
          data-testid={`segment-${item.value ?? item}`}
          onClick={() => onChange(item.value ?? item)}
          data-active={value === (item.value ?? item) ? 'true' : 'false'}
        >
          {item.label ?? item}
        </button>
      ))}
    </div>
  ),
  Select: ({
    label,
    value,
    onChange,
    data = [],
    placeholder,
    'aria-label': ariaLabel,
  }) => (
    <label>
      {label}
      <select
        aria-label={ariaLabel ?? label}
        value={value ?? ''}
        onChange={(e) => {
          const next = e.target.value;
          onChange?.(next === '' ? null : next);
        }}
      >
        <option value="">{placeholder}</option>
        {data.map((item) => (
          <option key={item.value ?? item} value={item.value ?? item}>
            {item.label ?? item}
          </option>
        ))}
      </select>
    </label>
  ),
}));

// ── Imports after mocks ────────────────────────────────────────────────────────
import useVODStore from '../../../store/useVODStore';
import VODCategoryFilter from '../VODCategoryFilter';

// ── Helpers ────────────────────────────────────────────────────────────────────
const makeCategories = () => [
  {
    id: 1,
    name: 'Action',
    m3u_accounts: [
      {
        m3u_account: 10,
        enabled: true,
        custom_properties: { language: 'en', quality: '1080p' },
      },
    ],
    category_type: 'movie',
  },
  {
    id: 2,
    name: 'Comedy',
    m3u_accounts: [{ m3u_account: 10, enabled: false }],
    category_type: 'movie',
  },
  {
    id: 3,
    name: 'Drama',
    m3u_accounts: [{ m3u_account: 10, enabled: true }],
    category_type: 'movie',
  },
  {
    id: 4,
    name: 'News',
    m3u_accounts: [{ m3u_account: 10, enabled: true }],
    category_type: 'series',
  },
];

const makePlaylist = (overrides = {}) => ({
  id: 10,
  name: 'My Playlist',
  ...overrides,
});

const categoriesToDict = (arr) =>
  arr.reduce((acc, cat) => ({ ...acc, [cat.id]: cat }), {});

const setupMocks = ({ categories = makeCategories() } = {}) => {
  const dict = Array.isArray(categories)
    ? categoriesToDict(categories)
    : categories;
  vi.mocked(useVODStore).mockImplementation((sel) => sel({ categories: dict }));
};

const defaultProps = (overrides = {}) => {
  return {
    playlist: makePlaylist(),
    categoryStates: [
      {
        id: 1,
        name: 'Action',
        enabled: true,
        custom_properties: { language: 'en', quality: '1080p' },
      },
      { id: 2, name: 'Comedy', enabled: false, custom_properties: {} },
      { id: 3, name: 'Drama', enabled: true, custom_properties: {} },
    ],
    setCategoryStates: vi.fn(),
    type: 'movie',
    autoEnableNewGroups: true,
    setAutoEnableNewGroups: vi.fn(),
    ...overrides,
  };
};

// setCategoryStates may receive an array or a functional updater.
const latestCategoryStates = (setCategoryStates, previous) => {
  const next = setCategoryStates.mock.calls.at(-1)[0];
  return typeof next === 'function' ? next(previous) : next;
};

// ──────────────────────────────────────────────────────────────────────────────

describe('VODCategoryFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it('renders without crashing', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('renders a text label for each category matching the type and playlist', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      expect(screen.getByText('Action')).toBeInTheDocument();
      expect(screen.getByText('Comedy')).toBeInTheDocument();
    });

    it('does not render categories of a different type', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      expect(
        screen.queryByRole('checkbox', { name: 'News' })
      ).not.toBeInTheDocument();
    });

    it('renders the text filter input', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      expect(screen.getByPlaceholderText(/filter/i)).toBeInTheDocument();
    });

    it('renders the segmented status control', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      expect(screen.getByTestId('segmented-control')).toBeInTheDocument();
    });

    it('requires a selection before bulk actions', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      expect(screen.getByText('Enable selected')).toBeDisabled();
      expect(screen.getByText('Disable selected')).toBeDisabled();
    });

    it('explains that new categories require an import rule or manual selection', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      expect(
        screen.getByText('New unmatched categories are imported disabled.')
      ).toBeInTheDocument();
    });
  });

  // ── Text filter ───────────────────────────────────────────────────────────

  describe('text filter', () => {
    it('hides categories that do not match the filter', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      const input = screen.getByPlaceholderText(/filter/i);
      fireEvent.change(input, { target: { value: 'act' } });
      expect(screen.getByText('Action')).toBeInTheDocument();
      expect(screen.queryByText('Comedy')).not.toBeInTheDocument();
    });

    it('is case-insensitive', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      fireEvent.change(screen.getByPlaceholderText(/filter/i), {
        target: { value: 'COMEDY' },
      });
      expect(screen.getByText('Comedy')).toBeInTheDocument();
      expect(screen.queryByText('Action')).not.toBeInTheDocument();
    });

    it('shows all categories when filter is cleared', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      const input = screen.getByPlaceholderText(/filter/i);
      fireEvent.change(input, { target: { value: 'act' } });
      fireEvent.change(input, { target: { value: '' } });
      expect(screen.getByText('Action')).toBeInTheDocument();
      expect(screen.getByText('Comedy')).toBeInTheDocument();
      expect(screen.getByText('Drama')).toBeInTheDocument();
    });

    it('shows no categories when filter matches nothing', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      fireEvent.change(screen.getByPlaceholderText(/filter/i), {
        target: { value: 'zzznomatch' },
      });
      expect(screen.queryByText('Action')).not.toBeInTheDocument();
    });
  });

  // ── Status filter ─────────────────────────────────────────────────────────

  describe('status filter', () => {
    it('shows only enabled categories when "Enabled" segment is selected', () => {
      const props = defaultProps({
        categoryStates: [
          { id: 1, name: 'Action', enabled: true },
          { id: 2, name: 'Comedy', enabled: false },
          { id: 3, name: 'Drama', enabled: true },
        ],
      });
      render(<VODCategoryFilter {...props} />);
      fireEvent.click(screen.getByTestId('segment-enabled'));
      expect(screen.getByText('Action')).toBeInTheDocument();
      expect(screen.queryByText('Comedy')).not.toBeInTheDocument();
      expect(screen.getByText('Drama')).toBeInTheDocument();
    });

    it('shows only disabled categories when "Disabled" segment is selected', () => {
      const props = defaultProps({
        categoryStates: [
          { id: 1, name: 'Action', enabled: true },
          { id: 2, name: 'Comedy', enabled: false },
          { id: 3, name: 'Drama', enabled: true },
        ],
      });
      render(<VODCategoryFilter {...props} />);
      fireEvent.click(screen.getByTestId('segment-disabled'));
      expect(screen.queryByText('Action')).not.toBeInTheDocument();
      expect(screen.getByText('Comedy')).toBeInTheDocument();
    });

    it('shows all categories when "All" segment is active', () => {
      const props = defaultProps({
        categoryStates: [
          { id: 1, name: 'Action', enabled: true },
          { id: 2, name: 'Comedy', enabled: false },
          { id: 3, name: 'Drama', enabled: true },
        ],
      });
      render(<VODCategoryFilter {...props} />);
      fireEvent.click(screen.getByTestId('segment-disabled'));
      fireEvent.click(screen.getByTestId('segment-all'));
      expect(screen.getByText('Action')).toBeInTheDocument();
      expect(screen.getByText('Comedy')).toBeInTheDocument();
    });
  });

  // ── Combined filters ──────────────────────────────────────────────────────

  describe('combined text + status filters', () => {
    it('applies both text and status filters simultaneously', () => {
      const props = defaultProps();
      render(<VODCategoryFilter {...props} />);
      fireEvent.change(screen.getByPlaceholderText(/filter/i), {
        target: { value: 'o' },
      });
      fireEvent.click(screen.getByTestId('segment-disabled'));
      // "Comedy" matches "o" AND is disabled; "Action" matches "o" but is enabled
      expect(screen.getByText('Comedy')).toBeInTheDocument();
      expect(screen.queryByText('Action')).not.toBeInTheDocument();
    });
  });

  // ── Enable All / Disable All ──────────────────────────────────────────────

  describe('Enable All button', () => {
    it('calls setCategoryStates with all visible categories set to true', () => {
      const setCategoryStates = vi.fn();
      const categoryStates = [
        { id: 1, name: 'Action', enabled: false },
        { id: 2, name: 'Comedy', enabled: false },
        { id: 3, name: 'Drama', enabled: false },
      ];
      render(
        <VODCategoryFilter
          {...defaultProps({ setCategoryStates, categoryStates })}
        />
      );
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Select visible categories' })
      );
      fireEvent.click(screen.getByText('Enable selected'));
      const called = latestCategoryStates(setCategoryStates, categoryStates);
      expect(called.find((s) => s.id === 1).enabled).toBe(true);
      expect(called.find((s) => s.id === 2).enabled).toBe(true);
      expect(called.find((s) => s.id === 3).enabled).toBe(true);
    });

    it('only enables filtered categories when a text filter is active', () => {
      const setCategoryStates = vi.fn();
      const categoryStates = [
        { id: 1, name: 'Action', enabled: false },
        { id: 2, name: 'Comedy', enabled: false },
        { id: 3, name: 'Drama', enabled: false },
      ];
      render(
        <VODCategoryFilter
          {...defaultProps({ setCategoryStates, categoryStates })}
        />
      );
      fireEvent.change(screen.getByPlaceholderText(/filter/i), {
        target: { value: 'act' },
      });
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Select visible categories' })
      );
      fireEvent.click(screen.getByText('Enable selected'));
      const called = latestCategoryStates(setCategoryStates, categoryStates);
      expect(called.find((s) => s.id === 1).enabled).toBe(true);
      // Comedy and Drama were filtered out — their state should be unchanged
      expect(called.find((s) => s.id === 2).enabled).toBe(false);
      expect(called.find((s) => s.id === 3).enabled).toBe(false);
    });
  });

  describe('Disable All button', () => {
    it('calls setCategoryStates with all visible categories set to false', () => {
      const setCategoryStates = vi.fn();
      const props = defaultProps({ setCategoryStates });
      render(<VODCategoryFilter {...props} />);
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Select visible categories' })
      );
      fireEvent.click(screen.getByText('Disable selected'));
      const called = latestCategoryStates(
        setCategoryStates,
        props.categoryStates
      );
      expect(called.find((s) => s.id === 1).enabled).toBe(false);
      expect(called.find((s) => s.id === 2).enabled).toBe(false);
      expect(called.find((s) => s.id === 3).enabled).toBe(false);
    });

    it('only disables filtered categories when a text filter is active', () => {
      const setCategoryStates = vi.fn();
      const categoryStates = [
        { id: 1, name: 'Action', enabled: true },
        { id: 2, name: 'Comedy', enabled: true },
        { id: 3, name: 'Drama', enabled: true },
      ];
      render(
        <VODCategoryFilter
          {...defaultProps({ setCategoryStates, categoryStates })}
        />
      );
      fireEvent.change(screen.getByPlaceholderText(/filter/i), {
        target: { value: 'comedy' },
      });
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Select visible categories' })
      );
      fireEvent.click(screen.getByText('Disable selected'));
      const called = latestCategoryStates(setCategoryStates, categoryStates);
      expect(called.find((s) => s.id === 2).enabled).toBe(false);
      expect(called.find((s) => s.id === 1).enabled).toBe(true);
      expect(called.find((s) => s.id === 3).enabled).toBe(true);
    });
  });

  // ── Auto-enable new groups ────────────────────────────────────────────────

  describe('selection and bulk settings', () => {
    it('clears a selection when switching accounts', () => {
      const props = defaultProps();
      const view = render(<VODCategoryFilter {...props} />);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Action' }));
      expect(screen.getByText('Edit settings (1)')).toBeEnabled();
      view.rerender(
        <VODCategoryFilter {...props} playlist={makePlaylist({ id: 11 })} />
      );
      expect(screen.getByText('Edit settings (0)')).toBeDisabled();
    });
    it('selection alone never changes enabled or category metadata', () => {
      const setCategoryStates = vi.fn();
      render(<VODCategoryFilter {...defaultProps({ setCategoryStates })} />);
      setCategoryStates.mockClear();
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Select visible categories' })
      );
      expect(setCategoryStates).not.toHaveBeenCalled();
      expect(screen.getByText('Edit settings (3)')).toBeEnabled();
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Select visible categories' })
      );
      expect(screen.getByText('Edit settings (0)')).toBeDisabled();
    });

    it('bulk updates only selected categories and preserves unrelated properties', () => {
      const setCategoryStates = vi.fn();
      const categoryStates = [
        {
          id: 1,
          name: 'Action',
          enabled: true,
          custom_properties: {
            language: 'en',
            quality: '1080p',
            custom: 'keep',
          },
        },
        {
          id: 2,
          name: 'Comedy',
          enabled: false,
          custom_properties: { language: 'fr' },
        },
      ];
      render(
        <VODCategoryFilter
          {...defaultProps({ setCategoryStates, categoryStates })}
        />
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Action' }));
      fireEvent.click(screen.getByText('Edit settings (1)'));
      const dialog = screen.getByRole('dialog', {
        name: 'Edit settings for 1 categories',
      });
      fireEvent.change(within(dialog).getByLabelText('Language'), {
        target: { value: 'de' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
      const next = latestCategoryStates(setCategoryStates, categoryStates);
      expect(next[0].custom_properties).toEqual({
        language: 'de',
        quality: '1080p',
        custom: 'keep',
      });
      expect(next[1]).toBe(categoryStates[1]);
      expect(next[0].enabled).toBe(true);
    });

    it('canceling a bulk edit does not change the draft', () => {
      const setCategoryStates = vi.fn();
      render(<VODCategoryFilter {...defaultProps({ setCategoryStates })} />);
      setCategoryStates.mockClear();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Action' }));
      fireEvent.click(screen.getByText('Edit settings (1)'));
      const dialog = screen.getByRole('dialog', {
        name: 'Edit settings for 1 categories',
      });
      fireEvent.change(within(dialog).getByLabelText('Quality'), {
        target: { value: 'clear' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(setCategoryStates).not.toHaveBeenCalled();
    });
  });

  describe('new category defaults', () => {
    it('does not expose the legacy fallback when previously disabled', () => {
      const setAutoEnableNewGroups = vi.fn();
      render(
        <VODCategoryFilter
          {...defaultProps({
            autoEnableNewGroups: false,
            setAutoEnableNewGroups,
          })}
        />
      );
      expect(
        screen.queryByLabelText(/enable unmatched new/i)
      ).not.toBeInTheDocument();
      expect(setAutoEnableNewGroups).not.toHaveBeenCalled();
    });

    it('does not expose the legacy fallback when previously enabled', () => {
      const setAutoEnableNewGroups = vi.fn();
      render(
        <VODCategoryFilter
          {...defaultProps({
            autoEnableNewGroups: true,
            setAutoEnableNewGroups,
          })}
        />
      );
      expect(
        screen.queryByLabelText(/enable unmatched new/i)
      ).not.toBeInTheDocument();
      expect(setAutoEnableNewGroups).not.toHaveBeenCalled();
    });
  });

  // ── No playlist / empty categories ───────────────────────────────────────

  describe('edge cases', () => {
    it('renders no category buttons when categories list is empty', () => {
      setupMocks({ categories: [] });
      render(<VODCategoryFilter {...defaultProps({ categoryStates: [] })} />);
      expect(screen.queryByText('Action')).not.toBeInTheDocument();
    });

    it('renders no category buttons when categoryStates is empty', () => {
      render(<VODCategoryFilter {...defaultProps({ categoryStates: [] })} />);
      expect(screen.queryByText('Action')).not.toBeInTheDocument();
    });

    it('renders categories only for the matching playlist id', () => {
      setupMocks({
        categories: [
          ...makeCategories(),
          {
            id: 99,
            name: 'Foreign',
            m3u_accounts: [{ m3u_account: 99, enabled: true }],
            category_type: 'movie',
          },
        ],
      });
      render(<VODCategoryFilter {...defaultProps()} />);
      expect(
        screen.queryByRole('button', { name: 'Foreign' })
      ).not.toBeInTheDocument();
    });
  });

  // ── Language / quality ────────────────────────────────────────────────────

  describe('language and quality selects', () => {
    it('cancel restores only the edited category and Done keeps the draft', () => {
      const StatefulFilter = () => {
        const [categoryStates, setCategoryStates] = useState(
          defaultProps().categoryStates
        );
        return (
          <VODCategoryFilter
            {...defaultProps({ categoryStates, setCategoryStates })}
          />
        );
      };
      render(<StatefulFilter />);
      fireEvent.click(screen.getByRole('button', { name: 'Configure Action' }));
      fireEvent.change(screen.getByLabelText('Language'), {
        target: { value: 'es' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByText('English (en)')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Configure Action' }));
      fireEvent.change(screen.getByLabelText('Quality'), {
        target: { value: '4K' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.getByText('4K')).toBeInTheDocument();
      expect(screen.getByText('English (en)')).toBeInTheDocument();
    });
    it('keeps selects out of rows and opens settings before preview', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      expect(screen.queryByLabelText('Language')).not.toBeInTheDocument();
      const row = screen.getByText('Action').closest('tr');
      expect(
        within(row)
          .getAllByRole('button')
          .map((button) => button.getAttribute('aria-label'))
      ).toEqual(['Configure Action', 'Preview category']);
      fireEvent.click(screen.getByRole('button', { name: 'Configure Action' }));
      expect(screen.getByLabelText('Language')).toBeInTheDocument();
      expect(screen.getByLabelText('Quality')).toBeInTheDocument();
    });

    it('loads existing language and quality from category state', () => {
      render(<VODCategoryFilter {...defaultProps()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Configure Action' }));
      expect(screen.getByLabelText('Language')).toHaveValue('en');
      expect(screen.getByLabelText('Quality')).toHaveValue('1080p');
    });

    it('updates custom_properties.language when language changes', () => {
      const setCategoryStates = vi.fn();
      const props = defaultProps({ setCategoryStates });
      render(<VODCategoryFilter {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Configure Action' }));
      fireEvent.change(screen.getByLabelText('Language'), {
        target: { value: 'es' },
      });
      const called = latestCategoryStates(
        setCategoryStates,
        props.categoryStates
      );
      expect(called.find((s) => s.id === 1).custom_properties.language).toBe(
        'es'
      );
      expect(called.find((s) => s.id === 1).custom_properties.quality).toBe(
        '1080p'
      );
    });

    it('updates custom_properties.quality when quality changes', () => {
      const setCategoryStates = vi.fn();
      const props = defaultProps({ setCategoryStates });
      render(<VODCategoryFilter {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Configure Action' }));
      fireEvent.change(screen.getByLabelText('Quality'), {
        target: { value: '4K' },
      });
      const called = latestCategoryStates(
        setCategoryStates,
        props.categoryStates
      );
      expect(called.find((s) => s.id === 1).custom_properties.quality).toBe(
        '4K'
      );
    });

    it('clears language to null when deselected', () => {
      const setCategoryStates = vi.fn();
      const props = defaultProps({ setCategoryStates });
      render(<VODCategoryFilter {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Configure Action' }));
      fireEvent.change(screen.getByLabelText('Language'), {
        target: { value: '' },
      });

      const called = latestCategoryStates(
        setCategoryStates,
        props.categoryStates
      );
      expect(called.find((s) => s.id === 1).custom_properties.language).toBe(
        null
      );
    });

    it('hydrates custom_properties from the store on mount', () => {
      const setCategoryStates = vi.fn();
      render(
        <VODCategoryFilter
          {...defaultProps({ setCategoryStates, categoryStates: [] })}
        />
      );
      expect(setCategoryStates).toHaveBeenCalled();
      const hydrated = latestCategoryStates(setCategoryStates, []);
      const action = hydrated.find((s) => s.id === 1);
      expect(action.custom_properties).toEqual({
        language: 'en',
        quality: '1080p',
      });
      expect(action.original_custom_properties).toEqual({
        language: 'en',
        quality: '1080p',
      });
      expect(action.original_enabled).toBe(true);
    });
  });
});
