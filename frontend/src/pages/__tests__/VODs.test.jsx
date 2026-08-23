import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../store/useVODStore', () => ({ default: vi.fn() }));
vi.mock('../../store/auth', () => ({ default: vi.fn() }));
vi.mock('../../api', () => ({
  default: { bulkUpdateVODSourceMetadata: vi.fn() },
}));
vi.mock('../../utils/pages/VODsUtils.js', () => ({
  filterCategoriesToEnabled: vi.fn(() => ({})),
  getCategoryOptions: vi.fn(() => []),
}));
vi.mock('../../utils/notificationUtils', () => ({
  showNotification: vi.fn(),
}));
vi.mock('../../components/ErrorBoundary.jsx', () => ({
  default: ({ children }) => children,
}));
vi.mock('../../components/SeriesModal', () => ({
  default: ({ opened, series }) =>
    opened ? <div data-testid="series-modal">{series?.name}</div> : null,
}));
vi.mock('../../components/VODModal', () => ({
  default: ({ opened, vod }) =>
    opened ? <div data-testid="movie-modal">{vod?.name}</div> : null,
}));
vi.mock('../../components/VODSourceManagerModal', () => ({
  default: ({ opened }) =>
    opened ? <div data-testid="history-modal">History</div> : null,
}));
vi.mock('lucide-react', () => ({
  History: () => null,
  Play: () => null,
  Search: () => null,
  Wrench: () => null,
}));
vi.mock('@mantine/hooks', () => ({
  useDisclosure: (initial = false) => {
    const [opened, setOpened] = React.useState(initial);
    return [
      opened,
      { open: () => setOpened(true), close: () => setOpened(false) },
    ];
  },
}));
vi.mock('@mantine/core', () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  const Modal = ({ opened, children, title }) =>
    opened ? (
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    ) : null;
  const Select = ({ label, placeholder, value, onChange, data = [] }) => (
    <label>
      {label}
      <select
        aria-label={label || placeholder}
        value={value || ''}
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
    ActionIcon: ({ children, onClick, 'aria-label': ariaLabel }) => (
      <button aria-label={ariaLabel} onClick={onClick}>
        {children}
      </button>
    ),
    Box: Wrapper,
    Button: ({ children, onClick, disabled, loading }) => (
      <button onClick={onClick} disabled={disabled || loading}>
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
    Flex: Wrapper,
    Group: Wrapper,
    Image: ({ src }) => <img src={src} />,
    Loader: () => <div data-testid="loader" />,
    LoadingOverlay: () => null,
    Modal,
    Pagination: ({ value, onChange, total }) => (
      <button data-testid="pagination" onClick={() => onChange(value + 1)}>
        {total}
      </button>
    ),
    SegmentedControl: ({ value, onChange, data }) => (
      <div>
        {data.map((item) => (
          <button
            key={item.value}
            data-active={value === item.value}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    ),
    Select,
    Stack: Wrapper,
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
    TextInput: ({ value, onChange, placeholder }) => (
      <input value={value} onChange={onChange} placeholder={placeholder} />
    ),
    Title: ({ children }) => <h2>{children}</h2>,
  };
});

import API from '../../api';
import useAuthStore from '../../store/auth';
import useVODStore from '../../store/useVODStore';
import VODsPage from '../VODs';

describe('VODsPage list and bulk editing', () => {
  const fetchContent = vi.fn().mockResolvedValue(undefined);
  const fetchCategories = vi.fn().mockResolvedValue(undefined);
  const setFilters = vi.fn();
  const setPage = vi.fn();
  const setPageSize = vi.fn();
  const state = {
    currentPageContent: [
      { id: 1, name: 'Movie A', contentType: 'movie', year: 2025 },
      { id: 2, name: 'Series B', contentType: 'series', year: 2024 },
    ],
    categories: {},
    filters: { type: 'all', search: '', category: '' },
    currentPage: 1,
    totalCount: 30,
    pageSize: 24,
    setFilters,
    setPage,
    setPageSize,
    fetchContent,
    fetchCategories,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchContent.mockResolvedValue(undefined);
    fetchCategories.mockResolvedValue(undefined);
    API.bulkUpdateVODSourceMetadata.mockResolvedValue({ updated_sources: 3 });
    useVODStore.mockImplementation((selector) => selector(state));
    useAuthStore.mockImplementation((selector) =>
      selector({ user: { id: 1, user_level: 10 } })
    );
  });

  it('renders movies and series as list rows and loads data', async () => {
    render(<VODsPage />);
    expect(await screen.findByText('Movie A')).toBeInTheDocument();
    expect(screen.getByText('Series B')).toBeInTheDocument();
    expect(fetchCategories).toHaveBeenCalled();
    expect(fetchContent).toHaveBeenCalled();
  });

  it('opens the correct detail dialog from a row', async () => {
    render(<VODsPage />);
    await screen.findByText('Movie A');
    fireEvent.click(screen.getByLabelText('Open Movie A'));
    expect(await screen.findByTestId('movie-modal')).toHaveTextContent(
      'Movie A'
    );
    fireEvent.click(screen.getByLabelText('Open Series B'));
    expect(await screen.findByTestId('series-modal')).toHaveTextContent(
      'Series B'
    );
  });

  it('bulk-updates every source behind selected titles', async () => {
    render(<VODsPage />);
    await screen.findByText('Movie A');
    fireEvent.click(screen.getByLabelText('Select Movie A'));
    fireEvent.click(screen.getByRole('button', { name: /Edit selected/ }));
    fireEvent.change(screen.getByLabelText('Audio languages'), {
      target: { value: 'ger,eng' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply and lock' }));
    await waitFor(() =>
      expect(API.bulkUpdateVODSourceMetadata).toHaveBeenCalledWith(
        [{ content_type: 'movie', id: 1 }],
        { audio_languages: ['ger', 'eng'] }
      )
    );
  });

  it('updates search and pagination through the store', async () => {
    render(<VODsPage />);
    await screen.findByText('Movie A');
    fireEvent.change(screen.getByPlaceholderText('Search VODs...'), {
      target: { value: 'avatar' },
    });
    expect(setFilters).toHaveBeenCalledWith({ search: 'avatar' });
    fireEvent.click(screen.getByTestId('pagination'));
    expect(setPage).toHaveBeenCalledWith(2);
  });

  it('selects every VOD matching the active filters across pages', async () => {
    render(<VODsPage />);
    await screen.findByText('Movie A');
    fireEvent.click(screen.getByLabelText('Select all filtered VODs'));
    expect(
      screen.getByRole('button', { name: 'Edit selected (30)' })
    ).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit selected (30)' }));
    fireEvent.change(screen.getByLabelText('Resolution'), {
      target: { value: '1080p' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply and lock' }));
    await waitFor(() =>
      expect(API.bulkUpdateVODSourceMetadata).toHaveBeenCalledWith(
        [],
        { resolution: '1080p' },
        {
          select_all: true,
          filters: state.filters,
          exclude_selections: [],
        }
      )
    );
  });
});
