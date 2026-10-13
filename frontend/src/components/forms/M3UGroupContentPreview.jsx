import { useEffect, useState } from 'react';
import {
  Alert,
  Loader,
  Modal,
  ScrollArea,
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
import API from '../../api.js';
import ListPagination from '../ListPagination.jsx';

const M3UGroupContentPreview = ({ accountId, scope, group, onClose }) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const groupId = group?.channel_group ?? group?.id;

  useEffect(() => {
    setSearch('');
    setPage(1);
    setResult(null);
  }, [groupId]);
  useEffect(() => {
    if (!groupId) return undefined;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        setBusy(true);
        setError(null);
        try {
          const response = await API.getM3UGroupContent(
            accountId,
            scope,
            groupId,
            page,
            pageSize,
            search
          );
          if (!cancelled) setResult(response);
        } catch (error) {
          if (!cancelled)
            setError(error.message || 'Content could not be loaded.');
        } finally {
          if (!cancelled) setBusy(false);
        }
      },
      search ? 250 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accountId, scope, groupId, page, pageSize, search]);

  return (
    <Modal
      opened={!!group}
      onClose={onClose}
      title={`${group?.name || 'Group'} preview`}
      size="min(1100px, 94vw)"
    >
      <Stack>
        <Text size="sm" c="dimmed">
          Currently imported content from this account and group. Disabled or
          ignored content is not imported; use the rule preview to inspect
          import decisions.
        </Text>
        <TextInput
          label="Search"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(1);
          }}
        />
        {error && <Alert color="red">{error}</Alert>}
        {busy && <Loader size="sm" />}
        <Text size="sm">{result?.count || 0} entries</Text>
        <ScrollArea h="55vh">
          <Table striped withTableBorder>
            <TableThead>
              <TableTr>
                <TableTh>Name</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {(result?.results || []).map((row) => (
                <TableTr key={row.relation_id}>
                  <TableTd>{row.name}</TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </ScrollArea>
        <ListPagination
          page={page}
          pageSize={pageSize}
          total={result?.count || 0}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </Stack>
    </Modal>
  );
};

export default M3UGroupContentPreview;
