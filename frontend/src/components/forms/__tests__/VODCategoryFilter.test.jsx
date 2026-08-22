import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../store/useVODStore', () => ({ default: vi.fn() }));
vi.mock('../../../api', () => ({
  default: {
    bulkUpdateVODCategoryMetadata: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('../../../utils/notificationUtils', () => ({
  showNotification: vi.fn(),
}));

vi.mock('@mantine/core', () => ({
  Button: ({ children, onClick, disabled }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Checkbox: ({ label, checked, onChange, disabled, ...props }) => (
    <label>
      <input
        type="checkbox"
        aria-label={props['aria-label'] || label}
        checked={checked ?? false}
        disabled={disabled}
        onChange={(event) =>
          onChange?.({ currentTarget: { checked: event.target.checked } })
        }
      />
      {label}
    </label>
  ),
  Flex: ({ children }) => <div>{children}</div>,
  Group: ({ children }) => <div>{children}</div>,
  Modal: ({ opened, children, title }) =>
    opened ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
  SegmentedControl: ({ value, onChange, data }) => (
    <div>
      {data.map((item) => (
        <button
          key={item.value}
          data-testid={`segment-${item.value}`}
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
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
  Stack: ({ children }) => <div>{children}</div>,
  Table: ({ children }) => <table>{children}</table>,
  TableTbody: ({ children }) => <tbody>{children}</tbody>,
  TableTd: ({ children }) => <td>{children}</td>,
  TableTh: ({ children }) => <th>{children}</th>,
  TableThead: ({ children }) => <thead>{children}</thead>,
  TableTr: ({ children }) => <tr>{children}</tr>,
  TagsInput: ({ label, value = [], onChange }) => (
    <input
      aria-label={label}
      value={value.join(',')}
      onChange={(event) =>
        onChange(event.target.value.split(',').filter(Boolean))
      }
    />
  ),
  Text: ({ children }) => <span>{children}</span>,
  TextInput: ({ label, value, onChange, placeholder }) => (
    <input
      aria-label={label || placeholder}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  ),
}));

import API from '../../../api';
import useVODStore from '../../../store/useVODStore';
import VODCategoryFilter from '../VODCategoryFilter';

const categories = {
  1: {
    id: 1,
    name: 'Action',
    category_type: 'movie',
    m3u_accounts: [
      {
        id: 101,
        m3u_account: 10,
        enabled: true,
        metadata_defaults: { audio_languages: ['ger'] },
      },
    ],
  },
  2: {
    id: 2,
    name: 'Comedy',
    category_type: 'movie',
    m3u_accounts: [
      { id: 102, m3u_account: 10, enabled: false, metadata_defaults: {} },
    ],
  },
  3: {
    id: 3,
    name: 'Drama',
    category_type: 'movie',
    m3u_accounts: [
      { id: 103, m3u_account: 10, enabled: true, metadata_defaults: {} },
    ],
  },
  4: {
    id: 4,
    name: 'News',
    category_type: 'series',
    m3u_accounts: [
      { id: 104, m3u_account: 10, enabled: true, metadata_defaults: {} },
    ],
  },
};

const Wrapper = ({ initialAutoEnable = true }) => {
  const [categoryStates, setCategoryStates] = useState([]);
  const [autoEnable, setAutoEnable] = useState(initialAutoEnable);

  return (
    <VODCategoryFilter
      playlist={{ id: 10, name: 'Provider' }}
      categoryStates={categoryStates}
      setCategoryStates={setCategoryStates}
      type="movie"
      autoEnableNewGroups={autoEnable}
      setAutoEnableNewGroups={setAutoEnable}
    />
  );
};

describe('VODCategoryFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useVODStore).mockImplementation((selector) =>
      selector({ categories })
    );
  });

  it('renders categories as a searchable table with metadata columns', () => {
    render(<Wrapper />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Comedy')).toBeInTheDocument();
    expect(screen.queryByText('News')).not.toBeInTheDocument();
    expect(screen.getByText('Default audio')).toBeInTheDocument();
    expect(screen.getByText('ger')).toBeInTheDocument();
  });

  it('filters categories by text and enabled state', () => {
    render(<Wrapper />);

    fireEvent.change(screen.getByPlaceholderText('Filter categories...'), {
      target: { value: 'com' },
    });
    expect(screen.getByText('Comedy')).toBeInTheDocument();
    expect(screen.queryByText('Action')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Filter categories...'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('segment-disabled'));
    expect(screen.getByText('Comedy')).toBeInTheDocument();
    expect(screen.queryByText('Action')).not.toBeInTheDocument();
  });

  it('updates a single category through its enabled checkbox', () => {
    render(<Wrapper />);

    expect(screen.getByLabelText('Enable Comedy')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Enable Comedy'));
    expect(screen.getByLabelText('Enable Comedy')).toBeChecked();
  });

  it('selects visible rows and applies bulk enable/disable changes', () => {
    render(<Wrapper />);

    fireEvent.click(screen.getByLabelText('Select visible categories'));
    fireEvent.click(screen.getByText('Disable selected'));
    expect(screen.getByLabelText('Enable Action')).not.toBeChecked();
    expect(screen.getByLabelText('Enable Comedy')).not.toBeChecked();
    expect(screen.getByLabelText('Enable Drama')).not.toBeChecked();

    fireEvent.click(screen.getByText('Enable selected'));
    expect(screen.getByLabelText('Enable Action')).toBeChecked();
    expect(screen.getByLabelText('Enable Comedy')).toBeChecked();
    expect(screen.getByLabelText('Enable Drama')).toBeChecked();
  });

  it('bulk edits category metadata with one API request', async () => {
    render(<Wrapper />);

    fireEvent.click(screen.getByLabelText('Select Action'));
    fireEvent.click(screen.getByLabelText('Select Comedy'));
    fireEvent.click(screen.getByText('Edit metadata (2)'));
    fireEvent.change(screen.getByLabelText('Audio languages'), {
      target: { value: 'ger,eng' },
    });
    fireEvent.change(screen.getByLabelText('Subtitle languages'), {
      target: { value: 'ger' },
    });
    fireEvent.change(screen.getByLabelText('Expected maximum resolution'), {
      target: { value: '1080p' },
    });
    fireEvent.click(screen.getByText('Apply to selected'));

    await waitFor(() =>
      expect(API.bulkUpdateVODCategoryMetadata).toHaveBeenCalledWith(
        [101, 102],
        {
          audio_languages: ['ger', 'eng'],
          subtitle_languages: ['ger'],
          resolution: '1080p',
        }
      )
    );
  });

  it('keeps the automatic-discovery default editable', () => {
    render(<Wrapper initialAutoEnable={false} />);

    const checkbox = screen.getByLabelText(
      /automatically enable new movie categories/i
    );
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});
