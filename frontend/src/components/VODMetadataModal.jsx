import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Progress,
  Select,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import { RefreshCw, Save } from 'lucide-react';
import API from '../api';
import { showNotification } from '../utils/notificationUtils';

const LANGUAGE_OPTIONS = [
  { value: 'de-DE', label: 'German (de-DE)' },
  { value: 'en-US', label: 'English (en-US)' },
  { value: 'en-GB', label: 'English (en-GB)' },
  { value: 'fr-FR', label: 'French (fr-FR)' },
  { value: 'es-ES', label: 'Spanish (es-ES)' },
  { value: 'it-IT', label: 'Italian (it-IT)' },
  { value: 'nl-NL', label: 'Dutch (nl-NL)' },
  { value: 'pl-PL', label: 'Polish (pl-PL)' },
  { value: 'pt-PT', label: 'Portuguese (pt-PT)' },
  { value: 'tr-TR', label: 'Turkish (tr-TR)' },
];

const defaultData = {
  settings: {
    token_configured: false,
    token_source: '',
    languages: ['en-US'],
    auto_enrich: true,
    match_missing: false,
    prefer_artwork: true,
  },
  catalog: {
    movies: 0,
    series: 0,
    enriched_movies: 0,
    enriched_series: 0,
  },
  state: { status: 'idle', progress: {} },
};

const statusColor = (status) => {
  if (status === 'complete') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'running' || status === 'queued') return 'blue';
  return 'gray';
};

const VODMetadataModal = ({ opened, onClose, onUpdated }) => {
  const [data, setData] = useState(defaultData);
  const [primaryLanguage, setPrimaryLanguage] = useState('en-US');
  const [secondaryLanguage, setSecondaryLanguage] = useState('');
  const [matchMissing, setMatchMissing] = useState(false);
  const [preferArtwork, setPreferArtwork] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const applyData = useCallback((next) => {
    if (!next) return;
    setData(next);
    const languages = next.settings?.languages || ['en-US'];
    setPrimaryLanguage(languages[0] || 'en-US');
    setSecondaryLanguage(languages[1] || '');
    setMatchMissing(Boolean(next.settings?.match_missing));
    setPreferArtwork(next.settings?.prefer_artwork !== false);
  }, []);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        applyData(await API.getVODMetadataStatus());
      } catch {
        // The shared request layer already reports the failed API call.
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [applyData]
  );

  useEffect(() => {
    if (!opened) return;
    load();
  }, [load, opened]);

  const running = ['queued', 'running'].includes(data.state?.status);

  useEffect(() => {
    if (!opened || !running) return undefined;
    const timer = window.setInterval(() => load({ quiet: true }), 2500);
    return () => window.clearInterval(timer);
  }, [load, opened, running]);

  const languages = useMemo(
    () =>
      [primaryLanguage, secondaryLanguage].filter(
        (value, index, values) => value && values.indexOf(value) === index
      ),
    [primaryLanguage, secondaryLanguage]
  );
  const progress = data.state?.progress || {};
  const percent = Math.min(Math.max(Number(progress.percent) || 0, 0), 100);

  const saveSettings = async ({ startRefresh = false } = {}) => {
    setSaving(true);
    try {
      const payload = {
        languages,
        match_missing: matchMissing,
        prefer_artwork: preferArtwork,
      };
      const updated = await API.updateVODMetadataSettings(payload);
      applyData(updated);
      if (startRefresh) {
        await API.refreshVODMetadata();
        await load({ quiet: true });
      }
      showNotification({
        title: startRefresh ? 'TMDB refresh started' : 'TMDB settings saved',
        message: startRefresh
          ? 'The existing VOD catalog remains available while metadata is enriched.'
          : 'Provider data remains unchanged.',
        color: 'green',
      });
      onUpdated?.();
    } catch (error) {
      showNotification({
        title: 'TMDB settings were not saved',
        message: error?.message || 'Please check the values and retry.',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <Stack gap="md">
      <Alert color="blue" variant="light">
        Provider titles and provider metadata are never overwritten. TMDB is
        stored separately on the canonical movie or series. Choose up to two
        localized titles for the canonical catalog.
      </Alert>

      <Group grow align="flex-start">
        <Select
          label="Primary localized title"
          data={LANGUAGE_OPTIONS}
          value={primaryLanguage}
          onChange={(value) => setPrimaryLanguage(value || 'en-US')}
          searchable
          allowDeselect={false}
          disabled={running}
        />
        <Select
          label="Second localized title"
          data={LANGUAGE_OPTIONS.filter(
            (option) => option.value !== primaryLanguage
          )}
          value={secondaryLanguage || null}
          onChange={(value) => setSecondaryLanguage(value || '')}
          searchable
          clearable
          disabled={running}
        />
      </Group>

      <Switch
        label="Match content without a TMDB or IMDb ID"
        description="Only a unique exact title and matching release year is accepted; ambiguous results remain unmatched."
        checked={matchMissing}
        disabled={running}
        onChange={(event) => setMatchMissing(event.currentTarget.checked)}
      />
      <Switch
        label="Prefer TMDB posters and backdrops"
        description="Used in the VOD library and XC client output. Provider artwork remains stored and is used as fallback."
        checked={preferArtwork}
        disabled={running}
        onChange={(event) => setPreferArtwork(event.currentTarget.checked)}
      />

      <Group justify="space-between">
        <Group gap="xs">
          <Badge color={statusColor(data.state?.status)}>
            {String(data.state?.status || 'idle').toUpperCase()}
          </Badge>
          <Text size="sm" c="dimmed">
            Matched: movies {data.catalog.enriched_movies}/{data.catalog.movies}{' '}
            · series {data.catalog.enriched_series}/{data.catalog.series}
          </Text>
        </Group>
        {data.state?.completed_at && (
          <Text size="xs" c="dimmed">
            Last completed: {new Date(data.state.completed_at).toLocaleString()}
          </Text>
        )}
      </Group>

      {(running || data.state?.status === 'failed') && (
        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="sm">{progress.phase || 'Preparing metadata'}</Text>
            <Text size="sm" c="dimmed">
              {progress.processed || 0}/{progress.total || 0}
            </Text>
          </Group>
          <Progress value={percent} animated={running} />
          {data.state?.error && (
            <Text size="sm" c="red">
              {data.state.error}
            </Text>
          )}
        </Stack>
      )}

      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="default"
          leftSection={<Save size={16} />}
          loading={saving && !running}
          disabled={loading || running || languages.length === 0}
          onClick={() => saveSettings()}
        >
          Save
        </Button>
        <Button
          leftSection={<RefreshCw size={16} />}
          loading={saving}
          disabled={loading || running || languages.length === 0}
          onClick={() => saveSettings({ startRefresh: true })}
        >
          Save and refresh
        </Button>
      </Group>
    </Stack>
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="VOD metadata"
      size="50vw"
      centered
    >
      {content}
    </Modal>
  );
};

export default VODMetadataModal;
