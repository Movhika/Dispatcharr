import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Flex,
  Group,
  MultiSelect,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useMediaQuery } from '@mantine/hooks';
import API from '../../api';
import ConfirmationDialog from '../ConfirmationDialog.jsx';
import { LibraryDialog } from '../LibraryDialogs.jsx';
import { SensitiveValue } from '../SensitiveFields.jsx';
import { formatApiError } from '../../utils';
import {
  hideNotification,
  showNotification,
} from '../../utils/notificationUtils.js';
import { metadataLanguageLabel } from '../../utils/vodMetadataLanguages.js';
import {
  METADATA_SOURCES,
  NAME_LABEL_FIELDS,
  NAME_PLACEHOLDERS,
  OTHER,
  OUTPUT_GROUPS,
  SEVERAL,
  OUTPUT_MODES,
  featureTagOptions,
  filterTagOptions,
  fieldError,
  firstMessage,
  editionConflict,
  isBlankEdition,
  isBlankLabel,
  editionCountText,
  labelSelection,
  labelSummary,
  labelUnused,
  languageOptions,
  languageTagOptions,
  newEditionRule,
  newNameLabel,
  newProfile,
  profileErrors,
  profileExample,
  profilePayload,
  profileValidation,
  renderTagOption,
  sameEdition,
  tabHasError,
} from '../../utils/vodProfiles';
import {
  ContentRulesEditor,
  DragHandle,
  EditionRulesEditor,
  HelpLabel,
  RuleActions,
  RuleIntro,
  RuleMarker,
  RuleRow,
  SortableItem,
  SortableList,
} from './VODProfileRuleEditors.jsx';
import editorClasses from './AccountEditor.module.css';

const initialValues = (profile) => ({ ...newProfile(), ...profile });

const helpLabel = (label, help) => <HelpLabel label={label} help={help} />;

const ERROR_NOTIFICATION = 'vod-profile-error';

const NO_VALUES = { languages: [], resolutions: [], video_features: [] };

// One error notification at a time, replaced by the next problem.
const notifyError = (title, message) => {
  hideNotification(ERROR_NOTIFICATION);
  showNotification({ id: ERROR_NOTIFICATION, title, message, color: 'red' });
};

// A row being edited shows its problems only once its save was tried.
const hideUnchecked = (errors, rowEdit) => {
  const rows = rowEdit && !rowEdit.checked && errors[rowEdit.field];
  if (!rows || typeof rows !== 'object') return errors;
  const { [rowEdit.index]: _hidden, ...rest } = rows;
  const next = { ...errors };
  if (Object.keys(rest).length) next[rowEdit.field] = rest;
  else delete next[rowEdit.field];
  return next;
};

function Section({ title, action, children }) {
  return (
    <Paper withBorder p="sm">
      <Stack gap={4} style={{ minWidth: 0 }} role="group" aria-label={title}>
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600}>{title}</Text>
          {action}
        </Group>
        {children}
      </Stack>
    </Paper>
  );
}

const ANY_OTHER = { value: OTHER, label: 'Any other', name: 'Any other value' };

function labelValueOptions(field, options) {
  if (field === 'resolution')
    return [
      { value: OTHER, label: 'Any other value' },
      ...(options.resolutions || []).map((value) => ({ value, label: value })),
    ];
  if (field === 'features')
    return [ANY_OTHER, ...featureTagOptions(options.video_features)];
  return [
    { value: SEVERAL, label: 'Several', name: 'Several languages' },
    ANY_OTHER,
    ...languageTagOptions(options.languages),
  ];
}

