import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  TextInput,
  Button,
  Flex,
  Stack,
  Group,
  SimpleGrid,
  Text,
  Box,
  Checkbox,
  SegmentedControl,
  ActionIcon,
  Tooltip,
  Modal,
} from '@mantine/core';
import { CircleCheck, CircleX, Pencil } from 'lucide-react';
import useVODStore from '../../store/useVODStore';
import API from '../../api';
import VODCategoryMetadataEditor from './VODCategoryMetadataEditor';

const VOD_CATEGORY_QUALITIES = [
  '4320p',
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '576p',
  '480p',
  '360p',
];

// Initial options; the backend supplies the complete ISO 639-2/B catalogue.
const VOD_CATEGORY_LANGUAGES = [
  { value: 'eng', legacyValue: 'en', label: 'English (eng)' },
  { value: 'spa', legacyValue: 'es', label: 'Spanish (spa)' },
  { value: 'fre', legacyValue: 'fr', label: 'French (fre)' },
  { value: 'ger', legacyValue: 'de', label: 'German (ger)' },
  { value: 'ita', legacyValue: 'it', label: 'Italian (ita)' },
  { value: 'por', legacyValue: 'pt', label: 'Portuguese (por)' },
  { value: 'dut', legacyValue: 'nl', label: 'Dutch (dut)' },
  { value: 'pol', legacyValue: 'pl', label: 'Polish (pol)' },
  { value: 'rus', legacyValue: 'ru', label: 'Russian (rus)' },
  { value: 'ara', legacyValue: 'ar', label: 'Arabic (ara)' },
  { value: 'tur', legacyValue: 'tr', label: 'Turkish (tur)' },
  { value: 'jpn', legacyValue: 'ja', label: 'Japanese (jpn)' },
  { value: 'kor', legacyValue: 'ko', label: 'Korean (kor)' },
  { value: 'chi', legacyValue: 'zh', label: 'Chinese (chi)' },
  { value: 'hin', legacyValue: 'hi', label: 'Hindi (hin)' },
  { value: 'swe', legacyValue: 'sv', label: 'Swedish (swe)' },
  { value: 'nor', legacyValue: 'no', label: 'Norwegian (nor)' },
  { value: 'dan', legacyValue: 'da', label: 'Danish (dan)' },
  { value: 'fin', legacyValue: 'fi', label: 'Finnish (fin)' },
  { value: 'cze', legacyValue: 'cs', label: 'Czech (cze)' },
  { value: 'gre', legacyValue: 'el', label: 'Greek (gre)' },
  { value: 'heb', legacyValue: 'he', label: 'Hebrew (heb)' },
  { value: 'hun', legacyValue: 'hu', label: 'Hungarian (hun)' },
  { value: 'rum', legacyValue: 'ro', label: 'Romanian (rum)' },
  { value: 'ukr', legacyValue: 'uk', label: 'Ukrainian (ukr)' },
  { value: 'tha', legacyValue: 'th', label: 'Thai (tha)' },
  { value: 'vie', legacyValue: 'vi', label: 'Vietnamese (vie)' },
  { value: 'ind', legacyValue: 'id', label: 'Indonesian (ind)' },
  { value: 'may', legacyValue: 'ms', label: 'Malay (may)' },
];

const categoryMetadata = (category) => {
  const props = category.custom_properties || {};
  return {
    audio_languages:
      props.audio_languages ??
      (props.language
        ? [
            VOD_CATEGORY_LANGUAGES.find(
              (option) => option.legacyValue === props.language
            )?.value || props.language,
          ]
        : []),
    subtitle_languages: props.subtitle_languages || [],
    resolution: Object.hasOwn(props, 'resolution')
      ? props.resolution || ''
      : { '4K': '2160p', FHD: '1080p', HD: '720p' }[props.quality] ||
        props.quality ||
        '',
    video_features: props.video_features || [],
  };
};

const parseCustomProperties = (raw) => {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : { ...raw };
  } catch {
    return {};
  }
};

const CategoryCard = memo(function CategoryCard({
  category,
  onToggle,
  onEdit,
}) {
  const metadata = categoryMetadata(category);
  const summary = [
    metadata.audio_languages.length &&
      `DUB: ${metadata.audio_languages.join(', ').toUpperCase()}`,
    metadata.subtitle_languages.length &&
      `SUB: ${metadata.subtitle_languages.join(', ').toUpperCase()}`,
    metadata.resolution,
    metadata.video_features
      .map((feature) => feature.replace(/^custom:/, '').toUpperCase())
      .join(', '),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Stack
      gap={4}
      style={{
        padding: '8px',
        border: '1px solid #444',
        borderRadius: '8px',
        backgroundColor: category.enabled ? '#2A2A2E' : '#1E1E22',
      }}
    >
      <Group gap={4} wrap="nowrap">
        <Button
          type="button"
          color={category.enabled ? 'green' : 'gray'}
          variant="filled"
          onClick={() => onToggle(category.id)}
          radius="md"
          size="xs"
          leftSection={
            category.enabled ? <CircleCheck size={14} /> : <CircleX size={14} />
          }
          style={{ flex: 1, minWidth: 0 }}
          aria-pressed={category.enabled}
        >
          <Text size="xs" truncate>
            {category.name}
          </Text>
        </Button>
        <Tooltip label="Edit category defaults" withArrow>
          <ActionIcon
            type="button"
            variant="subtle"
            aria-label={`Edit defaults for ${category.name}`}
            onClick={() => onEdit(category)}
          >
            <Pencil size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {summary && (
        <Tooltip label={summary} withArrow>
          <Text size="xs" c="dimmed" truncate>
            {summary}
          </Text>
        </Tooltip>
      )}
    </Stack>
  );
});

