import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Group,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import API from '../../../api';
import EventFixtureSettings from '../EventFixtureSettings';
import { formatApiError } from '../../../utils';
import {
  aliasesToText,
  textToAliases,
} from '../../../utils/streamMatchAliases';

// Team aliases and public fixtures used to recognise the same event.
const EventSettingsForm = () => {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    API.getEventTeamAliases()
      .then((result) => setText(aliasesToText(result.aliases)))
      .catch((exc) => setError(formatApiError(exc)))
      .finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await API.saveEventTeamAliases(textToAliases(text));
      setText(aliasesToText(result.aliases));
      notifications.show({ message: 'Team aliases saved.', color: 'green.5' });
    } catch (exc) {
      setError(formatApiError(exc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Event groups combine the streams of one event from several providers.
        Team names are compared without club words like FC or SC and without
        accents; aliases cover names that still differ.
      </Text>
      <Textarea
        label="Team aliases"
        description='Names of the same team, one team per line, e.g. "Bayern Munich = Bayern München = FC Bayern".'
        autosize
        minRows={4}
        maxRows={12}
        disabled={!loaded}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button onClick={save} loading={busy} disabled={!loaded}>
          Save aliases
        </Button>
      </Group>
      <Divider />
      <EventFixtureSettings />
    </Stack>
  );
};

export default EventSettingsForm;
