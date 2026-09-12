import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@mantine/core';
import { DatabaseZap } from 'lucide-react';
import API from '../api';
import { showNotification } from '../utils/notificationUtils';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const wait = (milliseconds) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const VODEnrichmentButton = ({
  contentId,
  contentType,
  enriched = false,
  onComplete,
}) => {
  const [running, setRunning] = useState(false);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const start = async () => {
    setRunning(true);
    try {
      const response = await API.refreshVODMetadata([
        { id: contentId, content_type: contentType },
      ]);
      const taskId = response?.state?.task_id || response?.task_id || '';
      showNotification({
        title: 'TMDB enrichment started',
        message: 'This canonical title is being refreshed in the background.',
        color: 'green',
      });

      const startedAt = Date.now();
      while (mountedRef.current && Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await wait(POLL_INTERVAL_MS);
        if (!mountedRef.current) return;
        const status = await API.getVODMetadataStatus();
        const state = status?.state || {};
        if (taskId && state.task_id && state.task_id !== taskId) continue;
        if (state.status === 'failed') {
          throw new Error(state.error || 'TMDB enrichment failed.');
        }
        if (state.status === 'complete') {
          await onComplete?.();
          showNotification({
            title: 'TMDB metadata updated',
            message: 'The detail view now uses the refreshed metadata.',
            color: 'green',
          });
          return;
        }
      }

      showNotification({
        title: 'TMDB enrichment is still running',
        message: 'It continues in the background. Reopen the title to see it later.',
        color: 'blue',
      });
    } catch (error) {
      showNotification({
        title: 'TMDB enrichment was not started',
        message: error?.body?.detail || error?.message || 'Please retry.',
        color: 'red',
      });
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  };

  return (
    <Button
      size="xs"
      variant="default"
      leftSection={<DatabaseZap size={15} />}
      loading={running}
      disabled={running}
      onClick={start}
    >
      {enriched ? 'Refresh TMDB' : 'Enrich with TMDB'}
    </Button>
  );
};

export default VODEnrichmentButton;
