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
  ListPlus,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { notifications } from '@mantine/notifications';
import API from '../api';
import SeriesModal from '../components/SeriesModal.jsx';
import VODModal from '../components/VODModal.jsx';
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
  library_added_after: '',
  library_added_before: '',
  anime_mode: 'any',
  max_age_rating: '',
  required_watch_providers: [],
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
  is_enabled: true,
  rule: EMPTY_RULE,
};

const TYPE_LABELS = {
  manual: 'Manual',
  dynamic: 'Dynamic',
  external: 'External',
  system: 'System',
};

const normalizeList = (value) => ({
  ...EMPTY_FORM,
  ...value,
  provider: value?.provider || '',
  external_key: value?.external_key || '',
  rule: { ...EMPTY_RULE, ...(value?.rules?.[0] || {}) },
});

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
        w={74}
        h={111}
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
  const [viewer, setViewer] = useState(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerData, setViewerData] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [removingItemId, setRemovingItemId] = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [ruleOptions, setRuleOptions] = useState({
    genres: [],
    watch_providers: [],
  });
  const { options: technicalOptions, loading: technicalOptionsLoading } =
    useVODFilterOptions({
      enabled: editorOpen && form.list_type === 'dynamic',
      type: form.content_type,
    });

  const isAdmin = user && user.user_level >= USER_LEVELS.ADMIN;

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await API.getVODLists();
      setLists(response?.results || response || []);
    } catch (requestError) {
      setError(requestError?.message || 'Failed to load VOD lists.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadLists();
  }, [isAdmin, loadLists]);

  useEffect(() => {
    if (!viewer) return;
    let active = true;
    setViewerLoading(true);
    API.getVODListItems(viewer.id, { page: viewerPage, page_size: 50 })
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
  }, [viewer, viewerPage]);

  useEffect(() => {
    if (!editorOpen || form.list_type !== 'dynamic') return;
    let active = true;
    API.getVODListRuleOptions(form.content_type)
      .then((response) => {
        if (active) {
          setRuleOptions({
            genres: response?.genres || [],
            watch_providers: response?.watch_providers || [],
          });
        }
      })
      .catch(() => {
        if (active) setRuleOptions({ genres: [], watch_providers: [] });
      });
    return () => {
      active = false;
    };
  }, [editorOpen, form.content_type, form.list_type]);

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
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        list_type: form.list_type,
        content_type: form.content_type,
        provider: form.list_type === 'external' ? form.provider.trim() : '',
        external_key:
          form.list_type === 'external' ? form.external_key.trim() : '',
        is_enabled: form.is_enabled,
        rules: form.list_type === 'dynamic' ? [normalizedRule] : [],
      };
      const requiresRebuild =
        ['dynamic', 'external'].includes(form.list_type) &&
        (!editing || builderSignature(form) !== builderSignature(editing));
      const saved = editing
        ? await API.updateVODList(editing.id, payload)
        : await API.createVODList(payload);
      if (requiresRebuild) {
        await API.rebuildVODList(saved.id);
      }
      setEditorOpen(false);
      await loadLists();
      notifications.show({
        color: 'green',
        message: editing ? 'List updated.' : 'List created.',
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
      await API.rebuildVODList(list.id);
      await loadLists();
      notifications.show({ color: 'green', message: `${list.name} rebuilt.` });
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

  if (!isAdmin) return <Navigate to="/vods" replace />;

  return (
    <Box h="100%" style={{ minHeight: 0, overflow: 'hidden' }}>
      <ScrollArea h="100%" p="md">
        <Stack gap="md" maw={1500} mx="auto">
          <Group justify="space-between" align="end">
            <Box>
              <Title order={2}>VOD Lists</Title>
              <Text c="dimmed" size="sm">
                Build manual, metadata-driven and external collections from
                exact library sources.
              </Text>
            </Box>
          </Group>

          {error && <Alert color="red">{error}</Alert>}
          {loading ? (
            <Center mih={240}>
              <Loader />
            </Center>
          ) : (
            <>
              {lists.map((list) => (
                <Paper key={list.id} withBorder p="md" radius="md">
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
                          {!list.is_enabled && (
                            <Badge color="gray">Disabled</Badge>
                          )}
                        </Group>
                        <Text size="sm" c="dimmed">
                          {list.item_count} titles · {list.available_item_count}{' '}
                          available
                        </Text>
                      </Box>
                      <Group gap={6}>
                        {list.list_type !== 'manual' && (
                          <ActionIcon
                            variant="subtle"
                            aria-label={`Rebuild ${list.name}`}
                            loading={rebuildingId === list.id}
                            onClick={() => rebuild(list)}
                          >
                            <RefreshCw size={17} />
                          </ActionIcon>
                        )}
                        <Button
                          variant="subtle"
                          leftSection={<Eye size={16} />}
                          onClick={() => {
                            setViewer(list);
                            setViewerPage(1);
                            setViewerData(null);
                          }}
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
                      <Center mih={111} bg="dark.7" style={{ borderRadius: 6 }}>
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
                }))
              }
            />
          </SimpleGrid>
          {form.list_type === 'external' && (
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select
                label="Provider"
                searchable
                description="Additional providers can be added later without changing the list model"
                data={[{ value: 'tmdb', label: 'TMDB' }]}
                value={form.provider}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    provider: value || '',
                  }))
                }
              />
              <TextInput
                label="TMDB list ID or preset"
                description="Presets: trending-movies, trending-series, now-playing, popular-movies, popular-series"
                value={form.external_key}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    external_key: event.target.value,
                  }))
                }
              />
            </SimpleGrid>
          )}
          {form.list_type === 'dynamic' && (
            <Stack gap="sm">
              <Text fw={600}>Metadata rules</Text>
              <Text size="sm" c="dimmed">
                All filled fields must match. If a canonical title has several
                sources, only matching sources are added to the list.
              </Text>
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
                <TextInput
                  type="date"
                  label="Released from"
                  description="TMDB release date, or first air date for series"
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
                  description="TMDB release date, or first air date for series"
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
                <TextInput
                  type="date"
                  label="Added to library from"
                  description="First import into this Dispatcharr library"
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
                  description="First import into this Dispatcharr library"
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
                  label="Maximum age rating"
                  description="TMDB certification, for example 10 for a children’s list"
                  value={form.rule.max_age_rating}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      rule: { ...current.rule, max_age_rating: value },
                    }))
                  }
                />
              </SimpleGrid>
              <MultiSelect
                label="Streaming providers"
                description="TMDB watch-provider availability for the configured TMDB region"
                placeholder="Select providers present in enriched metadata"
                searchable
                data={ruleOptions.watch_providers}
                value={form.rule.required_watch_providers}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    rule: {
                      ...current.rule,
                      required_watch_providers: value,
                    },
                  }))
                }
              />
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
          <Group>
            <Switch
              label="Enabled"
              checked={form.is_enabled}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  is_enabled: event.currentTarget.checked,
                }))
              }
            />
          </Group>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              leftSection={<Plus size={16} />}
              loading={saving}
              disabled={
                !form.name.trim() ||
                (form.list_type === 'external' &&
                  (!form.provider || !form.external_key.trim()))
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
        {viewerLoading ? (
          <Center mih={260}>
            <Loader />
          </Center>
        ) : viewerItems.length ? (
          <Stack>
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
          </Stack>
        ) : (
          <Center mih={220}>
            <Text c="dimmed">No titles in this list yet.</Text>
          </Center>
        )}
      </Modal>

      {detailItem?.content_type === 'series' ? (
        <SeriesModal
          opened
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
