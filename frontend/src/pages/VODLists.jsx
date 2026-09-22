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
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
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
import useAuthStore from '../store/auth';
import { USER_LEVELS } from '../constants';

const EMPTY_RULE = {
  required_genres: [],
  min_year: '',
  max_year: '',
  library_added_after: '',
  library_added_before: '',
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
  is_enabled: true,
  is_visible: true,
  sort_order: 0,
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
        is_visible: form.is_visible,
        sort_order: Number(form.sort_order) || 0,
        rules: form.list_type === 'dynamic' ? [normalizedRule] : [],
      };
      const saved = editing
        ? await API.updateVODList(editing.id, payload)
        : await API.createVODList(payload);
      if (['dynamic', 'external'].includes(form.list_type)) {
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
                          {!list.is_visible && (
                            <Badge color="gray" variant="outline">
                              Hidden
                            </Badge>
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
                          Show all
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
                data={[
                  { value: 'tmdb', label: 'TMDB' },
                  { value: 'mdblist', label: 'MDBList' },
                  { value: 'trakt', label: 'Trakt' },
                  { value: 'simkl', label: 'Simkl' },
                ]}
                value={form.provider}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    provider: value || '',
                  }))
                }
              />
              <TextInput
                label="List ID"
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
                placeholder="Type a genre and press Enter"
                value={form.rule.required_genres}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    rule: { ...current.rule, required_genres: value },
                  }))
                }
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <NumberInput
                  label="Release year from"
                  value={form.rule.min_year}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      rule: { ...current.rule, min_year: value },
                    }))
                  }
                />
                <NumberInput
                  label="Release year to"
                  value={form.rule.max_year}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      rule: { ...current.rule, max_year: value },
                    }))
                  }
                />
                <TextInput
                  type="date"
                  label="Added from"
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
                  label="Added until"
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
                  description="For example 10 for a children’s list"
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
                  data={['eng', 'ger', 'spa', 'fra', 'ita', 'jpn']}
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
                  data={['eng', 'ger', 'spa', 'fra', 'ita', 'jpn']}
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
                <NumberInput
                  label="Minimum resolution"
                  placeholder="e.g. 2160"
                  value={form.rule.min_resolution}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      rule: { ...current.rule, min_resolution: value },
                    }))
                  }
                />
                <NumberInput
                  label="Maximum resolution"
                  placeholder="e.g. 1080"
                  value={form.rule.max_resolution}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      rule: { ...current.rule, max_resolution: value },
                    }))
                  }
                />
              </SimpleGrid>
              <MultiSelect
                label="Features"
                data={['3d', 'dv', 'hdr', 'hdr10', 'hdr10_plus', 'atmos']}
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
          <NumberInput
            label="Order"
            value={form.sort_order}
            onChange={(value) =>
              setForm((current) => ({ ...current, sort_order: value || 0 }))
            }
          />
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
            <Switch
              label="Visible in output"
              checked={form.is_visible}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  is_visible: event.currentTarget.checked,
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
        title={viewer?.name || 'List items'}
        size="xl"
      >
        {viewerLoading ? (
          <Center mih={260}>
            <Loader />
          </Center>
        ) : viewerItems.length ? (
          <Stack>
            <SimpleGrid cols={{ base: 3, sm: 5, md: 8 }} spacing="sm">
              {viewerItems.map((item) => (
                <Stack key={item.id} gap={4} align="center">
                  <Poster item={item} />
                  <Text size="xs" lineClamp={2} ta="center">
                    {item.display_title}
                  </Text>
                  {viewer?.list_type === 'manual' && (
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="red"
                      loading={removingItemId === item.id}
                      aria-label={`Remove ${item.display_title}`}
                      onClick={() => removeItem(item)}
                    >
                      <Trash2 size={14} />
                    </ActionIcon>
                  )}
                </Stack>
              ))}
            </SimpleGrid>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                {viewerData?.count || 0} titles
              </Text>
              <Group gap="xs">
                <Button
                  variant="default"
                  disabled={!viewerData?.previous}
                  onClick={() => setViewerPage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </Button>
                <Text size="sm">Page {viewerPage}</Text>
                <Button
                  variant="default"
                  disabled={!viewerData?.next}
                  onClick={() => setViewerPage((page) => page + 1)}
                >
                  Next
                </Button>
              </Group>
            </Group>
          </Stack>
        ) : (
          <Center mih={220}>
            <Text c="dimmed">No titles in this list yet.</Text>
          </Center>
        )}
      </Modal>
    </Box>
  );
};

export default VODListsPage;
