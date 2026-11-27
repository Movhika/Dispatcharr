import React, { useCallback, useRef } from 'react';
import ChannelsTable from '../components/tables/ChannelsTable';
import { Box } from '@mantine/core';
import useAuthStore from '../store/auth';
import useLogosStore from '../store/logos';
import ErrorBoundary from '../components/ErrorBoundary';

// One channel list. Streams are added inside an expanded channel or from the
// streams dialog in the list header.
const PageContent = () => {
  const authUser = useAuthStore((s) => s.user);
  const fetchChannelAssignableLogos = useLogosStore(
    (s) => s.fetchChannelAssignableLogos
  );
  const enableLogoRendering = useLogosStore((s) => s.enableLogoRendering);
  const logosTriggered = useRef(false);

  const handleChannelsReady = useCallback(() => {
    if (logosTriggered.current) return;
    logosTriggered.current = true;
    // Defer logo loading until after the browser painted the table.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        enableLogoRendering();
        fetchChannelAssignableLogos();
      });
    });
  }, [fetchChannelAssignableLogos, enableLogoRendering]);

  if (!authUser.id) return <></>;

  return (
    <Box style={{ padding: 10 }}>
      <ChannelsTable onReady={handleChannelsReady} />
    </Box>
  );
};

const ChannelsPage = () => {
  return (
    <ErrorBoundary inline>
      <PageContent />
    </ErrorBoundary>
  );
};

export default ChannelsPage;
