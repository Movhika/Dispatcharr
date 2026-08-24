import React, { useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from '@mantine/core';
import { RefreshCw, Wrench } from 'lucide-react';
import API from '../api';
import { showNotification } from '../utils/notificationUtils';
import { normalizeLanguageCodes } from '../utils/languageCodes.js';
import LanguagePicker from './LanguagePicker.jsx';
import {
  CONTAINER_EXTENSION_OPTIONS,
  RESOLUTION_VALUES,
} from '../utils/vodMetadataOptions.js';

const normalizeList = (response) => response?.results || response || [];
const formatBytes = (value) =>
  `${(Number(value || 0) / 1024 / 1024).toFixed(1)} MB`;
const metadataSummary = (playback) => {
  const metadata = playback.source_effective_metadata?.values || {};
  return [
    metadata.resolution || (metadata.height ? `${metadata.height}p` : null),
    (metadata.audio_languages || metadata.languages || []).length
      ? `Audio: ${(metadata.audio_languages || metadata.languages).join(', ')}`
      : null,
    (metadata.subtitle_languages || []).length
      ? `Subs: ${metadata.subtitle_languages.join(', ')}`
      : null,
    metadata.container_extension
      ? `Format: ${metadata.container_extension}`
      : null,
  ]
    .filter(Boolean)
    .join(' • ');
};

const VODSourceManagerModal = ({ opened, onClose }) => {
  const [playbacks, setPlaybacks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [manualPlayback, setManualPlayback] = useState(null);
  const [manualMetadata, setManualMetadata] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      setPlaybacks(normalizeList(await API.getVODPlaybackSessions()));
    } catch (error) {
      setPlaybacks([]);
      showNotification({
        title: 'Playback history unavailable',
        message: error?.message || 'The playback history could not be loaded.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (opened) load();
  }, [opened]);

  const openManualEditor = (playback) => {
    const effective = playback.source_effective_metadata || {};
    const values = effective.values || {};
    const provenance = effective.provenance || {};
    setManualMetadata(
      Object.fromEntries(
        Object.entries(values).filter(([key]) => provenance[key] === 'manual')
      )
    );
    setManualPlayback(playback);
  };

  const saveManualMetadata = async () => {
    const metadata = Object.fromEntries(
      Object.entries(manualMetadata).filter(
        ([, value]) =>
          value !== '' &&
          value !== null &&
          value !== undefined &&
          (!Array.isArray(value) || value.length > 0)
      )
    );
    if (metadata.audio_languages) {
      metadata.audio_languages = normalizeLanguageCodes(
        metadata.audio_languages
      );
    }
    if (metadata.subtitle_languages) {
      metadata.subtitle_languages = normalizeLanguageCodes(
        metadata.subtitle_languages
      );
    }
    await API.updateVODSourceManualMetadata(
      manualPlayback.source_asset,
      metadata,
      Object.keys(metadata)
    );
    showNotification({
      title: 'Source metadata saved',
      message: 'Manual values are locked against later observations.',
      color: 'green',
    });
    setManualPlayback(null);
    await load();
  };

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title="VOD playback history"
        size="95vw"
        scrollAreaComponent={Modal.NativeScrollArea}
      >
        <Stack>
          <Group justify="space-between">
            <Alert color="blue" variant="light" style={{ flex: 1 }}>
              Proxy playback is recorded automatically with transferred bytes
              and watch time. Redirect entries remain unconfirmed. Technical
              values can be corrected manually and will then stay locked.
            </Alert>
            <Button
              variant="default"
              leftSection={<RefreshCw size={15} />}
              loading={loading}
              onClick={load}
            >
              Refresh
            </Button>
          </Group>
          <ScrollArea h="68vh">
            <Table stickyHeader striped withTableBorder>
              <TableThead>
                <TableTr>
                  <TableTh>Started</TableTh>
                  <TableTh>Title</TableTh>
                  <TableTh>Source</TableTh>
                  <TableTh>User</TableTh>
                  <TableTh>Status</TableTh>
                  <TableTh>Watch time</TableTh>
                  <TableTh>Data</TableTh>
                  <TableTh>Technical metadata</TableTh>
                  <TableTh w={60}>Edit</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {!loading && playbacks.length === 0 && (
                  <TableTr>
                    <TableTd colSpan={9}>
                      <Text c="dimmed" ta="center" py="lg">
                        No VOD playback has been recorded yet.
                      </Text>
                    </TableTd>
                  </TableTr>
                )}
                {playbacks.map((playback) => (
                  <TableTr key={playback.id}>
                    <TableTd>
                      {new Date(playback.started_at).toLocaleString()}
                    </TableTd>
                    <TableTd>{playback.content_name}</TableTd>
                    <TableTd>
                      {playback.account_name}
                      {playback.category_name
                        ? ` — ${playback.category_name}`
                        : ''}
                    </TableTd>
                    <TableTd>{playback.username || '—'}</TableTd>
                    <TableTd>{playback.status}</TableTd>
                    <TableTd>{playback.watched_seconds || 0}s</TableTd>
                    <TableTd>{formatBytes(playback.bytes_sent)}</TableTd>
                    <TableTd>{metadataSummary(playback) || 'Unknown'}</TableTd>
                    <TableTd>
                      <ActionIcon
                        aria-label="Edit source metadata"
                        variant="subtle"
                        disabled={!playback.source_asset}
                        onClick={() => openManualEditor(playback)}
                      >
                        <Wrench size={16} />
                      </ActionIcon>
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </ScrollArea>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(manualPlayback)}
        onClose={() => setManualPlayback(null)}
        title="Manual source metadata"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Saved fields have the highest priority and are not overwritten by
            later playback observations.
          </Text>
          <LanguagePicker
            label="Audio languages"
            value={manualMetadata.audio_languages || []}
            onChange={(value) =>
              setManualMetadata({
                ...manualMetadata,
                audio_languages: normalizeLanguageCodes(value),
              })
            }
          />
          <LanguagePicker
            label="Subtitle languages"
            value={manualMetadata.subtitle_languages || []}
            onChange={(value) =>
              setManualMetadata({
                ...manualMetadata,
                subtitle_languages: normalizeLanguageCodes(value),
              })
            }
          />
          <Select
            clearable
            label="Resolution"
            data={RESOLUTION_VALUES}
            value={manualMetadata.resolution || null}
            onChange={(value) =>
              setManualMetadata({
                ...manualMetadata,
                resolution: value || '',
              })
            }
          />
          <Select
            clearable
            searchable
            label="Format"
            data={CONTAINER_EXTENSION_OPTIONS}
            value={manualMetadata.container_extension || null}
            onChange={(value) =>
              setManualMetadata({
                ...manualMetadata,
                container_extension: value || '',
              })
            }
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setManualPlayback(null)}>
              Cancel
            </Button>
            <Button onClick={saveManualMetadata}>Save and lock</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

export default VODSourceManagerModal;
