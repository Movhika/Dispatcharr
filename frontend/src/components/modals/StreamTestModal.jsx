import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Radio,
  Stack,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import API from '../../api';
import { formatApiError } from '../../utils';

const SORT_OPTIONS = [
  {
    value: 'none',
    label: 'Keep the order',
    description: 'Only record which streams work and their quality.',
  },
  {
    value: 'quality',
    label: 'Best quality first',
    description: 'Highest resolution, then frame rate and bitrate.',
  },
  {
    value: 'startup',
    label: 'Fastest start first',
    description: 'Streams that answered quickest come first.',
  },
];

const StreamTestModal = ({ opened, onClose, channelIds = [] }) => {
  const [sort, setSort] = useState('quality');
  const [lowFps, setLowFps] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await API.testChannelStreams(
        channelIds,
        sort,
        lowFps || 20
      );
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
        <NumberInput
          label="Low frame rate below (fps)"
          min={1}
          max={60}
          value={lowFps}
          onChange={setLowFps}
          w={220}
        />
        <Radio.Group label="After the test" value={sort} onChange={setSort}>
          <Stack gap="xs" mt="xs">
            {SORT_OPTIONS.map((option) => (
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
