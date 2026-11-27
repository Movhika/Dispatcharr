import { lazy, Suspense } from 'react';
import { Box, Loader, Modal, Text } from '@mantine/core';

const StreamsTable = lazy(() => import('../tables/StreamsTable'));

// All provider streams, to create channels from them or add them to the
// expanded channel. Opened from the channel list instead of a side panel.
const StreamsDialog = ({ opened, onClose }) => (
  <Modal
    opened={opened}
    onClose={onClose}
    title="Channels from streams"
    size="95vw"
    yOffset="2vh"
  >
    <Text size="sm" c="dimmed" mb="sm">
      Create channels from the selected streams, or add a stream to the channel
      expanded in the list. Streams of your own are entered in a Manual streams
      account.
    </Text>
    {opened && (
      <Box h="78vh" style={{ overflow: 'auto' }}>
        <Suspense fallback={<Loader size="sm" />}>
          <StreamsTable />
        </Suspense>
      </Box>
    )}
  </Modal>
);

export default StreamsDialog;
