import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  PasswordInput,
  Stack,
  TagsInput,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import API from '../../api';
import { formatApiError } from '../../utils';

// Public fixtures that correct event names and kick-off times.
const EventFixtureSettings = () => {
  const [settings, setSettings] = useState(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    API.getEventFixtureSettings()
      .then(setSettings)
      .catch((exc) => setError(formatApiError(exc)));
  }, []);

  if (!settings) {
    return error ? (
      <Alert color="red" variant="light">
        {error}
      </Alert>
    ) : null;
  }

  const save = async (values) => {
    setBusy(true);
    setError(null);
    try {
      setSettings(await API.saveEventFixtureSettings(values));
      setKey('');
      notifications.show({
        message: 'Fixture sources saved.',
        color: 'green.5',
      });
    } catch (exc) {
      setError(formatApiError(exc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="xs" role="group" aria-label="Fixture sources">
      <Text fw={600} size="sm">
        Fixtures
      </Text>
      <Text size="xs" c="dimmed">
        Events that match a public fixture get its official team names and
        kick-off time.
      </Text>
      <TagsInput
        label="OpenLigaDB leagues"
        description="Free. League shortcuts such as bl1, bl2, bl3, dfb or ucl."
        value={settings.openligadb_leagues}
        onChange={(values) =>
          setSettings({ ...settings, openligadb_leagues: values })
        }
      />
      <Group grow align="flex-start">
        <TagsInput
          label="TheSportsDB league ids"
          description="For example 4328 Premier League, 4480 Champions League."
          value={settings.thesportsdb_leagues}
          onChange={(values) =>
            setSettings({ ...settings, thesportsdb_leagues: values })
          }
        />
        <PasswordInput
          label="TheSportsDB API key"
          description="Needed for TheSportsDB; free keys return only a few fixtures."
          placeholder={settings.thesportsdb_key_set ? 'Saved' : 'Not set'}
          value={key}
          onChange={(event) => setKey(event.currentTarget.value)}
        />
      </Group>
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}
      <Group justify="flex-end">
        {settings.thesportsdb_key_set && (
          <Button
            variant="subtle"
            color="red"
            disabled={busy}
            onClick={() => save({ thesportsdb_key: '' })}
          >
            Remove key
          </Button>
        )}
        <Button
          variant="default"
          loading={busy}
          onClick={() =>
            save({
              openligadb_leagues: settings.openligadb_leagues,
              thesportsdb_leagues: settings.thesportsdb_leagues,
              ...(key ? { thesportsdb_key: key } : {}),
            })
          }
        >
          Save fixture sources
        </Button>
      </Group>
    </Stack>
  );
};

export default EventFixtureSettings;
