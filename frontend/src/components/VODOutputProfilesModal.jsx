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
import { Eye, Plus, Save, Trash2 } from 'lucide-react';
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
import VODCategoryFilter from './forms/VODCategoryFilter.jsx';
import { resolveProfileCategoryRows } from './forms/VODProfileCategoryRules.utils.js';
import VODFailoverRanking from './VODFailoverRanking.jsx';
import VODSourceRules from './VODSourceRules.jsx';
import VODEditionRules from './VODEditionRules.jsx';
import VODModal from './VODModal.jsx';
import SeriesModal from './SeriesModal.jsx';
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
    category_import_rules: [],
    category_default_actions: {
      movie: 'enable',
      series: 'enable',
    },
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

const hasOwn = (object, key) =>
  Object.prototype.hasOwnProperty.call(object || {}, key);

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
      ? 'Provider data'
      : 'Unknown mode';

const catalogModeLabel = (mode) =>
  mode === 'compact' ? 'Compact' : mode === 'variants' ? 'All' : 'Unknown';

const SOURCES_TAB_HELP =
  'Only categories enabled in the M3U account are available here. Manual Allow/Block choices override ordered import rules. Rule edits take effect after Save and apply; Save profile stores the complete profile and starts one rebuild. New provider categories are evaluated after their VOD refresh completes.';
const CONTENT_RULES_TAB_HELP =
  'Order matters. The first matching filter decides whether a source is included. The expression matches the source title and can be combined with known technical metadata. Unmatched sources remain available.';
const EDITIONS_TAB_HELP =
  "First match wins. Compact creates one client entry per canonical title and suffix. Every split stays in the title's output category, and failover stays inside the matching suffix. Unmatched sources use the canonical title without a suffix.";
const PREVIEW_PAGE_SIZES = [25, 50, 100, 200];
const PREVIEW_PAGE_SIZE_STORAGE_KEY = 'vodOutputProfilePreviewPageSize';

const initialPreviewPageSize = () => {
  const stored = Number(
    window.localStorage.getItem(PREVIEW_PAGE_SIZE_STORAGE_KEY)
  );
  return PREVIEW_PAGE_SIZES.includes(stored) ? stored : 50;
};

const buildPhaseDescription = (progress) => {
  const descriptions = {
    1: 'Movies: applying profile rules and ranking eligible sources',
    2: 'Movies: writing the selected output catalog in database batches',
    3: 'Series: applying profile rules and ranking eligible sources',
    4: 'Series: writing the selected output catalog in database batches',
    5: 'Activating the completed catalog for clients',
  };
  return descriptions[Number(progress?.stage_index)] || progress?.phase || '';
};

const profilePayload = (profile) => ({
  name: profile.name.trim(),
  export_mode: profile.export_mode,
  is_default: profile.is_default,
  is_active: profile.is_active,
  hard_constraints: {
    source_rules: (profile.hard_constraints?.source_rules || []).map(
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
    ...(hasOwn(profile.hard_constraints, 'category_import_rules')
      ? {
          category_import_rules: (
            profile.hard_constraints.category_import_rules || []
          ).map((rule, index) => ({
            id: rule.id,
            scope: rule.scope,
            m3u_account_id: rule.m3u_account_id
              ? Number(rule.m3u_account_id)
              : null,
            match_field: 'group_name',
            regex_pattern: rule.regex_pattern || '',
            action: rule.action === 'enable' ? 'enable' : 'disable',
            case_sensitive: Boolean(rule.case_sensitive),
            enabled: rule.enabled !== false,
            order: index,
          })),
        }
      : {}),
    ...(hasOwn(profile.hard_constraints, 'category_default_actions')
      ? {
          category_default_actions: {
            movie:
              profile.hard_constraints.category_default_actions?.movie ===
              'disable'
                ? 'disable'
                : 'enable',
            series:
              profile.hard_constraints.category_default_actions?.series ===
              'disable'
                ? 'disable'
                : 'enable',
          },
        }
      : {}),
  },
  ranking: normalizeVODFailoverRanking(
    profile.ranking || DEFAULT_VOD_FAILOVER_RANKING
  ),
  provider_order: [...new Set(profile.provider_order || [])]
    .map(Number)
    .filter((providerId) => Number.isInteger(providerId) && providerId > 0),
  edition_rules: (profile.edition_rules || []).map((rule) => ({
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
  naming_mode: 'mode_default',
  name_template: '',
  category_rules: (profile.category_rules || [])
    .map((rule) => ({
      category_relation: Number(rule.category_relation),
      enabled: rule.enabled !== false,
      priority: Number(rule.priority || 0),
    }))
    .filter((rule) => Number.isInteger(rule.category_relation))
    .sort((left, right) => left.category_relation - right.category_relation),
});

const canonicalizeObject = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalizeObject(item)])
  );
};

