import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Flex,
  Group,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import API from '../../api';
import ConfirmationDialog from '../ConfirmationDialog.jsx';
import { LibraryDialog } from '../LibraryDialogs.jsx';
import { LibraryFilterFields, PeriodFields } from '../LibraryFilters.jsx';
import ScheduleInput from './ScheduleInput';
import { formatApiError } from '../../utils';
import { fromDayMonth, toDayMonth } from '../../utils/libraryFilters.js';
import { showNotification } from '../../utils/notificationUtils.js';
import {
  LIST_CONTENT,
  LIST_TYPES,
  MONETIZATION,
  NAME_PLACEHOLDERS,
  displayName,
  listErrors,
  listPayload,
  listValidation,
  newList,
  sortModes,
  tmdbSources,
} from '../../utils/vodLists';
import { firstMessage } from '../../utils/vodProfiles';
import { HelpLabel, Section } from './VODProfileRuleEditors.jsx';
import editorClasses from './AccountEditor.module.css';

const TAB_FIELDS = {
  general: ['name', 'content_type'],
  tmdb: [
    'tmdb_source',
    'list_id',
    'release_mode',
    'release_days',
    'release_since',
    'release_until',
    'genres',
    'original_language',
    'region',
    'provider_id',
  ],
  rules: ['filters'],
  schedule: [
    'visible_from',
    'visible_until',
    'refresh_interval',
    'cron_expression',
  ],
};
const tabHasError = (tab, errors) =>
  TAB_FIELDS[tab]?.some((field) => field in errors) || false;

function GeneralTab({ values, saved, errors, set }) {
  const [retyping, setRetyping] = useState(null);
  const insert = (placeholder) =>
    set('name', `${values.name} {${placeholder}}`.trim());
  return (
    <Stack gap="md">
      <Section title="List">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="xs">
          <Stack gap="xs">
            <TextInput
              label={
                <HelpLabel
                  label="Name"
                  help="The category name in clients. Optional placeholders follow the date: {year} becomes the current year and {season} the current season."
                />
              }
              aria-label="Name"
              withAsterisk
              value={values.name}
              error={errors.name}
              onChange={(event) => set('name', event.currentTarget.value)}
            />
            <Group gap={6}>
              {NAME_PLACEHOLDERS.map((placeholder) => (
                <Tooltip key={placeholder.value} label={placeholder.help}>
                  <Badge
                    component="button"
                    type="button"
                    variant="light"
                    color="gray"
                    style={{ cursor: 'pointer', textTransform: 'none' }}
                    aria-label={`Insert ${placeholder.value}`}
                    onClick={() => insert(placeholder.value)}
                  >
                    {`{${placeholder.value}}`}
                  </Badge>
                </Tooltip>
              ))}
            </Group>
            {/[{](year|season)[}]/.test(values.name) && (
              <Text size="sm" c="dimmed">
                Shown as: {displayName(values.name)}
              </Text>
            )}
          </Stack>
          <Stack gap="xs">
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                <HelpLabel
                  label="Type"
                  help="Manual lists hold titles you add from the Library. Rules lists hold the titles matching Library filters. TMDB lists follow a TMDB chart, list, discover query or streaming service."
                />
              </Text>
              <SegmentedControl
                aria-label="Type"
                value={values.list_type}
                onChange={(value) =>
                  // A saved list loses its titles when its type changes.
                  values.id && value !== saved.list_type
                    ? setRetyping(value)
                    : set('list_type', value)
                }
                data={LIST_TYPES}
              />
            </Stack>
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Content
              </Text>
              <SegmentedControl
                aria-label="Content"
                value={values.content_type}
                onChange={(value) => set('content_type', value)}
                data={LIST_CONTENT}
              />
              {errors.content_type && (
                <Text size="xs" c="red">
                  {errors.content_type}
                </Text>
              )}
            </Stack>
            <Select
              label="Sort titles"
              allowDeselect={false}
              value={values.sort_mode}
              onChange={(value) => set('sort_mode', value)}
              data={sortModes(values.list_type)}
            />
          </Stack>
        </SimpleGrid>
      </Section>
      <ConfirmationDialog
        opened={!!retyping}
        onClose={() => setRetyping(null)}
        onConfirm={() => {
          set('list_type', retyping);
          setRetyping(null);
        }}
        title="Change the list type?"
        message="Its titles are replaced when you save."
        confirmLabel="Change"
        cancelLabel="Cancel"
        zIndex={300}
      />
    </Stack>
  );
}

