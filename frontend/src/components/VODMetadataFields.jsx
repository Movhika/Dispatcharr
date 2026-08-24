import React from 'react';
import { SegmentedControl, Select, Stack } from '@mantine/core';
import LanguagePicker from './LanguagePicker.jsx';
import {
  CONTAINER_EXTENSION_OPTIONS,
  RESOLUTION_VALUES,
  VOD_METADATA_FIELDS,
} from '../utils/vodMetadataOptions.js';

const FIELD_LABELS = {
  audio_languages: 'DUB languages',
  subtitle_languages: 'SUB languages',
  resolution: 'Resolution',
  container_extension: 'Format',
};

const MODE_OPTIONS = [
  { value: 'keep', label: 'Keep' },
  { value: 'set', label: 'Set' },
  { value: 'clear', label: 'Clear manual value' },
];

const VODMetadataFields = ({
  value,
  onChange,
  fields = VOD_METADATA_FIELDS,
  modes = null,
  onModesChange,
  labels = {},
  descriptions = {},
}) => {
  const updateValue = (field, nextValue) =>
    onChange({ ...value, [field]: nextValue });

  const fieldControl = (field) => {
    const disabled = Boolean(modes) && modes[field] !== 'set';
    const label = labels[field] || FIELD_LABELS[field];
    if (field === 'audio_languages' || field === 'subtitle_languages') {
      return (
        <LanguagePicker
          label={label}
          value={value[field] || []}
          disabled={disabled}
          onChange={(nextValue) => updateValue(field, nextValue)}
        />
      );
    }
    if (field === 'resolution') {
      return (
        <Select
          clearable
          label={label}
          description={descriptions[field]}
          data={RESOLUTION_VALUES}
          value={value[field] || null}
          disabled={disabled}
          onChange={(nextValue) => updateValue(field, nextValue || '')}
        />
      );
    }
    return (
      <Select
        clearable
        searchable
        label={label}
        description={descriptions[field]}
        data={CONTAINER_EXTENSION_OPTIONS}
        value={value[field] || null}
        disabled={disabled}
        onChange={(nextValue) => updateValue(field, nextValue || '')}
      />
    );
  };

  return fields.map((field) => (
    <Stack key={field} gap={5}>
      {modes && (
        <SegmentedControl
          aria-label={`${FIELD_LABELS[field]} update mode`}
          value={modes[field] || 'keep'}
          onChange={(mode) => onModesChange({ ...modes, [field]: mode })}
          data={MODE_OPTIONS}
        />
      )}
      {fieldControl(field)}
    </Stack>
  ));
};

export default VODMetadataFields;
