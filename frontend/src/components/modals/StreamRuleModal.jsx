import { useEffect, useMemo, useState } from 'react';
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
  TagsInput,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import API from '../../api';
import usePlaylistsStore from '../../store/playlists';
import { formatApiError } from '../../utils';

const EMPTY_RULE = {
  enabled: true,
  match_name: true,
  names: [],
  include_regex: '',
  exclude_regex: '',
  catchup: 'include',
  account_ids: [],
  countries: [],
  excluded_stream_ids: [],
};

const CATCHUP_OPTIONS = [
  { value: 'include', label: 'Catch-up too' },
  { value: 'exclude', label: 'Without catch-up' },
  { value: 'only', label: 'Only catch-up' },
];

const STATUS = {
  manual: { label: 'Manual', color: 'gray' },
  kept: { label: 'Rule', color: 'blue' },
  added: { label: 'New', color: 'green' },
  removed: { label: 'Goes', color: 'red' },
};

const StreamLine = ({ stream }) => (
  <Group gap={6} wrap="nowrap">
    <Badge size="xs" variant="light" color={STATUS[stream.status]?.color}>
      {STATUS[stream.status]?.label}
    </Badge>
    <Text
      size="xs"
      truncate
      td={stream.status === 'removed' ? 'line-through' : undefined}
    >
      {stream.name}
    </Text>
    <Text size="xs" c="dimmed" truncate>
      {stream.account}
      {stream.catchup ? ' · catch-up' : ''}
    </Text>
  </Group>
);

// One channel when `channel` is given, otherwise the same settings for many.
const StreamRuleModal = ({ opened, onClose, channel, channelIds = [] }) => {
  const playlists = usePlaylistsStore((state) => state.playlists);
  const single = !!channel;
  const [rule, setRule] = useState(EMPTY_RULE);
  const [exists, setExists] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const set = (values) => setRule((current) => ({ ...current, ...values }));

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

  useEffect(() => {
    if (!opened) return;
    setError(null);
    setPreview(null);
    setRule(EMPTY_RULE);
    setExists(false);
    if (!single) return;
    setLoading(true);
    API.getChannelStreamRule(channel.id)
      .then((saved) => {
        if (saved) {
          setRule({ ...EMPTY_RULE, ...saved });
          setExists(true);
        }
      })
      .catch((exc) => setError(formatApiError(exc)))
      .finally(() => setLoading(false));
  }, [opened, single, channel?.id]);

  const payload = () => {
    const { last_applied_at: _applied, ...values } = rule;
    return {
      ...values,
      account_ids: values.account_ids.map(Number),
      countries: values.countries.map((code) => code.toUpperCase()),
    };
  };

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

  const done = async (message) => {
    notifications.show({ message, color: 'green.5' });
    await API.requeryChannels();
    onClose();
  };

  const save = () =>
    run(async () => {
      if (single) {
        await API.saveChannelStreamRule(channel.id, payload());
        await done(`Stream rule of ${channel.name} saved.`);
      } else {
        const {
          names: _names,
          excluded_stream_ids: _excluded,
          ...values
        } = payload();
        const result = await API.saveStreamRules(channelIds, values);
        await done(
          `${result.rules} channels: ${result.added} streams added, ${result.removed} removed.`
        );
      }
    });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      title={
        single
          ? `Stream rule · ${channel.name}`
          : `Stream rules · ${channelIds.length} channels`
      }
    >
      {loading ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      ) : (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            The rule finds this channel's streams after every refresh, like a
            Library title finds its sources. Streams you added by hand stay;
            rule streams you remove by hand are not added again.
            {!single &&
              ' Further names and excluded streams of each channel are kept. Auto sync channels are skipped.'}
          </Text>
          <Group>
            <Switch
              label="Match the channel name"
              checked={rule.match_name}
              onChange={(event) =>
                set({ match_name: event.currentTarget.checked })
              }
            />
            <Switch
              label="Enabled"
              checked={rule.enabled}
              onChange={(event) =>
                set({ enabled: event.currentTarget.checked })
              }
            />
          </Group>
          {single && (
            <TagsInput
              label="Further names"
              description="Other names of this channel, for example Pro7 for ProSieben. Global aliases are in Settings."
              value={rule.names}
              onChange={(names) => set({ names })}
            />
          )}
          <Group grow align="flex-start">
            <TextInput
              label="Also find names matching"
              placeholder="Regular expression"
              value={rule.include_regex}
              onChange={(event) =>
                set({ include_regex: event.currentTarget.value })
              }
            />
            <TextInput
              label="Leave out names matching"
              placeholder="Regular expression"
              value={rule.exclude_regex}
              onChange={(event) =>
                set({ exclude_regex: event.currentTarget.value })
              }
            />
          </Group>
          <SegmentedControl
            data={CATCHUP_OPTIONS}
            value={rule.catchup}
            onChange={(catchup) => set({ catchup })}
          />
          <Group grow align="flex-start">
            <MultiSelect
              label="Accounts"
              placeholder="All accounts"
              data={accountOptions}
              value={rule.account_ids.map(String)}
              onChange={(account_ids) => set({ account_ids })}
              clearable
            />
            <TagsInput
              label="Country prefixes"
              placeholder="All countries"
              description="Streams without a prefix always count."
              value={rule.countries}
              onChange={(countries) => set({ countries })}
            />
          </Group>
          {single && rule.excluded_stream_ids.length > 0 && (
            <Group justify="space-between">
              <Text size="sm">
                {rule.excluded_stream_ids.length} streams removed by hand are
                excluded.
              </Text>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => set({ excluded_stream_ids: [] })}
              >
                Allow them again
              </Button>
            </Group>
          )}
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          {preview && (
            <ScrollArea h={220} type="auto">
              <Stack gap={4}>
                {!preview.streams.length && !preview.removed.length && (
                  <Text size="sm" c="dimmed">
                    The rule finds no streams.
                  </Text>
                )}
                {[...preview.streams, ...preview.removed].map((stream) => (
                  <StreamLine key={stream.id} stream={stream} />
                ))}
              </Stack>
            </ScrollArea>
          )}
          <Group justify="space-between">
            <Group gap="xs">
              {single && (
                <Button
                  variant="default"
                  loading={busy}
                  onClick={() =>
                    run(async () =>
                      setPreview(
                        await API.previewChannelStreamRule(
                          channel.id,
                          payload()
                        )
                      )
                    )
                  }
                >
                  Preview
                </Button>
              )}
              {single && exists && (
                <Button
                  variant="subtle"
                  color="red"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await API.deleteChannelStreamRule(channel.id);
                      await done(
                        `Stream rule of ${channel.name} removed; its streams stay as manual streams.`
                      );
                    })
                  }
                >
                  Remove rule
                </Button>
              )}
            </Group>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button
                loading={busy}
                onClick={save}
                disabled={!single && !channelIds.length}
              >
                {single ? 'Save' : `Apply to ${channelIds.length} channels`}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
};

export default StreamRuleModal;