// When clients see the list and, for TMDB lists, when it is downloaded again.
function ScheduleTab({ values, errors, set }) {
  const [scheduleType, setScheduleType] = useState(
    values.cron_expression ? 'cron' : 'interval'
  );
  const [visibleMode, setVisibleMode] = useState(
    values.visible_from || values.visible_until ? 'period' : 'always'
  );
  return (
    <Stack gap="md">
      <Section title="Visibility">
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md" verticalSpacing="xs">
          <Select
            label={
              <HelpLabel
                label="Visible"
                help="Clients only see the list within this period every year, which may span the turn of the year, for example 01.12. to 06.01. Its titles stay in your other lists."
              />
            }
            aria-label="Visible"
            allowDeselect={false}
            value={visibleMode}
            data={[
              { value: 'always', label: 'Always' },
              { value: 'period', label: 'Every year' },
            ]}
            onChange={(value) => {
              setVisibleMode(value);
              if (value === 'always') {
                set('visible_from', '');
                set('visible_until', '');
              }
            }}
          />
          {visibleMode === 'period' && (
            <>
              <TextInput
                label="From"
                placeholder="DD.MM"
                maxLength={5}
                value={toDayMonth(values.visible_from)}
                error={errors.visible_from}
                onChange={(event) =>
                  set('visible_from', fromDayMonth(event.currentTarget.value))
                }
              />
              <TextInput
                label="Until"
                placeholder="DD.MM"
                maxLength={5}
                value={toDayMonth(values.visible_until)}
                error={errors.visible_until}
                onChange={(event) =>
                  set('visible_until', fromDayMonth(event.currentTarget.value))
                }
              />
            </>
          )}
        </SimpleGrid>
      </Section>
      {values.list_type === 'rules' && (
        <Section title="Refresh">
          <Text size="sm" c="dimmed">
            Rebuilt by itself after every VOD refresh and Library change, and
            daily when a period follows the date.
          </Text>
        </Section>
      )}
      {values.list_type === 'tmdb' && (
        <Section title="Refresh">
          <ScheduleInput
            scheduleType={scheduleType}
            onScheduleTypeChange={(type) => {
              setScheduleType(type);
              if (type === 'interval') set('cron_expression', '');
            }}
            intervalValue={values.refresh_interval}
            onIntervalChange={(value) => set('refresh_interval', value || 0)}
            cronValue={values.cron_expression}
            onCronChange={(value) => set('cron_expression', value)}
            intervalLabel="Refresh interval (hours)"
            intervalDescription="How often to download the list from TMDB again; 0 only downloads it when you save or refresh it."
          />
          {(errors.refresh_interval || errors.cron_expression) && (
            <Text size="sm" c="red">
              {errors.refresh_interval || errors.cron_expression}
            </Text>
          )}
        </Section>
      )}
    </Stack>
  );
}

function RulesSection({ values, errors, set }) {
  const [options, setOptions] = useState({});
  const [count, setCount] = useState(null);
  const filters = useMemo(() => values.filters || {}, [values.filters]);
  const type = values.content_type === 'all' ? '' : values.content_type;
  const rules = values.list_type === 'rules';
  useEffect(() => {
    API.getVODLibraryOptions(new URLSearchParams(type ? { type } : {}))
      .then(setOptions)
      .catch(() => setOptions({}));
  }, [type]);
  const query = useMemo(
    () =>
      JSON.stringify({
        ...Object.fromEntries(
          Object.entries(filters).filter(
            ([, value]) => value !== '' && value != null
          )
        ),
        ...(type ? { type } : {}),
        view: 'titles',
      }),
    [filters, type]
  );
  // How many titles a rules list matches right now.
  useEffect(() => {
    if (!rules) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      API.getVODLibrary(
        new URLSearchParams({ ...JSON.parse(query), page: 1, page_size: 1 })
      )
        .then((result) => current && setCount(result.count))
        .catch(() => current && setCount(null));
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, rules]);
  return (
    <Section
      title="Rules"
      action={
        rules &&
        count != null && (
          <Badge variant="light">
            {count.toLocaleString()} matching titles
          </Badge>
        )
      }
    >
      {errors.filters && <Alert color="red">{errors.filters}</Alert>}
      <LibraryFilterFields
        filters={filters}
        onChange={(patch) => set('filters', { ...filters, ...patch })}
        options={options}
        contentType={false}
        fileData={false}
        periods
      />
    </Section>
  );
}

