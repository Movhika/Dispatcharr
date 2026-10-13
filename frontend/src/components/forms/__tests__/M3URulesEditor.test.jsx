import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3URulesEditor from '../M3URulesEditor.jsx';
import API from '../../../api.js';

vi.mock('../../../api.js', () => ({
  default: {
    getM3URules: vi.fn(),
    saveM3URule: vi.fn(),
    deleteM3URule: vi.fn(),
    previewM3URules: vi.fn(),
    reorderM3URules: vi.fn(),
    saveApplyM3UGroupRules: vi.fn(),
  },
}));
vi.mock('../../../utils/notificationUtils.js', () => ({
  showNotification: vi.fn(),
}));
vi.mock('../../../utils/dateTimeUtils.js', () => ({
  useDateTimeFormat: () => ({
    dateYearFormat: 'DD.MM.YYYY',
    timeFormat: 'HH:mm',
  }),
  useTimeHelpers: () => ({
    toUserTime: () => ({ format: () => '14.10.2026 08:00' }),
  }),
}));
vi.mock('../../ConfirmationDialog.jsx', () => ({
  default: ({ opened, onConfirm, onClose }) =>
    opened ? (
      <div role="alertdialog">
        <button onClick={onConfirm}>Confirm delete</button>
        <button onClick={onClose}>Cancel delete</button>
      </div>
    ) : null,
}));
vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal()),
  DndContext: ({ children, onDragEnd }) => (
    <div>
      {children}
      <button onClick={() => onDragEnd({ active: { id: 2 }, over: { id: 1 } })}>
        Move second first
      </button>
    </div>
  ),
}));

const rule = (values = {}) => ({
  id: 1,
  scope: 'live',
  match_field: 'group_name',
  match_mode: 'any',
  regex_pattern: 'News',
  action: 'enable',
  case_sensitive: false,
  enabled: true,
  order: 0,
  ...values,
});
const renderEditor = (props = {}) =>
  render(
    <MantineProvider>
      <M3URulesEditor accountId={7} scope="live" {...props} />
    </MantineProvider>
  );
const load = async (rows = [rule()]) => {
  API.getM3URules.mockResolvedValue(rows);
  renderEditor();
  await screen.findByDisplayValue(rows[0].regex_pattern);
};

