import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Flex,
  Group,
  MultiSelect,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
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
import {
  Ban,
  Eye,
  GripVertical,
  Info,
  Plus,
  Save,
  SquarePen,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import API from '../../api';
import { LibraryDialog } from '../LibraryDialogs.jsx';
import { LibraryFilterFields } from '../LibraryFilters.jsx';
import {
  RULE_ACTIONS,
  contentRuleName,
  contentRuleSummary,
  contentRuleUnused,
  newContentRule,
  profileValidation,
  ruleFilters,
  editionSummary,
  featureTagOptions,
  filterTagOptions,
  fieldError,
  firstMessage,
  languageTagOptions,
  renderTagOption,
  resolutionOptions,
} from '../../utils/vodProfiles';

// A field label with its help in a tooltip.
export function HelpLabel({ label, help }) {
  return (
    <Group gap={5} wrap="nowrap">
      <Text span inherit>
        {label}
      </Text>
      <Tooltip
        label={help}
        multiline
        maw={360}
        withArrow
        events={{ hover: true, focus: true, touch: true }}
      >
        <Text
          span
          size="xs"
          c="dimmed"
          tabIndex={0}
          aria-label={`${label} help`}
          style={{ cursor: 'help' }}
        >
          ⓘ
        </Text>
      </Tooltip>
    </Group>
  );
}

// Items have no IDs of their own; their position identifies them.
export function SortableList({ items, onChange, children }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id)
          onChange(arrayMove(items, Number(active.id), Number(over.id)));
      }}
    >
      <SortableContext
        items={items.map((_item, index) => String(index))}
        strategy={verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

function useSortableItem(index) {
  const sortable = useSortable({ id: String(index) });
  return {
    ...sortable,
    style: {
      transform: CSS.Transform.toString(sortable.transform),
      transition: sortable.transition,
      position: 'relative',
      zIndex: sortable.isDragging ? 2 : 0,
    },
  };
}

export function SortableItem({ index, children }) {
  return children(useSortableItem(index));
}

export function DragHandle({ label, sortable, disabled = false }) {
  return (
    <ActionIcon
      aria-label={`Move ${label}`}
      variant="default"
      size="sm"
      color="gray"
      disabled={disabled}
      style={{ cursor: sortable.isDragging ? 'grabbing' : 'grab' }}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <GripVertical size={16} />
    </ActionIcon>
  );
}

// A rule row like an M3U import rule: summarized until edited, highlighted
// while unsaved, red with its problem when invalid, greyed when unused.
export function RuleRow({ error, warning, editing, children }) {
  return (
    <Paper
      withBorder
      p="sm"
      title={editing ? 'Unsaved changes' : undefined}
      data-invalid={error ? 'true' : undefined}
      data-dirty={editing ? 'true' : undefined}
      style={{
        boxShadow: editing
          ? 'inset 3px 0 var(--mantine-color-blue-5)'
          : undefined,
        backgroundColor: error
          ? 'var(--mantine-color-red-light)'
          : editing
            ? 'var(--mantine-color-blue-light)'
            : warning
              ? 'var(--mantine-color-default-hover)'
              : undefined,
      }}
    >
      {children}
    </Paper>
  );
}

export function RuleMarker({ error, warning }) {
  const message = error || warning;
  if (!message) return null;
  return (
    <Tooltip
      label={message}
      events={{ hover: true, focus: true, touch: true }}
      multiline
      w={280}
      withArrow
    >
      <span
        tabIndex={0}
        role="img"
        aria-label={message}
        style={{
          display: 'inline-flex',
          color: error
            ? 'var(--mantine-color-red-6)'
            : 'var(--mantine-color-dimmed)',
        }}
      >
        {error ? (
          <TriangleAlert size={15} aria-hidden="true" />
        ) : (
          <Ban size={15} aria-hidden="true" />
        )}
      </span>
    </Tooltip>
  );
}

export function RuleActions({
  noun,
  editing,
  locked,
  onEdit,
  onSave,
  onDiscard,
  onDelete,
  onPreview,
}) {
  const action = (label, icon, onClick, props = {}) => (
    <Tooltip label={label}>
      <ActionIcon
        aria-label={label}
        variant="subtle"
        onClick={onClick}
        {...props}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
  return (
    <Group gap={4} wrap="nowrap">
      {editing
        ? action(`Save ${noun}`, <Save size={16} />, onSave)
        : action(`Edit ${noun}`, <SquarePen size={16} />, onEdit, {
            color: 'yellow',
            disabled: locked,
          })}
      {onPreview &&
        action(`Preview ${noun}`, <Eye size={16} />, onPreview, {
          disabled: locked && !editing,
        })}
      {editing
        ? action(`Discard ${noun} changes`, <X size={16} />, onDiscard, {
            color: 'gray',
          })
        : action(`Delete ${noun}`, <Trash2 size={16} />, onDelete, {
            color: 'red',
            disabled: locked,
          })}
    </Group>
  );
}

// On narrow screens the hint stacks above its button.
export function RuleIntro({ children, action }) {
  return (
    <Flex
      direction={{ base: 'column', sm: 'row' }}
      align={{ base: 'stretch', sm: 'flex-end' }}
      gap="sm"
    >
      <Alert
        icon={<Info size={16} />}
        color="blue"
        variant="light"
        p={6}
        mih={30}
        style={{ flex: 1, minWidth: 0 }}
        styles={{
          icon: { width: 16, height: 16, marginInlineEnd: 8 },
          wrapper: { alignItems: 'center' },
        }}
      >
        <Text size="xs" lh="16px">
          {children}
        </Text>
      </Alert>
      {action}
    </Flex>
  );
}

const SET_FIELDS = [
  ['audio_languages', 'DUB'],
  ['subtitle_languages', 'SUB'],
  ['video_features', 'features'],
];

function EditionForm({ rule, index, options, errors, update }) {
  const languages = languageTagOptions(options.languages);
  const features = featureTagOptions(options.video_features);
  const resolutions = resolutionOptions(options.resolutions);
  const invalid = (field) =>
    !!fieldError(errors, 'edition_rules', index, field) ||
    (field !== 'title_suffix' &&
      !!fieldError(errors, 'edition_rules', index, 'conditions'));
  const set = (kind, field, label) => (
    <MultiSelect
      key={`${kind}_${field}`}
      label={`${kind === 'required' ? 'Required' : 'Excluded'} ${label}`}
      aria-label={`Edition ${index + 1} ${kind} ${label}`}
      searchable={field !== 'video_features'}
      value={rule[`${kind}_${field}`] || []}
      error={invalid(`${kind}_${field}`)}
      onChange={(value) => update({ [`${kind}_${field}`]: value })}
      data={field === 'video_features' ? features : languages}
      renderOption={renderTagOption}
      filter={filterTagOptions}
    />
  );
  return (
    <Stack gap="xs" mt="xs">
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" verticalSpacing="xs">
        <TextInput
          label={
            <HelpLabel
              label="Name"
              help="Shown next to the title, e.g. Sintel 4K. Without {edition} in the format, it follows the title."
            />
          }
          withAsterisk
          aria-label={`Edition ${index + 1} name`}
          placeholder="e.g. 4K"
          value={rule.title_suffix}
          error={!!fieldError(errors, 'edition_rules', index, 'title_suffix')}
          onChange={(event) =>
            update({ title_suffix: event.currentTarget.value })
          }
        />
        <Select
          label="Minimum"
          aria-label={`Edition ${index + 1} minimum resolution`}
          value={String(rule.min_resolution || 0)}
          allowDeselect={false}
          error={invalid('min_resolution')}
          onChange={(value) => update({ min_resolution: Number(value) })}
          data={resolutions}
        />
        <Select
          label="Maximum"
          aria-label={`Edition ${index + 1} maximum resolution`}
          value={String(rule.max_resolution || 0)}
          allowDeselect={false}
          error={invalid('max_resolution')}
          onChange={(value) => update({ max_resolution: Number(value) })}
          data={resolutions}
        />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" verticalSpacing="xs">
        {SET_FIELDS.map(([field, label]) => set('required', field, label))}
        {SET_FIELDS.map(([field, label]) => set('excluded', field, label))}
      </SimpleGrid>
    </Stack>
  );
}

export function EditionRulesEditor({
  rules,
  options,
  errors,
  countOf = () => null,
  editing,
  onChange,
  onAdd,
  onEdit,
  onSave,
  onDiscard,
}) {
  const update = (index, patch) =>
    onChange(
      rules.map((rule, item) => (item === index ? { ...rule, ...patch } : rule))
    );
  return (
    <Stack gap="sm">
      <RuleIntro
        action={
          <Button
            size="xs"
            leftSection={<Plus size={14} />}
            disabled={editing !== null}
            onClick={onAdd}
          >
            Add edition
          </Button>
        }
      >
        <strong>A source fits one edition at most.</strong> Editions may not
        overlap; exclude values to separate them, e.g. HDR from 4K next to 4K
        HDR.
      </RuleIntro>
      {!rules.length && (
        <Alert color="gray">
          No editions. Compact output keeps one entry per title.
        </Alert>
      )}
      {rules.map((rule, index) => {
        const rowError = firstMessage(errors.edition_rules?.[index]);
        const count = countOf(rule, index);
        const unused = count?.empty || '';
        const name = rule.title_suffix?.trim() || `Edition ${index + 1}`;
        return (
          <RuleRow
            key={index}
            error={rowError}
            warning={unused}
            editing={editing === index}
          >
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <RuleMarker error={rowError} warning={unused} />
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600} truncate>
                    {name}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {[editionSummary(rule), count?.text]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </Stack>
              </Group>
              <RuleActions
                noun={name}
                editing={editing === index}
                locked={editing !== null && editing !== index}
                onEdit={() => onEdit(index)}
                onSave={onSave}
                onDiscard={onDiscard}
                onDelete={() =>
                  onChange(rules.filter((_rule, item) => item !== index))
                }
              />
            </Group>
            {editing === index && (
              <EditionForm
                rule={rule}
                index={index}
                options={options}
                errors={errors}
                update={(patch) => update(index, patch)}
              />
            )}
          </RuleRow>
        );
      })}
    </Stack>
  );
}

// How many sources and titles the Library shows for a rule's filter.
function useRuleCounts(filters) {
  const [counts, setCounts] = useState(null);
  const query = JSON.stringify(ruleFilters(filters));
  useEffect(() => {
    let current = true;
    const count = (view) =>
      API.getVODLibrary(
        new URLSearchParams({
          ...JSON.parse(query),
          blocked: 'false',
          view,
          page: 1,
          page_size: 1,
        })
      ).then((result) => result.count);
    const timer = setTimeout(() => {
      Promise.all([count('sources'), count('titles')])
        .then(([sources, titles]) => current && setCounts({ sources, titles }))
        .catch(() => current && setCounts(null));
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);
  return counts;
}

function ContentRuleDialog({ rule, index, options, onSave, onClose }) {
  const [draft, setDraft] = useState(rule);
  const filters = draft.filters || {};
  const counts = useRuleCounts(filters);
  const errors = profileValidation({ content_rules: [draft] });
  const problem = Object.values(errors.content_rules?.[0] || {})[0];
  const name = contentRuleName(draft, index);
  return (
    <LibraryDialog
      title={
        index === null ? 'Add rule' : `Edit ${contentRuleName(rule, index)}`
      }
      dirty={JSON.stringify(draft) !== JSON.stringify(rule)}
      onClose={onClose}
      size="lg"
    >
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput
            label="Name"
            placeholder={name}
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.currentTarget.value })
            }
          />
          <Stack gap={2}>
            <HelpLabel
              label="Result"
              help="Sources this filter shows in the Library are included or excluded. The first matching rule decides."
            />
            <SegmentedControl
              aria-label="Rule result"
              data={RULE_ACTIONS}
              value={draft.action}
              onChange={(action) => setDraft({ ...draft, action })}
            />
          </Stack>
        </SimpleGrid>
        <Group justify="space-between" gap="xs">
          <Text size="sm" fw={600}>
            Filter
          </Text>
          {counts && (
            <Badge variant="light">
              {`${counts.sources.toLocaleString()} sources · ${counts.titles.toLocaleString()} titles`}
            </Badge>
          )}
        </Group>
        <ScrollArea.Autosize mah="min(560px, calc(100dvh - 300px))" type="auto">
          <LibraryFilterFields
            filters={filters}
            onChange={(patch) =>
              setDraft({ ...draft, filters: { ...filters, ...patch } })
            }
            options={options}
          />
        </ScrollArea.Autosize>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Tooltip label={problem} disabled={!problem}>
            <Button disabled={!!problem} onClick={() => onSave(draft)}>
              Save rule
            </Button>
          </Tooltip>
        </Group>
      </Stack>
    </LibraryDialog>
  );
}

export function ContentRulesEditor({ rules, errors, onChange, active = true }) {
  // The Library's accounts, categories and values, also for the summaries;
  // loaded once the rules are shown.
  const [loaded, setLoaded] = useState(null);
  const [editing, setEditing] = useState(null);
  useEffect(() => {
    if (!active || loaded) return;
    API.getVODLibraryOptions()
      .then((options) => setLoaded(options || {}))
      .catch(() => setLoaded({}));
  }, [active, loaded]);
  const options = useMemo(() => loaded || {}, [loaded]);
  const update = (index, patch) =>
    onChange(
      rules.map((rule, item) => (item === index ? { ...rule, ...patch } : rule))
    );
  const save = (rule) => {
    onChange(
      editing.index === null
        ? [...rules, rule]
        : rules.map((item, index) => (index === editing.index ? rule : item))
    );
    setEditing(null);
  };
  return (
    <Stack gap="sm">
      <RuleIntro
        action={
          <Button
            size="xs"
            leftSection={<Plus size={14} />}
            onClick={() => setEditing({ index: null, rule: newContentRule() })}
          >
            Add rule
          </Button>
        }
      >
        <strong>The first matching rule decides each source.</strong> Once a
        rule includes sources, sources no rule matches are left out; rules that
        only exclude keep every other source.
      </RuleIntro>
      {!rules.length && (
        <Alert color="gray">No rules. The profile offers every source.</Alert>
      )}
      <SortableList items={rules} onChange={onChange}>
        {rules.map((rule, index) => {
          const rowError = firstMessage(errors.content_rules?.[index]);
          const unused = contentRuleUnused(rules, index);
          const name = contentRuleName(rule, index);
          return (
            <SortableItem key={rule.id || index} index={index}>
              {(sortable) => (
                <div ref={sortable.setNodeRef} style={sortable.style}>
                  <RuleRow error={rowError} warning={unused} editing={false}>
                    <Group justify="space-between" wrap="nowrap" gap="sm">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        <DragHandle label={name} sortable={sortable} />
                        <RuleMarker error={rowError} warning={unused} />
                        <Badge
                          variant="light"
                          color={rule.action === 'include' ? 'green' : 'red'}
                          style={{ flexShrink: 0 }}
                        >
                          {rule.action === 'include' ? 'Include' : 'Exclude'}
                        </Badge>
                        <Stack gap={0} style={{ minWidth: 0 }}>
                          <Text size="sm" fw={600} truncate>
                            {name}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            {contentRuleSummary(rule, options)}
                          </Text>
                        </Stack>
                      </Group>
                      <Group gap="xs" wrap="nowrap">
                        <Switch
                          aria-label={`${name} enabled`}
                          checked={rule.enabled !== false}
                          onChange={(event) =>
                            update(index, {
                              enabled: event.currentTarget.checked,
                            })
                          }
                        />
                        <RuleActions
                          noun={name}
                          editing={false}
                          locked={false}
                          onEdit={() => setEditing({ index, rule })}
                          onDelete={() =>
                            onChange(
                              rules.filter((_rule, item) => item !== index)
                            )
                          }
                        />
                      </Group>
                    </Group>
                  </RuleRow>
                </div>
              )}
            </SortableItem>
          );
        })}
      </SortableList>
      {editing && (
        <ContentRuleDialog
          rule={editing.rule}
          index={editing.index}
          options={options}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}
