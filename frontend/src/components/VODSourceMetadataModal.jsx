import React, { useEffect, useMemo, useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
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

const VODSourceMetadataModal = ({
  provider,
  contentType,
  opened,
  onClose,
  onSaved,
}) => {
  const [metadata, setMetadata] = useState({});
  const [saving, setSaving] = useState(false);
  const effectiveSummary = useMemo(() => currentMetadata(provider), [provider]);

  useEffect(() => {
    if (opened && provider) setMetadata(editableValues(provider));
  }, [opened, provider]);

  const save = async () => {
    setSaving(true);
    try {
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
    </Modal>
  );
};

export default VODSourceMetadataModal;
