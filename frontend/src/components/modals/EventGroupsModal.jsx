import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Hammer, Pencil, Trash2 } from 'lucide-react';
import API from '../../api';
import ConfirmationDialog from '../ConfirmationDialog';
import useChannelsStore from '../../store/channels';
import { formatApiError } from '../../utils';
import { aliasesToText, textToAliases } from '../../utils/streamMatchAliases';
import {
  useDateTimeFormat,
  useTimeHelpers,
} from '../../utils/dateTimeUtils.js';

const NEW_GROUP = {
  name: '',
  enabled: true,
  channel_group: null,
  sources: [],
  start_number: 1,
  end_number: null,
  lookahead_hours: 24,
  include_untimed: false,
  name_format: 'title_time',
  channel_profile_ids: [],
};

const STATUS_COLORS = { live: 'red', upcoming: 'blue', unknown: 'gray' };

const summaryText = (result) =>
  `${result.events} events: ${result.created} created, ${result.updated} updated, ${result.removed} removed` +
  (result.skipped ? `, ${result.skipped} without a free number` : '');

const EventGroupForm = ({ value, sourceOptions, onCancel, onSaved }) => {
  const channelGroups = useChannelsStore((s) => s.channelGroups);
  const profiles = useChannelsStore((s) => s.profiles);
  const [form, setForm] = useState(value);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { dateFormat, timeFormat } = useDateTimeFormat();
  const { toUserTime } = useTimeHelpers();
  const set = (values) => setForm((current) => ({ ...current, ...values }));

  const groupOptions = useMemo(
    () =>
      Object.values(channelGroups || {})
        .map((group) => ({ value: String(group.id), label: group.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [channelGroups]
  );
  const profileOptions = useMemo(
    () =>
      Object.values(profiles || {})
        .filter((profile) => profile.id !== 0)
        .map((profile) => ({ value: String(profile.id), label: profile.name })),
    [profiles]
  );
  const sourceData = useMemo(
    () =>
      sourceOptions.map((option) => ({
        value: String(option.id),
        label: option.is_event ? `${option.label} (event)` : option.label,
      })),
    [sourceOptions]
  );

  const payload = () => ({
    ...form,
    channel_group: form.channel_group ? Number(form.channel_group) : null,
    sources: form.sources.map(Number),
    channel_profile_ids: form.channel_profile_ids.map(Number),
  });

  const run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (exc) {
      setError(formatApiError(exc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="sm">
      <Group grow align="flex-start">
        <TextInput
          label="Name"
          required
          value={form.name}
          onChange={(event) => set({ name: event.currentTarget.value })}
        />
        <Select
          label="Channel group of the event channels"
          data={groupOptions}
          searchable
          value={form.channel_group ? String(form.channel_group) : null}
          onChange={(value) => set({ channel_group: value })}
        />
      </Group>
      <MultiSelect
        label="Event categories"
        description="Categories whose events are combined. Marked event categories are listed first."
        data={sourceData}
        searchable
        value={form.sources.map(String)}
        onChange={(values) => set({ sources: values })}
      />
      <Group grow align="flex-start">
        <NumberInput
          label="First channel number"
          min={1}
          value={form.start_number}
          onChange={(value) => set({ start_number: value || 1 })}
        />
        <NumberInput
          label="Last channel number"
          placeholder="No limit"
          min={1}
          value={form.end_number ?? ''}
          onChange={(value) => set({ end_number: value === '' ? null : value })}
        />
        <NumberInput
          label="Events starting within (hours)"
          min={1}
          max={336}
          value={form.lookahead_hours}
          onChange={(value) => set({ lookahead_hours: value || 24 })}
        />
      </Group>
      <Group grow align="flex-start">
        <Select
          label="Channel names"
          allowDeselect={false}
          data={[
            { value: 'title_time', label: 'Event and start time' },
            { value: 'title', label: 'Event only' },
          ]}
          value={form.name_format}
          onChange={(value) => set({ name_format: value })}
        />
        <MultiSelect
          label="Channel profiles"
          placeholder="All profiles"
          data={profileOptions}
          value={form.channel_profile_ids.map(String)}
          onChange={(values) => set({ channel_profile_ids: values })}
        />
      </Group>
      <Group>
        <Switch
          label="Also events without a start time"
          checked={form.include_untimed}
          onChange={(event) =>
            set({ include_untimed: event.currentTarget.checked })
          }
        />
        <Switch
          label="Enabled"
          checked={form.enabled}
          onChange={(event) => set({ enabled: event.currentTarget.checked })}
        />
      </Group>
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}
      {preview && (
        <ScrollArea h={240} type="auto">
          <Table striped stickyHeader verticalSpacing={4}>
            <TableThead>
              <TableTr>
                <TableTh>Event</TableTh>
                <TableTh w={130}>Start</TableTh>
                <TableTh>Streams</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {!preview.length && (
                <TableTr>
                  <TableTd colSpan={3}>
                    <Text size="sm" c="dimmed" ta="center">
                      No current events in these categories.
                    </Text>
                  </TableTd>
                </TableTr>
              )}
              {preview.map((event) => (
                <TableTr key={`${event.title}-${event.start}`}>
                  <TableTd>
                    <Group gap={6} wrap="nowrap">
                      <Text size="xs">{event.title}</Text>
                      <Badge
                        size="xs"
                        variant="light"
                        color={STATUS_COLORS[event.status]}
                      >
                        {event.status}
                      </Badge>
                    </Group>
                  </TableTd>
                  <TableTd>
                    <Text size="xs">
                      {event.start
                        ? toUserTime(event.start).format(
                            `${dateFormat} ${timeFormat}`
                          )
                        : '—'}
                    </Text>
                  </TableTd>
                  <TableTd>
                    <Text
                      size="xs"
                      title={event.streams.map((s) => s.name).join('\n')}
                    >
                      {event.streams.length} from{' '}
                      {[...new Set(event.streams.map((s) => s.account))].join(
                        ', '
                      )}
                    </Text>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </ScrollArea>
      )}
      <Group justify="space-between">
        <Button
          variant="default"
          loading={busy}
          onClick={() =>
            run(async () => setPreview(await API.previewEventGroup(payload())))
          }
        >
          Preview events
        </Button>
        <Group gap="xs">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!form.name.trim()}
            onClick={() =>
              run(async () => {
                await API.saveEventGroup(form.id, payload());
                onSaved();
              })
            }
          >
            Save
          </Button>
        </Group>
      </Group>
    </Stack>
  );
};

const EventGroupsModal = ({ opened, onClose }) => {
  const channelGroups = useChannelsStore((s) => s.channelGroups);
  const [groups, setGroups] = useState([]);
  const [sourceOptions, setSourceOptions] = useState([]);
  const [editing, setEditing] = useState(null);
  const [aliasText, setAliasText] = useState('');
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rows, options, aliases] = await Promise.all([
        API.getEventGroups(),
        API.getEventGroupSourceOptions(),
        API.getEventTeamAliases(),
      ]);
      setGroups(rows);
      setSourceOptions(options);
      setAliasText(aliasesToText(aliases.aliases));
    } catch (exc) {
      setError(formatApiError(exc));
    }
  }, []);

  useEffect(() => {
    if (opened) {
      setEditing(null);
      load();
    }
  }, [opened, load]);

  const act = async (id, action, success) => {
    setBusyId(id);
    setError(null);
    try {
      const result = await action();
      if (success) notifications.show(success(result));
      await load();
    } catch (exc) {
      setError(formatApiError(exc));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Event groups" size="xl">
      <ConfirmationDialog
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          const group = deleteTarget;
          setDeleteTarget(null);
          act(group.id, () => API.deleteEventGroup(group.id));
        }}
        title="Delete event group"
        message={`Delete "${deleteTarget?.name}" and its ${deleteTarget?.channel_count ?? 0} event channels? This cannot be undone.`}
        confirmLabel="Delete"
        zIndex={1100}
      />
      {editing ? (
        <EventGroupForm
          value={editing}
          sourceOptions={sourceOptions}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            An event group combines the events of several event categories and
            providers: each current event gets one channel with the streams of
            every provider showing it. Channels of ended events are removed.
            Groups rebuild after each refresh of an account they read.
          </Text>
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
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
                          onClick={() =>
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
                        >
                          <Hammer size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <ActionIcon
                        variant="subtle"
                        aria-label={`Edit ${group.name}`}
                        onClick={() =>
                          setEditing({
                            ...group,
                            sources: group.sources.map(String),
                            channel_profile_ids:
                              group.channel_profile_ids.map(String),
                          })
                        }
                      >
                        <Pencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`Delete ${group.name}`}
                        onClick={() => setDeleteTarget(group)}
                      >
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Group>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
          <Group justify="flex-end">
            <Button onClick={() => setEditing({ ...NEW_GROUP })}>
              Add event group
            </Button>
          </Group>
          <Textarea
            label="Team aliases"
            description='Names of the same team, one team per line, e.g. "Bayern Munich = Bayern München = FC Bayern". Club words like FC or SC and accents are ignored anyway.'
            autosize
            minRows={3}
            maxRows={8}
            value={aliasText}
            onChange={(event) => setAliasText(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              loading={busyId === 'aliases'}
              onClick={() =>
                act(
                  'aliases',
                  () => API.saveEventTeamAliases(textToAliases(aliasText)),
                  () => ({ message: 'Team aliases saved.', color: 'green.5' })
                )
              }
            >
              Save aliases
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
};

export default EventGroupsModal;
