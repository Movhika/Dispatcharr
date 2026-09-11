import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import API from '../api';
import { normalizeLanguageCodes } from '../utils/languageCodes.js';
import { showNotification } from '../utils/notificationUtils';
import { VOD_METADATA_FIELDS } from '../utils/vodMetadataOptions.js';
import VODMetadataFields from './VODMetadataFields.jsx';

const editableValues = (provider) => {
  const values = provider?.source_metadata?.values || {};
  return Object.fromEntries(
    Object.entries(values).filter(([field]) =>
      VOD_METADATA_FIELDS.includes(field)
    )
  );
};

const currentMetadata = (provider) => {
  const values = provider?.source_metadata?.values || {};
  return [
    values.resolution || (values.height ? `${values.height}p` : null),
    (values.audio_languages || []).length
      ? `DUB: ${values.audio_languages.join(', ')}`
      : null,
    (values.subtitle_languages || []).length
      ? `SUB: ${values.subtitle_languages.join(', ')}`
      : null,
    values.container_extension ? `Format: ${values.container_extension}` : null,
    (values.video_features || []).length
      ? `Features: ${values.video_features.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join(' • ');
};

const providerValue = (provider, ...keys) => {
  const properties = provider?.custom_properties || {};
  const candidates = [
    properties,
    properties.detailed_info,
    properties.basic_data,
    properties.movie_data,
    properties.series_data,
  ].filter((value) => value && typeof value === 'object');
  for (const candidate of candidates) {
    for (const key of keys) {
      if (candidate[key]) return String(candidate[key]);
    }
  }
  return '';
};

const canonicalTmdbId = (provider, contentType) => {
  const canonical =
    contentType === 'series' ? provider?.series : provider?.movie;
  return String(
    provider?.tmdb_override_id ||
      canonical?.tmdb_match_id ||
      canonical?.tmdb_id ||
      ''
  );
};

const VODSourceMetadataModal = ({
  provider,
  contentType,
  opened,
  onClose,
  onSaved,
  onMoved,
}) => {
  const [metadata, setMetadata] = useState({});
  const [tmdbId, setTmdbId] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [saving, setSaving] = useState(false);
  const effectiveSummary = useMemo(() => currentMetadata(provider), [provider]);

  useEffect(() => {
    if (opened && provider) {
      setMetadata(editableValues(provider));
      setTmdbId(canonicalTmdbId(provider, contentType));
      setConfirmation(null);
    }
  }, [contentType, opened, provider]);

  const moveSource = async (confirmed = false) => {
    const normalized = tmdbId.trim();
    if (!/^\d+$/.test(normalized)) {
      throw new Error('Enter the positive numeric ID from the TMDB URL.');
    }
    try {
      return await API.updateVODRelationTmdbMatch(
        normalized,
        [{ content_type: contentType, relation_id: provider.id }],
        { confirmed }
      );
    } catch (error) {
      if (error?.status === 409 && error?.body?.requires_confirmation) {
        setConfirmation(error.body);
        return null;
      }
      throw error;
    }
  };

  const saveSourceMetadata = async () => {
    const normalized = Object.fromEntries(
      Object.entries(metadata).filter(
        ([, value]) =>
          value !== '' &&
          value !== null &&
          value !== undefined &&
          (!Array.isArray(value) || value.length > 0)
      )
    );
    if (normalized.audio_languages) {
      normalized.audio_languages = normalizeLanguageCodes(
        normalized.audio_languages
      );
    }
    if (normalized.subtitle_languages) {
      normalized.subtitle_languages = normalizeLanguageCodes(
        normalized.subtitle_languages
      );
    }
    const result = await API.updateVODRelationManualMetadata(
      contentType,
      provider.id,
      normalized,
      Object.keys(normalized)
    );
    onSaved?.({
      ...provider,
      source_asset: result.source_asset,
      source_metadata: result.source_metadata,
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const tmdbChanged =
        tmdbId.trim() !== canonicalTmdbId(provider, contentType);
      let moved = null;
      if (tmdbChanged) {
        moved = await moveSource();
        if (!moved) return;
      }
      await saveSourceMetadata();
      if (moved) onMoved?.(moved);
      showNotification({
        title: 'Source metadata saved',
        message: 'Manual values are locked against later observations.',
        color: 'green',
      });
      onClose();
    } catch (error) {
      showNotification({
        title: 'Source metadata could not be saved',
        message: error?.message || 'The request failed.',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmMove = async () => {
    setSaving(true);
    try {
      const moved = await moveSource(true);
      await saveSourceMetadata();
      setConfirmation(null);
      onMoved?.(moved);
      showNotification({
        title: 'Provider source moved',
        message: 'The source now belongs to the selected canonical TMDB title.',
        color: 'green',
      });
      onClose();
    } catch (error) {
      showNotification({
        title: 'TMDB assignment could not be changed',
        message:
          error?.body?.tmdb_id || error?.message || 'The request failed.',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Edit exact source metadata"
      centered
    >
      <Stack>
        <Text size="sm" c="dimmed">
          {provider?.m3u_account?.name || 'Unknown account'} —{' '}
          {provider?.category?.name || 'Uncategorized'}
        </Text>
        <Text size="xs" c="dimmed">
          Current effective values: {effectiveSummary || 'Unknown'}
        </Text>
        <Text size="xs" c="dimmed">
          Saving confirms and locks every displayed value. Empty fields keep
          using category, provider, or playback metadata. The provider format is
          read-only.
        </Text>
        <TextInput
          label="Canonical TMDB ID for this provider source"
          description={`Provider ID: ${providerValue(provider, 'tmdb_id', 'tmdb') || 'none'} · Current canonical ID: ${canonicalTmdbId(provider, contentType) || 'none'}`}
          value={tmdbId}
          onChange={(event) => setTmdbId(event.currentTarget.value)}
          inputMode="numeric"
        />
        <VODMetadataFields value={metadata} onChange={setMetadata} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save and lock
          </Button>
        </Group>
      </Stack>
      <Modal
        opened={Boolean(confirmation)}
        onClose={() => setConfirmation(null)}
        title="Replace an existing TMDB assignment?"
        centered
      >
        <Stack>
          <Alert color="orange">
            TMDB metadata has already been fetched for this title. Continuing
            moves this exact provider source to the new canonical title.
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
            <Button color="orange" loading={saving} onClick={confirmMove}>
              Move source
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
};

export default VODSourceMetadataModal;
