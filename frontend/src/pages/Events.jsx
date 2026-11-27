import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Hammer, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import API from '../api';
import useAuthStore from '../store/auth';
import useChannelsStore from '../store/channels';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import ConfirmationDialog from '../components/ConfirmationDialog.jsx';
import EventGroupModal from '../components/modals/EventGroupModal.jsx';
import { formatApiError } from '../utils';
import { NEW_GROUP, STATUS_COLORS } from '../utils/eventGroups';
import { useDateTimeFormat, useTimeHelpers } from '../utils/dateTimeUtils.js';

const summaryText = (result) =>
  `${result.events} events: ${result.created} created, ${result.updated} updated, ${result.removed} removed` +
  (result.skipped ? `, ${result.skipped} without a free number` : '');

const editableGroup = (group) => ({
  ...group,
  sources: group.sources.map(String),
  channel_profile_ids: group.channel_profile_ids.map(String),
});

const CurrentEvents = ({ events, onReload, loading }) => {
  const { dateFormat, timeFormat } = useDateTimeFormat();
  const { toUserTime } = useTimeHelpers();
  const time = (value, format) =>
    value ? toUserTime(value).format(format) : '';

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Box>
            <Text fw={600}>Event channels</Text>
            <Text size="xs" c="dimmed">
              Channels of event groups and of event categories with their own
              event channels. Their guide comes from the event.
            </Text>
          </Box>
          <Tooltip label="Reload">
            <ActionIcon
              variant="subtle"
              aria-label="Reload events"
              loading={loading}
              onClick={onReload}
            >
              <RefreshCw size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <ScrollArea.Autosize mah={480} type="auto">
          <Table striped stickyHeader verticalSpacing={4}>
            <TableThead>
              <TableTr>
                <TableTh w={90}>Status</TableTh>
                <TableTh w={170}>Time</TableTh>
                <TableTh>Event</TableTh>
                <TableTh>Channel</TableTh>
                <TableTh>From</TableTh>
                <TableTh w={70}>Streams</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {!events.length && (
                <TableTr>
                  <TableTd colSpan={6}>
                    <Text size="sm" c="dimmed" ta="center">
                      No event channels. Choose “Events” as the use of a Live TV
                      category in its M3U account, or add an event group.
                    </Text>
                  </TableTd>
                </TableTr>
              )}
              {events.map((event) => (
                <TableTr key={event.channel_id}>
                  <TableTd>
                    <Badge
                      size="xs"
                      variant="light"
                      color={STATUS_COLORS[event.status]}
                    >
                      {event.status}
                    </Badge>
                  </TableTd>
                  <TableTd>
                    <Text size="xs">
                      {event.start
                        ? `${time(event.start, `${dateFormat} ${timeFormat}`)}${
                            event.end ? `–${time(event.end, timeFormat)}` : ''
                          }`
                        : '—'}
                    </Text>
                  </TableTd>
                  <TableTd>
                    <Text size="xs">{event.title}</Text>
                    {event.competition && (
                      <Text size="xs" c="dimmed">
                        {event.competition}
                      </Text>
                    )}
                  </TableTd>
                  <TableTd>
                    <Text size="xs">
                      {event.channel_number != null &&
                        `${event.channel_number} · `}
                      {event.channel_name}
                    </Text>
                  </TableTd>
                  <TableTd>
                    <Text size="xs" c="dimmed">
                      {event.source_name}
                    </Text>
                  </TableTd>
                  <TableTd>
                    <Text size="xs">{event.stream_count}</Text>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </ScrollArea.Autosize>
      </Stack>
    </Paper>
  );
};

const EventGroups = ({ groups, busyId, onBuild, onEdit, onDelete }) => {
  const channelGroups = useChannelsStore((s) => s.channelGroups);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Box>
          <Text fw={600}>Event groups</Text>
          <Text size="xs" c="dimmed">
            An event group combines the events of several event categories and
            providers: each current event gets one channel with the streams of
            every provider showing it. Channels of ended events are removed.
            Groups rebuild after each refresh of an account they read.
          </Text>
        </Box>
        <Table striped verticalSpacing={4}>
          <TableThead>
            <TableTr>
              <TableTh>Name</TableTh>
              <TableTh>Channel group</TableTh>
              <TableTh>Numbers</TableTh>
              <TableTh>Channels</TableTh>
              <TableTh w={110} />
            </TableTr>
          </TableThead>
          <TableTbody>
            {!groups.length && (
              <TableTr>
                <TableTd colSpan={5}>
                  <Text size="sm" c="dimmed" ta="center">
                    No event groups yet.
                  </Text>
                </TableTd>
              </TableTr>
            )}
            {groups.map((group) => (
              <TableTr key={group.id}>
                <TableTd>
                  <Group gap={6}>
                    <Text size="sm">{group.name}</Text>
                    {!group.enabled && (
                      <Badge size="xs" color="gray">
                        Paused
                      </Badge>
                    )}
                  </Group>
                </TableTd>
                <TableTd>
                  <Text size="sm">
                    {channelGroups?.[group.channel_group]?.name || '—'}
                  </Text>
                </TableTd>
                <TableTd>
                  <Text size="sm">
                    {group.start_number}–{group.end_number ?? '∞'}
                  </Text>
                </TableTd>
                <TableTd>
                  <Text size="sm">{group.channel_count}</Text>
                </TableTd>
                <TableTd>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label="Build channels now">
                      <ActionIcon
                        variant="subtle"
                        aria-label={`Build ${group.name}`}
                        loading={busyId === group.id}
                        onClick={() => onBuild(group)}
                      >
                        <Hammer size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <ActionIcon
                      variant="subtle"
                      aria-label={`Edit ${group.name}`}
                      onClick={() => onEdit(group)}
                    >
                      <Pencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`Delete ${group.name}`}
                      onClick={() => onDelete(group)}
                    >
                      <Trash2 size={16} />
                    </ActionIcon>
                  </Group>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </Stack>
    </Paper>
  );
};

function PageContent() {
  const [events, setEvents] = useState(null);
  const [groups, setGroups] = useState([]);
  const [sourceOptions, setSourceOptions] = useState([]);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, groupRows, options] = await Promise.all([
        API.getEventChannels(),
        API.getEventGroups(),
        API.getEventGroupSourceOptions(),
      ]);
      setEvents(rows);
      setGroups(groupRows);
      setSourceOptions(options);
    } catch (exc) {
      setError(formatApiError(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id, action, success) => {
    setBusyId(id);
    setError(null);
    try {
      const result = await action();
      if (success) notifications.show(success(result));
      await load();
      API.requeryChannels();
    } catch (exc) {
      setError(formatApiError(exc));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box p="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Title order={2}>Events</Title>
          <Button
            leftSection={<Plus size={16} />}
            onClick={() => setEditing({ ...NEW_GROUP })}
          >
            Add event group
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          Team aliases and public fixtures are in{' '}
          <Anchor component={Link} to="/settings#live-events" size="sm">
            Settings → Live TV → Events and fixtures
          </Anchor>
          .
        </Text>
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        {events === null && !error ? (
          <Loader size="sm" aria-label="Loading events" />
        ) : (
          <>
            <CurrentEvents
              events={events || []}
              loading={loading}
              onReload={load}
            />
            <EventGroups
              groups={groups}
              busyId={busyId}
              onEdit={(group) => setEditing(editableGroup(group))}
              onDelete={setDeleting}
              onBuild={(group) =>
                act(
                  group.id,
                  () => API.buildEventGroup(group.id),
                  (result) => ({
                    title: group.name,
                    message: summaryText(result),
                    color: 'green.5',
                  })
                )
              }
            />
          </>
        )}
      </Stack>
      <EventGroupModal
        group={editing}
        sourceOptions={sourceOptions}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
      <ConfirmationDialog
        opened={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const group = deleting;
          setDeleting(null);
          act(group.id, () => API.deleteEventGroup(group.id));
        }}
        title="Delete event group"
        message={`Delete "${deleting?.name}" and its ${deleting?.channel_count ?? 0} event channels? This cannot be undone.`}
        confirmLabel="Delete"
      />
    </Box>
  );
}

export default function EventsPage() {
  const user = useAuthStore((state) => state.user);
  if (user?.user_level < 10) return <Navigate to="/channels" replace />;
  return (
    <ErrorBoundary inline>
      <PageContent />
    </ErrorBoundary>
  );
}
