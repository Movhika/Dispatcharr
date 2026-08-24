import React, { useMemo } from 'react';
import { ActionIcon, Group, Paper, Select, Stack, Text } from '@mantine/core';
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
import { GripVertical } from 'lucide-react';
import { normalizeVODFailoverRanking } from '../utils/vodFailoverRanking.js';

const criterionDetails = (criterion) => {
  if (criterion === 'audio_language') {
    return {
      title: 'DUB language preference',
      description: 'Uses the order of the allowed DUB languages above.',
    };
  }
  if (criterion === 'subtitle_language') {
    return {
      title: 'SUB language preference',
      description: 'Uses the order of the allowed SUB languages above.',
    };
  }
  if (criterion === 'metadata_completeness') {
    return {
      title: 'Known metadata first',
      description: 'Prefers sources with more known technical metadata.',
    };
  }
  return {
    title: 'Resolution',
    description: 'Controls quality preference within the configured limits.',
  };
};

const SortableCriterion = ({ criterion, onResolutionDirectionChange }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: criterion });
  const details = criterionDetails(criterion);

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
      <Group wrap="nowrap" justify="space-between">
        <Group wrap="nowrap">
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={`Move ${details.title}`}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={17} />
          </ActionIcon>
          <Stack gap={0}>
            <Text size="sm" fw={600}>
              {details.title}
            </Text>
            <Text size="xs" c="dimmed">
              {details.description}
            </Text>
          </Stack>
        </Group>
        {(criterion === 'resolution_desc' ||
          criterion === 'resolution_asc') && (
          <Select
            aria-label="Resolution preference"
            w={180}
            data={[
              { value: 'resolution_desc', label: 'Highest first' },
              { value: 'resolution_asc', label: 'Lowest first' },
            ]}
            value={criterion}
            onChange={onResolutionDirectionChange}
          />
        )}
      </Group>
    </Paper>
  );
};

const VODFailoverRanking = ({ value, onChange }) => {
  const ranking = useMemo(() => normalizeVODFailoverRanking(value), [value]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const moveCriterion = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = ranking.indexOf(active.id);
    const newIndex = ranking.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(ranking, oldIndex, newIndex));
  };

  const changeResolutionDirection = (current, next) => {
    if (!next || current === next) return;
    onChange(
      ranking.map((criterion) => (criterion === current ? next : criterion))
    );
  };

  return (
    <Stack gap="xs">
      <Stack gap={0}>
        <Text fw={500}>Failover priority</Text>
        <Text size="sm" c="dimmed">
          Drag criteria into priority order. Categories remain access boundaries
          and are deliberately not used for failover ranking.
        </Text>
      </Stack>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={moveCriterion}
      >
        <SortableContext items={ranking} strategy={verticalListSortingStrategy}>
          <Stack gap={6}>
            {ranking.map((criterion) => (
              <SortableCriterion
                key={criterion}
                criterion={criterion}
                onResolutionDirectionChange={(next) =>
                  changeResolutionDirection(criterion, next)
                }
              />
            ))}
          </Stack>
        </SortableContext>
      </DndContext>
    </Stack>
  );
};

export default VODFailoverRanking;
