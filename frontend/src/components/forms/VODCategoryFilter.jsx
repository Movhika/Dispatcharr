import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Flex,
  Group,
  Modal,
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
  Tooltip,
} from '@mantine/core';
import { Info } from 'lucide-react';
import useVODStore from '../../store/useVODStore';
import API from '../../api';
import { showNotification } from '../../utils/notificationUtils';
import VODMetadataFields from '../VODMetadataFields.jsx';
import M3UGroupRules from './M3UGroupRules.jsx';
import { normalizeLanguageCodes } from '../../utils/languageCodes.js';

const VODCategoryFilter = ({
  playlist = null,
  categoryStates,
  setCategoryStates,
  type,
}) => {
  const categories = useVODStore((s) => s.categories);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [metadataModes, setMetadataModes] = useState({
    audio_languages: 'keep',
    subtitle_languages: 'keep',
    resolution: 'keep',
  });
  const [metadata, setMetadata] = useState({
    audio_languages: [],
    subtitle_languages: [],
    resolution: '',
  });

  useEffect(() => {
    if (Object.keys(categories).length === 0) return;

    setCategoryStates(
      Object.values(categories)
        .filter(
          (category) =>
            category.m3u_accounts.find(
              (account) => account.m3u_account == playlist.id
            ) && category.category_type == type
        )
        .map((category) => {
          const relation = category.m3u_accounts.find(
            (account) => account.m3u_account == playlist.id
          );
          return {
            ...category,
            relation_id: relation.id,
            metadata_defaults: relation.metadata_defaults || {},
            enabled: relation.enabled || false,
            original_enabled: relation.enabled,
          };
        })
    );
  }, [categories, playlist.id, setCategoryStates, type]);

  const visible = useMemo(
    () =>
      categoryStates
        .filter((category) => {
          const matchesText = category.name
            .toLowerCase()
            .includes(filter.toLowerCase());
          const matchesStatus =
            statusFilter === 'all' ||
            (statusFilter === 'enabled' && category.enabled) ||
            (statusFilter === 'disabled' && !category.enabled);
          return matchesText && matchesStatus;
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [categoryStates, filter, statusFilter]
  );

  const updateSelected = (changes) => {
    setCategoryStates((current) =>
      current.map((category) =>
        selected.has(category.id) ? { ...category, ...changes } : category
      )
    );
  };

  const toggleSelected = (id, checked) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleVisibleSelection = (checked) => {
    setSelected((current) => {
      const next = new Set(current);
      visible.forEach((category) =>
        checked ? next.add(category.id) : next.delete(category.id)
      );
      return next;
    });
  };

  const saveBulkMetadata = async () => {
    const values = {};
    for (const field of Object.keys(metadataModes)) {
      if (metadataModes[field] === 'keep') continue;
      if (metadataModes[field] === 'clear') {
        values[field] = field === 'resolution' ? '' : [];
      } else {
        values[field] =
          field === 'resolution'
            ? metadata[field]
            : normalizeLanguageCodes(metadata[field]);
      }
    }
    const targets = categoryStates.filter((category) =>
      selected.has(category.id)
    );
    setSaving(true);
    try {
      await API.bulkUpdateVODCategoryMetadata(
        targets.map((category) => category.relation_id),
        values
      );
      setCategoryStates((current) =>
        current.map((category) =>
          selected.has(category.id)
            ? {
                ...category,
                metadata_defaults: {
                  ...(category.metadata_defaults || {}),
                  ...values,
                },
              }
            : category
        )
      );
      showNotification({
        title: 'Category metadata updated',
        message: `${targets.length} categories were updated. These defaults have lower priority than manual source metadata.`,
        color: 'green',
      });
      setEditorOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const openMetadataEditor = () => {
    setMetadata({
      audio_languages: [],
      subtitle_languages: [],
      resolution: '',
    });
    setMetadataModes({
      audio_languages: 'keep',
      subtitle_languages: 'keep',
      resolution: 'keep',
    });
    setEditorOpen(true);
  };

  const allVisibleSelected =
    visible.length > 0 &&
    visible.every((category) => selected.has(category.id));

  return (
    <>
      <Stack pt="sm">
        <Group justify="flex-start" align="center">
          <Button
            variant="default"
            size="xs"
            onClick={() => setRulesOpen(true)}
          >
            Import rules
          </Button>
          <Text size="xs" c="dimmed">
            New unmatched categories are imported inactive.
          </Text>
        </Group>

        <Flex gap="sm" align="end" wrap="wrap">
          <TextInput
            label="Search categories"
            placeholder="Filter categories..."
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            style={{ flex: 1 }}
            size="xs"
          />
          <SegmentedControl
            value={statusFilter}
            onChange={setStatusFilter}
            size="xs"
            data={[
              { label: 'All', value: 'all' },
              { label: 'Enabled', value: 'enabled' },
              { label: 'Disabled', value: 'disabled' },
            ]}
          />
          <Button
            variant="default"
            size="xs"
            disabled={!selected.size}
            onClick={() => updateSelected({ enabled: true })}
          >
            Enable selected
          </Button>
          <Button
            variant="default"
            size="xs"
            disabled={!selected.size}
            onClick={() => updateSelected({ enabled: false })}
          >
            Disable selected
          </Button>
          <Button
            variant="default"
            size="xs"
            disabled={!selected.size}
            onClick={openMetadataEditor}
          >
            Edit metadata ({selected.size})
          </Button>
        </Flex>

        <Table striped highlightOnHover withTableBorder stickyHeader>
          <TableThead>
            <TableTr>
              <TableTh w={44}>
                <Checkbox
                  aria-label="Select visible categories"
                  checked={allVisibleSelected}
                  onChange={(event) =>
                    toggleVisibleSelection(event.currentTarget.checked)
                  }
                />
              </TableTh>
              <TableTh>Category</TableTh>
              <TableTh w={100}>Enabled</TableTh>
              <TableTh>
                <Group gap={4} wrap="nowrap">
                  DUB
                  <Tooltip label="Approximate audio languages used only to seed newly imported sources. Manual and observed metadata has higher priority.">
                    <Info size={13} aria-label="About DUB defaults" />
                  </Tooltip>
                </Group>
              </TableTh>
              <TableTh>
                <Group gap={4} wrap="nowrap">
                  SUB
                  <Tooltip label="Approximate subtitle languages used only to seed newly imported sources. Manual and observed metadata has higher priority.">
                    <Info size={13} aria-label="About SUB defaults" />
                  </Tooltip>
                </Group>
              </TableTh>
              <TableTh w={120}>
                <Group gap={4} wrap="nowrap">
                  Resolution
                  <Tooltip label="Approximate maximum resolution used only to seed newly imported sources.">
                    <Info size={13} aria-label="About resolution defaults" />
                  </Tooltip>
                </Group>
              </TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {visible.map((category) => (
              <TableTr key={category.id}>
                <TableTd>
                  <Checkbox
                    aria-label={`Select ${category.name}`}
                    checked={selected.has(category.id)}
                    onChange={(event) =>
                      toggleSelected(category.id, event.currentTarget.checked)
                    }
                  />
                </TableTd>
                <TableTd>{category.name}</TableTd>
                <TableTd>
                  <Button
                    size="compact-xs"
                    color={category.enabled ? 'green' : 'gray'}
                    variant={category.enabled ? 'filled' : 'light'}
                    aria-label={`Enable ${category.name}`}
                    aria-pressed={category.enabled}
                    onClick={() =>
                      setCategoryStates((current) =>
                        current.map((item) =>
                          item.id === category.id
                            ? {
                                ...item,
                                enabled: !item.enabled,
                              }
                            : item
                        )
                      )
                    }
                  >
                    {category.enabled ? 'Active' : 'Inactive'}
                  </Button>
                </TableTd>
                <TableTd>
                  {(category.metadata_defaults?.audio_languages || []).join(
                    ', '
                  ) || '—'}
                </TableTd>
                <TableTd>
                  {(category.metadata_defaults?.subtitle_languages || []).join(
                    ', '
                  ) || '—'}
                </TableTd>
                <TableTd>
                  {category.metadata_defaults?.resolution || '—'}
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </Stack>

      <Modal
        opened={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={`Edit defaults for ${selected.size} categories`}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Choose Keep, Set, or Clear for each field. These are approximate
            import assumptions; manual and observed source metadata remains
            authoritative.
          </Text>
          <VODMetadataFields
            fields={['audio_languages', 'subtitle_languages', 'resolution']}
            labels={{
              audio_languages: 'DUB',
              subtitle_languages: 'SUB',
            }}
            value={metadata}
            onChange={setMetadata}
            modes={metadataModes}
            onModesChange={setMetadataModes}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={saveBulkMetadata}>
              Apply to selected
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={rulesOpen}
        onClose={() => setRulesOpen(false)}
        title={`${type === 'movie' ? 'Movie' : 'Series'} import rules`}
        size="95vw"
        scrollAreaComponent={Modal.NativeScrollArea}
      >
        <M3UGroupRules accountId={playlist.id} scope={type} />
      </Modal>
    </>
  );
};

export default VODCategoryFilter;
