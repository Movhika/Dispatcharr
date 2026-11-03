import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Navigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Flex,
  Group,
  Image,
  Loader,
  Paper,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  Eye,
  EyeOff,
  Film,
  Plus,
  RefreshCw,
  SquarePen,
  Trash2,
} from 'lucide-react';
import API from '../api';
import useAuthStore from '../store/auth';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import ConfirmationDialog from '../components/ConfirmationDialog.jsx';
import SourceStatus from '../components/SourceStatus.jsx';
import tableClasses from '../components/tables/M3UsTable.module.css';
import { formatApiError } from '../utils';
import { useDateTimeFormat } from '../utils/dateTimeUtils.js';
import { toDayMonth } from '../utils/libraryFilters.js';
import { showNotification } from '../utils/notificationUtils.js';
import {
  BUILD_STATUS,
  LIST_TYPES,
  itemsText,
  newList,
  optionLabel,
  tmdbItemUrl,
} from '../utils/vodLists';
import { durationText } from '../utils/vodProfiles';

// Loaded on demand like the profile dialog; it shares the Library styles.
const VODListDialog = React.lazy(
  () => import('../components/forms/VODListDialog.jsx')
);
const VODListPreview = React.lazy(
  () => import('../components/forms/VODListPreview.jsx')
);
dayjs.extend(relativeTime);

