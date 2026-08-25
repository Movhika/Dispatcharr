import React, { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
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
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { Eye, GripVertical, Info, Plus, Trash2 } from 'lucide-react';
import LanguagePicker from './LanguagePicker.jsx';
import VideoFeaturePicker from './VideoFeaturePicker.jsx';
import API from '../api.js';

const RULE_DEFAULTS = {
  match_field: 'category',
  regex_pattern: '',
  case_sensitive: false,
  enabled: true,
  required_audio_languages: [],
  required_subtitle_languages: [],
  required_video_features: [],
  result: 'exclude',
};

const createRule = () => ({
  ...RULE_DEFAULTS,
  id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
});

const SortableRuleRow = ({ ruleId, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ruleId });
  return (
    <TableTr
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.65 : 1,
        position: 'relative',
        zIndex: isDragging ? 2 : 0,
      }}
    >
      <TableTd>
        <ActionIcon
          aria-label="Move VOD stream filter"
          variant="subtle"
          color="gray"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </ActionIcon>
      </TableTd>
      {children}
    </TableTr>
  );
};

const VODSourceRules = ({ value = [], onChange, categoryRelationIds = [] }) => {
  const [previewOpened, setPreviewOpened] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState({ count: 0, results: [] });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const normalized = value.map((rule, index) => ({
    ...RULE_DEFAULTS,
    ...rule,
    id: rule.id || `rule-${index}`,
    match_field: rule.match_field || 'category',
    regex_pattern: rule.regex_pattern ?? rule.category_regex ?? '',
    result: rule.result || 'include',
  }));

  const update = (id, changes) =>
    onChange(
      normalized.map((rule) =>
        rule.id === id ? { ...rule, ...changes } : rule
      )
    );
  const remove = (id) => onChange(normalized.filter((rule) => rule.id !== id));
  const reorder = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = normalized.findIndex((rule) => rule.id === active.id);
    const to = normalized.findIndex((rule) => rule.id === over.id);
    if (from >= 0 && to >= 0) onChange(arrayMove(normalized, from, to));
  };
  const previewRule = async (ruleId) => {
    setPreviewOpened(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreview({ count: 0, results: [] });
    try {
      setPreview(
        await API.previewVODAccessPolicyStreamFilter({
          source_rules: normalized,
          target_rule_id: ruleId,
          category_relation_ids: categoryRelationIds,
        })
      );
    } catch (error) {
      setPreviewError(error?.message || 'The filter preview could not load.');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Text fw={700}>Stream filters</Text>
          <Alert icon={<Info size={16} />} color="blue" variant="light">
            <Text size="sm">
              <strong>Order matters.</strong> The first matching filter decides
              whether a source is included. Unmatched sources remain available
              inside the allowed categories.
            </Text>
          </Alert>
        </Stack>
        <Button
          variant="default"
          size="xs"
          leftSection={<Plus size={14} />}
          onClick={() => onChange([...normalized, createRule()])}
        >
          Add filter
        </Button>
      </Group>

      {!normalized.length ? (
        <Alert color="gray">No VOD stream filters configured.</Alert>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={reorder}
        >
          <SortableContext
            items={normalized.map((rule) => rule.id)}
            strategy={verticalListSortingStrategy}
          >
            <ScrollArea type="auto">
              <Table striped withTableBorder miw={1180} verticalSpacing="xs">
                <TableThead>
                  <TableTr>
                    <TableTh w={46} aria-label="Filter order" />
                    <TableTh w={135}>Field</TableTh>
                    <TableTh>Expression</TableTh>
                    <TableTh w={190}>DUB</TableTh>
                    <TableTh w={190}>SUB</TableTh>
                    <TableTh w={190}>Feature</TableTh>
                    <TableTh w={125}>Result</TableTh>
                    <TableTh w={90}>Actions</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {normalized.map((rule) => (
                    <SortableRuleRow key={rule.id} ruleId={rule.id}>
                      <TableTd>
                        <Select
                          size="xs"
                          aria-label="VOD stream filter field"
                          data={[
                            { value: 'category', label: 'Category' },
                            { value: 'stream', label: 'Stream' },
                          ]}
                          value={rule.match_field}
                          onChange={(match_field) =>
                            update(rule.id, { match_field })
                          }
                        />
                      </TableTd>
                      <TableTd>
                        <TextInput
                          size="xs"
                          aria-label="VOD stream filter expression"
                          value={rule.regex_pattern}
                          onChange={(event) =>
                            update(rule.id, {
                              regex_pattern: event.currentTarget.value,
                            })
                          }
                        />
                      </TableTd>
                      <TableTd>
                        <LanguagePicker
                          label=""
                          size="xs"
                          value={rule.required_audio_languages}
                          onChange={(required_audio_languages) =>
                            update(rule.id, { required_audio_languages })
                          }
                        />
                      </TableTd>
                      <TableTd>
                        <LanguagePicker
                          label=""
                          size="xs"
                          value={rule.required_subtitle_languages}
                          onChange={(required_subtitle_languages) =>
                            update(rule.id, { required_subtitle_languages })
                          }
                        />
                      </TableTd>
                      <TableTd>
                        <VideoFeaturePicker
                          label=""
                          size="xs"
                          value={rule.required_video_features}
                          onChange={(required_video_features) =>
                            update(rule.id, { required_video_features })
                          }
                        />
                      </TableTd>
                      <TableTd>
                        <Select
                          size="xs"
                          aria-label="VOD stream filter result"
                          data={[
                            { value: 'include', label: 'Include' },
                            { value: 'exclude', label: 'Exclude' },
                          ]}
                          value={rule.result}
                          onChange={(result) => update(rule.id, { result })}
                        />
                      </TableTd>
                      <TableTd>
                        <Group gap={4} wrap="nowrap">
                          <Tooltip label="Preview this draft filter">
                            <ActionIcon
                              aria-label="Preview VOD stream filters"
                              color="green"
                              variant="subtle"
                              onClick={() => previewRule(rule.id)}
                            >
                              <Eye size={15} />
                            </ActionIcon>
                          </Tooltip>
                          <ActionIcon
                            aria-label="Delete VOD stream filter"
                            color="red"
                            variant="subtle"
                            onClick={() => remove(rule.id)}
                          >
                            <Trash2 size={15} />
                          </ActionIcon>
                        </Group>
                      </TableTd>
                    </SortableRuleRow>
                  ))}
                </TableTbody>
              </Table>
            </ScrollArea>
          </SortableContext>
        </DndContext>
      )}

      <Modal
        opened={previewOpened}
        onClose={() => setPreviewOpened(false)}
        title="VOD stream filter preview"
        size="xl"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            The complete ordered draft is evaluated. Only sources for which this
            filter is the first match are shown.
          </Text>
          {previewLoading && (
            <Group justify="center" py="xl">
              <Loader />
            </Group>
          )}
          {previewError && <Alert color="red">{previewError}</Alert>}
          {!previewLoading && !previewError && (
            <>
              <Text fw={600}>
                {preview.count || 0} matching sources
                {preview.truncated ? ' (first 200 shown)' : ''}
              </Text>
              <ScrollArea h="min(62vh, 620px)" type="auto">
                <Table striped withTableBorder stickyHeader miw={900}>
                  <TableThead>
                    <TableTr>
                      <TableTh>Title</TableTh>
                      <TableTh>M3U account</TableTh>
                      <TableTh>Category</TableTh>
                      <TableTh>DUB</TableTh>
                      <TableTh>SUB</TableTh>
                      <TableTh>Resolution</TableTh>
                      <TableTh>Features</TableTh>
                      <TableTh>Result</TableTh>
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {!preview.results?.length && (
                      <TableTr>
                        <TableTd colSpan={8}>
                          <Text ta="center" c="dimmed" py="lg">
                            No source has this filter as its first match.
                          </Text>
                        </TableTd>
                      </TableTr>
                    )}
                    {(preview.results || []).map((row) => (
                      <TableTr key={`${row.content_type}-${row.id}`}>
                        <TableTd>{row.title}</TableTd>
                        <TableTd>{row.m3u_account_name}</TableTd>
                        <TableTd>{row.category_name || '—'}</TableTd>
                        <TableTd>
                          {(row.audio_languages || []).join(', ') || '—'}
                        </TableTd>
                        <TableTd>
                          {(row.subtitle_languages || []).join(', ') || '—'}
                        </TableTd>
                        <TableTd>{row.resolution || '—'}</TableTd>
                        <TableTd>
                          {(row.video_features || []).join(', ') || '—'}
                        </TableTd>
                        <TableTd>
                          <Badge
                            color={row.result === 'exclude' ? 'red' : 'green'}
                          >
                            {row.result}
                          </Badge>
                        </TableTd>
                      </TableTr>
                    ))}
                  </TableTbody>
                </Table>
              </ScrollArea>
            </>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
};

export default VODSourceRules;
