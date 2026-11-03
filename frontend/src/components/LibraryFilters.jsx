import { useState } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Indicator,
  MultiSelect,
  NumberInput,
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
import {
  DatePickerInput,
  MonthPickerInput,
  YearPickerInput,
} from '@mantine/dates';
import { Filter, ListPlus } from 'lucide-react';
import dayjs from 'dayjs';
import MEDIA_LANGUAGES from '../../../apps/vod/media_languages.json';
import { useDateTimeFormat } from '../utils/dateTimeUtils.js';
import {
  LIBRARY_EXTRA_FILTERS,
  MONTH_DAY,
  NAMED_PERIODS,
  PERIOD_OPTIONS,
  UNIT_PERIODS,
  dateRules,
  fromDayMonth,
  libraryFilterCount,
  parseDay,
  periodWindow,
  toDayMonth,
} from '../utils/libraryFilters.js';

// Rules lists filter the Library addition and the release over periods that
// may move on with the date.
const DATE_FIELDS = {
  added: {
    days: 'added_after_days',
    since: 'added_since',
    until: 'added_until',
    period: 'added_period',
    anchor: 'added_period_anchor',
    fromDay: 'added_from_day',
    untilDay: 'added_until_day',
  },
  released: {
    days: 'released_last_days',
    since: 'released_since',
    until: 'released_until',
    period: 'released_period',
    anchor: 'released_period_anchor',
    fromDay: 'released_from_day',
    untilDay: 'released_until_day',
  },
};

// Countries whose age ratings TMDB knows well.
const RATING_COUNTRIES = [
  { value: 'DE', label: 'Germany (FSK)' },
  { value: 'AT', label: 'Austria' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'US', label: 'United States (MPAA)' },
  { value: 'GB', label: 'United Kingdom (BBFC)' },
  { value: 'FR', label: 'France' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'ES', label: 'Spain' },
  { value: 'IT', label: 'Italy' },
];

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

// The filter fields, shown in the Library popover and inline for rules lists.
export function LibraryFilterFields({
  filters,
  onChange,
  options = {},
  moviesEnabled = true,
  seriesEnabled = true,
  admin = false,
  contentType = true,
  fileData = true,
  periods = false,
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
  const dates = periods ? dateRules(filters) : '';
  const terms = (field) => (filters[field] ? filters[field].split(',') : []);
  const tags = (field, label, placeholder) => (
    <TagsInput
      label={label}
      placeholder={terms(field).length ? undefined : placeholder}
      clearable
      splitChars={[',']}
      maxTags={10}
      style={{ gridColumn: '1 / -1' }}
      styles={{ input: { minHeight: 72 } }}
      value={terms(field)}
      onChange={(value) =>
        onChange({
          [field]: value
            .map((term) => term.trim())
            .filter(Boolean)
            .join(','),
        })
      }
    />
  );
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
          {periods ? (
            <DatePeriod
              label="Added"
              fields={DATE_FIELDS.added}
              filters={filters}
              onChange={onChange}
            />
          ) : (
            dateRange('Added', 'added_since', 'added_until')
          )}
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
      {fileData &&
        group(
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
            {select(
              'resolution',
              'Resolution',
              actual('resolution', 'resolution')
            )}
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
          {tags('genre', 'Genre contains', 'Enter a genre and press Enter')}
          {tags(
            'keyword',
            'Keyword contains',
            'Enter a TMDB keyword and press Enter'
          )}
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
          <NumberInput
            label={
              <Tooltip
                label="FSK 12 counts as 12, PG-13 as 13. With a country only its rating counts, otherwise the lowest of all countries. Ratings without a number, such as R or TV-MA, and titles without a rating do not match."
                multiline
                maw={320}
                withArrow
              >
                <span>Maximum age rating</span>
              </Tooltip>
            }
            placeholder="Any"
            min={0}
            max={21}
            allowDecimal={false}
            value={filters.max_age_rating ?? ''}
            onChange={(value) =>
              onChange({ max_age_rating: value === '' ? '' : Number(value) })
            }
          />
          {select(
            'age_rating_country',
            'Rating country',
            RATING_COUNTRIES,
            'Lowest of all'
          )}
          {periods ? (
            <>
              <DatePeriod
                label="Released"
                fields={DATE_FIELDS.released}
                filters={filters}
                onChange={onChange}
              />
              {dates && (
                <Text
                  size="xs"
                  c={dates === 'conflict' ? 'red' : 'dimmed'}
                  style={{ gridColumn: '1 / -1' }}
                >
                  {dates === 'conflict'
                    ? 'Released starts after the Added period ends, so no title can match.'
                    : 'Titles need to match both Added and Released.'}
                </Text>
              )}
            </>
          ) : (
            dateRange('Released', 'released_since', 'released_until')
          )}
        </>
      )}
    </Stack>
  );
}

const SEASON_STARTS = [
  { value: '01', label: 'Winter' },
  { value: '04', label: 'Spring' },
  { value: '07', label: 'Summer' },
  { value: '10', label: 'Fall' },
];