// When the list was last built and how long it took, beside its controls.
function LastRefresh({ vodList }) {
  const { fullDateTimeFormat } = useDateTimeFormat();
  if (!vodList.built_at) return null;
  const seconds = vodList.build_counts?.seconds;
  const manual = vodList.list_type === 'manual';
  return (
    <Tooltip label={dayjs(vodList.built_at).format(fullDateTimeFormat)}>
      <Box style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
        <Text size="xs" fw={600}>
          {manual ? 'Last change' : 'Last refresh'}
        </Text>
        <Text size="xs" c="dimmed">
          {[
            dayjs(vodList.built_at).fromNow(),
            !manual && seconds != null && durationText(seconds),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Box>
    </Tooltip>
  );
}

const POSTER_WIDTH = 116;
const POSTER_GAP = 8;

const busy = (vodList) =>
  ['pending', 'building'].includes(vodList.build_status);

// Report builds that finished since the last load, such as after a save.
function announceBuilds(before, after) {
  const wasBusy = new Set(before.filter(busy).map((vodList) => vodList.id));
  after
    .filter((vodList) => wasBusy.has(vodList.id) && !busy(vodList))
    .forEach((vodList) =>
      showNotification(
        vodList.build_status === 'failed'
          ? {
              title: `Could not update ${vodList.name}`,
              message: vodList.build_error || undefined,
              color: 'red',
            }
          : {
              title: `Updated ${vodList.name}`,
              message: itemsText(vodList.build_counts) || undefined,
              color: 'green',
            }
      )
    );
}

// The first titles of a list like the original installation: titles in the
// Library open their preview, the others are greyed; the row fades out when
// the list holds more than fit.
function PosterRow({ vodList, onOpen }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const items = vodList.preview || [];
  if (!items.length)
    return (
      <Text size="sm" c="dimmed">
        No titles yet.
      </Text>
    );
  const fits = width
    ? Math.max(
        1,
        Math.floor((width + POSTER_GAP) / (POSTER_WIDTH + POSTER_GAP))
      )
    : items.length;
  const shown = items.slice(0, fits);
  const more = (vodList.build_counts?.titles || 0) > shown.length;
  const fade = Math.min(4, Math.max(1, Math.round(fits * 0.4))) * POSTER_WIDTH;
  const mask = more
    ? `linear-gradient(to right, #000 0%, #000 calc(100% - ${fade}px), transparent 100%)`
    : undefined;
  return (
    <Box ref={ref} style={{ overflow: 'hidden' }}>
      <Group
        gap={POSTER_GAP}
        wrap="nowrap"
        aria-label="First titles"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        {shown.map((item) => {
          const open = item.available && item.content_id;
          // Titles missing from the Library open on TMDB instead.
          const link = !open && tmdbItemUrl(item);
          return (
            <Tooltip
              key={item.id}
              label={link ? `${item.title} · Open on TMDB` : item.title}
              withArrow
              openDelay={300}
            >
              <Box
                component={open ? 'button' : link ? 'a' : 'div'}
                type={open ? 'button' : undefined}
                href={link || undefined}
                target={link ? '_blank' : undefined}
                rel={link ? 'noopener noreferrer' : undefined}
                aria-label={
                  open
                    ? `Preview ${item.title}`
                    : link
                      ? `Open ${item.title} on TMDB`
                      : undefined
                }
                onClick={open ? () => onOpen(item) : undefined}
                pos="relative"
                w={POSTER_WIDTH}
                h={174}
                style={{
                  flex: '0 0 auto',
                  border: 0,
                  padding: 0,
                  borderRadius: 6,
                  overflow: 'hidden',
                  background: 'var(--mantine-color-dark-6)',
                  display: 'block',
                  cursor: open || link ? 'pointer' : 'default',
                }}
              >
                {item.poster_url ? (
                  <Image
                    src={item.poster_url}
                    alt={item.title}
                    w="100%"
                    h="100%"
                    fit="cover"
                  />
                ) : (
                  <Box
                    h="100%"
                    style={{ display: 'grid', placeItems: 'center' }}
                  >
                    <Film size={24} opacity={0.55} />
                  </Box>
                )}
                {!item.available && (
                  <Box
                    pos="absolute"
                    inset={0}
                    bg="rgba(24, 24, 27, 0.72)"
                    style={{ display: 'grid', placeItems: 'center' }}
                  >
                    <Text size="xs" ta="center" px={4} c="gray.3">
                      Not in library
                    </Text>
                  </Box>
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Group>
    </Box>
  );
}

function ListCard({
  vodList,
  onToggle,
  onPreview,
  onEdit,
  onRebuild,
  onDelete,
}) {
  const status = BUILD_STATUS[vodList.build_status];
  const manual = vodList.list_type === 'manual';
  return (
    <Paper
      component="article"
      aria-label={`${vodList.name} list`}
      className={tableClasses.card}
      withBorder
      p="md"
      radius="md"
      style={
        vodList.is_enabled
          ? undefined
          : { opacity: 0.65, filter: 'grayscale(0.75)' }
      }
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Box style={{ minWidth: 0, flex: '1 1 200px' }}>
            <Group gap="xs">
              <Text fw={700} size="lg" truncate className={tableClasses.name}>
                {vodList.display_name}
              </Text>
              <Badge variant="light" color="gray">
                {optionLabel(LIST_TYPES, vodList.list_type)}
              </Badge>
              {vodList.is_enabled ? (
                <SourceStatus
                  label={status?.label || vodList.build_status}
                  color={status?.color}
                  messages={
                    vodList.build_status === 'failed'
                      ? [vodList.build_error]
                      : []
                  }
                  messageColor="red"
                />
              ) : (
                <SourceStatus label="Disabled" color="gray" />
              )}
              {vodList.is_enabled && !vodList.visible && (
                <Tooltip
                  label={
                    vodList.list_type === 'tmdb' &&
                    (vodList.refresh_interval || vodList.cron_expression)
                      ? 'Clients do not see it outside its visible period. Scheduled refreshes pause and it refreshes once when it shows again.'
                      : 'Clients do not see it outside its visible period.'
                  }
                  multiline
                  w={260}
                >
                  <Badge
                    variant="light"
                    color="gray"
                    leftSection={<EyeOff size={12} />}
                  >
                    {vodList.visible_from
                      ? `Hidden until ${toDayMonth(vodList.visible_from)}.`
                      : 'Hidden'}
                  </Badge>
                </Tooltip>
              )}
            </Group>
            <Text size="sm" c="dimmed" truncate>
              {itemsText(vodList.build_counts) || 'Not built yet'}
            </Text>
          </Box>
          <Group gap="md" justify="flex-end">
            <LastRefresh vodList={vodList} />
            <Group gap="xs" align="stretch" wrap="nowrap">
              <Tooltip label="Enable or disable this list" withArrow>
                <Paper
                  className={tableClasses.controls}
                  withBorder
                  px={6}
                  py={4}
                  radius="md"
                  role="group"
                  aria-label={`Enabled state for ${vodList.name}`}
                >
                  <Switch
                    size="sm"
                    aria-label={`Enable ${vodList.name}`}
                    checked={vodList.is_enabled}
                    onChange={() => onToggle(vodList)}
                  />
                </Paper>
              </Tooltip>
              <Paper
                className={tableClasses.controls}
                withBorder
                px={6}
                py={4}
                radius="md"
                role="group"
                aria-label={`Actions for ${vodList.name}`}
              >
                <Flex gap={4} align="center" wrap="nowrap">
                  <Tooltip label="Refresh list">
                    <ActionIcon
                      aria-label={`Refresh ${vodList.name}`}
                      variant="subtle"
                      size="md"
                      color="blue.5"
                      disabled={manual || busy(vodList)}
                      onClick={() => onRebuild(vodList)}
                    >
                      <RefreshCw size={17} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Preview titles">
                    <ActionIcon
                      aria-label={`Preview ${vodList.name}`}
                      variant="subtle"
                      size="md"
                      color="blue.5"
                      onClick={() => onPreview({ list: vodList })}
                    >
                      <Eye size={17} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Edit list">
                    <ActionIcon
                      aria-label={`Edit ${vodList.name}`}
                      variant="subtle"
                      size="md"
                      color="yellow"
                      onClick={() => onEdit(vodList)}
                    >
                      <SquarePen size={17} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Delete list">
                    <ActionIcon
                      aria-label={`Delete ${vodList.name}`}
                      variant="subtle"
                      size="md"
                      color="red"
                      onClick={() => onDelete(vodList)}
                    >
                      <Trash2 size={17} />
                    </ActionIcon>
                  </Tooltip>
                </Flex>
              </Paper>
            </Group>
          </Group>
        </Group>
        <PosterRow
          vodList={vodList}
          onOpen={(item) => onPreview({ list: vodList, item })}
        />
      </Stack>
    </Paper>
  );
}

function PageContent() {
  const [lists, setLists] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const loaded = useRef(null);
  const load = useCallback(async () => {
    try {
      const next = await API.getVODLists();
      if (loaded.current) announceBuilds(loaded.current, next);
      loaded.current = next;
      setLists(next);
      setError('');
    } catch (err) {
      setError(formatApiError(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the status badges current while lists are built.
  const building = lists?.some(busy);
  useEffect(() => {
    if (!building) return undefined;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [building, load]);

  const run = async (action, failure) => {
    try {
      await action();
      await load();
    } catch (err) {
      showNotification({
        title: failure,
        message: formatApiError(err),
        color: 'red',
      });
    }
  };

  const remove = async () => {
    const vodList = deleting;
    setDeleting(null);
    await run(async () => {
      await API.deleteVODList(vodList.id);
      showNotification({ title: `Deleted ${vodList.name}`, color: 'green' });
    }, 'Could not delete the list');
  };

  return (
    <Box p="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Title order={2}>Lists</Title>
          <Button
            leftSection={<Plus size={16} />}
            onClick={() => setEditing(newList())}
          >
            Add list
          </Button>
        </Group>
        {error && (
          <Alert color="red" title="Lists could not be loaded">
            {error}
          </Alert>
        )}
        {!lists && !error && <Loader size="sm" aria-label="Loading lists" />}
        {lists && !lists.length && (
          <Text c="dimmed">
            No lists yet. Lists become client categories in profiles that use
            Lists as categories.
          </Text>
        )}
        {lists && (
          <Stack gap="md">
            {lists.map((vodList) => (
              <ListCard
                key={vodList.id}
                vodList={vodList}
                onToggle={(item) =>
                  run(
                    () =>
                      API.saveVODList(
                        { is_enabled: !item.is_enabled },
                        item.id
                      ),
                    `Could not update ${item.name}`
                  )
                }
                onPreview={setPreviewing}
                onEdit={setEditing}
                onRebuild={(item) =>
                  run(
                    () => API.rebuildVODList(item.id),
                    `Could not refresh ${item.name}`
                  )
                }
                onDelete={setDeleting}
              />
            ))}
          </Stack>
        )}
      </Stack>
      {editing && (
        <Suspense fallback={null}>
          <VODListDialog
            vodList={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        </Suspense>
      )}
      {previewing && (
        <Suspense fallback={null}>
          <VODListPreview
            list={previewing.list}
            item={previewing.item}
            onClose={() => setPreviewing(null)}
            onChanged={load}
          />
        </Suspense>
      )}
      <ConfirmationDialog
        opened={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={`Delete ${deleting?.name || 'list'}?`}
        message="The list and its titles are removed."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </Box>
  );
}

export default function VODListsPage() {
  const user = useAuthStore((state) => state.user);
  if (user?.user_level < 10) return <Navigate to="/channels" replace />;
  return (
    <ErrorBoundary inline>
      <PageContent />
    </ErrorBoundary>
  );
}
