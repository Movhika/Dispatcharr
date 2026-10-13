import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
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
  TextInput,
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
import { Eye, GripVertical, Plus, Save, Trash2 } from 'lucide-react';
import API from '../../api.js';
import { showNotification } from '../../utils/notificationUtils.js';
import {
  useDateTimeFormat,
  useTimeHelpers,
} from '../../utils/dateTimeUtils.js';
import ConfirmationDialog from '../ConfirmationDialog.jsx';
import ListPagination from '../ListPagination.jsx';

const SortableRow = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });
  return (
    <TableTr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <TableTd>
        <ActionIcon
          aria-label="Move rule"
          variant="subtle"
          color="gray"
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
}) => {
  const kind = streamFilters ? 'filters' : 'group-rules';
  const [rules, setRules] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [previewDraft, setPreviewDraft] = useState([]);
  const [preview, setPreview] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const previewRequest = useRef(0);
  const { dateYearFormat, timeFormat } = useDateTimeFormat();
  const { toUserTime } = useTimeHelpers();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setRules(await API.getM3URules(accountId, kind, scope));
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

  const update = (id, values) => {
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...values } : rule))
    );
    setError(null);
  };

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
      setError('Enter a regular expression before saving or previewing.');
      return null;
    }
    const saved = await API.saveM3URule(
      accountId,
      kind,
      rule.isNew ? null : rule.id,
      payload(rule)
    );
    setRules((current) =>
      current.map((item) => (item.id === rule.id ? saved : item))
    );
    if (notify)
      showNotification({
        title: 'Rule saved',
        message: 'Used during future scans. Existing selections are unchanged.',
        color: 'green',
      });
    return saved;
  };

  const saveRow = async (rule) => {
    setBusy(true);
    try {
      if (await save(rule)) setError(null);
    } catch (error) {
      setError(error.message || 'Rule could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const loadPreview = async (draft, target, nextPage, nextPageSize) => {
    const requestId = ++previewRequest.current;
    setPreviewBusy(true);
    setError(null);
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
      if (requestId === previewRequest.current) setPreview(response);
    } catch (error) {
      if (requestId === previewRequest.current)
        setError(error.message || 'Preview could not be loaded.');
    } finally {
      if (requestId === previewRequest.current) setPreviewBusy(false);
    }
  };

  const openPreview = (rule) => {
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
      setError(error.message || 'The rule could not be applied.');
    } finally {
      setPreviewBusy(false);
    }
  };

  const reorder = async ({ active, over }) => {
    if (!over || active.id === over.id) return;
    if (
      !rules.some((rule) => rule.id === active.id) ||
      !rules.some((rule) => rule.id === over.id)
    )
      return;
    const previous = rules;
    const reordered = arrayMove(
      rules,
      rules.findIndex((rule) => rule.id === active.id),
      rules.findIndex((rule) => rule.id === over.id)
    ).map((rule, order) => ({ ...rule, order }));
    setRules(reordered);
    setBusy(true);
    try {
      const saved = reordered.filter((rule) => !rule.isNew);
      await API.reorderM3URules(
        accountId,
        kind,
        saved.map((rule) => rule.id),
        scope,
        saved.map((rule) => rule.order)
      );
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
      setRules((current) =>
        current.filter((rule) => rule.id !== deleteTarget.id)
      );
      setDeleteTarget(null);
    } catch (error) {
      setError(error.message || 'Rule could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const title = streamFilters ? 'Stream filters' : 'Import rules';
  const previewRows = preview?.results || [];
  const refreshedAt = preview?.last_completed_refresh
    ? toUserTime(preview.last_completed_refresh).format(
        `${dateYearFormat} ${timeFormat}`
      )
    : 'Never';

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          First matching rule wins.{' '}
          {streamFilters
            ? 'Filters decide which individual Live streams are imported.'
            : 'Rules decide how new groups are imported. Existing selections change only through Save and apply.'}
        </Text>
        <Button
          size="xs"
          leftSection={<Plus size={14} />}
          onClick={add}
          disabled={busy}
        >
          Add {streamFilters ? 'filter' : 'rule'}
        </Button>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      {busy && <Loader size="sm" />}
      {!rules.length && !busy && (
        <Text c="dimmed" size="sm">
          {streamFilters
            ? 'No filters configured. Streams from enabled groups are imported unless a matching filter excludes them.'
            : "No rules configured. Unmatched groups follow the account's automatic-enable setting."}
        </Text>
      )}
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
                  <TableTh aria-label="Rule order" />
                  <TableTh>{streamFilters ? 'Field' : 'Match'}</TableTh>
                  <TableTh>Regular expression</TableTh>
                  {!streamFilters && <TableTh>Item mode</TableTh>}
                  <TableTh>Result</TableTh>
                  <TableTh>Case</TableTh>
                  {!streamFilters && <TableTh>Active</TableTh>}
                  <TableTh>Actions</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {rules.map((rule) => (
                  <SortableRow key={rule.id} id={rule.id}>
                    <TableTd>
                      <Select
                        size="xs"
                        aria-label={
                          streamFilters ? 'Filter field' : 'Rule match field'
                        }
                        value={
                          streamFilters ? rule.filter_type : rule.match_field
                        }
                        data={
                          streamFilters
                            ? [
                                { value: 'name', label: 'Stream name' },
                                { value: 'url', label: 'Stream URL' },
                                { value: 'group', label: 'Group name' },
                              ]
                            : [
                                { value: 'group_name', label: 'Group name' },
                                { value: 'item_name', label: 'Contained item' },
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
                        value={rule.regex_pattern}
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
                          disabled={rule.match_field !== 'item_name'}
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
                                { value: 'disable', label: 'Import disabled' },
                                { value: 'ignore', label: 'Ignore group' },
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
                                    case_sensitive: event.currentTarget.checked,
                                  },
                                }
                              : { case_sensitive: event.currentTarget.checked }
                          )
                        }
                      />
                    </TableTd>
                    {!streamFilters && (
                      <TableTd>
                        <Checkbox
                          aria-label="Rule active"
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
                        <ActionIcon
                          aria-label="Save rule"
                          variant="subtle"
                          disabled={busy}
                          onClick={() => saveRow(rule)}
                        >
                          <Save size={16} />
                        </ActionIcon>
                        <ActionIcon
                          aria-label="Preview rule"
                          variant="subtle"
                          disabled={busy}
                          onClick={() => openPreview(rule)}
                        >
                          <Eye size={16} />
                        </ActionIcon>
                        <ActionIcon
                          aria-label="Delete rule"
                          color="red"
                          variant="subtle"
                          disabled={busy}
                          onClick={() => setDeleteTarget(rule)}
                        >
                          <Trash2 size={16} />
                        </ActionIcon>
                      </Group>
                    </TableTd>
                  </SortableRow>
                ))}
              </TableTbody>
            </Table>
          </SortableContext>
        </DndContext>
      </ScrollArea>
      <Modal
        opened={!!previewTarget}
        onClose={closePreview}
        title={`${title} preview`}
        size="min(1100px, 94vw)"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            The complete ordered draft is evaluated without saving changes. Only
            entries for which this rule is the first match are shown.
          </Text>
          {!streamFilters && preview && !preview.catalog_complete && (
            <Alert color="yellow">
              No complete group inventory is available yet. Contained-item rules
              use currently imported names. Save the item rule and run a refresh
              once to load names from disabled groups or categories.
            </Alert>
          )}
          {streamFilters && (
            <Alert color={preview?.catalog_complete ? 'blue' : 'yellow'}>
              {preview?.catalog_complete
                ? `Data from the last completed Live refresh: ${refreshedAt}. Excluded streams remain available in this preview.`
                : 'No complete pre-filter catalog is available yet. This preview uses currently imported streams; run a Live refresh once to include excluded streams.'}
              {preview?.refresh_in_progress &&
                ' A refresh is running; this preview still uses the previous completed snapshot.'}
            </Alert>
          )}
          {error && <Alert color="red">{error}</Alert>}
          <Text fw={600}>
            {previewBusy
              ? 'Evaluating…'
              : `${preview?.count || 0} matching ${streamFilters ? 'streams' : 'existing entries'}${streamFilters && preview ? ` from ${preview.inventory_count} candidates` : ''}`}
          </Text>
          <ScrollArea h="55vh">
            <Table striped withTableBorder>
              <TableThead>
                <TableTr>
                  <TableTh>Name</TableTh>
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
                          ? 'Active'
                          : 'Inactive'}
                    </TableTd>
                    <TableTd>
                      {streamFilters
                        ? row.result
                        : row.action === 'ignore'
                          ? 'Unchanged'
                          : row.would_enable
                            ? 'Active'
                            : 'Inactive'}
                    </TableTd>
                    {!streamFilters && <TableTd>{row.item_count}</TableTd>}
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </ScrollArea>
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
          <Group justify="flex-end">
            <Button variant="default" onClick={closePreview}>
              Close
            </Button>
            {!streamFilters && (
              <Button
                onClick={apply}
                loading={previewBusy}
                disabled={
                  !preview || previewTarget?.action === 'ignore' || !!error
                }
              >
                Save and apply to existing
              </Button>
            )}
          </Group>
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
      />
    </Stack>
  );
};

export default M3URulesEditor;
