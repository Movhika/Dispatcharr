import React, {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useState,
} from 'react';
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
  Select,
  MultiSelect,
} from '@mantine/core';
import { CircleCheck, CircleX } from 'lucide-react';
import useVODStore from '../../store/useVODStore';
import API from '../../api';

export const VOD_CATEGORY_QUALITIES = [
  '4320p',
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '576p',
  '480p',
  'SD',
];

// Initial options; the backend supplies the complete ISO 639-2/B catalogue.
export const VOD_CATEGORY_LANGUAGES = [
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

const QUALITY_OPTIONS = VOD_CATEGORY_QUALITIES.map((q) => ({
  value: q,
  label: q,
}));

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
  onCustomPropertyChange,
  languageOptions,
}) {
  const props = category.custom_properties || {};
  const audioLanguages =
    props.audio_languages ??
    (props.language
      ? [
          VOD_CATEGORY_LANGUAGES.find(
            (option) => option.legacyValue === props.language
          )?.value || props.language,
        ]
      : []);
  const optionsFor = (values) => [
    ...languageOptions,
    ...values
      .filter(
        (value) => !languageOptions.some((option) => option.value === value)
      )
      .map((value) => ({ value, label: value })),
  ];

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
      <Button
        color={category.enabled ? 'green' : 'gray'}
        variant="filled"
        onClick={() => onToggle(category.id)}
        radius="md"
        size="xs"
        leftSection={
          category.enabled ? <CircleCheck size={14} /> : <CircleX size={14} />
        }
        fullWidth
      >
        <Text size="xs" truncate>
          {category.name}
        </Text>
      </Button>
      <Group grow gap="xs" wrap="nowrap">
        <MultiSelect
          size="xs"
          aria-label="Audio languages"
          placeholder="Audio languages"
          data={optionsFor(audioLanguages)}
          value={audioLanguages}
          onChange={(value) =>
            onCustomPropertyChange(category.id, 'audio_languages', value)
          }
          searchable
          clearable
        />
        <MultiSelect
          size="xs"
          aria-label="Subtitle languages"
          placeholder="Subtitle languages"
          data={optionsFor(props.subtitle_languages || [])}
          value={props.subtitle_languages || []}
          onChange={(value) =>
            onCustomPropertyChange(category.id, 'subtitle_languages', value)
          }
          searchable
          clearable
        />
      </Group>
      <Group grow gap="xs" wrap="nowrap">
        <Select
          size="xs"
          aria-label="Quality"
          placeholder="Quality"
          data={QUALITY_OPTIONS}
          value={
            props.resolution ||
            (props.quality === '4K' ? '2160p' : props.quality) ||
            null
          }
          onChange={(value) =>
            onCustomPropertyChange(category.id, 'resolution', value)
          }
          clearable
          allowDeselect
        />
        <MultiSelect
          size="xs"
          aria-label="Video features"
          placeholder="Video features"
          data={[
            { value: 'hdr', label: 'HDR' },
            { value: 'dv', label: 'Dolby Vision' },
            { value: '3d', label: '3D' },
          ]}
          value={props.video_features || []}
          onChange={(value) =>
            onCustomPropertyChange(category.id, 'video_features', value)
          }
          clearable
        />
      </Group>
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

  const updateCustomProperty = useCallback(
    (id, key, value) => {
      const nextValue = value === '' || value == null ? null : value;
      // Keep the Select close/selection responsive; list paint can wait a frame.
      startTransition(() => {
        setCategoryStates((prev) =>
          prev.map((state) => {
            if (state.id !== id) return state;
            return {
              ...state,
              custom_properties: {
                ...(state.custom_properties || {}),
                // null clears the key on the API merge path
                [key]: nextValue,
              },
            };
          })
        );
      });
    },
    [setCategoryStates]
  );

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
              onCustomPropertyChange={updateCustomProperty}
              languageOptions={languageOptions}
            />
          ))}
        </SimpleGrid>
      </Box>
    </Stack>
  );
};

export default VODCategoryFilter;
