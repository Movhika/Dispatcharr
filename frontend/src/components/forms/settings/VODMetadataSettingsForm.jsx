import React, { useCallback, useEffect, useState } from 'react';
import { Button, PasswordInput, Stack, Switch, Text } from '@mantine/core';
import API from '../../../api';
import { showNotification } from '../../../utils/notificationUtils';

const VODMetadataSettingsForm = ({ active = true }) => {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState('');
  const [autoEnrich, setAutoEnrich] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const next = await API.getVODMetadataStatus();
    setStatus(next);
    setAutoEnrich(next.settings?.auto_enrich !== false);
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { auto_enrich: autoEnrich };
      if (token.trim()) payload.api_token = token.trim();
      const next = await API.updateVODMetadataSettings(payload);
      setStatus(next);
      setToken('');
      showNotification({
        title: 'TMDB settings saved',
        message:
          'The API access and automatic enrichment setting were updated.',
        color: 'green',
      });
    } catch (error) {
      showNotification({
        title: 'TMDB settings were not saved',
        message: error?.message || 'Please check the token and retry.',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const environmentToken = status?.settings?.token_source === 'environment';
  return (
    <Stack maw={720}>
      <PasswordInput
        label="TMDB API read access token"
        description={
          environmentToken
            ? 'Configured through the container environment.'
            : status?.settings?.token_configured
              ? 'A token is configured. Enter a value only to replace it.'
              : 'Enter the application read access token from TMDB.'
        }
        value={token}
        onChange={(event) => setToken(event.currentTarget.value)}
        placeholder={status?.settings?.token_configured ? 'Configured' : ''}
        disabled={environmentToken}
      />
      <Switch
        label="Automatically enrich after a changed provider VOD refresh"
        description="Only new or outdated canonical metadata is requested. Output profiles rebuild after enrichment finishes."
        checked={autoEnrich}
        onChange={(event) => setAutoEnrich(event.currentTarget.checked)}
      />
      <Text size="xs" c="dimmed">
        Language, matching, and artwork behavior are configured from the VOD
        metadata action.
      </Text>
      <Button onClick={save} loading={saving} style={{ alignSelf: 'flex-end' }}>
        Save
      </Button>
    </Stack>
  );
};

export default VODMetadataSettingsForm;
