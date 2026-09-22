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
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { Eye, Film, ListPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { notifications } from '@mantine/notifications';
import API from '../api';
import useAuthStore from '../store/auth';
import { USER_LEVELS } from '../constants';

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
  const [viewer, setViewer] = useState(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerData, setViewerData] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(false);

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
      };
      if (editing) await API.updateVODList(editing.id, payload);
      else await API.createVODList(payload);
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
