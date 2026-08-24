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
import { Check, Copy, Play, Wrench } from 'lucide-react';

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
      miw={900}
      aria-label="Exact VOD sources"
    >
      <TableThead>
        <TableTr>
          <TableTh>Source</TableTh>
          <TableTh>M3U account</TableTh>
          <TableTh>Category</TableTh>
          <TableTh>DUB</TableTh>
          <TableTh>SUB</TableTh>
          <TableTh>Resolution</TableTh>
          <TableTh>Format</TableTh>
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
                outline: selected
                  ? '1px solid var(--mantine-color-blue-6)'
                  : undefined,
                outlineOffset: -1,
              }}
            >
              <TableTd>
                <Stack gap={1}>
                  <Text size="sm" fw={500} lineClamp={1}>
                    {sourceName(provider, contentType)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {contentType === 'movie'
                      ? `Stream ID: ${provider.stream_id || '—'}`
                      : `Provider series ID: ${provider.external_series_id || '—'}`}
                    {' · '}Relation ID: {provider.id}
                  </Text>
                </Stack>
              </TableTd>
              <TableTd>{provider.m3u_account?.name || 'Unknown'}</TableTd>
              <TableTd>
                <Badge color="blue" variant="light">
                  {provider.category?.name || 'Uncategorized'}
                </Badge>
              </TableTd>
              <TableTd>{joinLanguages(values, 'audio_languages')}</TableTd>
              <TableTd>{joinLanguages(values, 'subtitle_languages')}</TableTd>
              <TableTd>
                {values.resolution ||
                  (values.height ? `${values.height}p` : '—')}
              </TableTd>
              <TableTd>
                {values.container_extension ||
                  provider.container_extension ||
                  '—'}
              </TableTd>
              <TableTd>
                <Group gap={5} wrap="nowrap">
                  {contentType === 'series' && (
                    <Tooltip
                      label={selected ? 'Selected source' : 'Show episodes'}
                    >
                      <ActionIcon
                        aria-label={
                          selected ? 'Selected source' : 'Select source'
                        }
                        variant={selected ? 'filled' : 'light'}
                        color={selected ? 'green' : 'blue'}
                        disabled={disabled}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect?.(provider);
                        }}
                      >
                        <Check size={15} />
                      </ActionIcon>
                    </Tooltip>
                  )}
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
