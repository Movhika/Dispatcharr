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
  Alert,
} from '@mantine/core';
import { Play } from 'lucide-react';
import { copyToClipboard } from '../utils';
import useVODStore from '../store/useVODStore';
import useVideoStore from '../store/useVideoStore';
import useSettingsStore from '../store/settings';
import {
  formatDuration,
  getYouTubeEmbedUrl,
} from '../utils/components/SeriesModalUtils.js';
import { YouTubeTrailerModal } from './modals/YouTubeTrailerModal.jsx';
import VODSourceList from './VODSourceList.jsx';
import VODSourceMetadataModal from './VODSourceMetadataModal.jsx';
import { getMovieStreamUrl } from '../utils/components/VODModalUtils.js';
import VODExternalIds from './VODExternalIds.jsx';
import VODEnrichmentButton from './VODEnrichmentButton.jsx';

const Movie = ({ onClickYouTubeTrailer, displayVOD }) => {
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
        <VODExternalIds
          contentType="movie"
          contentId={displayVOD.id}
          tmdb={displayVOD.tmdb}
          tmdbId={displayVOD.tmdb_id}
          imdbId={displayVOD.imdb_id}
        />
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

      {displayVOD.crew && (
        <Text size="sm" c="dimmed">
          <strong>Crew:</strong> {displayVOD.crew}
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

const VODModal = ({
  vod,
  opened,
  onClose,
  onMetadataChanged,
  initialRelationId = null,
  allowSourceEditing = true,
  profileCandidates = null,
  profileCandidatesLoading = false,
  profileCandidatesError = '',
}) => {
  const [detailedVOD, setDetailedVOD] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [trailerModalOpened, setTrailerModalOpened] = useState(false);
  const [trailerUrl, setTrailerUrl] = useState('');
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [editingProvider, setEditingProvider] = useState(null);
  const [dataView, setDataView] = useState('primary');
  const [loadingProviders, setLoadingProviders] = useState(false);
  const providersRequestIdRef = useRef(0);
  const detailsRequestIdRef = useRef(0);
  const profilePreferenceAppliedRef = useRef('');
  const vodRef = useRef(vod);
  vodRef.current = vod;

  const fetchMovieDetailsFromProvider = useVODStore(
    (state) => state.fetchMovieDetailsFromProvider
  );
  const fetchMovieProviders = useVODStore((state) => state.fetchMovieProviders);
  const showVideo = useVideoStore((s) => s.showVideo);
  const env_mode = useSettingsStore((s) => s.environment.env_mode);

  useEffect(() => {
    if (opened && vod?.id) {
      const providersRequestId = ++providersRequestIdRef.current;
      const detailsRequestId = ++detailsRequestIdRef.current;
      setLoadingProviders(true);
      setLoadingDetails(true);
      fetchMovieProviders(vod.id)
        .then((providersData) => {
          if (providersRequestIdRef.current !== providersRequestId) return null;
          setProviders(providersData);
          // Loading the source list and loading the selected source's details
          // are independent. Profile ordering may immediately replace the
          // detail request, but the source list has already finished here.
          setLoadingProviders(false);
          const provider =
            providersData.find(
              (item) => String(item.id) === String(initialRelationId)
            ) ||
            providersData[0] ||
            null;
          setSelectedProvider(provider);
          return provider
            ? fetchMovieDetailsFromProvider(vod.id, provider.id)
            : fetchMovieDetailsFromProvider(vod.id);
        })
        .then((details) => {
          if (!details || detailsRequestIdRef.current !== detailsRequestId) {
            return;
          }
          setDetailedVOD(details);
        })
        .catch((error) => {
          if (detailsRequestIdRef.current !== detailsRequestId) return;
          console.warn(
            'Failed to fetch providers or details, using basic info:',
            error
          );
          setDetailedVOD(vodRef.current);
        })
        .finally(() => {
          if (providersRequestIdRef.current === providersRequestId) {
            setLoadingProviders(false);
          }
          if (detailsRequestIdRef.current === detailsRequestId) {
            setLoadingDetails(false);
          }
        });
    }
  }, [
    initialRelationId,
    opened,
    vod?.id,
    fetchMovieDetailsFromProvider,
    fetchMovieProviders,
  ]);

  useEffect(() => {
    if (!opened) {
      providersRequestIdRef.current += 1;
      detailsRequestIdRef.current += 1;
      profilePreferenceAppliedRef.current = '';
      setDetailedVOD(null);
      setLoadingDetails(false);
      setTrailerModalOpened(false);
      setTrailerUrl('');
      setProviders([]);
      setSelectedProvider(null);
      setEditingProvider(null);
      setDataView('primary');
      setLoadingProviders(false);
    }
  }, [opened]);

  useEffect(() => {
    if (!opened || !providers.length || !profileCandidates?.results?.length) {
      return;
    }
    const preferred = profileCandidates.results.find(
      (row) => row.allowed && row.position === 1
    );
    const signature = `${profileCandidates.profile_id}:${profileCandidates.canonical_id}:${profileCandidates.edition_key || ''}:${preferred?.relation_id || ''}`;
    if (!preferred || profilePreferenceAppliedRef.current === signature) return;
    const provider = providers.find(
      (candidate) => String(candidate.id) === String(preferred.relation_id)
    );
    if (!provider) return;
    profilePreferenceAppliedRef.current = signature;
    setSelectedProvider(provider);
    const requestId = ++detailsRequestIdRef.current;
    setLoadingDetails(true);
    fetchMovieDetailsFromProvider(vod.id, provider.id)
      .then((details) => {
        if (detailsRequestIdRef.current === requestId) setDetailedVOD(details);
      })
      .catch(() => {})
      .finally(() => {
        if (detailsRequestIdRef.current === requestId) setLoadingDetails(false);
      });
  }, [
    fetchMovieDetailsFromProvider,
    opened,
    profileCandidates,
    providers,
    vod?.id,
  ]);

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
    setDetailedVOD((current) =>
      selectedProvider?.id === updatedProvider.id && current
        ? { ...current, source_metadata: updatedProvider.source_metadata }
        : current
    );
    onMetadataChanged?.();
  };

  const reloadAfterEnrichment = async () => {
    const requestId = ++detailsRequestIdRef.current;
    const details = await fetchMovieDetailsFromProvider(
      vod.id,
      selectedProvider?.id || null
    );
    if (detailsRequestIdRef.current === requestId) setDetailedVOD(details);
    await onMetadataChanged?.();
  };

  if (!vod) return null;

  const tmdb = detailedVOD?.tmdb || vod.tmdb || {};
  const primaryLanguage = tmdb.primary_language || tmdb.languages?.[0] || '';
  const secondaryLanguage =
    tmdb.secondary_language || tmdb.languages?.[1] || '';
  const localized = tmdb.localized || {};
  const metadataMatched = tmdb.status === 'matched';
  const canonicalVOD = detailedVOD?.canonical || vod;
  const localizedCanonical = (language, secondary = false) => {
    const values = localized[language] || {};
    return {
      ...vod,
      ...canonicalVOD,
      name: values.title || canonicalVOD.name || vod.name,
      description:
        values.overview ||
        (secondary ? '' : canonicalVOD.description || vod.description),
      genre:
        (tmdb.genres || [])
          .map((row) => row.name)
          .filter(Boolean)
          .join(', ') || canonicalVOD.genre || vod.genre,
      rating: tmdb.rating || canonicalVOD.rating || vod.rating,
      duration_secs:
        (tmdb.runtime_minutes ? tmdb.runtime_minutes * 60 : null) ||
        canonicalVOD.duration_secs ||
        vod.duration_secs,
      release_date: tmdb.release_date || canonicalVOD.release_date || '',
      director: tmdb.director || canonicalVOD.director || '',
      actors: tmdb.actors || canonicalVOD.actors || '',
      crew: tmdb.crew || canonicalVOD.crew || '',
      country: tmdb.country || canonicalVOD.country || '',
      age: tmdb.age_rating || canonicalVOD.age || '',
      youtube_trailer:
        tmdb.youtube_trailer ||
        canonicalVOD.youtube_trailer ||
        '',
      movie_image:
        vod.artwork_url ||
        tmdb.poster_url ||
        canonicalVOD.movie_image ||
        vod.movie_image ||
        '',
      backdrop_path: tmdb.backdrop_url
        ? [tmdb.backdrop_url]
        : canonicalVOD.backdrop_path || vod.backdrop_path || [],
      tmdb,
      tmdb_id: tmdb.id || vod.tmdb_id,
      imdb_id: tmdb.external_ids?.imdb_id || vod.imdb_id,
      o_name: vod.o_name || '',
    };
  };
  const providerIds = selectedProvider?.provider_external_ids || {};
  const providerVOD = detailedVOD
    ? {
        ...detailedVOD,
        tmdb_id: providerIds.tmdb_id || '',
        imdb_id: providerIds.imdb_id || '',
        tmdb: {
          id: providerIds.tmdb_id || '',
          external_ids: { imdb_id: providerIds.imdb_id || '' },
        },
      }
    : vod;
  const displayVOD =
    dataView === 'provider'
      ? providerVOD
      : localizedCanonical(
          dataView === 'secondary' ? secondaryLanguage : primaryLanguage,
          dataView === 'secondary'
        );
  const secondaryValues = localized[secondaryLanguage] || {};
  const secondaryTranslationAvailable = Boolean(
    secondaryValues.title || secondaryValues.overview || secondaryValues.tagline
  );

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
              <Group justify="space-between" pr="xl">
                {allowSourceEditing ? (
                  <VODEnrichmentButton
                    contentId={vod.id}
                    contentType="movie"
                    enriched={metadataMatched}
                    onComplete={reloadAfterEnrichment}
                  />
                ) : (
                  <Box />
                )}
                <Group gap={2} aria-label="Metadata source">
                  <Button
                    size="xs"
                    variant={dataView === 'primary' ? 'filled' : 'default'}
                    onClick={() => setDataView('primary')}
                  >
                    {metadataMatched ? 'Primary' : 'Canonical'}
                    {metadataMatched && primaryLanguage
                      ? ` · ${primaryLanguage}`
                      : ''}
                  </Button>
                  {metadataMatched && secondaryLanguage && (
                    <Button
                      size="xs"
                      variant={dataView === 'secondary' ? 'filled' : 'default'}
                      onClick={() => setDataView('secondary')}
                    >
                      Secondary · {secondaryLanguage}
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant={dataView === 'provider' ? 'filled' : 'default'}
                    onClick={() => setDataView('provider')}
                  >
                    Provider
                  </Button>
                </Group>
              </Group>
              {dataView === 'primary' && !metadataMatched && (
                <Alert color="blue" py="xs">
                  A provider ID may already be known, but no TMDB detail record
                  is stored yet. Use Enrich with TMDB to load localized data.
                </Alert>
              )}
              {dataView === 'secondary' && !secondaryTranslationAvailable && (
                <Alert color="yellow" py="xs">
                  TMDB returned no separate {secondaryLanguage} translation for
                  this title. Shared facts remain visible, but primary text is
                  not copied into the secondary view.
                </Alert>
              )}
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
                  displayVOD={displayVOD}
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
                  onEdit={allowSourceEditing ? setEditingProvider : undefined}
                  profileCandidates={profileCandidates}
                  profileCandidatesLoading={profileCandidatesLoading}
                  profileCandidatesError={profileCandidatesError}
                />
              ) : !loadingProviders ? (
                <Text c="dimmed" ta="center" py="md">
                  No exact source relation is available for this movie.
                </Text>
              ) : null}
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
        onMoved={() => {
          setEditingProvider(null);
          onMetadataChanged?.();
          onClose();
        }}
      />
    </>
  );
};

export default VODModal;
