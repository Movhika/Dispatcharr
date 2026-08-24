import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Pagination,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import API from '../api';
import useVODStore from '../store/useVODStore';
import { showNotification } from '../utils/notificationUtils';
import { normalizeLanguageCodes } from '../utils/languageCodes.js';
import {
  CONTAINER_EXTENSION_OPTIONS,
  RESOLUTION_LIMIT_OPTIONS,
  RESOLUTION_VALUES,
} from '../utils/vodMetadataOptions.js';
import LanguagePicker, { LanguageSelect } from './LanguagePicker.jsx';
import VODUserCategorySelector from './forms/VODUserCategorySelector.jsx';

const EMPTY_PROFILE = {
  name: '',
  export_mode: 'compact',
  is_default: false,
  is_active: true,
  hard_constraints: {
    required_audio_languages: [],
    required_subtitle_languages: [],
    language_match_mode: 'any',
    min_resolution: 0,
    max_resolution: 0,
    allow_unknown_metadata: true,
  },
  ranking: ['audio_language', 'subtitle_language', 'resolution'],
  category_rules: [],
};

const metadataText = (metadata, field) => {
  const value = metadata?.[field];
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  return value || '—';
};

const relationIds = (profile) =>
  (profile?.category_rules || [])
    .filter((rule) => rule.enabled !== false)
    .map((rule) => String(rule.category_relation));