const VODCategoryFilter = ({
  playlist = null,
  categoryStates,
  setCategoryStates,
  type,
  autoEnableNewGroups,
  setAutoEnableNewGroups,
}) => {
  const categories = useVODStore((s) => s.categories);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingCategory, setEditingCategory] = useState(null);
  const [languageOptions, setLanguageOptions] = useState(
    VOD_CATEGORY_LANGUAGES
  );

  useEffect(() => {
    let active = true;
    API.getVODMetadataOptions()
      .then((options) => {
        if (active) setLanguageOptions(options.languages);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Object.keys(categories).length === 0) {
      return;
    }

    setCategoryStates(
      Object.values(categories)
        .filter(
          (cat) =>
            cat.m3u_accounts.find((acc) => acc.m3u_account == playlist.id) &&
            cat.category_type == type
        )
        .map((cat) => {
          const match = cat.m3u_accounts.find(
            (acc) => acc.m3u_account == playlist.id
          );
          if (!match) return null;
          const custom_properties = parseCustomProperties(
            match.custom_properties
          );
          return {
            ...cat,
            enabled: match.enabled || false,
            original_enabled: match.enabled,
            custom_properties,
            original_custom_properties: { ...custom_properties },
          };
        })
        .filter(Boolean)
    );
  }, [categories, playlist.id, setCategoryStates, type]);

  const toggleEnabled = useCallback(
    (id) => {
      setCategoryStates((prev) =>
        prev.map((state) =>
          state.id == id ? { ...state, enabled: !state.enabled } : state
        )
      );
    },
    [setCategoryStates]
  );

  const applyMetadata = (metadata) => {
    setCategoryStates((current) =>
      current.map((category) =>
        category.id === editingCategory.id
          ? {
              ...category,
              custom_properties: {
                ...(category.custom_properties || {}),
                ...metadata,
                // null resets resolution on the existing API merge path.
                resolution: metadata.resolution || null,
              },
            }
          : category
      )
    );
    setEditingCategory(null);
  };

  const isVisible = useCallback(
    (category) => {
      const matchesText = category.name
        .toLowerCase()
        .includes(filter.toLowerCase());
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'enabled' && category.enabled) ||
        (statusFilter === 'disabled' && !category.enabled);
      return matchesText && matchesStatus;
    },
    [filter, statusFilter]
  );

  const selectAll = () => {
    setCategoryStates((prev) =>
      prev.map((state) => ({
        ...state,
        enabled: isVisible(state) ? true : state.enabled,
      }))
    );
  };

  const deselectAll = () => {
    setCategoryStates((prev) =>
      prev.map((state) => ({
        ...state,
        enabled: isVisible(state) ? false : state.enabled,
      }))
    );
  };

  const visibleCategories = categoryStates
    .filter((category) => isVisible(category))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Stack style={{ paddingTop: 10 }}>
      <Checkbox
        label={`Automatically enable new ${type === 'movie' ? 'movie' : 'series'} categories discovered on future scans`}
        checked={autoEnableNewGroups}
        onChange={(event) =>
          setAutoEnableNewGroups(event.currentTarget.checked)
        }
        size="sm"
        description="When disabled, new categories from the provider will be created but disabled by default. You can enable them manually later."
      />

      <Flex gap="sm" align="center">
        <TextInput
          placeholder="Filter categories..."
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
          style={{ flex: 1 }}
          size="xs"
        />
        <SegmentedControl
          value={statusFilter}
          onChange={setStatusFilter}
          size="xs"
          data={[
            { label: 'All', value: 'all' },
            { label: 'Enabled', value: 'enabled' },
            { label: 'Disabled', value: 'disabled' },
          ]}
        />
        <Button variant="default" size="xs" onClick={selectAll}>
          Select Visible
        </Button>
        <Button variant="default" size="xs" onClick={deselectAll}>
          Deselect Visible
        </Button>
      </Flex>

      <Box style={{ maxHeight: '50vh', overflowY: 'auto' }}>
        <SimpleGrid
          cols={{ base: 1, sm: 2, md: 2 }}
          spacing="xs"
          verticalSpacing="xs"
        >
          {visibleCategories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              onToggle={toggleEnabled}
              onEdit={setEditingCategory}
            />
          ))}
        </SimpleGrid>
      </Box>
      <Modal
        stackId={`vod-category-defaults-${type}`}
        opened={Boolean(editingCategory)}
        onClose={() => setEditingCategory(null)}
        title={`Category defaults · ${editingCategory?.name || ''}`}
        closeButtonProps={{ 'aria-label': 'Close category defaults' }}
        size="md"
      >
        {editingCategory && (
          <VODCategoryMetadataEditor
            key={editingCategory.id}
            value={categoryMetadata(editingCategory)}
            languages={[
              ...languageOptions,
              ...[
                ...new Set([
                  ...categoryMetadata(editingCategory).audio_languages,
                  ...categoryMetadata(editingCategory).subtitle_languages,
                ]),
              ]
                .filter(
                  (value) =>
                    !languageOptions.some((option) => option.value === value)
                )
                .map((value) => ({ value, label: value.toUpperCase() })),
            ]}
            commonLanguages={VOD_CATEGORY_LANGUAGES}
            resolutions={VOD_CATEGORY_QUALITIES}
            pickerStackId={`vod-category-metadata-${type}`}
            onApply={applyMetadata}
            onClose={() => setEditingCategory(null)}
          />
        )}
      </Modal>
    </Stack>
  );
};

export default VODCategoryFilter;
