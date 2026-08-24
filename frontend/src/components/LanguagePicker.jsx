import React, { useMemo, useState } from 'react';
import { Button, Group, Select, Stack, Text } from '@mantine/core';
import {
  LANGUAGE_OPTIONS,
  normalizeLanguageCodes,
} from '../utils/languageCodes.js';

const labelForCode = (code) =>
  LANGUAGE_OPTIONS.find((option) => option.value === code)?.label ||
  String(code || '').toUpperCase();

export const LanguageSelect = ({ value, onChange, ...props }) => (
  <Select
    searchable
    clearable
    data={LANGUAGE_OPTIONS}
    value={value || null}
    onChange={(next) => onChange?.(next || '')}
    {...props}
  />
);

const LanguagePicker = ({
  label,
  value = [],
  onChange,
  disabled = false,
  size,
}) => {
  const normalized = normalizeLanguageCodes(value);
  const [candidate, setCandidate] = useState('');
  const options = useMemo(
    () =>
      LANGUAGE_OPTIONS.filter((option) => !normalized.includes(option.value)),
    [normalized]
  );

  const add = () => {
    if (!candidate || normalized.includes(candidate)) return;
    onChange?.([...normalized, candidate]);
    setCandidate('');
  };

  const remove = (code) =>
    onChange?.(normalized.filter((current) => current !== code));

  return (
    <Stack gap={5}>
      {label && (
        <Text component="label" size={size === 'xs' ? 'xs' : 'sm'} fw={500}>
          {label}
        </Text>
      )}
      <Group gap={5} wrap="nowrap">
        <Select
          aria-label={label ? `${label} language` : 'Language'}
          placeholder="Select language"
          searchable
          disabled={disabled}
          size={size}
          data={options}
          value={candidate || null}
          onChange={(next) => setCandidate(next || '')}
          style={{ flex: 1 }}
        />
        <Button
          aria-label={label ? `Add ${label} language` : 'Add language'}
          disabled={disabled || !candidate}
          size={size || 'sm'}
          px="sm"
          onClick={add}
        >
          +
        </Button>
      </Group>
      {normalized.length > 0 && (
        <Group gap={5}>
          {normalized.map((code) => (
            <Button
              key={code}
              aria-label={`Remove ${code}`}
              variant="light"
              color="gray"
              size="compact-xs"
              disabled={disabled}
              onClick={() => remove(code)}
            >
              {labelForCode(code)} ×
            </Button>
          ))}
        </Group>
      )}
    </Stack>
  );
};

export default LanguagePicker;
