import React, { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Flex,
  Group,
  Indicator,
  Modal,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { Ban, Eye, Filter, Undo2 } from 'lucide-react';
import API from '../../api';
import LibraryPreviewModal from '../LibraryPreviewModal.jsx';
import ListPagination from '../ListPagination.jsx';
import StackedModal from '../StackedModal.jsx';
import { formatApiError } from '../../utils';
import { showNotification } from '../../utils/notificationUtils.js';
import editorClasses from './AccountEditor.module.css';

const EMPTY_PREVIEW_FILTERS = {
  contentType: 'movie',
  excluded: false,
  account: null,
  category: null,
  edition: null,
};

// Select values cannot be empty; "" asks for entries without edition.
const NO_EDITION = '__none__';

const titleName = (row) => `${row.title}${row.year ? ` (${row.year})` : ''}`;

// Built like the category filter of the account dialogs. Categories and
// accounts are the ones the profile offers, as the preview reports them.
function PreviewFilters({
  value,
  onChange,
  categories = [],
  accounts = [],
  editions = [],
  onOpenChange,
}) {
  const active = !!(
    value.excluded ||
    value.account ||
    value.category ||
    value.edition !== null
  );
  const update = (patch) => onChange({ ...value, ...patch });
  return (
    <Popover
      position="bottom-end"
      withArrow
      trapFocus
      returnFocus
      onOpen={() => onOpenChange?.(true)}
      onClose={() => onOpenChange?.(false)}
    >
      <Indicator
        inline
        color="red"
        size={10}
        offset={1}
        withBorder
        disabled={!active}
        zIndex={1}
      >
        <Popover.Target>
          <Tooltip label={active ? 'Title filter active' : 'Filter titles'}>
            <ActionIcon
              size="input-xs"
              variant={active ? 'light' : 'default'}
              aria-label="Filter titles"
            >
              <Filter size={16} aria-hidden="true" />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
      </Indicator>
      <Popover.Dropdown data-mantine-stop-propagation="true">
        <Stack gap="xs" w={260}>
          <Text size="sm" fw={600}>
            Show titles
          </Text>
          <SegmentedControl
            size="xs"
            fullWidth
            aria-label="Preview content"
            value={value.contentType}
            onChange={(contentType) => update({ contentType, category: null })}
            data={[
              { value: 'movie', label: 'Movies' },
              { value: 'series', label: 'Series' },
            ]}
          />
          <Select
            size="xs"
            label="Excluded"
            value={value.excluded ? 'yes' : 'no'}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
            onChange={(excluded) => update({ excluded: excluded === 'yes' })}
            data={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
            ]}
          />
          <Select
            size="xs"
            label="M3U account"
            placeholder="Any"
            clearable
            value={value.account}
            comboboxProps={{ withinPortal: false }}
            onChange={(account) => update({ account, category: null })}
            data={accounts.map((account) => ({
              value: String(account.value),
              label: account.label,
            }))}
          />
          <Select
            size="xs"
            label="Category"
            placeholder="Any"
            clearable
            searchable
            value={value.category}
            comboboxProps={{ withinPortal: false }}
            onChange={(category) => update({ category })}
            data={categories.map((category) => ({
              value: String(category.value),
              label: category.label,
            }))}
          />
          {editions.length > 0 && (
            <Select
              size="xs"
              label="Edition"
              placeholder="Any"
              clearable
              value={value.edition === '' ? NO_EDITION : value.edition}
              comboboxProps={{ withinPortal: false }}
              onChange={(edition) =>
                update({ edition: edition === NO_EDITION ? '' : edition })
              }
              data={[
                { value: NO_EDITION, label: 'Without edition' },
                ...editions.map((edition) => ({
                  value: edition,
                  label: edition,
                })),
              ]}
            />
          )}
          <Button
            size="compact-xs"
            variant="subtle"
            data-mantine-stop-propagation="true"
            onClick={() =>
              onChange({
                ...EMPTY_PREVIEW_FILTERS,
                contentType: value.contentType,
              })
            }
          >
            Reset filters
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

// The titles of the built catalogue, as clients receive them. Excluding a
// title saves the profile right away, like the import rules.
function PreviewTable({ profile, onSaved, onFiltersOpen }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_PREVIEW_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const { contentType } = filters;
  const shownEdition = filters.excluded ? null : filters.edition;
  // The Edition filter offers the saved names; Sources entries have none.
  const editionNames =
    profile.output_mode === 'variants'
      ? []
      : (profile.edition_rules || [])
          .map((rule) => rule.title_suffix?.trim())
          .filter(Boolean);
  const excludedTitles = JSON.stringify(profile.excluded_titles || []);
  useEffect(() => setPage(1), [query, filters, pageSize]);

  // A slower earlier request must not replace the latest search's results.
  const latestRequest = useRef(0);
  const run = async () => {
    const request = ++latestRequest.current;
    setLoading(true);
    setFailed(false);
    try {
      const data = await API.previewVODProfileCatalog(profile.id, {
        content_type: contentType,
        search: query,
        excluded: filters.excluded,
        account: filters.account ? Number(filters.account) : null,
        category: filters.category ? Number(filters.category) : null,
        edition: shownEdition,
        page,
        page_size: pageSize,
      });
      if (request === latestRequest.current) setResult(data);
    } catch {
      if (request === latestRequest.current) {
        setResult(null);
        setFailed(true);
      }
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters, page, pageSize, excludedTitles]);

  // The catalogue rebuilds after saving; an included title returns then.
  const toggleExcluded = async (row) => {
    const titles = profile.excluded_titles || [];
    const excluded = row.excluded
      ? titles.filter(
          (title) =>
            !(title.content_type === contentType && title.id === row.id)
        )
      : [...titles, { content_type: contentType, id: row.id }];
    try {
      onSaved(
        await API.saveVODProfile({ excluded_titles: excluded }, profile.id)
      );
    } catch (err) {
      showNotification({
        title: `Could not update ${profile.name}`,
        message: formatApiError(err),
        color: 'red',
      });
    }
  };

  // The Library preview numbers this entry's sources in failover order and
  // greys out the rest with the reason, like the production source list.
  const openPreview = (row, entry) => {
    const order = entry?.fallbacks || [];
    const note = (source) => {
      if (order.includes(source.id))
        return { order: order.indexOf(source.id) + 1 };
      if (source.state === 'skipped')
        return { label: 'Excluded', reason: source.reason };
      if (source.entry && source.entry !== entry?.name)
        return { label: 'Other entry', reason: `Used by ${source.entry}.` };
      return {
        label: 'Not used',
        reason: entry
          ? 'Does not match the version of this entry.'
          : row.reason,
      };
    };
    setOpened({
      item: {
        content_type: contentType,
        content_id: row.id,
        source_id: entry?.source_id || null,
        name: row.title,
      },
      notes: Object.fromEntries(
        row.sources.map((source) => [source.id, note(source)])
      ),
    });
  };

  const rows = (result?.results || []).flatMap((row) => {
    const entries =
      shownEdition === null
        ? row.entries
        : row.entries.filter((entry) => entry.edition === shownEdition);
    return entries.length
      ? entries.map((entry, index) => ({ row, entry, index }))
      : [{ row, entry: null, index: 0 }];
  });
  const empty = failed
    ? 'The preview could not be loaded.'
    : loading && !result
      ? 'Loading…'
      : 'No titles match the current filters.';
  const pagination = (
    <ListPagination
      page={page}
      pageSize={pageSize}
      total={result?.count || 0}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
    />
  );

  return (
    <Stack gap="xs" style={{ height: '100%', minHeight: 0 }}>
      <Flex gap="sm" align="center" wrap="wrap">
        <TextInput
          size="xs"
          aria-label="Search titles"
          placeholder="Search titles..."
          className={editorClasses.categorySearch}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          onKeyDown={(event) => {
            // The dialog is a form; Enter must not save it.
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
        <PreviewFilters
          value={filters}
          onChange={setFilters}
          onOpenChange={onFiltersOpen}
          categories={result?.categories}
          accounts={result?.accounts}
          editions={editionNames}
        />
        <Text size="xs" c="dimmed" ml="auto">
          {result
            ? `${result.count.toLocaleString()} ${
                filters.excluded ? 'excluded ' : ''
              }${
                contentType === 'series'
                  ? 'series'
                  : result.count === 1
                    ? 'movie'
                    : 'movies'
              }`
            : ''}
        </Text>
      </Flex>

      <ScrollArea className={editorClasses.categoryTableFrame}>
        <Table
          striped
          stickyHeader
          highlightOnHover
          miw={680}
          className={editorClasses.categoryTable}
          style={{ opacity: loading && result ? 0.6 : 1 }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Title</Table.Th>
              <Table.Th w="25%">Category</Table.Th>
              <Table.Th w={80} ta="center">
                Sources
              </Table.Th>
              <Table.Th w={90} ta="center">
                Actions
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {!rows.length && (
              <Table.Tr>
                <Table.Td colSpan={4} ta="center" py="xl">
                  <Text size="sm" c="dimmed">
                    {empty}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {rows.map(({ row, entry, index }) => (
              <Table.Tr
                key={`${row.id}-${index}`}
                aria-disabled={entry ? undefined : true}
                style={{ opacity: entry ? 1 : 0.5 }}
              >
                <Table.Td>
                  <Tooltip label={row.reason} disabled={!row.reason} withArrow>
                    <Text size="sm" truncate>
                      {entry ? entry.name : titleName(row)}
                    </Text>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" truncate>
                    {entry?.category || '—'}
                  </Text>
                </Table.Td>
                <Table.Td ta="center">{entry ? entry.sources : 0}</Table.Td>
                <Table.Td>
                  <Group gap={2} justify="center" wrap="nowrap">
                    <Tooltip label="Open title and profile sources">
                      <ActionIcon
                        variant="subtle"
                        aria-label={`Open ${titleName(row)}`}
                        onClick={() => openPreview(row, entry)}
                      >
                        <Eye size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip
                      label={
                        row.excluded
                          ? 'Include again; it returns after the rebuild'
                          : 'Exclude from this profile'
                      }
                    >
                      <ActionIcon
                        variant="subtle"
                        color={row.excluded ? 'gray' : 'red'}
                        aria-label={`${row.excluded ? 'Include' : 'Exclude'} ${titleName(row)}`}
                        onClick={() => toggleExcluded(row)}
                      >
                        {row.excluded ? <Undo2 size={16} /> : <Ban size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {pagination}
      {opened && (
        <LibraryPreviewModal
          item={opened.item}
          sourceNotes={opened.notes}
          inStack
          onClose={() => setOpened(null)}
        />
      )}
    </Stack>
  );
}

// In its own stack, Escape closes the topmost window only; an open filter
// closes before the preview.
export default function VODProfilePreview({ profile, onSaved, onClose }) {
  const filtersOpen = useRef(false);
  return (
    <Modal.Stack>
      <StackedModal
        opened
        keepVisibleInStack
        onClose={() => !filtersOpen.current && onClose()}
        title={`Preview ${profile.name}`}
        size="72vw"
        centered
      >
        <Stack gap="xs" h="70vh">
          {profile.catalog_status !== 'ready' && (
            <Alert color="blue" variant="light" p={6}>
              <Text size="xs">
                The catalogue is being prepared; the preview shows the last
                build.
              </Text>
            </Alert>
          )}
          <PreviewTable
            profile={profile}
            onSaved={onSaved}
            onFiltersOpen={(open) => {
              filtersOpen.current = open;
            }}
          />
        </Stack>
      </StackedModal>
    </Modal.Stack>
  );
}
