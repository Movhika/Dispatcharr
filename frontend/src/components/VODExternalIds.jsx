import React, { useEffect, useState } from 'react';
import { Badge, Button, Group, Text, TextInput } from '@mantine/core';
import { Pencil, Save, X } from 'lucide-react';
import API from '../api';
import useAuthStore from '../store/auth';
import { showNotification } from '../utils/notificationUtils';
import { imdbUrl, tmdbUrl } from '../utils/components/SeriesModalUtils.js';

const VODExternalIds = ({
  contentType,
  contentId,
  tmdb,
  tmdbId = '',
  imdbId = '',
  onSaved,
}) => {
  const user = useAuthStore((state) => state.user);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const effectiveTmdbId = String(tmdb?.id || tmdbId || '');
  const effectiveImdbId = String(tmdb?.external_ids?.imdb_id || imdbId || '');
  const tvdbId = String(tmdb?.external_ids?.tvdb_id || '');

  useEffect(() => {
    if (!editing) setValue(String(tmdb?.override_id || effectiveTmdbId || ''));
  }, [editing, effectiveTmdbId, tmdb?.override_id]);

  const save = async () => {
    const normalized = value.trim();
    if (normalized && !/^\d+$/.test(normalized)) {
      showNotification({
        title: 'Invalid TMDB ID',
        message: 'Enter the numeric ID from the TMDB URL.',
        color: 'red',
      });
      return;
    }
    setSaving(true);
    try {
      const result = await API.updateVODTmdbMatch(
        contentType,
        contentId,
        normalized
      );
      setEditing(false);
      onSaved?.(result.tmdb);
      showNotification({
        title: normalized ? 'TMDB match updated' : 'TMDB override cleared',
        message:
          result.refresh?.status === 'token_not_configured'
            ? 'The match was saved. Configure a TMDB token to fetch its metadata.'
            : 'Metadata and artwork are being refreshed in the background.',
        color: 'green',
      });
    } catch (error) {
      showNotification({
        title: 'TMDB match was not changed',
        message: error?.body?.tmdb_id || error?.message || 'Please retry.',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Group gap="xs" wrap="wrap">
      {effectiveTmdbId && (
        <Badge
          color="cyan"
          component="a"
          href={tmdbUrl(
            effectiveTmdbId,
            contentType === 'series' ? 'tv' : 'movie'
          )}
          target="_blank"
          rel="noopener noreferrer"
          style={{ cursor: 'pointer' }}
        >
          TMDB {effectiveTmdbId}
        </Badge>
      )}
      {effectiveImdbId && (
        <Badge
          color="yellow"
          component="a"
          href={imdbUrl(effectiveImdbId)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ cursor: 'pointer' }}
        >
          IMDb {effectiveImdbId}
        </Badge>
      )}
      {tvdbId && <Badge color="grape">TVDB {tvdbId}</Badge>}
      {!effectiveTmdbId && !effectiveImdbId && !tvdbId && (
        <Text size="xs" c="dimmed">
          No external metadata ID
        </Text>
      )}
      {user?.user_level >= 10 && !editing && (
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<Pencil size={13} />}
          onClick={() => setEditing(true)}
        >
          Correct TMDB match
        </Button>
      )}
      {editing && (
        <Group gap="xs" wrap="nowrap">
          <TextInput
            aria-label="TMDB ID"
            placeholder="Numeric TMDB ID"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            size="xs"
            w={170}
          />
          <Button
            size="compact-xs"
            leftSection={<Save size={13} />}
            loading={saving}
            onClick={save}
          >
            Save
          </Button>
          <Button
            size="compact-xs"
            variant="default"
            leftSection={<X size={13} />}
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </Group>
      )}
    </Group>
  );
};

export default VODExternalIds;
