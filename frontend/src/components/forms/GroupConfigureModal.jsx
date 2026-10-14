// Per-group settings opened from the gear icon. The parent owns the draft
// and restores its open-time snapshot when the user cancels.

import React from 'react';
import { Button, Modal, Stack, Group, Text } from '@mantine/core';

const GroupConfigureModal = ({ opened, onDone, onCancel, group, children }) => {
  if (!group) return null;
  const streamCount =
    typeof group.stream_count === 'number' ? group.stream_count : null;

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      withCloseButton={false}
      size="lg"
      title={
        <Group gap="xs">
          <Text fw={600}>Configure: {group.name}</Text>
          {streamCount !== null && (
            <Text size="xs" c="dimmed">
              ({streamCount} stream{streamCount === 1 ? '' : 's'} available)
            </Text>
          )}
        </Group>
      }
      styles={{ content: { '--mantine-color-body': '#27272A' } }}
    >
      <Stack gap="md">{children}</Stack>
      {/* Done keeps in-memory edits routed into the parent's groupStates
          (parent's Save persists them). Cancel reverts to
          the open-time snapshot. */}
      <Group justify="flex-end" gap="xs" mt="md">
        <Button variant="default" onClick={onCancel} size="xs">
          Cancel
        </Button>
        <Button variant="filled" color="blue" onClick={onDone} size="xs">
          Done
        </Button>
      </Group>
    </Modal>
  );
};

export default GroupConfigureModal;
