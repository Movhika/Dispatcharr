import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Code,
  Group,
  Pagination,
  ScrollArea,
  SegmentedControl,
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
import { Info, RefreshCw } from 'lucide-react';
import API from '../../api';

const M3UDeveloperCatalog = ({ accountId }) => {
  const [scope, setScope] = useState('live');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ count: 0, results: [] });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      setResult(
        (await API.getM3UDeveloperCatalog(accountId, scope, search, page)) || {
          count: 0,
          results: [],
        }
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, scope, search, page]);

  useEffect(() => {
    setPage(1);
  }, [scope, search]);

  const totalPages = Math.max(1, Math.ceil((result.count || 0) / 100));

  return (
    <Stack pt="md">
      <Alert icon={<Info size={16} />} color="yellow" variant="light">
        This is a read-only view of the catalog stored after the last import.
        Stream URLs may contain credentials.{' '}
        <code>detailed_fetched: false</code>
        means only the provider&apos;s fast catalog row has been stored; opening
        VOD details can fetch the optional detail response. Providers do not
        consistently supply DUB, SUB, or resolution there. The original
        container is retained as <code>container_extension</code>.
      </Alert>
      <Group justify="space-between" align="end">
        <SegmentedControl
          value={scope}
          onChange={setScope}
          data={[
            { value: 'live', label: 'Live' },
            { value: 'movie', label: 'Movies' },
            { value: 'series', label: 'Series' },
          ]}
        />
        <TextInput
          label="Search parsed catalog"
          placeholder="Name or provider ID"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Button
          variant="default"
          leftSection={<RefreshCw size={15} />}
          loading={loading}
          onClick={load}
        >
          Refresh
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        {result.count || 0} parsed entries
      </Text>
      <ScrollArea h="55vh">
        <Table striped highlightOnHover withTableBorder stickyHeader miw={1050}>
          <TableThead>
            <TableTr>
              <TableTh w={90}>Internal ID</TableTh>
              <TableTh w={130}>Provider ID</TableTh>
              <TableTh>Name</TableTh>
              <TableTh>Group / category</TableTh>
              <TableTh>Source URL</TableTh>
              <TableTh>Properties</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {(result.results || []).map((row) => (
              <TableTr key={`${scope}:${row.id}`}>
                <TableTd>{row.id}</TableTd>
                <TableTd>{row.provider_id || '—'}</TableTd>
                <TableTd>{row.name || '—'}</TableTd>
                <TableTd>{row.group || '—'}</TableTd>
                <TableTd>
                  <Code style={{ wordBreak: 'break-all' }}>
                    {row.url || '—'}
                  </Code>
                </TableTd>
                <TableTd>
                  <Code block>
                    {JSON.stringify(row.properties || {}, null, 2)}
                  </Code>
                </TableTd>
              </TableTr>
            ))}
            {!loading && (result.results || []).length === 0 && (
              <TableTr>
                <TableTd colSpan={6}>
                  <Text ta="center" c="dimmed" py="xl">
                    No parsed entries found.
                  </Text>
                </TableTd>
              </TableTr>
            )}
          </TableTbody>
        </Table>
      </ScrollArea>
      {totalPages > 1 && (
        <Pagination value={page} onChange={setPage} total={totalPages} />
      )}
    </Stack>
  );
};

export default M3UDeveloperCatalog;
