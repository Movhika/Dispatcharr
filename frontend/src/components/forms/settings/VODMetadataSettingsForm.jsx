import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { Eye, Plus, Trash2 } from 'lucide-react';
import API from '../../../api';
import { showNotification } from '../../../utils/notificationUtils';

const LANGUAGE_OPTIONS = [
  ['de-DE', 'German (de-DE)'],
  ['en-US', 'English (en-US)'],
  ['en-GB', 'English (en-GB)'],
  ['fr-FR', 'French (fr-FR)'],
  ['es-ES', 'Spanish (es-ES)'],
  ['it-IT', 'Italian (it-IT)'],
  ['nl-NL', 'Dutch (nl-NL)'],
  ['pl-PL', 'Polish (pl-PL)'],
  ['pt-PT', 'Portuguese (pt-PT)'],
  ['tr-TR', 'Turkish (tr-TR)'],
].map(([value, label]) => ({ value, label }));

const VODMetadataSettingsForm = ({ active = true }) => {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState('');
  const [primaryLanguage, setPrimaryLanguage] = useState('en-US');
  const [secondaryLanguage, setSecondaryLanguage] = useState('');
  const [autoEnrich, setAutoEnrich] = useState(true);
  const [matchMissing, setMatchMissing] = useState(false);
  const [preferArtwork, setPreferArtwork] = useState(true);
  const [titleRules, setTitleRules] = useState([]);
  const [preview, setPreview] = useState([]);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const applyStatus = useCallback((next) => {
    setStatus(next);
    const settings = next?.settings || {};
    const languages = settings.languages || ['en-US'];
    setPrimaryLanguage(languages[0] || 'en-US');
    setSecondaryLanguage(languages[1] || '');
    setAutoEnrich(settings.auto_enrich !== false);
    setMatchMissing(Boolean(settings.match_missing));
    setPreferArtwork(settings.prefer_artwork !== false);
    setTitleRules(settings.title_rules || []);
  }, []);

  const load = useCallback(async () => {
    applyStatus(await API.getVODMetadataStatus());
  }, [applyStatus]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const languages = useMemo(
    () =>
      [primaryLanguage, secondaryLanguage].filter(
        (value, index, values) => value && values.indexOf(value) === index
      ),
    [primaryLanguage, secondaryLanguage]
  );

  const updateRule = (index, patch) =>
    setTitleRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule
      )
    );

  const loadPreview = async () => {
    setPreviewing(true);
    try {
      const response = await API.previewVODMetadataTitles(titleRules);
      setPreview(response.results || []);
    } catch {
      setPreview([]);
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        languages,
        auto_enrich: autoEnrich,
        match_missing: matchMissing,
        prefer_artwork: preferArtwork,
        title_rules: titleRules,
      };
      if (token.trim()) payload.api_token = token.trim();
      applyStatus(await API.updateVODMetadataSettings(payload));
      setToken('');
      showNotification({
        title: 'TMDB settings saved',
        message: 'The automatic enrichment and lookup rules were updated.',
        color: 'green',
      });
    } catch (error) {
      showNotification({
        title: 'TMDB settings were not saved',
        message:
          error?.body?.title_rules ||
          error?.message ||
          'Please check the values and retry.',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const environmentToken = status?.settings?.token_source === 'environment';
  return (
    <Stack maw={900}>
      <PasswordInput
        label="TMDB API read access token"
        description={
          environmentToken
            ? 'Configured through the container environment.'
            : status?.settings?.token_configured
              ? 'A token is configured. Enter a value only to replace it.'
              : 'Enter the application read access token from TMDB.'
        }
        value={token}
        onChange={(event) => setToken(event.currentTarget.value)}
        placeholder={status?.settings?.token_configured ? 'Configured' : ''}
        disabled={environmentToken}
      />

      <Group grow align="flex-start">
        <Select
          label="Primary metadata language"
          data={LANGUAGE_OPTIONS}
          value={primaryLanguage}
          onChange={(value) => setPrimaryLanguage(value || 'en-US')}
          searchable
          allowDeselect={false}
        />
        <Select
          label="Secondary metadata language"
          data={LANGUAGE_OPTIONS.filter(
            (option) => option.value !== primaryLanguage
          )}
          value={secondaryLanguage || null}
          onChange={(value) => setSecondaryLanguage(value || '')}
          searchable
          clearable
        />
      </Group>

      <Switch
        label="Automatically enrich after a changed provider VOD refresh"
        description="Only a changed provider catalog starts the incremental pipeline. Output profiles rebuild after enrichment."
        checked={autoEnrich}
        onChange={(event) => setAutoEnrich(event.currentTarget.checked)}
      />
      <Switch
        label="Match content without a TMDB or IMDb ID"
        description="Search uses the cleaned lookup title and release year. Only one exact result is accepted."
        checked={matchMissing}
        onChange={(event) => setMatchMissing(event.currentTarget.checked)}
      />
      <Switch
        label="Prefer TMDB posters and backdrops"
        description="Provider artwork remains stored and is used as fallback."
        checked={preferArtwork}
        onChange={(event) => setPreferArtwork(event.currentTarget.checked)}
      />

      <Alert color="blue" variant="light">
        Lookup rules never rename provider or canonical records. They only clean
        the search text before content without IDs is sent to TMDB. Rules run
        after common prefixes such as “DE -”, “4K-AMZ -” and “┃DE┃” are removed;
        a trailing release year is sent separately.
      </Alert>

      <Group justify="space-between">
        <Text fw={600}>Lookup title rules</Text>
        <Button
          variant="default"
          size="xs"
          leftSection={<Plus size={14} />}
          onClick={() =>
            setTitleRules((current) => [
              ...current,
              { pattern: '', replacement: '', enabled: true },
            ])
          }
        >
          Add rule
        </Button>
      </Group>
      {titleRules.map((rule, index) => (
        <Group key={index} align="end" wrap="nowrap">
          <TextInput
            label={index === 0 ? 'Regular expression' : undefined}
            placeholder="For example ^AMZ\\s*-\\s*"
            value={rule.pattern}
            onChange={(event) =>
              updateRule(index, { pattern: event.currentTarget.value })
            }
            style={{ flex: 2 }}
          />
          <TextInput
            label={index === 0 ? 'Replace with' : undefined}
            placeholder="Empty removes the match"
            value={rule.replacement || ''}
            onChange={(event) =>
              updateRule(index, { replacement: event.currentTarget.value })
            }
            style={{ flex: 1 }}
          />
          <Switch
            aria-label={`Enable lookup title rule ${index + 1}`}
            checked={rule.enabled !== false}
            onChange={(event) =>
              updateRule(index, { enabled: event.currentTarget.checked })
            }
            mb={8}
          />
          <ActionIcon
            aria-label={`Delete lookup title rule ${index + 1}`}
            color="red"
            variant="subtle"
            mb={4}
            onClick={() =>
              setTitleRules((current) =>
                current.filter((_, ruleIndex) => ruleIndex !== index)
              )
            }
          >
            <Trash2 size={16} />
          </ActionIcon>
        </Group>
      ))}
      <Group justify="flex-end">
        <Button
          variant="default"
          leftSection={<Eye size={16} />}
          loading={previewing}
          onClick={loadPreview}
        >
          Preview before / after
        </Button>
      </Group>
      {preview.length > 0 && (
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Before</Table.Th>
              <Table.Th>TMDB lookup title</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {preview.map((row) => (
              <Table.Tr key={`${row.content_type}:${row.id}`}>
                <Table.Td>{row.before}</Table.Td>
                <Table.Td>{row.after || '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Button onClick={save} loading={saving} style={{ alignSelf: 'flex-end' }}>
        Save
      </Button>
    </Stack>
  );
};

export default VODMetadataSettingsForm;
