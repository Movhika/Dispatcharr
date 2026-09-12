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
} from '@mantine/core';
import { Eye, RefreshCw, Search } from 'lucide-react';
import API from '../api';
import { showNotification } from '../utils/notificationUtils';

const statusColor = (value) => {
  if (value === 'matched' || value === 'complete') return 'green';
  if (value === 'failed' || value === 'not_found') return 'red';
  if (value === 'running' || value === 'queued') return 'blue';
  return 'gray';
};

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
  const pageSize = 25;

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await API.getVODMetadataStatus());
    } catch {
      // The shared request layer reports the failed request.
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
    loadStatus();
    loadRows();
  }, [loadRows, loadStatus, opened]);

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
  const rowKey = (row) => `${row.content_type}:${row.id}`;
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(rowKey(row))),
    [rows, selected]
  );
  const allPageSelected =
    rows.length > 0 && selectedRows.length === rows.length;

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
              <Table.Th>Canonical title</Table.Th>
              <Table.Th>TMDB lookup title</Table.Th>
              <Table.Th w={85}>Type</Table.Th>
              <Table.Th w={75}>Year</Table.Th>
              <Table.Th w={135}>TMDB ID</Table.Th>
              <Table.Th w={145}>Metadata</Table.Th>
              <Table.Th w={60}>Details</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
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
                <Table.Td>{row.name}</Table.Td>
                <Table.Td>{row.tmdb_lookup_title || row.name}</Table.Td>
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
            ))}
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
