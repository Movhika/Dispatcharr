import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  MultiSelect,
  ScrollArea,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Textarea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import API from '../../api';
import usePlaylistsStore from '../../store/playlists';
import { formatApiError } from '../../utils';
import { aliasesToText, textToAliases } from '../../utils/streamMatchAliases';

const CATCHUP_OPTIONS = [
  { value: 'include', label: 'Include catch-up' },
  { value: 'exclude', label: 'Without catch-up' },
  { value: 'only', label: 'Only catch-up' },
];

const StreamLine = ({ stream, removed = false }) => (
  <Group gap={6} wrap="nowrap">
    <Text
      size="xs"
      truncate
      td={removed ? 'line-through' : undefined}
      c={removed || stream.match === 'kept' ? 'dimmed' : undefined}
      title={`${stream.account || ''} · ${stream.group || ''}`}
    >
      {stream.name}
    </Text>
    {stream.new && (
      <Badge size="xs" color="green" variant="light">
        New
      </Badge>
    )}
    {stream.match === 'similar' && (
      <Badge size="xs" color="yellow" variant="light">
        Similar name
      </Badge>
    )}
    {stream.match === 'kept' && (
      <Badge size="xs" color="gray" variant="light">
        No match, kept
      </Badge>
    )}
    {stream.catchup && (
      <Badge size="xs" color="blue" variant="light">
        Catch-up
      </Badge>
    )}
    {removed && (
      <Badge size="xs" color="red" variant="light">
        Removed
      </Badge>
    )}
  </Group>
);

const StreamMatchModal = ({ opened, onClose, channelIds = [], onApplied }) => {
  const playlists = usePlaylistsStore((state) => state.playlists);
  const [accountIds, setAccountIds] = useState([]);
  const [countries, setCountries] = useState([]);
  const [catchup, setCatchup] = useState('include');
  const [keepUnmatched, setKeepUnmatched] = useState(true);
  const [aliasText, setAliasText] = useState('');
  const [result, setResult] = useState(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const request = useRef(0);

  const accountOptions = useMemo(
    () =>
      playlists
        .filter((playlist) => playlist.is_active && !playlist.locked)
        .map((playlist) => ({
          value: String(playlist.id),
          label: playlist.name,
        })),
    [playlists]
  );

  const countryOptions = useMemo(
    () =>
      Object.entries(result?.countries || {})
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => ({
          value: code,
          label: `${code} (${count})`,
        })),
    [result]
  );

  const run = useCallback(
    async ({ dryRun = true, aliases } = {}) => {
      const current = ++request.current;
      setBusy(true);
      setError(null);
      try {
        const response = await API.matchChannelStreams({
          channel_ids: channelIds,
          account_ids: accountIds.map(Number),
          countries,
          catchup,
          keep_unmatched: keepUnmatched,
          dry_run: dryRun,
          ...(aliases === undefined ? {} : { aliases }),
        });
        if (current !== request.current) return null;
        setResult(response);
        return response;
      } catch (exc) {
        if (current === request.current) setError(formatApiError(exc));
        return null;
      } finally {
        if (current === request.current) setBusy(false);
      }
    },
    [channelIds, accountIds, countries, catchup, keepUnmatched]
  );

  // The first preview loads the saved aliases into the editor.
  useEffect(() => {
    if (!opened) return;
    setResult(null);
    setError(null);
    run().then((response) => {
      if (response) setAliasText(aliasesToText(response.aliases));
    });
    // Options start from their defaults on every open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const preview = () => run({ aliases: textToAliases(aliasText) });

  const apply = async () => {
    const response = await run({
      dryRun: false,
      aliases: textToAliases(aliasText),
    });
    if (!response) return;
    notifications.show({
      title: 'Streams assigned',
      message: `${response.changed} channel${response.changed === 1 ? '' : 's'} updated.`,
      color: 'green',
    });
    await onApplied?.();
    onClose();
  };

  const rows = (result?.channels || []).filter(
    (row) => showUnchanged || row.changed
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Match streams by channel name"
      size="xl"
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Finds the streams of enabled categories whose names match the channel
          names, ignoring country prefixes, quality tags and spelling variants.
          Event categories are left out. Streams are ordered by quality.
        </Text>
        <Group grow align="flex-start">
          <MultiSelect
            label="Accounts"
            placeholder="All active accounts"
            data={accountOptions}
            value={accountIds}
            onChange={setAccountIds}
            clearable
          />
          <MultiSelect
            label="Countries"
            placeholder="All countries"
            description="Streams without a country prefix always count."
            data={countryOptions}
            value={countries}
            onChange={setCountries}
            clearable
          />
        </Group>
        <Group justify="space-between">
          <SegmentedControl
            size="xs"
            data={CATCHUP_OPTIONS}
            value={catchup}
            onChange={setCatchup}
          />
          <Switch
            size="xs"
            label="Keep current streams without a match"
            checked={keepUnmatched}
            onChange={(event) => setKeepUnmatched(event.currentTarget.checked)}
          />
        </Group>
        <Textarea
          label="Aliases"
          description='Names that mean the same channel, one group per line, e.g. "RTL Nitro = Nitro". Numbered names like "DAZN UEFA Champions League 3" are covered too.'
          autosize
          minRows={2}
          maxRows={6}
          value={aliasText}
          onChange={(event) => setAliasText(event.currentTarget.value)}
        />
        <Group justify="space-between">
          <Text size="sm">
            {result
              ? `${result.changed} of ${result.channels.length} channels change`
              : ' '}
          </Text>
          <Group gap="xs">
            <Switch
              size="xs"
              label="Show unchanged"
              checked={showUnchanged}
              onChange={(event) =>
                setShowUnchanged(event.currentTarget.checked)
              }
            />
            <Button
              size="xs"
              variant="default"
              onClick={preview}
              disabled={busy}
            >
              Preview
            </Button>
          </Group>
        </Group>
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <ScrollArea h={360} type="auto">
          {busy && !result ? (
            <Group justify="center" py="xl">
              <Loader size="sm" />
            </Group>
          ) : (
            <Table striped stickyHeader verticalSpacing={4}>
              <TableThead>
                <TableTr>
                  <TableTh w="30%">Channel</TableTh>
                  <TableTh>Streams in order</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {!rows.length && (
                  <TableTr>
                    <TableTd colSpan={2}>
                      <Text size="sm" c="dimmed" ta="center" py="md">
                        {result ? 'No channel changes.' : ''}
                      </Text>
                    </TableTd>
                  </TableTr>
                )}
                {rows.map((row) => (
                  <TableTr key={row.id}>
                    <TableTd valign="top">
                      <Text size="sm">
                        {row.channel_number != null
                          ? `${row.channel_number} · `
                          : ''}
                        {row.name}
                      </Text>
                    </TableTd>
                    <TableTd>
                      <Stack gap={2}>
                        {!row.streams.length && !row.removed.length && (
                          <Text size="xs" c="dimmed">
                            No matching streams
                          </Text>
                        )}
                        {row.streams.map((stream) => (
                          <StreamLine key={stream.id} stream={stream} />
                        ))}
                        {row.removed.map((stream) => (
                          <StreamLine key={stream.id} stream={stream} removed />
                        ))}
                      </Stack>
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          )}
        </ScrollArea>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={apply}
            loading={busy && !!result}
            disabled={!result || !result.changed}
          >
            Apply
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default StreamMatchModal;
