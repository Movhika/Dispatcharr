import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { RefreshCw } from 'lucide-react';
import API from '../../../api';

const formatBytes = (value) => {
  const bytes = Number(value) || 0;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

const Meter = ({ title, value, total, percent, detail }) => (
  <Paper withBorder p="md">
    <Stack gap={6}>
      <Group justify="space-between">
        <Text fw={600}>{title}</Text>
        <Text size="sm">{Number(percent || 0).toFixed(1)}%</Text>
      </Group>
      <Progress value={Number(percent) || 0} />
      <Text size="sm" c="dimmed">
        {formatBytes(value)} / {formatBytes(total)}
        {detail ? ` · ${detail}` : ''}
      </Text>
    </Stack>
  </Paper>
);

const SystemResourcesPanel = ({ active = true }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await API.getSystemResources());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, [active, load]);

  return (
    <Stack>
      <Group justify="space-between">
        <Stack gap={0}>
          <Text fw={600}>Dispatcharr resources</Text>
          <Text size="sm" c="dimmed">
            Live process, container memory and data-volume usage.
          </Text>
        </Stack>
        <Button
          variant="default"
          size="xs"
          leftSection={<RefreshCw size={14} />}
          loading={loading}
          onClick={load}
        >
          Refresh
        </Button>
      </Group>
      {data && (
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Meter
            title="Memory"
            value={data.memory.used_bytes}
            total={data.memory.total_bytes}
            percent={data.memory.percent}
            detail={`app ${formatBytes(data.process.memory_bytes)}`}
          />
          <Meter
            title="Storage"
            value={data.storage.used_bytes}
            total={data.storage.total_bytes}
            percent={data.storage.percent}
            detail={data.storage.path}
          />
          <Paper withBorder p="md">
            <Group justify="space-between">
              <Text fw={600}>App process</Text>
              <Text size="sm">
                CPU {Number(data.process.cpu_percent || 0).toFixed(1)}%
              </Text>
            </Group>
            <Text size="sm" c="dimmed">
              {data.process.threads} threads · started{' '}
              {new Date(data.process.started_at * 1000).toLocaleString()}
            </Text>
          </Paper>
        </SimpleGrid>
      )}
    </Stack>
  );
};

export default SystemResourcesPanel;
