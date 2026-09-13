import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Image,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { DatabaseZap, Search, Save } from 'lucide-react';
import API from '../api';
import { showNotification } from '../utils/notificationUtils';

const emptyValues = {
  title: '',
  secondary_title: '',
  description: '',
  secondary_description: '',
  year: '',
  release_date: '',
  duration_minutes: '',
  rating: '',
  genre: '',
  age_rating: '',
  director: '',
  actors: '',
  crew: '',
  country: '',
  youtube_trailer: '',
  poster_url: '',
  backdrop_url: '',
  tmdb_id: '',
  imdb_id: '',
  tvdb_id: '',
  wikidata_id: '',
  keywords: [],
  is_anime: false,
  adult: false,
};

const metadataValues = (content = {}) => {
  const tmdb = content.tmdb || {};
  const primaryLanguage =
    tmdb.primary_language || tmdb.languages?.[0] || 'en-US';
  const secondaryLanguage =
    tmdb.secondary_language || tmdb.languages?.[1] || '';
  const primary = tmdb.localized?.[primaryLanguage] || {};
  const secondary = tmdb.localized?.[secondaryLanguage] || {};
  return {
    ...emptyValues,
    title: primary.title || content.name || '',
    secondary_title: secondary.title || '',
    description: primary.overview || content.description || '',
    secondary_description: secondary.overview || '',
    year: content.year ? String(content.year) : '',
    release_date: tmdb.release_date || content.release_date || '',
    duration_minutes: tmdb.runtime_minutes
      ? String(tmdb.runtime_minutes)
      : content.duration_secs
        ? String(Math.round(content.duration_secs / 60))
        : '',
    rating: String(tmdb.rating || content.rating || ''),
    genre:
      (tmdb.genres || [])
        .map((row) => row.name)
        .filter(Boolean)
        .join(', ') ||
      content.genre ||
      '',
    age_rating: tmdb.age_rating || content.age || '',
    director: tmdb.director || content.director || '',
    actors: tmdb.actors || content.actors || content.cast || '',
    crew: tmdb.crew || content.crew || '',
    country: tmdb.country || content.country || '',
    youtube_trailer: tmdb.youtube_trailer || content.youtube_trailer || '',
    poster_url:
      tmdb.poster_url ||
      content.movie_image ||
      content.series_image ||
      content.logo?.cache_url ||
      content.logo?.url ||
      '',
    backdrop_url: tmdb.backdrop_url || content.backdrop_path?.[0] || '',
    tmdb_id: String(tmdb.id || content.tmdb_id || ''),
    imdb_id: String(tmdb.external_ids?.imdb_id || content.imdb_id || ''),
    tvdb_id: String(tmdb.external_ids?.tvdb_id || ''),
    wikidata_id: String(tmdb.external_ids?.wikidata_id || ''),
    keywords: (tmdb.keywords || [])
      .map((row) => (typeof row === 'string' ? row : row?.name))
      .filter(Boolean),
    is_anime: Boolean(tmdb.is_anime),
    adult: Boolean(tmdb.adult || content.is_adult),
  };
};

const isBlank = (value) =>
  value === '' ||
  value === null ||
  value === undefined ||
  (Array.isArray(value) && value.length === 0);