const profileDraftSignature = (profile) =>
  JSON.stringify(canonicalizeObject(profilePayload(profile)));

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
  const [savedDraftSignature, setSavedDraftSignature] = useState('');
  const [candidateTarget, setCandidateTarget] = useState(null);
  const [candidateData, setCandidateData] = useState(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState('settings');
  const [preview, setPreview] = useState({ count: 0, results: [] });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(
    initialPreviewPageSize
  );
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
    const sourceConstraints = source.hard_constraints || {};
    const nextDraft = {
      ...EMPTY_PROFILE,
      ...source,
      hard_constraints: {
        source_rules: sourceRules,
        ...(hasOwn(sourceConstraints, 'category_import_rules')
          ? {
              category_import_rules:
                sourceConstraints.category_import_rules || [],
            }
          : {}),
        ...(hasOwn(sourceConstraints, 'category_default_actions')
          ? {
              category_default_actions: {
                ...(sourceConstraints.category_default_actions || {}),
              },
            }
          : {}),
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
    };
    setDraft(nextDraft);
    setSavedDraftSignature(profileDraftSignature(nextDraft));
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

  useEffect(() => {
    if (!candidateTarget || !selectedProfile?.id) {
      setCandidateData(null);
      setCandidateError('');
      return;
    }
    let cancelled = false;
    setCandidateData(null);
    setCandidateLoading(true);
    setCandidateError('');
    const previewMode =
      selectedProfile.selection_active_mode ||
      selectedProfile.selection_counts?.export_mode ||
      selectedProfile.export_mode;
    API.getVODAccessPolicyCandidates(selectedProfile.id, {
      type: candidateTarget.content_type || filters.type,
      canonical_id: candidateTarget.canonical_id,
      ...(candidateTarget.relation_id
        ? { current_relation_id: candidateTarget.relation_id }
        : {}),
      ...(previewMode === 'compact' && candidateTarget.edition_key
        ? { edition_key: candidateTarget.edition_key }
        : {}),
    })
      .then((response) => {
        if (!cancelled) setCandidateData(response);
      })
      .catch((error) => {
        if (!cancelled) {
          setCandidateError(
            error?.body?.detail ||
              error?.message ||
              'Could not load profile source information.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCandidateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    candidateTarget,
    filters.type,
    selectedProfile?.export_mode,
    selectedProfile?.id,
    selectedProfile?.selection_active_mode,
    selectedProfile?.selection_counts?.export_mode,
  ]);

  useEffect(() => {
    if (
      draft.export_mode === 'variants' &&
      ['editions', 'failover'].includes(activeTab)
    ) {
      setActiveTab('settings');
    }
  }, [activeTab, draft.export_mode]);

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
  const movieCategoryStates = useMemo(
    () => resolveProfileCategoryRows(categories, draft, 'movie'),
    [categories, draft]
  );
  const seriesCategoryStates = useMemo(
    () => resolveProfileCategoryRows(categories, draft, 'series'),
    [categories, draft]
  );
  const allowedCategoryStates = useMemo(
    () =>
      [...movieCategoryStates, ...seriesCategoryStates].filter(
        (category) => category.enabled
      ),
    [movieCategoryStates, seriesCategoryStates]
  );
  const selectedCategoryIds = allowedCategoryStates.map((category) =>
    String(category.relation_id)
  );

  const updateProfileCategoryStates = (currentRows) => (updater) => {
    const nextRows =
      typeof updater === 'function' ? updater(currentRows) : updater;
    const previousById = new Map(
      currentRows.map((row) => [String(row.relation_id), row])
    );
    const changedById = new Map(
      (nextRows || [])
        .filter((row) => {
          const previous = previousById.get(String(row.relation_id));
          return previous && previous.enabled !== row.enabled;
        })
        .map((row) => [String(row.relation_id), row.enabled])
    );
    if (!changedById.size) return;
    setDraft((current) => {
      const existing = new Map(
        (current.category_rules || []).map((rule) => [
          String(rule.category_relation),
          rule,
        ])
      );
      changedById.forEach((enabled, relationId) => {
        existing.set(relationId, {
          category_relation: Number(relationId),
          enabled,
          priority: 0,
        });
      });
      return { ...current, category_rules: [...existing.values()] };
    });
  };

  const clearProfileCategoryOverrides = (relationIdsToClear) => {
    const cleared = new Set(relationIdsToClear.map(String));
    setDraft((current) => ({
      ...current,
      category_rules: (current.category_rules || []).filter(
        (rule) => !cleared.has(String(rule.category_relation))
      ),
    }));
  };

  const updateProfileCategoryRules = (scope, scopeRules) => {
    setDraft((current) => {
      const constraints = current.hard_constraints || {};
      const otherRules = (constraints.category_import_rules || []).filter(
        (rule) => rule.scope !== scope
      );
      return {
        ...current,
        hard_constraints: {
          ...constraints,
          category_import_rules: [...otherRules, ...scopeRules],
          category_default_actions: {
            movie: constraints.category_default_actions?.movie || 'enable',
            series: constraints.category_default_actions?.series || 'enable',
          },
        },
      };
    });
  };

  const updateProfileCategoryDefault = (scope, action) => {
    setDraft((current) => ({
      ...current,
      hard_constraints: {
        ...current.hard_constraints,
        category_import_rules:
          current.hard_constraints?.category_import_rules || [],
        category_default_actions: {
          movie:
            current.hard_constraints?.category_default_actions?.movie ||
            'enable',
          series:
            current.hard_constraints?.category_default_actions?.series ||
            'enable',
          [scope]: action,
        },
      },
    }));
  };

  const failoverAccountOptions = useMemo(() => {
    const allowedAccountIds = new Set(
      allowedCategoryStates.map((category) => String(category.accountId))
    );
    if (!allowedAccountIds.size) return accountOptions;
    return accountOptions.filter((option) =>
      allowedAccountIds.has(String(option.value))
    );
  }, [accountOptions, allowedCategoryStates]);
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
      const previewMode =
        selectedProfile?.selection_active_mode ||
        selectedProfile?.selection_counts?.export_mode ||
        selectedProfile?.export_mode;
      const applicableFilters =
        previewMode === 'compact'
          ? {
              type: filters.type,
              search: filters.search,
              category: filters.category,
            }
          : filters;
      const params = Object.fromEntries(
        Object.entries({
          ...applicableFilters,
          page,
          page_size: previewPageSize,
        }).filter(([, value]) => value !== '')
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
    previewPageSize,
    selectionAvailable,
    selectedProfile?.id,
    selectedProfile?.selection_active_mode,
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
      const payload = profilePayload(draft);
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
            task_name: 'apps.vod.tasks.rebuild_vod_profile_selection',
            batch: false,
            trigger_reason: 'VOD output profile settings were saved',
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
      if (
        ['pending', 'building'].includes(saved.selection_status) &&
        !saved.selection_progress?.task_id
      ) {
        // A caller-owned outer transaction can make the mutation response
        // arrive with the pre-publication placeholder. The follow-up request
        // runs after the HTTP transaction committed and attaches the real
        // Celery task immediately instead of waiting for the first poll tick.
        await fetchProfiles();
      }
      showNotification({
        title: 'VOD output profile saved',
        message:
          'The catalog update started automatically. No manual rebuild is required; the previous preview remains visible until the update finishes.',
        color: 'green',
      });
    } catch (error) {
      if (profileId && selectedProfile) {
        upsertAccessPolicy(selectedProfile, { force: true });
      }
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

  const draftChanged = profileDraftSignature(draft) !== savedDraftSignature;
  const canSave = Boolean(
    draft.name.trim() && (creating || (selectedProfile && draftChanged))
  );
  const counts = selectedProfile?.selection_counts || {};
  const buildProgress = selectedProfile?.selection_progress || {};
  const selectionUpdating = ['pending', 'building'].includes(
    selectedProfile?.selection_status
  );
  const buildPhase = buildPhaseDescription(buildProgress);
  const buildPercent = (() => {
    const value = Number(buildProgress.percent);
    if (!Number.isFinite(value)) return null;
    return Math.min(Math.max(value, 0), 100);
  })();
  const activeMode =
    selectedProfile?.selection_active_mode ||
    counts.export_mode ||
    (selectedProfile?.selection_current ? selectedProfile.export_mode : '');
  const buildStartedAt =
    selectedProfile?.selection_status === 'pending'
      ? buildProgress.queued_at ||
        selectedProfile.selection_started_at ||
        buildProgress.updated_at
      : selectedProfile?.selection_started_at || buildProgress.updated_at;
  const buildElapsedSeconds = buildStartedAt
    ? Math.max((Date.now() - new Date(buildStartedAt).getTime()) / 1000, 0)
    : 0;
  const lastUpdatedAt =
    counts.completed_at || selectedProfile?.selection_completed_at || '';
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
  const batchWaitingForTurn = Boolean(
    selectedProfile?.selection_status === 'pending' &&
    buildProgress.batch &&
    selectedProfile.selection_task_state === 'STARTED' &&
    !String(buildProgress.phase || '').includes('M3U/VOD refresh')
  );
  const candidateContent = useMemo(
    () =>
      candidateTarget
        ? {
            id: candidateTarget.canonical_id,
            name: candidateTarget.name,
            year: candidateTarget.year,
          }
        : null,
    [candidateTarget]
  );
  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title="VOD output profiles"
        size="70vw"
        yOffset="5vh"
        lockScroll={false}
        styles={{
          content: {
            display: 'flex',
            flexDirection: 'column',
            height: '90vh',
            maxHeight: '90vh',
            minWidth: 0,
            overflow: 'hidden',
          },
          body: {
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
          },
        }}
      >
        <Stack h="100%" gap="sm" style={{ minWidth: 0 }}>
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
              style={{ flex: '0 1 460px', minWidth: 260 }}
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
            <Group gap="sm" wrap="nowrap" style={{ marginLeft: 'auto' }}>
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
                disabled={!canSave}
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
          </Group>

          {selectedProfile && (
            <Group gap="xs" wrap="wrap">
              {selectionAvailable ? (
                <Badge variant="light" color="gray">
                  {catalogModeLabel(activeMode)}
                </Badge>
              ) : (
                <Text size="sm" c="dimmed">
                  No catalog prepared yet
                </Text>
              )}
              {lastUpdatedAt && (
                <Text size="sm" c="dimmed">
                  Last updated: {new Date(lastUpdatedAt).toLocaleString()}
                </Text>
              )}
            </Group>
          )}

          {!selectionUpdating && (
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
          )}

          {selectionUpdating && (
            <Stack gap={3}>
              <Text size="sm" fw={500}>
                {batchWaitingForTurn
                  ? 'VOD profile catalog batch is running; this profile is waiting for its turn'
                  : buildPhase ||
                    (selectedProfile.selection_status === 'pending'
                      ? 'Waiting for worker'
                      : 'Preparing catalog')}
                {buildProgress.batch_position && buildProgress.batch_total
                  ? ` · Profile ${buildProgress.batch_position} of ${buildProgress.batch_total}`
                  : ''}
                {buildPercent !== null
                  ? ` · ${Math.round(buildPercent)}% complete`
                  : ''}
                {` · ${formatDuration(buildElapsedSeconds)} elapsed`}
              </Text>
              {buildPercent !== null && (
                <Progress
                  value={buildPercent}
                  animated={selectedProfile.selection_status === 'building'}
                  aria-label="Catalog preparation progress"
                  size="sm"
                />
              )}
            </Stack>
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
            style={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              minHeight: 0,
              minWidth: 0,
              overflow: 'hidden',
            }}
            styles={{
              list: { flexShrink: 0 },
              panel: {
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                overflow: 'hidden',
              },
            }}
          >
            <TabsList>
              <TabsTab value="settings">Settings</TabsTab>
              <Tooltip
                label={SOURCES_TAB_HELP}
                multiline
                maw={420}
                openDelay={350}
                withArrow
              >
                <TabsTab value="sources">Sources</TabsTab>
              </Tooltip>
              <Tooltip
                label={CONTENT_RULES_TAB_HELP}
                multiline
                maw={420}
                openDelay={350}
                withArrow
              >
                <TabsTab value="content-rules">Content rules</TabsTab>
              </Tooltip>
              {draft.export_mode === 'compact' && (
                <Tooltip
                  label={EDITIONS_TAB_HELP}
                  multiline
                  maw={420}
                  openDelay={350}
                  withArrow
                >
                  <TabsTab value="editions">Editions</TabsTab>
                </Tooltip>
              )}
              {draft.export_mode === 'compact' && (
                <TabsTab value="failover">Failover</TabsTab>
              )}
              <TabsTab value="preview">Content preview</TabsTab>
            </TabsList>

            <TabsPanel value="settings" pt="md">
              <ScrollArea h="100%">
                <Box pb="xs">
                  <Paper withBorder p="lg" radius="md" maw={900} mx="auto">
                    <Stack>
                      <TextInput
                        label="Profile name"
                        required
                        value={draft.name}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            name: event.currentTarget.value,
                          })
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
                            label:
                              'Provider data — every allowed provider source unchanged',
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
                </Box>
              </ScrollArea>
            </TabsPanel>

            <TabsPanel value="sources" pt="md">
              <ScrollArea h="100%">
                <Box pb="xs">
                  <Paper withBorder p="lg" radius="md">
                    <Stack>
                      <Tabs defaultValue="movie">
                        <TabsList>
                          <TabsTab value="movie">VOD - Movies</TabsTab>
                          <TabsTab value="series">VOD - Series</TabsTab>
                        </TabsList>
                        <TabsPanel value="movie">
                          <VODCategoryFilter
                            mode="profile"
                            categoryStates={movieCategoryStates}
                            setCategoryStates={updateProfileCategoryStates(
                              movieCategoryStates
                            )}
                            type="movie"
                            rules={(
                              draft.hard_constraints.category_import_rules || []
                            ).filter((rule) => rule.scope === 'movie')}
                            onRulesChange={(rules) =>
                              updateProfileCategoryRules('movie', rules)
                            }
                            defaultAction={
                              draft.hard_constraints.category_default_actions
                                ?.movie || 'enable'
                            }
                            onDefaultActionChange={(action) =>
                              updateProfileCategoryDefault('movie', action)
                            }
                            accountOptions={accountOptions}
                            onClearOverrides={clearProfileCategoryOverrides}
                          />
                        </TabsPanel>
                        <TabsPanel value="series">
                          <VODCategoryFilter
                            mode="profile"
                            categoryStates={seriesCategoryStates}
                            setCategoryStates={updateProfileCategoryStates(
                              seriesCategoryStates
                            )}
                            type="series"
                            rules={(
                              draft.hard_constraints.category_import_rules || []
                            ).filter((rule) => rule.scope === 'series')}
                            onRulesChange={(rules) =>
                              updateProfileCategoryRules('series', rules)
                            }
                            defaultAction={
                              draft.hard_constraints.category_default_actions
                                ?.series || 'enable'
                            }
                            onDefaultActionChange={(action) =>
                              updateProfileCategoryDefault('series', action)
                            }
                            accountOptions={accountOptions}
                            onClearOverrides={clearProfileCategoryOverrides}
                          />
                        </TabsPanel>
                      </Tabs>
                    </Stack>
                  </Paper>
                </Box>
              </ScrollArea>
            </TabsPanel>

            <TabsPanel value="content-rules" pt="md">
              <ScrollArea h="100%">
                <Box pb="xs">
                  <Paper withBorder p="lg" radius="md">
                    <VODSourceRules
                      value={draft.hard_constraints.source_rules || []}
                      onChange={(value) =>
                        updateConstraint('source_rules', value)
                      }
                      categoryRelationIds={selectedCategoryIds}
                    />
                  </Paper>
                </Box>
              </ScrollArea>
            </TabsPanel>

            {draft.export_mode === 'compact' && (
              <TabsPanel value="failover" pt="md">
                <ScrollArea h="100%">
                  <Box pb="xs">
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
                  </Box>
                </ScrollArea>
              </TabsPanel>
            )}

            <TabsPanel value="editions" pt="md">
              <ScrollArea h="100%">
                <Box pb="xs">
                  {draft.export_mode === 'compact' && (
                    <Paper withBorder p="lg" radius="md">
                      <VODEditionRules
                        value={draft.edition_rules}
                        onChange={(edition_rules) =>
                          setDraft((current) => ({
                            ...current,
                            edition_rules,
                          }))
                        }
                      />
                    </Paper>
                  )}
                </Box>
              </ScrollArea>
            </TabsPanel>

            <TabsPanel value="preview" pt="md">
              <Stack h="100%" style={{ minHeight: 0, overflow: 'hidden' }}>
                {!selectionAvailable && (
                  <Alert color="yellow">
                    This profile has no completed catalog yet. Its content can
                    be previewed as soon as the first preparation finishes.
                  </Alert>
                )}
                {selectionAvailable && !selectedProfile?.selection_current && (
                  <Alert color="blue">
                    The last completed catalog remains available while this
                    profile's recorded background task prepares the saved
                    changes. The preview switches atomically when that task
                    completes. No manual retry is required.
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
                  {activeMode !== 'compact' && (
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
                  )}
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
                  {activeMode !== 'compact' && (
                    <>
                      <LanguageSelect
                        label="DUB"
                        value={filters.audio_language}
                        onChange={(value) => {
                          setFilters({
                            ...filters,
                            audio_language: value,
                          });
                          setPage(1);
                        }}
                        w={160}
                      />
                      <LanguageSelect
                        label="SUB"
                        value={filters.subtitle_language}
                        onChange={(value) => {
                          setFilters({
                            ...filters,
                            subtitle_language: value,
                          });
                          setPage(1);
                        }}
                        w={160}
                      />
                      <Select
                        label="Resolution"
                        clearable
                        data={RESOLUTION_VALUES}
                        value={filters.resolution || null}
                        onChange={(value) => {
                          setFilters({ ...filters, resolution: value || '' });
                          setPage(1);
                        }}
                        w={120}
                      />
                      <Select
                        label="Format"
                        clearable
                        data={CONTAINER_EXTENSION_OPTIONS}
                        value={filters.container_extension || null}
                        onChange={(value) => {
                          setFilters({
                            ...filters,
                            container_extension: value || '',
                          });
                          setPage(1);
                        }}
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
                    </>
                  )}
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
                <ScrollArea style={{ flex: 1, minHeight: 0 }}>
                  <Box pb="xs">
                    <Table
                      striped
                      highlightOnHover
                      withTableBorder
                      stickyHeader
                    >
                      <TableThead>
                        <TableTr>
                          <TableTh>Title</TableTh>
                          <TableTh>
                            {activeMode === 'compact' ? 'Sources' : 'Source'}
                          </TableTh>
                          <TableTh>Category</TableTh>
                          {activeMode !== 'compact' && (
                            <>
                              <TableTh>DUB</TableTh>
                              <TableTh>SUB</TableTh>
                              <TableTh>Resolution</TableTh>
                              <TableTh>Format</TableTh>
                              <TableTh>Features</TableTh>
                            </>
                          )}
                          <TableTh>Details</TableTh>
                        </TableTr>
                      </TableThead>
                      <TableTbody>
                        {!previewLoading && preview.results?.length === 0 && (
                          <TableTr>
                            <TableTd colSpan={activeMode === 'compact' ? 4 : 9}>
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
                              {activeMode === 'compact'
                                ? row.source_count
                                : row.m3u_account_name}
                            </TableTd>
                            <TableTd>{row.category_name || '—'}</TableTd>
                            {activeMode !== 'compact' && (
                              <>
                                <TableTd>
                                  {metadataText(
                                    row.metadata,
                                    'audio_languages'
                                  )}
                                </TableTd>
                                <TableTd>
                                  {metadataText(
                                    row.metadata,
                                    'subtitle_languages'
                                  )}
                                </TableTd>
                                <TableTd>
                                  {row.resolution ? `${row.resolution}p` : '—'}
                                </TableTd>
                                <TableTd>
                                  {row.container_extension || '—'}
                                </TableTd>
                                <TableTd>
                                  {metadataText(row.metadata, 'video_features')}
                                </TableTd>
                              </>
                            )}
                            <TableTd>
                              <Tooltip label="Open title and profile sources">
                                <ActionIcon
                                  variant="subtle"
                                  aria-label={`Open details for ${row.name}`}
                                  onClick={() => setCandidateTarget(row)}
                                >
                                  <Eye size={17} />
                                </ActionIcon>
                              </Tooltip>
                            </TableTd>
                          </TableTr>
                        ))}
                      </TableTbody>
                    </Table>
                  </Box>
                </ScrollArea>
                <Group
                  gap={5}
                  justify="center"
                  wrap="nowrap"
                  style={{ flexShrink: 0, paddingBottom: 2 }}
                >
                  <Text size="xs">Rows</Text>
                  <Select
                    aria-label="Rows"
                    size="xs"
                    value={String(previewPageSize)}
                    data={PREVIEW_PAGE_SIZES.map((value) => ({
                      value: String(value),
                      label: String(value),
                    }))}
                    onChange={(value) => {
                      const nextPageSize = Number(value) || 50;
                      setPreviewPageSize(nextPageSize);
                      setPage(1);
                      window.localStorage.setItem(
                        PREVIEW_PAGE_SIZE_STORAGE_KEY,
                        String(nextPageSize)
                      );
                    }}
                    allowDeselect={false}
                    w={70}
                  />
                  <Pagination
                    value={page}
                    onChange={setPage}
                    total={Math.max(
                      1,
                      Math.ceil((preview.count || 0) / previewPageSize)
                    )}
                    size="xs"
                    withEdges
                  />
                  <Text size="xs" c="dimmed">
                    {preview.count
                      ? `${(page - 1) * previewPageSize + 1}–${Math.min(
                          page * previewPageSize,
                          preview.count
                        )} of ${preview.count}`
                      : '0 of 0'}
                  </Text>
                </Group>
              </Stack>
            </TabsPanel>
          </Tabs>
        </Stack>
      </Modal>

      {candidateTarget?.content_type === 'series' ? (
        <SeriesModal
          series={candidateContent}
          opened
          onClose={() => setCandidateTarget(null)}
          profileCandidates={candidateData}
          profileCandidatesLoading={candidateLoading}
          profileCandidatesError={candidateError}
          onMetadataChanged={loadPreview}
        />
      ) : candidateTarget ? (
        <VODModal
          vod={candidateContent}
          opened
          onClose={() => setCandidateTarget(null)}
          profileCandidates={candidateData}
          profileCandidatesLoading={candidateLoading}
          profileCandidatesError={candidateError}
          onMetadataChanged={loadPreview}
        />
      ) : null}
    </>
  );
};

export default VODOutputProfilesModal;