function LabelsTab({
  values,
  options,
  errors,
  editing,
  onChange,
  onAdd,
  onEdit,
  onSave,
  onDiscard,
}) {
  const rows = values.name_labels || [];
  const template = values.name_template;
  const update = (index, patch) =>
    onChange(
      rows.map((row, item) => (item === index ? { ...row, ...patch } : row))
    );
  return (
    <Stack gap="sm">
      <RuleIntro
        action={
          <Button
            size="xs"
            leftSection={<Plus size={14} />}
            disabled={editing !== null}
            onClick={onAdd}
          >
            Add label
          </Button>
        }
      >
        <strong>Labels replace values in names</strong>, e.g. 1080p with FHD or
        GER and ENG with DUAL. Several covers two or more languages, Any other
        every value without a label of its own; an empty text leaves the value
        out.
      </RuleIntro>
      {!rows.length && (
        <Alert color="gray">
          No labels. Names show the values as they are.
        </Alert>
      )}
      {rows.map((row, index) => {
        const values = row.values || [];
        const data = labelValueOptions(row.field, options);
        const rowError = firstMessage(errors.name_labels?.[index]);
        const invalid = !!fieldError(errors, 'name_labels', index, 'values');
        const unused = labelUnused(row, template);
        const active = editing === index;
        return (
          <RuleRow
            key={index}
            error={rowError}
            warning={unused}
            editing={active}
          >
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <RuleMarker error={rowError} warning={unused} />
                <Text size="sm" truncate>
                  {labelSummary(row)}
                </Text>
              </Group>
              <RuleActions
                noun={`label ${index + 1}`}
                editing={active}
                locked={editing !== null && !active}
                onEdit={() => onEdit(index)}
                onSave={onSave}
                onDiscard={onDiscard}
                onDelete={() =>
                  onChange(rows.filter((_row, item) => item !== index))
                }
              />
            </Group>
            {active && (
              <Flex
                direction={{ base: 'column', sm: 'row' }}
                gap="xs"
                align={{ base: 'stretch', sm: 'flex-start' }}
                mt="xs"
              >
                <Select
                  aria-label={`Label ${index + 1} placeholder`}
                  w={{ base: '100%', sm: 130 }}
                  allowDeselect={false}
                  value={row.field}
                  data={NAME_LABEL_FIELDS}
                  onChange={(field) => update(index, { field, values: [] })}
                />
                {row.field === 'resolution' ? (
                  <Select
                    aria-label={`Label ${index + 1} values`}
                    placeholder="Value"
                    searchable
                    style={{ flex: 1, minWidth: 0 }}
                    value={values[0] || null}
                    error={invalid}
                    data={data}
                    onChange={(value) =>
                      update(index, { values: value ? [value] : [] })
                    }
                  />
                ) : (
                  <MultiSelect
                    aria-label={`Label ${index + 1} values`}
                    placeholder={values.length ? undefined : 'Values'}
                    searchable
                    style={{ flex: 1, minWidth: 0 }}
                    value={values}
                    error={invalid}
                    data={data}
                    renderOption={renderTagOption}
                    filter={filterTagOptions}
                    onChange={(next) =>
                      update(index, { values: labelSelection(values, next) })
                    }
                  />
                )}
                <TextInput
                  aria-label={`Label ${index + 1} text`}
                  placeholder="Text (empty hides it)"
                  style={{ flex: 1, minWidth: 0 }}
                  value={row.label}
                  onChange={(event) =>
                    update(index, { label: event.currentTarget.value })
                  }
                />
              </Flex>
            )}
          </RuleRow>
        );
      })}
    </Stack>
  );
}

