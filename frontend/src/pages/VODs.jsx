import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
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
import {
  DatabaseZap,
  History,
  LayoutGrid,
  List,
  Play,
  Search,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react';
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
import { LanguageSelect } from '../components/LanguagePicker.jsx';
import VODMetadataFields from '../components/VODMetadataFields.jsx';
import VideoFeaturePicker from '../components/VideoFeaturePicker.jsx';
import {
  CONTAINER_EXTENSION_OPTIONS,
  RESOLUTION_VALUES,
  videoFeatureLabel,
} from '../utils/vodMetadataOptions.js';
import {
  canViewVod,
  isVodMoviesEnabled,
  isVodSeriesEnabled,
} from '../utils/vodAccess';

const SeriesModal = React.lazy(() => import('../components/SeriesModal'));
const VODModal = React.lazy(() => import('../components/VODModal'));
const VODSourceManagerModal = React.lazy(
  () => import('../components/VODSourceManagerModal')
);
const VODOutputProfilesModal = React.lazy(
  () => import('../components/VODOutputProfilesModal')
);
const VODMetadataModal = React.lazy(
  () => import('../components/VODMetadataModal')
);

const itemKey = (item) => `${item.contentType}:${item.id}`;
const logoUrl = (item) =>
  item.artwork_url ||
  item.logo?.cache_url ||
  item.logo?.url ||
  item.logo_url ||
  null;
const sourceMetadataValue = (item, field) => {
  const values = item.source_metadata?.[field] || [];
  return Array.isArray(values) && values.length ? values.join(', ') : '—';
};
const sourceCount = (item) =>
  item.source_count ?? item.source_metadata?.source_count ?? 0;

const VODsPage = () => {
  const user = useAuthStore((state) => state.user);
  const moviesEnabled = isVodMoviesEnabled(user);
  const seriesEnabled = isVodSeriesEnabled(user);
  const vodAllowed = canViewVod(user);
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
    video_features: [],
  });
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkTitle, setBulkTitle] = useState({
    mode: 'keep',
    pattern: '',
    replacement: '',
  });
  const [initialLoad, setInitialLoad] = useState(true);
  const [viewMode, setViewMode] = useState(() =>
    localStorage.getItem('vodsViewMode') === 'posters' ? 'posters' : 'list'
  );
  const [categories, setCategories] = useState({});
  const [seriesModalOpened, seriesModalHandlers] = useDisclosure(false);
  const [vodModalOpened, vodModalHandlers] = useDisclosure(false);
  const [sourceManagerOpened, sourceManagerHandlers] = useDisclosure(false);
  const [profilesOpened, profilesHandlers] = useDisclosure(false);
  const [metadataOpened, metadataHandlers] = useDisclosure(false);
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

  // Hydrate page size from localStorage before the first content fetch so a
  // stored size that differs from the store default does not cause a refetch.
  const [pageSizeReady, setPageSizeReady] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem('vodsPageSize');
    if (stored && !isNaN(Number(stored)) && Number(stored) !== pageSize) {
      setPageSize(Number(stored));
    }
    setPageSizeReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only hydrate
  }, []);

  const typeOptions = useMemo(() => {
    const options = [];
    if (moviesEnabled && seriesEnabled) {
      options.push({ label: 'All', value: 'all' });
    }
    if (moviesEnabled) {
      options.push({ label: 'Movies', value: 'movies' });
    }
    if (seriesEnabled) {
      options.push({ label: 'Series', value: 'series' });
    }
    return options;
  }, [moviesEnabled, seriesEnabled]);

  // When only one content type is allowed, lock the store filter to it.
  // Fetch waits until the lock matches so we do not load the unified
  // "all" catalog first and then immediately refetch.
  const requiredType =
    moviesEnabled && !seriesEnabled
      ? 'movies'
      : seriesEnabled && !moviesEnabled
        ? 'series'
        : null;

  useEffect(() => {
    if (!vodAllowed || !requiredType || filters.type === requiredType) return;
    setFilters({ type: requiredType, category: '' });
  }, [vodAllowed, requiredType, filters.type, setFilters]);
  useEffect(() => {
    setCategories(filterCategoriesToEnabled(allCategories));
  }, [allCategories]);

  useEffect(() => {
    if (!vodAllowed) return;
    fetchCategories();
  }, [vodAllowed, fetchCategories]);

  useEffect(() => {
    if (!playlists.length) fetchPlaylists();
  }, [fetchPlaylists, playlists.length]);

  useEffect(() => {
    if (!vodAllowed || !pageSizeReady) return;
    if (requiredType && filters.type !== requiredType) return;
    fetchContent().finally(() => setInitialLoad(false));
  }, [
    vodAllowed,
    pageSizeReady,
    requiredType,
    filters,
    currentPage,
    pageSize,
    fetchContent,
  ]);

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
    filters.video_feature,
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
      const canonicalTitleOptions =
        bulkTitle.mode === 'keep' ? {} : { canonical_title: bulkTitle };
      const result = selectAllMatching
        ? await API.bulkUpdateVODSourceMetadata([], metadata, {
            select_all: true,
            filters,
            exclude_selections: selections,
            ...canonicalTitleOptions,
          })
        : await API.bulkUpdateVODSourceMetadata(selections, metadata, {
            filters,
            ...canonicalTitleOptions,
          });
      showNotification({
        title: 'Source metadata updated',
        message: `${result.updated_sources || 0} source editions and ${result.updated_titles || 0} canonical titles were updated.`,
        color: 'green',
      });
      bulkEditorHandlers.close();
      setSelected(new Set());
      setSelectAllMatching(false);
      await fetchContent();
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
  const showTypeControl = typeOptions.length > 1;

  if (!vodAllowed) {
    return <Navigate to="/channels" replace />;
  }

  return (
    <Box
      p="md"
      id="vods-container"
      h="100%"
      style={{ display: 'flex', minHeight: 0, overflow: 'hidden' }}
    >
      <Stack gap="md" h="100%" style={{ flex: 1, minHeight: 0 }}>
        <Group justify="space-between">
          <Group gap="md">
            <Title order={2}>Video on Demand</Title>
            <Text c="dimmed">
              {selectedCount} selected · {totalCount} matching
            </Text>
          </Group>
          <Group>
            <SegmentedControl
              aria-label="VOD view"
              value={viewMode}
              onChange={(value) => {
                setViewMode(value);
                localStorage.setItem('vodsViewMode', value);
              }}
              data={[
                {
                  value: 'list',
                  label: <List aria-label="List view" size={16} />,
                },
                {
                  value: 'posters',
                  label: <LayoutGrid aria-label="Poster wall" size={16} />,
                },
              ]}
            />
            {user?.user_level >= 10 && (
              <>
                <Button
                  variant="default"
                  leftSection={<DatabaseZap size={16} />}
                  onClick={metadataHandlers.open}
                >
                  Metadata
                </Button>
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
              </>
            )}
          </Group>
        </Group>

        <Stack gap="xs">
          <Group gap="md" align="end">
            {showTypeControl && (
              <SegmentedControl
                value={filters.type}
                onChange={(value) => {
                  setFilters({ type: value, category: '' });
                  setPage(1);
                }}
                data={typeOptions}
              />
            )}
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
            <Box w={190}>
              <VideoFeaturePicker
                label="Feature"
                emptyLabel="Any"
                value={filters.video_feature ? [filters.video_feature] : []}
                onChange={(value) =>
                  setFilters({
                    video_feature: value[value.length - 1] || '',
                  })
                }
              />
            </Box>
          </Group>
        </Stack>

        <Box
          data-testid="vod-list-scroll"
          style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
        >
          {initialLoad ? (
            <Flex justify="center" py="xl">
              <Loader size="lg" />
            </Flex>
          ) : viewMode === 'list' ? (
            <Table
              striped
              highlightOnHover
              withTableBorder
              stickyHeader
              miw={1400}
            >
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
                  <TableTh w={160}>Features</TableTh>
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
                            toggleItem(
                              itemKey(item),
                              event.currentTarget.checked
                            )
                          }
                        />
                      </TableTd>
                    )}
                    <TableTd>
                      {logoUrl(item) ? (
                        <Image
                          src={logoUrl(item)}
                          loading="lazy"
                          h={54}
                          w={40}
                          fit="contain"
                        />
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
                    <TableTd>
                      {sourceMetadataValue(item, 'resolutions')}
                    </TableTd>
                    <TableTd>
                      {item.contentType === 'series'
                        ? ''
                        : sourceMetadataValue(item, 'container_extensions')}
                    </TableTd>
                    <TableTd>
                      {(item.source_metadata?.video_features || []).length
                        ? item.source_metadata.video_features
                            .map(videoFeatureLabel)
                            .join(', ')
                        : '—'}
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
          ) : (
            <Box
              p="xs"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 'var(--mantine-spacing-md)',
              }}
            >
              {items.map((item) => (
                <Box
                  key={itemKey(item)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${item.name}`}
                  onClick={() => openItem(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openItem(item);
                    }
                  }}
                  style={{
                    position: 'relative',
                    padding: 0,
                    border: '1px solid var(--mantine-color-dark-4)',
                    borderRadius: 'var(--mantine-radius-md)',
                    overflow: 'hidden',
                    background: 'var(--mantine-color-dark-7)',
                    color: 'inherit',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {user?.user_level >= 10 && (
                    <Checkbox
                      aria-label={`Select ${item.name}`}
                      checked={
                        selectAllMatching
                          ? !selected.has(itemKey(item))
                          : selected.has(itemKey(item))
                      }
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        toggleItem(itemKey(item), event.currentTarget.checked)
                      }
                      style={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        zIndex: 2,
                      }}
                    />
                  )}
                  {logoUrl(item) ? (
                    <Image
                      src={logoUrl(item)}
                      alt=""
                      loading="lazy"
                      w="100%"
                      style={{ aspectRatio: '2 / 3' }}
                      fit="cover"
                    />
                  ) : (
                    <Flex
                      align="center"
                      justify="center"
                      bg="dark.6"
                      style={{ aspectRatio: '2 / 3' }}
                    >
                      <Play size={36} color="var(--mantine-color-dimmed)" />
                    </Flex>
                  )}
                  <Stack gap={2} p="xs">
                    <Text fw={600} size="sm" lineClamp={2}>
                      {item.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {item.contentType === 'series' ? 'Series' : 'Movie'}
                      {item.year ? ` · ${item.year}` : ''}
                      {` · ${sourceCount(item)} sources`}
                    </Text>
                  </Stack>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        <Group gap={5} justify="center" wrap="nowrap">
          <Text size="xs">Rows</Text>
          <Select
            aria-label="Rows"
            size="xs"
            value={String(pageSize)}
            onChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
              localStorage.setItem('vodsPageSize', value);
            }}
            data={['24', '48', '96'].map((value) => ({
              value,
              label: value,
            }))}
            allowDeselect={false}
            w={70}
          />
          {totalCount > 0 && (
            <Pagination
              value={currentPage}
              onChange={setPage}
              total={Math.max(1, totalPages)}
              size="xs"
              withEdges
            />
          )}
          <Text size="xs" c="dimmed">
            {totalCount
              ? `${(currentPage - 1) * pageSize + 1}–${Math.min(
                  currentPage * pageSize,
                  totalCount
                )} of ${totalCount}`
              : '0 of 0'}
          </Text>
        </Group>
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
          <VODMetadataFields
            value={bulkMetadata}
            onChange={setBulkMetadata}
            descriptions={{
              resolution: 'Leave empty to keep existing values',
            }}
          />
          <Select
            label="Canonical client title"
            description="Only compact output uses this stored canonical title. Variant names stay unchanged."
            data={[
              { value: 'keep', label: 'Keep existing override' },
              { value: 'clean', label: 'Remove a common provider prefix' },
              { value: 'regex', label: 'Apply a regular expression' },
              { value: 'clear', label: 'Clear manual override' },
            ]}
            value={bulkTitle.mode}
            onChange={(mode) =>
              setBulkTitle((current) => ({ ...current, mode }))
            }
          />
          {bulkTitle.mode === 'regex' && (
            <Group grow align="flex-start">
              <TextInput
                label="Title regular expression"
                value={bulkTitle.pattern}
                onChange={(event) =>
                  setBulkTitle((current) => ({
                    ...current,
                    pattern: event.currentTarget.value,
                  }))
                }
              />
              <TextInput
                label="Replacement"
                value={bulkTitle.replacement}
                onChange={(event) =>
                  setBulkTitle((current) => ({
                    ...current,
                    replacement: event.currentTarget.value,
                  }))
                }
              />
            </Group>
          )}
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

      <ErrorBoundary inline>
        <Suspense fallback={<LoadingOverlay />}>
          <SeriesModal
            series={selectedSeries}
            opened={seriesModalOpened}
            onClose={seriesModalHandlers.close}
            onMetadataChanged={fetchContent}
          />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={<LoadingOverlay />}>
          <VODMetadataModal
            opened={metadataOpened}
            onClose={metadataHandlers.close}
            onUpdated={fetchContent}
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
      <ErrorBoundary inline>
        <Suspense fallback={<LoadingOverlay />}>
          <VODModal
            vod={selectedVOD}
            opened={vodModalOpened}
            onClose={vodModalHandlers.close}
            onMetadataChanged={fetchContent}
          />
        </Suspense>
      </ErrorBoundary>
    </Box>
  );
};

export default VODsPage;
