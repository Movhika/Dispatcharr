import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Pagination,
  Progress,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Switch,
} from '@mantine/core';
import { Eye, Plus, RefreshCw, Search, Settings2, Trash2 } from 'lucide-react';
import API from '../api';
import { showNotification } from '../utils/notificationUtils';
import VODMetadataSettingsForm from './forms/settings/VODMetadataSettingsForm.jsx';

const statusColor = (value) => {
  if (value === 'matched' || value === 'complete') return 'green';
  if (value === 'failed' || value === 'not_found') return 'red';
  if (value === 'running' || value === 'queued') return 'blue';
  return 'gray';
};

const normalizeRules = (rules) =>
  (Array.isArray(rules) ? rules : []).map((rule) => ({
    pattern: String(rule?.pattern || ''),
    replacement: String(rule?.replacement || ''),
    enabled: rule?.enabled !== false,
  }));

const rulesFingerprint = (rules) => JSON.stringify(normalizeRules(rules));

const VODMetadataModal = ({ opened, onClose, onUpdated, onOpenContent }) => {
  const [status, setStatus] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('all');
  const [metadataStatus, setMetadataStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [editingLookup, setEditingLookup] = useState(false);
  const [titleRules, setTitleRules] = useState([]);
  const [savedTitleRules, setSavedTitleRules] = useState([]);
  const [titlePreview, setTitlePreview] = useState({});
  const [previewingTitles, setPreviewingTitles] = useState(false);
  const [savingTitleRules, setSavingTitleRules] = useState(false);
  const [titleRuleError, setTitleRuleError] = useState('');
  const pageSize = 25;

  const loadStatus = useCallback(async (hydrateTitleRules = false) => {
    try {
      const next = await API.getVODMetadataStatus();
      setStatus(next);
      if (hydrateTitleRules) {
        const rules = normalizeRules(next?.settings?.title_rules);
        setTitleRules(rules);
        setSavedTitleRules(rules);
        setTitlePreview({});
        setTitleRuleError('');
      }
      return next;
    } catch {
      // The shared request layer reports the failed request.
      return null;
    }
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        representation: 'canonical',
        page: String(page),
        page_size: String(pageSize),
        type,
      });
      if (search.trim()) params.set('search', search.trim());
      if (metadataStatus) params.set('metadata_status', metadataStatus);
      const response = await API.getAllContent(params);
      setRows(response.results || []);
      setTotal(response.count || 0);
    } finally {
      setLoading(false);
    }
  }, [metadataStatus, page, search, type]);

  useEffect(() => {
    if (!opened) return;
    loadStatus(true);
  }, [loadStatus, opened]);

  useEffect(() => {
    if (!opened) return;
    loadRows();
  }, [loadRows, opened]);

  const running = ['queued', 'running'].includes(status?.state?.status);
  useEffect(() => {
    if (!opened || !running) return undefined;
    const timer = window.setInterval(async () => {
      const next = await API.getVODMetadataStatus();
      setStatus(next);
      if (!['queued', 'running'].includes(next.state?.status)) {
        await loadRows();
        onUpdated?.();
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [loadRows, onUpdated, opened, running]);

  useEffect(() => setSelected(new Set()), [metadataStatus, page, search, type]);
  useEffect(() => {
    setTitlePreview({});
    setTitleRuleError('');
  }, [page, rows]);
  const rowKey = (row) => `${row.content_type}:${row.id}`;
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(rowKey(row))),
    [rows, selected]
  );
  const allPageSelected =
    rows.length > 0 && selectedRows.length === rows.length;
  const titleRulesValid = titleRules.every((rule) => rule.pattern.trim());
  const titleRulesDirty =
    rulesFingerprint(titleRules) !== rulesFingerprint(savedTitleRules);

  const updateTitleRule = (index, patch) => {
    setTitleRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule
      )
    );
    setTitlePreview({});
    setTitleRuleError('');
  };

  const previewTitleRules = async (rules = titleRules) => {
    if (!rows.length || !rules.every((rule) => rule.pattern.trim())) return;
    setPreviewingTitles(true);
    setTitleRuleError('');
    try {
      const response = await API.previewVODMetadataTitles(
        rules,
        rows.map((row) => ({
          id: row.id,
          content_type: row.content_type,
        }))
      );
      setTitlePreview(
        Object.fromEntries(
          (response.results || []).map((row) => [
            `${row.content_type}:${row.id}`,
            row,
          ])
        )
      );
    } catch (error) {
      setTitlePreview({});
      setTitleRuleError(
        error?.body?.title_rules ||
          error?.body?.detail ||
          error?.message ||
          'The lookup-title preview could not be created.'
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
      setStatus(next);
      const saved = normalizeRules(next?.settings?.title_rules);
      setTitleRules(saved);
      setSavedTitleRules(saved);
      await loadRows();
      await previewTitleRules(saved);
      showNotification({
        title: 'TMDB lookup rules saved',
        message: 'Automatic and manual TMDB searches now use these rules.',
        color: 'green',
      });
    } catch (error) {
      setTitleRuleError(
        error?.body?.title_rules ||
          error?.body?.detail ||
          error?.message ||
          'The lookup rules were not saved.'
      );
    } finally {
      setSavingTitleRules(false);
    }
  };

  const startRefresh = async (selection = []) => {
    setRefreshing(true);
    try {
      await API.refreshVODMetadata(
        selection.map((row) => ({ id: row.id, content_type: row.content_type }))
      );
      await loadStatus();
      showNotification({
        title: 'TMDB enrichment started',
        message: selection.length
          ? `${selection.length} selected canonical titles will be refreshed.`
          : 'New and outdated canonical titles will be processed.',
        color: 'green',
      });
    } catch (error) {
      showNotification({
        title: 'TMDB enrichment was not started',
        message: error?.body?.detail || error?.message || 'Please retry.',
        color: 'red',
      });
    } finally {
      setRefreshing(false);
    }
  };

  const progress = status?.state?.progress || {};
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="VOD metadata"
      size="80vw"
      centered
      styles={{ content: { maxWidth: 1400 } }}
    >
      <Stack gap="md">
        <Group justify="space-between" align="end">
          <Group align="end">
            <SegmentedControl
              value={type}
              onChange={(value) => {
                setType(value);
                setPage(1);
              }}
              data={[
                { value: 'all', label: 'All' },
                { value: 'movies', label: 'Movies' },
                { value: 'series', label: 'Series' },
              ]}
            />
            <TextInput
              label="Canonical title"
              leftSection={<Search size={15} />}
              value={search}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                setPage(1);
              }}
              w={280}
            />
            <Select
              label="Metadata state"
              placeholder="All"
              clearable
              value={metadataStatus || null}
              onChange={(value) => {
                setMetadataStatus(value || '');
                setPage(1);
              }}
              data={[
                { value: 'missing_tmdb', label: 'No TMDB ID' },
                { value: 'missing_external_ids', label: 'No external ID' },
                {
                  value: 'missing_metadata',
                  label: 'TMDB details not enriched',
                },
              ]}
              w={220}
            />
          </Group>
          <Group>
            <Button
              variant={editingSettings ? 'light' : 'default'}
              leftSection={<Settings2 size={16} />}
              onClick={() => {
                setEditingSettings((current) => !current);
                setEditingLookup(false);
              }}
            >
              TMDB settings
            </Button>
            <Button
              variant={editingLookup ? 'light' : 'default'}
              onClick={() => {
                setEditingLookup((current) => !current);
                setEditingSettings(false);
              }}
            >
              Lookup rename
            </Button>
            <Button
              variant="default"
              leftSection={<RefreshCw size={16} />}
              disabled={running || selectedRows.length === 0}
              loading={refreshing}
              onClick={() => startRefresh(selectedRows)}
            >
              Enrich selected ({selectedRows.length})
            </Button>
            <Button
              leftSection={<RefreshCw size={16} />}
              disabled={running}
              loading={refreshing}
              onClick={() => startRefresh()}
            >
              Enrich pending
            </Button>
          </Group>
        </Group>

        {editingSettings && (
          <Stack
            gap="sm"
            p="md"
            style={{ border: '1px solid var(--mantine-color-dark-4)' }}
          >
            <Text fw={600}>TMDB configuration</Text>
            <VODMetadataSettingsForm
              active={opened && editingSettings}
              onSaved={setStatus}
            />
          </Stack>
        )}

        {editingLookup && (
          <Stack
            gap="sm"
            p="md"
            style={{ border: '1px solid var(--mantine-color-dark-4)' }}
          >
            <Group justify="space-between" align="flex-start">
              <div>
                <Text fw={600}>TMDB lookup-title rules</Text>
                <Text size="sm" c="dimmed">
                  The stored provider and canonical titles stay unchanged. The
                  rules clean only the title sent to TMDB, in the displayed
                  order. The table below is the before/after preview for the
                  current page.
                </Text>
              </div>
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
                    setTitlePreview({});
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
                  disabled={!rows.length || !titleRulesValid}
                  onClick={() => previewTitleRules()}
                >
                  Preview current page
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

            {titleRules.length === 0 && (
              <Text size="sm" c="dimmed">
                No custom lookup-title rules. Built-in prefix and release-year
                cleanup still applies.
              </Text>
            )}
            {titleRules.map((rule, index) => (
              <Group key={index} align="end" wrap="nowrap">
                <TextInput
                  label={index === 0 ? 'Regular expression' : undefined}
                  placeholder="For example \\s+Extended Cut$"
                  value={rule.pattern}
                  error={!rule.pattern.trim() ? 'Expression required' : null}
                  onChange={(event) =>
                    updateTitleRule(index, {
                      pattern: event.currentTarget.value,
                    })
                  }
                  style={{ flex: 2 }}
                />
                <TextInput
                  label={index === 0 ? 'Replace with' : undefined}
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
                  aria-label={`Enable lookup title rule ${index + 1}`}
                  checked={rule.enabled}
                  onChange={(event) =>
                    updateTitleRule(index, {
                      enabled: event.currentTarget.checked,
                    })
                  }
                  mb={8}
                />
                <ActionIcon
                  aria-label={`Delete lookup title rule ${index + 1}`}
                  color="red"
                  variant="subtle"
                  mb={4}
                  onClick={() => {
                    setTitleRules((current) =>
                      current.filter((_, ruleIndex) => ruleIndex !== index)
                    );
                    setTitlePreview({});
                    setTitleRuleError('');
                  }}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>
            ))}
            {titleRuleError && (
              <Text size="sm" c="red">
                {titleRuleError}
              </Text>
            )}
          </Stack>
        )}

        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {total} canonical titles · matched movies{' '}
            {status?.catalog?.enriched_movies || 0}/
            {status?.catalog?.movies || 0}
            {' · '}series {status?.catalog?.enriched_series || 0}/
            {status?.catalog?.series || 0}
          </Text>
          <Badge color={statusColor(status?.state?.status)}>
            {String(status?.state?.status || 'idle').toUpperCase()}
          </Badge>
        </Group>

        {running && (
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="sm">
                {progress.phase || 'Preparing TMDB metadata'}
              </Text>
              <Text size="sm" c="dimmed">
                {progress.processed || 0}/{progress.total || 0}
              </Text>
            </Group>
            <Progress value={Number(progress.percent) || 0} animated />
          </Stack>
        )}

        <Table withTableBorder striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={44}>
                <Checkbox
                  aria-label="Select this page"
                  checked={allPageSelected}
                  indeterminate={
                    selectedRows.length > 0 && selectedRows.length < rows.length
                  }
                  onChange={(event) =>
                    setSelected(
                      event.currentTarget.checked
                        ? new Set(rows.map(rowKey))
                        : new Set()
                    )
                  }
                />
              </Table.Th>
              <Table.Th>
                {editingLookup ? 'Before: canonical title' : 'Canonical title'}
              </Table.Th>
              <Table.Th>
                {editingLookup
                  ? 'After: TMDB lookup title'
                  : 'TMDB lookup title'}
              </Table.Th>
              <Table.Th w={85}>Type</Table.Th>
              <Table.Th w={75}>Year</Table.Th>
              <Table.Th w={135}>TMDB ID</Table.Th>
              <Table.Th w={145}>Metadata</Table.Th>
              <Table.Th w={60}>Details</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
              const previewRow = titlePreview[rowKey(row)];
              return (
                <Table.Tr key={rowKey(row)}>
                  <Table.Td>
                    <Checkbox
                      aria-label={`Select ${row.name}`}
                      checked={selected.has(rowKey(row))}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(rowKey(row));
                          else next.delete(rowKey(row));
                          return next;
                        });
                      }}
                    />
                  </Table.Td>
                  <Table.Td>
                    {previewRow ? previewRow.before || '—' : row.name}
                  </Table.Td>
                  <Table.Td>
                    {previewRow
                      ? previewRow.after || '—'
                      : row.tmdb_lookup_title || row.name}
                  </Table.Td>
                  <Table.Td>
                    {row.content_type === 'series' ? 'Series' : 'Movie'}
                  </Table.Td>
                  <Table.Td>{row.year || '—'}</Table.Td>
                  <Table.Td>{row.tmdb_id || '—'}</Table.Td>
                  <Table.Td>
                    <Badge color={statusColor(row.tmdb_status)} variant="light">
                      {row.tmdb_status === 'matched'
                        ? 'Enriched'
                        : row.tmdb_status || 'Not enriched'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      aria-label={`Details ${row.name}`}
                      variant="subtle"
                      onClick={() => {
                        onClose();
                        onOpenContent?.(row);
                      }}
                    >
                      <Eye size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        {!loading && rows.length === 0 && (
          <Text c="dimmed" ta="center" py="lg">
            No canonical titles match these filters.
          </Text>
        )}
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {total
              ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
              : '0 of 0'}
          </Text>
          <Pagination
            value={page}
            onChange={setPage}
            total={Math.max(1, Math.ceil(total / pageSize))}
            size="sm"
            withEdges
          />
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default VODMetadataModal;
