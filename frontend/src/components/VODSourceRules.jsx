import React, { useState } from 'react';
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Switch,
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
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import LanguagePicker from './LanguagePicker.jsx';
import VideoFeaturePicker from './VideoFeaturePicker.jsx';
import { RESOLUTION_LIMIT_OPTIONS } from '../utils/vodMetadataOptions.js';

const EMPTY_RULE = {
  id: '',
  name: '',
  category_regex: '.*',
  case_sensitive: false,
  enabled: true,
  required_audio_languages: [],
  required_subtitle_languages: [],
  excluded_audio_languages: [],
  excluded_subtitle_languages: [],
  required_video_features: [],
  excluded_video_features: [],
  language_match_mode: 'any',
  min_resolution: 0,
  max_resolution: 0,
  allow_unknown_metadata: true,
};

const listSummary = (values) =>
  values?.length ? values.map((value) => value.toUpperCase()).join(', ') : '—';

const VODSourceRules = ({ value = [], onChange }) => {
  const [opened, setOpened] = useState(false);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [draft, setDraft] = useState(EMPTY_RULE);

  const openNew = () => {
    setEditingIndex(-1);
    setDraft({
      ...EMPTY_RULE,
      id: `rule-${Date.now()}`,
      name: `Source rule ${value.length + 1}`,
    });
    setOpened(true);
  };

  const openEdit = (index) => {
    setEditingIndex(index);
    setDraft({ ...EMPTY_RULE, ...value[index] });
    setOpened(true);
  };

  const save = () => {
    const next = [...value];
    if (editingIndex < 0) next.push(draft);
    else next[editingIndex] = draft;
    onChange(next);
    setOpened(false);
  };

  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const update = (field, nextValue) =>
    setDraft((current) => ({ ...current, [field]: nextValue }));

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={0}>
          <Text fw={600}>Category-specific source rules</Text>
          <Text size="sm" c="dimmed">
            The first enabled rule whose category expression matches wins.
            Unmatched categories use the default source rules above.
          </Text>
        </Stack>
        <Button
          variant="default"
          leftSection={<Plus size={15} />}
          onClick={openNew}
        >
          Add rule
        </Button>
      </Group>

      <Table withTableBorder striped highlightOnHover>
        <TableThead>
          <TableTr>
            <TableTh>Rule</TableTh>
            <TableTh>Category expression</TableTh>
            <TableTh>DUB</TableTh>
            <TableTh>SUB</TableTh>
            <TableTh>Excluded features</TableTh>
            <TableTh w={160}>Actions</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {value.map((rule, index) => (
            <TableTr key={rule.id || index}>
              <TableTd>
                <Text fw={500}>{rule.name || `Rule ${index + 1}`}</Text>
                <Text size="xs" c={rule.enabled === false ? 'dimmed' : 'green'}>
                  {rule.enabled === false ? 'Inactive' : 'Active'}
                </Text>
              </TableTd>
              <TableTd>
                <Text ff="monospace" size="sm">
                  {rule.category_regex || '.*'}
                </Text>
              </TableTd>
              <TableTd>{listSummary(rule.required_audio_languages)}</TableTd>
              <TableTd>{listSummary(rule.required_subtitle_languages)}</TableTd>
              <TableTd>{listSummary(rule.excluded_video_features)}</TableTd>
              <TableTd>
                <Group gap={4} wrap="nowrap">
                  <Tooltip label="Move up">
                    <ActionIcon
                      variant="subtle"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={15} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Move down">
                    <ActionIcon
                      variant="subtle"
                      disabled={index === value.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={15} />
                    </ActionIcon>
                  </Tooltip>
                  <ActionIcon
                    variant="subtle"
                    aria-label={`Edit ${rule.name}`}
                    onClick={() => openEdit(index)}
                  >
                    <Pencil size={15} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Delete ${rule.name}`}
                    onClick={() =>
                      onChange(
                        value.filter((_, itemIndex) => itemIndex !== index)
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </ActionIcon>
                </Group>
              </TableTd>
            </TableTr>
          ))}
          {!value.length && (
            <TableTr>
              <TableTd colSpan={6}>
                <Text ta="center" c="dimmed" py="md">
                  No category-specific rules. Default source rules apply.
                </Text>
              </TableTd>
            </TableTr>
          )}
        </TableTbody>
      </Table>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={editingIndex < 0 ? 'Add source rule' : 'Edit source rule'}
        size="lg"
      >
        <Stack>
          <Group grow align="flex-start">
            <TextInput
              label="Rule name"
              value={draft.name}
              onChange={(event) => update('name', event.currentTarget.value)}
            />
            <TextInput
              label="Category regular expression"
              description="Matched against the provider category name."
              value={draft.category_regex}
              onChange={(event) =>
                update('category_regex', event.currentTarget.value)
              }
            />
          </Group>
          <Group grow>
            <Switch
              label="Active"
              checked={draft.enabled}
              onChange={(event) =>
                update('enabled', event.currentTarget.checked)
              }
            />
            <Checkbox
              label="Case-sensitive expression"
              checked={draft.case_sensitive}
              onChange={(event) =>
                update('case_sensitive', event.currentTarget.checked)
              }
            />
          </Group>
          <Group grow align="flex-start">
            <Paper withBorder p="sm">
              <Stack>
                <LanguagePicker
                  label="Required DUB languages"
                  value={draft.required_audio_languages}
                  onChange={(next) => update('required_audio_languages', next)}
                />
                <LanguagePicker
                  label="Excluded DUB languages"
                  value={draft.excluded_audio_languages}
                  onChange={(next) => update('excluded_audio_languages', next)}
                />
              </Stack>
            </Paper>
            <Paper withBorder p="sm">
              <Stack>
                <LanguagePicker
                  label="Required SUB languages"
                  value={draft.required_subtitle_languages}
                  onChange={(next) =>
                    update('required_subtitle_languages', next)
                  }
                />
                <LanguagePicker
                  label="Excluded SUB languages"
                  value={draft.excluded_subtitle_languages}
                  onChange={(next) =>
                    update('excluded_subtitle_languages', next)
                  }
                />
              </Stack>
            </Paper>
          </Group>
          <Select
            label="Language matching"
            data={[
              { value: 'all', label: 'DUB and SUB must match' },
              { value: 'any', label: 'DUB or SUB may match' },
            ]}
            value={draft.language_match_mode}
            onChange={(next) => update('language_match_mode', next || 'any')}
          />
          <Group grow align="flex-start">
            <Select
              label="Minimum resolution"
              data={RESOLUTION_LIMIT_OPTIONS}
              value={String(draft.min_resolution || 0)}
              onChange={(next) => update('min_resolution', Number(next) || 0)}
            />
            <Select
              label="Maximum resolution"
              data={RESOLUTION_LIMIT_OPTIONS}
              value={String(draft.max_resolution || 0)}
              onChange={(next) => update('max_resolution', Number(next) || 0)}
            />
          </Group>
          <Group grow align="flex-start">
            <VideoFeaturePicker
              label="Required features"
              value={draft.required_video_features}
              onChange={(next) => update('required_video_features', next)}
            />
            <VideoFeaturePicker
              label="Excluded features"
              value={draft.excluded_video_features}
              onChange={(next) => update('excluded_video_features', next)}
            />
          </Group>
          <Switch
            label="Allow unknown technical metadata"
            checked={draft.allow_unknown_metadata}
            onChange={(event) =>
              update('allow_unknown_metadata', event.currentTarget.checked)
            }
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button disabled={!draft.name.trim()} onClick={save}>
              Save rule
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default VODSourceRules;
