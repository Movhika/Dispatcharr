import React, { Suspense, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Checkbox,
  Flex,
  Group,
  Image,
  Loader,
  LoadingOverlay,
  Modal,
  Pagination,
  SegmentedControl,
  Select,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { History, Play, Search, SlidersHorizontal, Wrench } from 'lucide-react';
import { useDisclosure } from '@mantine/hooks';
import API from '../api';
import useVODStore from '../store/useVODStore';
import useAuthStore from '../store/auth';
import usePlaylistsStore from '../store/playlists';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { showNotification } from '../utils/notificationUtils';
import {
  filterCategoriesToEnabled,
  getCategoryOptions,
} from '../utils/pages/VODsUtils.js';
import { normalizeLanguageCodes } from '../utils/languageCodes.js';
import LanguagePicker, {
  LanguageSelect,
} from '../components/LanguagePicker.jsx';
import {
  CONTAINER_EXTENSION_OPTIONS,
  RESOLUTION_VALUES,
} from '../utils/vodMetadataOptions.js';

const SeriesModal = React.lazy(() => import('../components/SeriesModal'));
const VODModal = React.lazy(() => import('../components/VODModal'));
const VODSourceManagerModal = React.lazy(
  () => import('../components/VODSourceManagerModal')
);
const VODOutputProfilesModal = React.lazy(
  () => import('../components/VODOutputProfilesModal')
);

const itemKey = (item) => `${item.contentType}:${item.id}`;
const logoUrl = (item) =>
  item.logo?.cache_url || item.logo?.url || item.logo_url || null;
const sourceMetadataValue = (item, field) => {
  const values = item.source_metadata?.[field] || [];
  return Array.isArray(values) && values.length ? values.join(', ') : '—';
};
const sourceCount = (item) =>
  item.source_count ?? item.source_metadata?.source_count ?? 0;

const VODsPage = () => {
  const currentPageContent = useVODStore((s) => s.currentPageContent);
  const allCategories = useVODStore((s) => s.categories);
  const filters = useVODStore((s) => s.filters);
  const currentPage = useVODStore((s) => s.currentPage);
  const totalCount = useVODStore((s) => s.totalCount);
  const pageSize = useVODStore((s) => s.pageSize);
  const setFilters = useVODStore((s) => s.setFilters);
  const setPage = useVODStore((s) => s.setPage);
  const setPageSize = useVODStore((s) => s.setPageSize);
  const fetchContent = useVODStore((s) => s.fetchContent);
  const fetchCategories = useVODStore((s) => s.fetchCategories);
  const user = useAuthStore((state) => state.user);
  const playlists = usePlaylistsStore((state) => state.playlists);
  const fetchPlaylists = usePlaylistsStore((state) => state.fetchPlaylists);

  const [selectedSeries, setSelectedSeries] = useState(null);
  const [selectedVOD, setSelectedVOD] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [bulkMetadata, setBulkMetadata] = useState({
    audio_languages: [],
    subtitle_languages: [],
    resolution: '',
    container_extension: '',
  });
  const [bulkSaving, setBulkSaving] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [categories, setCategories] = useState({});
  const [seriesModalOpened, seriesModalHandlers] = useDisclosure(false);
  const [vodModalOpened, vodModalHandlers] = useDisclosure(false);
  const [sourceManagerOpened, sourceManagerHandlers] = useDisclosure(false);
  const [profilesOpened, profilesHandlers] = useDisclosure(false);
  const [bulkEditorOpened, bulkEditorHandlers] = useDisclosure(false);

  const items = useMemo(
    () =>
      (currentPageContent || []).map((item) => ({
        ...item,
        contentType: item.contentType || item.content_type,
      })),
    [currentPageContent]
  );
  const visibleKeys = items.map(itemKey);
  const allVisibleSelected =
    visibleKeys.length > 0 &&
    visibleKeys.every((key) =>
      selectAllMatching ? !selected.has(key) : selected.has(key)
    );
  const selectedCount = selectAllMatching
    ? Math.max(0, totalCount - selected.size)
    : selected.size;

  useEffect(() => {
    const stored = localStorage.getItem('vodsPageSize');
    if (stored && !isNaN(Number(stored)) && Number(stored) !== pageSize) {
      setPageSize(Number(stored));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setCategories(filterCategoriesToEnabled(allCategories));
  }, [allCategories]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    if (!playlists.length) fetchPlaylists();
  }, [fetchPlaylists, playlists.length]);

  useEffect(() => {
    fetchContent().finally(() => setInitialLoad(false));
  }, [filters, currentPage, pageSize, fetchContent]);

  useEffect(() => {
    // A global selection always tracks the current filtered result set.
    // Explicit selections are cleared because their previous rows may no
    // longer be part of the visible filter universe.
    setSelected(new Set());
  }, [
    filters.type,
    filters.search,
    filters.category,
    filters.m3u_account,
    filters.audio_language,
    filters.subtitle_language,
    filters.resolution,
    filters.container_extension,
  ]);

  const toggleItem = (key, checked) => {
    setSelected((current) => {
      const next = new Set(current);
      if (selectAllMatching) {
        if (checked) next.delete(key);
        else next.add(key);
      } else if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAllMatching = (checked) => {
    setSelectAllMatching(checked);
    setSelected(new Set());
  };

  const openItem = (item) => {
    if (item.contentType === 'series') {
      setSelectedSeries(item);
      seriesModalHandlers.open();
    } else {
      setSelectedVOD(item);
      vodModalHandlers.open();
    }
  };

  const saveBulkMetadata = async () => {
    const selections = [...selected].map((key) => {
      const [content_type, id] = key.split(':');
      return { content_type, id: Number(id) };
    });
    const metadata = Object.fromEntries(
      Object.entries(bulkMetadata).filter(
        ([, value]) =>
          value !== '' && (!Array.isArray(value) || value.length > 0)
      )
    );
    if (metadata.audio_languages) {
      metadata.audio_languages = normalizeLanguageCodes(
        metadata.audio_languages
      );
    }
    if (metadata.subtitle_languages) {
      metadata.subtitle_languages = normalizeLanguageCodes(
        metadata.subtitle_languages
      );
    }
    setBulkSaving(true);
    try {
      const result = selectAllMatching
        ? await API.bulkUpdateVODSourceMetadata([], metadata, {
            select_all: true,
            filters,
            exclude_selections: selections,
          })
        : await API.bulkUpdateVODSourceMetadata(selections, metadata, {
            filters,
          });
      showNotification({
        title: 'Source metadata updated',
        message: `${result.updated_sources || 0} source editions were updated and locked.`,
        color: 'green',
      });
      bulkEditorHandlers.close();
      setSelected(new Set());
      setSelectAllMatching(false);
    } finally {
      setBulkSaving(false);
    }
  };

  const categoryOptions = getCategoryOptions(categories, filters);
  const m3uOptions = playlists
    .filter(
      (playlist) =>
        playlist.account_type === 'XC' &&
        playlist.is_active &&
        playlist.enable_vod
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((playlist) => ({ value: String(playlist.id), label: playlist.name }));
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <Box p="md" id="vods-container">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="md">
            <Title order={2}>Video on Demand</Title>
            <Text c="dimmed">
              {selectedCount} selected · {totalCount} matching
            </Text>
          </Group>
          {user?.user_level >= 10 && (
            <Group>
              <Button
                variant="default"
                leftSection={<SlidersHorizontal size={16} />}
                onClick={profilesHandlers.open}
              >
                Output profiles
              </Button>
              <Button
                variant="default"
                leftSection={<Wrench size={16} />}
                disabled={selectedCount === 0}
                onClick={bulkEditorHandlers.open}
              >
                Edit selected ({selectedCount})
              </Button>
              <Button
                variant="default"
                leftSection={<History size={16} />}
                onClick={sourceManagerHandlers.open}
              >
                Playback history
              </Button>
            </Group>
          )}
        </Group>

        <Stack gap="xs">
          <Group gap="md" align="end">
            <SegmentedControl
              value={filters.type}
              onChange={(value) => {
                setFilters({ type: value, category: '' });
                setPage(1);
              }}
              data={[
                { label: 'All', value: 'all' },
                { label: 'Movies', value: 'movies' },
                { label: 'Series', value: 'series' },
              ]}
            />
            <TextInput
              placeholder="Search VODs..."
              leftSection={<Search size={16} />}
              value={filters.search}
              onChange={(event) => setFilters({ search: event.target.value })}
              miw={240}
            />
            <Select
              placeholder="M3U account"
              data={m3uOptions}
              value={filters.m3u_account || null}
              onChange={(value) => {
                setFilters({ m3u_account: value || '', category: '' });
                setPage(1);
              }}
              searchable
              clearable
              miw={180}
            />
            <Select
              placeholder="Category"
              data={categoryOptions}
              value={filters.category}
              onChange={(value) => {
                setFilters({ category: value || '' });
                setPage(1);
              }}
              clearable
              miw={180}
            />
            <Select
              label="Rows"
              value={String(pageSize)}
              onChange={(value) => {
                setPageSize(Number(value));
                localStorage.setItem('vodsPageSize', value);
              }}
              data={['24', '48', '96'].map((value) => ({
                value,
                label: value,
              }))}
              w={100}
            />
          </Group>
          <Group gap="md" align="end">
            <LanguageSelect
              label="DUB"
              value={filters.audio_language}
              onChange={(value) => setFilters({ audio_language: value })}
              w={155}
            />
            <LanguageSelect
              label="SUB"
              value={filters.subtitle_language}
              onChange={(value) => setFilters({ subtitle_language: value })}
              w={155}
            />
            <Select
              label="Resolution"
              placeholder="Any"
              clearable
              data={RESOLUTION_VALUES}
              value={filters.resolution || null}
              onChange={(value) => setFilters({ resolution: value || '' })}
              w={130}
            />
            <Select
              label="Format"
              placeholder="Any"
              clearable
              searchable
              data={CONTAINER_EXTENSION_OPTIONS}
              value={filters.container_extension || null}
              onChange={(value) =>
                setFilters({ container_extension: value || '' })
              }
              w={115}
            />
          </Group>
        </Stack>

        {initialLoad ? (
          <Flex justify="center" py="xl">
            <Loader size="lg" />
          </Flex>
        ) : (
          <Table striped highlightOnHover withTableBorder stickyHeader>
            <TableThead>
              <TableTr>
                {user?.user_level >= 10 && (
                  <TableTh w={44}>
                    <Checkbox
                      aria-label="Select all filtered VODs"
                      checked={allVisibleSelected}
                      indeterminate={
                        (selectAllMatching && selected.size > 0) ||
                        (!selectAllMatching &&
                          selected.size > 0 &&
                          !allVisibleSelected)
                      }
                      onChange={(event) =>
                        toggleAllMatching(event.currentTarget.checked)
                      }
                    />
                  </TableTh>
                )}
                <TableTh w={62}>Artwork</TableTh>
                <TableTh>Title</TableTh>
                <TableTh w={100}>Type</TableTh>
                <TableTh w={90}>Year</TableTh>
                <TableTh w={85}>Sources</TableTh>
                <TableTh>Genre</TableTh>
                <TableTh w={125}>DUB</TableTh>
                <TableTh w={125}>SUB</TableTh>
                <TableTh w={130}>Resolution</TableTh>
                <TableTh w={100}>Format</TableTh>
                <TableTh w={60}>Open</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {items.map((item) => (
                <TableTr key={itemKey(item)}>
                  {user?.user_level >= 10 && (
                    <TableTd>
                      <Checkbox
                        aria-label={`Select ${item.name}`}
                        checked={
                          selectAllMatching
                            ? !selected.has(itemKey(item))
                            : selected.has(itemKey(item))
                        }
                        onChange={(event) =>
                          toggleItem(itemKey(item), event.currentTarget.checked)
                        }
                      />
                    </TableTd>
                  )}
                  <TableTd>
                    {logoUrl(item) ? (
                      <Image src={logoUrl(item)} h={54} w={40} fit="contain" />
                    ) : (
                      <Box h={54} w={40} bg="dark.6" />
                    )}
                  </TableTd>
                  <TableTd>
                    <Text fw={500}>{item.name}</Text>
                    {item.description && (
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {item.description}
                      </Text>
                    )}
                  </TableTd>
                  <TableTd>
                    {item.contentType === 'series' ? 'Series' : 'Movie'}
                  </TableTd>
                  <TableTd>{item.year || '—'}</TableTd>
                  <TableTd>{sourceCount(item)}</TableTd>
                  <TableTd>{item.genre || '—'}</TableTd>
                  <TableTd>
                    {sourceMetadataValue(item, 'audio_languages')}
                  </TableTd>
                  <TableTd>
                    {sourceMetadataValue(item, 'subtitle_languages')}
                  </TableTd>
                  <TableTd>{sourceMetadataValue(item, 'resolutions')}</TableTd>
                  <TableTd>
                    {sourceMetadataValue(item, 'container_extensions')}
                  </TableTd>
                  <TableTd>
                    <ActionIcon
                      aria-label={`Open ${item.name}`}
                      variant="subtle"
                      onClick={() => openItem(item)}
                    >
                      <Play size={16} />
                    </ActionIcon>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        )}

        {totalPages > 1 && (
          <Flex justify="center">
            <Pagination
              value={currentPage}
              onChange={setPage}
              total={totalPages}
            />
          </Flex>
        )}
        {selectAllMatching && selectedCount > 0 && (
          <Text size="sm" c="blue" ta="center">
            All {selectedCount} VODs matching the current filters are selected.
          </Text>
        )}
      </Stack>

      <Modal
        opened={bulkEditorOpened}
        onClose={bulkEditorHandlers.close}
        title={`Edit metadata for ${selectedCount} selected VODs`}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Values are applied to all source editions behind the selected
            titles, including episode sources for selected series. Manual values
            are locked and are never replaced by playback observations.
          </Text>
          <LanguagePicker
            label="Audio languages"
            value={bulkMetadata.audio_languages}
            onChange={(value) =>
              setBulkMetadata({
                ...bulkMetadata,
                audio_languages: normalizeLanguageCodes(value),
              })
            }
          />
          <LanguagePicker
            label="Subtitle languages"
            value={bulkMetadata.subtitle_languages}
            onChange={(value) =>
              setBulkMetadata({
                ...bulkMetadata,
                subtitle_languages: normalizeLanguageCodes(value),
              })
            }
          />
          <Select
            label="Resolution"
            description="Leave empty to keep existing values"
            clearable
            data={RESOLUTION_VALUES}
            value={bulkMetadata.resolution || null}
            onChange={(value) =>
              setBulkMetadata({ ...bulkMetadata, resolution: value || '' })
            }
          />
          <Select
            label="Format"
            description="Leave empty to keep existing values"
            clearable
            searchable
            data={CONTAINER_EXTENSION_OPTIONS}
            value={bulkMetadata.container_extension || null}
            onChange={(value) =>
              setBulkMetadata({
                ...bulkMetadata,
                container_extension: value || '',
              })
            }
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={bulkEditorHandlers.close}>
              Cancel
            </Button>
            <Button loading={bulkSaving} onClick={saveBulkMetadata}>
              Apply and lock
            </Button>
          </Group>
        </Stack>
      </Modal>

      <ErrorBoundary>
        <Suspense fallback={<LoadingOverlay />}>
          <SeriesModal
            series={selectedSeries}
            opened={seriesModalOpened}
            onClose={seriesModalHandlers.close}
          />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={<LoadingOverlay />}>
          <VODOutputProfilesModal
            opened={profilesOpened}
            onClose={profilesHandlers.close}
          />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={<LoadingOverlay />}>
          <VODSourceManagerModal
            opened={sourceManagerOpened}
            onClose={sourceManagerHandlers.close}
          />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={<LoadingOverlay />}>
          <VODModal
            vod={selectedVOD}
            opened={vodModalOpened}
            onClose={vodModalHandlers.close}
          />
        </Suspense>
      </ErrorBoundary>
    </Box>
  );
};

export default VODsPage;
