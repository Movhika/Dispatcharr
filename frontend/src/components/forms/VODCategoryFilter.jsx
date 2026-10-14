import React, {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  TextInput,
  Button,
  Flex,
  Group,
  Modal,
  Stack,
  ActionIcon,
  Tooltip,
  ScrollArea,
  Table,
  TableThead,
  TableTbody,
  TableTr,
  TableTh,
  TableTd,
  Text,
  Checkbox,
  SegmentedControl,
  Select,
} from '@mantine/core';
import { Eye } from 'lucide-react';
import useVODStore from '../../store/useVODStore';
import ListPagination from '../ListPagination.jsx';
import M3UGroupContentPreview from './M3UGroupContentPreview.jsx';

export const VOD_CATEGORY_QUALITIES = ['4K', '1080p', '720p', '480p', 'SD'];

// Common ISO 639-1 codes for IPTV VOD catalogs.
export const VOD_CATEGORY_LANGUAGES = [
  { value: 'en', label: 'English (en)' },
  { value: 'es', label: 'Spanish (es)' },
  { value: 'fr', label: 'French (fr)' },
  { value: 'de', label: 'German (de)' },
  { value: 'it', label: 'Italian (it)' },
  { value: 'pt', label: 'Portuguese (pt)' },
  { value: 'nl', label: 'Dutch (nl)' },
  { value: 'pl', label: 'Polish (pl)' },
  { value: 'ru', label: 'Russian (ru)' },
  { value: 'ar', label: 'Arabic (ar)' },
  { value: 'tr', label: 'Turkish (tr)' },
  { value: 'ja', label: 'Japanese (ja)' },
  { value: 'ko', label: 'Korean (ko)' },
  { value: 'zh', label: 'Chinese (zh)' },
  { value: 'hi', label: 'Hindi (hi)' },
  { value: 'sv', label: 'Swedish (sv)' },
  { value: 'no', label: 'Norwegian (no)' },
  { value: 'da', label: 'Danish (da)' },
  { value: 'fi', label: 'Finnish (fi)' },
  { value: 'cs', label: 'Czech (cs)' },
  { value: 'el', label: 'Greek (el)' },
  { value: 'he', label: 'Hebrew (he)' },
  { value: 'hu', label: 'Hungarian (hu)' },
  { value: 'ro', label: 'Romanian (ro)' },
  { value: 'uk', label: 'Ukrainian (uk)' },
  { value: 'th', label: 'Thai (th)' },
  { value: 'vi', label: 'Vietnamese (vi)' },
  { value: 'id', label: 'Indonesian (id)' },
  { value: 'ms', label: 'Malay (ms)' },
];

const QUALITY_OPTIONS = VOD_CATEGORY_QUALITIES.map((q) => ({
  value: q,
  label: q,
}));
const EMPTY_BULK_SETTINGS = Object.freeze({
  enabled: 'keep',
  language: 'keep',
  quality: 'keep',
});

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
  onPreview,
  selected,
  onSelect,
}) {
  const props = category.custom_properties || {};
  return (
    <TableTr>
      <TableTd>
        <Checkbox
          aria-label={`Select ${category.name}`}
          checked={selected}
          onChange={(event) =>
            onSelect(category.id, event.currentTarget.checked)
          }
        />
      </TableTd>
      <TableTd>
        <Button
          color={category.enabled ? 'green' : 'gray'}
          variant="subtle"
          size="xs"
          onClick={() => onToggle(category.id)}
        >
          {category.name}
        </Button>
      </TableTd>
      <TableTd>
        <Text size="xs" c={category.enabled ? 'green' : 'dimmed'}>
          {category.enabled ? 'Active' : 'Inactive'}
        </Text>
      </TableTd>
      <TableTd>
        <Select
          size="xs"
          aria-label="Language"
          placeholder="Language"
          data={VOD_CATEGORY_LANGUAGES}
          value={props.language || null}
          onChange={(value) =>
            onCustomPropertyChange(category.id, 'language', value)
          }
          searchable
          clearable
          allowDeselect
        />
      </TableTd>
      <TableTd>
        <Select
          size="xs"
          aria-label="Quality"
          placeholder="Quality"
          data={QUALITY_OPTIONS}
          value={props.quality || null}
          onChange={(value) =>
            onCustomPropertyChange(category.id, 'quality', value)
          }
          clearable
          allowDeselect
        />
      </TableTd>
      <TableTd>
        <Tooltip label="Preview category">
          <ActionIcon
            variant="subtle"
            aria-label="Preview category"
            onClick={() => onPreview(category)}
          >
            <Eye size={16} />
          </ActionIcon>
        </Tooltip>
      </TableTd>
    </TableTr>
  );
});

