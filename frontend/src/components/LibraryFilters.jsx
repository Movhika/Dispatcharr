import {
  ActionIcon,
  Button,
  Group,
  Indicator,
  MultiSelect,
  Popover,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { Filter } from 'lucide-react';
import MEDIA_LANGUAGES from '../../../apps/vod/media_languages.json';
import { useDateTimeFormat } from '../utils/dateTimeUtils.js';
import { streamingGroups } from '../utils/libraryStreaming.js';
import {
  LIBRARY_EXTRA_FILTERS,
  RESOLUTION_TIERS,
  libraryFilterCount,
} from '../utils/libraryFilters.js';

const validPattern = (value) => {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
};

const languageLabel = (value) =>
  MEDIA_LANGUAGES.find((option) => option.value === value)?.label || value;
const featureLabel = (value) =>
  ({ hdr: 'HDR', dv: 'DV (Dolby Vision)', '3d': '3D' })[value] ||
  value.replace(/^custom:/, '');

// The filter fields, shown in the Library popover and for profile rules.
export function LibraryFilterFields({
  filters,
  onChange,
  options = {},
  moviesEnabled = true,
  seriesEnabled = true,
  admin = false,
  contentType = true,
}) {
  const { dateYearFormat } = useDateTimeFormat();
  const bothTypes = moviesEnabled && seriesEnabled;
  const select = (field, label, data, placeholder = 'Any') => (
    <Select
      key={field}
      label={label}
      placeholder={placeholder}
      clearable
      searchable
      comboboxProps={{ withinPortal: false }}
      data={data}
      value={filters[field] || null}
      onChange={(value) => onChange({ [field]: value || '' })}
    />
  );
  // Several IDs travel as one comma-separated value, like a single one.
  const multiple = (field, label, data, placeholder) => {
    const value = filters[field] ? String(filters[field]).split(',') : [];
    return (
      <MultiSelect
        key={field}
        label={label}
        placeholder={value.length ? undefined : placeholder}
        clearable
        searchable
        comboboxProps={{ withinPortal: false }}
        data={[
          ...data,
          // Keep chosen values whose options are not loaded.
          ...value
            .filter((id) => !data.some((option) => option.value === id))
            .map((id) => ({ value: id, label: `#${id}` })),
        ]}
        value={value}
        onChange={(next) => onChange({ [field]: next.join(',') })}
      />
    );
  };
  // A saved exact resolution shows as a range of one tier.
  const exact = filters.resolution || '';
  const lowest = filters.resolution_min || exact;
  const highest = filters.resolution_max || exact;
  const tiers = RESOLUTION_TIERS.filter((tier) =>
    [...(options.resolution || []), lowest, highest].includes(tier)
  ).map((tier) => ({ value: tier, label: tier }));
  const resolution = (field, label, value) => (
    <Select
      key={field}
      label={label}
      placeholder="Any"
      clearable
      comboboxProps={{ withinPortal: false }}
      data={tiers}
      value={value || null}
      error={
        field === 'resolution_max' &&
        lowest &&
        highest &&
        RESOLUTION_TIERS.indexOf(lowest) < RESOLUTION_TIERS.indexOf(highest)
          ? 'Choose a maximum at or above the minimum.'
          : undefined
      }
      onChange={(next) =>
        onChange({
          resolution: '',
          resolution_min: lowest,
          resolution_max: highest,
          [field]: next || '',
        })
      }
    />
  );
  const actual = (field, key, label = (value) => value) =>
    [
      ...new Set([
        ...(options[key] || []),
        ...(filters[field] ? [filters[field]] : []),
      ]),
    ].map((value) => ({ value, label: label(value) }));
  const group = (title, children) => (
    <Paper
      component="section"
      aria-label={`${title} filters`}
      withBorder
      p="sm"
    >
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          {title}
        </Text>
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
          {children}
        </SimpleGrid>
      </Stack>
    </Paper>
  );
  const date = (field, label, props = {}) => (
    <DatePickerInput
      label={label}
      placeholder="Any date"
      clearable
      valueFormat={dateYearFormat}
      popoverProps={{ withinPortal: false }}
      value={filters[field] || null}
      onChange={(value) => onChange({ [field]: value || '' })}
      {...props}
    />
  );
  const dateRange = (label, start, end) => (
    <>
      {date(start, `${label} from`)}
      {date(end, `${label} to`, {
        minDate: filters[start] || undefined,
        error:
          filters[start] && filters[end] && filters[start] > filters[end]
            ? 'End date precedes start date.'
            : undefined,
      })}
    </>
  );
  const genres = filters.genre ? filters.genre.split(',') : [];
  const services = filters.streaming_service
    ? filters.streaming_service.split(',')
    : [];
  return (
    <Stack gap="sm">
      {((bothTypes && contentType) || admin) &&
        group(
          'Content',
          <>
            {bothTypes && contentType && (
              <Select
                label="Content type"
                allowDeselect={false}
                comboboxProps={{ withinPortal: false }}
                value={filters.type || 'all'}
                data={[
                  { value: 'all', label: 'All' },
                  { value: 'movie', label: 'Movies' },
                  { value: 'series', label: 'Series' },
                ]}
                onChange={(value) =>
                  onChange({
                    type: value,
                    category: '',
                    content_id: '',
                  })
                }
              />
            )}
            {admin &&
              select('blocked', 'Availability', [
                { value: 'false', label: 'Available' },
                { value: 'true', label: 'Blocked' },
              ])}
          </>
        )}
      {group(
        'Provider',
        <>
          {multiple(
            'account',
            'Provider account',
            (options.accounts || []).map((row) => ({
              value: String(row.id),
              label: row.name,
            })),
            'All accounts'
          )}
          {multiple(
            'category',
            'Provider category',
            (options.categories || [])
              .filter(
                (row) =>
                  !filters.type ||
                  filters.type === 'all' ||
                  row.category_type === filters.type
              )
              .map((row) => ({
                value: String(row.id),
                label: row.name,
              })),
            'All categories'
          )}
          <TextInput
            label={
              <Group gap={5} wrap="nowrap" display="inline-flex">
                <span>Category name (regex)</span>
                <Tooltip
                  label="Like the M3U import rules, ignoring case: amazon matches every category with amazon in its name, amazon|prime either word, ^DE matches names starting with DE. Categories the provider adds later match too."
                  multiline
                  maw={340}
                  withArrow
                  events={{ hover: true, focus: true, touch: true }}
                >
                  <Text
                    span
                    size="xs"
                    c="dimmed"
                    tabIndex={0}
                    aria-label="Category name help"
                    style={{ cursor: 'help' }}
                  >
                    ⓘ
                  </Text>
                </Tooltip>
              </Group>
            }
            aria-label="Category name (regex)"
            placeholder="e.g. amazon|prime"
            style={{ gridColumn: '1 / -1' }}
            value={filters.category_match || ''}
            error={
              filters.category_match && !validPattern(filters.category_match)
                ? 'Invalid regular expression.'
                : undefined
            }
            onChange={(event) =>
              onChange({ category_match: event.currentTarget.value })
            }
          />
          {dateRange('Added', 'added_since', 'added_until')}
          {!!filters.content_id && (
            <Button
              variant="light"
              size="compact-sm"
              onClick={() => onChange({ content_id: '' })}
            >
              Clear title filter
            </Button>
          )}
        </>
      )}
      {group(
        'File data',
        <>
          {select(
            'audio_language',
            'DUB',
            actual('audio_language', 'audio_languages', languageLabel)
          )}
          {select(
            'subtitle_language',
            'SUB',
            actual('subtitle_language', 'subtitle_languages', languageLabel)
          )}
          {resolution('resolution_min', 'Resolution from', lowest)}
          {resolution('resolution_max', 'Resolution to', highest)}
          {select(
            'video_feature',
            'Feature',
            actual('video_feature', 'video_features', featureLabel)
          )}
          {select(
            'container_extension',
            'Format',
            actual('container_extension', 'container_extensions')
          )}
        </>
      )}
      {group(
        'Metadata',
        <>
          <TagsInput
            label="Genre contains"
            placeholder={
              genres.length ? undefined : 'Enter a genre and press Enter'
            }
            clearable
            splitChars={[',']}
            maxTags={10}
            style={{ gridColumn: '1 / -1' }}
            styles={{ input: { minHeight: 72 } }}
            value={genres}
            onChange={(value) =>
              onChange({
                genre: value
                  .map((term) => term.trim())
                  .filter(Boolean)
                  .join(','),
              })
            }
          />
          <MultiSelect
            label="Streaming service"
            placeholder={filters.streaming_service ? undefined : 'Any'}
            clearable
            searchable
            style={{ gridColumn: '1 / -1' }}
            comboboxProps={{ withinPortal: false }}
            data={streamingGroups(options.streaming_services, services)}
            value={services}
            onChange={(value) =>
              onChange({ streaming_service: value.join(',') })
            }
          />
          {select('adult_mode', 'Adult content', [
            { value: 'only', label: 'Only adult content' },
            { value: 'exclude', label: 'Exclude adult content' },
          ])}
          {select('anime_mode', 'Anime', [
            { value: 'only', label: 'Only anime' },
            { value: 'exclude', label: 'Exclude anime' },
          ])}
          {select(
            'metadata_status',
            'Metadata',
            [
              { value: 'enriched', label: 'Enriched' },
              {
                value: 'missing_metadata',
                label: 'Not enriched',
              },
              { value: 'missing_id', label: 'No TMDB ID' },
              {
                value: 'missing_external_ids',
                label: 'No external ID',
              },
            ],
            'Any'
          )}
          {select(
            'locked',
            'Metadata protection',
            [
              { value: 'true', label: 'Protected' },
              { value: 'false', label: 'Unlocked' },
            ],
            'Protection'
          )}
          {dateRange('Released', 'released_since', 'released_until')}
        </>
      )}
    </Stack>
  );
}

export default function LibraryFilters({
  filters,
  onChange,
  options = {},
  moviesEnabled = true,
  seriesEnabled = true,
  admin = false,
}) {
  const bothTypes = moviesEnabled && seriesEnabled;
  const activeCount = libraryFilterCount(filters, bothTypes);
  const activeLabel = `${activeCount} ${activeCount === 1 ? 'filter' : 'filters'} active`;
  return (
    <Popover
      width={460}
      position="bottom-start"
      shadow="md"
      withArrow
      arrowPosition="center"
      withinPortal
      trapFocus
      returnFocus
    >
      <Indicator
        inline
        color="red"
        size={10}
        offset={1}
        withBorder
        disabled={!activeCount}
        zIndex={1}
      >
        <Popover.Target>
          <Tooltip label={activeCount ? activeLabel : 'Library filters'}>
            <ActionIcon
              size="input-sm"
              variant={activeCount ? 'light' : 'default'}
              aria-label="Filter library"
              aria-description={activeCount ? activeLabel : undefined}
              data-filter-active={activeCount ? true : undefined}
            >
              <Filter size={17} aria-hidden="true" />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
      </Indicator>
      <Popover.Dropdown style={{ maxWidth: 'calc(100vw - 24px)' }}>
        <Stack gap="sm">
          <Text size="sm" fw={600}>
            Filters
          </Text>
          <ScrollArea.Autosize
            mah="min(500px, calc(100dvh - 240px))"
            type="auto"
            offsetScrollbars
          >
            <LibraryFilterFields
              filters={filters}
              onChange={onChange}
              options={options}
              moviesEnabled={moviesEnabled}
              seriesEnabled={seriesEnabled}
              admin={admin}
            />
          </ScrollArea.Autosize>
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={!activeCount}
            onClick={() =>
              onChange({
                ...Object.fromEntries(
                  LIBRARY_EXTRA_FILTERS.map((field) => [field, ''])
                ),
                ...(bothTypes ? { type: 'all' } : {}),
              })
            }
          >
            Reset filters
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
