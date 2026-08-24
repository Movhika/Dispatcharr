import React, { useCallback, useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
} from '@mantine/core';
import { Play, Plus, Save, Trash2 } from 'lucide-react';
import API from '../../api';
import { showNotification } from '../../utils/notificationUtils';
import { normalizeLanguageCodes } from '../../utils/languageCodes.js';
import LanguagePicker from '../LanguagePicker.jsx';
import { RESOLUTION_VALUES } from '../../utils/vodMetadataOptions.js';

const M3UGroupRules = ({ accountId, scope }) => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewRule, setPreviewRule] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      setRules((await API.getM3UGroupRules(accountId, scope)) || []);
    } finally {
      setLoading(false);
    }
  }, [accountId, scope]);

  useEffect(() => {
    load();
  }, [load]);

  const updateLocal = (id, values) => {
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...values } : rule))
    );
  };

  const addRule = async () => {
    const created = await API.createM3UGroupRule(accountId, {
      scope,
      match_field: 'group_name',
      match_mode: 'any',
      regex_pattern: '.*',
      exclude_regex_pattern: '',
      action: 'disable',
      case_sensitive: false,
      enabled: true,
      order: rules.length * 10,
      metadata_defaults: {},
    });
    setRules((current) => [...current, created]);
  };

  const rulePayload = (rule) => {
    const metadataDefaults = {
      ...(rule.metadata_defaults || {}),
      audio_languages: normalizeLanguageCodes(
        rule.metadata_defaults?.audio_languages || []
      ),
      subtitle_languages: normalizeLanguageCodes(
        rule.metadata_defaults?.subtitle_languages || []
      ),
    };
    return {
      scope,
      match_field: rule.match_field,
      match_mode: rule.match_mode,
      regex_pattern: rule.regex_pattern,
      exclude_regex_pattern: rule.exclude_regex_pattern || '',
      action: rule.action,
      case_sensitive: rule.case_sensitive,
      enabled: rule.enabled,
      order: rule.order,
      metadata_defaults: scope === 'live' ? {} : metadataDefaults,
    };
  };

  const saveRule = async (rule, notify = true) => {
    const payload = rulePayload(rule);
    if (!payload) return null;
    const saved = await API.updateM3UGroupRule(accountId, rule.id, payload);
    updateLocal(rule.id, saved);
    if (notify) {
      showNotification({
        title: 'Import rule saved',
        message: 'The rule applies automatically during future scans.',
        color: 'green',
      });
    }
    return saved;
  };

  const openPreview = async (rule) => {
    const payload = rulePayload(rule);
    if (!payload) return;
    setPreviewRule(rule);
    setPreviewLoading(true);
    try {
      setPreview(await API.previewM3UGroupRule(accountId, rule.id, payload));
    } finally {
      setPreviewLoading(false);
    }
  };

  const applyPreview = async () => {
    if (!previewRule) return;
    setPreviewLoading(true);
    try {
      const saved = await saveRule(previewRule, false);
      if (!saved) return;
      const result = await API.applyM3UGroupRule(accountId, saved.id);
      showNotification({
        title: 'Import rule applied',
        message: `${result.updated || 0} existing entries were updated.`,
        color: 'green',
      });
      setPreview(null);
      setPreviewRule(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const updateMetadata = (rule, field, value) => {
    updateLocal(rule.id, {
      metadata_defaults: {
        ...(rule.metadata_defaults || {}),
        [field]: value,
      },
    });
  };

  const deleteRule = async (id) => {
    await API.deleteM3UGroupRule(accountId, id);
    setRules((current) => current.filter((rule) => rule.id !== id));
  };

  return (
    <Stack gap="xs" mt="md">
      <Group justify="space-between">
        <div>
          <Text fw={600} size="sm">
            Import rules
          </Text>
          <Text c="dimmed" size="xs">
            First matching rule wins. The exclusion expression vetoes a match.
            Existing choices and learned or manual metadata are not changed
            unless you preview and explicitly apply a rule.
          </Text>
        </div>
        <Button
          size="xs"
          variant="default"
          leftSection={<Plus size={14} />}
          onClick={addRule}
          loading={loading}
        >
          Add rule
        </Button>
      </Group>

      {rules.length === 0 ? (
        <Alert color="gray" variant="light">
          No rule configured. New unmatched groups are imported inactive.
        </Alert>
      ) : (
        <ScrollArea type="auto">
          <Table
            striped
            withTableBorder
            miw={scope === 'live' ? 1150 : 1650}
            verticalSpacing="xs"
          >
            <TableThead>
              <TableTr>
                <TableTh w={70}>Order</TableTh>
                <TableTh w={145}>Match</TableTh>
                <TableTh>Regular expression</TableTh>
                <TableTh>Exclude expression</TableTh>
                <TableTh w={120}>Item mode</TableTh>
                <TableTh w={145}>Result</TableTh>
                {scope !== 'live' && <TableTh w={175}>DUB</TableTh>}
                {scope !== 'live' && <TableTh w={175}>SUB</TableTh>}
                {scope !== 'live' && <TableTh w={120}>Resolution</TableTh>}
                <TableTh w={75}>Case</TableTh>
                <TableTh w={75}>Active</TableTh>
                <TableTh w={80}>Actions</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {rules.map((rule) => (
                <TableTr key={rule.id}>
                  <TableTd>
                    <NumberInput
                      size="xs"
                      min={0}
                      value={rule.order}
                      onChange={(value) =>
                        updateLocal(rule.id, { order: value })
                      }
                    />
                  </TableTd>
                  <TableTd>
                    <Select
                      size="xs"
                      value={rule.match_field}
                      data={[
                        { value: 'group_name', label: 'Group name' },
                        { value: 'item_name', label: 'Contained item' },
                      ]}
                      onChange={(value) =>
                        updateLocal(rule.id, { match_field: value })
                      }
                    />
                  </TableTd>
                  <TableTd>
                    <TextInput
                      size="xs"
                      aria-label="Include regular expression"
                      value={rule.regex_pattern}
                      onChange={(event) =>
                        updateLocal(rule.id, {
                          regex_pattern: event.currentTarget.value,
                        })
                      }
                    />
                  </TableTd>
                  <TableTd>
                    <TextInput
                      size="xs"
                      aria-label="Exclude regular expression"
                      placeholder="Optional NOT regex"
                      value={rule.exclude_regex_pattern || ''}
                      onChange={(event) =>
                        updateLocal(rule.id, {
                          exclude_regex_pattern: event.currentTarget.value,
                        })
                      }
                    />
                  </TableTd>
                  <TableTd>
                    <Select
                      size="xs"
                      disabled={rule.match_field !== 'item_name'}
                      value={rule.match_mode}
                      data={[
                        { value: 'any', label: 'Any item' },
                        { value: 'all', label: 'All items' },
                      ]}
                      onChange={(value) =>
                        updateLocal(rule.id, { match_mode: value })
                      }
                    />
                  </TableTd>
                  <TableTd>
                    <Select
                      size="xs"
                      value={rule.action}
                      data={[
                        { value: 'enable', label: 'Import enabled' },
                        { value: 'disable', label: 'Import disabled' },
                        { value: 'ignore', label: 'Ignore group' },
                      ]}
                      onChange={(value) =>
                        updateLocal(rule.id, { action: value })
                      }
                    />
                  </TableTd>
                  {scope !== 'live' && (
                    <TableTd>
                      <LanguagePicker
                        size="xs"
                        value={rule.metadata_defaults?.audio_languages || []}
                        onChange={(value) =>
                          updateMetadata(
                            rule,
                            'audio_languages',
                            normalizeLanguageCodes(value)
                          )
                        }
                      />
                    </TableTd>
                  )}
                  {scope !== 'live' && (
                    <TableTd>
                      <LanguagePicker
                        size="xs"
                        value={rule.metadata_defaults?.subtitle_languages || []}
                        onChange={(value) =>
                          updateMetadata(
                            rule,
                            'subtitle_languages',
                            normalizeLanguageCodes(value)
                          )
                        }
                      />
                    </TableTd>
                  )}
                  {scope !== 'live' && (
                    <TableTd>
                      <Select
                        size="xs"
                        clearable
                        data={RESOLUTION_VALUES}
                        value={rule.metadata_defaults?.resolution || null}
                        onChange={(value) =>
                          updateMetadata(rule, 'resolution', value || '')
                        }
                      />
                    </TableTd>
                  )}
                  <TableTd>
                    <Checkbox
                      aria-label="Case sensitive"
                      checked={rule.case_sensitive}
                      onChange={(event) =>
                        updateLocal(rule.id, {
                          case_sensitive: event.currentTarget.checked,
                        })
                      }
                    />
                  </TableTd>
                  <TableTd>
                    <Checkbox
                      aria-label="Rule active"
                      checked={rule.enabled}
                      onChange={(event) =>
                        updateLocal(rule.id, {
                          enabled: event.currentTarget.checked,
                        })
                      }
                    />
                  </TableTd>
                  <TableTd>
                    <Group gap={4} wrap="nowrap">
                      <ActionIcon
                        aria-label="Save rule"
                        color="blue"
                        variant="subtle"
                        onClick={() => saveRule(rule)}
                      >
                        <Save size={15} />
                      </ActionIcon>
                      <ActionIcon
                        aria-label="Preview and apply rule"
                        color="green"
                        variant="subtle"
                        onClick={() => openPreview(rule)}
                      >
                        <Play size={15} />
                      </ActionIcon>
                      <ActionIcon
                        aria-label="Delete rule"
                        color="red"
                        variant="subtle"
                        onClick={() => deleteRule(rule.id)}
                      >
                        <Trash2 size={15} />
                      </ActionIcon>
                    </Group>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </ScrollArea>
      )}

      <Modal
        opened={!!previewRule}
        onClose={() => {
          setPreviewRule(null);
          setPreview(null);
        }}
        title="Import rule preview"
        size="xl"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            This preview evaluates the complete ordered rule set. Only rows for
            which this rule is the first match are shown.
          </Text>
          <Text fw={600}>
            {previewLoading
              ? 'Evaluating…'
              : `${preview?.count || 0} matching existing entries`}
          </Text>
          <ScrollArea h="45vh">
            <Table striped withTableBorder stickyHeader>
              <TableThead>
                <TableTr>
                  <TableTh>Name</TableTh>
                  <TableTh w={90}>Current</TableTh>
                  <TableTh w={110}>Result</TableTh>
                  <TableTh w={90}>Items</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {(preview?.results || []).map((row) => (
                  <TableTr key={row.relation_id}>
                    <TableTd>{row.name}</TableTd>
                    <TableTd>
                      {row.currently_enabled ? 'Active' : 'Inactive'}
                    </TableTd>
                    <TableTd>
                      {row.would_enable === null
                        ? 'No change'
                        : row.would_enable
                          ? 'Active'
                          : 'Inactive'}
                    </TableTd>
                    <TableTd>{row.item_count}</TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </ScrollArea>
          {preview?.truncated && (
            <Text size="xs" c="dimmed">
              Showing the first 200 matches.
            </Text>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setPreviewRule(null);
                setPreview(null);
              }}
            >
              Close
            </Button>
            <Button
              loading={previewLoading}
              disabled={!preview?.count || previewRule?.action === 'ignore'}
              onClick={applyPreview}
            >
              Save and apply to existing
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default M3UGroupRules;
