import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Image,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Pagination,
  Paper,
  Popover,
  PopoverDropdown,
  PopoverTarget,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  Eye,
  Film,
  Filter,
  Info,
  ListPlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import API from '../api';
import SeriesModal from '../components/SeriesModal.jsx';
import VODModal from '../components/VODModal.jsx';
import VODTechnicalFilterFields from '../components/VODTechnicalFilterFields.jsx';
import useVODFilterOptions from '../hooks/useVODFilterOptions.js';
import useAuthStore from '../store/auth';
import { USER_LEVELS } from '../constants';
import { LANGUAGE_OPTIONS } from '../utils/languageCodes.js';
import { videoFeatureLabel } from '../utils/vodMetadataOptions.js';

const EMPTY_RULE = {
  required_genres: [],
  min_year: '',
  max_year: '',
  release_date_after: '',
  release_date_before: '',
  release_yearly_from: '',
  release_yearly_until: '',
  release_last_days: '',
  library_added_after: '',
  library_added_before: '',
  library_added_last_days: '',
  anime_mode: 'any',
  max_age_rating: '',
  required_audio_languages: [],
  required_subtitle_languages: [],
  min_resolution: '',
  max_resolution: '',
  required_video_features: [],
};

const EMPTY_FORM = {
  name: '',
  description: '',
  list_type: 'manual',
  content_type: 'all',
  provider: '',
  external_key: '',
  external_source: '',
  settings: {
    watch_provider_id: '',
    watch_provider_name: '',
    watch_region: '',
    watch_monetization_types: 'flatrate',
  },
  is_enabled: true,
  date_source: 'none',
  date_mode: 'fixed',
  rule: EMPTY_RULE,
};

