import React, { useEffect, useState } from 'react';
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
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { GripVertical, Info, Plus, Save, Trash2 } from 'lucide-react';
import usePlaylistsStore from '../../store/playlists';
import ConfirmationDialog from '../ConfirmationDialog';
import useWarningsStore from '../../store/warnings';
import { M3U_FILTER_TYPES } from '../../constants';
import {
  addM3UFilter,
  deleteM3UFilter,
  updateM3UFilter,
} from '../../utils/forms/M3uFilterUtils.js';
import { showNotification } from '../../utils/notificationUtils.js';

const SortableFilterRow = ({ filterId, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: filterId });

  return (
    <TableTr
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.65 : 1,
        position: 'relative',
        zIndex: isDragging ? 2 : 0,
      }}
    >
      <TableTd>
        <ActionIcon
          aria-label="Move stream filter"
          variant="subtle"
          color="gray"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
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

const M3UFilters = ({ playlist, isOpen, onClose }) => {
  const [filters, setFilters] = useState([]);
  const [savingIds, setSavingIds] = useState(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const fetchPlaylist = usePlaylistsStore((state) => state.fetchPlaylist);
  const isWarningSuppressed = useWarningsStore(
    (state) => state.isWarningSuppressed
  );
  const suppressWarning = useWarningsStore((state) => state.suppressWarning);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    setFilters(playlist?.filters || []);
  }, [playlist]);

  const updateLocal = (id, values) =>
    setFilters((current) =>
      current.map((filter) =>
        filter.id === id ? { ...filter, ...values } : filter
      )
    );

  const addFilter = () => {
    const id = `new-${Date.now()}`;
    setFilters((current) => [
      ...current,
      {
        id,
        isNew: true,
        filter_type: 'group',
        regex_pattern: '',
        exclude: true,
        order: current.length,
        custom_properties: { case_sensitive: false },
      },
    ]);
  };

  const payloadFor = (filter) => ({
    filter_type: filter.filter_type,
    regex_pattern: filter.regex_pattern,
    exclude: !!filter.exclude,
    order: filter.order,
    custom_properties: {
      ...(filter.custom_properties || {}),
      case_sensitive: !!filter.custom_properties?.case_sensitive,
    },
  });

  const saveFilter = async (filter) => {
    if (!filter.regex_pattern.trim()) {
      showNotification({
        title: 'Stream filter was not saved',
        message: 'Enter a regular expression.',
        color: 'red',
      });
      return;
    }
    try {
      new RegExp(filter.regex_pattern);
    } catch (error) {
      showNotification({
        title: 'Stream filter was not saved',
        message: `Invalid regular expression: ${error.message}`,
        color: 'red',
      });
      return;
    }

    setSavingIds((current) => new Set(current).add(filter.id));
    try {
      const saved = filter.isNew
        ? await addM3UFilter(playlist, payloadFor(filter))
        : await updateM3UFilter(playlist, filter, payloadFor(filter));
      const updatedPlaylist = await fetchPlaylist(playlist.id);
      if (updatedPlaylist?.filters) {
        setFilters(updatedPlaylist.filters);
      } else if (saved) {
        setFilters((current) =>
          current.map((item) =>
            item.id === filter.id ? { ...saved, isNew: false } : item
          )
        );
      }
      showNotification({
        title: 'Stream filter saved',
        message: 'The ordered filter is used during future Live TV scans.',
        color: 'green',
      });
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(filter.id);
        return next;
      });
    }
  };

  const deleteFilter = async (id) => {
    const filter = filters.find((item) => item.id === id);
    if (filter?.isNew) {
      setFilters((current) => current.filter((item) => item.id !== id));
      setConfirmDeleteOpen(false);
      return;
    }
    setDeleting(true);
    try {
      await deleteM3UFilter(playlist, id);
      const updatedPlaylist = await fetchPlaylist(playlist.id);
      setFilters(
        updatedPlaylist?.filters ||
          filters.filter((current) => current.id !== id)
      );
    } finally {
      setDeleting(false);
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  const requestDelete = (id) => {
    if (isWarningSuppressed('delete-filter')) {
      deleteFilter(id);
      return;
    }
    setDeleteTarget(id);
    setConfirmDeleteOpen(true);
  };

  const reorderFilters = async ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = filters.findIndex((filter) => filter.id === active.id);
    const newIndex = filters.findIndex((filter) => filter.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const previous = filters;
    const reordered = arrayMove(filters, oldIndex, newIndex).map(
      (filter, index) => ({ ...filter, order: index })
    );
    setFilters(reordered);
    try {
      await Promise.all(
        reordered
          .filter((filter) => !filter.isNew)
          .filter(
            (filter) =>
              previous.find((item) => item.id === filter.id)?.order !==
              filter.order
          )
          .map((filter) =>
            updateM3UFilter(playlist, filter, payloadFor(filter))
          )
      );
      await fetchPlaylist(playlist.id);
    } catch {
      setFilters(previous);
    }
  };

  if (!isOpen || !playlist?.id) return null;

  return (
    <>
      <Modal
        opened={isOpen}
        onClose={onClose}
        title="Stream filters"
        size="95vw"
        scrollAreaComponent={Modal.NativeScrollArea}
        lockScroll={false}
        withinPortal
        yOffset="2vh"
      >
        <Stack pt="md">
          <Group justify="space-between" align="flex-start">
            <Alert icon={<Info size={16} />} color="blue" variant="light">
              <Text size="sm">
                <strong>Order matters.</strong> The first matching rule wins.
                Stream filters decide whether individual Live TV streams are
                imported; category import rules remain separate.
              </Text>
            </Alert>
            <Button
              variant="default"
              size="xs"
              leftSection={<Plus size={14} />}
              onClick={addFilter}
            >
              Add filter
            </Button>
          </Group>

          {filters.length === 0 ? (
            <Alert color="gray">No stream filters configured.</Alert>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={reorderFilters}
            >
              <SortableContext
                items={filters.map((filter) => filter.id)}
                strategy={verticalListSortingStrategy}
              >
                <ScrollArea type="auto">
                  <Table striped withTableBorder miw={900} verticalSpacing="xs">
                    <TableThead>
                      <TableTr>
                        <TableTh w={48} aria-label="Filter order" />
                        <TableTh w={170}>Field</TableTh>
                        <TableTh>Regular expression</TableTh>
                        <TableTh w={120}>Result</TableTh>
                        <TableTh w={90}>Case</TableTh>
                        <TableTh w={90}>Actions</TableTh>
                      </TableTr>
                    </TableThead>
                    <TableTbody>
                      {filters.map((filter) => (
                        <SortableFilterRow key={filter.id} filterId={filter.id}>
                          <TableTd>
                            <Select
                              size="xs"
                              aria-label="Stream filter field"
                              data={M3U_FILTER_TYPES}
                              value={filter.filter_type}
                              onChange={(value) =>
                                updateLocal(filter.id, { filter_type: value })
                              }
                            />
                          </TableTd>
                          <TableTd>
                            <TextInput
                              size="xs"
                              aria-label="Stream filter regular expression"
                              value={filter.regex_pattern}
                              onChange={(event) =>
                                updateLocal(filter.id, {
                                  regex_pattern: event.currentTarget.value,
                                })
                              }
                            />
                          </TableTd>
                          <TableTd>
                            <Select
                              size="xs"
                              aria-label="Stream filter result"
                              data={[
                                { value: 'include', label: 'Include' },
                                { value: 'exclude', label: 'Exclude' },
                              ]}
                              value={filter.exclude ? 'exclude' : 'include'}
                              onChange={(value) =>
                                updateLocal(filter.id, {
                                  exclude: value === 'exclude',
                                })
                              }
                            />
                          </TableTd>
                          <TableTd>
                            <Checkbox
                              aria-label="Case sensitive"
                              checked={
                                filter.custom_properties?.case_sensitive ?? true
                              }
                              onChange={(event) =>
                                updateLocal(filter.id, {
                                  custom_properties: {
                                    ...(filter.custom_properties || {}),
                                    case_sensitive: event.currentTarget.checked,
                                  },
                                })
                              }
                            />
                          </TableTd>
                          <TableTd>
                            <Group gap={4} wrap="nowrap">
                              <ActionIcon
                                aria-label="Save stream filter"
                                color="blue"
                                variant="subtle"
                                loading={savingIds.has(filter.id)}
                                onClick={() => saveFilter(filter)}
                              >
                                <Save size={15} />
                              </ActionIcon>
                              <ActionIcon
                                aria-label="Delete stream filter"
                                color="red"
                                variant="subtle"
                                onClick={() => requestDelete(filter.id)}
                              >
                                <Trash2 size={15} />
                              </ActionIcon>
                            </Group>
                          </TableTd>
                        </SortableFilterRow>
                      ))}
                    </TableTbody>
                  </Table>
                </ScrollArea>
              </SortableContext>
            </DndContext>
          )}
        </Stack>
      </Modal>

      <ConfirmationDialog
        opened={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => deleteFilter(deleteTarget)}
        loading={deleting}
        title="Confirm Filter Deletion"
        message="Are you sure you want to delete this stream filter? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        actionKey="delete-filter"
        onSuppressChange={suppressWarning}
        size="md"
      />
    </>
  );
};

export default M3UFilters;
