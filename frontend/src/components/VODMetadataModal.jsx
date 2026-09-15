import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { Eye, Plus, Trash2 } from 'lucide-react';
import API from '../api';
import { showNotification } from '../utils/notificationUtils';
import VODMetadataSettingsForm from './forms/settings/VODMetadataSettingsForm.jsx';

const normalizeRules = (rules) =>
  (Array.isArray(rules) ? rules : []).map((rule) => {
    const replacement = String(rule?.replacement || '');
    return {
      match_type: ['starts_with', 'contains', 'ends_with', 'regex'].includes(
        rule?.match_type
      )
        ? rule.match_type
        : 'regex',
      value: String(rule?.value ?? rule?.pattern ?? ''),
      action:
        rule?.action === 'remove' || rule?.action === 'replace'
          ? rule.action
          : replacement
            ? 'replace'
            : 'remove',
      replacement,
      enabled: rule?.enabled !== false,
    };
  });

const rulesFingerprint = (rules) => JSON.stringify(normalizeRules(rules));

const quantifierWarning = (rule) =>
  rule.match_type === 'regex' && /(^|[^\\])\+/.test(rule.value)
    ? '“+” repeats the preceding regex token. Use “\\+” to match a literal plus sign.'
    : '';

const MATCH_TYPE_OPTIONS = [
  { value: 'starts_with', label: 'Starts with' },
  { value: 'contains', label: 'Contains' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'regex', label: 'Advanced regex' },
];

const matchPlaceholder = (matchType) => {
  if (matchType === 'starts_with') return 'For example 4K-D+ -';
  if (matchType === 'contains') return 'Text anywhere in the title';
  if (matchType === 'ends_with') return 'Text at the end of the title';
  return 'Regular expression';
};