const EMPTY_PREVIEW_FILTERS = {
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

const EMPTY_FILTER_OPTIONS = {
  audio_languages: [],
  subtitle_languages: [],
  resolutions: [],
  container_extensions: [],
  video_features: [],
};

const TMDB_PRESETS = [
  { value: 'trending-movies', label: 'Trending movies' },
  { value: 'trending-series', label: 'Trending series' },
  { value: 'now-playing', label: 'Now playing in cinemas' },
  { value: 'popular-movies', label: 'Popular movies' },
  { value: 'popular-series', label: 'Popular series' },
];

const TMDB_SOURCE_VALUES = new Set([
  ...TMDB_PRESETS.map((option) => option.value),
  'watch-provider',
]);

const TYPE_LABELS = {
  manual: 'Manual',
  dynamic: 'Dynamic',
  external: 'External',
  system: 'System',
};

const normalizeList = (value) => {
  const externalKey = value?.external_key || '';
  const rule = { ...EMPTY_RULE, ...(value?.rules?.[0] || {}) };
  const hasReleaseDate = [
    rule.release_date_after,
    rule.release_date_before,
    rule.release_yearly_from,
    rule.release_yearly_until,
    rule.release_last_days,
  ].some(Boolean);
  const hasAddedDate = [
    rule.library_added_after,
    rule.library_added_before,
    rule.library_added_last_days,
  ].some(Boolean);
  const dateSource = hasReleaseDate
    ? 'release'
    : hasAddedDate
      ? 'added'
      : 'none';
  return {
    ...EMPTY_FORM,
    ...value,
    provider: value?.provider || '',
    external_key: externalKey,
    external_source: TMDB_SOURCE_VALUES.has(externalKey)
      ? externalKey
      : externalKey
        ? 'custom'
        : '',
    settings: { ...EMPTY_FORM.settings, ...(value?.settings || {}) },
    date_source: dateSource,
    date_mode:
      dateSource === 'release'
        ? rule.release_yearly_from || rule.release_yearly_until
          ? 'yearly'
          : rule.release_last_days
            ? 'recent'
            : 'fixed'
        : rule.library_added_last_days
          ? 'recent'
          : 'fixed',
    rule,
  };
};

const languageLabel = (code) =>
  LANGUAGE_OPTIONS.find((option) => option.value === code)?.label ||
  String(code || '').toUpperCase();

const optionRows = (values, label = (value) => value) =>
  (values || []).map((value) => ({ value, label: label(value) }));

const resolutionNumber = (value) => {
  const match = String(value || '').match(/\d+/);
  return match ? match[0] : '';
};

const builderSignature = (value) => {
  const rule = {
    ...EMPTY_RULE,
    ...(value.rule || value.rules?.[0] || {}),
  };
  for (const field of [
    'min_year',
    'max_year',
    'max_age_rating',
    'min_resolution',
    'max_resolution',
  ]) {
    rule[field] = Number(rule[field]) || 0;
  }
  return JSON.stringify({
    list_type: value.list_type,
    content_type: value.content_type,
    provider: value.list_type === 'external' ? value.provider || '' : '',
    external_key:
      value.list_type === 'external' ? value.external_key || '' : '',
    settings: value.list_type === 'external' ? value.settings || {} : {},
    rules: value.list_type === 'dynamic' ? [rule] : [],
  });
};

const Poster = ({ item }) => {
  const title = item.display_title || 'Untitled';
  const poster = item.display_poster;
  return (
    <Tooltip
      label={`${title}${item.display_year ? ` (${item.display_year})` : ''}${
        item.is_available ? '' : ' · Not in library'
      }`}
      withArrow
    >
      <Box
        w={88}
        h={132}
        pos="relative"
        style={{ flex: '0 0 auto', borderRadius: 6, overflow: 'hidden' }}
      >
        {poster ? (
          <Image src={poster} alt={title} w="100%" h="100%" fit="cover" />
        ) : (
          <Center h="100%" bg="dark.6">
            <Film size={24} opacity={0.55} />
          </Center>
        )}
        {!item.is_available && (
          <Box
            pos="absolute"
            inset={0}
            bg="rgba(24, 24, 27, 0.72)"
            style={{ filter: 'grayscale(1)' }}
          >
            <Center h="100%">
              <Text size="xs" ta="center" px={4} c="gray.3">
                Not in library
              </Text>
            </Center>
          </Box>
        )}
      </Box>
    </Tooltip>
  );
};

const VODListsPage = () => {
  const user = useAuthStore((state) => state.user);
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [rebuildingId, setRebuildingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerSearch, setViewerSearch] = useState('');
  const [debouncedViewerSearch] = useDebouncedValue(viewerSearch, 250);
  const [viewerFilters, setViewerFilters] = useState(EMPTY_PREVIEW_FILTERS);
  const [viewerFilterOptions, setViewerFilterOptions] =
    useState(EMPTY_FILTER_OPTIONS);
  const [viewerData, setViewerData] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [removingItemId, setRemovingItemId] = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [ruleOptions, setRuleOptions] = useState({
    genres: [],
  });
  const [externalOptions, setExternalOptions] = useState({
    region: '',
    watch_providers: [],
  });
  const [externalOptionsLoading, setExternalOptionsLoading] = useState(false);
  const { options: technicalOptions, loading: technicalOptionsLoading } =
    useVODFilterOptions({
      enabled: editorOpen && form.list_type === 'dynamic',
      type: form.content_type,
    });

  const isAdmin = user && user.user_level >= USER_LEVELS.ADMIN;

  const loadLists = useCallback(async ({ background = false } = {}) => {
    if (!background) {
      setLoading(true);
      setError('');
    }
    try {
      const response = await API.getVODLists();
      setLists(response?.results || response || []);
    } catch (requestError) {
      if (!background) {
        setError(requestError?.message || 'Failed to load VOD lists.');
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadLists();
  }, [isAdmin, loadLists]);

  useEffect(() => {
    if (
      !lists.some((list) => ['queued', 'running'].includes(list.sync_status))
    ) {
      return undefined;
    }
    const timer = window.setInterval(
      () => loadLists({ background: true }),
      2000
    );
    return () => window.clearInterval(timer);
  }, [lists, loadLists]);

  useEffect(() => {
    if (!viewer) return;
    let active = true;
    setViewerLoading(true);
    API.getVODListItems(viewer.id, {
      page: viewerPage,
      page_size: 50,
      search: debouncedViewerSearch,
      ...viewerFilters,
    })
      .then((response) => {
        if (active) setViewerData(response);
      })
      .catch((requestError) => {
        if (active) {
          notifications.show({
            color: 'red',
            title: 'Could not load list items',
            message: requestError?.message || 'The request failed.',
          });
        }
      })
      .finally(() => {
        if (active) setViewerLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedViewerSearch, viewer, viewerFilters, viewerPage]);

  useEffect(() => {
    if (!viewer) return undefined;
    let active = true;
    API.getVODListFilterOptions(viewer.id)
      .then((response) => {
        if (active) {
          setViewerFilterOptions({
            ...EMPTY_FILTER_OPTIONS,
            ...(response || {}),
          });
        }
      })
      .catch(() => {
        if (active) setViewerFilterOptions(EMPTY_FILTER_OPTIONS);
      });
    return () => {
      active = false;
    };
  }, [viewer]);

  useEffect(() => {
    if (!editorOpen || form.list_type !== 'dynamic') return;
    let active = true;
    API.getVODListRuleOptions(form.content_type)
      .then((response) => {
        if (active) {
          setRuleOptions({
            genres: response?.genres || [],
          });
        }
      })
      .catch(() => {
        if (active) setRuleOptions({ genres: [] });
      });
    return () => {
      active = false;
    };
  }, [editorOpen, form.content_type, form.list_type]);

  useEffect(() => {
    if (
      !editorOpen ||
      form.list_type !== 'external' ||
      form.provider !== 'tmdb' ||
      form.external_source !== 'watch-provider' ||
      !['movie', 'series'].includes(form.content_type)
    ) {
      return undefined;
    }
    let active = true;
    setExternalOptionsLoading(true);
    API.getVODListExternalOptions(
      form.content_type,
      form.settings.watch_region || undefined
    )
      .then((response) => {
        if (!active) return;
        setExternalOptions({
          region: response?.region || '',
          watch_providers: response?.watch_providers || [],
        });
        if (!form.settings.watch_region && response?.region) {
          setForm((current) => ({
            ...current,
            settings: {
              ...current.settings,
              watch_region: response.region,
            },
          }));
        }
      })
      .catch((requestError) => {
        if (active) {
          setExternalOptions({ region: '', watch_providers: [] });
          notifications.show({
            color: 'red',
            title: 'Could not load TMDB providers',
            message: requestError?.message || 'The request failed.',
          });
        }
      })
      .finally(() => {
        if (active) setExternalOptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    editorOpen,
    form.content_type,
    form.external_source,
    form.list_type,
    form.provider,
    form.settings.watch_region,
  ]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };

  const openEdit = (list) => {
    setEditing(list);
    setForm(normalizeList(list));
    setEditorOpen(true);
  };

  const upsertList = (saved) => {
    setLists((current) => {
      const exists = current.some((list) => list.id === saved.id);
      return exists
        ? current.map((list) => (list.id === saved.id ? saved : list))
        : [...current, saved];
    });
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const normalizedRule = {
        ...form.rule,
        min_year: Number(form.rule.min_year) || 0,
        max_year: Number(form.rule.max_year) || 0,
        max_age_rating: Number(form.rule.max_age_rating) || 0,
        min_resolution: Number(form.rule.min_resolution) || 0,
        max_resolution: Number(form.rule.max_resolution) || 0,
      };
      if (form.date_source !== 'release' || form.date_mode !== 'fixed') {
        normalizedRule.release_date_after = '';
        normalizedRule.release_date_before = '';
      }
      if (form.date_source !== 'release' || form.date_mode !== 'yearly') {
        normalizedRule.release_yearly_from = '';
        normalizedRule.release_yearly_until = '';
      }
      if (form.date_source !== 'release' || form.date_mode !== 'recent') {
        normalizedRule.release_last_days = '';
      }
      if (form.date_source !== 'added' || form.date_mode !== 'fixed') {
        normalizedRule.library_added_after = '';
        normalizedRule.library_added_before = '';
      }
      if (form.date_source !== 'added' || form.date_mode !== 'recent') {
        normalizedRule.library_added_last_days = '';
      }
      const externalKey =
        form.external_source === 'custom'
          ? form.external_key.trim()
          : form.external_source;
      const externalSettings =
        form.external_source === 'watch-provider' ? form.settings : {};
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        list_type: form.list_type,
        content_type: form.content_type,
        provider: form.list_type === 'external' ? form.provider.trim() : '',
        external_key: form.list_type === 'external' ? externalKey : '',
        settings: form.list_type === 'external' ? externalSettings : {},
        is_enabled: form.is_enabled,
        rules: form.list_type === 'dynamic' ? [normalizedRule] : [],
      };
      const requiresRebuild =
        ['dynamic', 'external'].includes(form.list_type) &&
        (!editing || builderSignature(payload) !== builderSignature(editing));
      const saved = editing
        ? await API.updateVODList(editing.id, payload)
        : await API.createVODList(payload);
      upsertList(saved);
      setEditorOpen(false);
      if (requiresRebuild) {
        const queued = await API.rebuildVODList(saved.id);
        upsertList(queued);
      }
      notifications.show({
        color: 'green',
        message: requiresRebuild
          ? `${saved.name || form.name} saved. The list is building in the background.`
          : editing
            ? 'List updated.'
            : 'List created.',
      });
    } catch (requestError) {
      notifications.show({
        color: 'red',
        title: 'Could not save list',
        message: requestError?.message || 'The request failed.',
      });
    } finally {
      setSaving(false);
    }
  };

  const rebuild = async (list) => {
    setRebuildingId(list.id);
    try {
      const queued = await API.rebuildVODList(list.id);
      upsertList(queued);
      notifications.show({ color: 'blue', message: `${list.name} queued.` });
    } catch (requestError) {
      notifications.show({
        color: 'red',
        title: 'Could not rebuild list',
        message: requestError?.message || 'The request failed.',
      });
    } finally {
      setRebuildingId(null);
    }
  };

  const toggleEnabled = async (list, isEnabled) => {
    setTogglingId(list.id);
    try {
      const saved = await API.updateVODList(list.id, { is_enabled: isEnabled });
      upsertList(saved);
      notifications.show({
        color: 'green',
        message: `${list.name} ${isEnabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (requestError) {
      notifications.show({
        color: 'red',
        title: 'Could not update list',
        message: requestError?.message || 'The request failed.',
      });
    } finally {
      setTogglingId(null);
    }
  };

  const remove = async (list) => {
    if (!window.confirm(`Delete the list “${list.name}”?`)) return;
    try {
      await API.deleteVODList(list.id);
      await loadLists();
      notifications.show({ color: 'green', message: 'List deleted.' });
    } catch (requestError) {
      notifications.show({
        color: 'red',
        title: 'Could not delete list',
        message: requestError?.message || 'The request failed.',
      });
    }
  };

  const removeItem = async (item) => {
    if (!viewer || viewer.list_type !== 'manual') return;
    setRemovingItemId(item.id);
    try {
      await API.removeVODListItems(viewer.id, [item.id]);
      setViewerData((current) => ({
        ...current,
        count: Math.max(0, Number(current?.count || 0) - 1),
        results: (current?.results || []).filter((row) => row.id !== item.id),
      }));
      await loadLists();
      notifications.show({ color: 'green', message: 'Removed from list.' });
    } catch (requestError) {
      notifications.show({
        color: 'red',
        title: 'Could not remove title',
        message: requestError?.message || 'The request failed.',
      });
    } finally {
      setRemovingItemId(null);
    }
  };

  const viewerItems = useMemo(() => viewerData?.results || [], [viewerData]);
  const viewerAdvancedFilterCount = useMemo(
    () =>
      Object.entries(viewerFilters).filter(
        ([key, value]) =>
          !['type', 'availability'].includes(key) && Boolean(value)
      ).length,
    [viewerFilters]
  );
  const updateViewerFilter = (field, value) => {
    setViewerFilters((current) => ({ ...current, [field]: value }));
    setViewerPage(1);
  };

  const openViewer = (list) => {
    setViewer(list);
    setViewerPage(1);
    setViewerSearch('');
    setViewerFilters(EMPTY_PREVIEW_FILTERS);
    setViewerFilterOptions(EMPTY_FILTER_OPTIONS);
    setViewerData(null);
  };

  if (!isAdmin) return <Navigate to="/vods" replace />;

  return (
    <Box h="100%" style={{ minHeight: 0, overflow: 'hidden' }}>
      <ScrollArea h="100%" p="md">
        <Stack gap="md">
          <Group justify="space-between" align="end">
            <Box>
              <Title order={2}>VOD Lists</Title>
              <Text c="dimmed" size="sm">
                Build manual, metadata-driven and external collections from
                exact library sources.
              </Text>
            </Box>
            <Button leftSection={<Plus size={16} />} onClick={openCreate}>
              Add list
            </Button>
          </Group>

          {error && <Alert color="red">{error}</Alert>}
          {loading ? (
            <Center mih={240}>
              <Loader />
            </Center>
          ) : (
            <>
              {lists.map((list) => (
                <Paper key={list.id} withBorder p="md" radius="md" mih={275}>
                  <Stack gap="sm">
                    <Group justify="space-between" align="flex-start">
                      <Box>
                        <Group gap="xs">
                          <Text fw={700} size="lg">
                            {list.name}
                          </Text>
                          <Badge variant="light">
                            {TYPE_LABELS[list.list_type] || list.list_type}
                          </Badge>
                          {list.sync_status === 'queued' && (
                            <Badge color="blue" variant="light">
                              Queued
                            </Badge>
                          )}
                          {list.sync_status === 'running' && (
                            <Badge
                              color="blue"
                              variant="light"
                              leftSection={<Loader size={10} />}
                            >
                              Building
                            </Badge>
                          )}
                          {list.sync_status === 'failed' && (
                            <Badge color="red" variant="light">
                              Failed
                            </Badge>
                          )}
                        </Group>
                        <Text size="sm" c="dimmed">
                          {list.item_count} titles · {list.available_item_count}{' '}
                          available
                        </Text>
                        {['queued', 'running'].includes(list.sync_status) && (
                          <Text size="xs" c="blue.3">
                            {list.sync_progress?.phase ||
                              'The previous complete version remains available.'}
                          </Text>
                        )}
                        {list.sync_status === 'failed' && list.sync_error && (
                          <Text size="xs" c="red.4">
                            {list.sync_error}
                          </Text>
                        )}
                      </Box>
                      <Group gap={6}>
                        <Switch
                          label="Enabled"
                          checked={list.is_enabled}
                          disabled={list.is_system || togglingId === list.id}
                          onChange={(event) =>
                            toggleEnabled(list, event.currentTarget.checked)
                          }
                          mr="sm"
                        />
                        {list.list_type !== 'manual' && (
                          <ActionIcon
                            variant="subtle"
                            aria-label={`Rebuild ${list.name}`}
                            loading={
                              rebuildingId === list.id ||
                              ['queued', 'running'].includes(list.sync_status)
                            }
                            onClick={() => rebuild(list)}
                          >
                            <RefreshCw size={17} />
                          </ActionIcon>
                        )}
                        <Button
                          variant="subtle"
                          leftSection={<Eye size={16} />}
                          onClick={() => openViewer(list)}
                        >
                          Preview
                        </Button>
                        <ActionIcon
                          variant="subtle"
                          aria-label={`Edit ${list.name}`}
                          onClick={() => openEdit(list)}
                        >
                          <Pencil size={17} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Delete ${list.name}`}
                          disabled={list.is_system}
                          onClick={() => remove(list)}
                        >
                          <Trash2 size={17} />
                        </ActionIcon>
                      </Group>
                    </Group>

                    {list.preview?.length ? (
                      <Group
                        gap="xs"
                        wrap="nowrap"
                        style={{ overflow: 'hidden' }}
                      >
                        {list.preview.map((item) => (
                          <Poster key={item.id} item={item} />
                        ))}
                      </Group>
                    ) : (
                      <Center mih={132} bg="dark.7" style={{ borderRadius: 6 }}>
                        <Text c="dimmed" size="sm">
                          No titles in this list yet.
                        </Text>
                      </Center>
                    )}
                  </Stack>
                </Paper>
              ))}

              <Button
                variant="outline"
                size="xl"
                h={92}
                leftSection={<ListPlus size={25} />}
                styles={{ root: { borderStyle: 'dashed' } }}
                onClick={openCreate}
              >
                Add another list
              </Button>
            </>
          )}
        </Stack>
      </ScrollArea>

      <Modal
        opened={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Create VOD list'}
        size="lg"
      >
        <Stack>
          <TextInput
            label="Name"
            required
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
          />
          <Textarea
            label="Description"
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="List type"
              data={[
                { value: 'manual', label: 'Manual' },
                { value: 'dynamic', label: 'Metadata rules' },
                { value: 'external', label: 'External provider' },
              ]}
              value={form.list_type}
              disabled={Boolean(editing?.is_system)}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  list_type: value || 'manual',
                }))
              }
            />
            <Select
              label="Content"
              data={[
                { value: 'all', label: 'Movies and series' },
                { value: 'movie', label: 'Movies' },
                { value: 'series', label: 'Series' },
              ]}
              value={form.content_type}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  content_type: value || 'all',
                  settings:
                    current.external_source === 'watch-provider' &&
                    current.content_type !== value
                      ? {
                          ...current.settings,
                          watch_provider_id: '',
                          watch_provider_name: '',
                        }
                      : current.settings,
                }))
              }
            />
          </SimpleGrid>
          {form.list_type === 'external' && (
            <Stack gap="sm">
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select
                  label="Provider"
                  data={[{ value: 'tmdb', label: 'TMDB' }]}
                  value={form.provider}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      provider: value || '',
                    }))
                  }
                />
                <Select
                  label="TMDB source"
                  placeholder="Choose a list source"
                  data={[
                    ...TMDB_PRESETS,
                    {
                      value: 'watch-provider',
                      label: 'Streaming service (Watch Provider)',
                    },
                    { value: 'custom', label: 'TMDB list ID' },
                  ]}
                  value={form.external_source || null}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      external_source: value || '',
                      content_type:
                        value === 'trending-movies' ||
                        value === 'now-playing' ||
                        value === 'popular-movies'
                          ? 'movie'
                          : value === 'trending-series' ||
                              value === 'popular-series'
                            ? 'series'
                            : current.content_type,
                    }))
                  }
                />
              </SimpleGrid>
              {form.external_source === 'custom' && (
                <TextInput
                  label="TMDB list ID"
                  value={form.external_key}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      external_key: event.target.value,
                    }))
                  }
                />
              )}
              {form.external_source === 'watch-provider' && (
                <Stack gap="sm">
                  {!['movie', 'series'].includes(form.content_type) && (
                    <Alert color="yellow">
                      Choose either Movies or Series above. TMDB exposes these
                      streaming catalogs separately.
                    </Alert>
                  )}
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <Select
                      label="Streaming service"
                      searchable
                      disabled={
                        externalOptionsLoading ||
                        !['movie', 'series'].includes(form.content_type)
                      }
                      data={externalOptions.watch_providers}
                      value={form.settings.watch_provider_id || null}
                      onChange={(value) => {
                        const selected = externalOptions.watch_providers.find(
                          (option) => option.value === value
                        );
                        setForm((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            watch_provider_id: value || '',
                            watch_provider_name: selected?.label || '',
                          },
                        }));
                      }}
                    />
                    <TextInput
                      label="Region"
                      readOnly
                      value={
                        form.settings.watch_region ||
                        externalOptions.region ||
                        ''
                      }
                    />
                    <Select
                      label="Availability"
                      data={[
                        { value: 'flatrate', label: 'Subscription streaming' },
                        { value: 'free', label: 'Free' },
                        { value: 'ads', label: 'Free with ads' },
                        { value: 'rent', label: 'Rent' },
                        { value: 'buy', label: 'Buy' },
                      ]}
                      value={form.settings.watch_monetization_types}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            watch_monetization_types: value || 'flatrate',
                          },
                        }))
                      }
                    />
                  </SimpleGrid>
                </Stack>
              )}
            </Stack>
          )}
          {form.list_type === 'dynamic' && (
            <Stack gap="sm">
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select
                  label="Date source"
                  data={[
                    { value: 'none', label: 'No date filter' },
                    { value: 'release', label: 'Release date (TMDB)' },
                    { value: 'added', label: 'Added to this library' },
                  ]}
                  value={form.date_source}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      date_source: value || 'none',
                      date_mode: 'fixed',
                    }))
                  }
                />
                {form.date_source !== 'none' && (
                  <Select
                    label="Date range"
                    data={[
                      { value: 'fixed', label: 'Fixed dates' },
                      ...(form.date_source === 'release'
                        ? [{ value: 'yearly', label: 'Repeats each year' }]
                        : []),
                      { value: 'recent', label: 'Last X days' },
                    ]}
                    value={form.date_mode}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        date_mode: value || 'fixed',
                      }))
                    }
                  />
                )}
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {form.date_source === 'release' &&
                  form.date_mode === 'fixed' && (
                    <>
                      <TextInput
                        type="date"
                        label="Released from"
                        value={form.rule.release_date_after}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            rule: {
                              ...current.rule,
                              release_date_after: event.currentTarget.value,
                            },
                          }))
                        }
                      />
                      <TextInput
                        type="date"
                        label="Released until"
                        value={form.rule.release_date_before}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            rule: {
                              ...current.rule,
                              release_date_before: event.currentTarget.value,
                            },
                          }))
                        }
                      />
                    </>
                  )}
                {form.date_source === 'release' &&
                  form.date_mode === 'yearly' && (
                    <>
                      <TextInput
                        label="Every year from (MM-DD)"
                        placeholder="01-01"
                        value={form.rule.release_yearly_from}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            rule: {
                              ...current.rule,
                              release_yearly_from: event.currentTarget.value,
                            },
                          }))
                        }
                      />
                      <TextInput
                        label="Every year until (MM-DD)"
                        placeholder="04-30"
                        value={form.rule.release_yearly_until}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            rule: {
                              ...current.rule,
                              release_yearly_until: event.currentTarget.value,
                            },
                          }))
                        }
                      />
                    </>
                  )}
                {form.date_source === 'release' &&
                  form.date_mode === 'recent' && (
                    <NumberInput
                      label="Released in the last X days"
                      min={1}
                      max={3650}
                      value={form.rule.release_last_days}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          rule: { ...current.rule, release_last_days: value },
                        }))
                      }
                    />
                  )}
                {form.date_source === 'added' && form.date_mode === 'fixed' && (
                  <>
                    <TextInput
                      type="date"
                      label="Added to library from"
                      value={form.rule.library_added_after}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          rule: {
                            ...current.rule,
                            library_added_after: event.currentTarget.value,
                          },
                        }))
                      }
                    />
                    <TextInput
                      type="date"
                      label="Added to library until"
                      value={form.rule.library_added_before}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          rule: {
                            ...current.rule,
                            library_added_before: event.currentTarget.value,
                          },
                        }))
                      }
                    />
                  </>
                )}
                {form.date_source === 'added' &&
                  form.date_mode === 'recent' && (
                    <NumberInput
                      label="Added in the last X days"
                      min={1}
                      max={3650}
                      value={form.rule.library_added_last_days}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          rule: {
                            ...current.rule,
                            library_added_last_days: value,
                          },
                        }))
                      }
                    />
                  )}
              </SimpleGrid>
              <TagsInput
                label="Genres"
                placeholder="Select genres present in the library"
                data={ruleOptions.genres}
                value={form.rule.required_genres}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    rule: { ...current.rule, required_genres: value },
                  }))
                }
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select
                  label="Anime"
                  data={[
                    { value: 'any', label: 'Any' },
                    { value: 'yes', label: 'Anime only' },
                    { value: 'no', label: 'Exclude anime' },
                  ]}
                  value={form.rule.anime_mode}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      rule: { ...current.rule, anime_mode: value || 'any' },
                    }))
                  }
                />
                <NumberInput
                  label={
                    <Group gap={6} wrap="nowrap">
                      Maximum age rating
                      <Tooltip
                        multiline
                        maw={360}
                        label="This filters the minimum viewer age from the canonical/TMDB certification, not the title's age since release. FSK 12 becomes 12 and PG-13 becomes 13; a limit of 12 includes numeric ratings up to 12. If several ratings exist, the lowest number is used. R, TV-MA and missing ratings have no numeric age and do not match. Empty or 0 disables the filter."
                      >
                        <Info
                          size={15}
                          aria-label="How age ratings are matched"
                        />
                      </Tooltip>
                    </Group>
                  }
                  value={form.rule.max_age_rating}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      rule: { ...current.rule, max_age_rating: value },
                    }))
                  }
                />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <MultiSelect
                  label="DUB"
                  searchable
                  disabled={technicalOptionsLoading}
                  data={optionRows(
                    technicalOptions.audio_languages,
                    languageLabel
                  )}
                  value={form.rule.required_audio_languages}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      rule: {
                        ...current.rule,
                        required_audio_languages: value,
                      },
                    }))
                  }
                />
                <MultiSelect
                  label="SUB"
                  searchable
                  disabled={technicalOptionsLoading}
                  data={optionRows(
                    technicalOptions.subtitle_languages,
                    languageLabel
                  )}
                  value={form.rule.required_subtitle_languages}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      rule: {
                        ...current.rule,
                        required_subtitle_languages: value,
                      },
                    }))
                  }
                />
                <Select
                  label="Minimum resolution"
                  placeholder="No minimum"
                  clearable
                  disabled={technicalOptionsLoading}
                  data={(technicalOptions.resolutions || []).map((value) => ({
                    value: resolutionNumber(value),
                    label: value,
                  }))}
                  value={
                    form.rule.min_resolution
                      ? String(form.rule.min_resolution)
                      : null
                  }
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      rule: { ...current.rule, min_resolution: value || '' },
                    }))
                  }
                />
                <Select
                  label="Maximum resolution"
                  placeholder="No maximum"
                  clearable
                  disabled={technicalOptionsLoading}
                  data={(technicalOptions.resolutions || []).map((value) => ({
                    value: resolutionNumber(value),
                    label: value,
                  }))}
                  value={
                    form.rule.max_resolution
                      ? String(form.rule.max_resolution)
                      : null
                  }
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      rule: { ...current.rule, max_resolution: value || '' },
                    }))
                  }
                />
              </SimpleGrid>
              <MultiSelect
                label="Features"
                searchable
                disabled={technicalOptionsLoading}
                data={optionRows(
                  technicalOptions.video_features,
                  videoFeatureLabel
                )}
                value={form.rule.required_video_features}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    rule: { ...current.rule, required_video_features: value },
                  }))
                }
              />
            </Stack>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              leftSection={<Plus size={16} />}
              loading={saving}
              disabled={
                !form.name.trim() ||
                (form.list_type === 'dynamic' &&
                  ((form.release_mode === 'yearly' &&
                    (!/^\d{2}-\d{2}$/.test(form.rule.release_yearly_from) ||
                      !/^\d{2}-\d{2}$/.test(form.rule.release_yearly_until))) ||
                    (form.release_mode === 'recent' &&
                      !(Number(form.rule.release_last_days) >= 1)) ||
                    (form.added_mode === 'recent' &&
                      !(Number(form.rule.library_added_last_days) >= 1)))) ||
                (form.list_type === 'external' &&
                  (!form.provider ||
                    !form.external_source ||
                    (form.external_source === 'custom' &&
                      !form.external_key.trim()) ||
                    (form.external_source === 'watch-provider' &&
                      (!['movie', 'series'].includes(form.content_type) ||
                        !form.settings.watch_provider_id ||
                        !form.settings.watch_region))))
              }
              onClick={save}
            >
              {editing ? 'Save list' : 'Create list'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(viewer)}
        onClose={() => setViewer(null)}
        title={viewer ? `${viewer.name} preview` : 'List preview'}
        size="xl"
      >
        <Stack>
          <Group align="end" wrap="wrap">
            <TextInput
              label="Search"
              placeholder="Search titles…"
              leftSection={<Search size={16} />}
              value={viewerSearch}
              onChange={(event) => {
                setViewerSearch(event.currentTarget.value);
                setViewerPage(1);
              }}
              style={{ flex: '1 1 260px' }}
            />
            <Select
              label="Type"
              data={[
                { value: 'all', label: 'Movies and series' },
                { value: 'movie', label: 'Movies' },
                { value: 'series', label: 'Series' },
              ]}
              value={viewerFilters.type}
              onChange={(value) => updateViewerFilter('type', value || 'all')}
              w={175}
            />
            <Select
              label="Availability"
              data={[
                { value: 'any', label: 'Any' },
                { value: 'available', label: 'In library' },
                { value: 'unavailable', label: 'Not in library' },
              ]}
              value={viewerFilters.availability}
              onChange={(value) =>
                updateViewerFilter('availability', value || 'any')
              }
              w={165}
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
                  variant={viewerAdvancedFilterCount ? 'light' : 'default'}
                  leftSection={<Filter size={16} />}
                >
                  Filters
                  {viewerAdvancedFilterCount
                    ? ` (${viewerAdvancedFilterCount})`
                    : ''}
                </Button>
              </PopoverTarget>
              <PopoverDropdown>
                <Stack gap="sm">
                  <SimpleGrid cols={2}>
                    <VODTechnicalFilterFields
                      filters={viewerFilters}
                      onChange={updateViewerFilter}
                      optionsOverride={viewerFilterOptions}
                    />
                    <NumberInput
                      label="Release year from"
                      min={1800}
                      max={2200}
                      value={viewerFilters.year_from}
                      onChange={(value) =>
                        updateViewerFilter('year_from', value || '')
                      }
                    />
                    <NumberInput
                      label="Release year until"
                      min={1800}
                      max={2200}
                      value={viewerFilters.year_to}
                      onChange={(value) =>
                        updateViewerFilter('year_to', value || '')
                      }
                    />
                    <TextInput
                      label="Genre contains"
                      value={viewerFilters.genre}
                      onChange={(event) =>
                        updateViewerFilter('genre', event.currentTarget.value)
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
                      value={viewerFilters.anime_mode || null}
                      onChange={(value) =>
                        updateViewerFilter('anime_mode', value || '')
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
                      value={viewerFilters.adult_mode || null}
                      onChange={(value) =>
                        updateViewerFilter('adult_mode', value || '')
                      }
                    />
                    <TextInput
                      type="date"
                      label="Added since"
                      value={viewerFilters.library_added_after}
                      onChange={(event) =>
                        updateViewerFilter(
                          'library_added_after',
                          event.currentTarget.value
                        )
                      }
                    />
                    <TextInput
                      type="date"
                      label="Added until"
                      value={viewerFilters.library_added_before}
                      onChange={(event) =>
                        updateViewerFilter(
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
                      disabled={!viewerAdvancedFilterCount}
                      onClick={() => {
                        setViewerFilters((current) => ({
                          ...EMPTY_PREVIEW_FILTERS,
                          type: current.type,
                          availability: current.availability,
                        }));
                        setViewerPage(1);
                      }}
                    >
                      Clear filters
                    </Button>
                  </Group>
                </Stack>
              </PopoverDropdown>
            </Popover>
          </Group>
          {viewerLoading ? (
            <Center mih={260}>
              <Loader />
            </Center>
          ) : viewerItems.length ? (
            <>
              <ScrollArea h={520}>
                <Table striped highlightOnHover withTableBorder stickyHeader>
                  <TableThead>
                    <TableTr>
                      <TableTh>Title</TableTh>
                      <TableTh>Type</TableTh>
                      <TableTh>Year</TableTh>
                      <TableTh>Sources</TableTh>
                      <TableTh>Status</TableTh>
                      <TableTh>Details</TableTh>
                      {viewer?.list_type === 'manual' && (
                        <TableTh>Actions</TableTh>
                      )}
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {viewerItems.map((item) => (
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
                        {viewer?.list_type === 'manual' && (
                          <TableTd>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              loading={removingItemId === item.id}
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
                  value={viewerPage}
                  onChange={setViewerPage}
                  total={Math.max(1, Math.ceil((viewerData?.count || 0) / 50))}
                  withEdges
                />
                <Text size="sm" c="dimmed">
                  {viewerData?.count || 0} titles
                </Text>
              </Group>
            </>
          ) : (
            <Center mih={220}>
              <Text c="dimmed">
                {viewerData?.count === 0 &&
                (viewerSearch ||
                  viewerAdvancedFilterCount ||
                  viewerFilters.type !== 'all' ||
                  viewerFilters.availability !== 'any')
                  ? 'No list entries match the current filters.'
                  : 'No titles in this list yet.'}
              </Text>
            </Center>
          )}
        </Stack>
      </Modal>

      {detailItem?.content_type === 'series' ? (
        <SeriesModal
          opened
          initialRelationId={detailItem.relation_ids?.[0] || null}
          listSourceScope={{
            includeAllSources: detailItem.include_all_sources,
            relationIds: detailItem.relation_ids || [],
          }}
          series={{
            id: detailItem.canonical_id,
            name: detailItem.display_title,
            year: detailItem.display_year,
            type: 'series',
          }}
          onClose={() => setDetailItem(null)}
        />
      ) : detailItem ? (
        <VODModal
          opened
          initialRelationId={detailItem.relation_ids?.[0] || null}
          listSourceScope={{
            includeAllSources: detailItem.include_all_sources,
            relationIds: detailItem.relation_ids || [],
          }}
          vod={{
            id: detailItem.canonical_id,
            name: detailItem.display_title,
            year: detailItem.display_year,
            type: 'movie',
          }}
          onClose={() => setDetailItem(null)}
        />
      ) : null}
    </Box>
  );
};

export default VODListsPage;
