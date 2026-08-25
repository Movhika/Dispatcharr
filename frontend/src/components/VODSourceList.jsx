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
import { videoFeatureLabel } from '../utils/vodMetadataOptions.js';

const valuesFor = (provider, selectedProvider, selectedSourceMetadata) => {
  const stored = provider?.source_metadata?.values || {};
  if (selectedProvider?.id === provider?.id && selectedSourceMetadata?.values) {
    return { ...stored, ...selectedSourceMetadata.values };
  }
  return stored;
};

const metadataLanguages = (values, field) => {
  const raw = values[field];
  const languages = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return languages.map((value) => String(value).toUpperCase());
};

const positiveNumber = (value) => {
  const number = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? number : null;
};

const formatBitrate = (values) => {
  const bitrate = positiveNumber(values.bitrate_kbps ?? values.bitrate);
  if (!bitrate) return null;
  if (bitrate >= 1000) {
    const mbps = bitrate / 1000;
    return `${mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)} Mbps`;
  }
  return `${Math.round(bitrate)} kbps`;
};

const formatFileSize = (value) => {
  const bytes = positiveNumber(value);
  if (!bytes) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1000)),
    units.length - 1
  );
  const amount = bytes / 1000 ** unitIndex;
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
};

const formatFrameRate = (value) => {
  if (!value) return null;
  const [numerator, denominator] = String(value).split('/').map(Number);
  const fps = denominator ? numerator / denominator : Number(value);
  if (!Number.isFinite(fps) || fps <= 0) return null;
  return `${Number.isInteger(fps) ? fps : fps.toFixed(2)} FPS`;
};

const LanguageBadges = ({ values, field, color }) => {
  const languages = metadataLanguages(values, field);
  if (!languages.length) return <Text c="dimmed">—</Text>;
  return (
    <Group gap={4} wrap="wrap">
      {languages.map((language) => (
        <Badge key={language} color={color} variant="light">
          {language}
        </Badge>
      ))}
    </Group>
  );
};

const MovieDetails = ({ values, provider }) => {
  const details = [
    {
      value: values.container_extension || provider.container_extension,
      uppercase: true,
    },
    { value: formatBitrate(values) },
    { value: formatFileSize(values.file_size_bytes) },
    {
      value: values.video_codec || values.video?.codec_name,
      uppercase: true,
    },
    {
      value: values.audio_codec || values.audio?.codec_name,
      uppercase: true,
    },
    {
      value: formatFrameRate(
        values.frame_rate ||
          values.video?.avg_frame_rate ||
          values.video?.r_frame_rate
      ),
    },
    ...(values.video_features || []).map((value) => ({
      value: videoFeatureLabel(value),
      uppercase: true,
    })),
  ];
  const visibleDetails = details.filter(({ value }) => Boolean(value));
  if (!visibleDetails.length) return <Text c="dimmed">—</Text>;
  return (
    <Group gap={4} wrap="wrap">
      {visibleDetails.map(({ value, uppercase }, index) => (
        <Badge key={`${value}-${index}`} color="gray" variant="light">
          {uppercase ? String(value).toUpperCase() : value}
        </Badge>
      ))}
    </Group>
  );
};

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
  selectedSourceMetadata,
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
      miw={contentType === 'movie' ? 1120 : 820}
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
          <TableTh w={140}>DUB</TableTh>
          <TableTh w={140}>SUB</TableTh>
          <TableTh w={110}>Resolution</TableTh>
          {contentType === 'movie' && <TableTh w={320}>Details</TableTh>}
          <TableTh w={contentType === 'movie' ? 132 : 88}>Actions</TableTh>
        </TableTr>
      </TableThead>
      <TableTbody>
        {providers.map((provider) => {
          const values = valuesFor(
            provider,
            selectedProvider,
            selectedSourceMetadata
          );
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
                <LanguageBadges
                  values={values}
                  field="audio_languages"
                  color="blue"
                />
              </TableTd>
              <TableTd>
                <LanguageBadges
                  values={values}
                  field="subtitle_languages"
                  color="cyan"
                />
              </TableTd>
              <TableTd>
                <Badge color="teal" variant="light">
                  {values.resolution ||
                    (values.height ? `${values.height}p` : '—')}
                </Badge>
              </TableTd>
              {contentType === 'movie' && (
                <TableTd>
                  <MovieDetails values={values} provider={provider} />
                </TableTd>
              )}
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
