import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import API from '../api';
import { formatApiError } from '../utils';
import { showNotification } from '../utils/notificationUtils.js';
import {
  FILE_DATA_FILTERS,
  displayName,
  listErrors,
  newList,
} from '../utils/vodLists';
import { LibraryDialog } from './LibraryDialogs.jsx';

const NEW_LIST = 'new';
function NameInput({ value, error, onChange }) {
  return (
    <Stack gap={4}>
      <TextInput
        label="List name"
        withAsterisk
        data-autofocus
        value={value}
        error={error}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {/[{](year|season)[}]/.test(value) && (
        <Text size="xs" c="dimmed">
          Shown as: {displayName(value)}
        </Text>
      )}
    </Stack>
  );
}

// Adds the selected titles, or the titles of sources from the Sources view,
// to a manual list.
export function AddToListDialog({ selection, sources, count, onClose }) {
  const [lists, setLists] = useState(null);
  const [target, setTarget] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    API.getVODLists()
      .then((rows) => {
        const manual = rows.filter((row) => row.list_type === 'manual');
        setLists(manual);
        setTarget(manual[0] ? String(manual[0].id) : NEW_LIST);
      })
      .catch((err) => setError(formatApiError(err)));
  }, []);
  const add = async () => {
    setSaving(true);
    setError('');
    try {
      let id = target;
      if (target === NEW_LIST) {
        if (!name.trim()) {
          setNameError('Enter a list name.');
          return;
        }
        try {
          id = (await API.saveVODList({ name, list_type: 'manual' })).id;
        } catch (err) {
          const parsed = listErrors(err.body);
          if (parsed.errors.name) {
            setNameError(parsed.errors.name);
            return;
          }
          throw err;
        }
      }
      const result = await API.editVODListItems(id, 'add-items', {
        ...selection,
        sources,
      });
      showNotification({
        title: `Added to ${result.name}`,
        message: `${count.toLocaleString()} ${sources ? 'sources' : 'titles'} added`,
        color: 'green',
      });
      onClose();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <LibraryDialog
      title="Add to list"
      busy={saving}
      onClose={onClose}
      size="md"
    >
      <Stack gap="md">
        <Text size="sm">
          {sources
            ? `The titles of ${count.toLocaleString()} selected ${count === 1 ? 'source' : 'sources'}.`
            : `${count.toLocaleString()} selected ${count === 1 ? 'title' : 'titles'}.`}
        </Text>
        {lists && (
          <Select
            label="List"
            allowDeselect={false}
            value={target}
            onChange={setTarget}
            data={[
              ...lists.map((row) => ({
                value: String(row.id),
                label: row.display_name,
              })),
              { value: NEW_LIST, label: 'New list…' },
            ]}
          />
        )}
        {target === NEW_LIST && (
          <NameInput
            value={name}
            error={nameError}
            onChange={(value) => {
              setName(value);
              setNameError('');
            }}
          />
        )}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={add} loading={saving} disabled={!lists}>
            Add
          </Button>
        </Group>
      </Stack>
    </LibraryDialog>
  );
}

// Saves the current Library filters as a rules list.
export function SaveAsListDialog({ filters, onClose }) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) {
      setNameError('Enter a list name.');
      return;
    }
    setSaving(true);
    setError('');
    const { type, view: _view, ...rules } = filters;
    for (const field of FILE_DATA_FILTERS) delete rules[field];
    try {
      const result = await API.saveVODList({
        ...newList('rules'),
        name,
        content_type: type && type !== 'all' ? type : 'all',
        filters: Object.fromEntries(
          Object.entries(rules).filter(
            ([, value]) => value !== '' && value != null
          )
        ),
      });
      showNotification({
        title: `Saved ${result.name}`,
        message: 'Add it to a profile that uses Lists as categories.',
        color: 'green',
      });
      onClose();
    } catch (err) {
      const parsed = listErrors(err.body);
      if (parsed.errors.name) setNameError(parsed.errors.name);
      else setError(parsed.errors.filters || formatApiError(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <LibraryDialog
      title="Save as list"
      busy={saving}
      onClose={onClose}
      size="md"
    >
      <Stack gap="md">
        <Text size="sm">
          A rules list holds the titles matching these filters and updates
          itself.
          {FILE_DATA_FILTERS.some((field) => filters[field]) &&
            ' DUB, SUB, resolution, feature and format are left out: the profile chooses the source.'}
        </Text>
        <NameInput
          value={name}
          error={nameError}
          onChange={(value) => {
            setName(value);
            setNameError('');
          }}
        />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save
          </Button>
        </Group>
      </Stack>
    </LibraryDialog>
  );
}
