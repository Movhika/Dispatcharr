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
}) {
  const props = category.custom_properties || {};
  return (
    <TableTr>
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
}) => {
  const categories = useVODStore((s) => s.categories);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [previewCategory, setPreviewCategory] = useState(null);
  const initializedScope = useRef(null);
  useEffect(() => {
    setPage(1);
  }, [filter, statusFilter, type]);

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
        <Button variant="default" size="xs" onClick={onOpenRules}>
          Import rules
        </Button>
      </Flex>

      <ScrollArea h="55vh">
        <Table striped withTableBorder miw={700}>
          <TableThead>
            <TableTr>
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
    </Stack>
  );
};

export default VODCategoryFilter;
