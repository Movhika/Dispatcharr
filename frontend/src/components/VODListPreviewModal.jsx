import React, { useEffect, useMemo, useState } from 'react';
import { useDebouncedValue } from '@mantine/hooks';
import {
  ActionIcon,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  NumberInput,
  Pagination,
  Popover,
  PopoverDropdown,
  PopoverTarget,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Eye, Filter, Search, Trash2 } from 'lucide-react';
import API from '../api';
import VODListItemDetails from './VODListItemDetails.jsx';
import VODTechnicalFilterFields from './VODTechnicalFilterFields.jsx';

const EMPTY_FILTERS = {
  type: 'all',
  availability: 'any',
  year_from: '',
  year_to: '',
  genre: '',
  anime_mode: '',
  adult_mode: '',
  library_added_after: '',
  library_added_before: '',
  audio_language: '',
  subtitle_language: '',
  resolution: '',
  container_extension: '',
  video_feature: '',
};

const EMPTY_OPTIONS = {
  audio_languages: [],
  subtitle_languages: [],
  resolutions: [],
  container_extensions: [],
  video_features: [],
};

const VODListPreviewModal = ({
  list,
  onClose,
  onListChanged,
  canRemove = false,
}) => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [detailItem, setDetailItem] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    API.getVODListItems(list.id, {
      page,
      page_size: 50,
      search: debouncedSearch,
      ...filters,
    })
      .then((response) => {
        if (active) setData(response);
      })
      .catch((error) => {
        if (active) {
          notifications.show({
            color: 'red',
            title: 'Could not load list items',
            message: error?.message || 'The request failed.',
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [list.id, page, debouncedSearch, filters]);

  useEffect(() => {
    let active = true;
    API.getVODListFilterOptions(list.id)
      .then((response) => {
        if (active) setOptions({ ...EMPTY_OPTIONS, ...(response || {}) });
      })
      .catch(() => {
        if (active) setOptions(EMPTY_OPTIONS);
      });
    return () => {
      active = false;
    };
  }, [list.id]);

  const advancedCount = useMemo(
    () =>
      Object.entries(filters).filter(
        ([key, value]) =>
          !['type', 'availability'].includes(key) && Boolean(value)
      ).length,
    [filters]
  );
  const updateFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  };
  const removeItem = async (item) => {
    setRemovingId(item.id);
    try {
      await API.removeVODListItems(list.id, [item.id]);
      setData((current) => ({
        ...current,
        count: Math.max(0, Number(current?.count || 0) - 1),
        results: (current?.results || []).filter((row) => row.id !== item.id),
      }));
      await onListChanged?.();
      notifications.show({ color: 'green', message: 'Removed from list.' });
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Could not remove title',
        message: error?.message || 'The request failed.',
      });
    } finally {
      setRemovingId(null);
    }
  };

  const items = data?.results || [];
  return (
    <>
      <Modal
        opened
        onClose={onClose}
        title={`${list.name} preview`}
        size="min(1280px, 94vw)"
      >
        <Stack>
          <Group align="end" wrap="wrap">
            <TextInput
              label="Search"
              placeholder="Search titles…"
              leftSection={<Search size={16} />}
              value={search}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                setPage(1);
              }}
              style={{ flex: '1 1 300px' }}
            />
            <Select
              label="Type"
              data={[
                { value: 'all', label: 'Movies and series' },
                { value: 'movie', label: 'Movies' },
                { value: 'series', label: 'Series' },
              ]}
              value={filters.type}
              onChange={(value) => updateFilter('type', value || 'all')}
              w={190}
            />
            <Select
              label="Availability"
              data={[
                { value: 'any', label: 'Any' },
                { value: 'available', label: 'In library' },
                { value: 'unavailable', label: 'Not in library' },
              ]}
              value={filters.availability}
              onChange={(value) => updateFilter('availability', value || 'any')}
              w={180}
            />
            <Popover
              width={500}
              position="bottom-end"
              shadow="md"
              withArrow
              withinPortal
            >
              <PopoverTarget>
                <Button
                  variant={advancedCount ? 'light' : 'default'}
                  leftSection={<Filter size={16} />}
                >
                  Filters{advancedCount ? ` (${advancedCount})` : ''}
                </Button>
              </PopoverTarget>
              <PopoverDropdown>
                <Stack gap="sm">
                  <SimpleGrid cols={2}>
                    <VODTechnicalFilterFields
                      filters={filters}
                      onChange={updateFilter}
                      optionsOverride={options}
                    />
                    <NumberInput
                      label="Release year from"
                      min={1800}
                      max={2200}
                      value={filters.year_from}
                      onChange={(value) =>
                        updateFilter('year_from', value || '')
                      }
                    />
                    <NumberInput
                      label="Release year until"
                      min={1800}
                      max={2200}
                      value={filters.year_to}
                      onChange={(value) => updateFilter('year_to', value || '')}
                    />
                    <TextInput
                      label="Genre contains"
                      value={filters.genre}
                      onChange={(event) =>
                        updateFilter('genre', event.currentTarget.value)
                      }
                    />
                    <Select
                      label="Anime"
                      placeholder="Any"
                      clearable
                      data={[
                        { value: 'yes', label: 'Yes' },
                        { value: 'no', label: 'No' },
                      ]}
                      value={filters.anime_mode || null}
                      onChange={(value) =>
                        updateFilter('anime_mode', value || '')
                      }
                    />
                    <Select
                      label="Adult content"
                      placeholder="Any"
                      clearable
                      data={[
                        { value: 'yes', label: 'Yes' },
                        { value: 'no', label: 'No' },
                      ]}
                      value={filters.adult_mode || null}
                      onChange={(value) =>
                        updateFilter('adult_mode', value || '')
                      }
                    />
                    <TextInput
                      type="date"
                      label="Added since"
                      value={filters.library_added_after}
                      onChange={(event) =>
                        updateFilter(
                          'library_added_after',
                          event.currentTarget.value
                        )
                      }
                    />
                    <TextInput
                      type="date"
                      label="Added until"
                      value={filters.library_added_before}
                      onChange={(event) =>
                        updateFilter(
                          'library_added_before',
                          event.currentTarget.value
                        )
                      }
                    />
                  </SimpleGrid>
                  <Group justify="flex-end">
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={!advancedCount}
                      onClick={() => {
                        setFilters((current) => ({
                          ...EMPTY_FILTERS,
                          type: current.type,
                          availability: current.availability,
                        }));
                        setPage(1);
                      }}
                    >
                      Clear filters
                    </Button>
                  </Group>
                </Stack>
              </PopoverDropdown>
            </Popover>
          </Group>
          {loading ? (
            <Center mih={320}>
              <Loader />
            </Center>
          ) : items.length ? (
            <>
              <ScrollArea h="min(66vh, 700px)">
                <Table striped highlightOnHover withTableBorder stickyHeader>
                  <TableThead>
                    <TableTr>
                      <TableTh>Title</TableTh>
                      <TableTh>Type</TableTh>
                      <TableTh>Year</TableTh>
                      <TableTh>Sources</TableTh>
                      <TableTh>Status</TableTh>
                      <TableTh>Details</TableTh>
                      {canRemove && list.list_type === 'manual' && (
                        <TableTh>Actions</TableTh>
                      )}
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {items.map((item) => (
                      <TableTr
                        key={item.id}
                        c={item.is_available ? undefined : 'dimmed'}
                      >
                        <TableTd>{item.display_title}</TableTd>
                        <TableTd>
                          {item.content_type === 'series' ? 'Series' : 'Movie'}
                        </TableTd>
                        <TableTd>{item.display_year || '—'}</TableTd>
                        <TableTd>{item.source_count || '—'}</TableTd>
                        <TableTd>
                          {item.is_available ? 'In library' : 'Not in library'}
                        </TableTd>
                        <TableTd>
                          <ActionIcon
                            variant="subtle"
                            aria-label={`Open details for ${item.display_title}`}
                            disabled={!item.is_available}
                            onClick={() => setDetailItem(item)}
                          >
                            <Eye size={17} />
                          </ActionIcon>
                        </TableTd>
                        {canRemove && list.list_type === 'manual' && (
                          <TableTd>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              loading={removingId === item.id}
                              aria-label={`Remove ${item.display_title}`}
                              onClick={() => removeItem(item)}
                            >
                              <Trash2 size={16} />
                            </ActionIcon>
                          </TableTd>
                        )}
                      </TableTr>
                    ))}
                  </TableTbody>
                </Table>
              </ScrollArea>
              <Group justify="center" gap="sm">
                <Pagination
                  value={page}
                  onChange={setPage}
                  total={Math.max(1, Math.ceil((data?.count || 0) / 50))}
                  withEdges
                />
                <Text size="sm" c="dimmed">
                  {data?.count || 0} titles
                </Text>
              </Group>
            </>
          ) : (
            <Center mih={280}>
              <Text c="dimmed">
                {data?.count === 0 &&
                (search ||
                  advancedCount ||
                  filters.type !== 'all' ||
                  filters.availability !== 'any')
                  ? 'No list entries match the current filters.'
                  : 'No titles in this list yet.'}
              </Text>
            </Center>
          )}
        </Stack>
      </Modal>

      <VODListItemDetails
        item={detailItem}
        onClose={() => setDetailItem(null)}
      />
    </>
  );
};

export default VODListPreviewModal;
