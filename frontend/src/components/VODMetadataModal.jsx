import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Group,
  Modal,
  ScrollArea,
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
  (Array.isArray(rules) ? rules : []).map((rule) => ({
    pattern: String(rule?.pattern || ''),
    replacement: String(rule?.replacement || ''),
    enabled: rule?.enabled !== false,
  }));

const rulesFingerprint = (rules) => JSON.stringify(normalizeRules(rules));

const quantifierWarning = (pattern) =>
  /(^|[^\\])\+/.test(pattern)
    ? '“+” repeats the preceding regex token. Use “\\+” to match a literal plus sign.'
    : '';

const VODMetadataModal = ({ opened, onClose }) => {
  const [activeTab, setActiveTab] = useState('tmdb');
  const [titleRules, setTitleRules] = useState([]);
  const [savedTitleRules, setSavedTitleRules] = useState([]);
  const [previewSearch, setPreviewSearch] = useState('');
  const [titlePreview, setTitlePreview] = useState([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [previewingTitles, setPreviewingTitles] = useState(false);
  const [savingTitleRules, setSavingTitleRules] = useState(false);
  const [titleRuleError, setTitleRuleError] = useState('');

  const loadRules = useCallback(async () => {
    setLoadingRules(true);
    try {
      const status = await API.getVODMetadataStatus();
      const rules = normalizeRules(status?.settings?.title_rules);
      setTitleRules(rules);
      setSavedTitleRules(rules);
      setTitlePreview([]);
      setTitleRuleError('');
    } catch (error) {
      setTitleRuleError(
        error?.body?.detail ||
          error?.message ||
          'The title-cleanup rules could not be loaded.'
      );
    } finally {
      setLoadingRules(false);
    }
  }, []);

  useEffect(() => {
    if (opened) loadRules();
    else setActiveTab('tmdb');
  }, [loadRules, opened]);

  const titleRulesValid = titleRules.every((rule) => rule.pattern.trim());
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
    if (!rules.every((rule) => rule.pattern.trim())) return;
    setPreviewingTitles(true);
    setTitleRuleError('');
    try {
      const response = await API.previewVODMetadataTitles(
        rules,
        null,
        previewSearch.trim()
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
          <VODMetadataSettingsForm active={opened && activeTab === 'tmdb'} />
        </TabsPanel>

        <TabsPanel value="cleanup" pt="md">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              These ordered regular-expression replacements only prepare the
              search title sent to TMDB. Stored provider and canonical titles
              remain unchanged. No provider prefix is removed automatically; the
              release year is sent to TMDB separately.
            </Text>

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
                      { pattern: '', replacement: '', enabled: true },
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

            {!titleRules.length && !loadingRules && (
              <Text size="sm" c="dimmed">
                No title-cleanup rules are configured.
              </Text>
            )}

            {titleRules.map((rule, index) => {
              const warning = quantifierWarning(rule.pattern);
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
                    <TextInput
                      label={`Rule ${index + 1} · regular expression`}
                      description={
                        index === 0
                          ? 'Use ^ for a prefix. Escape literal regex characters such as + with a backslash.'
                          : undefined
                      }
                      placeholder="For example ^4K-D\\+\\s*-\\s*"
                      value={rule.pattern}
                      error={
                        !rule.pattern.trim() ? 'Expression required' : null
                      }
                      onChange={(event) =>
                        updateTitleRule(index, {
                          pattern: event.currentTarget.value,
                        })
                      }
                      style={{ flex: 2 }}
                    />
                    <TextInput
                      label="Replace with"
                      placeholder="Empty removes the match"
                      value={rule.replacement}
                      onChange={(event) =>
                        updateTitleRule(index, {
                          replacement: event.currentTarget.value,
                        })
                      }
                      style={{ flex: 1 }}
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

            {!previewingTitles &&
              titlePreview.length === 0 &&
              !titleRuleError && (
                <Flex justify="center" py="md">
                  <Text size="sm" c="dimmed">
                    Preview the current rules against a sample of stored VOD
                    titles before saving.
                  </Text>
                </Flex>
              )}
          </Stack>
        </TabsPanel>
      </Tabs>
    </Modal>
  );
};

export default VODMetadataModal;
