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
  TagsInput,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { History, Play, Search, Wrench } from 'lucide-react';
import { useDisclosure } from '@mantine/hooks';
import API from '../api';
import useVODStore from '../store/useVODStore';
import useAuthStore from '../store/auth';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { showNotification } from '../utils/notificationUtils';
import {
  filterCategoriesToEnabled,
  getCategoryOptions,
} from '../utils/pages/VODsUtils.js';

const SeriesModal = React.lazy(() => import('../components/SeriesModal'));
const VODModal = React.lazy(() => import('../components/VODModal'));
const VODSourceManagerModal = React.lazy(
  () => import('../components/VODSourceManagerModal')
);

const itemKey = (item) => `${item.contentType}:${item.id}`;
const logoUrl = (item) =>
  item.logo?.cache_url || item.logo?.url || item.logo_url || null;

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

  const [selectedSeries, setSelectedSeries] = useState(null);
  const [selectedVOD, setSelectedVOD] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkMetadata, setBulkMetadata] = useState({
    audio_languages: [],
    subtitle_languages: [],
    resolution: '',
  });
  const [bulkSaving, setBulkSaving] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [categories, setCategories] = useState({});
  const [seriesModalOpened, seriesModalHandlers] = useDisclosure(false);
  const [vodModalOpened, vodModalHandlers] = useDisclosure(false);
  const [sourceManagerOpened, sourceManagerHandlers] = useDisclosure(false);
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
    visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));

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
    fetchContent().finally(() => setInitialLoad(false));
  }, [filters, currentPage, pageSize, fetchContent]);

  const toggleItem = (key, checked) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleVisible = (checked) => {
    setSelected((current) => {
      const next = new Set(current);
      visibleKeys.forEach((key) =>
        checked ? next.add(key) : next.delete(key)
      );
      return next;
    });
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
    setBulkSaving(true);
    try {
      const result = await API.bulkUpdateVODSourceMetadata(
        selections,
        metadata
      );
      showNotification({
        title: 'Source metadata updated',
        message: `${result.updated_sources || 0} source editions were updated and locked.`,
        color: 'green',
      });
      bulkEditorHandlers.close();
      setSelected(new Set());
    } finally {
      setBulkSaving(false);
    }
  };

  const categoryOptions = getCategoryOptions(categories, filters);
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <Box p="md" id="vods-container">
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={2}>Video on Demand</Title>
          {user?.user_level >= 10 && (
            <Group>
              <Button
                variant="default"
                leftSection={<Wrench size={16} />}
                disabled={selected.size === 0}
                onClick={bulkEditorHandlers.open}
              >
                Edit selected ({selected.size})
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
            data={['24', '48', '96'].map((value) => ({ value, label: value }))}
            w={100}
          />
        </Group>

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
                      aria-label="Select visible VODs"
                      checked={allVisibleSelected}
                      onChange={(event) =>
                        toggleVisible(event.currentTarget.checked)
                      }
                    />
                  </TableTh>
                )}
                <TableTh w={62}>Artwork</TableTh>
                <TableTh>Title</TableTh>
                <TableTh w={100}>Type</TableTh>
                <TableTh w={90}>Year</TableTh>
                <TableTh>Genre</TableTh>
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
                        checked={selected.has(itemKey(item))}
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
                  <TableTd>{item.genre || '—'}</TableTd>
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
      </Stack>

      <Modal
        opened={bulkEditorOpened}
        onClose={bulkEditorHandlers.close}
        title={`Edit metadata for ${selected.size} selected VODs`}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Values are applied to all source editions behind the selected
            titles, including episode sources for selected series. Manual values
            are locked and are never replaced by playback observations.
          </Text>
          <TagsInput
            label="Audio languages"
            description="English ISO 639-2/B codes"
            placeholder="ger, eng"
            value={bulkMetadata.audio_languages}
            onChange={(value) =>
              setBulkMetadata({ ...bulkMetadata, audio_languages: value })
            }
          />
          <TagsInput
            label="Subtitle languages"
            placeholder="ger, eng"
            value={bulkMetadata.subtitle_languages}
            onChange={(value) =>
              setBulkMetadata({ ...bulkMetadata, subtitle_languages: value })
            }
          />
          <Select
            label="Resolution"
            clearable
            data={['480p', '576p', '720p', '1080p', '1440p', '2160p']}
            value={bulkMetadata.resolution || null}
            onChange={(value) =>
              setBulkMetadata({ ...bulkMetadata, resolution: value || '' })
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