function GeneralTab({ values, saved, options, errors, set }) {
  // Side by side, the choices do not fit a phone screen.
  const narrow = useMediaQuery('(max-width: 36em)');
  const insert = (placeholder) =>
    set('name_template', `${values.name_template} {${placeholder}}`.trim());
  const sources = values.output_mode === 'variants';
  return (
    <Stack gap="md">
      <Section
        title="Profile"
        action={
          <Tooltip
            label={
              saved.is_default
                ? 'Make another profile the default to change this.'
                : 'Users without an active VOD profile receive the default profile. There is only one default.'
            }
            multiline
            maw={320}
            withArrow
            events={{ hover: true, focus: true, touch: true }}
          >
            <span style={{ display: 'inline-flex' }}>
              <Switch
                size="sm"
                label="Default"
                labelPosition="left"
                checked={values.is_default}
                disabled={saved.is_default}
                error={!!errors.is_default}
                onChange={(event) =>
                  set('is_default', event.currentTarget.checked)
                }
              />
            </span>
          </Tooltip>
        }
      >
        <TextInput
          label="Name"
          withAsterisk
          value={values.name}
          error={!!errors.name}
          onChange={(event) => set('name', event.currentTarget.value)}
        />
      </Section>
      <Section title="Output">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="xs">
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {helpLabel(
                'Entries',
                'Compact offers one entry per title plus its editions; the failover order picks the source and its fallbacks, so names only show the title, year and edition. Sources offers every provider source as its own entry, as the provider does; its names can show the source details, e.g. {dub} or {provider}. Editions and failover only apply to Compact, labels only to Sources, but all are kept when you switch.'
              )}
            </Text>
            <SegmentedControl
              orientation={narrow ? 'vertical' : 'horizontal'}
              aria-label="Entries"
              value={values.output_mode}
              onChange={(value) => set('output_mode', value)}
              data={OUTPUT_MODES}
            />
          </Stack>
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {helpLabel(
                'Categories',
                'Provider keeps the categories of the providers. Movie & Series offers all movies in one category and all series in another.'
              )}
            </Text>
            <SegmentedControl
              orientation={narrow ? 'vertical' : 'horizontal'}
              aria-label="Categories"
              value={values.output_groups}
              onChange={(value) => set('output_groups', value)}
              data={OUTPUT_GROUPS}
            />
          </Stack>
          <Select
            label={helpLabel(
              'Title',
              'Provider keeps the titles of the providers. Clean title uses the titles cleaned up in the Library. A language uses the Library title in that language, falling back to the Library language order. Titles edited in the Library win except for Provider.'
            )}
            aria-label="Title"
            value={values.title_source}
            allowDeselect={false}
            error={!!errors.title_source}
            onChange={(value) => set('title_source', value || 'provider')}
            data={[
              { value: 'provider', label: 'Provider' },
              { value: 'clean', label: 'Clean title' },
              ...options.metadata_languages.map((language) => ({
                value: language,
                label: metadataLanguageLabel(language),
              })),
            ]}
          />
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {helpLabel(
                'Metadata',
                'Provider keeps the description, genres, rating, cast and artwork of the source. Enriched uses the Library metadata including your edits. Descriptions follow the Title language; with Provider or Clean title they use the first Library language. TMDB only translates titles and descriptions, so genres and cast stay in English. Lists get description, genre, rating and year; details get everything.'
              )}
            </Text>
            <SegmentedControl
              orientation={narrow ? 'vertical' : 'horizontal'}
              aria-label="Metadata"
              value={values.metadata_source}
              onChange={(value) => set('metadata_source', value)}
              data={METADATA_SOURCES}
            />
          </Stack>
        </SimpleGrid>
      </Section>
      <Section title="Names">
        <TextInput
          label={helpLabel(
            'Format',
            'How titles are named in clients. {title} is required; empty placeholders and their separators are left out. Compact names use {title}, {year} and {edition}; an edition is added after the title when {edition} is missing.'
          )}
          aria-label="Format"
          value={values.name_template}
          error={!!errors.name_template}
          onChange={(event) => set('name_template', event.currentTarget.value)}
        />
        <Group gap={6}>
          {NAME_PLACEHOLDERS.map((placeholder) => {
            // Source details only name Sources entries, editions only
            // Compact ones.
            const only = placeholder.compactOnly
              ? sources && 'Compact'
              : !sources && !placeholder.compact && 'Sources';
            const disabled = !!only;
            return (
              <Tooltip
                key={placeholder.value}
                label={
                  disabled
                    ? `${placeholder.help}. Only for ${only} entries.`
                    : placeholder.help
                }
              >
                <Badge
                  component="button"
                  type="button"
                  variant="light"
                  color="gray"
                  aria-disabled={disabled || undefined}
                  style={{
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.5 : 1,
                    textTransform: 'none',
                  }}
                  aria-label={`Insert ${placeholder.value}`}
                  onClick={() => !disabled && insert(placeholder.value)}
                >
                  {`{${placeholder.value}}`}
                </Badge>
              </Tooltip>
            );
          })}
        </Group>
        <Text size="sm" c="dimmed">
          Example: {profileExample(values)}
        </Text>
      </Section>
    </Stack>
  );
}

const FAILOVER_CRITERIA = [
  { value: 'provider', label: 'Provider order' },
  { value: 'audio_language', label: 'DUB language order' },
  { value: 'subtitle_language', label: 'SUB language order' },
  { value: 'resolution', label: 'Resolution' },
  { value: 'metadata_completeness', label: 'Most complete metadata' },
];

