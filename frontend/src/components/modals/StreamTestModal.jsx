import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Anchor,
  Button,
  Group,
  Modal,
  Radio,
  Stack,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import API from '../../api';
import { formatApiError } from '../../utils';
import { STREAM_TEST_SORTS } from '../../utils/streamTestOptions';

const StreamTestModal = ({ opened, onClose, channelIds = [] }) => {
  const [sort, setSort] = useState('quality');
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!opened) return;
    API.getStreamTestSettings()
      .then((saved) => {
        setSettings(saved);
        setSort(saved.sort);
      })
      .catch(() => setSettings(null));
  }, [opened]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await API.testChannelStreams(channelIds, sort);
      notifications.show({
        title: 'Stream test started',
        message: response?.message,
        color: 'blue.5',
      });
      onClose();
    } catch (exc) {
      setError(formatApiError(exc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Test streams" size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Tests every stream of the {channelIds.length} selected channels in the
          background. Each test records a few seconds over one free connection
          of the account, like playback, and checks start time, bitrate,
          resolution, frame rate and whether the picture is black or frozen.
          Streams without a free connection are skipped.
        </Text>
        <Text size="xs" c="dimmed">
          {settings
            ? `Samples of ${settings.sample_seconds} seconds, low frame rate below ${settings.low_fps} fps. `
            : ''}
          <Anchor
            component={Link}
            to="/settings#live-stream-tests"
            size="xs"
            onClick={onClose}
          >
            Change in Settings
          </Anchor>
        </Text>
        <Radio.Group label="After the test" value={sort} onChange={setSort}>
          <Stack gap="xs" mt="xs">
            {STREAM_TEST_SORTS.map((option) => (
              <Radio
                key={option.value}
                value={option.value}
                label={option.label}
                description={option.description}
              />
            ))}
          </Stack>
        </Radio.Group>
        {sort !== 'none' && (
          <Text size="xs" c="dimmed">
            Working streams come first, then untested ones, then low frame rate,
            frozen, black and failed streams.
          </Text>
        )}
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={start} loading={busy} disabled={!channelIds.length}>
            Start test
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default StreamTestModal;
