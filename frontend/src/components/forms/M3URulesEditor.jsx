import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  Modal,
  Popover,
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
import {
  Ban,
  CircleHelp,
  Eye,
  GripVertical,
  Info,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
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
  findDuplicateRule,
  getRuleCoverage,
  ruleCheckSignature,
} from './M3URulesEditor.utils.js';
import useM3URuleChecks from '../../store/useM3URuleChecks.js';
import editorClasses from './AccountEditor.module.css';
import classes from './M3URulesEditor.module.css';

const SortableRow = ({
  id,
  children,
  error,
  warning,
  covered,
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
      data-covered={covered ? 'true' : undefined}
      className={classes.ruleRow}
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
              : covered
                ? 'var(--mantine-color-default-hover)'
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
  const [regexHelpOpen, setRegexHelpOpen] = useState(false);
  const [coverage, setCoverage] = useState({ causes: {}, coveredBy: {} });
  const coverageRequest = useRef(0);
  const previewRequest = useRef(0);
  const savedRules = useRef(new Map());
  const errorNotificationId = `account-rules-${accountId}-${kind}-error`;
  const coverageNotificationId = `account-rules-${accountId}-${kind}-coverage`;
  const checkKey = `${accountId}-${kind}-${scope || 'live'}`;
  const { dateYearFormat, timeFormat } = useDateTimeFormat();
  const { toUserTime } = useTimeHelpers();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const payload = useCallback(
    (rule) =>
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
          },
    [streamFilters, scope]
  );

  const acceptCoverage = useCallback(
    (rows, response) => {
      const found = getRuleCoverage(rows, response, streamFilters);
      const causes = Object.values(found.causes);
      setCoverage(found);
      useM3URuleChecks
        .getState()
        .remember(checkKey, ruleCheckSignature(rows, streamFilters), found);
      if (!causes.length) hideNotification(coverageNotificationId);
      else {
        hideNotification(coverageNotificationId);
        showNotification({
          id: coverageNotificationId,
          title: streamFilters
            ? 'Stream filter saved with warning'
            : 'Import rule saved with warning',
          message: causes.map((cause) => cause.message).join('\n'),
          color: 'yellow',
          autoClose: false,
        });
      }
      return found;
    },
    [coverageNotificationId, streamFilters, checkKey]
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
      const checked = useM3URuleChecks.getState().checks[checkKey];
      const restored =
        checked?.signature === ruleCheckSignature(loaded, streamFilters)
          ? checked.coverage
          : { causes: {}, coveredBy: {} };
      setCoverage(restored);
    } catch (error) {
      setError(error.message || 'Rules could not be loaded.');
    } finally {
      setBusy(false);
    }
  }, [accountId, kind, scope, checkKey, streamFilters]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(
    () => () => {
      previewRequest.current += 1;
      coverageRequest.current += 1;
    },
    []
  );

  useEffect(
    () => () => {
      hideNotification(errorNotificationId);
      hideNotification(coverageNotificationId);
    },
    [errorNotificationId, coverageNotificationId]
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
    coverageRequest.current += 1;
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

  const add = () => {
    if (busy || rules.some((rule) => rule.isNew)) return;
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
  };

  const save = async (rule) => {
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
    return saved;
  };

  const saveRow = async (rule) => {
    setBusy(true);
    hideNotification(errorNotificationId);
    hideNotification(coverageNotificationId);
    const requestId = ++coverageRequest.current;
    try {
      if (!rule.regex_pattern?.trim()) {
        await save(rule);
        return;
      }
      const duplicate = findDuplicateRule(rule, persistedRows(), streamFilters);
      if (duplicate) {
        const message = `An identical active match already exists (rule ${rules.findIndex((item) => item.id === duplicate.id) + 1}). Edit that rule instead.`;
        setRowErrors((current) => ({ ...current, [rule.id]: message }));
        notifyError(message);
        return;
      }
      const checkedRows = persistedRows(rules, rule);
      let response;
      try {
        response = await API.analyzeM3URules(
          accountId,
          kind,
          checkedRows.map((item) => ({
            ...payload(item),
            preview_id: String(item.id),
          }))
        );
      } catch (error) {
        const message = formatApiError(error);
        setRowErrors((current) => ({ ...current, [rule.id]: message }));
        notifyError(message);
        return;
      }
      if (requestId !== coverageRequest.current) return;
      const saved = await save(rule);
      if (saved) {
        setError(null);
        const checked = acceptCoverage(
          checkedRows.map((item) => (item.id === rule.id ? saved : item)),
          {
            ...response,
            rule_coverage: response.rule_coverage?.map((row) => ({
              ...row,
              rule_id:
                String(row.rule_id) === String(rule.id)
                  ? String(saved.id)
                  : row.rule_id,
            })),
          }
        );
        if (!Object.keys(checked.causes).length)
          showNotification({
            id: coverageNotificationId,
            title: streamFilters ? 'Stream filter saved' : 'Import rule saved',
            message:
              'Used during future scans. Existing selections are unchanged.',
            color: 'green',
          });
      }
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

  const persistOrder = async (reordered) => {
    const previous = rules;
    setBusy(true);
    coverageRequest.current += 1;
    try {
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
      setCoverage({ causes: {}, coveredBy: {} });
      useM3URuleChecks.getState().forget(checkKey);
    } catch (error) {
      setRules(previous);
      setError(error.message || 'Order could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    coverageRequest.current += 1;
    try {
      if (!deleteTarget.isNew)
        await API.deleteM3URule(accountId, kind, deleteTarget.id);
      savedRules.current.delete(deleteTarget.id);
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
      if (!deleteTarget.isNew) {
        setCoverage({ causes: {}, coveredBy: {} });
        useM3URuleChecks.getState().forget(checkKey);
      }
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
  const hasNewRule = rules.some((rule) => rule.isNew);
  const visibleCoverage = hasUnsavedChanges
    ? { causes: {}, coveredBy: {} }
    : coverage;

  useEffect(() => {
    onStateChange?.({
      dirty: hasUnsavedChanges,
      busy: busy || previewBusy,
      overlayOpen: !!previewTarget || !!deleteTarget || regexHelpOpen,
    });
  }, [
    hasUnsavedChanges,
    busy,
    previewBusy,
    previewTarget,
    deleteTarget,
    regexHelpOpen,
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
        <Tooltip
          label={`Save or delete the new ${noun} before adding another.`}
          disabled={!hasNewRule}
          events={{ hover: true, focus: true, touch: true }}
          withArrow
        >
          <span
            style={{ display: 'inline-flex' }}
            tabIndex={hasNewRule ? 0 : undefined}
          >
            <Button
              size="xs"
              leftSection={<Plus size={14} />}
              onClick={add}
              disabled={busy || hasNewRule}
            >
              Add {streamFilters ? 'filter' : 'rule'}
            </Button>
          </span>
        </Tooltip>
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
                    <TableTh>
                      <Group gap={4} wrap="nowrap">
                        Regular expression
                        <Popover
                          opened={regexHelpOpen}
                          onChange={setRegexHelpOpen}
                          width={320}
                          position="bottom"
                          withArrow
                          trapFocus
                          returnFocus
                        >
                          <Popover.Target>
                            <ActionIcon
                              aria-label="Regular expression help"
                              variant="subtle"
                              color="gray"
                              size="xs"
                              onClick={() =>
                                setRegexHelpOpen((opened) => !opened)
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  event.stopPropagation();
                                  setRegexHelpOpen(false);
                                }
                              }}
                            >
                              <CircleHelp size={14} />
                            </ActionIcon>
                          </Popover.Target>
                          <Popover.Dropdown>
                            <Stack gap="xs">
                              <Text size="xs">
                                Put specific rules first and broad fallback
                                rules last. The first match wins.
                              </Text>
                              <Text size="xs">
                                <code>KI</code> matches anywhere,{' '}
                                <code>^KI</code> at the start, and{' '}
                                <code>^KI$</code> the whole name.
                              </Text>
                              <Text size="xs">
                                Escape literal characters such as{' '}
                                <code>{'\\|'}</code> and <code>{'\\.'}</code>.
                                Avoid empty alternatives such as{' '}
                                <code>DE|</code>, which can match any name.
                              </Text>
                              <Text size="xs">
                                Try sample names on{' '}
                                <Anchor
                                  href="https://regex101.com/"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  size="xs"
                                >
                                  regex101 (Python)
                                </Anchor>
                                . Do not paste credentials or private URLs. The
                                app preview is authoritative; the backend uses
                                Python&apos;s regex engine.
                              </Text>
                            </Stack>
                          </Popover.Dropdown>
                        </Popover>
                      </Group>
                    </TableTh>
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
                      warning={!!visibleCoverage.causes[rule.id]}
                      covered={visibleCoverage.coveredBy[rule.id] !== undefined}
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
                        <Group gap={6} wrap="nowrap" align="center">
                          <TextInput
                            style={{ flex: 1, minWidth: 0 }}
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
                          {(rowErrors[rule.id] ||
                            visibleCoverage.causes[rule.id]) && (
                            <Tooltip
                              label={
                                rowErrors[rule.id] ||
                                visibleCoverage.causes[rule.id].message
                              }
                              events={{ hover: true, focus: true, touch: true }}
                              multiline
                              w={280}
                              withArrow
                            >
                              <span
                                tabIndex={0}
                                role="img"
                                aria-label={
                                  rowErrors[rule.id] ||
                                  visibleCoverage.causes[rule.id].message
                                }
                                className={classes.coverageMarker}
                                style={{
                                  color: rowErrors[rule.id]
                                    ? 'var(--mantine-color-red-6)'
                                    : 'var(--mantine-color-yellow-6)',
                                }}
                              >
                                <TriangleAlert size={15} aria-hidden="true" />
                              </span>
                            </Tooltip>
                          )}
                          {visibleCoverage.coveredBy[rule.id] !== undefined &&
                            !rowErrors[rule.id] && (
                              <Tooltip
                                label={`Covered by rule ${rules.findIndex((item) => String(item.id) === String(visibleCoverage.coveredBy[rule.id])) + 1} in the last refresh snapshot. Move this rule earlier or narrow the earlier expression to give it matches.`}
                                events={{
                                  hover: true,
                                  focus: true,
                                  touch: true,
                                }}
                                multiline
                                w={280}
                                withArrow
                              >
                                <span
                                  tabIndex={0}
                                  role="img"
                                  aria-label={`Covered by rule ${rules.findIndex((item) => String(item.id) === String(visibleCoverage.coveredBy[rule.id])) + 1} in the last refresh snapshot`}
                                  className={classes.coverageMarker}
                                >
                                  <Ban size={15} aria-hidden="true" />
                                </span>
                              </Tooltip>
                            )}
                        </Group>
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