const criterionOf = (value) =>
  value.startsWith('resolution_') ? 'resolution' : value;

function Criterion({
  index,
  criterion,
  enabled,
  direction,
  onToggle,
  onDirection,
}) {
  return (
    <SortableItem index={index}>
      {(sortable) => (
        <Paper
          ref={sortable.setNodeRef}
          withBorder
          px="sm"
          py={8}
          style={{ ...sortable.style, opacity: enabled ? 1 : 0.55 }}
        >
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <DragHandle label={criterion.label} sortable={sortable} />
              <Text size="sm" fw={600}>
                {criterion.label}
              </Text>
            </Group>
            <Group gap="sm" wrap="nowrap">
              {criterion.value === 'resolution' && enabled && (
                <Select
                  size="xs"
                  w={140}
                  aria-label="Resolution preference"
                  value={direction}
                  allowDeselect={false}
                  onChange={onDirection}
                  data={[
                    { value: 'resolution_desc', label: 'Highest first' },
                    { value: 'resolution_asc', label: 'Lowest first' },
                  ]}
                />
              )}
              <Switch
                aria-label={`Use ${criterion.label}`}
                checked={enabled}
                onChange={(event) => onToggle(event.currentTarget.checked)}
              />
            </Group>
          </Group>
        </Paper>
      )}
    </SortableItem>
  );
}