const VODMetadataModal = ({
  opened,
  onClose,
  initialStatus = null,
  initialTab = 'tmdb',
  selectionContext = null,
  onStatusChange,
  onCatalogChanged,
}) => {
  const [activeTab, setActiveTab] = useState('tmdb');
  const [metadataStatus, setMetadataStatus] = useState(null);
  const [titleRules, setTitleRules] = useState([]);
  const [savedTitleRules, setSavedTitleRules] = useState([]);
  const [previewSearch, setPreviewSearch] = useState('');
  const [titlePreview, setTitlePreview] = useState([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [previewingTitles, setPreviewingTitles] = useState(false);
  const [savingTitleRules, setSavingTitleRules] = useState(false);
  const [titleRuleError, setTitleRuleError] = useState('');
  const [applyingSelection, setApplyingSelection] = useState(false);

  const hydrateStatus = useCallback((status) => {
    setMetadataStatus(status);
    const rules = normalizeRules(status?.settings?.title_rules).map((rule) => ({
      ...rule,
      action: 'remove',
      replacement: '',
    }));
    setTitleRules(rules);
    setSavedTitleRules(rules);
    setTitlePreview([]);
    setTitleRuleError('');
  }, []);

  const loadRules = useCallback(async () => {
    setLoadingRules(true);
    try {
      const status = await API.getVODMetadataStatus(true);
      hydrateStatus(status);
    } catch (error) {
      setMetadataStatus(null);
      setTitleRuleError(
        error?.body?.detail ||
          error?.message ||
          'The title-cleanup rules could not be loaded.'
      );
    } finally {
      setLoadingRules(false);
    }
  }, [hydrateStatus]);

  useEffect(() => {
    if (!opened) return;
    setActiveTab(initialTab);
    if (initialStatus) hydrateStatus(initialStatus);
    else loadRules();
  }, [hydrateStatus, initialStatus, initialTab, loadRules, opened]);

  const titleRulesValid = titleRules.every((rule) => rule.value.trim());
  const titleRulesDirty =
    rulesFingerprint(titleRules) !== rulesFingerprint(savedTitleRules);
  const enabledRuleCount = useMemo(
    () => titleRules.filter((rule) => rule.enabled).length,
    [titleRules]
  );

  const updateTitleRule = (index, patch) => {
    setTitleRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule
      )
    );
    setTitlePreview([]);
    setTitleRuleError('');
  };

  const previewTitleRules = async (rules = titleRules) => {
    if (
      !rules.every((rule) => rule.value.trim())
    ) {
      return;
    }
    setPreviewingTitles(true);
    setTitleRuleError('');
    try {
      const response = await API.previewVODMetadataTitles(
        rules,
        selectionContext && !selectionContext.select_all
          ? selectionContext.selections.slice(0, 100)
          : null,
        previewSearch.trim(),
        selectionContext?.select_all
          ? {
              select_all: true,
              filters: selectionContext.filters,
              exclude_selections: selectionContext.exclude_selections,
            }
          : {}
      );
      setTitlePreview(response.results || []);
    } catch (error) {
      setTitlePreview([]);
      setTitleRuleError(
        error?.body?.title_rules ||
          error?.body?.detail ||
          error?.message ||
          'The title-cleanup preview could not be created.'
      );
    } finally {
      setPreviewingTitles(false);
    }
  };

  const saveTitleRules = async () => {
    if (!titleRulesValid || !titleRulesDirty) return;
    setSavingTitleRules(true);
    setTitleRuleError('');
    try {
      const next = await API.updateVODMetadataSettings({
        title_rules: titleRules,
      });
      const saved = normalizeRules(next?.settings?.title_rules);
      setTitleRules(saved);
      setSavedTitleRules(saved);
      setMetadataStatus(next);
      onStatusChange?.(next);
      await previewTitleRules(saved);
      showNotification({
        title: 'Title cleanup saved',
        message: 'Automatic and manual TMDB searches now use these rules.',
        color: 'green',
      });
    } catch (error) {
      setTitleRuleError(
        error?.body?.title_rules ||
          error?.body?.detail ||
          error?.message ||
          'The title-cleanup rules were not saved.'
      );
    } finally {
      setSavingTitleRules(false);
    }
  };

  const runSelectionAction = async (action, lookupExcluded) => {
    if (!selectionContext) return;
    setApplyingSelection(true);
    setTitleRuleError('');
    try {
      let result;
      if (action === 'enrich') {
        result = await API.refreshVODMetadata([], {
          ...selectionContext,
          force: true,
        });
        showNotification({
          title: 'TMDB enrichment queued',
          message: `${selectionContext.count} selected titles will be processed.`,
          color: 'green',
        });
      } else {
        result = await API.applyVODTitleCleanup(titleRules, {
          ...selectionContext,
          ...(typeof lookupExcluded === 'boolean'
            ? { tmdb_lookup_excluded: lookupExcluded }
            : {}),
        });
        showNotification({
          title:
            typeof lookupExcluded === 'boolean'
              ? lookupExcluded
                ? 'TMDB lookup disabled'
                : 'TMDB lookup enabled'
              : 'Cleanup titles saved',
          message: `${result.updated || 0} canonical titles were updated.`,
          color: 'green',
        });
      }
      onCatalogChanged?.(result);
    } catch (error) {
      setTitleRuleError(
        error?.body?.detail || error?.message || 'The selected action failed.'
      );
    } finally {
      setApplyingSelection(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="VOD metadata"
      size="70vw"
      centered
      styles={{ content: { maxWidth: 1150 } }}
    >
      <Tabs value={activeTab} onChange={setActiveTab}>
        <TabsList>
          <TabsTab value="tmdb">TMDB settings</TabsTab>
          <TabsTab value="cleanup">Title cleanup</TabsTab>
        </TabsList>

        <TabsPanel value="tmdb" pt="md">
          <VODMetadataSettingsForm
            status={metadataStatus}
            loading={!metadataStatus && loadingRules}
            error={!metadataStatus ? titleRuleError : ''}
            onSaved={(next) => {
              hydrateStatus(next);
              onStatusChange?.(next);
            }}
          />
        </TabsPanel>

        <TabsPanel value="cleanup" pt="md">
          <Stack gap="md">
            <Group justify="space-between" align="end" wrap="wrap">
              <TextInput
                label="Preview titles containing"
                placeholder="Optional title search"
                value={previewSearch}
                onChange={(event) => {
                  setPreviewSearch(event.currentTarget.value);
                  setTitlePreview([]);
                }}
                w={300}
              />
              <Group>
                <Button
                  variant="default"
                  size="xs"
                  leftSection={<Plus size={14} />}
                  onClick={() => {
                    setTitleRules((current) => [
                      ...current,
                      {
                        match_type: 'starts_with',
                        value: '',
                        action: 'remove',
                        replacement: '',
                        enabled: true,
                      },
                    ]);
                    setTitlePreview([]);
                    setTitleRuleError('');
                  }}
                >
                  Add rule
                </Button>
                <Button
                  variant="default"
                  size="xs"
                  leftSection={<Eye size={14} />}
                  loading={previewingTitles}
                  disabled={!titleRulesValid || loadingRules}
                  onClick={() => previewTitleRules()}
                >
                  Preview titles
                </Button>
                <Button
                  size="xs"
                  loading={savingTitleRules}
                  disabled={!titleRulesValid || !titleRulesDirty}
                  onClick={saveTitleRules}
                >
                  Save rules
                </Button>
              </Group>
            </Group>

            {selectionContext && (
              <Group justify="space-between" wrap="wrap">
                <Text size="sm" fw={600}>
                  {selectionContext.count} canonical titles selected
                </Text>
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    loading={applyingSelection}
                    disabled={!titleRulesValid}
                    onClick={() => runSelectionAction('cleanup')}
                  >
                    Apply cleanup
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    loading={applyingSelection}
                    onClick={() => runSelectionAction('cleanup', true)}
                  >
                    Exclude from TMDB
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    loading={applyingSelection}
                    onClick={() => runSelectionAction('cleanup', false)}
                  >
                    Allow TMDB lookup
                  </Button>
                  <Button
                    size="xs"
                    loading={applyingSelection}
                    onClick={() => runSelectionAction('enrich')}
                  >
                    Get TMDB data
                  </Button>
                </Group>
              </Group>
            )}

            {!titleRules.length && !loadingRules && (
              <Text size="sm" c="dimmed">
                No title-cleanup rules are configured.
              </Text>
            )}

            {titleRules.map((rule, index) => {
              const warning = quantifierWarning(rule);
              return (
                <Box
                  key={index}
                  p="sm"
                  style={{
                    border: '1px solid var(--mantine-color-dark-4)',
                    borderRadius: 6,
                  }}
                >
                  <Group align="end" wrap="nowrap">
                    <Select
                      label={`Rule ${index + 1} · match`}
                      data={MATCH_TYPE_OPTIONS}
                      value={rule.match_type}
                      allowDeselect={false}
                      onChange={(value) =>
                        updateTitleRule(index, {
                          match_type: value || 'starts_with',
                        })
                      }
                      w={170}
                    />
                    <TextInput
                      label={
                        rule.match_type === 'regex'
                          ? 'Regular expression'
                          : 'Match text'
                      }
                      description={
                        rule.match_type === 'regex'
                          ? 'Advanced: regex metacharacters are active.'
                          : undefined
                      }
                      placeholder={matchPlaceholder(rule.match_type)}
                      value={rule.value}
                      error={!rule.value.trim() ? 'Match text required' : null}
                      onChange={(event) =>
                        updateTitleRule(index, {
                          value: event.currentTarget.value,
                        })
                      }
                      style={{ flex: 2 }}
                    />
                    <Switch
                      aria-label={`Enable title cleanup rule ${index + 1}`}
                      checked={rule.enabled}
                      onChange={(event) =>
                        updateTitleRule(index, {
                          enabled: event.currentTarget.checked,
                        })
                      }
                      mb={8}
                    />
                    <Tooltip label="Delete rule">
                      <ActionIcon
                        aria-label={`Delete title cleanup rule ${index + 1}`}
                        color="red"
                        variant="subtle"
                        mb={4}
                        onClick={() => {
                          setTitleRules((current) =>
                            current.filter(
                              (_, ruleIndex) => ruleIndex !== index
                            )
                          );
                          setTitlePreview([]);
                          setTitleRuleError('');
                        }}
                      >
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  {warning && (
                    <Text size="xs" c="yellow.5" mt={4}>
                      {warning}
                    </Text>
                  )}
                </Box>
              );
            })}

            {titleRuleError && (
              <Text size="sm" c="red">
                {titleRuleError}
              </Text>
            )}

            {titlePreview.length > 0 && (
              <Stack gap={6}>
                <Text size="sm" fw={600}>
                  Ordered preview · {enabledRuleCount} enabled rule
                  {enabledRuleCount === 1 ? '' : 's'}
                </Text>
                <ScrollArea h="min(45vh, 460px)" offsetScrollbars>
                  <Table striped withTableBorder stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Stored title</Table.Th>
                        <Table.Th>TMDB search title</Table.Th>
                        <Table.Th w={85}>Type</Table.Th>
                        <Table.Th w={75}>Year</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {titlePreview.map((row) => (
                        <Table.Tr key={`${row.content_type}:${row.id}`}>
                          <Table.Td>{row.before || '—'}</Table.Td>
                          <Table.Td>
                            <Text c={row.changed ? 'teal.4' : 'dimmed'}>
                              {row.after || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {row.content_type === 'series' ? 'Series' : 'Movie'}
                          </Table.Td>
                          <Table.Td>{row.year || '—'}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Stack>
            )}

          </Stack>
        </TabsPanel>
      </Tabs>
    </Modal>
  );
};

export default VODMetadataModal;
