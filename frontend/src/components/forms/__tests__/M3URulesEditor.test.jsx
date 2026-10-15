import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3URulesEditor from '../M3URulesEditor.jsx';
import API from '../../../api.js';
import { showNotification } from '../../../utils/notificationUtils.js';

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
  it.each([false, true])(
    'keeps loading, saving and deleting quiet without a flashing loader (stream filters=%s)',
    async (streamFilters) => {
      let finish;
      API.getM3URules.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const saved = streamFilters
        ? rule({ filter_type: 'name', exclude: false })
        : rule();
      const { container } = renderEditor({ streamFilters });
      const add = screen.getByRole('button', {
        name: streamFilters ? 'Add filter' : 'Add rule',
      });
      const expectQuietBusy = () => {
        expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
        expect(container.querySelector('.mantine-Loader-root')).toBeNull();
        expect(add).toBeDisabled();
      };
      expectQuietBusy();
      await act(async () => finish([saved]));
      await screen.findByDisplayValue('News');
      API.saveM3URule.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      fireEvent.change(screen.getByLabelText('Regular expression'), {
        target: { value: 'Sport' },
      });
      fireEvent.click(
        screen.getByLabelText(streamFilters ? 'Save filter' : 'Save rule')
      );
      expectQuietBusy();
      await act(async () => finish({ ...saved, regex_pattern: 'Sport' }));
      API.deleteM3URule.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      fireEvent.click(
        screen.getByLabelText(streamFilters ? 'Delete filter' : 'Delete rule')
      );
      fireEvent.click(screen.getByText('Confirm delete'));
      expectQuietBusy();
      await act(async () => finish());
      expect(add).not.toBeDisabled();
    }
  );
  it.each([false, true])(
    'shows guidance and an empty-state alert without table headings (stream filters=%s)',
    async (streamFilters) => {
      renderEditor({ streamFilters });
      const empty = await screen.findByText(
        streamFilters
          ? 'No stream filters configured.'
          : 'No category filters configured.'
      );
      expect(empty.closest('[role="alert"]')).toBeInTheDocument();
      const guidance = screen
        .getByText('Order matters.')
        .closest('[role="alert"]');
      expect(guidance).toHaveAttribute('data-variant', 'light');
      expect(guidance).toHaveStyle({
        '--alert-color': 'var(--mantine-color-blue-light-color)',
      });
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
      const add = screen.getByRole('button', {
        name: streamFilters ? 'Add filter' : 'Add rule',
      });
      expect(guidance.parentElement).toBe(add.parentElement);
      expect(add.parentElement).toHaveStyle({ '--group-align': 'flex-end' });
      expect(
        guidance.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        add.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(guidance).not.toHaveTextContent(
        /category import rules remain separate|Without filters|Existing selections/
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: streamFilters ? 'Add filter' : 'Add rule',
        })
      );
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(empty).not.toBeInTheDocument();
      expect(
        add.compareDocumentPosition(screen.getByRole('table')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        screen.queryByText(
          'Save all changes before previewing. The complete ordered list affects the result.'
        )
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: streamFilters ? 'Preview filter' : 'Preview rule',
        })
      ).toBeDisabled();
    }
  );
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
  it('notifies about a blank pattern, marks its row and never submits it', async () => {
    renderEditor();
    await waitFor(() => expect(API.getM3URules).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Add rule'));
    fireEvent.click(screen.getByLabelText('Save rule'));
    expect(showNotification).toHaveBeenCalledWith({
      title: 'Import rule was not saved',
      message: 'Enter a regular expression before saving.',
      color: 'red',
    });
    expect(
      screen.queryByText('Enter a regular expression before saving.')
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Regular expression')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(
      screen.getByLabelText('Regular expression').closest('tr')
    ).toHaveAttribute('data-invalid', 'true');
    expect(API.saveM3URule).not.toHaveBeenCalled();
  });
  it('blocks every preview until changes in other rows are saved', async () => {
    await load([rule(), rule({ id: 2, order: 1, regex_pattern: 'Sport' })]);
    fireEvent.change(screen.getAllByLabelText('Regular expression')[0], {
      target: { value: '^Changed$' },
    });
    expect(
      screen
        .getAllByLabelText('Preview rule')
        .every((button) => button.disabled)
    ).toBe(true);
    expect(API.previewM3URules).not.toHaveBeenCalled();
    API.saveM3URule.mockResolvedValue(rule({ regex_pattern: '^Changed$' }));
    fireEvent.click(screen.getAllByLabelText('Save rule')[0]);
    await waitFor(() =>
      expect(screen.getAllByLabelText('Preview rule')[1]).toBeEnabled()
    );
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
    expect(API.saveM3URule).toHaveBeenCalledTimes(1);
  });
  it('requires saving a newly added rule before preview', async () => {
    renderEditor();
    await waitFor(() => expect(API.getM3URules).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Add rule'));
    expect(screen.getByLabelText('Preview rule')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Regular expression'), {
      target: { value: '###' },
    });
    expect(screen.getByLabelText('Preview rule')).toBeDisabled();
    API.saveM3URule.mockResolvedValue(rule({ id: 3, regex_pattern: '###' }));
    fireEvent.click(screen.getByLabelText('Save rule'));
    await waitFor(() =>
      expect(screen.getByLabelText('Preview rule')).toBeEnabled()
    );
    fireEvent.click(screen.getByLabelText('Preview rule'));
    await screen.findByText('1 matching existing entries');
    expect(API.previewM3URules.mock.calls[0][2][0]).toEqual(
      expect.objectContaining({
        preview_id: '3',
        regex_pattern: '###',
      })
    );
    expect(API.saveM3URule).toHaveBeenCalledTimes(1);
  });
  it('saves and applies precisely the previewed snapshot', async () => {
    await load();
    fireEvent.click(screen.getByLabelText('Preview rule'));
    await screen.findByText('1 matching existing entries');
    fireEvent.click(screen.getByText('Apply to existing'));
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
      screen.getByRole('button', { name: 'Apply to existing' })
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
    expect(
      screen.getByText('250 matching existing entries').getAttribute('style')
    ).toContain('yellow');
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
    fireEvent.click(screen.getByLabelText('Preview filter'));
    expect(
      await screen.findByText(/Excluded streams remain available/)
    ).toBeInTheDocument();
    expect(screen.getByText('### Event')).toBeInTheDocument();
    expect(screen.queryByText('Apply to existing')).not.toBeInTheDocument();
  });
  it('requires saving new stream filters and reports validation errors in a notification', async () => {
    renderEditor({ streamFilters: true });
    await waitFor(() => expect(API.getM3URules).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Add filter'));
    expect(screen.getByLabelText('Preview filter')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Save filter'));
    expect(showNotification).toHaveBeenCalledWith({
      title: 'Stream filter was not saved',
      message: 'Enter a regular expression before saving.',
      color: 'red',
    });
    expect(
      screen.queryByText('Enter a regular expression before saving.')
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Regular expression')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(API.previewM3URules).not.toHaveBeenCalled();
    expect(API.saveM3URule).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText('Regular expression')).toBeEnabled()
    );
    fireEvent.change(screen.getByLabelText('Regular expression'), {
      target: { value: '(?i)News' },
    });
    API.saveM3URule.mockResolvedValue({
      id: 3,
      filter_type: 'name',
      regex_pattern: '(?i)News',
      exclude: true,
      order: 0,
      custom_properties: { case_sensitive: false },
    });
    fireEvent.click(screen.getByLabelText('Save filter'));
    await waitFor(() =>
      expect(screen.getByLabelText('Preview filter')).toBeEnabled()
    );
    expect(API.saveM3URule).toHaveBeenCalledWith(
      7,
      'filters',
      null,
      expect.objectContaining({ regex_pattern: '(?i)News' })
    );
  });
  it('keeps the server validation marker and preview blocked without duplicating the API error notification', async () => {
    await load();
    fireEvent.change(screen.getByLabelText('Regular expression'), {
      target: { value: '[' },
    });
    API.saveM3URule.mockRejectedValue({
      status: 400,
      body: { regex_pattern: ['Invalid regular expression.'] },
    });
    fireEvent.click(screen.getByLabelText('Save rule'));
    await waitFor(() =>
      expect(screen.getByLabelText('Regular expression')).toHaveAttribute(
        'aria-invalid',
        'true'
      )
    );
    expect(
      screen.queryByText(/Invalid regular expression/)
    ).not.toBeInTheDocument();
    expect(showNotification).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Regular expression')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByLabelText('Preview rule')).toBeDisabled();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Order matters.');
  });
  it('does not show a failed evaluation as zero matches or duplicate its error', async () => {
    await load();
    API.previewM3URules.mockRejectedValue(new Error('Preview unavailable'));
    fireEvent.click(screen.getByLabelText('Preview rule'));
    await screen.findByText('Preview could not be evaluated.');
    expect(screen.queryByText('Preview unavailable')).not.toBeInTheDocument();
    expect(showNotification).not.toHaveBeenCalled();
    expect(
      screen.queryByText('0 matching existing entries')
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Preview could not be evaluated.')
    ).toBeInTheDocument();
  });
  it('unblocks saved rules after deleting an unsaved row', async () => {
    await load();
    fireEvent.click(screen.getByText('Add rule'));
    expect(screen.getAllByLabelText('Preview rule')[0]).toBeDisabled();
    fireEvent.click(screen.getAllByLabelText('Delete rule')[1]);
    fireEvent.click(screen.getByText('Confirm delete'));
    await waitFor(() =>
      expect(screen.getByLabelText('Preview rule')).toBeEnabled()
    );
    expect(API.deleteM3URule).not.toHaveBeenCalled();
  });
  it('keeps inputs locked while saving so later edits cannot be discarded', async () => {
    await load();
    let finish;
    API.saveM3URule.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    fireEvent.click(screen.getByLabelText('Save rule'));
    expect(screen.getByLabelText('Regular expression')).toBeDisabled();
    expect(
      screen
        .getAllByLabelText('Rule result')
        .find((element) => element.tagName === 'INPUT')
    ).toBeDisabled();
    finish(rule());
    await waitFor(() =>
      expect(screen.getByLabelText('Regular expression')).toBeEnabled()
    );
  });

  it.each([false, true])(
    'marks duplicate matches and notifies once without inline hints (stream filters=%s)',
    async (streamFilters) => {
      API.getM3URules.mockResolvedValue([
        rule({ filter_type: 'name' }),
        rule({ id: 2, order: 1, filter_type: 'name' }),
      ]);
      const { container } = renderEditor({ streamFilters });
      await waitFor(() =>
        expect(showNotification).toHaveBeenCalledWith({
          title: streamFilters
            ? 'Stream filter warning'
            : 'Import rule warning',
          message:
            'An identical match already exists. The first matching rule wins.',
          color: 'yellow',
        })
      );
      expect(
        container.querySelectorAll('tr[data-warning="true"]')
      ).toHaveLength(2);
      expect(
        screen.queryByText(/An identical match already exists/)
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
      fireEvent.click(
        screen.getAllByLabelText(streamFilters ? 'Save filter' : 'Save rule')[0]
      );
      await waitFor(() =>
        expect(screen.getAllByLabelText('Regular expression')[0]).toBeEnabled()
      );
      expect(
        showNotification.mock.calls.filter(
          ([notice]) => notice.color === 'yellow'
        )
      ).toHaveLength(1);
    }
  );

  it('notifies about a new catch-all hint without repeating it on unrelated edits', async () => {
    await load([rule(), rule({ id: 2, order: 1, regex_pattern: 'Sport' })]);
    expect(showNotification).not.toHaveBeenCalled();
    fireEvent.change(screen.getAllByLabelText('Regular expression')[0], {
      target: { value: '.*' },
    });
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          color: 'yellow',
          message: expect.stringContaining('Put catch-all rules last'),
        })
      )
    );
    fireEvent.click(screen.getAllByLabelText('Case sensitive')[0]);
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/Put catch-all rules last/)
    ).not.toBeInTheDocument();
  });

  it('keeps the incomplete-catalog notice in one toast when paging the preview', async () => {
    await load();
    API.previewM3URules.mockResolvedValue({
      count: 250,
      results: [],
      catalog_complete: false,
    });
    fireEvent.click(screen.getByLabelText('Preview rule'));
    await screen.findByText('250 matching existing entries');
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'yellow',
        message: expect.stringContaining('No complete group inventory'),
      })
    );
    expect(
      screen.queryByText(/No complete group inventory/)
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '5' })
    );
    await waitFor(() => expect(API.previewM3URules).toHaveBeenCalledTimes(2));
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('does not show a failed load as an empty configured list or repeat the API error inline', async () => {
    API.getM3URules.mockRejectedValue(new Error('Load unavailable'));
    const { container } = renderEditor();
    await waitFor(() =>
      expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    );
    expect(screen.queryByText('Load unavailable')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No category filters configured.')
    ).not.toBeInTheDocument();
    expect(showNotification).not.toHaveBeenCalled();
  });
});
