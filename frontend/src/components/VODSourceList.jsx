import React from 'react';
import {
  ActionIcon,
  Badge,
  Group,
  ScrollArea,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Tooltip,
} from '@mantine/core';
import { Copy, Play, Wrench } from 'lucide-react';

const valuesFor = (provider) => provider?.source_metadata?.values || {};
const joinLanguages = (values, field) =>
  (values[field] || [])
    .map((value) => String(value).toUpperCase())
    .join(', ') || '—';

const sourceName = (provider, contentType) => {
  const properties = provider?.custom_properties || {};
  const detail = properties.detailed_info || {};
  const basic = properties.basic_data || properties.movie_data || {};
  return (
    provider?.stream_name ||
    detail.name ||
    basic.name ||
    provider?.movie?.name ||
    provider?.series?.name ||
    (contentType === 'series'
      ? `Series ${provider?.external_series_id || provider?.id}`
      : `Stream ${provider?.stream_id || provider?.id}`)
  );
};

const VODSourceList = ({
  providers,
  selectedProvider,
  contentType,
  disabled = false,
  onSelect,
  onEdit,
  onPlay,
  onCopy,
}) => (
  <ScrollArea type="auto">
    <Table
      striped
      highlightOnHover
      withTableBorder
      layout="fixed"
      aria-label="Exact VOD sources"
    >
      <TableThead>
        <TableTr>
          <TableTh>
            <Stack gap={0}>
              <Text inherit fw={700}>
                Source
              </Text>
              <Group gap={4} wrap="nowrap">
                <Text size="xs" c="dimmed">
                  M3U account
                </Text>
                <Text size="xs" c="dimmed">
                  ·
                </Text>
                <Text size="xs" c="dimmed">
                  Category
                </Text>
                <Text size="xs" c="dimmed">
                  · IDs
                </Text>
              </Group>
            </Stack>
          </TableTh>
          <TableTh w="42%">Technical metadata</TableTh>
          <TableTh w={contentType === 'movie' ? 132 : 88}>Actions</TableTh>
        </TableTr>
      </TableThead>
      <TableTbody>
        {providers.map((provider) => {
          const values = valuesFor(provider);
          const selected = selectedProvider?.id === provider.id;
          return (
            <TableTr
              key={provider.id}
              data-selected={selected || undefined}
              onClick={() => onSelect?.(provider)}
              style={{
                cursor: 'pointer',
                backgroundColor: selected
                  ? 'var(--mantine-color-blue-light)'
                  : undefined,
                boxShadow: selected
                  ? 'inset 3px 0 var(--mantine-color-blue-6)'
                  : undefined,
              }}
            >
              <TableTd>
                <Stack gap={1}>
                  <Text size="sm" fw={500} lineClamp={1}>
                    {sourceName(provider, contentType)}
                  </Text>
                  <Group gap={4} wrap="wrap">
                    <Text size="xs" c="dimmed">
                      {provider.m3u_account?.name || 'Unknown'}
                    </Text>
                    <Text size="xs" c="dimmed">
                      ·
                    </Text>
                    <Text size="xs" c="dimmed">
                      {provider.category?.name || 'Uncategorized'}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {contentType === 'movie'
                      ? `Stream ID: ${provider.stream_id || '—'}`
                      : `Provider series ID: ${provider.external_series_id || '—'}`}
                    {' · '}Relation ID: {provider.id}
                  </Text>
                </Stack>
              </TableTd>
              <TableTd>
                <Group gap={5} wrap="wrap">
                  <Badge color="blue" variant="light">
                    DUB {joinLanguages(values, 'audio_languages')}
                  </Badge>
                  <Badge color="cyan" variant="light">
                    SUB {joinLanguages(values, 'subtitle_languages')}
                  </Badge>
                  <Badge color="teal" variant="light">
                    {values.resolution ||
                      (values.height ? `${values.height}p` : '—')}
                  </Badge>
                  <Badge color="gray" variant="light">
                    {values.container_extension ||
                      provider.container_extension ||
                      '—'}
                  </Badge>
                </Group>
              </TableTd>
              <TableTd>
                <Group gap={5} wrap="nowrap">
                  {contentType === 'movie' && (
                    <>
                      <Tooltip label="Play this exact source">
                        <ActionIcon
                          aria-label="Play exact source"
                          variant="filled"
                          color="blue"
                          disabled={disabled}
                          onClick={(event) => {
                            event.stopPropagation();
                            onPlay?.(provider);
                          }}
                        >
                          <Play size={15} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Copy link for this exact source">
                        <ActionIcon
                          aria-label="Copy exact source link"
                          variant="light"
                          color="gray"
                          disabled={disabled}
                          onClick={(event) => {
                            event.stopPropagation();
                            onCopy?.(provider);
                          }}
                        >
                          <Copy size={15} />
                        </ActionIcon>
                      </Tooltip>
                    </>
                  )}
                  <Tooltip label="Edit this exact source">
                    <ActionIcon
                      aria-label="Edit exact source metadata"
                      variant="light"
                      color="gray"
                      disabled={disabled}
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit?.(provider);
                      }}
                    >
                      <Wrench size={15} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </TableTd>
            </TableTr>
          );
        })}
      </TableTbody>
    </Table>
  </ScrollArea>
);

export default VODSourceList;
