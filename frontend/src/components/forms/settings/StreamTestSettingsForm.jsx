import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import API from '../../../api';
import { formatApiError } from '../../../utils';
import { STREAM_TEST_SORTS } from '../../../utils/streamTestOptions';

// Defaults of stream tests started from the channel list.
const StreamTestSettingsForm = () => {
  const [values, setValues] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    API.getStreamTestSettings()
      .then(setValues)
      .catch((exc) => setError(formatApiError(exc)));
  }, []);

  const set = (changes) => setValues((current) => ({ ...current, ...changes }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setValues(await API.saveStreamTestSettings(values));
      notifications.show({
        message: 'Stream test settings saved.',
        color: 'green.5',
      });
    } catch (exc) {
      setError(formatApiError(exc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        A stream test records a few seconds of every stream over one free
        connection of its account and checks start time, bitrate, resolution,
        frame rate and whether the picture is black or frozen. Start it from the
        channel list with “Test Streams”.
      </Text>
      {values && (
        <>
          <Group grow align="flex-start">
            <NumberInput
              label="Low frame rate below (fps)"
              description="Streams below this are sorted after smooth ones."
              min={1}
              max={60}
              value={values.low_fps}
              onChange={(value) => set({ low_fps: value || 1 })}
            />
            <NumberInput
              label="Sample length (seconds)"
              description="Longer samples find more problems but hold the connection longer."
              min={3}
              max={30}
              value={values.sample_seconds}
              onChange={(value) => set({ sample_seconds: value || 3 })}
            />
          </Group>
          <Select
            label="After the test"
            description="Preselected in the test dialog."
            allowDeselect={false}
            data={STREAM_TEST_SORTS.map(({ value, label }) => ({
              value,
              label,
            }))}
            value={values.sort}
            onChange={(value) => set({ sort: value })}
            w={260}
          />
        </>
      )}
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button onClick={save} loading={busy} disabled={!values}>
          Save
        </Button>
      </Group>
    </Stack>
  );
};

export default StreamTestSettingsForm;
