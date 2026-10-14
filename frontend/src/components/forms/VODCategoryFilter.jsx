import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  TextInput,
  Button,
  Flex,
  Group,
  Modal,
  Paper,
  Stack,
  ActionIcon,
  Badge,
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
import { Eye, Settings as Cog } from 'lucide-react';
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
  onConfigure,
  onPreview,
  selected,
  onSelect,
  previewAvailable,
  previewUnavailableHint,
}) {
  const props = category.custom_properties || {};
  return (
    <TableTr
      data-selected={selected || undefined}
      bg={selected ? 'var(--mantine-primary-color-light)' : undefined}
    >
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
        <Text size="sm" truncate>
          {category.name}
        </Text>
      </TableTd>
      <TableTd ta="center">
        <Badge
          size="sm"
          radius="sm"
          color={category.enabled ? 'green' : 'gray'}
          variant={category.enabled ? 'filled' : 'light'}
        >
          {category.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </TableTd>
      <TableTd>
        <Text size="xs">
          {VOD_CATEGORY_LANGUAGES.find(
            (option) => option.value === props.language
          )?.label ||
            props.language ||
            '—'}
        </Text>
      </TableTd>
      <TableTd>
        <Text size="xs">{props.quality || '—'}</Text>
      </TableTd>
      <TableTd>
        <Flex gap={4} align="center">
          <Tooltip label="Configure category">
            <ActionIcon
              aria-label={`Configure ${category.name}`}
              variant="subtle"
              onClick={() => onConfigure(category)}
            >
              <Cog size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip
            label={
              previewAvailable ? 'Preview category' : previewUnavailableHint
            }
            multiline
            maw={300}
            withArrow
            events={{ hover: true, focus: true, touch: true }}
          >
            <span
              style={{ display: 'inline-flex' }}
              tabIndex={previewAvailable ? undefined : 0}
              aria-label={previewAvailable ? undefined : previewUnavailableHint}
            >
              <ActionIcon
                variant="subtle"
                aria-label="Preview category"
                onClick={() => onPreview(category)}
                disabled={!previewAvailable}
              >
                <Eye size={16} />
              </ActionIcon>
            </span>
          </Tooltip>
        </Flex>
      </TableTd>
    </TableTr>
  );
});