describe('M3URulesEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getM3URules.mockResolvedValue([]);
    API.previewM3URules.mockResolvedValue({
      count: 1,
      results: [
        {
          name: 'News',
          currently_enabled: false,
          would_enable: true,
          item_count: 3,
        },
      ],
    });
    API.saveM3URule.mockResolvedValue(rule());
    API.saveApplyM3UGroupRules.mockResolvedValue({
      updated: 1,
      target_ids: [9],
      scope: 'live',
      enabled: true,
    });
  });
  it('loads only the selected account and scope', async () => {
    await load();
    expect(API.getM3URules).toHaveBeenCalledWith(7, 'group-rules', 'live');
  });
  it('saves future policy without applying it or refreshing', async () => {
    await load();
    fireEvent.change(screen.getByLabelText('Regular expression'), {
      target: { value: 'Sport' },
    });
    fireEvent.click(screen.getByLabelText('Save rule'));
    await waitFor(() =>
      expect(API.saveM3URule).toHaveBeenCalledWith(
        7,
        'group-rules',
        1,
        expect.objectContaining({ regex_pattern: 'Sport' })
      )
    );
    expect(API.saveApplyM3UGroupRules).not.toHaveBeenCalled();
  });
  it('keeps a blank-pattern error and never submits it', async () => {
    renderEditor();
    await waitFor(() => expect(API.getM3URules).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Add rule'));
    fireEvent.click(screen.getByLabelText('Save rule'));
    expect(
      await screen.findByText(
        'Enter a regular expression before saving or previewing.'
      )
    ).toBeInTheDocument();
    expect(API.saveM3URule).not.toHaveBeenCalled();
  });
  it('previews the complete unsaved ordered draft without saving', async () => {
    await load([rule(), rule({ id: 2, order: 1, regex_pattern: 'Sport' })]);
    fireEvent.change(screen.getAllByLabelText('Regular expression')[0], {
      target: { value: '^Changed$' },
    });
    fireEvent.click(screen.getAllByLabelText('Preview rule')[1]);
    await screen.findByText('1 matching existing entries');
    expect(API.previewM3URules).toHaveBeenCalledWith(
      7,
      'group-rules',
      [
        expect.objectContaining({
          preview_id: '1',
          regex_pattern: '^Changed$',
        }),
        expect.objectContaining({ preview_id: '2', regex_pattern: 'Sport' }),
      ],
      2,
      1,
      50
    );
    expect(API.saveM3URule).not.toHaveBeenCalled();
  });
  it('supports previewing a newly added rule', async () => {
    renderEditor();
    await waitFor(() => expect(API.getM3URules).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Add rule'));
    fireEvent.change(screen.getByLabelText('Regular expression'), {
      target: { value: '###' },
    });
    fireEvent.click(screen.getByLabelText('Preview rule'));
    await screen.findByText('1 matching existing entries');
    expect(API.previewM3URules.mock.calls[0][2][0]).toEqual(
      expect.objectContaining({
        preview_id: expect.stringMatching(/^new-/),
        regex_pattern: '###',
      })
    );
    expect(API.saveM3URule).not.toHaveBeenCalled();
  });
  it('saves and applies precisely the previewed snapshot', async () => {
    await load();
    fireEvent.click(screen.getByLabelText('Preview rule'));
    await screen.findByText('1 matching existing entries');
    fireEvent.click(screen.getByText('Save and apply to existing'));
    await waitFor(() =>
      expect(API.saveApplyM3UGroupRules).toHaveBeenCalledWith(
        7,
        [expect.objectContaining({ preview_id: '1', regex_pattern: 'News' })],
        1
      )
    );
  });
  it('does not apply ignored groups to existing selections', async () => {
    await load([rule({ action: 'ignore' })]);
    fireEvent.click(screen.getByLabelText('Preview rule'));
    await screen.findByText('1 matching existing entries');
    expect(
      screen.getByRole('button', { name: 'Save and apply to existing' })
    ).toBeDisabled();
  });
  it('reorders only IDs and positions, not unsaved rule contents', async () => {
    await load([rule(), rule({ id: 2, order: 1, regex_pattern: 'Sport' })]);
    fireEvent.change(screen.getAllByLabelText('Regular expression')[0], {
      target: { value: 'Unsaved' },
    });
    fireEvent.click(screen.getByText('Move second first'));
    await waitFor(() =>
      expect(API.reorderM3URules).toHaveBeenCalledWith(
        7,
        'group-rules',
        [2, 1],
        'live',
        [0, 1]
      )
    );
    expect(API.saveM3URule).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText('Regular expression')[1]).toHaveValue(
      'Unsaved'
    );
  });
  it('requires confirmation before deleting a saved rule', async () => {
    await load();
    fireEvent.click(screen.getByLabelText('Delete rule'));
    expect(API.deleteM3URule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm delete'));
    await waitFor(() =>
      expect(API.deleteM3URule).toHaveBeenCalledWith(7, 'group-rules', 1)
    );
  });
  it('paginates beyond the former first-200 limit', async () => {
    await load();
    API.previewM3URules.mockResolvedValue({ count: 250, results: [] });
    fireEvent.click(screen.getByLabelText('Preview rule'));
    await screen.findByText('250 matching existing entries');
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '5' })
    );
    await waitFor(() =>
      expect(API.previewM3URules).toHaveBeenLastCalledWith(
        7,
        'group-rules',
        expect.any(Array),
        1,
        5,
        50
      )
    );
  });
  it('uses the persisted pre-filter catalog for stream filters', async () => {
    API.getM3URules.mockResolvedValue([
      {
        id: 1,
        filter_type: 'name',
        regex_pattern: '###',
        exclude: true,
        order: 0,
        custom_properties: { case_sensitive: false },
      },
    ]);
    API.previewM3URules.mockResolvedValue({
      count: 1,
      inventory_count: 10,
      catalog_complete: true,
      last_completed_refresh: '2026-10-14T06:00:00Z',
      results: [{ name: '### Event', group: 'Events', result: 'exclude' }],
    });
    renderEditor({ streamFilters: true, scope: undefined });
    await screen.findByDisplayValue('###');
    fireEvent.click(screen.getByLabelText('Preview rule'));
    expect(
      await screen.findByText(/Excluded streams remain available/)
    ).toBeInTheDocument();
    expect(screen.getByText('### Event')).toBeInTheDocument();
    expect(
      screen.queryByText('Save and apply to existing')
    ).not.toBeInTheDocument();
  });
});
