import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Button,
  Flex,
  Group,
  Image,
  Text,
  Title,
  Badge,
  Loader,
  Stack,
  Modal,
} from '@mantine/core';
import { Play } from 'lucide-react';
import { copyToClipboard } from '../utils';
import useVODStore from '../store/useVODStore';
import useVideoStore from '../store/useVideoStore';
import useSettingsStore from '../store/settings';
import {
  formatDuration,
  getYouTubeEmbedUrl,
  imdbUrl,
  tmdbUrl,
} from '../utils/components/SeriesModalUtils.js';
import { YouTubeTrailerModal } from './modals/YouTubeTrailerModal.jsx';
import VODSourceList from './VODSourceList.jsx';
import VODSourceMetadataModal from './VODSourceMetadataModal.jsx';
import {
  formatAudioDetails,
  formatVideoDetails,
  getMovieStreamUrl,
  getTechnicalDetails,
} from '../utils/components/VODModalUtils.js';

const Movie = ({ onClickYouTubeTrailer, detailedVOD, vod }) => {
  const displayVOD = detailedVOD || vod;

  return (
    <Stack spacing="md" flex={1}>
      <Title order={3}>{displayVOD.name}</Title>

      {/* Original name if different */}
      {displayVOD.o_name && displayVOD.o_name !== displayVOD.name && (
        <Text size="sm" c="dimmed" fs="italic">
          Original: {displayVOD.o_name}
        </Text>
      )}

      <Group spacing="md">
        {displayVOD.year && <Badge color="blue">{displayVOD.year}</Badge>}
        {displayVOD.duration_secs && (
          <Badge color="gray">{formatDuration(displayVOD.duration_secs)}</Badge>
        )}
        {displayVOD.rating && <Badge color="yellow">{displayVOD.rating}</Badge>}
        {displayVOD.age && <Badge color="orange">{displayVOD.age}</Badge>}
        <Badge color="green">Movie</Badge>
        {/* imdb_id and tmdb_id badges */}
        {displayVOD.imdb_id && (
          <Badge
            color="yellow"
            component="a"
            href={imdbUrl(displayVOD.imdb_id)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ cursor: 'pointer' }}
          >
            IMDb
          </Badge>
        )}
        {displayVOD.tmdb_id && (
          <Badge
            color="cyan"
            component="a"
            href={tmdbUrl(displayVOD.tmdb_id, 'movie')}
            target="_blank"
            rel="noopener noreferrer"
            style={{ cursor: 'pointer' }}
          >
            TMDb
          </Badge>
        )}
      </Group>

      {/* Release date */}
      {displayVOD.release_date && (
        <Text size="sm" c="dimmed">
          <strong>Release Date:</strong> {displayVOD.release_date}
        </Text>
      )}

      {displayVOD.genre && (
        <Text size="sm" c="dimmed">
          <strong>Genre:</strong> {displayVOD.genre}
        </Text>
      )}

      {displayVOD.director && (
        <Text size="sm" c="dimmed">
          <strong>Director:</strong> {displayVOD.director}
        </Text>
      )}

      {displayVOD.actors && (
        <Text size="sm" c="dimmed">
          <strong>Cast:</strong> {displayVOD.actors}
        </Text>
      )}

      {displayVOD.country && (
        <Text size="sm" c="dimmed">
          <strong>Country:</strong> {displayVOD.country}
        </Text>
      )}

      {/* Description */}
      {displayVOD.description && (
        <Box>
          <Text size="sm" weight={500} mb={8}>
            Description
          </Text>
          <Text size="sm">{displayVOD.description}</Text>
        </Box>
      )}

      {/* A concrete source is played from the exact source list below. */}
      <Group spacing="xs" mt="sm">
        {displayVOD.youtube_trailer && (
          <Button
            variant="outline"
            color="red"
            size="sm"
            onClick={onClickYouTubeTrailer}
            style={{ alignSelf: 'flex-start' }}
          >
            Watch Trailer
          </Button>
        )}
      </Group>
    </Stack>
  );
};

