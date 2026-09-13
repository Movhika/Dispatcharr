import React, { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  TagsInput,
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
import { Eye, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import LanguagePicker from './LanguagePicker.jsx';
import VideoFeaturePicker from './VideoFeaturePicker.jsx';
import API from '../api.js';

const RULE_DEFAULTS = {
  match_field: 'stream',
  regex_pattern: '',
  case_sensitive: false,
  enabled: true,
  required_audio_languages: [],
  required_subtitle_languages: [],
  required_video_features: [],
  min_resolution: 0,
  max_resolution: 0,
  required_genres: [],
  required_keywords: [],
  required_countries: [],
  required_age_ratings: [],
  min_year: 0,
  max_year: 0,
  min_rating: 0,
  max_rating: 0,
  anime_mode: 'any',
  adult_mode: 'any',
  metadata_mode: 'any',
  result: 'include',
};

const createRule = () => ({
  ...RULE_DEFAULTS,
  id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
});

const normalizeRule = (rule, index) => ({
  ...RULE_DEFAULTS,
  ...rule,
  id: rule.id || `rule-${index}`,
  match_field: rule.match_field || 'stream',
  regex_pattern: rule.regex_pattern ?? rule.category_regex ?? '',
  result: rule.result || 'include',
});

const joinValues = (values) => (values || []).join(', ');

const hasFilterCondition = (rule) =>
  Boolean(
    rule.regex_pattern ||
    rule.required_audio_languages?.length ||
    rule.required_subtitle_languages?.length ||
    rule.required_video_features?.length ||
    rule.min_resolution ||
    rule.max_resolution ||
    rule.required_genres?.length ||
    rule.required_keywords?.length ||
    rule.required_countries?.length ||
    rule.required_age_ratings?.length ||
    rule.min_year ||
    rule.max_year ||
    rule.min_rating ||
    rule.max_rating ||
    rule.anime_mode !== 'any' ||
    rule.adult_mode !== 'any' ||
    rule.metadata_mode !== 'any'
  );

const ruleSummary = (rule) => {
  const conditions = [];
  if (rule.regex_pattern) conditions.push('Legacy title/category expression');
  if (rule.required_audio_languages?.length) {
    conditions.push(
      `DUB contains ${joinValues(rule.required_audio_languages)}`
    );
  }
  if (rule.required_subtitle_languages?.length) {
    conditions.push(
      `SUB contains ${joinValues(rule.required_subtitle_languages)}`
    );
  }
  if (rule.required_video_features?.length) {
    conditions.push(
      `Features contain ${joinValues(rule.required_video_features)}`
    );
  }
  if (rule.min_resolution || rule.max_resolution) {
    conditions.push(
      `Resolution ${rule.min_resolution || 'any'}–${rule.max_resolution || 'any'}p`
    );
  }
  for (const [field, label] of [
    ['required_genres', 'Genre'],
    ['required_keywords', 'Keywords'],
    ['required_countries', 'Country'],
    ['required_age_ratings', 'Age rating'],
  ]) {
    if (rule[field]?.length) {
      conditions.push(`${label} contains ${joinValues(rule[field])}`);
    }
  }
  if (rule.min_year || rule.max_year) {
    conditions.push(`Year ${rule.min_year || 'any'}–${rule.max_year || 'any'}`);
  }
  if (rule.min_rating || rule.max_rating) {
    conditions.push(
      `Rating ${rule.min_rating || 'any'}–${rule.max_rating || 'any'}`
    );
  }
  if (rule.anime_mode !== 'any') conditions.push(`Anime is ${rule.anime_mode}`);
  if (rule.adult_mode !== 'any') conditions.push(`Adult is ${rule.adult_mode}`);
  if (rule.metadata_mode !== 'any') {
    conditions.push(`Canonical metadata is ${rule.metadata_mode}`);
  }
  return conditions.length ? conditions : ['All content'];
};

const SortableRuleCard = ({ ruleId, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ruleId });
  return (
    <Paper
      ref={setNodeRef}
      withBorder
      p="sm"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.65 : 1,
        position: 'relative',
        zIndex: isDragging ? 2 : 0,
      }}
    >
      <Group align="flex-start" wrap="nowrap">
        <ActionIcon
          aria-label="Move content filter"
          variant="subtle"
          color="gray"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </ActionIcon>
        <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
      </Group>
    </Paper>
  );
};

