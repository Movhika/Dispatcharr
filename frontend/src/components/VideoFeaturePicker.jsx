import React, { useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  InputBase,
  Modal,
  Stack,
  TextInput,
} from '@mantine/core';
import { Plus } from 'lucide-react';
import {
  VIDEO_FEATURE_OPTIONS,
  videoFeatureLabel,
} from '../utils/vodMetadataOptions.js';

const normalizeFeature = (value) => {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  if (['3d', 'hdr', 'dv'].includes(raw)) return raw;
  const slug = raw
    .replace(/^custom:/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  return slug ? `custom:${slug}` : '';
};

const normalizeFeatures = (values) => [
  ...new Set((values || []).map(normalizeFeature).filter(Boolean)),
];

const VideoFeaturePicker = ({
  label = 'Video features',
  value = [],
  onChange,
  disabled = false,
  size,
  description,
  emptyLabel = 'No features selected',
}) => {
  const normalized = useMemo(() => normalizeFeatures(value), [value]);
  const [opened, setOpened] = useState(false);
  const [pending, setPending] = useState([]);
  const [custom, setCustom] = useState('');

  const openPicker = () => {
    setPending(normalized);
    setCustom('');
    setOpened(true);
  };
  const toggle = (feature) =>
    setPending((current) =>
      current.includes(feature)
        ? current.filter((item) => item !== feature)
        : [...current, feature]
    );
  const addCustom = () => {
    const feature = normalizeFeature(custom);
    if (!feature) return;
    setPending((current) =>
      current.includes(feature) ? current : [...current, feature]
    );
    setCustom('');
  };

  return (
    <>
      <InputBase
        component="button"
        type="button"
        label={label}
        description={description}
        size={size}
        disabled={disabled}
        aria-label={label ? `Choose ${label}` : 'Choose video features'}
        onClick={disabled ? undefined : openPicker}
        rightSection={<Plus size={size === 'xs' ? 14 : 16} />}
        rightSectionPointerEvents="none"
        pointer
        style={{
          textAlign: 'left',
          width: '100%',
        }}
      >
        <Box
          style={{
            minHeight: size === 'xs' ? 20 : 22,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexWrap: 'wrap',
          }}
        >
          {normalized.length ? (
            normalized.map((feature) => (
              <Badge
                key={feature}
                variant="light"
                color="gray"
                size={size === 'xs' ? 'xs' : 'sm'}
              >
                {videoFeatureLabel(feature)}
              </Badge>
            ))
          ) : (
            <Box component="span" c="dimmed">
              {emptyLabel}
            </Box>
          )}
        </Box>
      </InputBase>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={label || 'Select video features'}
        size="md"
      >
        <Stack>
          {VIDEO_FEATURE_OPTIONS.map((option) => (
            <Checkbox
              key={option.value}
              label={option.label}
              checked={pending.includes(option.value)}
              onChange={() => toggle(option.value)}
            />
          ))}
          <Group align="flex-end" wrap="nowrap">
            <TextInput
              label="Custom tag"
              description="Stored as a reusable custom feature filter."
              placeholder="For example IMAX"
              value={custom}
              onChange={(event) => setCustom(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCustom();
                }
              }}
              style={{ flex: 1 }}
            />
            <Button
              variant="default"
              onClick={addCustom}
              disabled={!custom.trim()}
            >
              Add
            </Button>
          </Group>
          {pending
            .filter((feature) => feature.startsWith('custom:'))
            .map((feature) => (
              <Checkbox
                key={feature}
                label={videoFeatureLabel(feature)}
                checked
                onChange={() => toggle(feature)}
              />
            ))}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onChange?.(normalizeFeatures(pending));
                setOpened(false);
              }}
            >
              Apply
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

export default VideoFeaturePicker;