const MovieTechnicalDetails = ({ selectedProvider, displayVOD }) => {
  const techDetails = getTechnicalDetails(selectedProvider, displayVOD);
  const hasDetails =
    techDetails.bitrate || techDetails.video || techDetails.audio;

  if (!hasDetails) return null;

  const hasVideo =
    techDetails.video && Object.keys(techDetails.video).length > 0;
  const hasAudio =
    techDetails.audio && Object.keys(techDetails.audio).length > 0;

  return (
    <Stack spacing={4} mt="xs">
      <Text size="sm" weight={500}>
        Technical Details:
        {selectedProvider && (
          <Text size="xs" c="dimmed" weight="normal" span ml={8}>
            (from {selectedProvider.m3u_account.name}
            {selectedProvider.stream_id &&
              ` - Stream ${selectedProvider.stream_id}`}
            )
          </Text>
        )}
      </Text>

      {techDetails.bitrate && techDetails.bitrate > 0 && (
        <Text size="xs" c="dimmed">
          <strong>Bitrate:</strong> {techDetails.bitrate} kbps
        </Text>
      )}

      {hasVideo && (
        <Text size="xs" c="dimmed">
          <strong>Video:</strong> {formatVideoDetails(techDetails.video)}
        </Text>
      )}

      {hasAudio && (
        <Text size="xs" c="dimmed">
          <strong>Audio:</strong> {formatAudioDetails(techDetails.audio)}
        </Text>
      )}
    </Stack>
  );
};

