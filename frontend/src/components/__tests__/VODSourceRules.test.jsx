import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  default: { previewVODAccessPolicyStreamFilter: vi.fn() },
}));
vi.mock('../LanguagePicker.jsx', () => ({
  default: () => <div>Languages</div>,
}));
vi.mock('../VideoFeaturePicker.jsx', () => ({
  default: () => <div>Features</div>,
}));
vi.mock('@dnd-kit/core', () => ({
  closestCenter: vi.fn(),
  DndContext: ({ children }) => <>{children}</>,
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));
vi.mock('@dnd-kit/sortable', () => ({
  arrayMove: vi.fn((value) => value),
  SortableContext: ({ children }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  })),
  verticalListSortingStrategy: vi.fn(),
}));
vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: vi.fn(() => '') } },
}));
vi.mock('@dnd-kit/modifiers', () => ({ restrictToVerticalAxis: vi.fn() }));
vi.mock('lucide-react', () => ({
  Eye: () => null,
  GripVertical: () => null,
  Info: () => null,
  Plus: () => null,
  Trash2: () => null,
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
    Badge: Wrapper,
    Button: ({ children, onClick }) => (
      <button onClick={onClick}>{children}</button>
    ),
    Group: Wrapper,
    Loader: () => <div>Loading</div>,
    Modal: ({ children, opened, title }) =>
      opened ? (
        <div>
          <h2>{title}</h2>
          {children}
        </div>
      ) : null,
    ScrollArea: Wrapper,
    Select: ({ value, onChange, data = [], 'aria-label': ariaLabel }) => (
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {data.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
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
    TextInput: ({ value, onChange, 'aria-label': ariaLabel }) => (
      <input aria-label={ariaLabel} value={value} onChange={onChange} />
    ),
    Tooltip: Wrapper,
  };
});

import API from '../../api.js';
import VODSourceRules from '../VODSourceRules.jsx';

describe('VODSourceRules', () => {
  const rules = [
    {
      id: 'exclude-3d',
      match_field: 'category',
      regex_pattern: '^ANIME$',
      required_audio_languages: [],
      required_subtitle_languages: [],
      required_video_features: ['3d'],
      result: 'exclude',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    API.previewVODAccessPolicyStreamFilter.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 42,
          content_type: 'movie',
          title: '3D Movie',
          m3u_account_name: 'Provider',
          category_name: 'ANIME',
          audio_languages: ['eng'],
          subtitle_languages: ['ger'],
          resolution: '1080p',
          video_features: ['3d'],
          result: 'exclude',
        },
      ],
    });
  });

  it('opens a draft preview for the clicked ordered filter', async () => {
    render(
      <VODSourceRules
        value={rules}
        onChange={vi.fn()}
        categoryRelationIds={['7', '9']}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Preview VOD stream filters' })
    );

    expect(
      await screen.findByRole('heading', {
        name: 'VOD stream filter preview',
      })
    ).toBeInTheDocument();
    expect(await screen.findByText('3D Movie')).toBeInTheDocument();
    await waitFor(() =>
      expect(API.previewVODAccessPolicyStreamFilter).toHaveBeenCalledWith({
        source_rules: expect.arrayContaining([
          expect.objectContaining({ id: 'exclude-3d' }),
        ]),
        target_rule_id: 'exclude-3d',
        category_relation_ids: ['7', '9'],
      })
    );
  });
});
