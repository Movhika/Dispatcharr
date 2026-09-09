import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
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
import { ListOrdered, Plus, Save, Trash2 } from 'lucide-react';
import API from '../api';
import useVODStore from '../store/useVODStore';
import { showNotification } from '../utils/notificationUtils';
import { normalizeLanguageCodes } from '../utils/languageCodes.js';
import {
  CONTAINER_EXTENSION_OPTIONS,
  RESOLUTION_VALUES,
} from '../utils/vodMetadataOptions.js';
import { LanguageSelect } from './LanguagePicker.jsx';
import VideoFeaturePicker from './VideoFeaturePicker.jsx';
import VODUserCategorySelector from './forms/VODUserCategorySelector.jsx';
import VODFailoverRanking from './VODFailoverRanking.jsx';
import VODSourceRules from './VODSourceRules.jsx';
import VODEditionRules from './VODEditionRules.jsx';
import VODCandidateSourcesModal from './VODCandidateSourcesModal.jsx';
import {
  DEFAULT_VOD_FAILOVER_RANKING,
  normalizeVODFailoverRanking,
} from '../utils/vodFailoverRanking.js';

const EMPTY_PROFILE = {
  name: '',
  export_mode: 'compact',
  is_default: false,
  is_active: true,
  hard_constraints: {
    source_rules: [],
  },
  ranking: DEFAULT_VOD_FAILOVER_RANKING,
  provider_order: [],
  edition_rules: [],
  naming_mode: 'mode_default',
  name_template: '',
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

const outputModeLabel = (mode) =>
  mode === 'compact'
    ? 'Compact'
    : mode === 'variants'
      ? 'Variants'
      : 'Unknown mode';

const VODOutputProfilesModal = ({ opened, onClose }) => {
  const categories = useVODStore((state) => state.categories);
  const profiles = useVODStore((state) => state.accessPolicies);
  const fetchCategories = useVODStore((state) => state.fetchCategories);
  const fetchProfiles = useVODStore((state) => state.fetchAccessPolicies);
  const upsertAccessPolicy = useVODStore((state) => state.upsertAccessPolicy);
  const removeAccessPolicy = useVODStore((state) => state.removeAccessPolicy);
  const [profileId, setProfileId] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_PROFILE);
  const [categorySelectorOpen, setCategorySelectorOpen] = useState(false);
  const [candidateTarget, setCandidateTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
    video_feature: '',
  });

  const selectedProfile = profiles.find(
    (profile) => String(profile.id) === String(profileId)
  );
  const selectedProfileId = selectedProfile?.id;
  const selectedSelectionStatus = selectedProfile?.selection_status;
  const defaultReplacementAvailable = profiles.some(
    (profile) =>
      String(profile.id) !== String(selectedProfileId) && profile.is_active
  );
  const canDeleteProfile = Boolean(
    selectedProfile &&
    (!selectedProfile.is_default || defaultReplacementAvailable)
  );
  const deleteProfileHint = selectedProfile?.is_default
    ? defaultReplacementAvailable
      ? 'The next active profile becomes the default automatically.'
      : 'Create or activate another profile before deleting the active default.'
    : 'Delete this VOD output profile.';
  const selectionAvailable =
    selectedProfile?.selection_available ??
    selectedProfile?.selection_current ??
    false;

  const resetDraft = (profile = null) => {
    const source = profile || EMPTY_PROFILE;
    const sourceRules = source.hard_constraints?.source_rules || [];
    setDraft({
      ...EMPTY_PROFILE,
      ...source,
      hard_constraints: {
        source_rules: sourceRules,
      },
      ranking: normalizeVODFailoverRanking(
        source.ranking || EMPTY_PROFILE.ranking
      ),
      provider_order: source.provider_order || [],
      edition_rules: source.edition_rules || [],
      naming_mode: source.naming_mode || 'mode_default',
      name_template:
        source.naming_mode === 'template' ? source.name_template || '' : '',
      category_rules: source.category_rules || [],
    });
  };

  useEffect(() => {
    if (!opened) return;
    Promise.all([fetchCategories(), fetchProfiles()]);
  }, [fetchCategories, fetchProfiles, opened]);

  useEffect(() => {
    if (opened) return;
    setCreating(false);
    setProfileId('');
    setActiveTab('settings');
    setCandidateTarget(null);
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
    let cancelled = false;
    let timer;
    const poll = async () => {
      await fetchProfiles();
      if (!cancelled) timer = window.setTimeout(poll, 2000);
    };
    timer = window.setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fetchProfiles, opened, selectedProfileId, selectedSelectionStatus]);

  const accountOptions = useMemo(
    () =>
      [
        ...new Map(
          Object.values(categories || {}).flatMap((category) =>
            (category.m3u_accounts || [])
              .filter((relation) => relation.enabled !== false)
              .map((relation) => [
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
  const failoverAccountOptions = useMemo(() => {
    const selectedRelations = new Set(
      (draft.category_rules || [])
        .filter((rule) => rule.enabled !== false)
        .map((rule) => String(rule.category_relation))
    );
    if (!selectedRelations.size) return accountOptions;
    const allowedAccountIds = new Set(
      Object.values(categories || {}).flatMap((category) =>
        (category.m3u_accounts || [])
          .filter(
            (relation) =>
              relation.enabled !== false &&
              selectedRelations.has(String(relation.id))
          )
          .map((relation) => String(relation.m3u_account))
      )
    );
    return accountOptions.filter((option) =>
      allowedAccountIds.has(String(option.value))
    );
  }, [accountOptions, categories, draft.category_rules]);
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
          source_rules: (draft.hard_constraints.source_rules || []).map(
            (rule) => ({
              ...rule,
              required_audio_languages: normalizeLanguageCodes(
                rule.required_audio_languages || []
              ),
              required_subtitle_languages: normalizeLanguageCodes(
                rule.required_subtitle_languages || []
              ),
              required_video_features: rule.required_video_features || [],
            })
          ),
        },
        ranking: draft.ranking,
        provider_order: [...new Set(draft.provider_order || [])]
          .map(Number)
          .filter(
            (providerId) => Number.isInteger(providerId) && providerId > 0
          ),
        edition_rules: (draft.edition_rules || []).map((rule) => ({
          id: rule.id,
          name: rule.title_suffix.trim(),
          title_suffix: rule.title_suffix.trim(),
          enabled: rule.enabled !== false,
          min_resolution: Number(rule.min_resolution || 0),
          max_resolution: Number(rule.max_resolution || 0),
          required_audio_languages: normalizeLanguageCodes(
            rule.required_audio_languages || []
          ),
          required_subtitle_languages: normalizeLanguageCodes(
            rule.required_subtitle_languages || []
          ),
          required_video_features: rule.required_video_features || [],
        })),
        naming_mode: draft.name_template.trim() ? 'template' : 'mode_default',
        name_template: draft.name_template.trim(),
        category_rules: relationIds(draft).map((category_relation) => ({
          category_relation: Number(category_relation),
          enabled: true,
          priority: 0,
        })),
      };
      const previousProfile = selectedProfile;
      if (profileId && previousProfile?.is_active) {
        upsertAccessPolicy({
          ...previousProfile,
          ...payload,
          selection_status: 'pending',
          selection_current: false,
          selection_started_at: new Date().toISOString(),
          selection_progress: {
            phase: 'Saving profile and publishing catalog update',
            percent: 0,
            target_export_mode: payload.export_mode,
            queued_at: new Date().toISOString(),
          },
        });
      }
      const saved = profileId
        ? await API.updateVODAccessPolicy(profileId, payload)
        : await API.createVODAccessPolicy(payload);
      upsertAccessPolicy(saved);
      resetDraft(saved);
      setCreating(false);
      setProfileId(String(saved.id));
      showNotification({
        title: 'VOD output profile saved',
        message:
          'The catalog update started automatically. No manual rebuild is required; the previous preview remains visible until the update finishes.',
        color: 'green',
      });
    } catch (error) {
      if (profileId && selectedProfile) upsertAccessPolicy(selectedProfile);
      showNotification({
        title: 'VOD output profile was not saved',
        message: error?.message || 'Please check the values and retry.',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!canDeleteProfile) return;
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
  const activeMode =
    selectedProfile?.selection_active_mode ||
    counts.export_mode ||
    (selectedProfile?.selection_current ? selectedProfile.export_mode : '');
  const targetMode =
    buildProgress.target_export_mode || selectedProfile?.export_mode || '';
  const buildPercent = Math.max(
    0,
    Math.min(Number(buildProgress.percent) || 0, 100)
  );
  const buildStartedAt =
    selectedProfile?.selection_status === 'pending'
      ? buildProgress.queued_at ||
        selectedProfile.selection_started_at ||
        buildProgress.updated_at
      : selectedProfile?.selection_started_at || buildProgress.updated_at;
  const buildElapsedSeconds = buildStartedAt
    ? Math.max((Date.now() - new Date(buildStartedAt).getTime()) / 1000, 0)
    : 0;
  const stageIndex = Math.max(Number(buildProgress.stage_index) || 0, 0);
  const stageCount = Math.max(Number(buildProgress.stage_count) || 5, 1);
  const stagePercent = Math.max(
    0,
    Math.min(Number(buildProgress.stage_percent) || 0, 100)
  );
  const phaseStartedAt = new Date(
    buildProgress.phase_started_at || ''
  ).getTime();
  const phaseElapsedSeconds = Number.isFinite(phaseStartedAt)
    ? Math.max((Date.now() - phaseStartedAt) / 1000, 0)
    : 0;
  const stageRemainingSeconds =
    selectedProfile?.selection_status === 'building' &&
    stagePercent >= 10 &&
    stagePercent < 100 &&
    phaseElapsedSeconds >= 5
      ? (phaseElapsedSeconds / stagePercent) * (100 - stagePercent)
      : null;
  const lastBuildSeconds = (() => {
    const measured = Number(counts.prepared_seconds);
    if (Number.isFinite(measured) && measured >= 0) return measured;
    const started = new Date(
      selectedProfile?.selection_started_at || ''
    ).getTime();
    const completed = new Date(
      selectedProfile?.selection_completed_at || ''
    ).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
    return Math.max((completed - started) / 1000, 0);
  })();
  const typicalBuildSeconds = (() => {
    const durations = profiles
      .map((profile) => {
        const measured = Number(profile.selection_counts?.prepared_seconds);
        if (Number.isFinite(measured) && measured > 0) return measured;
        const started = new Date(profile.selection_started_at || '').getTime();
        const completed = new Date(
          profile.selection_completed_at || ''
        ).getTime();
        return Number.isFinite(started) && Number.isFinite(completed)
          ? Math.max((completed - started) / 1000, 0)
          : null;
      })
      .filter((duration) => duration !== null && duration > 0)
      .sort((left, right) => left - right);
    if (!durations.length) return null;
    return durations[Math.floor(durations.length / 2)];
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
          'The latest XC catalog preparation failed. Correct and save the profile, or wait for the next source change to start a new update.',
      };
    }
    if (['pending', 'building'].includes(selectedProfile.selection_status)) {
      const waiting = selectedProfile.selection_status === 'pending';
      const taskState = selectedProfile.selection_task_state || 'UNKNOWN';
      return {
        label: 'Updating',
        color: 'blue',
        description: waiting
          ? `The update is waiting in the Celery queue (task state: ${taskState}). The current catalog remains active.`
          : 'The updated source selection is being prepared. The current catalog remains active until this finishes.',
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
                <Box h={36} style={{ display: 'flex', alignItems: 'center' }}>
                  <Badge color={selectionState.color} size="lg">
                    {selectionState.label}
                  </Badge>
                </Box>
              </Tooltip>
            )}
            <Button
              variant="default"
              leftSection={<Plus size={15} />}
              onClick={startNew}
            >
              New
            </Button>
            <Button
              leftSection={<Save size={15} />}
              loading={saving}
              disabled={!draft.name.trim()}
              onClick={save}
            >
              Save profile
            </Button>
            <Tooltip label={deleteProfileHint}>
              <Box>
                <Button
                  color="red"
                  variant="light"
                  leftSection={<Trash2 size={15} />}
                  disabled={!canDeleteProfile}
                  loading={deleting}
                  onClick={remove}
                >
                  Delete
                </Button>
              </Box>
            </Tooltip>
          </Group>

          <Group gap="xs" wrap="wrap">
            <Text size="sm" fw={500}>
              {['pending', 'building'].includes(
                selectedProfile?.selection_status
              )
                ? 'Currently active catalog:'
                : 'Active catalog:'}
            </Text>
            {selectionAvailable ? (
              <Badge variant="light" color="gray">
                {outputModeLabel(activeMode)}
              </Badge>
            ) : (
              <Text size="sm" c="dimmed">
                None yet
              </Text>
            )}
            {['pending', 'building'].includes(
              selectedProfile?.selection_status
            ) && (
              <>
                <Text size="sm" c="dimmed">
                  · Building:
                </Text>
                <Badge variant="light" color="blue">
                  {outputModeLabel(targetMode)}
                </Badge>
              </>
            )}
          </Group>

          <Group gap="lg" wrap="wrap">
            <Text size="sm">
              Movies: {counts.movies?.output_entries || 0} output entries ·{' '}
              {counts.movies?.canonical_titles || 0} titles
            </Text>
            <Text size="sm">
              Series: {counts.series?.output_entries || 0} output entries ·{' '}
              {counts.series?.canonical_titles || 0} titles
            </Text>
            <Text size="sm">
              Eligible sources: {counts.eligible_sources || 0} · Unknown
              metadata: {counts.unknown_metadata || 0}
            </Text>
          </Group>

          {['pending', 'building'].includes(
            selectedProfile?.selection_status
          ) && (
            <Stack gap={5}>
              <Group justify="space-between" gap="sm">
                <Text size="sm" fw={500}>
                  {selectedProfile.selection_status === 'building' &&
                    stageIndex > 0 &&
                    `Step ${Math.min(stageIndex, stageCount)} of ${stageCount} · `}
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
                    ? `Waiting for ${formatDuration(buildElapsedSeconds)}${
                        typicalBuildSeconds !== null
                          ? ` · preparation usually about ${formatDuration(typicalBuildSeconds)} after it starts`
                          : ' · an estimate appears when preparation starts'
                      }`
                    : `${Math.round(stagePercent)}% of this step · ${formatDuration(buildElapsedSeconds)} total elapsed${
                        stageRemainingSeconds !== null
                          ? ` · current step about ${formatDuration(stageRemainingSeconds)} remaining`
                          : ''
                      }`}
                </Text>
              </Group>
              {selectedProfile.selection_status === 'pending' && (
                <Text size="xs" c="dimmed">
                  Queue: {buildProgress.queue || 'celery'} · Task:{' '}
                  {buildProgress.task_id || 'not published'} · Backend state:{' '}
                  {selectedProfile.selection_task_state || 'unknown'}. The
                  worker may first finish an M3U or VOD refresh already using
                  the default queue.
                </Text>
              )}
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

          {selectedProfile?.selection_status === 'ready' &&
            lastBuildSeconds !== null && (
              <Text size="sm" c="dimmed">
                Catalog ready · {outputModeLabel(activeMode)} · prepared in{' '}
                {formatDuration(lastBuildSeconds)}
                {counts.completed_at || selectedProfile.selection_completed_at
                  ? ` · completed ${new Date(
                      counts.completed_at ||
                        selectedProfile.selection_completed_at
                    ).toLocaleString()}`
                  : ''}
                .
              </Text>
            )}

          {selectedProfile?.selection_status === 'ready' &&
            selectionAvailable &&
            activeMode &&
            activeMode !== selectedProfile.export_mode && (
              <Alert color="yellow" title="Saved settings are not active">
                The active catalog was built as {outputModeLabel(activeMode)},
                but this profile is saved as{' '}
                {outputModeLabel(selectedProfile.export_mode)}. Save the profile
                once to publish a corrected catalog build.
              </Alert>
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
              <TabsTab value="sources">Sources</TabsTab>
              <TabsTab value="editions">Editions</TabsTab>
              <TabsTab value="failover">Failover</TabsTab>
              <TabsTab value="preview">Content preview</TabsTab>
            </TabsList>

            <TabsPanel value="settings" pt="md">
              <ScrollArea h="calc(96vh - 270px)">
                <Paper withBorder p="lg" radius="md" maw={900} mx="auto">
                  <Stack>
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
                          label:
                            'Compact — one entry per canonical title and suffix',
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
                  </Stack>
                </Paper>
              </ScrollArea>
            </TabsPanel>

            <TabsPanel value="sources" pt="md">
              <ScrollArea h="calc(96vh - 270px)">
                <Stack gap="lg">
                  <Paper withBorder p="lg" radius="md">
                    <Stack>
                      <Group justify="space-between">
                        <Stack gap={0}>
                          <Text fw={700}>Allowed source categories</Text>
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
                    </Stack>
                  </Paper>

                  <Paper withBorder p="lg" radius="md">
                    <VODSourceRules
                      value={draft.hard_constraints.source_rules || []}
                      onChange={(value) =>
                        updateConstraint('source_rules', value)
                      }
                      categoryRelationIds={selectedCategoryIds}
                    />
                  </Paper>
                </Stack>
              </ScrollArea>
            </TabsPanel>

            <TabsPanel value="failover" pt="md">
              <ScrollArea h="calc(96vh - 270px)">
                <Paper withBorder p="lg" radius="md" maw={900} mx="auto">
                  <VODFailoverRanking
                    value={draft.ranking}
                    providerOrder={draft.provider_order}
                    providerOptions={failoverAccountOptions}
                    onChange={(ranking) =>
                      setDraft((current) => ({ ...current, ranking }))
                    }
                    onProviderOrderChange={(providerOrder) =>
                      setDraft((current) => ({
                        ...current,
                        provider_order: providerOrder,
                      }))
                    }
                  />
                </Paper>
              </ScrollArea>
            </TabsPanel>

            <TabsPanel value="editions" pt="md">
              <ScrollArea h="calc(96vh - 270px)">
                <Stack gap="lg">
                  <Paper
                    withBorder
                    p="lg"
                    radius="md"
                    maw={1100}
                    mx="auto"
                    w="100%"
                  >
                    <Stack>
                      <Text fw={700}>Output naming</Text>
                      <Text size="sm" c="dimmed">
                        Without a custom format, Compact uses the canonical
                        title plus its matched suffix; Variants keeps the
                        original provider title.
                      </Text>
                      <TextInput
                        label="Custom output title format (optional)"
                        placeholder={
                          draft.export_mode === 'compact'
                            ? '{canonical} {edition}'
                            : '{source}'
                        }
                        description={
                          draft.export_mode === 'compact'
                            ? 'Compact: {canonical}, {title}, {year}, {edition}'
                            : 'Variants: {canonical}, {title}, {year}, {edition}, {provider}, {source}, {dub}, {sub}, {resolution}, {format}'
                        }
                        value={draft.name_template}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            name_template: event.currentTarget.value,
                          })
                        }
                      />
                    </Stack>
                  </Paper>
                  <Paper withBorder p="lg" radius="md">
                    <VODEditionRules
                      value={draft.edition_rules}
                      onChange={(edition_rules) =>
                        setDraft((current) => ({ ...current, edition_rules }))
                      }
                    />
                  </Paper>
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
                    Your saved rules are not active in this preview yet. It is
                    showing the last completed catalog while the update runs, so
                    newly excluded sources can remain visible temporarily. No
                    manual retry is required.
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
                  <Box w={190}>
                    <VideoFeaturePicker
                      label="Features"
                      emptyLabel="Any"
                      value={
                        filters.video_feature ? [filters.video_feature] : []
                      }
                      onChange={(value) => {
                        setFilters({
                          ...filters,
                          video_feature: value[value.length - 1] || '',
                        });
                        setPage(1);
                      }}
                    />
                  </Box>
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
                        <TableTh>Features</TableTh>
                        {activeMode === 'compact' && <TableTh>Order</TableTh>}
                      </TableTr>
                    </TableThead>
                    <TableTbody>
                      {!previewLoading && preview.results?.length === 0 && (
                        <TableTr>
                          <TableTd colSpan={activeMode === 'compact' ? 9 : 8}>
                            <Text ta="center" c="dimmed" py="lg">
                              No prepared output matches the current filters.
                            </Text>
                          </TableTd>
                        </TableTr>
                      )}
                      {(preview.results || []).map((row) => (
                        <TableTr key={row.id}>
                          <TableTd>{row.name}</TableTd>
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
                          <TableTd>
                            {metadataText(row.metadata, 'video_features')}
                          </TableTd>
                          {activeMode === 'compact' && (
                            <TableTd>
                              <Tooltip label="Show Compact source order">
                                <ActionIcon
                                  variant="subtle"
                                  aria-label={`Show source order for ${row.name}`}
                                  onClick={() => setCandidateTarget(row)}
                                >
                                  <ListOrdered size={17} />
                                </ActionIcon>
                              </Tooltip>
                            </TableTd>
                          )}
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
      <VODCandidateSourcesModal
        opened={Boolean(candidateTarget)}
        onClose={() => setCandidateTarget(null)}
        profileId={selectedProfile?.id}
        contentType={candidateTarget?.content_type || filters.type}
        canonicalId={candidateTarget?.canonical_id}
        currentRelationId={candidateTarget?.relation_id}
        editionKey={candidateTarget?.edition_key}
        title={candidateTarget?.name}
      />
    </>
  );
};

export default VODOutputProfilesModal;