const VODCanonicalMetadataModal = ({
  opened,
  onClose,
  content,
  contentId,
  contentType,
  onSaved,
}) => {
  const [values, setValues] = useState(emptyValues);
  const [searchTitle, setSearchTitle] = useState('');
  const [searchYear, setSearchYear] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loadingCandidate, setLoadingCandidate] = useState('');
  const [saving, setSaving] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [previewedCandidate, setPreviewedCandidate] = useState(null);

  const primaryLanguage =
    content?.tmdb?.primary_language || content?.tmdb?.languages?.[0] || 'en-US';
  const secondaryLanguage =
    content?.tmdb?.secondary_language || content?.tmdb?.languages?.[1] || '';

  useEffect(() => {
    if (!opened) return;
    const next = metadataValues(content);
    setValues(next);
    setSearchTitle(next.title);
    setSearchYear(next.year);
    setResults([]);
    setPreviewedCandidate(null);
    setOverwriteExisting(false);
  }, [content, opened]);

  const setValue = (key, value) =>
    setValues((current) => ({ ...current, [key]: value }));

  const searchTMDB = async () => {
    if (!searchTitle.trim()) return;
    setSearching(true);
    try {
      const response = await API.lookupVODTMDB({
        content_type: contentType,
        query: searchTitle.trim(),
        year: searchYear,
      });
      setResults(response.results || []);
      setPreviewedCandidate(null);
    } catch (error) {
      showNotification({
        title: 'TMDB search failed',
        message: error?.body?.detail || error?.message || 'Please retry.',
        color: 'red',
      });
    } finally {
      setSearching(false);
    }
  };

  const loadCandidate = async (candidateId) => {
    setLoadingCandidate(String(candidateId));
    try {
      const response = await API.lookupVODTMDB({
        content_type: contentType,
        tmdb_id: candidateId,
      });
      const candidateValues = metadataValues({ tmdb: response.metadata });
      setValues((current) => {
        const next = { ...current };
        Object.entries(candidateValues).forEach(([key, value]) => {
          if (overwriteExisting || isBlank(current[key])) next[key] = value;
        });
        next.tmdb_id = String(candidateId);
        return next;
      });
      setPreviewedCandidate(
        results.find((row) => String(row.id) === String(candidateId)) || {
          id: candidateId,
          title: candidateValues.title,
          year: candidateValues.year,
        }
      );
    } catch (error) {
      showNotification({
        title: 'TMDB preview failed',
        message: error?.body?.detail || error?.message || 'Please retry.',
        color: 'red',
      });
    } finally {
      setLoadingCandidate('');
    }
  };

  const save = async () => {
    if (!values.title.trim()) return;
    setSaving(true);
    try {
      await API.updateCanonicalVODMetadata(contentType, contentId, values);
      await onSaved?.();
      showNotification({
        title: 'Canonical metadata saved',
        message:
          'Affected output profiles can now be rebuilt explicitly from their profile dialog.',
        color: 'green',
      });
      onClose();
    } catch (error) {
      showNotification({
        title: 'Metadata was not saved',
        message:
          error?.body?.detail ||
          Object.values(error?.body || {})?.[0] ||
          error?.message ||
          'Please retry.',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const candidateRows = results.map((candidate) => (
    <Group
      key={candidate.id}
      wrap="nowrap"
      align="flex-start"
      p="xs"
      style={{
        border: '1px solid var(--mantine-color-dark-4)',
        borderRadius: 6,
      }}
    >
      {candidate.poster_url ? (
        <Image src={candidate.poster_url} w={48} h={72} fit="cover" bdrs={4} />
      ) : (
        <Box w={48} h={72} bg="dark.6" style={{ flexShrink: 0 }} />
      )}
      <Box style={{ flex: 1 }}>
        <Text fw={600}>
          {candidate.title ||
            candidate.original_title ||
            `TMDB ${candidate.id}`}
          {candidate.year ? ` (${candidate.year})` : ''}
        </Text>
        {candidate.original_title &&
          candidate.original_title !== candidate.title && (
            <Text size="xs" c="dimmed">
              Original: {candidate.original_title}
            </Text>
          )}
        <Text size="xs" c="dimmed" lineClamp={2}>
          {candidate.overview || 'No description returned.'}
        </Text>
      </Box>
      <Button
        size="xs"
        variant="default"
        loading={loadingCandidate === String(candidate.id)}
        onClick={() => loadCandidate(candidate.id)}
      >
        Preview
      </Button>
    </Group>
  ));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Edit canonical metadata"
      size="70vw"
      centered
      styles={{ content: { maxWidth: 1150 } }}
    >
      <Stack gap="md">
        <Box
          p="sm"
          style={{
            border: '1px solid var(--mantine-color-dark-4)',
            borderRadius: 6,
          }}
        >
          <Stack gap="xs">
            <Text fw={600}>Find the correct TMDB title</Text>
            <Group align="end" wrap="nowrap">
              <TextInput
                label="Search title"
                value={searchTitle}
                onChange={(event) => setSearchTitle(event.currentTarget.value)}
                onKeyDown={(event) => event.key === 'Enter' && searchTMDB()}
                style={{ flex: 1 }}
              />
              <TextInput
                label="Year"
                value={searchYear}
                onChange={(event) => setSearchYear(event.currentTarget.value)}
                w={100}
              />
              <Button
                leftSection={<Search size={15} />}
                loading={searching}
                onClick={searchTMDB}
              >
                Search TMDB
              </Button>
            </Group>
            <Checkbox
              checked={overwriteExisting}
              onChange={(event) =>
                setOverwriteExisting(event.currentTarget.checked)
              }
              label="Replace existing values when loading a TMDB result"
            />
            {results.length > 0 && (
              <ScrollArea h={220} offsetScrollbars>
                <Stack gap="xs">{candidateRows}</Stack>
              </ScrollArea>
            )}
            {!searching &&
              results.length === 0 &&
              previewedCandidate === null && (
                <Text size="xs" c="dimmed">
                  Search results are only a preview. Nothing changes until you
                  save.
                </Text>
              )}
            {previewedCandidate && (
              <Alert color="blue" icon={<DatabaseZap size={16} />}>
                TMDB {previewedCandidate.id} was loaded into the form. Review
                and adjust every value below before saving.
              </Alert>
            )}
          </Stack>
        </Box>

        <Divider label="Canonical values" labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label={`Primary title · ${primaryLanguage}`}
            required
            value={values.title}
            onChange={(event) => setValue('title', event.currentTarget.value)}
          />
          {secondaryLanguage && (
            <TextInput
              label={`Secondary title · ${secondaryLanguage}`}
              value={values.secondary_title}
              onChange={(event) =>
                setValue('secondary_title', event.currentTarget.value)
              }
            />
          )}
          <Textarea
            label={`Primary description · ${primaryLanguage}`}
            autosize
            minRows={3}
            value={values.description}
            onChange={(event) =>
              setValue('description', event.currentTarget.value)
            }
          />
          {secondaryLanguage && (
            <Textarea
              label={`Secondary description · ${secondaryLanguage}`}
              autosize
              minRows={3}
              value={values.secondary_description}
              onChange={(event) =>
                setValue('secondary_description', event.currentTarget.value)
              }
            />
          )}
        </SimpleGrid>

        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <TextInput
            label="Year"
            value={values.year}
            onChange={(event) => setValue('year', event.currentTarget.value)}
          />
          <TextInput
            label="Release date"
            placeholder="YYYY-MM-DD"
            value={values.release_date}
            onChange={(event) =>
              setValue('release_date', event.currentTarget.value)
            }
          />
          {contentType === 'movie' && (
            <TextInput
              label="Runtime · minutes"
              value={values.duration_minutes}
              onChange={(event) =>
                setValue('duration_minutes', event.currentTarget.value)
              }
            />
          )}
          <TextInput
            label="Rating"
            value={values.rating}
            onChange={(event) => setValue('rating', event.currentTarget.value)}
          />
          <TextInput
            label="Age rating"
            value={values.age_rating}
            onChange={(event) =>
              setValue('age_rating', event.currentTarget.value)
            }
          />
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label="Genres · comma separated"
            value={values.genre}
            onChange={(event) => setValue('genre', event.currentTarget.value)}
          />
          <TextInput
            label="Country"
            value={values.country}
            onChange={(event) => setValue('country', event.currentTarget.value)}
          />
          <TextInput
            label="Director / creator"
            value={values.director}
            onChange={(event) =>
              setValue('director', event.currentTarget.value)
            }
          />
          <TextInput
            label="Cast · comma separated"
            value={values.actors}
            onChange={(event) => setValue('actors', event.currentTarget.value)}
          />
          <TextInput
            label="Crew · comma separated"
            value={values.crew}
            onChange={(event) => setValue('crew', event.currentTarget.value)}
          />
          <TextInput
            label="YouTube trailer ID or URL"
            value={values.youtube_trailer}
            onChange={(event) =>
              setValue('youtube_trailer', event.currentTarget.value)
            }
          />
          <TextInput
            label="Poster URL"
            value={values.poster_url}
            onChange={(event) =>
              setValue('poster_url', event.currentTarget.value)
            }
          />
          <TextInput
            label="Backdrop URL"
            value={values.backdrop_url}
            onChange={(event) =>
              setValue('backdrop_url', event.currentTarget.value)
            }
          />
        </SimpleGrid>

        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <TextInput
            label="TMDB ID"
            value={values.tmdb_id}
            onChange={(event) => setValue('tmdb_id', event.currentTarget.value)}
          />
          <TextInput
            label="IMDb ID"
            value={values.imdb_id}
            onChange={(event) => setValue('imdb_id', event.currentTarget.value)}
          />
          <TextInput
            label="TVDB ID"
            value={values.tvdb_id}
            onChange={(event) => setValue('tvdb_id', event.currentTarget.value)}
          />
          <TextInput
            label="Wikidata ID"
            value={values.wikidata_id}
            onChange={(event) =>
              setValue('wikidata_id', event.currentTarget.value)
            }
          />
        </SimpleGrid>

        <TagsInput
          label="Keywords"
          description="TMDB keywords are stored individually and can be adjusted here."
          value={values.keywords}
          onChange={(value) => setValue('keywords', value)}
          splitChars={[',']}
          clearable
        />
        <Group>
          <Switch
            checked={values.is_anime}
            onChange={(event) =>
              setValue('is_anime', event.currentTarget.checked)
            }
            label="Anime"
          />
          <Switch
            checked={values.adult}
            onChange={(event) => setValue('adult', event.currentTarget.checked)}
            label="Adult content"
          />
        </Group>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            leftSection={<Save size={15} />}
            loading={saving}
            disabled={!values.title.trim()}
            onClick={save}
          >
            Save metadata
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default VODCanonicalMetadataModal;
