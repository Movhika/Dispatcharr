import { useMemo, useState } from 'react';
import {
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
} from '@mantine/core';
import API from '../../api';
import useChannelsStore from '../../store/channels';
import { formatApiError } from '../../utils';
import { STATUS_COLORS } from '../../utils/eventGroups';
import {
  useDateTimeFormat,
  useTimeHelpers,
} from '../../utils/dateTimeUtils.js';

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
                      {event.competition && (
                        <Text size="xs" c="dimmed">
                          {event.competition}
                        </Text>
                      )}
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

// Create or edit one event group; `group` holds the values to start from.
const EventGroupModal = ({ group, sourceOptions, onClose, onSaved }) => (
  <Modal
    opened={!!group}
    onClose={onClose}
    title={group?.id ? `Edit ${group.name}` : 'Add event group'}
    size="xl"
  >
    {group && (
      <EventGroupForm
        value={group}
        sourceOptions={sourceOptions}
        onCancel={onClose}
        onSaved={onSaved}
      />
    )}
  </Modal>
);

export default EventGroupModal;
