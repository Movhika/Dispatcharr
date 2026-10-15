import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { Eye, GripVertical, Info, Plus, Save, Trash2 } from 'lucide-react';
import API from '../../api.js';
import {
  hideNotification,
  showNotification,
} from '../../utils/notificationUtils.js';
import {
  useDateTimeFormat,
  useTimeHelpers,
} from '../../utils/dateTimeUtils.js';
import ConfirmationDialog from '../ConfirmationDialog.jsx';
import ListPagination from '../ListPagination.jsx';
import { SensitiveTextInput as TextInput } from '../SensitiveFields.jsx';
import { formatApiError } from '../../utils.js';
import {
  getRuleWarnings,
  getCoverageWarnings,
} from './M3URulesEditor.utils.js';
import editorClasses from './AccountEditor.module.css';

const SortableRow = ({
  id,
  children,
  error,
  warning,
  dirty,
  disabled,
  noun,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id, disabled });
  return (
    <TableTr
      ref={setNodeRef}
      data-invalid={error ? 'true' : undefined}
      data-rule-id={id}
      data-warning={warning ? 'true' : undefined}
      data-dirty={dirty ? 'true' : undefined}
      title={dirty ? 'Unsaved changes' : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        boxShadow: dirty
          ? 'inset 3px 0 var(--mantine-color-blue-5)'
          : undefined,
        backgroundColor: error
          ? 'var(--mantine-color-red-light)'
          : warning
            ? 'var(--mantine-color-yellow-light)'
            : dirty
              ? 'var(--mantine-color-blue-light)'
              : undefined,
      }}
    >
      <TableTd>
        <ActionIcon
          aria-label={`Move ${noun}`}
          variant="subtle"
          color="gray"
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </ActionIcon>
      </TableTd>
      {children}
    </TableTr>
  );
};