const VODCategoryFilter = ({
  playlist = null,
  categoryStates,
  setCategoryStates,
  type,
  autoEnableNewGroups,
  setAutoEnableNewGroups,
  onOpenRules,
  onOverlayChange,
}) => {
  const categories = useVODStore((s) => s.categories);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [previewCategory, setPreviewCategory] = useState(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState(new Set());
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const [bulkSettings, setBulkSettings] = useState(EMPTY_BULK_SETTINGS);
  useEffect(() => {
    const ids = new Set(categoryStates.map((category) => category.id));
    setSelectedCategoryIds((current) => {
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [categoryStates]);
  useEffect(() => {
    onOverlayChange?.(bulkEditorOpen || !!previewCategory);
    return () => onOverlayChange?.(false);
  }, [bulkEditorOpen, previewCategory, onOverlayChange]);
  const initializedScope = useRef(null);
  useEffect(() => {
    setPage(1);
  }, [filter, statusFilter, type]);
  useEffect(() => {
    setSelectedCategoryIds(new Set());
    setBulkEditorOpen(false);
  }, [playlist.id, type]);

  useEffect(() => {
    if (Object.keys(categories).length === 0) {
      return;
    }

    const key = `${playlist.id}:${type}`;
    const sameScope = initializedScope.current === key;
    initializedScope.current = key;
    setCategoryStates((previous) =>
      Object.values(categories)
        .filter(
          (cat) =>
            cat.m3u_accounts.find((acc) => acc.m3u_account == playlist.id) &&
            cat.category_type == type
        )
        .map((cat) => {
          const existing = sameScope
            ? previous.find((row) => row.id === cat.id)
            : null;
          if (existing) return { ...cat, ...existing, name: cat.name };
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

  const toggleSelectedCategory = useCallback((id, checked) => {
    setSelectedCategoryIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const updateSelectedCategories = (changes) => {
    setCategoryStates((current) =>
      current.map((category) =>
        selectedCategoryIds.has(category.id)
          ? { ...category, ...changes }
          : category
      )
    );
  };
  const closeBulkEditor = () => {
    setBulkEditorOpen(false);
    setBulkSettings(EMPTY_BULK_SETTINGS);
  };
  const applyBulkSettings = () => {
    setCategoryStates((current) =>
      current.map((category) => {
        if (!selectedCategoryIds.has(category.id)) return category;
        const next = {
          ...category,
          custom_properties: { ...category.custom_properties },
        };
        if (bulkSettings.enabled !== 'keep')
          next.enabled = bulkSettings.enabled === 'enabled';
        ['language', 'quality'].forEach((key) => {
          if (bulkSettings[key] !== 'keep')
            next.custom_properties[key] =
              bulkSettings[key] === 'clear' ? null : bulkSettings[key];
        });
        return next;
      })
    );
    closeBulkEditor();
  };

  const visibleCategories = categoryStates
    .filter((category) => isVisible(category))
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectedVisibleCount = visibleCategories.filter((category) =>
    selectedCategoryIds.has(category.id)
  ).length;
  const toggleVisibleSelection = (checked) => {
    setSelectedCategoryIds((current) => {
      const next = new Set(current);
      visibleCategories.forEach((category) =>
        checked ? next.add(category.id) : next.delete(category.id)
      );
      return next;
    });
  };

  return (
    <Stack style={{ height: '100%', minHeight: 0 }}>
      <Flex gap="xs" align="center" wrap="wrap">
        <Button variant="default" size="xs" onClick={onOpenRules}>
          Import rules
        </Button>
        <Tooltip
          label="Fallback for new categories not matched by an import rule. Existing selections are unchanged."
          multiline
          maw={360}
          withArrow
        >
          <Checkbox
            label={`Enable unmatched new ${type === 'movie' ? 'movie' : 'series'} categories`}
            checked={autoEnableNewGroups}
            onChange={(event) =>
              setAutoEnableNewGroups(event.currentTarget.checked)
            }
            size="sm"
          />
        </Tooltip>
      </Flex>

      <Flex gap="sm" align="center" wrap="wrap">
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
        <Button
          variant="default"
          size="xs"
          disabled={!selectedCategoryIds.size}
          onClick={() => updateSelectedCategories({ enabled: true })}
        >
          Enable selected
        </Button>
        <Button
          variant="default"
          size="xs"
          disabled={!selectedCategoryIds.size}
          onClick={() => updateSelectedCategories({ enabled: false })}
        >
          Disable selected
        </Button>
        <Button
          variant="default"
          size="xs"
          disabled={!selectedCategoryIds.size}
          onClick={() => {
            setBulkSettings(EMPTY_BULK_SETTINGS);
            setBulkEditorOpen(true);
          }}
        >
          Edit settings ({selectedCategoryIds.size})
        </Button>
        {selectedCategoryIds.size > 0 && (
          <Button
            variant="subtle"
            size="xs"
            onClick={() => setSelectedCategoryIds(new Set())}
          >
            Clear selection
          </Button>
        )}
      </Flex>

      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Table striped withTableBorder stickyHeader miw={700}>
          <TableThead>
            <TableTr>
              <TableTh w={44}>
                <Checkbox
                  aria-label="Select visible categories"
                  checked={
                    visibleCategories.length > 0 &&
                    selectedVisibleCount === visibleCategories.length
                  }
                  indeterminate={
                    selectedVisibleCount > 0 &&
                    selectedVisibleCount < visibleCategories.length
                  }
                  disabled={!visibleCategories.length}
                  onChange={(event) =>
                    toggleVisibleSelection(event.currentTarget.checked)
                  }
                />
              </TableTh>
              <TableTh>Category</TableTh>
              <TableTh>Enabled</TableTh>
              <TableTh>Language</TableTh>
              <TableTh>Quality</TableTh>
              <TableTh>Actions</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {visibleCategories
              .slice((page - 1) * pageSize, page * pageSize)
              .map((category) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  onToggle={toggleEnabled}
                  onCustomPropertyChange={updateCustomProperty}
                  onPreview={setPreviewCategory}
                  selected={selectedCategoryIds.has(category.id)}
                  onSelect={toggleSelectedCategory}
                />
              ))}
          </TableTbody>
        </Table>
      </ScrollArea>
      <ListPagination
        page={page}
        pageSize={pageSize}
        total={visibleCategories.length}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
      <M3UGroupContentPreview
        accountId={playlist.id}
        scope={type}
        group={previewCategory}
        onClose={() => setPreviewCategory(null)}
      />
      <Modal
        opened={bulkEditorOpen}
        onClose={closeBulkEditor}
        title={`Edit settings for ${selectedCategoryIds.size} categories`}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Keep unchanged preserves each category's settings. Apply changes the
            draft; Save persists it.
          </Text>
          <Select
            label="Enabled"
            value={bulkSettings.enabled}
            onChange={(value) =>
              setBulkSettings((current) => ({
                ...current,
                enabled: value || 'keep',
              }))
            }
            data={[
              { value: 'keep', label: 'Keep unchanged' },
              { value: 'enabled', label: 'Enabled' },
              { value: 'disabled', label: 'Disabled' },
            ]}
          />
          <Select
            label="Language"
            value={bulkSettings.language}
            onChange={(value) =>
              setBulkSettings((current) => ({
                ...current,
                language: value || 'keep',
              }))
            }
            data={[
              { value: 'keep', label: 'Keep unchanged' },
              { value: 'clear', label: 'Clear' },
              ...VOD_CATEGORY_LANGUAGES,
            ]}
          />
          <Select
            label="Quality"
            value={bulkSettings.quality}
            onChange={(value) =>
              setBulkSettings((current) => ({
                ...current,
                quality: value || 'keep',
              }))
            }
            data={[
              { value: 'keep', label: 'Keep unchanged' },
              { value: 'clear', label: 'Clear' },
              ...QUALITY_OPTIONS,
            ]}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeBulkEditor}>
              Cancel
            </Button>
            <Button
              onClick={applyBulkSettings}
              disabled={!selectedCategoryIds.size}
            >
              Apply
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default VODCategoryFilter;