const VODCategoryFilter = ({
  playlist = null,
  categoryStates,
  setCategoryStates,
  type,
  onOpenRules,
  onOverlayChange,
  paginationContainer = null,
  paginationVisible = true,
  previewAvailableIds,
  previewUnavailableHint,
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
  const [configuringCategoryId, setConfiguringCategoryId] = useState(null);
  const configureSnapshotRef = useRef(null);
  const configuringCategory = categoryStates.find(
    (category) => category.id === configuringCategoryId
  );
  useEffect(() => {
    const ids = new Set(categoryStates.map((category) => category.id));
    setSelectedCategoryIds((current) => {
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [categoryStates]);
  useEffect(() => {
    onOverlayChange?.(
      bulkEditorOpen || !!previewCategory || !!configuringCategory
    );
    return () => onOverlayChange?.(false);
  }, [bulkEditorOpen, previewCategory, configuringCategory, onOverlayChange]);
  const initializedScope = useRef(null);
  useEffect(() => {
    setPage(1);
  }, [filter, statusFilter, type]);
  useEffect(() => {
    setSelectedCategoryIds(new Set());
    setBulkEditorOpen(false);
    setConfiguringCategoryId(null);
    configureSnapshotRef.current = null;
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

  const updateCustomProperty = useCallback(
    (id, key, value) => {
      const nextValue = value === '' || value == null ? null : value;
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
    },
    [setCategoryStates]
  );

  const openConfigure = useCallback((category) => {
    configureSnapshotRef.current = {
      ...category,
      custom_properties: { ...category.custom_properties },
    };
    setConfiguringCategoryId(category.id);
  }, []);
  const closeConfigure = () => {
    configureSnapshotRef.current = null;
    setConfiguringCategoryId(null);
  };
  const cancelConfigure = () => {
    const snapshot = configureSnapshotRef.current;
    if (snapshot)
      setCategoryStates((current) =>
        current.map((category) =>
          category.id === snapshot.id ? snapshot : category
        )
      );
    closeConfigure();
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

  const pagination = (
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
  );

  return (
    <Stack gap="xs" style={{ height: '100%', minHeight: 0 }}>
      <Flex gap="xs" align="center" wrap="wrap">
        <Button variant="default" size="xs" onClick={onOpenRules}>
          Import rules
        </Button>
        <Text size="xs" c="dimmed">
          New unmatched categories are imported disabled.
        </Text>
      </Flex>

      <Flex gap="sm" align="center" wrap="wrap">
        <TextInput
          placeholder="Filter categories..."
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
          style={{ flex: '1 1 180px', minWidth: 0 }}
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
        <Table
          striped
          withTableBorder
          stickyHeader
          style={{ tableLayout: 'fixed' }}
        >
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
              <TableTh w="12%" ta="center">
                Status
              </TableTh>
              <TableTh w="20%">Language</TableTh>
              <TableTh w="12%">Quality</TableTh>
              <TableTh w={76}>Actions</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {visibleCategories
              .slice((page - 1) * pageSize, page * pageSize)
              .map((category) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  onConfigure={openConfigure}
                  onPreview={setPreviewCategory}
                  selected={selectedCategoryIds.has(category.id)}
                  onSelect={toggleSelectedCategory}
                  previewAvailable={
                    previewAvailableIds === undefined ||
                    !!previewAvailableIds?.has(category.id)
                  }
                  previewUnavailableHint={previewUnavailableHint}
                />
              ))}
          </TableTbody>
        </Table>
      </ScrollArea>
      {paginationVisible &&
        (paginationContainer
          ? createPortal(pagination, paginationContainer)
          : pagination)}
      <M3UGroupContentPreview
        accountId={playlist.id}
        scope={type}
        group={previewCategory}
        onClose={() => setPreviewCategory(null)}
      />
      <Modal
        opened={!!configuringCategory}
        onClose={cancelConfigure}
        size="lg"
        title={`Configure: ${configuringCategory?.name || ''}`}
      >
        {configuringCategory && (
          <Stack>
            <Select
              label="Language"
              data={VOD_CATEGORY_LANGUAGES}
              value={configuringCategory.custom_properties?.language || null}
              onChange={(value) =>
                updateCustomProperty(configuringCategory.id, 'language', value)
              }
              searchable
              clearable
            />
            <Select
              label="Quality"
              data={QUALITY_OPTIONS}
              value={configuringCategory.custom_properties?.quality || null}
              onChange={(value) =>
                updateCustomProperty(configuringCategory.id, 'quality', value)
              }
              clearable
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={cancelConfigure}>
                Cancel
              </Button>
              <Button onClick={closeConfigure}>Done</Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Modal
        opened={bulkEditorOpen}
        onClose={closeBulkEditor}
        title={`Edit settings for ${selectedCategoryIds.size} ${selectedCategoryIds.size === 1 ? 'category' : 'categories'}`}
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Keep unchanged preserves each category's setting. Apply updates the
            selection below; use Save in Categories to persist the changes.
          </Text>
          <Paper withBorder p="sm">
            <Stack gap="xs" role="group" aria-label="Category status settings">
              <Select
                label="Status"
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
            </Stack>
          </Paper>
          <Paper withBorder p="sm">
            <Stack gap="xs" role="group" aria-label="Category content settings">
              <Text fw={600}>Content</Text>
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
            </Stack>
          </Paper>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeBulkEditor}>
              Cancel
            </Button>
            <Button
              onClick={applyBulkSettings}
              disabled={!selectedCategoryIds.size}
            >
              Apply to selected
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default VODCategoryFilter;