const VODModal = ({ vod, opened, onClose }) => {
  const [detailedVOD, setDetailedVOD] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [trailerModalOpened, setTrailerModalOpened] = useState(false);
  const [trailerUrl, setTrailerUrl] = useState('');
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [editingProvider, setEditingProvider] = useState(null);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const detailsRequestIdRef = useRef(0);

  const { fetchMovieDetailsFromProvider, fetchMovieProviders } = useVODStore();
  const showVideo = useVideoStore((s) => s.showVideo);
  const env_mode = useSettingsStore((s) => s.environment.env_mode);

  useEffect(() => {
    if (opened && vod) {
      const requestId = ++detailsRequestIdRef.current;
      setLoadingProviders(true);
      setLoadingDetails(true);
      fetchMovieProviders(vod.id)
        .then((providersData) => {
          if (detailsRequestIdRef.current !== requestId) return null;
          setProviders(providersData);
          const provider = providersData[0] || null;
          setSelectedProvider(provider);
          return provider
            ? fetchMovieDetailsFromProvider(vod.id, provider.id)
            : fetchMovieDetailsFromProvider(vod.id);
        })
        .then((details) => {
          if (!details || detailsRequestIdRef.current !== requestId) return;
          setDetailedVOD(details);
        })
        .catch((error) => {
          if (detailsRequestIdRef.current !== requestId) return;
          console.warn(
            'Failed to fetch providers or details, using basic info:',
            error
          );
          setDetailedVOD(vod);
        })
        .finally(() => {
          if (detailsRequestIdRef.current === requestId) {
            setLoadingProviders(false);
            setLoadingDetails(false);
          }
        });
    }
  }, [opened, vod, fetchMovieDetailsFromProvider, fetchMovieProviders]);

  useEffect(() => {
    if (!opened) {
      detailsRequestIdRef.current += 1;
      setDetailedVOD(null);
      setLoadingDetails(false);
      setTrailerModalOpened(false);
      setTrailerUrl('');
      setProviders([]);
      setSelectedProvider(null);
      setEditingProvider(null);
      setLoadingProviders(false);
    }
  }, [opened]);

  const onClickYouTubeTrailer = () => {
    setTrailerUrl(getYouTubeEmbedUrl(displayVOD.youtube_trailer));
    setTrailerModalOpened(true);
  };

  const onChangeSelectedProvider = (provider) => {
    if (!provider || provider.id === selectedProvider?.id) return;
    setSelectedProvider(provider);
    const requestId = ++detailsRequestIdRef.current;
    setLoadingDetails(true);
    fetchMovieDetailsFromProvider(vod.id, provider.id)
      .then((details) => {
        if (detailsRequestIdRef.current === requestId) {
          setDetailedVOD(details);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (detailsRequestIdRef.current === requestId) {
          setLoadingDetails(false);
        }
      });
  };

  const playProvider = (provider) => {
    const streamUrl = getMovieStreamUrl(vod, provider, env_mode);
    if (!streamUrl) return;
    onChangeSelectedProvider(provider);
    showVideo(streamUrl, 'vod', detailedVOD || vod);
  };

  const copyProviderLink = async (provider) => {
    const streamUrl = getMovieStreamUrl(vod, provider, env_mode);
    if (!streamUrl) return;
    await copyToClipboard(streamUrl, {
      successTitle: 'Link Copied!',
      successMessage: 'Exact source link copied to clipboard',
    });
  };

  const updateProvider = (updatedProvider) => {
    setProviders((current) =>
      current.map((provider) =>
        provider.id === updatedProvider.id ? updatedProvider : provider
      )
    );
    setSelectedProvider((current) =>
      current?.id === updatedProvider.id ? updatedProvider : current
    );
  };

  if (!vod) return null;

  // Use detailed data if available, otherwise use basic vod data
  const displayVOD = detailedVOD || vod;

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        size="96vw"
        centered
        yOffset="2vh"
        lockScroll={false}
        scrollAreaComponent={Modal.NativeScrollArea}
        styles={{
          content: {
            maxWidth: 1400,
            maxHeight: '96vh',
            backgroundColor: 'var(--mantine-color-body)',
          },
          header: {
            position: 'absolute',
            top: 0,
            right: 0,
            zIndex: 10,
            background: 'transparent',
            padding: 'var(--mantine-spacing-md)',
          },
          body: {
            padding: 0,
            backgroundColor: 'var(--mantine-color-body)',
          },
        }}
      >
        <Box
          style={{
            position: 'relative',
            minHeight: 400,
            backgroundColor: 'var(--mantine-color-body)',
          }}
        >
          {/* Backdrop image as background */}
          {displayVOD.backdrop_path && displayVOD.backdrop_path.length > 0 && (
            <>
              <Image
                src={displayVOD.backdrop_path[0]}
                alt={`${displayVOD.name} backdrop`}
                fit="cover"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  zIndex: 0,
                  borderRadius: 8,
                  filter: 'blur(2px) brightness(0.5)',
                }}
              />
              {/* Overlay for readability */}
              <Box
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  background:
                    'linear-gradient(180deg, rgba(24,24,27,0.85) 60%, rgba(24,24,27,1) 100%)',
                  zIndex: 1,
                  borderRadius: 8,
                }}
              />
            </>
          )}
          {/* Modal content above backdrop */}
          <Box p="md" pt="xl" style={{ position: 'relative', zIndex: 2 }}>
            <Stack spacing="md">
              {loadingDetails && (
                <Group spacing="xs" mb={8}>
                  <Loader size="xs" />
                  <Text size="xs" color="dimmed">
                    Loading additional details...
                  </Text>
                </Group>
              )}

              {/* Movie poster and basic info */}
              <Flex gap="md" wrap="wrap">
                {/* Use movie_image or logo */}
                {displayVOD.movie_image ||
                displayVOD.logo?.cache_url ||
                displayVOD.logo?.url ? (
                  <Box style={{ flexShrink: 0 }}>
                    <Image
                      src={
                        displayVOD.movie_image ||
                        displayVOD.logo?.cache_url ||
                        displayVOD.logo?.url
                      }
                      width={200}
                      height={300}
                      alt={displayVOD.name}
                      fit="contain"
                      style={{ borderRadius: '8px' }}
                    />
                  </Box>
                ) : (
                  <Box
                    style={{
                      width: 200,
                      height: 300,
                      backgroundColor: '#404040',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '8px',
                      flexShrink: 0,
                    }}
                  >
                    <Play size={48} color="#666" />
                  </Box>
                )}

                <Movie
                  detailedVOD={detailedVOD}
                  vod={vod}
                  onClickYouTubeTrailer={onClickYouTubeTrailer}
                />
              </Flex>

              <Group gap="xs">
                <Title order={4}>Sources ({providers.length})</Title>
                {loadingProviders && <Loader size="xs" />}
              </Group>
              {providers.length > 0 ? (
                <VODSourceList
                  providers={providers}
                  selectedProvider={selectedProvider}
                  selectedSourceMetadata={detailedVOD?.source_metadata}
                  contentType="movie"
                  disabled={loadingProviders}
                  onSelect={onChangeSelectedProvider}
                  onPlay={playProvider}
                  onCopy={copyProviderLink}
                  onEdit={setEditingProvider}
                />
              ) : !loadingProviders ? (
                <Text c="dimmed" ta="center" py="md">
                  No exact source relation is available for this movie.
                </Text>
              ) : null}

              {/* Technical Details */}
              <MovieTechnicalDetails
                selectedProvider={selectedProvider}
                displayVOD={displayVOD}
              />
            </Stack>
          </Box>
        </Box>
      </Modal>

      {/* YouTube Trailer Modal */}
      <YouTubeTrailerModal
        opened={trailerModalOpened}
        onClose={() => setTrailerModalOpened(false)}
        trailerUrl={trailerUrl}
      />
      <VODSourceMetadataModal
        provider={editingProvider}
        contentType="movie"
        opened={Boolean(editingProvider)}
        onClose={() => setEditingProvider(null)}
        onSaved={updateProvider}
      />
    </>
  );
};

export default VODModal;
