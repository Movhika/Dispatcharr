import React, { useEffect, useMemo, useState } from 'react';
import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import API from '../api';
import { normalizeLanguageCodes } from '../utils/languageCodes.js';
import {
  CONTAINER_EXTENSION_OPTIONS,
  RESOLUTION_VALUES,
} from '../utils/vodMetadataOptions.js';
import { showNotification } from '../utils/notificationUtils';
import LanguagePicker from './LanguagePicker.jsx';

const manualValues = (provider) => {
  const sourceMetadata = provider?.source_metadata || {};
  const values = sourceMetadata.values || {};
  const provenance = sourceMetadata.provenance || {};
  return Object.fromEntries(
    Object.entries(values).filter(([field]) => provenance[field] === 'manual')
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
    if (opened && provider) setMetadata(manualValues(provider));
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
          Only values saved here become manual locks. Empty fields keep using
          category, provider, or playback metadata.
        </Text>
        <LanguagePicker
          label="DUB languages"
          value={metadata.audio_languages || []}
          onChange={(value) =>
            setMetadata({ ...metadata, audio_languages: value })
          }
        />
        <LanguagePicker
          label="SUB languages"
          value={metadata.subtitle_languages || []}
          onChange={(value) =>
            setMetadata({ ...metadata, subtitle_languages: value })
          }
        />
        <Select
          clearable
          label="Resolution"
          data={RESOLUTION_VALUES}
          value={metadata.resolution || null}
          onChange={(value) =>
            setMetadata({ ...metadata, resolution: value || '' })
          }
        />
        <Select
          clearable
          searchable
          label="Format"
          data={CONTAINER_EXTENSION_OPTIONS}
          value={metadata.container_extension || null}
          onChange={(value) =>
            setMetadata({ ...metadata, container_extension: value || '' })
          }
        />
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