// The period of a VOD list date: dates, last days, a week, month, season or
// year (the current one or a chosen one) or a day range every year. Values
// use the keys since, until, days, fromDay, untilDay and anchor.
export function PeriodFields({
  label = 'Period',
  mode,
  onMode,
  value,
  onChange,
  errors = {},
}) {
  const { dateYearFormat } = useDateTimeFormat();
  const today = dayjs();
  const anchor = UNIT_PERIODS.includes(mode) ? value.anchor : '';
  const current = periodWindow(
    mode,
    value,
    anchor ? parseDay(anchor) : undefined
  );
  const day = (key, label) => (
    <TextInput
      label={label}
      placeholder="DD.MM"
      maxLength={5}
      value={value[key] ? toDayMonth(value[key]) : ''}
      error={
        errors[key] ||
        (value[key] && !MONTH_DAY.test(value[key])
          ? 'Enter the day as DD.MM.'
          : undefined)
      }
      onChange={(event) =>
        onChange({ [key]: fromDayMonth(event.currentTarget.value) })
      }
    />
  );
  const picker = { popoverProps: { withinPortal: false } };
  const year = anchor ? anchor.slice(0, 4) : '';
  return (
    <>
      <Select
        label={label}
        placeholder="Any time"
        clearable
        comboboxProps={{ withinPortal: false }}
        data={PERIOD_OPTIONS}
        value={mode || null}
        onChange={(next) => onMode(next || '')}
      />
      {UNIT_PERIODS.includes(mode) && (
        <Select
          label="Which"
          allowDeselect={false}
          comboboxProps={{ withinPortal: false }}
          data={[
            { value: 'current', label: `Current ${mode}` },
            { value: 'chosen', label: `Choose a ${mode}` },
          ]}
          value={anchor ? 'chosen' : 'current'}
          onChange={(which) =>
            onChange({
              // A chosen period starts as the current one, ready to change.
              anchor:
                which === 'chosen'
                  ? dayjs(periodWindow(mode, {})[0]).format('YYYY-MM-DD')
                  : '',
            })
          }
        />
      )}
      {anchor && mode === 'week' && (
        <DatePickerInput
          label="Week of"
          {...picker}
          valueFormat={dateYearFormat}
          value={anchor}
          onChange={(next) => onChange({ anchor: next || '' })}
        />
      )}
      {anchor && mode === 'month' && (
        <MonthPickerInput
          label="Month"
          {...picker}
          valueFormat="MMMM YYYY"
          maxDate={today.format('YYYY-MM-DD')}
          value={anchor}
          onChange={(next) => onChange({ anchor: next || '' })}
        />
      )}
      {anchor && mode === 'season' && (
        <Group grow gap="sm" align="flex-start">
          <Select
            label="Season"
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
            data={SEASON_STARTS}
            value={anchor.slice(5, 7)}
            onChange={(month) => onChange({ anchor: `${year}-${month}-01` })}
          />
          <YearPickerInput
            label="Year"
            {...picker}
            value={`${year}-01-01`}
            onChange={(next) =>
              next &&
              onChange({
                anchor: `${next.slice(0, 4)}-${anchor.slice(5, 7)}-01`,
              })
            }
          />
        </Group>
      )}
      {anchor && mode === 'year' && (
        <YearPickerInput
          label="Year"
          {...picker}
          value={anchor}
          onChange={(next) => next && onChange({ anchor: next })}
        />
      )}
      {mode === 'range' && (
        <>
          <DatePickerInput
            label="From"
            placeholder="Any date"
            clearable
            {...picker}
            valueFormat={dateYearFormat}
            value={value.since || null}
            error={errors.since}
            onChange={(next) => onChange({ since: next || '' })}
          />
          <DatePickerInput
            label="Until"
            placeholder="Any date"
            clearable
            {...picker}
            valueFormat={dateYearFormat}
            minDate={value.since || undefined}
            value={value.until || null}
            error={
              errors.until ||
              (value.since && value.until && value.since > value.until
                ? 'End date precedes start date.'
                : undefined)
            }
            onChange={(next) => onChange({ until: next || '' })}
          />
        </>
      )}
      {mode === 'days' && (
        <NumberInput
          label="Days"
          min={1}
          max={36500}
          allowDecimal={false}
          value={value.days ?? ''}
          error={errors.days}
          onChange={(next) =>
            onChange({ days: next === '' ? '' : Number(next) })
          }
        />
      )}
      {mode === 'yearly' && (
        <>
          {day('fromDay', 'Every year from')}
          {day('untilDay', 'Until')}
        </>
      )}
      {current && (
        <Text size="xs" c="dimmed" style={{ gridColumn: '1 / -1' }}>
          {anchor ? 'Covers' : 'Now'}:{' '}
          {dayjs(current[0]).format(dateYearFormat)} –{' '}
          {dayjs(current[1]).format(dateYearFormat)}
        </Text>
      )}
    </>
  );
}

// The Added or Released period of a rules list, on its own fields.
function DatePeriod({ label, fields, filters, onChange }) {
  const [chosen, setChosen] = useState(null);
  const found = filters[fields.period]
    ? filters[fields.period]
    : filters[fields.days]
      ? 'days'
      : filters[fields.since] || filters[fields.until]
        ? 'range'
        : '';
  const mode = chosen ?? found;
  const value = Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, filters[field] || ''])
  );
  return (
    <PeriodFields
      label={label}
      mode={mode}
      onMode={(next) => {
        setChosen(next);
        onChange({
          ...Object.fromEntries(
            Object.values(fields).map((field) => [field, ''])
          ),
          ...(NAMED_PERIODS.includes(next) ? { [fields.period]: next } : {}),
        });
      }}
      value={value}
      onChange={(patch) =>
        onChange(
          Object.fromEntries(
            Object.entries(patch).map(([key, item]) => [fields[key], item])
          )
        )
      }
    />
  );
}

export default function LibraryFilters({
  filters,
  onChange,
  options = {},
  moviesEnabled = true,
  seriesEnabled = true,
  admin = false,
  onSaveAsList,
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
          <Group justify="space-between" gap="xs">
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
            {onSaveAsList && (
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<ListPlus size={14} />}
                disabled={!activeCount}
                onClick={onSaveAsList}
              >
                Save as list
              </Button>
            )}
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
