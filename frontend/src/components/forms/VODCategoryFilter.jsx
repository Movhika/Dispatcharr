import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Flex,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  TagsInput,
  Text,
  TextInput,
} from '@mantine/core';
import useVODStore from '../../store/useVODStore';
import API from '../../api';
import { showNotification } from '../../utils/notificationUtils';

const VODCategoryFilter = ({
  playlist = null,
  categoryStates,
  setCategoryStates,
  type,
  autoEnableNewGroups,
  setAutoEnableNewGroups,
}) => {
  const categories = useVODStore((s) => s.categories);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
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
    const values = Object.fromEntries(
      Object.entries(metadata).filter(
        ([, value]) => value !== '' && (!Array.isArray(value) || value.length)
      )
    );
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

  const allVisibleSelected =
    visible.length > 0 &&
    visible.every((category) => selected.has(category.id));

  return (
    <>
      <Stack pt="sm">
        <Checkbox
          label={`Automatically enable new ${type === 'movie' ? 'movie' : 'series'} categories discovered on future scans`}
          checked={autoEnableNewGroups}
          onChange={(event) =>
            setAutoEnableNewGroups(event.currentTarget.checked)
          }
          size="sm"
          description="Discovery rules in the account Filters dialog can override this default for matching new categories."
        />

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
            onClick={() => setEditorOpen(true)}
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
              <TableTh>Default audio</TableTh>
              <TableTh>Default subtitles</TableTh>
              <TableTh w={110}>Resolution</TableTh>
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
                  <Checkbox
                    aria-label={`Enable ${category.name}`}
                    checked={category.enabled}
                    onChange={(event) =>
                      setCategoryStates((current) =>
                        current.map((item) =>
                          item.id === category.id
                            ? {
                                ...item,
                                enabled: event.currentTarget.checked,
                              }
                            : item
                        )
                      )
                    }
                  />
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
            Only filled fields are changed. Category defaults are initial
            assumptions; manual source metadata remains authoritative.
          </Text>
          <TagsInput
            label="Audio languages"
            description="English ISO 639-2/B codes"
            placeholder="ger, eng"
            value={metadata.audio_languages}
            onChange={(value) =>
              setMetadata({ ...metadata, audio_languages: value })
            }
          />
          <TagsInput
            label="Subtitle languages"
            placeholder="ger, eng"
            value={metadata.subtitle_languages}
            onChange={(value) =>
              setMetadata({ ...metadata, subtitle_languages: value })
            }
          />
          <Select
            clearable
            label="Expected maximum resolution"
            data={['480p', '576p', '720p', '1080p', '1440p', '2160p']}
            value={metadata.resolution || null}
            onChange={(value) =>
              setMetadata({ ...metadata, resolution: value || '' })
            }
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
    </>
  );
};

export default VODCategoryFilter;
