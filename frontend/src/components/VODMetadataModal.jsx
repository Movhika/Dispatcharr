import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Group,
  Menu,
  Modal,
  Pagination,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Switch,
} from '@mantine/core';
import {
  Eye,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
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
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [excluded, setExcluded] = useState(new Set());
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
  const [resetMode, setResetMode] = useState('');
  const [resetting, setResetting] = useState(false);
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

  useEffect(() => {
    setSelected(new Set());
    setAllMatchingSelected(false);
    setExcluded(new Set());
  }, [metadataStatus, search, type]);
  useEffect(() => {
    setTitlePreview({});
    setTitleRuleError('');
  }, [page, rows]);
  const rowKey = (row) => `${row.content_type}:${row.id}`;
  const selectionFromKey = (key) => {
    const [contentType, id] = key.split(':');
    return { id: Number(id), content_type: contentType };
  };
  const explicitSelection = useMemo(
    () => Array.from(selected, selectionFromKey),
    [selected]
  );
  const excludedSelection = useMemo(
    () => Array.from(excluded, selectionFromKey),
    [excluded]
  );
  const isRowSelected = (row) =>
    allMatchingSelected
      ? !excluded.has(rowKey(row))
      : selected.has(rowKey(row));
  const allPageSelected =
    rows.length > 0 && rows.every((row) => isRowSelected(row));
  const selectedPageCount = rows.filter((row) => isRowSelected(row)).length;
  const selectedCount = allMatchingSelected
    ? Math.max(0, total - excluded.size)
    : selected.size;
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

  const startRefresh = async () => {
    setRefreshing(true);
    try {
      if (allMatchingSelected) {
        await API.refreshVODMetadata([], {
          select_all: true,
          exclude_selections: excludedSelection,
          filters: {
            type,
            search: search.trim(),
            metadata_status: metadataStatus,
          },
        });
      } else {
        await API.refreshVODMetadata(explicitSelection);
      }
      await loadStatus();
      setSelected(new Set());
      setAllMatchingSelected(false);
      setExcluded(new Set());
      showNotification({
        title: 'TMDB enrichment started',
        message: `${selectedCount} selected canonical titles will be refreshed.`,
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

  const resetSelected = async () => {
    if (!resetMode || allMatchingSelected || explicitSelection.length === 0)
      return;
    setResetting(true);
    try {
      await API.resetVODMetadata(
        resetMode,
        explicitSelection
      );
      setResetMode('');
      setSelected(new Set());
      await loadStatus();
      await loadRows();
      onUpdated?.();
      showNotification({
        title: 'VOD metadata reload started',
        message:
          resetMode === 'provider'
            ? 'Canonical provider metadata was rebuilt from the stored source payloads.'
            : 'The selected TMDB metadata is being fetched again in the background.',
        color: 'green',
      });
    } catch (error) {
      showNotification({
        title: 'VOD metadata could not be reloaded',
        message: error?.body?.detail || error?.message || 'Please retry.',
        color: 'red',
      });
    } finally {
      setResetting(false);
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
              disabled={running || selectedCount === 0}
              loading={refreshing}
              onClick={startRefresh}
            >
              Enrich selected ({selectedCount})
            </Button>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button
                  variant="default"
                  leftSection={<RotateCcw size={16} />}
                  disabled={
                    running ||
                    resetting ||
                    allMatchingSelected ||
                    explicitSelection.length === 0
                  }
                  title={
                    allMatchingSelected
                      ? 'Reload metadata in explicit batches; select-all enrichment is processed separately in the background.'
                      : undefined
                  }
                >
                  Reload selected
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Reload metadata from</Menu.Label>
                <Menu.Item onClick={() => setResetMode('provider')}>
                  Provider sources only
                </Menu.Item>
                <Menu.Item onClick={() => setResetMode('tmdb')}>
                  TMDB
                </Menu.Item>
                <Menu.Item onClick={() => setResetMode('all')}>
                  Provider sources and TMDB
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
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
                No lookup-title rules. Provider prefixes are never removed
                automatically. A trailing release year is sent to TMDB as its
                separate year parameter.
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
            {Object.keys(titlePreview).length > 0 && (
              <Box
                style={{
                  border: '1px solid var(--mantine-color-dark-4)',
                  borderRadius: 6,
                  padding: 8,
                }}
              >
                <Text size="xs" fw={600} mb={6}>
                  Ordered rule preview · current page
                </Text>
                <ScrollArea h={150} offsetScrollbars>
                  <Stack gap={4}>
                    {Object.values(titlePreview).map((row) => (
                      <Flex
                        key={`${row.content_type}:${row.id}`}
                        gap="xs"
                        align="center"
                        wrap="nowrap"
                        style={{ fontFamily: 'monospace' }}
                      >
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{ flex: 1, overflowWrap: 'anywhere' }}
                        >
                          {row.before || '—'}
                        </Text>
                        <Text size="xs" c="gray.6">
                          →
                        </Text>
                        <Text
                          size="xs"
                          c={row.changed ? 'teal.4' : 'dimmed'}
                          style={{ flex: 1, overflowWrap: 'anywhere' }}
                        >
                          {row.after || '—'}
                        </Text>
                      </Flex>
                    ))}
                  </Stack>
                </ScrollArea>
              </Box>
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

        {allPageSelected && total > rows.length && (
          <Group justify="center" gap="xs">
            {allMatchingSelected ? (
              <>
                <Text size="sm">
                  All {selectedCount} matching canonical titles are selected.
                </Text>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  onClick={() => {
                    setAllMatchingSelected(false);
                    setSelected(new Set());
                    setExcluded(new Set());
                  }}
                >
                  Clear selection
                </Button>
              </>
            ) : (
              <>
                <Text size="sm">
                  All {rows.length} titles on this page are selected.
                </Text>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  onClick={() => {
                    setAllMatchingSelected(true);
                    setSelected(new Set());
                    setExcluded(new Set());
                  }}
                >
                  Select all {total} matching titles
                </Button>
              </>
            )}
          </Group>
        )}

        <Table withTableBorder striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={44}>
                <Checkbox
                  aria-label="Select this page"
                  checked={allPageSelected}
                  indeterminate={
                    selectedPageCount > 0 && selectedPageCount < rows.length
                  }
                  onChange={(event) =>
                    event.currentTarget.checked
                      ? allMatchingSelected
                        ? setExcluded((current) => {
                            const next = new Set(current);
                            rows.forEach((row) => next.delete(rowKey(row)));
                            return next;
                          })
                        : setSelected((current) => {
                            const next = new Set(current);
                            rows.forEach((row) => next.add(rowKey(row)));
                            return next;
                          })
                      : allMatchingSelected
                        ? setExcluded((current) => {
                            const next = new Set(current);
                            rows.forEach((row) => next.add(rowKey(row)));
                            return next;
                          })
                        : setSelected((current) => {
                            const next = new Set(current);
                            rows.forEach((row) => next.delete(rowKey(row)));
                            return next;
                          })
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
                      checked={isRowSelected(row)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        if (allMatchingSelected) {
                          setExcluded((current) => {
                            const next = new Set(current);
                            if (checked) next.delete(rowKey(row));
                            else next.add(rowKey(row));
                            return next;
                          });
                        } else {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(rowKey(row));
                            else next.delete(rowKey(row));
                            return next;
                          });
                        }
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
      <Modal
        opened={Boolean(resetMode)}
        onClose={() => !resetting && setResetMode('')}
        title="Reload selected VOD metadata?"
        centered
      >
        <Stack>
          <Text size="sm">
            {resetMode === 'provider' &&
              'Stored TMDB enrichment will be cleared. Canonical metadata will be rebuilt only from the source payloads stored by the last provider VOD refresh. No provider request is made.'}
            {resetMode === 'tmdb' &&
              'Stored TMDB metadata will be cleared and fetched again for the selected canonical titles.'}
            {resetMode === 'all' &&
              'Canonical provider metadata will be rebuilt first. Stored TMDB metadata will then be cleared and fetched again.'}
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={resetting}
              onClick={() => setResetMode('')}
            >
              Cancel
            </Button>
            <Button loading={resetting} onClick={resetSelected}>
              Reload {explicitSelection.length} selected
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
};

export default VODMetadataModal;
