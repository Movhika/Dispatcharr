import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ActionIcon,
  Alert,
  Badge,
  Group,
  Image,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { ExternalLink, Eye, Search, Trash2 } from 'lucide-react';
import API from '../../api';
import LibraryPreviewModal from '../LibraryPreviewModal.jsx';
import ListPagination from '../ListPagination.jsx';
import { formatApiError } from '../../utils';
import { showNotification } from '../../utils/notificationUtils.js';
import { previewItem, tmdbItemUrl } from '../../utils/vodLists';
import {
  DragHandle,
  SortableItem,
  SortableList,
} from './VODProfileRuleEditors.jsx';

const PAGE_SIZE = 50;

function Availability({ item }) {
  if (!item.available)
    return (
      <Tooltip label="Not in the Library; clients do not see it">
        <Badge variant="light" color="gray">
          Not in library
        </Badge>
      </Tooltip>
    );
  return (
    <Badge variant="light" color="green">
      In library
    </Badge>
  );
}

// The titles of a saved list in its order; manual lists are edited here.
export default function VODListTitles({
  list,
  active = true,
  paginationContainer,
  readOnly = false,
  onChanged,
}) {
  const [rows, setRows] = useState(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [available, setAvailable] = useState('');
  const [contentType, setContentType] = useState('');
  const [opened, setOpened] = useState(null);
  const [error, setError] = useState('');
  const manual = list.list_type === 'manual' && !readOnly;
  const load = useCallback(async () => {
    try {
      const result = await API.getVODListItems(list.id, {
        search,
        available,
        content_type: contentType,
        page,
        page_size: PAGE_SIZE,
      });
      setRows(result.results);
      setCount(result.count);
      setError('');
    } catch (err) {
      setError(formatApiError(err));
    }
  }, [list.id, search, available, contentType, page]);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [active, load]);
  const edit = async (action, ids) => {
    try {
      onChanged?.(await API.editVODListItems(list.id, action, { ids }));
      await load();
    } catch (err) {
      showNotification({
        title: 'List not changed',
        message: formatApiError(err),
        color: 'red',
      });
    }
  };
  // Manual order is edited on the unfiltered first page.
  const sortable =
    manual &&
    list.sort_mode === 'list' &&
    !search &&
    !available &&
    !contentType &&
    page === 1;
  const pagination = (
    <ListPagination
      page={page}
      pageSize={PAGE_SIZE}
      total={count}
      onPageChange={setPage}
      itemLabel="Titles"
    />
  );
  const cells = (item, sortableState) => (
    <>
      {sortable && (
        <Table.Td w={36}>
          <DragHandle label={item.title} sortable={sortableState} />
        </Table.Td>
      )}
      <Table.Td w={52}>
        {item.poster_url ? (
          <Image
            src={item.poster_url}
            alt=""
            h={46}
            w={32}
            fit="contain"
            radius="sm"
            style={{ opacity: item.available ? 1 : 0.4 }}
          />
        ) : null}
      </Table.Td>
      <Table.Td>
        <Text size="sm" fw={500} c={item.available ? undefined : 'dimmed'}>
          {item.title}
        </Text>
        <Text size="xs" c="dimmed">
          {item.content_type === 'movie' ? 'Movie' : 'Series'} ·{' '}
          {item.year || '—'}
        </Text>
      </Table.Td>
      <Table.Td>
        <Availability item={item} />
      </Table.Td>
      <Table.Td w={48}>
        {!item.content_id && tmdbItemUrl(item) ? (
          <Tooltip label="Open on TMDB">
            <ActionIcon
              component="a"
              href={tmdbItemUrl(item)}
              target="_blank"
              rel="noopener noreferrer"
              variant="subtle"
              aria-label={`Open ${item.title} on TMDB`}
            >
              <ExternalLink size={16} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <ActionIcon
            variant="subtle"
            aria-label={`Preview ${item.title}`}
            disabled={!item.content_id}
            onClick={() => setOpened(item)}
          >
            <Eye size={16} />
          </ActionIcon>
        )}
      </Table.Td>
      {manual && (
        <Table.Td w={48}>
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={`Remove ${item.title}`}
            onClick={() => edit('remove-items', [item.id])}
          >
            <Trash2 size={16} />
          </ActionIcon>
        </Table.Td>
      )}
    </>
  );
  return (
    <Stack gap="sm" style={{ minHeight: 0 }}>
      <Group gap="xs" wrap="nowrap">
        <TextInput
          aria-label="Search titles"
          placeholder="Search titles…"
          leftSection={<Search size={16} />}
          style={{ flex: 1 }}
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(1);
          }}
        />
        {list.content_type === 'all' && (
          <Select
            aria-label="Type"
            w={170}
            clearable
            placeholder="Movies & Series"
            value={contentType || null}
            data={[
              { value: 'movie', label: 'Movies' },
              { value: 'series', label: 'Series' },
            ]}
            onChange={(value) => {
              setContentType(value || '');
              setPage(1);
            }}
          />
        )}
        {list.list_type === 'tmdb' && (
          <Select
            aria-label="Availability"
            w={200}
            clearable
            placeholder="All titles"
            value={available || null}
            data={[
              { value: 'true', label: 'In the Library' },
              { value: 'false', label: 'Not in the Library' },
            ]}
            onChange={(value) => {
              setAvailable(value || '');
              setPage(1);
            }}
          />
        )}
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      {!rows && !error && <Loader size="sm" aria-label="Loading titles" />}
      {rows && !rows.length && (
        <Text c="dimmed" p="md" ta="center">
          {manual && !search
            ? 'Select titles or sources in the Library and choose Add to list.'
            : 'No titles.'}
        </Text>
      )}
      {rows && rows.length > 0 && (
        <Table verticalSpacing="xs" striped highlightOnHover>
          <Table.Tbody>
            {sortable ? (
              <SortableList
                items={rows}
                onChange={(next) => {
                  setRows(next);
                  edit(
                    'reorder-items',
                    next.map((item) => item.id)
                  );
                }}
              >
                {rows.map((item, index) => (
                  <SortableItem key={item.id} index={index}>
                    {(sortableState) => (
                      <Table.Tr
                        ref={sortableState.setNodeRef}
                        style={sortableState.style}
                      >
                        {cells(item, sortableState)}
                      </Table.Tr>
                    )}
                  </SortableItem>
                ))}
              </SortableList>
            ) : (
              rows.map((item) => (
                <Table.Tr key={item.id}>{cells(item)}</Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      )}
      {active &&
        (paginationContainer
          ? createPortal(pagination, paginationContainer)
          : pagination)}
      {opened && (
        <LibraryPreviewModal
          item={previewItem(opened)}
          inStack
          onClose={() => setOpened(null)}
        />
      )}
    </Stack>
  );
}
