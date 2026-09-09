import React from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
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
import { GripVertical, Info, Plus, Trash2 } from 'lucide-react';
import LanguagePicker from './LanguagePicker.jsx';
import VideoFeaturePicker from './VideoFeaturePicker.jsx';
import { RESOLUTION_LIMIT_OPTIONS } from '../utils/vodMetadataOptions.js';

const RULE_DEFAULTS = {
  name: '',
  title_suffix: '',
  enabled: true,
  match_field: 'any',
  regex_pattern: '',
  case_sensitive: false,
  min_resolution: 0,
  max_resolution: 0,
  required_audio_languages: [],
  required_subtitle_languages: [],
  required_video_features: [],
};

const createRule = () => ({
  ...RULE_DEFAULTS,
  id: `edition-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
});

const SortableEdition = ({ rule, update, remove }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rule.id });
  const expressionDisabled = rule.match_field === 'any';

  return (
    <Paper
      ref={setNodeRef}
      withBorder
      p="sm"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.65 : rule.enabled ? 1 : 0.55,
        position: 'relative',
        zIndex: isDragging ? 2 : 0,
      }}
    >
      <Group align="flex-end" wrap="wrap">
        <ActionIcon
          aria-label={`Move edition ${rule.name || 'rule'}`}
          variant="subtle"
          color="gray"
          mb={3}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={17} />
        </ActionIcon>
        <TextInput
          label="Edition"
          placeholder="For example 3D"
          value={rule.name}
          onChange={(event) => update({ name: event.currentTarget.value })}
          w={170}
        />
        <TextInput
          label="Title suffix"
          placeholder="For example 3D"
          value={rule.title_suffix}
          onChange={(event) =>
            update({ title_suffix: event.currentTarget.value })
          }
          w={170}
        />
        <Select
          label="Name match"
          data={[
            { value: 'any', label: 'No name condition' },
            { value: 'category', label: 'Source category' },
            { value: 'stream', label: 'Source title' },
          ]}
          value={rule.match_field}
          onChange={(match_field) => update({ match_field })}
          w={175}
        />
        <TextInput
          label="Expression"
          placeholder={expressionDisabled ? 'Not used' : 'Regular expression'}
          disabled={expressionDisabled}
          value={rule.regex_pattern}
          onChange={(event) =>
            update({ regex_pattern: event.currentTarget.value })
          }
          style={{ flex: 1, minWidth: 190 }}
        />
        <Select
          label="Minimum"
          data={RESOLUTION_LIMIT_OPTIONS}
          value={String(rule.min_resolution || 0)}
          onChange={(value) => update({ min_resolution: Number(value || 0) })}
          w={120}
        />
        <Select
          label="Maximum"
          data={RESOLUTION_LIMIT_OPTIONS}
          value={String(rule.max_resolution || 0)}
          onChange={(value) => update({ max_resolution: Number(value || 0) })}
          w={120}
        />
        <ActionIcon
          aria-label={`Delete edition ${rule.name || 'rule'}`}
          color="red"
          variant="subtle"
          mb={3}
          onClick={remove}
        >
          <Trash2 size={16} />
        </ActionIcon>
      </Group>
      <Group mt="sm" align="flex-end" wrap="wrap">
        <LanguagePicker
          label="Required DUB"
          size="xs"
          value={rule.required_audio_languages}
          onChange={(required_audio_languages) =>
            update({ required_audio_languages })
          }
        />
        <LanguagePicker
          label="Required SUB"
          size="xs"
          value={rule.required_subtitle_languages}
          onChange={(required_subtitle_languages) =>
            update({ required_subtitle_languages })
          }
        />
        <VideoFeaturePicker
          label="Required features"
          value={rule.required_video_features}
          onChange={(required_video_features) =>
            update({ required_video_features })
          }
          emptyLabel="Any feature"
        />
        <Switch
          label="Case-sensitive expression"
          disabled={expressionDisabled}
          checked={rule.case_sensitive}
          onChange={(event) =>
            update({ case_sensitive: event.currentTarget.checked })
          }
          mb={8}
        />
        <Switch
          label="Enabled"
          checked={rule.enabled}
          onChange={(event) => update({ enabled: event.currentTarget.checked })}
          mb={8}
        />
      </Group>
    </Paper>
  );
};

const VODEditionRules = ({ value = [], onChange }) => {
  const rules = value.map((rule, index) => ({
    ...RULE_DEFAULTS,
    ...rule,
    id: rule.id || `edition-${index}`,
  }));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const update = (id, changes) =>
    onChange(
      rules.map((rule) => (rule.id === id ? { ...rule, ...changes } : rule))
    );
  const remove = (id) => onChange(rules.filter((rule) => rule.id !== id));
  const reorder = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = rules.findIndex((rule) => rule.id === active.id);
    const to = rules.findIndex((rule) => rule.id === over.id);
    if (from >= 0 && to >= 0) onChange(arrayMove(rules, from, to));
  };

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Alert icon={<Info size={16} />} color="blue" variant="light">
          <Text size="sm">
            <strong>First match wins.</strong> Compact creates one client entry
            per canonical title and matched edition. Failover stays inside that
            edition. Unmatched sources share the title&apos;s default edition.
          </Text>
        </Alert>
        <Button
          variant="default"
          size="xs"
          leftSection={<Plus size={14} />}
          onClick={() => onChange([...rules, createRule()])}
        >
          Add edition
        </Button>
      </Group>
      {!rules.length ? (
        <Alert color="gray">
          No edition rules. Compact keeps one entry per canonical title.
        </Alert>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={reorder}
        >
          <SortableContext
            items={rules.map((rule) => rule.id)}
            strategy={verticalListSortingStrategy}
          >
            <Stack gap="sm">
              {rules.map((rule) => (
                <SortableEdition
                  key={rule.id}
                  rule={rule}
                  update={(changes) => update(rule.id, changes)}
                  remove={() => remove(rule.id)}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      )}
    </Stack>
  );
};

export default VODEditionRules;
