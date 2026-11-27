import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { ListPlus, Search } from 'lucide-react';
import API from '../../api';
import useChannelsStore from '../../store/channels';
import usePlaylistsStore from '../../store/playlists';
import { formatApiError } from '../../utils';

// Finds a stream by name or category and adds it to one channel; a stream
// added by hand stays with the channel when its rule changes.
const AddChannelStream = ({ channel, streams = [] }) => {
  const [query, setQuery] = useState('');
  const [unassigned, setUnassigned] = useState(true);
  const [search] = useDebouncedValue(query.trim(), 300);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(null);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const channelGroups = useChannelsStore((s) => s.channelGroups);
  const accountName = (id) =>
    (playlists || []).find((playlist) => playlist.id === id)?.name;

  useEffect(() => {
    if (search.length < 2) {
      setResults(null);
      return undefined;
    }
    let current = true;
    setLoading(true);
    setError(null);
    API.searchStreams({ search, unassigned })
      .then((rows) => current && setResults(rows))
      .catch((exc) => current && setError(formatApiError(exc)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [search, unassigned]);

  const present = new Set(streams.map((stream) => stream.id));

  const add = async (stream) => {
    setAdding(stream.id);
    try {
      await API.addStreamsToChannel(channel.id, streams, [stream]);
    } finally {
      setAdding(null);
    }
  };

  return (
    <Stack gap={6} role="group" aria-label="Add stream">
      <Group gap="xs" wrap="nowrap">
        <TextInput
          size="xs"
          style={{ flex: 1 }}
          placeholder="Search streams by name or category"
          aria-label="Search streams"
          leftSection={<Search size={14} />}
          rightSection={loading ? <Loader size={12} /> : null}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <Switch
          size="xs"
          label="Only without channel"
          checked={unassigned}
          onChange={(event) => setUnassigned(event.currentTarget.checked)}
        />
      </Group>
      {error && (
        <Alert color="red" variant="light" p={6}>
          {error}
        </Alert>
      )}
      {results && !results.length && (
        <Text size="xs" c="dimmed">
          No matching streams.
        </Text>
      )}
      {results && results.length > 0 && (
        <ScrollArea.Autosize mah={220} type="auto">
          <Stack gap={2}>
            {results.map((stream) => (
              <Group key={stream.id} gap="xs" wrap="nowrap">
                <Tooltip label="Add to this channel" openDelay={400}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label={`Add ${stream.name}`}
                    loading={adding === stream.id}
                    disabled={present.has(stream.id)}
                    onClick={() => add(stream)}
                  >
                    <ListPlus size={16} />
                  </ActionIcon>
                </Tooltip>
                <Text size="xs" truncate="end" style={{ flex: 1 }}>
                  {stream.name}
                </Text>
                {accountName(stream.m3u_account) && (
                  <Badge size="xs" variant="light">
                    {accountName(stream.m3u_account)}
                  </Badge>
                )}
                {channelGroups?.[stream.channel_group]?.name && (
                  <Text size="xs" c="dimmed" truncate="end" maw={180}>
                    {channelGroups[stream.channel_group].name}
                  </Text>
                )}
              </Group>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </Stack>
  );
};

export default AddChannelStream;