// TMDB keywords such as "christmas" or "anime", found by their name.
function KeywordPicker({ value, match, anime, error, onChange, onMatch }) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) return undefined;
    const timer = setTimeout(() => {
      API.getVODTmdbKeywords(term)
        .then(setFound)
        .catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const data = [
    ...value.map((keyword) => ({ value: keyword.id, label: keyword.name })),
    ...found.filter(
      (option) => !value.some((keyword) => keyword.id === option.value)
    ),
  ];
  return (
    <Stack gap={4}>
      <MultiSelect
        label={
          <HelpLabel
            label="Keywords"
            help="TMDB keywords, e.g. christmas. With several, titles need any or all of them; with Anime only, all of them."
          />
        }
        aria-label="Keywords"
        placeholder={value.length ? undefined : 'Search TMDB keywords'}
        searchable
        clearable
        styles={{ input: { minHeight: 72 } }}
        searchValue={search}
        onSearchChange={setSearch}
        filter={({ options }) => options}
        nothingFoundMessage={
          search.trim().length < 2 ? 'Type at least two letters' : 'No keywords'
        }
        data={data}
        value={value.map((keyword) => keyword.id)}
        error={error}
        onChange={(ids) =>
          onChange(
            ids.map(
              (id) =>
                value.find((keyword) => keyword.id === id) || {
                  id,
                  name: data.find((option) => option.value === id)?.label || id,
                }
            )
          )
        }
      />
      {value.length > 1 && (
        <SegmentedControl
          size="xs"
          aria-label="Keywords match"
          // TMDB cannot mix any and all, so with Anime all of them apply.
          value={anime ? 'all' : match}
          disabled={anime}
          onChange={onMatch}
          data={[
            { value: 'any', label: 'Any of them' },
            { value: 'all', label: 'All of them' },
          ]}
        />
      )}
    </Stack>
  );
}

// Discover settings of the release period, by the keys PeriodFields uses.
const RELEASE_KEYS = {
  since: 'release_since',
  until: 'release_until',
  days: 'release_days',
  fromDay: 'release_from_day',
  untilDay: 'release_until_day',
  anchor: 'release_anchor',
};

function TmdbSections({ values, errors, set }) {
  const settings = values.tmdb_settings || {};
  const setSetting = (patch) => set('tmdb_settings', { ...settings, ...patch });
  const [options, setOptions] = useState({
    regions: [],
    providers: [],
    genres: [],
    languages: [],
  });
  const [optionsError, setOptionsError] = useState('');
  const discover = values.tmdb_source === 'discover';
  const service = values.tmdb_source === 'watch-provider';
  const contentType = values.content_type === 'series' ? 'series' : 'movie';
  useEffect(() => {
    if (!discover && !service) return;
    API.getVODTmdbOptions(contentType, settings.region || '')
      .then((result) => {
        setOptions(result);
        setOptionsError('');
      })
      .catch((err) => setOptionsError(formatApiError(err)));
  }, [discover, service, contentType, settings.region]);
  return (
    <Stack gap="md">
      <Section title="TMDB">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="xs">
          <Select
            label="Source"
            allowDeselect={false}
            value={values.tmdb_source || null}
            error={errors.tmdb_source}
            data={tmdbSources(values.content_type)}
            onChange={(value) => {
              set('tmdb_source', value);
              set('tmdb_settings', {});
            }}
          />
          {values.tmdb_source === 'list' && (
            <TextInput
              label={
                <HelpLabel
                  label="TMDB list ID"
                  help="The number in the address of a public TMDB list, e.g. 1234 in themoviedb.org/list/1234."
                />
              }
              aria-label="TMDB list ID"
              value={settings.list_id || ''}
              error={errors.list_id}
              onChange={(event) =>
                setSetting({ list_id: event.currentTarget.value.trim() })
              }
            />
          )}
        </SimpleGrid>
      </Section>
      {discover && (
        <Section title="Discover">
          <SimpleGrid
            cols={{ base: 1, md: 3 }}
            spacing="md"
            verticalSpacing="xs"
          >
            <Text size="sm" fw={500} style={{ gridColumn: '1 / -1' }}>
              <HelpLabel
                label="Released"
                help="Movies by release date, series by their first air date."
              />
            </Text>
            <PeriodFields
              mode={settings.release_mode || ''}
              onMode={(mode) =>
                set('tmdb_settings', {
                  ...Object.fromEntries(
                    Object.entries(settings).filter(
                      ([key]) => !key.startsWith('release_')
                    )
                  ),
                  ...(mode ? { release_mode: mode } : {}),
                })
              }
              value={Object.fromEntries(
                Object.entries(RELEASE_KEYS).map(([key, field]) => [
                  key,
                  settings[field] || '',
                ])
              )}
              errors={Object.fromEntries(
                Object.entries(RELEASE_KEYS).map(([key, field]) => [
                  key,
                  errors[field],
                ])
              )}
              onChange={(patch) =>
                setSetting(
                  Object.fromEntries(
                    Object.entries(patch).map(([key, item]) => [
                      RELEASE_KEYS[key],
                      item,
                    ])
                  )
                )
              }
            />
          </SimpleGrid>
          <SimpleGrid
            cols={{ base: 1, md: 3 }}
            spacing="md"
            verticalSpacing="xs"
          >
            <MultiSelect
              label="Genres"
              placeholder={settings.genres?.length ? undefined : 'Any genre'}
              searchable
              clearable
              value={settings.genres || []}
              error={errors.genres}
              data={options.genres}
              onChange={(value) => setSetting({ genres: value })}
            />
            <Select
              label="Original language"
              placeholder="Any language"
              searchable
              clearable
              selectFirstOptionOnChange
              value={settings.original_language || null}
              error={errors.original_language}
              data={options.languages}
              onChange={(value) =>
                setSetting({ original_language: value || '' })
              }
            />
            <Switch
              mt={30}
              label={
                <HelpLabel
                  label="Anime only"
                  help="Titles TMDB tags with the anime keyword."
                />
              }
              checked={!!settings.anime}
              onChange={(event) =>
                setSetting({ anime: event.currentTarget.checked })
              }
            />
          </SimpleGrid>
          <KeywordPicker
            value={settings.keywords || []}
            match={settings.keyword_match || 'any'}
            anime={!!settings.anime}
            error={errors.keywords}
            onChange={(keywords) =>
              setSetting({
                keywords,
                ...(keywords.length < 2 ? { keyword_match: undefined } : {}),
              })
            }
            onMatch={(match) =>
              setSetting({
                keyword_match: match === 'all' ? 'all' : undefined,
              })
            }
          />
          {optionsError && (
            <Text size="sm" c="red">
              {optionsError}
            </Text>
          )}
        </Section>
      )}
      {service && (
        <Section title="Streaming service">
          <SimpleGrid
            cols={{ base: 1, md: 3 }}
            spacing="md"
            verticalSpacing="xs"
          >
            <Select
              label="Region"
              searchable
              clearable
              selectFirstOptionOnChange
              value={settings.region || null}
              error={errors.region}
              data={options.regions}
              onChange={(value) =>
                setSetting({ region: value || '', provider_id: '' })
              }
            />
            <Select
              label="Streaming service"
              searchable
              clearable
              selectFirstOptionOnChange
              disabled={!settings.region}
              value={settings.provider_id || null}
              error={errors.provider_id}
              data={options.providers}
              onChange={(value) => setSetting({ provider_id: value || '' })}
            />
            <Select
              label="Offered as"
              allowDeselect={false}
              value={settings.monetization || 'flatrate'}
              data={MONETIZATION}
              onChange={(value) => setSetting({ monetization: value })}
            />
          </SimpleGrid>
          {optionsError && (
            <Text size="sm" c="red">
              {optionsError}
            </Text>
          )}
        </Section>
      )}
    </Stack>
  );
}

export default function VODListDialog({ vodList, onClose, onSaved }) {
  const initial = useMemo(
    () => ({ ...newList(vodList.list_type), ...vodList }),
    [vodList]
  );
  const [values, setValues] = useState(initial);
  const [serverErrors, setServerErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const clientErrors = submitted ? listValidation(values) : {};
  const errors = { ...serverErrors, ...clientErrors };

  const set = (field, value) => {
    setValues((current) => {
      const next = { ...current, [field]: value };
      // A new type brings its schedule and TMDB source along.
      if (field === 'list_type') {
        next.refresh_interval = newList(value).refresh_interval;
        next.tmdb_source = newList(value).tmdb_source;
        next.tmdb_settings = {};
      }
      // The TMDB source has to offer the chosen content.
      if (
        field === 'content_type' &&
        current.list_type === 'tmdb' &&
        !tmdbSources(value).some(
          (source) => source.value === current.tmdb_source
        )
      ) {
        next.tmdb_source = tmdbSources(value)[0].value;
        next.tmdb_settings = {};
      }
      return next;
    });
    setServerErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  // The server's reason is named, as it may concern a field on another tab.
  const fail = (found, server = false) => {
    const next = ['general', 'tmdb', 'rules', 'schedule'].find((name) =>
      tabHasError(name, found)
    );
    if (next) setTab(next);
    showNotification({
      title: 'List not saved',
      message:
        (server && firstMessage(found)) || 'Check the highlighted fields.',
      color: 'red',
    });
  };

  const save = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    const found = listValidation(values);
    if (Object.keys(found).length) {
      fail(found);
      return;
    }
    setSaving(true);
    setDetail('');
    try {
      const result = await API.saveVODList(listPayload(values), values.id);
      showNotification({
        title: `Saved ${result.name}`,
        message: ['pending', 'building'].includes(result.build_status)
          ? 'Its titles are being updated.'
          : undefined,
        color: 'green',
      });
      onSaved(result);
    } catch (err) {
      const parsed = listErrors(err.body);
      setServerErrors(parsed.errors);
      if (Object.keys(parsed.errors).length) fail(parsed.errors, true);
      else setDetail(parsed.detail || formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const [tab, setTab] = useState('general');
  const tabLabel = (name, label) => (
    <TabsTab value={name} c={tabHasError(name, errors) ? 'red' : undefined}>
      {label}
    </TabsTab>
  );
  const props = { values, errors, set };

  return (
    <LibraryDialog
      title={vodList.id ? `Edit ${vodList.name}` : 'Add list'}
      dirty={dirty}
      busy={saving}
      onClose={onClose}
      size="72vw"
      classNames={{
        content: editorClasses.content,
        body: editorClasses.body,
        header: editorClasses.header,
      }}
    >
      <form onSubmit={save} className={editorClasses.form}>
        <Tabs value={tab} onChange={setTab} className={editorClasses.tabs}>
          <TabsList className={editorClasses.tabList}>
            {tabLabel('general', 'General')}
            {values.list_type === 'tmdb' && tabLabel('tmdb', 'TMDB')}
            {values.list_type === 'rules' && tabLabel('rules', 'Rules')}
            {tabLabel('schedule', 'Schedule')}
          </TabsList>
          <TabsPanel value="general" className={editorClasses.panel}>
            <GeneralTab {...props} saved={vodList} />
          </TabsPanel>
          <TabsPanel value="tmdb" className={editorClasses.panel}>
            {values.list_type === 'tmdb' && <TmdbSections {...props} />}
          </TabsPanel>
          <TabsPanel value="rules" className={editorClasses.panel}>
            {values.list_type === 'rules' && <RulesSection {...props} />}
          </TabsPanel>
          <TabsPanel value="schedule" className={editorClasses.panel}>
            <ScheduleTab key={values.list_type} {...props} />
          </TabsPanel>
        </Tabs>
        {detail && (
          <Alert color="red" mb="sm">
            {detail}
          </Alert>
        )}
        <Flex
          component="footer"
          className={`${editorClasses.footer} ${editorClasses.plainFooter}`}
          mih={50}
          gap="xs"
          align="center"
          justify="flex-end"
        >
          <Button type="submit" loading={saving}>
            Save
          </Button>
        </Flex>
      </form>
    </LibraryDialog>
  );
}
