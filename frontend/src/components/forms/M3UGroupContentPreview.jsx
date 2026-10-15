import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
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
import { Info, Search } from 'lucide-react';
import API from '../../api.js';
import ListPagination from '../ListPagination.jsx';
import {
  hideNotification,
  showNotification,
} from '../../utils/notificationUtils.js';
import editorClasses from './AccountEditor.module.css';

const M3UGroupContentPreview = ({ accountId, scope, group, onClose }) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const groupId = group?.channel_group ?? group?.id;
  const notificationId = `category-content-${accountId}-${scope}-${groupId}`;

  useEffect(() => {
    setSearch('');
    setPage(1);
    setResult(null);
    setError(null);
  }, [accountId, scope, groupId]);
  useEffect(() => {
    if (!groupId) return undefined;
    let cancelled = false;
    setBusy(true);
    setError(null);
    hideNotification(notificationId);
    const timer = setTimeout(
      async () => {
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
          if (!cancelled) {
            const message = error.message || 'Content could not be loaded.';
            setError(message);
            showNotification({
              id: notificationId,
              title: 'Category preview unavailable',
              message,
              color: 'red',
              autoClose: false,
            });
          }
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
  }, [
    accountId,
    scope,
    groupId,
    page,
    pageSize,
    search,
    reload,
    notificationId,
  ]);

  useEffect(() => () => hideNotification(notificationId), [notificationId]);

  return (
    <Modal
      opened={!!group}
      onClose={onClose}
      title={`${group?.name || 'Category'} preview`}
      size="60vw"
      yOffset="2vh"
      closeButtonProps={{ 'aria-label': 'Close category preview' }}
      classNames={{
        content: `${editorClasses.content} ${editorClasses.previewContent}`,
        body: editorClasses.body,
        header: editorClasses.header,
      }}
    >
      <Stack className={editorClasses.previewStack} gap="sm">
        <Alert
          color="blue"
          icon={<Info size={16} />}
          p="xs"
          style={{ flexShrink: 0 }}
        >
          Imported content from this account and category.
        </Alert>
        <TextInput
          label="Search"
          leftSection={<Search size={16} />}
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(1);
          }}
        />
        <Text
          size="sm"
          fw={600}
          c={error ? 'red' : busy || !result ? 'dimmed' : undefined}
          role="status"
        >
          {error
            ? 'Content could not be loaded.'
            : busy || !result
              ? 'Loading imported content…'
              : `${result.count} imported entries`}
        </Text>
        {error ? (
          <Button
            variant="default"
            onClick={() => setReload((value) => value + 1)}
            disabled={busy}
            style={{ alignSelf: 'flex-start' }}
          >
            Retry
          </Button>
        ) : (
          result && (
            <div className={editorClasses.categoryTableFrame} aria-busy={busy}>
              <ScrollArea h="100%" type="auto">
                <Table
                  striped
                  stickyHeader
                  stickyHeaderOffset={0}
                  className={editorClasses.categoryTable}
                  style={{ overflowWrap: 'anywhere' }}
                >
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
                    {!result.results?.length && (
                      <TableTr>
                        <TableTd c="dimmed" ta="center" py="xl">
                          {search
                            ? 'No imported entries match this search.'
                            : 'No imported entries in this category.'}
                        </TableTd>
                      </TableTr>
                    )}
                  </TableTbody>
                </Table>
              </ScrollArea>
            </div>
          )
        )}
        {result && !error && (
          <div className={editorClasses.categoryFooter}>
            <div className={editorClasses.paginationSlot}>
              <ListPagination
                page={page}
                pageSize={pageSize}
                total={result?.count || 0}
                disabled={busy}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            </div>
          </div>
        )}
      </Stack>
    </Modal>
  );
};

export default M3UGroupContentPreview;