const VODSourceRules = ({
  value = [],
  onChange,
  categoryRelationIds = [],
  defaultAction = 'include',
  onDefaultActionChange,
}) => {
  const [previewOpened, setPreviewOpened] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState({ count: 0, results: [] });
  const [editorOpened, setEditorOpened] = useState(false);
  const [editorRule, setEditorRule] = useState(createRule());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const normalized = value.map(normalizeRule);

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
  const openNewRule = () => {
    setEditorRule(createRule());
    setEditorOpened(true);
  };
  const openRule = (rule) => {
    setEditorRule({ ...rule });
    setEditorOpened(true);
  };
  const saveRule = () => {
    if (normalized.some((rule) => rule.id === editorRule.id)) {
      update(editorRule.id, editorRule);
    } else {
      onChange([...normalized, editorRule]);
    }
    setEditorOpened(false);
  };
  const editorInvalid =
    !hasFilterCondition(editorRule) ||
    (editorRule.min_resolution &&
      editorRule.max_resolution &&
      Number(editorRule.min_resolution) > Number(editorRule.max_resolution)) ||
    (editorRule.min_year &&
      editorRule.max_year &&
      Number(editorRule.min_year) > Number(editorRule.max_year)) ||
    (editorRule.min_rating &&
      editorRule.max_rating &&
      Number(editorRule.min_rating) > Number(editorRule.max_rating));

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
      <Group justify="space-between" align="end" w="100%">
        <Stack gap={2}>
          <Text fw={700}>Content filters</Text>
          <Text size="xs" c="dimmed">
            All filled conditions inside a filter must match. Manual source
            metadata overrides imported and detected values.
          </Text>
        </Stack>
        <Group align="end">
          <Select
            label="Unmatched content"
            size="xs"
            w={170}
            data={[
              { value: 'include', label: 'Include' },
              { value: 'exclude', label: 'Exclude' },
            ]}
            value={defaultAction}
            onChange={(next) => onDefaultActionChange?.(next || 'include')}
          />
          <Button
            variant="default"
            size="xs"
            leftSection={<Plus size={14} />}
            onClick={openNewRule}
          >
            Add filter
          </Button>
        </Group>
      </Group>

      {!normalized.length ? (
        <Alert color="gray">
          No content filters configured. The unmatched-content setting is only
          applied after the first filter is added.
        </Alert>
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
            <Stack gap="xs">
              {normalized.map((rule, index) => (
                <SortableRuleCard key={rule.id} ruleId={rule.id}>
                  <Group
                    justify="space-between"
                    align="flex-start"
                    wrap="nowrap"
                  >
                    <Stack gap={4}>
                      <Group gap="xs">
                        <Text fw={600} size="sm">
                          Filter {index + 1}
                        </Text>
                        <Badge
                          color={rule.result === 'exclude' ? 'red' : 'green'}
                          variant="light"
                        >
                          {rule.result}
                        </Badge>
                        {rule.enabled === false && (
                          <Badge color="gray" variant="light">
                            Disabled
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">
                        {ruleSummary(rule).join(' · ')}
                      </Text>
                    </Stack>
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Edit filter">
                        <ActionIcon
                          aria-label="Edit content filter"
                          variant="subtle"
                          onClick={() => openRule(rule)}
                        >
                          <Pencil size={15} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Preview this draft filter">
                        <ActionIcon
                          aria-label="Preview content filters"
                          color="green"
                          variant="subtle"
                          onClick={() => previewRule(rule.id)}
                        >
                          <Eye size={15} />
                        </ActionIcon>
                      </Tooltip>
                      <ActionIcon
                        aria-label="Delete content filter"
                        color="red"
                        variant="subtle"
                        onClick={() => remove(rule.id)}
                      >
                        <Trash2 size={15} />
                      </ActionIcon>
                    </Group>
                  </Group>
                </SortableRuleCard>
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      )}

      <Modal
        opened={editorOpened}
        onClose={() => setEditorOpened(false)}
        title="Content filter"
        size="xl"
      >
        <Stack>
          <Group justify="space-between" align="end">
            <Select
              label="Result"
              data={[
                { value: 'include', label: 'Include' },
                { value: 'exclude', label: 'Exclude' },
              ]}
              value={editorRule.result}
              onChange={(result) =>
                setEditorRule((current) => ({
                  ...current,
                  result: result || 'include',
                }))
              }
            />
            <Switch
              label="Enabled"
              checked={editorRule.enabled !== false}
              onChange={(event) =>
                setEditorRule((current) => ({
                  ...current,
                  enabled: event.currentTarget.checked,
                }))
              }
            />
          </Group>

          <Text fw={600}>Source metadata</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <VideoFeaturePicker
              label="Features contain"
              value={editorRule.required_video_features || []}
              onChange={(required_video_features) =>
                setEditorRule((current) => ({
                  ...current,
                  required_video_features,
                }))
              }
            />
            <LanguagePicker
              label="DUB contains"
              value={editorRule.required_audio_languages || []}
              onChange={(required_audio_languages) =>
                setEditorRule((current) => ({
                  ...current,
                  required_audio_languages,
                }))
              }
            />
            <LanguagePicker
              label="SUB contains"
              value={editorRule.required_subtitle_languages || []}
              onChange={(required_subtitle_languages) =>
                setEditorRule((current) => ({
                  ...current,
                  required_subtitle_languages,
                }))
              }
            />
            <NumberInput
              label="Minimum resolution"
              min={0}
              step={240}
              suffix="p"
              value={editorRule.min_resolution || 0}
              onChange={(min_resolution) =>
                setEditorRule((current) => ({ ...current, min_resolution }))
              }
            />
            <NumberInput
              label="Maximum resolution"
              min={0}
              step={240}
              suffix="p"
              value={editorRule.max_resolution || 0}
              onChange={(max_resolution) =>
                setEditorRule((current) => ({ ...current, max_resolution }))
              }
            />
          </SimpleGrid>

          {editorRule.regex_pattern && (
            <Alert color="yellow">
              <TextInput
                label="Legacy regular expression"
                description="This existing expression remains active for compatibility. New filters use metadata conditions only."
                value={editorRule.regex_pattern}
                onChange={(event) =>
                  setEditorRule((current) => ({
                    ...current,
                    regex_pattern: event.currentTarget.value,
                  }))
                }
              />
            </Alert>
          )}

          <Text fw={600}>Canonical metadata</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TagsInput
              label="Genre contains"
              value={editorRule.required_genres || []}
              onChange={(required_genres) =>
                setEditorRule((current) => ({ ...current, required_genres }))
              }
              splitChars={[',']}
              clearable
            />
            <TagsInput
              label="Keywords contain"
              value={editorRule.required_keywords || []}
              onChange={(required_keywords) =>
                setEditorRule((current) => ({ ...current, required_keywords }))
              }
              splitChars={[',']}
              clearable
            />
            <TagsInput
              label="Country contains"
              value={editorRule.required_countries || []}
              onChange={(required_countries) =>
                setEditorRule((current) => ({ ...current, required_countries }))
              }
              splitChars={[',']}
              clearable
            />
            <TagsInput
              label="Age rating contains"
              value={editorRule.required_age_ratings || []}
              onChange={(required_age_ratings) =>
                setEditorRule((current) => ({
                  ...current,
                  required_age_ratings,
                }))
              }
              splitChars={[',']}
              clearable
            />
            <NumberInput
              label="Minimum year"
              min={0}
              max={9999}
              value={editorRule.min_year || 0}
              onChange={(min_year) =>
                setEditorRule((current) => ({ ...current, min_year }))
              }
            />
            <NumberInput
              label="Maximum year"
              min={0}
              max={9999}
              value={editorRule.max_year || 0}
              onChange={(max_year) =>
                setEditorRule((current) => ({ ...current, max_year }))
              }
            />
            <NumberInput
              label="Minimum rating"
              min={0}
              max={10}
              step={0.1}
              decimalScale={1}
              value={editorRule.min_rating || 0}
              onChange={(min_rating) =>
                setEditorRule((current) => ({ ...current, min_rating }))
              }
            />
            <NumberInput
              label="Maximum rating"
              min={0}
              max={10}
              step={0.1}
              decimalScale={1}
              value={editorRule.max_rating || 0}
              onChange={(max_rating) =>
                setEditorRule((current) => ({ ...current, max_rating }))
              }
            />
            <Select
              label="Anime"
              data={[
                { value: 'any', label: 'Any' },
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              value={editorRule.anime_mode || 'any'}
              onChange={(anime_mode) =>
                setEditorRule((current) => ({
                  ...current,
                  anime_mode: anime_mode || 'any',
                }))
              }
            />
            <Select
              label="Adult content"
              data={[
                { value: 'any', label: 'Any' },
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              value={editorRule.adult_mode || 'any'}
              onChange={(adult_mode) =>
                setEditorRule((current) => ({
                  ...current,
                  adult_mode: adult_mode || 'any',
                }))
              }
            />
            <Select
              label="Canonical metadata"
              data={[
                { value: 'any', label: 'Any' },
                { value: 'available', label: 'Available' },
                { value: 'missing', label: 'Missing' },
              ]}
              value={editorRule.metadata_mode || 'any'}
              onChange={(metadata_mode) =>
                setEditorRule((current) => ({
                  ...current,
                  metadata_mode: metadata_mode || 'any',
                }))
              }
            />
          </SimpleGrid>

          {editorInvalid && (
            <Alert color="red">
              {!hasFilterCondition(editorRule)
                ? 'Choose at least one metadata condition.'
                : 'A minimum cannot be greater than its maximum.'}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditorOpened(false)}>
              Cancel
            </Button>
            <Button disabled={editorInvalid} onClick={saveRule}>
              Save filter
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={previewOpened}
        onClose={() => setPreviewOpened(false)}
        title="Content filter preview"
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
                      <TableTh>Provider source</TableTh>
                      <TableTh>Technical metadata</TableTh>
                      <TableTh>Canonical metadata</TableTh>
                      <TableTh>Result</TableTh>
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {!preview.results?.length && (
                      <TableTr>
                        <TableTd colSpan={5}>
                          <Text ta="center" c="dimmed" py="lg">
                            No source has this filter as its first match.
                          </Text>
                        </TableTd>
                      </TableTr>
                    )}
                    {(preview.results || []).map((row) => (
                      <TableTr key={`${row.content_type}-${row.id}`}>
                        <TableTd>{row.title}</TableTd>
                        <TableTd>
                          <Text size="sm">{row.m3u_account_name}</Text>
                          <Text size="xs" c="dimmed">
                            {row.category_name || '—'}
                          </Text>
                        </TableTd>
                        <TableTd>
                          <Text size="xs">
                            DUB {joinValues(row.audio_languages) || '—'} · SUB{' '}
                            {joinValues(row.subtitle_languages) || '—'}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {row.resolution || '—'} ·{' '}
                            {joinValues(row.video_features) || 'No features'}
                          </Text>
                        </TableTd>
                        <TableTd>
                          <Text size="xs">
                            {joinValues(row.genres) || 'No genre'} ·{' '}
                            {row.year || 'No year'}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {joinValues(row.keywords) || 'No keywords'}
                          </Text>
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
