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
import useM3URuleChecks from '../../../store/useM3URuleChecks.js';
import {
  hideNotification,
  showNotification,
} from '../../../utils/notificationUtils.js';

const drag = vi.hoisted(() => ({ onEnd: null }));

vi.mock('../../../api.js', () => ({
  default: {
    getM3URules: vi.fn(),
    analyzeM3URules: vi.fn(),
    saveM3URule: vi.fn(),
    deleteM3URule: vi.fn(),
    previewM3URules: vi.fn(),
    reorderM3URules: vi.fn(),
    saveApplyM3UGroupRules: vi.fn(),
  },
}));
vi.mock('../../../utils/notificationUtils.js', () => ({
  showNotification: vi.fn(),
  hideNotification: vi.fn(),
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
  default: ({ opened, onConfirm, onClose, confirmLabel, cancelLabel }) =>
    opened ? (
      <div role="alertdialog">
        <button onClick={onConfirm}>
          {confirmLabel === 'Delete' ? 'Confirm delete' : confirmLabel}
        </button>
        <button onClick={onClose}>{cancelLabel || 'Cancel delete'}</button>
      </div>
    ) : null,
}));
vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal()),
  DndContext: ({ children, onDragEnd }) => {
    drag.onEnd = onDragEnd;
    return (
      <div>
        {children}
        <button
          onClick={() => onDragEnd({ active: { id: 2 }, over: { id: 1 } })}
        >
          Move second first
        </button>
      </div>
    );
  },
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
    useM3URuleChecks.setState({ checks: {} });
    API.getM3URules.mockResolvedValue([]);
    API.analyzeM3URules.mockResolvedValue({});
    API.previewM3URules.mockResolvedValue({
      count: 1,
      inventory_count: 1,
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
    'allows only one unsaved new row and unlocks Add after save or delete (filters=%s)',
    async (streamFilters) => {
      renderEditor({ streamFilters });
      const add = await screen.findByRole('button', {
        name: streamFilters ? 'Add filter' : 'Add rule',
      });
      await waitFor(() => expect(add).toBeEnabled());
      fireEvent.click(add);
      expect(add).toBeDisabled();
      fireEvent.click(add);
      fireEvent.click(add);
      expect(screen.getAllByLabelText('Regular expression')).toHaveLength(1);
      fireEvent.click(
        screen.getByLabelText(streamFilters ? 'Save filter' : 'Save rule')
      );
      await waitFor(() =>
        expect(screen.getByLabelText('Regular expression')).toHaveAttribute(
          'aria-invalid',
          'true'
        )
      );
      expect(add).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Regular expression'), {
        target: { value: 'AFR' },
      });
      expect(API.analyzeM3URules).not.toHaveBeenCalled();
      API.saveM3URule.mockResolvedValue(
        rule({ id: 9, regex_pattern: 'AFR', filter_type: 'name' })
      );
      fireEvent.click(
        screen.getByLabelText(streamFilters ? 'Save filter' : 'Save rule')
      );
      await waitFor(() => expect(add).toBeEnabled());
      expect(API.saveM3URule).toHaveBeenCalledTimes(1);
      fireEvent.click(add);
      expect(add).toBeDisabled();
      fireEvent.click(
        screen.getAllByLabelText(
          streamFilters ? 'Delete filter' : 'Delete rule'
        )[1]
      );
      fireEvent.click(screen.getByText('Confirm delete'));
      await waitFor(() => expect(add).toBeEnabled());
      expect(API.deleteM3URule).not.toHaveBeenCalled();
    }
  );
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
      await waitFor(() => expect(API.saveM3URule).toHaveBeenCalledTimes(1));
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
      expect(guidance.parentElement).toContainElement(add);
      expect(guidance.parentElement).toHaveStyle({
        '--group-align': 'flex-end',
      });
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
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Import rule was not saved',
        message: 'Enter a regular expression before saving.',
        color: 'red',
        autoClose: false,
      })
    );
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
    await waitFor(() =>
      expect(screen.getByLabelText('Save rule')).toBeEnabled()
    );
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
    await screen.findByText('1 matching categories from 1 categories');
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
    await screen.findByText('1 matching categories from 1 categories');
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
    await screen.findByText('1 matching categories from 1 categories');
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
    await screen.findByText('1 matching categories from 1 categories');
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
    API.previewM3URules.mockResolvedValue({
      count: 250,
      inventory_count: 250,
      results: [],
    });
    fireEvent.click(screen.getByLabelText('Preview rule'));
    await screen.findByText('250 matching categories from 250 categories');
    expect(
      screen.getByText('250 matching categories from 250 categories')
    ).not.toHaveStyle({ color: 'var(--mantine-color-yellow-light-color)' });
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
      await screen.findByText(/Data from the last completed Live TV refresh/)
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
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Stream filter was not saved',
        message: 'Enter a regular expression before saving.',
        color: 'red',
        autoClose: false,
      })
    );
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
      screen.queryByText('0 matching categories from 0 categories')
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
    await waitFor(() => expect(API.saveM3URule).toHaveBeenCalledTimes(1));
    finish(rule());
    await waitFor(() =>
      expect(screen.getByLabelText('Regular expression')).toBeEnabled()
    );
  });

  it.each([false, true])(
    'rejects a duplicate only on save and marks only the attempted row red (stream filters=%s)',
    async (streamFilters) => {
      API.getM3URules.mockResolvedValue([
        rule({ filter_type: 'name' }),
        rule({ id: 2, order: 1, filter_type: 'name' }),
      ]);
      const { container } = renderEditor({ streamFilters });
      await screen.findAllByDisplayValue('News');
      expect(showNotification).not.toHaveBeenCalled();
      expect(API.analyzeM3URules).not.toHaveBeenCalled();
      expect(
        container.querySelectorAll('tr[data-warning="true"]')
      ).toHaveLength(0);
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
      expect(API.saveM3URule).not.toHaveBeenCalled();
      expect(API.analyzeM3URules).not.toHaveBeenCalled();
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          color: 'red',
          autoClose: false,
          message: expect.stringContaining('identical active match'),
        })
      );
      expect(
        screen.getAllByLabelText('Regular expression')[0].closest('tr')
      ).toHaveAttribute('data-invalid', 'true');
      expect(
        screen.getAllByLabelText('Regular expression')[1].closest('tr')
      ).not.toHaveAttribute('data-invalid');
    }
  );

  it('uses a shared metadata header without irrelevant catalog notices', async () => {
    await load();
    API.previewM3URules.mockResolvedValue({
      count: 250,
      inventory_count: 300,
      results: [],
      catalog_complete: false,
      last_completed_refresh: '2026-10-14T06:00:00Z',
    });
    fireEvent.click(screen.getByLabelText('Preview rule'));
    await screen.findByText('250 matching categories from 300 categories');
    expect(
      screen.getByText(/Data from the last completed Live TV refresh/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /complete saved ordered list|No complete group inventory/
      )
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Close' })
    ).not.toBeInTheDocument();
    expect(showNotification).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '5' })
    );
    await waitFor(() => expect(API.previewM3URules).toHaveBeenCalledTimes(2));
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('does not validate while typing and highlights only actual unsaved changes', async () => {
    const onStateChange = vi.fn();
    API.getM3URules.mockResolvedValue([
      rule(),
      rule({ id: 2, order: 1, regex_pattern: 'Sport' }),
    ]);
    renderEditor({ onStateChange });
    const pattern = (await screen.findAllByLabelText('Regular expression'))[0];
    await waitFor(() =>
      expect(onStateChange).toHaveBeenLastCalledWith({
        dirty: false,
        busy: false,
        overlayOpen: false,
      })
    );
    fireEvent.change(pattern, { target: { value: 'Sport' } });
    expect(pattern.closest('tr')).toHaveAttribute('data-dirty', 'true');
    expect(onStateChange).toHaveBeenLastCalledWith({
      dirty: true,
      busy: false,
      overlayOpen: false,
    });
    expect(showNotification).not.toHaveBeenCalled();
    expect(API.analyzeM3URules).not.toHaveBeenCalled();
    hideNotification.mockClear();
    fireEvent.change(pattern, { target: { value: 'News' } });
    expect(pattern.closest('tr')).not.toHaveAttribute('data-dirty');
    expect(onStateChange).toHaveBeenLastCalledWith({
      dirty: false,
      busy: false,
      overlayOpen: false,
    });
    expect(hideNotification).toHaveBeenCalledWith(
      'account-rules-7-group-rules-error'
    );
  });

  it.each([false, true])(
    'checks only on save, shows one notification and restores the last check without a request (filters=%s)',
    async (streamFilters) => {
      API.getM3URules.mockResolvedValue([
        rule({ filter_type: 'name' }),
        rule({ id: 2, order: 1, regex_pattern: 'Sport', filter_type: 'name' }),
      ]);
      API.analyzeM3URules.mockResolvedValue({
        inventory_count: 100,
        rule_coverage: [
          { rule_id: '1', count: 100 },
          { rule_id: '2', count: 0 },
        ],
      });
      API.saveM3URule.mockResolvedValue(
        rule({ regex_pattern: 'News|Sport', filter_type: 'name' })
      );
      const { container, unmount } = renderEditor({ streamFilters });
      await screen.findByDisplayValue('News');
      expect(showNotification).not.toHaveBeenCalled();
      expect(API.analyzeM3URules).not.toHaveBeenCalled();
      const saveLabel = streamFilters ? 'Save filter' : 'Save rule';
      fireEvent.change(screen.getAllByLabelText('Regular expression')[0], {
        target: { value: 'News|Sport' },
      });
      fireEvent.click(screen.getAllByLabelText(saveLabel)[0]);
      await waitFor(() => expect(API.saveM3URule).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(showNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            color: 'yellow',
            autoClose: false,
            message: expect.stringContaining('Matches all 100'),
          })
        )
      );
      expect(
        container.querySelectorAll('tr[data-warning="true"]')
      ).toHaveLength(1);
      expect(
        container.querySelectorAll('tr[data-covered="true"]')
      ).toHaveLength(1);
      expect(
        screen.getByRole('img', { name: /Covered by rule 1/ })
      ).toBeInTheDocument();
      expect(screen.queryByText(/Matches all 100/)).not.toBeInTheDocument();
      expect(showNotification).toHaveBeenCalledTimes(1);
      expect(
        screen.getAllByLabelText('Regular expression')[1].closest('tr')
      ).not.toHaveAttribute('data-warning');
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(API.analyzeM3URules).toHaveBeenCalledTimes(1);
      API.getM3URules.mockResolvedValue([
        rule({ regex_pattern: 'News|Sport', filter_type: 'name' }),
        rule({ id: 2, order: 1, regex_pattern: 'Sport', filter_type: 'name' }),
      ]);
      unmount();
      showNotification.mockClear();
      renderEditor({ streamFilters });
      await screen.findByRole('img', { name: /Matches all 100/ });
      expect(API.analyzeM3URules).toHaveBeenCalledTimes(1);
      expect(showNotification).not.toHaveBeenCalled();
    }
  );

  it('does not check a reorder until a rule is saved', async () => {
    await load([
      rule(),
      rule({ id: 2, order: 1, regex_pattern: 'News|Sport' }),
    ]);
    API.analyzeM3URules.mockResolvedValue({
      inventory_count: 100,
      rule_coverage: [
        { rule_id: '2', count: 100 },
        { rule_id: '1', count: 0 },
      ],
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
    expect(API.analyzeM3URules).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getAllByLabelText('Save rule')[0]).toBeEnabled()
    );
    API.saveM3URule.mockResolvedValue(
      rule({ id: 2, regex_pattern: 'News|Sport', order: 0 })
    );
    fireEvent.click(screen.getAllByLabelText('Save rule')[0]);
    await screen.findByRole('img', { name: /Matches all 100/ });
    expect(
      screen.getAllByLabelText('Regular expression')[0].closest('tr')
    ).toHaveAttribute('data-warning', 'true');
    expect(
      screen.getAllByLabelText('Regular expression')[1].closest('tr')
    ).toHaveAttribute('data-covered', 'true');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not repeat the notice when two already-covered rows are swapped', async () => {
    API.getM3URules.mockResolvedValue([
      rule({ regex_pattern: 'News|Sport|Events' }),
      rule({ id: 2, order: 1, regex_pattern: 'Sport' }),
      rule({ id: 3, order: 2, regex_pattern: 'Events' }),
    ]);
    API.analyzeM3URules.mockResolvedValue({
      inventory_count: 10,
      rule_coverage: [
        { rule_id: '1', count: 10 },
        { rule_id: '2', count: 0 },
        { rule_id: '3', count: 0 },
      ],
    });
    renderEditor();
    await screen.findByDisplayValue('News|Sport|Events');
    API.saveM3URule.mockResolvedValue(
      rule({ regex_pattern: 'News|Sport|Events' })
    );
    fireEvent.click(screen.getAllByLabelText('Save rule')[0]);
    await screen.findByRole('img', { name: /Matches all 10/ });
    showNotification.mockClear();
    await act(async () => drag.onEnd({ active: { id: 3 }, over: { id: 2 } }));
    expect(API.analyzeM3URules).toHaveBeenCalledTimes(1);
    expect(showNotification).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Regular expression')[1]).toHaveValue(
      'Events'
    );
  });

  it('reports an unsuccessful save-time check in red without writing anything', async () => {
    await load();
    fireEvent.change(screen.getByLabelText('Regular expression'), {
      target: { value: 'Sport' },
    });
    expect(API.analyzeM3URules).not.toHaveBeenCalled();
    API.analyzeM3URules.mockRejectedValue(new Error('Analysis unavailable'));
    API.saveM3URule.mockResolvedValue(rule({ regex_pattern: 'Sport' }));
    fireEvent.click(screen.getByLabelText('Save rule'));
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({ color: 'red', autoClose: false })
      )
    );
    expect(screen.getByLabelText('Regular expression')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(API.saveM3URule).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Preview rule')).toBeDisabled();
  });

  it('offers generic regex help without sending expressions or account data to the helper site', async () => {
    await load();
    fireEvent.click(
      screen.getByRole('button', { name: 'Regular expression help' })
    );
    const link = await screen.findByRole('link', { name: 'regex101 (Python)' });
    expect(link).toHaveAttribute('href', 'https://regex101.com/');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/Avoid empty alternatives/)).toBeInTheDocument();
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Regular expression help' }),
      { key: 'Escape' }
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'regex101 (Python)' })
      ).not.toBeInTheDocument()
    );
  });

  it('does not special-case catch-all text or prevent adding a row to reorder later', async () => {
    await load([rule({ regex_pattern: '.*' })]);
    fireEvent.click(screen.getByText('Add rule'));
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
    const newRow = screen.getAllByLabelText('Regular expression')[1];
    fireEvent.change(newRow, { target: { value: 'Sport' } });
    const newId = newRow.closest('tr').getAttribute('data-rule-id');
    await act(async () =>
      drag.onEnd({ active: { id: newId }, over: { id: 1 } })
    );
    expect(screen.getAllByLabelText('Regular expression')[0]).toHaveValue(
      'Sport'
    );
    API.saveM3URule.mockResolvedValue(rule({ id: 3, regex_pattern: 'Sport' }));
    fireEvent.click(screen.getAllByLabelText('Save rule')[0]);
    await waitFor(() =>
      expect(API.saveM3URule).toHaveBeenCalledWith(
        7,
        'group-rules',
        null,
        expect.objectContaining({ regex_pattern: 'Sport', order: 0 })
      )
    );
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
