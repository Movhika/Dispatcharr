import { useEffect, useState } from 'react';
import { Alert, Button, Group, Stack, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import API from '../../../api';
import { formatApiError } from '../../../utils';
import {
  aliasesToText,
  textToAliases,
} from '../../../utils/streamMatchAliases';

// Global aliases of stream rules: names providers spell differently.
const NameMatchingSettingsForm = () => {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    API.getNameAliases()
      .then((result) => setText(aliasesToText(result.aliases)))
      .catch((exc) => setError(formatApiError(exc)))
      .finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await API.saveNameAliases(textToAliases(text));
      setText(aliasesToText(result.aliases));
      notifications.show({ message: 'Name aliases saved.', color: 'green.5' });
    } catch (exc) {
      setError(formatApiError(exc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Stream rules compare names without country prefixes, quality tags and
        spelling variants like Pro7 and ProSieben. Aliases add names providers
        spell differently; they also cover numbered names such as DAZN UEFA
        Champions League 3.
      </Text>
      <Textarea
        label="Name aliases"
        description='One channel per line, names separated by "=", e.g. "RTL Nitro = Nitro".'
        autosize
        minRows={6}
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
          Save
        </Button>
      </Group>
    </Stack>
  );
};

export default NameMatchingSettingsForm;
