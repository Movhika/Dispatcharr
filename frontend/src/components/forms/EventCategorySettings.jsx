import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
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
import { formatApiError } from '../../utils';
import {
  useDateTimeFormat,
  useTimeHelpers,
} from '../../utils/dateTimeUtils.js';

const TIMEZONE_OPTIONS = [
  'UTC',
  'ET',
  'CT',
  'PT',
  'UK',
  'CET',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
];

const STATUS_BADGES = {
  live: { color: 'red', label: 'Live' },
  upcoming: { color: 'blue', label: 'Upcoming' },
  unknown: { color: 'gray', label: 'No time' },
  ended: { color: 'dark', label: 'Ended' },
  none: { color: 'dark', label: 'No event' },
};

const EventCategorySettings = ({ group, playlist, onApplyGroupChange }) => {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { dateFormat, timeFormat } = useDateTimeFormat();
  const { toUserTime } = useTimeHelpers();
  const props = group.custom_properties || {};
  const isEvent = !!group.metadata_defaults?.is_event;

  const setProps = (values) =>
    onApplyGroupChange({
      ...group,
      custom_properties: { ...props, ...values },
    });

  const toggleEvent = (checked) => {
    const { is_event: _ignored, ...rest } = group.metadata_defaults || {};
    onApplyGroupChange({
      ...group,
      metadata_defaults: checked ? { ...rest, is_event: true } : rest,
    });
  };

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const settings = Object.fromEntries(
        Object.entries(props).filter(([key]) => key.startsWith('event_'))
      );
      setPreview(
        await API.previewEventCategory(
          playlist.id,
          group.channel_group,
          settings
        )
      );
    } catch (exc) {
      setPreview(null);
      setError(formatApiError(exc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper withBorder p="sm">
      <Stack gap="sm" role="group" aria-label="Event settings">
        <Text fw={600}>Events</Text>
        <Checkbox
          label="Event category"
          description="The streams are numbered slots whose names describe the current event."
          checked={isEvent}
          onChange={(event) => toggleEvent(event.currentTarget.checked)}
        />
        {isEvent && (
          <>
            <Group grow align="flex-start">
              <Autocomplete
                label="Timezone of the names"
                description="Used when a name has a time without a timezone."
                data={TIMEZONE_OPTIONS}
                value={props.event_timezone || 'UTC'}
                onChange={(value) => setProps({ event_timezone: value })}
              />
              <NumberInput
                label="Event duration (minutes)"
                description="Used when a name has no end time."
                min={1}
                max={1440}
                value={props.event_duration_minutes ?? 180}
                onChange={(value) =>
                  setProps({
                    event_duration_minutes: value === '' ? null : value,
                  })
                }
              />
            </Group>
            <TextInput
              label="Own pattern (optional)"
              description="A regular expression with the named group title and optionally date, time and zone. Names it does not match use the automatic recognition."
              placeholder="^(?<title>.+?) @ (?<date>\d+ \w+) (?<time>\d+:\d+ [AP]M)"
              value={props.event_pattern || ''}
              onChange={(event) =>
                setProps({ event_pattern: event.currentTarget.value })
              }
            />
            <Switch
              label="Only create channels for current events"
              description="Auto sync leaves out slots without an event and events that have ended."
              checked={props.event_filter === 'current'}
              onChange={(event) =>
                setProps({
                  event_filter: event.currentTarget.checked ? 'current' : 'all',
                })
              }
            />
            <Switch
              label="Name channels after the event"
              description="Uses the event title; the rename settings still apply to it."
              checked={!!props.event_channel_name}
              onChange={(event) =>
                setProps({ event_channel_name: event.currentTarget.checked })
              }
            />
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                {preview
                  ? Object.entries(preview.counts)
                      .map(
                        ([status, count]) =>
                          `${count} ${STATUS_BADGES[status]?.label.toLowerCase() || status}`
                      )
                      .join(' · ')
                  : 'Test the settings with the current stream names.'}
              </Text>
              <Button
                size="xs"
                variant="default"
                onClick={runPreview}
                loading={busy}
              >
                Preview events
              </Button>
            </Group>
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            {preview && (
              <ScrollArea h={260} type="auto">
                <Table striped stickyHeader verticalSpacing={4}>
                  <TableThead>
                    <TableTr>
                      <TableTh>Stream</TableTh>
                      <TableTh>Event</TableTh>
                      <TableTh w={130}>Start</TableTh>
                      <TableTh w={100}>Status</TableTh>
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {preview.rows.map((row) => (
                      <TableTr
                        key={row.id}
                        style={row.kept ? undefined : { opacity: 0.5 }}
                      >
                        <TableTd>
                          <Text size="xs">{row.name}</Text>
                        </TableTd>
                        <TableTd>
                          <Text size="xs">{row.title || '—'}</Text>
                        </TableTd>
                        <TableTd>
                          <Text size="xs">
                            {row.start
                              ? toUserTime(row.start).format(
                                  `${dateFormat} ${timeFormat}`
                                )
                              : '—'}
                          </Text>
                        </TableTd>
                        <TableTd>
                          <Badge
                            size="xs"
                            variant="light"
                            color={STATUS_BADGES[row.status]?.color}
                          >
                            {STATUS_BADGES[row.status]?.label || row.status}
                          </Badge>
                        </TableTd>
                      </TableTr>
                    ))}
                  </TableTbody>
                </Table>
              </ScrollArea>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
};

export default EventCategorySettings;