const formatDuration = (seconds) => {
  const rounded = Math.max(Math.round(seconds || 0), 0);
  if (rounded < 60) return `${rounded}s`;
  if (rounded >= 3600) {
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}m ${remainder}s`;
};

const VODOutputProfilesModal = ({ opened, onClose }) => {
  const categories = useVODStore((state) => state.categories);
  const profiles = useVODStore((state) => state.accessPolicies);
  const fetchCategories = useVODStore((state) => state.fetchCategories);
  const fetchProfiles = useVODStore((state) => state.fetchAccessPolicies);
  const removeAccessPolicy = useVODStore((state) => state.removeAccessPolicy);
  const [profileId, setProfileId] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_PROFILE);
  const [categorySelectorOpen, setCategorySelectorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState('settings');
  const [preview, setPreview] = useState({ count: 0, results: [] });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    type: 'movie',
    search: '',
    m3u_account: '',
    category: '',
    audio_language: '',
    subtitle_language: '',
    resolution: '',
    container_extension: '',
  });

  const selectedProfile = profiles.find(
    (profile) => String(profile.id) === String(profileId)
  );
  const selectedProfileId = selectedProfile?.id;
  const selectedSelectionStatus = selectedProfile?.selection_status;
  const selectionAvailable =
    selectedProfile?.selection_available ??
    selectedProfile?.selection_current ??
    false;

  const resetDraft = (profile = null) => {
    const source = profile || EMPTY_PROFILE;
    const sourceConstraints = { ...(source.hard_constraints || {}) };
    delete sourceConstraints.preferred_resolutions;
    delete sourceConstraints.min_height;
    delete sourceConstraints.max_height;
    setDraft({
      ...EMPTY_PROFILE,
      ...source,
      hard_constraints: {
        ...EMPTY_PROFILE.hard_constraints,
        ...sourceConstraints,
      },
      ranking: source.ranking || EMPTY_PROFILE.ranking,
      category_rules: source.category_rules || [],
    });
  };

  useEffect(() => {
    if (!opened) return;
    let active = true;
    setProfilesLoaded(false);
    Promise.all([fetchCategories(), fetchProfiles()]).finally(() => {
      if (active) setProfilesLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [fetchCategories, fetchProfiles, opened]);

  useEffect(() => {
    if (opened) return;
    setCreating(false);
    setProfileId('');
    setActiveTab('settings');
    setProfilesLoaded(false);
  }, [opened]);

  useEffect(() => {
    if (!opened || creating || profileId || !profiles.length) return;
    const first = profiles.find((profile) => profile.is_default) || profiles[0];
    setProfileId(String(first.id));
  }, [creating, opened, profileId, profiles]);

  useEffect(() => {
    if (creating || !selectedProfile) return;
    resetDraft(selectedProfile);
    // Polling replaces profile objects in the store. Only switching profiles
    // may reset a local, possibly unsaved draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, selectedProfile?.id]);

  useEffect(() => {
    if (!opened || !selectedProfileId) return;
    if (!['pending', 'building'].includes(selectedSelectionStatus)) {
      return;
    }
    const timer = window.setInterval(() => fetchProfiles(), 2000);
    return () => window.clearInterval(timer);
  }, [fetchProfiles, opened, selectedProfileId, selectedSelectionStatus]);

  const accountOptions = useMemo(
    () =>
      [
        ...new Map(
          Object.values(categories || {}).flatMap((category) =>
            (category.m3u_accounts || []).map((relation) => [
              String(relation.m3u_account),
              relation.account_name,
            ])
          )
        ),
      ]
        .map(([value, label]) => ({ value, label }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [categories]
  );
  const categoryOptions = useMemo(
    () =>
      Object.values(categories || {})
        .filter(
          (category) =>
            category.category_type === filters.type &&
            (!filters.m3u_account ||
              (category.m3u_accounts || []).some(
                (relation) =>
                  String(relation.m3u_account) === filters.m3u_account
              ))
        )
        .map((category) => ({
          value: String(category.id),
          label: category.name,
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [categories, filters.m3u_account, filters.type]
  );

  const loadPreview = async () => {
    if (!selectionAvailable) {
      setPreview({ count: 0, results: [] });
      return;
    }
    setPreviewLoading(true);
    try {
      const params = Object.fromEntries(
        Object.entries({ ...filters, page, page_size: 50 }).filter(
          ([, value]) => value !== ''
        )
      );
      setPreview(
        await API.getVODAccessPolicySelections(selectedProfile.id, params)
      );
    } catch {
      setPreview({ count: 0, results: [] });
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!opened || activeTab !== 'preview') return;
    const timer = window.setTimeout(loadPreview, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    filters,
    opened,
    page,
    selectionAvailable,
    selectedProfile?.selection_completed_at,
  ]);

  const updateConstraint = (field, value) =>
    setDraft((current) => ({
      ...current,
      hard_constraints: {
        ...current.hard_constraints,
        [field]: value,
      },
    }));

  const save = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        export_mode: draft.export_mode,
        is_default: draft.is_default,
        is_active: draft.is_active,
        hard_constraints: {
          ...draft.hard_constraints,
          required_audio_languages: normalizeLanguageCodes(
            draft.hard_constraints.required_audio_languages
          ),
          required_subtitle_languages: normalizeLanguageCodes(
            draft.hard_constraints.required_subtitle_languages
          ),
        },
        ranking: draft.ranking,
        category_rules: relationIds(draft).map((category_relation) => ({
          category_relation: Number(category_relation),
          enabled: true,
          priority: 0,
        })),
      };
      const saved = profileId
        ? await API.updateVODAccessPolicy(profileId, payload)
        : await API.createVODAccessPolicy(payload);
      await fetchProfiles();
      setCreating(false);
      setProfileId(String(saved.id));
      showNotification({
        title: 'VOD output profile saved',
        message: 'Its XC catalog has been queued automatically.',
        color: 'green',
      });
    } catch (error) {
      showNotification({
        title: 'VOD output profile was not saved',
        message: error?.message || 'Please check the values and retry.',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const rebuild = async () => {
    if (!selectedProfile) return;
    setRebuilding(true);
    try {
      await API.rebuildVODAccessPolicy(selectedProfile.id);
      await fetchProfiles();
      showNotification({
        title: 'XC catalog refresh queued',
        message:
          'The current catalog stays available until the new one is ready.',
        color: 'blue',
      });
    } catch (error) {
      showNotification({
        title: 'XC catalog refresh was not queued',
        message: error?.message || 'Please retry.',
        color: 'red',
      });
    } finally {
      setRebuilding(false);
    }
  };

  const remove = async () => {
    if (!selectedProfile || selectedProfile.is_default) return;
    const deletedProfile = selectedProfile;
    setDeleting(true);
    try {
      await API.deleteVODAccessPolicy(deletedProfile.id);
      setCreating(false);
      setProfileId('');
      resetDraft();
      removeAccessPolicy(deletedProfile.id);
      await fetchProfiles();
      showNotification({
        title: 'VOD output profile deleted',
        message: `${deletedProfile.name} was removed.`,
        color: 'green',
      });
    } catch (error) {
      await fetchProfiles();
      showNotification({
        title: 'VOD output profile was not deleted',
        message: error?.message || 'Please retry.',
        color: 'red',
      });
    } finally {
      setDeleting(false);
    }
  };

  const startNew = () => {
    setCreating(true);
    setProfileId('');
    resetDraft();
    setActiveTab('settings');
  };

  const selectedCategoryIds = relationIds(draft);
  const counts = selectedProfile?.selection_counts || {};
  const buildProgress = selectedProfile?.selection_progress || {};
  const buildPercent = Math.max(
    0,
    Math.min(Number(buildProgress.percent) || 0, 100)
  );
  const buildStartedAt =
    selectedProfile?.selection_status === 'building'
      ? selectedProfile.selection_started_at
      : buildProgress.updated_at;
  const buildElapsedSeconds = buildStartedAt
    ? Math.max((Date.now() - new Date(buildStartedAt).getTime()) / 1000, 0)
    : 0;
  const buildRemainingSeconds =
    selectedProfile?.selection_status === 'building' && buildPercent > 1
      ? (buildElapsedSeconds / buildPercent) * (100 - buildPercent)
      : null;
  const lastBuildSeconds = (() => {
    const started = new Date(
      selectedProfile?.selection_started_at || ''
    ).getTime();
    const completed = new Date(
      selectedProfile?.selection_completed_at || ''
    ).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
    return Math.max((completed - started) / 1000, 0);
  })();
  const profileOptions = profiles.map((profile) => ({
    value: String(profile.id),
    label: `${profile.name}${profile.is_default ? ' (default)' : ''}`,
  }));
  const selectionState = (() => {
    if (!selectedProfile?.is_active) {
      return {
        label: 'Inactive',
        color: 'gray',
        description: 'This profile is saved but is not used for XC output.',
      };
    }
    if (selectedProfile.selection_status === 'failed') {
      return {
        label: 'Failed',
        color: 'red',
        description:
          'The latest XC catalog preparation failed. Review the error and refresh the catalog.',
      };
    }
    if (selectedProfile.selection_status === 'building') {
      return {
        label: 'Preparing',
        color: 'blue',
        description:
          'The source selection is being prepared in the background. The previous catalog remains active until this finishes.',
      };
    }
    if (selectedProfile.selection_status === 'pending') {
      return {
        label: 'Queued',
        color: 'yellow',
        description:
          'The source selection is waiting for background preparation. Saving a profile queues this automatically.',
      };
    }
    if (selectedProfile.selection_current) {
      return {
        label: 'Ready',
        color: 'green',
        description:
          'The prepared XC catalog is current and ready for clients.',
      };
    }
    return {
      label: 'Outdated',
      color: 'yellow',
      description:
        'The prepared XC catalog no longer matches the source state.',
    };
  })();

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title="VOD output profiles"
        size="96vw"
        yOffset="2vh"
        lockScroll={false}
        scrollAreaComponent={Modal.NativeScrollArea}
        styles={{
          content: { height: '96vh', overflowX: 'hidden' },
          body: { height: 'calc(96vh - 60px)', overflowX: 'hidden' },
        }}
      >
        <Stack h="100%" gap="sm">
          <Group align="flex-end" wrap="wrap">
            <Select
              label="Profile"
              placeholder="New profile"
              searchable
              data={profileOptions}
              value={profileId || null}
              onChange={(value) => {
                setCreating(false);
                setProfileId(value || '');
              }}
              style={{ flex: 1, minWidth: 260 }}
            />
            {selectedProfile && (
              <Tooltip label={selectionState.description} multiline maw={360}>
                <Badge color={selectionState.color} size="lg">
                  {selectionState.label}
                </Badge>
              </Tooltip>
            )}
            <Button
              variant="default"
              leftSection={<Plus size={15} />}
              onClick={startNew}
            >
              New
            </Button>
            <Tooltip
              label="Saving queues catalog preparation automatically. Use this to retry or manually refresh the prepared XC selection."
              multiline
              maw={360}
            >
              <Button
                variant="default"
                leftSection={<RefreshCw size={15} />}
                disabled={
                  !selectedProfile?.is_active ||
                  selectedProfile?.selection_status === 'building'
                }
                loading={rebuilding}
                onClick={rebuild}
              >
                Refresh catalog
              </Button>
            </Tooltip>
            <Button
              color="red"
              variant="light"
              leftSection={<Trash2 size={15} />}
              disabled={!selectedProfile || selectedProfile.is_default}
              loading={deleting}
              onClick={remove}
            >
              Delete
            </Button>
          </Group>

          <Group gap="lg" wrap="wrap">
            <Text size="sm">Output entries: {counts.output_entries || 0}</Text>
            <Text size="sm">
              Canonical titles: {counts.canonical_titles || 0}
            </Text>
            <Text size="sm">
              Eligible sources: {counts.eligible_sources || 0}
            </Text>
            <Text size="sm">
              Unknown metadata: {counts.unknown_metadata || 0}
            </Text>
          </Group>

          {profilesLoaded &&
            ['pending', 'building'].includes(
              selectedProfile?.selection_status
            ) && (
              <Stack gap={5}>
                <Group justify="space-between" gap="sm">
                  <Text size="sm" fw={500}>
                    {buildProgress.phase ||
                      (selectedProfile.selection_status === 'pending'
                        ? 'Waiting for worker'
                        : 'Preparing catalog')}
                    {Number.isFinite(Number(buildProgress.processed)) &&
                      Number(buildProgress.total) > 0 &&
                      ` — ${Number(buildProgress.processed).toLocaleString()} / ${Number(buildProgress.total).toLocaleString()}`}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {selectedProfile.selection_status === 'pending'
                      ? `Queued for ${formatDuration(buildElapsedSeconds)}`
                      : `${Math.round(buildPercent)}% · ${formatDuration(buildElapsedSeconds)} elapsed${
                          buildRemainingSeconds !== null
                            ? ` · about ${formatDuration(buildRemainingSeconds)} remaining`
                            : ''
                        }`}
                  </Text>
                </Group>
                <Progress
                  value={buildPercent}
                  animated
                  color={
                    selectedProfile.selection_status === 'pending'
                      ? 'yellow'
                      : 'blue'
                  }
                  aria-label="Catalog preparation progress"
                />
              </Stack>
            )}

          {profilesLoaded &&
            selectedProfile?.selection_status === 'ready' &&
            lastBuildSeconds !== null && (
              <Text size="sm" c="dimmed">
                Catalog prepared in {formatDuration(lastBuildSeconds)}.
              </Text>
            )}

          {selectedProfile?.selection_error && (
            <Alert color="red">{selectedProfile.selection_error}</Alert>
          )}

          <Tabs
            value={activeTab}
            onChange={setActiveTab}
            style={{ flex: 1, minHeight: 0 }}
          >
            <TabsList>
              <TabsTab value="settings">Settings</TabsTab>
              <TabsTab value="preview">Content preview</TabsTab>
            </TabsList>

            <TabsPanel value="settings" pt="md">
              <ScrollArea h="calc(96vh - 270px)">
                <Stack maw={900} mx="auto">
                  <TextInput
                    label="Profile name"
                    required
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.currentTarget.value })
                    }
                  />
                  <Select
                    label="XC VOD output"
                    data={[
                      {
                        value: 'compact',
                        label: 'Compact — one preferred edition per title',
                      },
                      {
                        value: 'variants',
                        label: 'Variants — every distinct source edition',
                      },
                    ]}
                    value={draft.export_mode}
                    onChange={(value) =>
                      setDraft({ ...draft, export_mode: value })
                    }
                  />
                  <Group grow>
                    <Switch
                      label="Active"
                      checked={draft.is_active}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          is_active: event.currentTarget.checked,
                        })
                      }
                    />
                    <Switch
                      label="Default profile"
                      checked={draft.is_default}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          is_default: event.currentTarget.checked,
                        })
                      }
                    />
                  </Group>
                  <LanguagePicker
                    label="Allowed and preferred DUB languages"
                    value={draft.hard_constraints.required_audio_languages}
                    onChange={(value) =>
                      updateConstraint('required_audio_languages', value)
                    }
                  />
                  <LanguagePicker
                    label="Allowed and preferred SUB languages"
                    value={draft.hard_constraints.required_subtitle_languages}
                    onChange={(value) =>
                      updateConstraint('required_subtitle_languages', value)
                    }
                  />
                  <Select
                    label="Language matching"
                    data={[
                      { value: 'all', label: 'DUB and SUB must match' },
                      { value: 'any', label: 'DUB or SUB may match' },
                    ]}
                    value={draft.hard_constraints.language_match_mode}
                    onChange={(value) =>
                      updateConstraint('language_match_mode', value)
                    }
                  />
                  <Group grow align="flex-start">
                    <Select
                      label="Minimum resolution"
                      data={RESOLUTION_LIMIT_OPTIONS}
                      value={String(draft.hard_constraints.min_resolution || 0)}
                      onChange={(value) =>
                        updateConstraint('min_resolution', Number(value) || 0)
                      }
                    />
                    <Select
                      label="Maximum resolution"
                      data={RESOLUTION_LIMIT_OPTIONS}
                      value={String(draft.hard_constraints.max_resolution || 0)}
                      onChange={(value) =>
                        updateConstraint('max_resolution', Number(value) || 0)
                      }
                    />
                  </Group>
                  <Switch
                    label="Allow unknown technical metadata"
                    checked={draft.hard_constraints.allow_unknown_metadata}
                    onChange={(event) =>
                      updateConstraint(
                        'allow_unknown_metadata',
                        event.currentTarget.checked
                      )
                    }
                  />
                  <Group justify="space-between">
                    <Stack gap={0}>
                      <Text fw={500}>Allowed source categories</Text>
                      <Text size="sm" c="dimmed">
                        {selectedCategoryIds.length
                          ? `${selectedCategoryIds.length} categories selected`
                          : 'All enabled categories'}
                      </Text>
                    </Stack>
                    <Button
                      variant="default"
                      onClick={() => setCategorySelectorOpen(true)}
                    >
                      Manage categories
                    </Button>
                  </Group>
                  <Group justify="flex-end" py="md">
                    <Button
                      leftSection={<Save size={15} />}
                      loading={saving}
                      disabled={!draft.name.trim()}
                      onClick={save}
                    >
                      Save profile
                    </Button>
                  </Group>
                </Stack>
              </ScrollArea>
            </TabsPanel>

            <TabsPanel value="preview" pt="md">
              <Stack>
                {!selectionAvailable && (
                  <Alert color="yellow">
                    This profile has no completed catalog yet. Its content can
                    be previewed as soon as the first preparation finishes.
                  </Alert>
                )}
                {selectionAvailable && !selectedProfile?.selection_current && (
                  <Alert color="blue">
                    Showing the last completed catalog while the updated one is
                    prepared in the background.
                  </Alert>
                )}
                <Group align="flex-end" wrap="wrap">
                  <SegmentedControl
                    value={filters.type}
                    onChange={(value) => {
                      setFilters({ ...filters, type: value, category: '' });
                      setPage(1);
                    }}
                    data={[
                      { value: 'movie', label: 'Movies' },
                      { value: 'series', label: 'Series' },
                    ]}
                  />
                  <TextInput
                    label="Search"
                    value={filters.search}
                    onChange={(event) => {
                      setFilters({
                        ...filters,
                        search: event.currentTarget.value,
                      });
                      setPage(1);
                    }}
                    miw={220}
                  />
                  <Select
                    label="M3U account"
                    clearable
                    searchable
                    data={accountOptions}
                    value={filters.m3u_account || null}
                    onChange={(value) => {
                      setFilters({
                        ...filters,
                        m3u_account: value || '',
                        category: '',
                      });
                      setPage(1);
                    }}
                    miw={180}
                  />
                  <Select
                    label="Category"
                    clearable
                    searchable
                    data={categoryOptions}
                    value={filters.category || null}
                    onChange={(value) => {
                      setFilters({ ...filters, category: value || '' });
                      setPage(1);
                    }}
                    miw={180}
                  />
                  <LanguageSelect
                    label="DUB"
                    value={filters.audio_language}
                    onChange={(value) =>
                      setFilters({
                        ...filters,
                        audio_language: value,
                      })
                    }
                    w={160}
                  />
                  <LanguageSelect
                    label="SUB"
                    value={filters.subtitle_language}
                    onChange={(value) =>
                      setFilters({
                        ...filters,
                        subtitle_language: value,
                      })
                    }
                    w={160}
                  />
                  <Select
                    label="Resolution"
                    clearable
                    data={RESOLUTION_VALUES}
                    value={filters.resolution || null}
                    onChange={(value) =>
                      setFilters({ ...filters, resolution: value || '' })
                    }
                    w={120}
                  />
                  <Select
                    label="Format"
                    clearable
                    data={CONTAINER_EXTENSION_OPTIONS}
                    value={filters.container_extension || null}
                    onChange={(value) =>
                      setFilters({
                        ...filters,
                        container_extension: value || '',
                      })
                    }
                    w={105}
                  />
                </Group>
                <Group justify="space-between">
                  <Text fw={500}>
                    {preview.count || 0} matching output entries
                  </Text>
                  <Text size="sm" c="dimmed">
                    {filters.type === 'movie'
                      ? counts.movies?.canonical_titles || 0
                      : counts.series?.canonical_titles || 0}{' '}
                    canonical titles in this profile
                  </Text>
                </Group>
                <ScrollArea h="calc(96vh - 390px)">
                  <Table striped highlightOnHover withTableBorder stickyHeader>
                    <TableThead>
                      <TableTr>
                        <TableTh>Title</TableTh>
                        <TableTh>Source</TableTh>
                        <TableTh>Category</TableTh>
                        <TableTh>DUB</TableTh>
                        <TableTh>SUB</TableTh>
                        <TableTh>Resolution</TableTh>
                        <TableTh>Format</TableTh>
                      </TableTr>
                    </TableThead>
                    <TableTbody>
                      {!previewLoading && preview.results?.length === 0 && (
                        <TableTr>
                          <TableTd colSpan={7}>
                            <Text ta="center" c="dimmed" py="lg">
                              No prepared output matches the current filters.
                            </Text>
                          </TableTd>
                        </TableTr>
                      )}
                      {(preview.results || []).map((row) => (
                        <TableTr key={row.id}>
                          <TableTd>
                            {row.name}
                            {row.year ? ` (${row.year})` : ''}
                          </TableTd>
                          <TableTd>
                            {row.m3u_account_name} — {row.source_name}
                          </TableTd>
                          <TableTd>{row.category_name || '—'}</TableTd>
                          <TableTd>
                            {metadataText(row.metadata, 'audio_languages')}
                          </TableTd>
                          <TableTd>
                            {metadataText(row.metadata, 'subtitle_languages')}
                          </TableTd>
                          <TableTd>
                            {row.resolution ? `${row.resolution}p` : '—'}
                          </TableTd>
                          <TableTd>{row.container_extension || '—'}</TableTd>
                        </TableTr>
                      ))}
                    </TableTbody>
                  </Table>
                </ScrollArea>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Page {page} · {preview.results?.length || 0} shown
                  </Text>
                  <Pagination
                    value={page}
                    onChange={setPage}
                    total={Math.max(1, Math.ceil((preview.count || 0) / 50))}
                  />
                </Group>
              </Stack>
            </TabsPanel>
          </Tabs>
        </Stack>
      </Modal>

      <VODUserCategorySelector
        opened={categorySelectorOpen}
        onClose={() => setCategorySelectorOpen(false)}
        categories={categories}
        selectedIds={selectedCategoryIds}
        onChange={(ids) =>
          setDraft((current) => ({
            ...current,
            category_rules: ids.map((category_relation) => ({
              category_relation: Number(category_relation),
              enabled: true,
              priority: 0,
            })),
          }))
        }
      />
    </>
  );
};

export default VODOutputProfilesModal;
