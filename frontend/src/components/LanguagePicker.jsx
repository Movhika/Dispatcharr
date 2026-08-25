import React, { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
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
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState([]);
  const options = useMemo(
    () =>
      LANGUAGE_OPTIONS.filter((option) =>
        option.label.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [query]
  );

  const openPicker = () => {
    setPending(normalized);
    setQuery('');
    setOpened(true);
  };

  const toggle = (code) =>
    setPending((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code]
    );

  const apply = () => {
    onChange?.(normalizeLanguageCodes(pending));
    setOpened(false);
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
      <Group gap={5} justify="space-between" align="flex-start">
        <Group gap={5} style={{ flex: 1 }}>
          {normalized.length ? (
            normalized.map((code) => (
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
            ))
          ) : (
            <Text size="sm" c="dimmed">
              No languages selected
            </Text>
          )}
        </Group>
        <Button
          aria-label={label ? `Add ${label} language` : 'Add language'}
          disabled={disabled}
          size={size || 'sm'}
          px="sm"
          variant="default"
          onClick={openPicker}
        >
          +
        </Button>
      </Group>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={label || 'Select languages'}
        size="md"
      >
        <Stack>
          <TextInput
            aria-label="Search languages"
            placeholder="Search by code or language name"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <ScrollArea h={360} type="auto">
            <Stack gap={2}>
              {options.map((option) => (
                <Checkbox
                  key={option.value}
                  label={option.label}
                  checked={pending.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  py={5}
                />
              ))}
            </Stack>
          </ScrollArea>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button onClick={apply}>Apply</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default LanguagePicker;
