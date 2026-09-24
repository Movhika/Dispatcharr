import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Info,
  ListPlus,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { notifications } from '@mantine/notifications';
import API from '../api';
import ConfirmationDialog from '../components/ConfirmationDialog.jsx';
import VODListItemDetails from '../components/VODListItemDetails.jsx';
import VODListPreviewModal from '../components/VODListPreviewModal.jsx';
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
  sort_mode: '',
  date_source: 'none',
  date_mode: 'fixed',
  rule: EMPTY_RULE,
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

const externalProviderLabel = (provider) =>
  provider?.toLowerCase() === 'tmdb'
    ? 'TMDB'
    : provider?.trim().toUpperCase() || 'Unknown provider';

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
    sort_mode: value?.settings?.sort_mode || '',
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
    settings:
      value.list_type === 'external' && value.external_key === 'watch-provider'
        ? {
            watch_provider_id: String(value.settings?.watch_provider_id || ''),
            watch_region: String(value.settings?.watch_region || ''),
            watch_monetization_types: String(
              value.settings?.watch_monetization_types || 'flatrate'
            ),
          }
        : {},
    rules: value.list_type === 'dynamic' ? [rule] : [],
  });
};

const Poster = ({ item, onOpen }) => {
  const title = item.display_title || 'Untitled';
  const poster = item.display_poster;
  const canOpen = Boolean(item.is_available && item.canonical_id);
  return (
    <Tooltip
      label={`${title}${item.display_year ? ` (${item.display_year})` : ''}${
        item.is_available ? '' : ' · Not in library'
      }`}
      withArrow
    >
      <Box
        component={canOpen ? 'button' : 'div'}
        type={canOpen ? 'button' : undefined}
        aria-label={canOpen ? `Open details for ${title}` : undefined}
        onClick={canOpen ? () => onOpen(item) : undefined}
        w={116}
        h={174}
        pos="relative"
        style={{
          flex: '0 0 auto',
          border: 0,
          padding: 0,
          borderRadius: 6,
          overflow: 'hidden',
          background: 'transparent',
          cursor: canOpen ? 'pointer' : 'default',
        }}
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

const PosterStrip = ({ list, onOpen }) => {
  const containerRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(12);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const update = () => {
      const nextWidth = node.clientWidth;
      if (nextWidth <= 0) return;
      setWidth(nextWidth);
      setVisibleCount(Math.max(1, Math.floor((nextWidth + 8) / 124)));
    };
    update();
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(node);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const posters = (list.preview || []).slice(0, visibleCount);
  const hasMore =
    posters.length >= visibleCount &&
    Number(list.item_count || 0) > posters.length;
  const fadeWidth = Math.min(4 * 124, Math.max(124, width * 0.6));
  const mask = hasMore
    ? `linear-gradient(to right, #000 0%, #000 calc(100% - ${fadeWidth}px), transparent 100%)`
    : undefined;

  return (
    <Box ref={containerRef} w="100%" style={{ overflow: 'hidden' }}>
      <Group
        gap={8}
        wrap="nowrap"
        style={{ overflow: 'hidden', maskImage: mask, WebkitMaskImage: mask }}
      >
        {posters.map((item) => (
          <Poster key={item.id} item={item} onOpen={onOpen} />
        ))}
      </Group>
    </Box>
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
  const [checkingId, setCheckingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [viewer, setViewer] = useState(null);
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
        form.external_source === 'watch-provider'
          ? {
              watch_provider_id: form.settings.watch_provider_id,
              watch_provider_name: form.settings.watch_provider_name,
              watch_region: form.settings.watch_region,
              watch_monetization_types: form.settings.watch_monetization_types,
            }
          : {};
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        list_type: form.list_type,
        content_type: form.content_type,
        provider: form.list_type === 'external' ? form.provider.trim() : '',
        external_key: form.list_type === 'external' ? externalKey : '',
        settings: {
          ...(form.list_type === 'external' ? externalSettings : {}),
          ...(form.sort_mode ? { sort_mode: form.sort_mode } : {}),
        },
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

  const requestListAction = async (list, action) => {
    setCheckingId(list.id);
    try {
      const usage = await API.getVODListUsage(list.id);
      const profiles = usage?.profiles || [];
      if (action === 'disable' && !profiles.length) {
        await toggleEnabled(list, false);
      } else {
        setConfirmation({ action, list, profiles });
      }
    } catch (requestError) {
      notifications.show({
        color: 'red',
        title: 'Could not check list usage',
        message: requestError?.message || 'The request failed.',
      });
    } finally {
      setCheckingId(null);
    }
  };

  const confirmListAction = async () => {
    if (!confirmation) return;
    const { action, list } = confirmation;
    if (action === 'disable') {
      setConfirmation(null);
      await toggleEnabled(list, false);
      return;
    }
    setDeletingId(list.id);
    try {
      await API.deleteVODList(list.id);
      setLists((current) => current.filter((entry) => entry.id !== list.id));
      setConfirmation(null);
      notifications.show({ color: 'green', message: 'List deleted.' });
    } catch (requestError) {
      notifications.show({
        color: 'red',
        title: 'Could not delete list',
        message: requestError?.message || 'The request failed.',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const confirmationMessage = confirmation && (
    <Stack gap="xs">
      <Text>
        {confirmation.action === 'delete'
          ? `Delete “${confirmation.list.name}”? This cannot be undone.`
          : `Disable “${confirmation.list.name}”?`}
      </Text>
      {confirmation.profiles.length > 0 && (
        <Alert color="yellow" title="Used by VOD profiles">
          <Text size="sm">
            {confirmation.profiles.map((profile) => profile.name).join(', ')}
          </Text>
          <Text size="sm" mt="xs">
            {confirmation.action === 'delete'
              ? 'Deleting this list removes it from these profiles and rebuilds affected active profiles.'
              : 'Disabling this list removes its titles from affected active profiles until it is enabled again.'}
          </Text>
        </Alert>
      )}
    </Stack>
  );

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
                <Paper
                  key={list.id}
                  withBorder
                  p="md"
                  radius="md"
                  style={
                    list.is_enabled
                      ? undefined
                      : { opacity: 0.55, filter: 'grayscale(0.75)' }
                  }
                >
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
                          {list.list_type === 'external' && (
                            <Badge variant="outline" color="gray">
                              {externalProviderLabel(list.provider)}
                            </Badge>
                          )}
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
                      <Group gap="xs">
                        <Paper withBorder px="sm" py={6} radius="md">
                          <Switch
                            label="Enabled"
                            checked={list.is_enabled}
                            disabled={
                              list.is_system ||
                              togglingId === list.id ||
                              checkingId === list.id
                            }
                            onChange={(event) =>
                              event.currentTarget.checked
                                ? toggleEnabled(list, true)
                                : requestListAction(list, 'disable')
                            }
                          />
                        </Paper>
                        <Paper withBorder px={6} py={4} radius="md">
                          <Group gap={4} wrap="nowrap">
                            <Tooltip
                              label={
                                list.list_type === 'manual'
                                  ? 'Manual lists update when their items change'
                                  : list.list_type === 'external' &&
                                      list.provider !== 'tmdb'
                                    ? 'This external provider has no automatic sync yet'
                                    : `Sync ${list.name}`
                              }
                            >
                              <span>
                                <ActionIcon
                                  variant="subtle"
                                  aria-label={`Sync ${list.name}`}
                                  disabled={
                                    list.list_type === 'manual' ||
                                    (list.list_type === 'external' &&
                                      list.provider !== 'tmdb')
                                  }
                                  loading={
                                    rebuildingId === list.id ||
                                    ['queued', 'running'].includes(
                                      list.sync_status
                                    )
                                  }
                                  onClick={() => rebuild(list)}
                                >
                                  <RefreshCw size={17} />
                                </ActionIcon>
                              </span>
                            </Tooltip>
                            <Tooltip label={`Preview ${list.name}`}>
                              <ActionIcon
                                variant="subtle"
                                aria-label={`Preview ${list.name}`}
                                onClick={() => setViewer(list)}
                              >
                                <Eye size={17} />
                              </ActionIcon>
                            </Tooltip>
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
                              disabled={
                                list.is_system ||
                                checkingId === list.id ||
                                deletingId === list.id
                              }
                              onClick={() => requestListAction(list, 'delete')}
                            >
                              <Trash2 size={17} />
                            </ActionIcon>
                          </Group>
                        </Paper>
                      </Group>
                    </Group>

                    {list.preview?.length ? (
                      <PosterStrip list={list} onOpen={setDetailItem} />
                    ) : (
                      <Center mih={174} bg="dark.7" style={{ borderRadius: 6 }}>
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

      <ConfirmationDialog
        opened={Boolean(confirmation)}
        onClose={() => setConfirmation(null)}
        onConfirm={confirmListAction}
        title={
          confirmation?.action === 'delete'
            ? 'Delete VOD list'
            : 'Disable VOD list'
        }
        message={confirmationMessage}
        confirmLabel={
          confirmation?.action === 'delete' ? 'Delete list' : 'Disable list'
        }
        loading={deletingId !== null}
      />

      <Modal
        opened={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Create VOD list'}
        size="xl"
      >
        <Stack gap="md">
          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <Text fw={700}>General</Text>
              <TextInput
                label="Name"
                required
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
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
            </Stack>
          </Paper>
          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <Text fw={700}>Source</Text>
              {form.list_type === 'manual' && (
                <Text size="sm" c="dimmed">
                  Add titles to this list from their library detail view.
                </Text>
              )}
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
                          Choose either Movies or Series above. TMDB exposes
                          these streaming catalogs separately.
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
                            const selected =
                              externalOptions.watch_providers.find(
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
                            {
                              value: 'flatrate',
                              label: 'Subscription streaming',
                            },
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
                                  release_date_before:
                                    event.currentTarget.value,
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
                                  release_yearly_from:
                                    event.currentTarget.value,
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
                                  release_yearly_until:
                                    event.currentTarget.value,
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
                              rule: {
                                ...current.rule,
                                release_last_days: value,
                              },
                            }))
                          }
                        />
                      )}
                    {form.date_source === 'added' &&
                      form.date_mode === 'fixed' && (
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
                                  library_added_after:
                                    event.currentTarget.value,
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
                                  library_added_before:
                                    event.currentTarget.value,
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
                      data={(technicalOptions.resolutions || []).map(
                        (value) => ({
                          value: resolutionNumber(value),
                          label: value,
                        })
                      )}
                      value={
                        form.rule.min_resolution
                          ? String(form.rule.min_resolution)
                          : null
                      }
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          rule: {
                            ...current.rule,
                            min_resolution: value || '',
                          },
                        }))
                      }
                    />
                    <Select
                      label="Maximum resolution"
                      placeholder="No maximum"
                      clearable
                      disabled={technicalOptionsLoading}
                      data={(technicalOptions.resolutions || []).map(
                        (value) => ({
                          value: resolutionNumber(value),
                          label: value,
                        })
                      )}
                      value={
                        form.rule.max_resolution
                          ? String(form.rule.max_resolution)
                          : null
                      }
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          rule: {
                            ...current.rule,
                            max_resolution: value || '',
                          },
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
                        rule: {
                          ...current.rule,
                          required_video_features: value,
                        },
                      }))
                    }
                  />
                </Stack>
              )}
            </Stack>
          </Paper>
          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <Text fw={700}>Sort</Text>
              <Select
                label="Sort titles"
                placeholder="Original order"
                description="Leave empty to keep the order supplied by the list source."
                clearable
                data={[
                  { value: 'release_date_desc', label: 'Newest release first' },
                  {
                    value: 'library_added_desc',
                    label: 'Recently added to library first',
                  },
                ]}
                value={form.sort_mode || null}
                onChange={(value) =>
                  setForm((current) => ({ ...current, sort_mode: value || '' }))
                }
              />
            </Stack>
          </Paper>
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

      {viewer && (
        <VODListPreviewModal
          key={viewer.id}
          list={viewer}
          onClose={() => setViewer(null)}
          onListChanged={() => loadLists({ background: true })}
          canRemove
        />
      )}
      <VODListItemDetails
        item={detailItem}
        onClose={() => setDetailItem(null)}
      />
    </Box>
  );
};

export default VODListsPage;