function OrderList({ title, help, value, data, onChange }) {
  const labels = new Map(data.map((item) => [item.value, item.label]));
  const move = (index, offset) => {
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(index + offset, 0, item);
    onChange(next);
  };
  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        {helpLabel(title, help)}
      </Text>
      {value.map((item, index) => (
        <Paper key={item} withBorder px="sm" py={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" truncate>
              {index + 1}. {labels.get(item) || `Unavailable (${item})`}
            </Text>
            <Group gap={2} wrap="nowrap">
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Move ${labels.get(item) || item} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Move ${labels.get(item) || item} down`}
                disabled={index === value.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`Remove ${labels.get(item) || item}`}
                onClick={() =>
                  onChange(value.filter((entry) => entry !== item))
                }
              >
                <Trash2 size={15} />
              </ActionIcon>
            </Group>
          </Group>
        </Paper>
      ))}
      <Select
        aria-label={`Add to ${title}`}
        placeholder="Add"
        searchable
        value={null}
        onChange={(item) => item && onChange([...value, item])}
        data={data.filter((item) => !value.includes(item.value))}
      />
    </Stack>
  );
}

function FailoverTab({ values, options, set }) {
  const [order, setOrder] = useState(() => {
    const active = values.ranking.map(criterionOf);
    return [
      ...active,
      ...FAILOVER_CRITERIA.map((item) => item.value).filter(
        (item) => !active.includes(item)
      ),
    ];
  });
  const [direction, setDirection] = useState(
    values.ranking.includes('resolution_asc')
      ? 'resolution_asc'
      : 'resolution_desc'
  );
  const enabled = new Set(values.ranking.map(criterionOf));
  const publish = (nextOrder, nextEnabled, nextDirection = direction) =>
    set(
      'ranking',
      nextOrder
        .filter((item) => nextEnabled.has(item))
        .map((item) => (item === 'resolution' ? nextDirection : item))
    );
  // Ordered rows name each language in full.
  const languages = languageOptions(options.languages);
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
      <Section title="Failover order">
        <SortableList
          items={order}
          onChange={(next) => {
            setOrder(next);
            publish(next, enabled);
          }}
        >
          <Stack gap="xs">
            {order.map((value, index) => (
              <Criterion
                key={value}
                index={index}
                criterion={FAILOVER_CRITERIA.find(
                  (item) => item.value === value
                )}
                enabled={enabled.has(value)}
                direction={direction}
                onDirection={(next) => {
                  setDirection(next);
                  publish(order, enabled, next);
                }}
                onToggle={(checked) => {
                  const next = new Set(enabled);
                  if (checked) next.add(value);
                  else next.delete(value);
                  publish(order, next);
                }}
              />
            ))}
          </Stack>
        </SortableList>
      </Section>
      <Section title="Preferences">
        <Stack gap="md">
          <OrderList
            title="DUB language order"
            help="Used by DUB language order; the first language is preferred."
            value={values.audio_language_order}
            onChange={(value) => set('audio_language_order', value)}
            data={languages}
          />
          <OrderList
            title="SUB language order"
            help="Used by SUB language order; the first language is preferred."
            value={values.subtitle_language_order}
            onChange={(value) => set('subtitle_language_order', value)}
            data={languages}
          />
          <OrderList
            title="Provider order"
            help="Used by provider order. Providers that are not listed follow by account priority."
            value={values.provider_order.map(String)}
            onChange={(value) => set('provider_order', value.map(Number))}
            data={options.accounts.map((account) => ({
              value: String(account.id),
              label: account.name,
            }))}
          />
        </Stack>
      </Section>
    </SimpleGrid>
  );
}

function UsersTab({ values, saved, options, profiles }) {
  const active = new Map(
    profiles
      .filter((profile) => profile.is_active)
      .flatMap((profile) => profile.users.map((user) => [user, profile]))
  );
  const rows = options.users.flatMap((user) => {
    if ((saved.users || []).includes(user.id))
      return [{ ...user, reason: 'Assigned in the user settings' }];
    if (saved.is_default && !active.has(user.id))
      return [{ ...user, reason: 'No active profile assigned' }];
    return [];
  });
  return (
    <Stack gap="sm">
      {!values.is_active && !saved.is_default && rows.length > 0 && (
        <Alert color="yellow">
          This profile is disabled, so these users receive the default profile.
        </Alert>
      )}
      <Table striped verticalSpacing={6} fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>User</Table.Th>
            <Table.Th>Receives this profile because</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((user) => (
            <Table.Tr key={user.id}>
              <Table.Td>
                <SensitiveValue component="span" inherit>
                  {user.name}
                </SensitiveValue>
              </Table.Td>
              <Table.Td c="dimmed">{user.reason}</Table.Td>
            </Table.Tr>
          ))}
          {!rows.length && (
            <Table.Tr>
              <Table.Td colSpan={2} c="dimmed">
                No users have this profile yet. Assign it in the user settings.
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

export default function VODProfileDialog({
  profile,
  profiles,
  options: baseOptions,
  onClose,
  onSaved,
}) {
  const initial = useMemo(() => initialValues(profile), [profile]);
  // Languages, resolutions and features are read from every source, so they
  // load with the dialog instead of holding up the Profiles page.
  const [valueLists, setValueLists] = useState(null);
  useEffect(() => {
    let current = true;
    API.getVODProfileValues()
      .then((lists) => current && setValueLists(lists))
      .catch(
        (err) =>
          current &&
          notifyError('Filter values not loaded', formatApiError(err))
      );
    return () => {
      current = false;
    };
  }, []);
  const options = useMemo(
    () => ({ ...baseOptions, ...(valueLists || NO_VALUES) }),
    [baseOptions, valueLists]
  );
  const [values, setValues] = useState(initial);
  const [serverErrors, setServerErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [tab, setTab] = useState('general');
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const [discarding, setDiscarding] = useState(null);
  // The edition or label row being edited, as it was before (null if new).
  // Its problems show once a save of the row was tried.
  const [rowEdit, setRowEdit] = useState(null);
  const [liveCounts, setLiveCounts] = useState(null);
  const clientErrors = profileValidation(values, { submitted });
  const errors = hideUnchecked({ ...serverErrors, ...clientErrors }, rowEdit);

  const set = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const firstTab = (found) =>
    ['general', 'content', 'editions', 'failover', 'labels'].find((name) =>
      tabHasError(name, found)
    );

  // Problems are named in a notification; the fields are outlined.
  const fail = (found) => {
    const next = firstTab(found);
    if (next) setTab(next);
    notifyError('Profile not saved', firstMessage(found));
  };

  const startRow = (field, index, rows = values[field]) => {
    if (rows !== values[field]) set(field, rows);
    setRowEdit({
      field,
      index,
      before: index < values[field].length ? values[field][index] : null,
      checked: false,
    });
  };
  const revertRow = (current) => {
    if (!rowEdit) return current;
    const rows = [...current[rowEdit.field]];
    if (rowEdit.before === null) rows.splice(rowEdit.index, 1);
    else rows[rowEdit.index] = rowEdit.before;
    return { ...current, [rowEdit.field]: rows };
  };
  const discardRow = () => {
    set(rowEdit.field, revertRow(values)[rowEdit.field]);
    setRowEdit(null);
  };
  // The row's problem, including an overlap with any other edition.
  const rowProblem = () => {
    const { field, index } = rowEdit;
    const found = profileValidation(values, { submitted: true });
    return (
      firstMessage(found[field]?.[index]) ||
      (field === 'edition_rules' &&
        editionConflict(values.edition_rules, index)) ||
      (field === 'name_labels' &&
        typeof found.name_labels === 'string' &&
        found.name_labels) ||
      ''
    );
  };
  const checkRow = () => {
    const problem = rowProblem();
    if (!problem) return true;
    setRowEdit({ ...rowEdit, checked: true });
    notifyError(
      rowEdit.field === 'edition_rules'
        ? 'Edition not saved'
        : 'Label not saved',
      problem
    );
    return false;
  };
  const saveRow = () => {
    if (!checkRow()) return;
    if (rowEdit.field === 'edition_rules')
      countEditions(values.edition_rules[rowEdit.index].title_suffix.trim());
    setRowEdit(null);
  };

  // Whether the edited row differs from before; an added row from blank.
  const rowChanged = () => {
    const { field, index, before } = rowEdit;
    const row = values[field][index];
    if (before !== null) return JSON.stringify(row) !== JSON.stringify(before);
    return field === 'edition_rules'
      ? !isBlankEdition(row)
      : !isBlankLabel(row);
  };

  // An unsaved row is discarded only after asking, like unsaved M3U rules;
  // a row that was only opened closes without asking.
  const unlessEditing = (proceed) => {
    if (!rowEdit) return proceed(values);
    if (rowChanged()) return setDiscarding(() => proceed);
    const kept = revertRow(values);
    set(rowEdit.field, kept[rowEdit.field]);
    setRowEdit(null);
    proceed(kept);
  };
  const confirmDiscard = () => {
    const kept = revertRow(values);
    set(rowEdit.field, kept[rowEdit.field]);
    setRowEdit(null);
    setDiscarding(null);
    discarding(kept);
  };

  const save = (event) => {
    event.preventDefault();
    unlessEditing(submit);
  };

  const submit = async (values) => {
    setSubmitted(true);
    const found = profileValidation(values, { submitted: true });
    if (Object.keys(found).length) {
      fail(found);
      return;
    }
    setSaving(true);
    try {
      const result = await API.saveVODProfile(
        profilePayload(values),
        profile.id
      );
      showNotification({ title: `Saved ${result.name}`, color: 'green' });
      onSaved(result);
    } catch (err) {
      const parsed = profileErrors(err.body);
      setServerErrors(parsed.errors);
      if (Object.keys(parsed.errors).length) fail(parsed.errors);
      else
        notifyError('Profile not saved', parsed.detail || formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const changeTab = (next) => unlessEditing(() => setTab(next));

  // Offered titles per edition: from the last build for unchanged editions,
  // counted for the current settings after an edition row is saved.
  const editionQuery = JSON.stringify(profilePayload(values));
  const builtCounts = initial.catalog_counts?.movie?.editions && {
    movie: initial.catalog_counts.movie.editions,
    series: initial.catalog_counts.series?.editions,
  };
  const editionCount = (rule, index) => {
    if (rowIndex('edition_rules') === index) return null;
    const name = rule.title_suffix?.trim();
    if (liveCounts?.query === editionQuery) {
      if (!liveCounts.counts) return { text: 'Counting…' };
      const text = editionCountText(liveCounts.counts, name);
      return {
        text,
        empty: text === 'No titles' && 'No titles get this edition right now.',
      };
    }
    if (
      builtCounts &&
      (initial.edition_rules || []).some((saved) => sameEdition(saved, rule))
    ) {
      const text = editionCountText(builtCounts, name);
      return {
        text: `${text} (last build)`,
        empty:
          text === 'No titles' &&
          'No titles got this edition in the last build.',
      };
    }
    return null;
  };
  const countEditions = (name) => {
    const query = editionQuery;
    setLiveCounts({ query, counts: null });
    API.countVODProfileEditions({ profile: JSON.parse(query) })
      .then((counts) => {
        let latest = false;
        setLiveCounts((current) => {
          latest = current?.query === query;
          return latest ? { query, counts } : current;
        });
        if (latest && !counts.movie?.[name] && !counts.series?.[name])
          showNotification({
            title: `No titles for ${name}`,
            message: 'No title gets this edition with the current settings.',
            color: 'yellow',
          });
      })
      .catch(() =>
        setLiveCounts((current) => (current?.query === query ? null : current))
      );
  };

  const sources = values.output_mode === 'variants';
  // Editions and failover shape Compact entries only, labels Sources entries
  // only; settings are kept.
  const onlyFor = (mode, name, label) =>
    sources === (mode === 'Compact') ? (
      <Tooltip
        label={`${label} only apply to ${mode} entries. Your settings are kept.`}
        withArrow
      >
        <span style={{ display: 'inline-flex' }}>
          <TabsTab value={name} disabled>
            {label}
          </TabsTab>
        </span>
      </Tooltip>
    ) : (
      tabLabel(name, label)
    );
  const tabLabel = (name, label) => (
    <TabsTab value={name} c={tabHasError(name, errors) ? 'red' : undefined}>
      {label}
    </TabsTab>
  );
  const props = { values, saved: initial, options, errors, set };
  const rowIndex = (field) => (rowEdit?.field === field ? rowEdit.index : null);
  const addRow = (field, row) =>
    startRow(field, values[field].length, [...values[field], row]);

  return (
    <LibraryDialog
      title={profile.id ? `Edit ${profile.name}` : 'Add profile'}
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
        <Tabs value={tab} onChange={changeTab} className={editorClasses.tabs}>
          <TabsList className={editorClasses.tabList}>
            {tabLabel('general', 'General')}
            {tabLabel('content', 'Content')}
            {onlyFor('Compact', 'editions', 'Editions')}
            {onlyFor('Compact', 'failover', 'Failover')}
            {onlyFor('Sources', 'labels', 'Labels')}
            {tabLabel('users', 'Users')}
          </TabsList>
          <TabsPanel value="general" className={editorClasses.panel}>
            <GeneralTab {...props} />
          </TabsPanel>
          <TabsPanel value="content" className={editorClasses.panel}>
            <ContentRulesEditor
              rules={values.content_rules}
              errors={errors}
              active={tab === 'content'}
              onChange={(rules) => set('content_rules', rules)}
            />
          </TabsPanel>
          <TabsPanel value="editions" className={editorClasses.panel}>
            <EditionRulesEditor
              rules={values.edition_rules}
              options={options}
              errors={errors}
              countOf={editionCount}
              editing={rowIndex('edition_rules')}
              onChange={(rules) => set('edition_rules', rules)}
              onAdd={() => addRow('edition_rules', newEditionRule())}
              onEdit={(index) => startRow('edition_rules', index)}
              onSave={saveRow}
              onDiscard={discardRow}
            />
          </TabsPanel>
          <TabsPanel value="failover" className={editorClasses.panel}>
            <FailoverTab {...props} />
          </TabsPanel>
          <TabsPanel value="labels" className={editorClasses.panel}>
            <LabelsTab
              {...props}
              editing={rowIndex('name_labels')}
              onChange={(rows) => set('name_labels', rows)}
              onAdd={() => addRow('name_labels', newNameLabel())}
              onEdit={(index) => startRow('name_labels', index)}
              onSave={saveRow}
              onDiscard={discardRow}
            />
          </TabsPanel>
          <TabsPanel value="users" className={editorClasses.panel}>
            <UsersTab {...props} profiles={profiles} />
          </TabsPanel>
        </Tabs>
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
      <ConfirmationDialog
        opened={!!discarding}
        onClose={() => setDiscarding(null)}
        onConfirm={confirmDiscard}
        title="Unsaved changes"
        message="Discard unsaved changes? The affected rows are highlighted."
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        zIndex={300}
      />
    </LibraryDialog>
  );
}