const M3URulesEditor = ({
  accountId,
  scope,
  streamFilters = false,
  onApplied,
  onStateChange,
}) => {
  const kind = streamFilters ? 'filters' : 'group-rules';
  const [rules, setRules] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [rowErrors, setRowErrors] = useState({});
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const [previewError, setPreviewError] = useState(null);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [previewDraft, setPreviewDraft] = useState([]);
  const [preview, setPreview] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [pendingChange, setPendingChange] = useState(null);
  const [coverageWarnings, setCoverageWarnings] = useState({});
  const previewRequest = useRef(0);
  const shownWarnings = useRef(new Set());
  const savedRules = useRef(new Map());
  const errorNotificationId = `account-rules-${accountId}-${kind}-error`;
  const warningNotificationId = `account-rules-${accountId}-${kind}-warning`;
  const { dateYearFormat, timeFormat } = useDateTimeFormat();
  const { toUserTime } = useTimeHelpers();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const loaded = await API.getM3URules(accountId, kind, scope);
      savedRules.current = new Map(loaded.map((rule) => [rule.id, rule]));
      setRules(loaded);
      setDirtyIds(new Set());
      setRowErrors({});
      setError(null);
    } catch (error) {
      setError(error.message || 'Rules could not be loaded.');
    } finally {
      setBusy(false);
    }
  }, [accountId, kind, scope]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(
    () => () => {
      previewRequest.current += 1;
    },
    []
  );

  const payload = (rule) =>
    streamFilters
      ? {
          filter_type: rule.filter_type,
          regex_pattern: rule.regex_pattern,
          exclude: rule.exclude,
          order: rule.order,
          custom_properties: {
            ...(rule.custom_properties || {}),
            case_sensitive: rule.custom_properties?.case_sensitive !== false,
          },
        }
      : {
          scope,
          match_field: rule.match_field,
          match_mode: rule.match_mode,
          regex_pattern: rule.regex_pattern,
          action: rule.action,
          case_sensitive: rule.case_sensitive,
          enabled: rule.enabled,
          order: rule.order,
        };

  useEffect(
    () => () => {
      hideNotification(errorNotificationId);
      hideNotification(warningNotificationId);
    },
    [errorNotificationId, warningNotificationId]
  );

  const update = (id, values) => {
    const updated = { ...rules.find((rule) => rule.id === id), ...values };
    setRules((current) =>
      current.map((rule) => (rule.id === id ? updated : rule))
    );
    setError(null);
    setDirtyIds((current) => {
      const next = new Set(current);
      const original = savedRules.current.get(id);
      // Order is persisted separately; reverting field edits is not dirty.
      const fields = (rule) => ({ ...payload(rule), order: 0 });
      if (
        original &&
        JSON.stringify(fields(updated)) === JSON.stringify(fields(original))
      )
        next.delete(id);
      else next.add(id);
      return next;
    });
    setRowErrors((current) => ({ ...current, [id]: undefined }));
    hideNotification(errorNotificationId);
    setCoverageWarnings({});
  };

  const notifyError = (message) => {
    hideNotification(errorNotificationId);
    showNotification({
      id: errorNotificationId,
      title: streamFilters
        ? 'Stream filter was not saved'
        : 'Import rule was not saved',
      message,
      color: 'red',
      autoClose: false,
    });
  };

  const persistedRows = (ordered = rules, replacement) =>
    ordered.flatMap((rule) => {
      const saved =
        replacement?.id === rule.id
          ? replacement
          : savedRules.current.get(rule.id);
      return saved ? [{ ...saved, order: rule.order }] : [];
    });

  const add = () =>
    setRules((current) => [
      ...current,
      {
        id: `new-${crypto.randomUUID()}`,
        isNew: true,
        order: Math.max(-1, ...current.map((rule) => rule.order)) + 1,
        regex_pattern: '',
        filter_type: 'name',
        exclude: true,
        custom_properties: { case_sensitive: false },
        scope,
        match_field: 'group_name',
        match_mode: 'any',
        action: 'disable',
        case_sensitive: false,
        enabled: true,
      },
    ]);

  const save = async (rule, notify = true) => {
    if (!rule.regex_pattern?.trim()) {
      const message = 'Enter a regular expression before saving.';
      setRowErrors((current) => ({
        ...current,
        [rule.id]: message,
      }));
      notifyError(message);
      return null;
    }
    const saved = await API.saveM3URule(
      accountId,
      kind,
      rule.isNew ? null : rule.id,
      payload(rule)
    );
    savedRules.current.delete(rule.id);
    savedRules.current.set(saved.id, saved);
    if (rule.id !== saved.id)
      setCoverageWarnings((current) => {
        const { [rule.id]: warning, ...rest } = current;
        return warning ? { ...rest, [saved.id]: warning } : rest;
      });
    hideNotification(errorNotificationId);
    setRules((current) =>
      current.map((item) => (item.id === rule.id ? saved : item))
    );
    setDirtyIds((current) => {
      const next = new Set(current);
      next.delete(rule.id);
      return next;
    });
    setRowErrors((current) => ({ ...current, [rule.id]: undefined }));
    if (notify)
      showNotification({
        title: streamFilters ? 'Stream filter saved' : 'Import rule saved',
        message: 'Used during future scans. Existing selections are unchanged.',
        color: 'green',
      });
    return saved;
  };

  const checkCoverage = async (rows) => {
    if (!rows.length) return false;
    const response = await API.analyzeM3URules(
      accountId,
      kind,
      rows.map((rule) => ({
        ...payload(rule),
        preview_id: String(rule.id),
      }))
    );
    const found = getCoverageWarnings(rows, response, streamFilters);
    setCoverageWarnings(found);
    return Object.keys(found).length > 0;
  };

  const saveRow = async (rule, confirmed = false) => {
    setBusy(true);
    try {
      if (
        rule.regex_pattern?.trim() &&
        !confirmed &&
        (await checkCoverage(persistedRows(rules, rule)))
      ) {
        setPendingChange({ type: 'save', rule });
        return;
      }
      if (await save(rule)) setError(null);
    } catch (error) {
      setRowErrors((current) => ({
        ...current,
        [rule.id]: formatApiError(error),
      }));
    } finally {
      setBusy(false);
    }
  };

  const loadPreview = async (draft, target, nextPage, nextPageSize) => {
    const requestId = ++previewRequest.current;
    setPreviewBusy(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const response = await API.previewM3URules(
        accountId,
        kind,
        draft.map((rule) => ({
          ...payload(rule),
          preview_id: String(rule.id),
        })),
        target.id,
        nextPage,
        nextPageSize
      );
      if (requestId === previewRequest.current) {
        setPreview(response);
        setCoverageWarnings(
          getCoverageWarnings(draft, response, streamFilters)
        );
        hideNotification(errorNotificationId);
      }
    } catch (error) {
      if (requestId === previewRequest.current)
        setPreviewError(formatApiError(error));
    } finally {
      if (requestId === previewRequest.current) setPreviewBusy(false);
    }
  };

  const openPreview = (rule) => {
    if (busy || hasUnsavedChanges) return;
    const draft = rules.map((item) => ({
      ...item,
      custom_properties: { ...(item.custom_properties || {}) },
    }));
    setPreviewTarget(rule);
    setPreviewDraft(draft);
    setPreview(null);
    setPage(1);
    loadPreview(draft, rule, 1, pageSize);
  };

  const closePreview = () => {
    previewRequest.current += 1;
    setPreviewTarget(null);
    setPreview(null);
    setPreviewBusy(false);
    hideNotification(errorNotificationId);
    setPreviewError(null);
  };

  const apply = async () => {
    setPreviewBusy(true);
    try {
      const result = await API.saveApplyM3UGroupRules(
        accountId,
        previewDraft.map((rule) => ({
          ...payload(rule),
          preview_id: String(rule.id),
        })),
        previewTarget.id
      );
      showNotification({
        title: 'Import rule applied',
        message: `${result.updated} existing entries updated.`,
        color: 'green',
      });
      await onApplied?.(result);
      await load();
      closePreview();
    } catch (error) {
      setPreviewError(formatApiError(error));
    } finally {
      setPreviewBusy(false);
    }
  };

  const reorder = async ({ active, over }) => {
    if (busy || !over || active.id === over.id) return;
    if (
      !rules.some((rule) => rule.id === active.id) ||
      !rules.some((rule) => rule.id === over.id)
    )
      return;
    const reordered = arrayMove(
      rules,
      rules.findIndex((rule) => rule.id === active.id),
      rules.findIndex((rule) => rule.id === over.id)
    ).map((rule, order) => ({ ...rule, order }));
    await persistOrder(reordered);
  };

  const persistOrder = async (reordered, confirmed = false) => {
    const previous = rules;
    setBusy(true);
    try {
      if (!confirmed && (await checkCoverage(persistedRows(reordered)))) {
        setPendingChange({ type: 'order', rules: reordered });
        return;
      }
      setRules(reordered);
      const saved = reordered.filter((rule) => !rule.isNew);
      await API.reorderM3URules(
        accountId,
        kind,
        saved.map((rule) => rule.id),
        scope,
        saved.map((rule) => rule.order)
      );
      for (const rule of saved) {
        savedRules.current.set(rule.id, {
          ...savedRules.current.get(rule.id),
          order: rule.order,
        });
      }
      hideNotification(errorNotificationId);
    } catch (error) {
      setRules(previous);
      setError(error.message || 'Order could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      if (!deleteTarget.isNew)
        await API.deleteM3URule(accountId, kind, deleteTarget.id);
      savedRules.current.delete(deleteTarget.id);
      setCoverageWarnings({});
      hideNotification(errorNotificationId);
      setRules((current) =>
        current.filter((rule) => rule.id !== deleteTarget.id)
      );
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(deleteTarget.id);
        return next;
      });
      setRowErrors((current) => ({ ...current, [deleteTarget.id]: undefined }));
      setDeleteTarget(null);
    } catch (error) {
      setError(error.message || 'Rule could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const title = streamFilters ? 'Stream filters' : 'Import rules';
  const noun = streamFilters ? 'filter' : 'rule';
  const hasUnsavedChanges =
    dirtyIds.size > 0 || rules.some((rule) => rule.isNew);
  const warnings = getRuleWarnings(rules, streamFilters);
  for (const [id, messages] of Object.entries(coverageWarnings)) {
    warnings[id] = [...(warnings[id] || []), ...messages];
  }
  const warningKey = JSON.stringify([
    ...new Set(Object.values(warnings).flat()),
  ]);
  useEffect(() => {
    const messages = JSON.parse(warningKey);
    const changed =
      messages.some((message) => !shownWarnings.current.has(message)) ||
      shownWarnings.current.size !== messages.length;
    shownWarnings.current = new Set(messages);
    if (!messages.length) hideNotification(warningNotificationId);
    else if (changed) {
      hideNotification(warningNotificationId);
      showNotification({
        id: warningNotificationId,
        title: streamFilters ? 'Stream filter warning' : 'Import rule warning',
        message: messages.join('\n'),
        color: 'yellow',
        autoClose: false,
      });
    }
  }, [warningKey, streamFilters, warningNotificationId]);

  useEffect(() => {
    onStateChange?.({
      dirty: hasUnsavedChanges,
      busy: busy || previewBusy,
      overlayOpen: !!previewTarget || !!deleteTarget || !!pendingChange,
    });
  }, [
    hasUnsavedChanges,
    busy,
    previewBusy,
    previewTarget,
    deleteTarget,
    pendingChange,
    onStateChange,
  ]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);
  const previewRows = preview?.results || [];
  const refreshedAt = preview?.last_completed_refresh
    ? toUserTime(preview.last_completed_refresh).format(
        `${dateYearFormat} ${timeFormat}`
      )
    : 'Never';

  return (
    <Stack gap="sm" aria-busy={busy}>
      <Group align="flex-end" wrap="nowrap" gap="sm">
        <Alert
          icon={<Info size={16} />}
          color="blue"
          variant="light"
          p={6}
          mih={30}
          style={{ flex: 1, minWidth: 0 }}
          styles={{
            icon: { width: 16, height: 16, marginInlineEnd: 8 },
            wrapper: { alignItems: 'center' },
          }}
        >
          <Text size="xs" lh="16px">
            <strong>Order matters.</strong> The first matching rule wins.{' '}
            {streamFilters
              ? 'Filters decide which Live TV streams are imported.'
              : 'New unmatched categories are imported disabled.'}
          </Text>
        </Alert>
        <Button
          size="xs"
          leftSection={<Plus size={14} />}
          onClick={add}
          disabled={busy}
        >
          Add {streamFilters ? 'filter' : 'rule'}
        </Button>
      </Group>
      {!rules.length && !busy && !error && (
        <Alert color="gray" variant="light">
          {streamFilters
            ? 'No stream filters configured.'
            : 'No category filters configured.'}
        </Alert>
      )}
      {rules.length > 0 && (
        <ScrollArea>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={reorder}
          >
            <SortableContext
              items={rules.map((rule) => rule.id)}
              strategy={verticalListSortingStrategy}
            >
              <Table striped withTableBorder miw={850}>
                <TableThead>
                  <TableTr>
                    <TableTh
                      aria-label={`${streamFilters ? 'Filter' : 'Rule'} order`}
                    />
                    <TableTh>{streamFilters ? 'Field' : 'Match'}</TableTh>
                    <TableTh>Regular expression</TableTh>
                    {!streamFilters && <TableTh>Item mode</TableTh>}
                    <TableTh>Result</TableTh>
                    <TableTh>Case</TableTh>
                    {!streamFilters && <TableTh>Status</TableTh>}
                    <TableTh>Actions</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {rules.map((rule) => (
                    <SortableRow
                      key={rule.id}
                      id={rule.id}
                      error={rowErrors[rule.id]}
                      warning={!!warnings[rule.id]?.length}
                      dirty={dirtyIds.has(rule.id) || rule.isNew}
                      disabled={busy}
                      noun={noun}
                    >
                      <TableTd>
                        <Select
                          size="xs"
                          aria-label={
                            streamFilters ? 'Filter field' : 'Rule match field'
                          }
                          value={
                            streamFilters ? rule.filter_type : rule.match_field
                          }
                          disabled={busy}
                          data={
                            streamFilters
                              ? [
                                  { value: 'name', label: 'Stream name' },
                                  { value: 'url', label: 'Stream URL' },
                                  ...(rule.filter_type === 'group'
                                    ? [
                                        {
                                          value: 'group',
                                          label: 'Group name (legacy)',
                                        },
                                      ]
                                    : []),
                                ]
                              : [
                                  {
                                    value: 'group_name',
                                    label: 'Category name',
                                  },
                                  {
                                    value: 'item_name',
                                    label: 'Contained item',
                                  },
                                ]
                          }
                          onChange={(value) =>
                            update(rule.id, {
                              [streamFilters ? 'filter_type' : 'match_field']:
                                value,
                            })
                          }
                        />
                      </TableTd>
                      <TableTd>
                        <TextInput
                          size="xs"
                          aria-label="Regular expression"
                          sensitive={
                            streamFilters && rule.filter_type === 'url'
                          }
                          value={rule.regex_pattern}
                          error={!!rowErrors[rule.id]}
                          disabled={busy}
                          onChange={(event) =>
                            update(rule.id, {
                              regex_pattern: event.currentTarget.value,
                            })
                          }
                        />
                      </TableTd>
                      {!streamFilters && (
                        <TableTd>
                          <Select
                            size="xs"
                            aria-label="Item matching mode"
                            value={rule.match_mode}
                            disabled={busy || rule.match_field !== 'item_name'}
                            data={[
                              { value: 'any', label: 'Any item' },
                              { value: 'all', label: 'All items' },
                            ]}
                            onChange={(value) =>
                              update(rule.id, { match_mode: value })
                            }
                          />
                        </TableTd>
                      )}
                      <TableTd>
                        <Select
                          size="xs"
                          aria-label="Rule result"
                          disabled={busy}
                          value={
                            streamFilters
                              ? rule.exclude
                                ? 'exclude'
                                : 'include'
                              : rule.action
                          }
                          data={
                            streamFilters
                              ? [
                                  { value: 'exclude', label: 'Exclude' },
                                  { value: 'include', label: 'Include' },
                                ]
                              : [
                                  { value: 'enable', label: 'Import enabled' },
                                  {
                                    value: 'disable',
                                    label: 'Import disabled',
                                  },
                                  { value: 'ignore', label: 'Ignore category' },
                                ]
                          }
                          onChange={(value) =>
                            update(
                              rule.id,
                              streamFilters
                                ? { exclude: value === 'exclude' }
                                : { action: value }
                            )
                          }
                        />
                      </TableTd>
                      <TableTd>
                        <Checkbox
                          aria-label="Case sensitive"
                          disabled={busy}
                          checked={
                            streamFilters
                              ? rule.custom_properties?.case_sensitive !== false
                              : rule.case_sensitive
                          }
                          onChange={(event) =>
                            update(
                              rule.id,
                              streamFilters
                                ? {
                                    custom_properties: {
                                      ...(rule.custom_properties || {}),
                                      case_sensitive:
                                        event.currentTarget.checked,
                                    },
                                  }
                                : {
                                    case_sensitive: event.currentTarget.checked,
                                  }
                            )
                          }
                        />
                      </TableTd>
                      {!streamFilters && (
                        <TableTd>
                          <Checkbox
                            aria-label="Rule enabled"
                            disabled={busy}
                            checked={rule.enabled}
                            onChange={(event) =>
                              update(rule.id, {
                                enabled: event.currentTarget.checked,
                              })
                            }
                          />
                        </TableTd>
                      )}
                      <TableTd>
                        <Group gap={4} wrap="nowrap">
                          <Tooltip label={`Save ${noun}`}>
                            <ActionIcon
                              aria-label={`Save ${noun}`}
                              variant="subtle"
                              disabled={busy}
                              onClick={() => saveRow(rule)}
                            >
                              <Save size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip
                            label={
                              hasUnsavedChanges
                                ? 'Save all changes before previewing.'
                                : `Preview ${noun}`
                            }
                            events={{ hover: true, focus: true, touch: true }}
                            withArrow
                          >
                            <span
                              style={{ display: 'inline-flex' }}
                              tabIndex={hasUnsavedChanges ? 0 : undefined}
                              aria-label={
                                hasUnsavedChanges
                                  ? 'Save all changes before previewing.'
                                  : undefined
                              }
                            >
                              <ActionIcon
                                aria-label={`Preview ${noun}`}
                                variant="subtle"
                                disabled={busy || hasUnsavedChanges}
                                onClick={() => openPreview(rule)}
                              >
                                <Eye size={16} />
                              </ActionIcon>
                            </span>
                          </Tooltip>
                          <Tooltip label={`Delete ${noun}`}>
                            <ActionIcon
                              aria-label={`Delete ${noun}`}
                              color="red"
                              variant="subtle"
                              disabled={busy}
                              onClick={() => setDeleteTarget(rule)}
                            >
                              <Trash2 size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </TableTd>
                    </SortableRow>
                  ))}
                </TableTbody>
              </Table>
            </SortableContext>
          </DndContext>
        </ScrollArea>
      )}
      <Modal
        opened={!!previewTarget}
        onClose={closePreview}
        title={`${title} preview`}
        size="min(1100px, 94vw)"
        closeButtonProps={{ 'aria-label': 'Close preview' }}
        classNames={{
          content: editorClasses.content,
          body: editorClasses.body,
          header: editorClasses.header,
        }}
      >
        <Stack className={editorClasses.previewStack} gap="sm">
          {preview && !previewError && (
            <Alert
              color="blue"
              icon={<Info size={16} />}
              p="xs"
              style={{ flexShrink: 0 }}
            >
              {preview.last_completed_refresh
                ? `Data from the last completed ${streamFilters || scope === 'live' ? 'Live TV' : 'VOD'} refresh: ${refreshedAt}.`
                : `No completed ${streamFilters || scope === 'live' ? 'Live TV' : 'VOD'} refresh recorded.`}
              {!preview.catalog_complete &&
                (streamFilters
                  ? ' Currently imported streams only; refresh to include excluded streams.'
                  : previewDraft.some(
                        (rule) =>
                          rule.enabled && rule.match_field === 'item_name'
                      )
                    ? ' Contained-item matches use imported names only; refresh to include disabled categories.'
                    : '')}
              {preview?.refresh_in_progress &&
                ' A refresh is running; this preview still uses the previous completed snapshot.'}
            </Alert>
          )}
          <Text
            fw={600}
            c={previewError ? 'red' : undefined}
            style={{ flexShrink: 0 }}
          >
            {previewBusy
              ? 'Evaluating…'
              : previewError
                ? 'Preview could not be evaluated.'
                : `${preview?.count || 0} matching ${streamFilters ? 'streams' : 'categories'} from ${preview?.inventory_count ?? 0} ${streamFilters ? 'streams' : 'categories'}`}
          </Text>
          {preview && !previewError && (
            <>
              <div className={editorClasses.categoryTableFrame}>
                <ScrollArea h="100%" type="auto">
                  <Table
                    striped
                    stickyHeader
                    stickyHeaderOffset={0}
                    className={editorClasses.categoryTable}
                  >
                    <TableThead>
                      <TableTr>
                        <TableTh w={streamFilters ? '55%' : '50%'}>Name</TableTh>
                        {streamFilters ? (
                          <TableTh>Group</TableTh>
                        ) : (
                          <TableTh>Current</TableTh>
                        )}
                        <TableTh>Result</TableTh>
                        {!streamFilters && <TableTh>Items</TableTh>}
                      </TableTr>
                    </TableThead>
                    <TableTbody>
                      {previewRows.map((row, index) => (
                        <TableTr key={row.relation_id || index}>
                          <TableTd>{row.name}</TableTd>
                          <TableTd>
                            {streamFilters
                              ? row.group
                              : row.currently_enabled
                                ? 'Enabled'
                                : 'Disabled'}
                          </TableTd>
                          <TableTd>
                            {streamFilters
                              ? row.result
                              : row.action === 'ignore'
                                ? 'Unchanged'
                                : row.would_enable
                                  ? 'Enabled'
                                  : 'Disabled'}
                          </TableTd>
                          {!streamFilters && (
                            <TableTd>{row.item_count}</TableTd>
                          )}
                        </TableTr>
                      ))}
                    </TableTbody>
                  </Table>
                </ScrollArea>
              </div>
              <div className={editorClasses.categoryFooter}>
                <div className={editorClasses.paginationSlot}>
                  <ListPagination
                    page={page}
                    pageSize={pageSize}
                    total={preview?.count || 0}
                    onPageChange={(value) => {
                      setPage(value);
                      loadPreview(previewDraft, previewTarget, value, pageSize);
                    }}
                    onPageSizeChange={(value) => {
                      setPageSize(value);
                      setPage(1);
                      loadPreview(previewDraft, previewTarget, 1, value);
                    }}
                  />
                </div>
                {!streamFilters && (
                  <div className={editorClasses.categoryFooterActions}>
                    <Button
                      onClick={apply}
                      loading={previewBusy}
                      disabled={
                        !preview?.count ||
                        previewTarget?.action === 'ignore' ||
                        !!previewError
                      }
                    >
                      Apply to existing
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </Stack>
      </Modal>
      <ConfirmationDialog
        opened={!!pendingChange}
        onClose={() => setPendingChange(null)}
        onConfirm={() => {
          const change = pendingChange;
          setPendingChange(null);
          if (change.type === 'save') saveRow(change.rule, true);
          else persistOrder(change.rules, true);
        }}
        title="Check rule coverage"
        message="A rule matches every available or remaining entry from the last refresh. Highlighted later rules may have no effect. Keep editing, or continue if this is intended."
        cancelLabel="Keep editing"
        confirmLabel={
          pendingChange?.type === 'save' ? 'Save anyway' : 'Move anyway'
        }
        zIndex={300}
      />
      <ConfirmationDialog
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={busy}
        title={`Delete ${streamFilters ? 'stream filter' : 'import rule'}`}
        message="Delete this rule? Existing groups and streams will not be deleted."
        confirmLabel="Delete"
        zIndex={300}
      />
    </Stack>
  );
};

export default M3URulesEditor;
