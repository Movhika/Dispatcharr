import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Autocomplete,
  Button,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import API from '../../api';
import ConfirmationDialog from '../ConfirmationDialog';
import { formatApiError } from '../../utils';

const EMPTY = {
  name: '',
  url: '',
  category: '',
  logo_url: '',
  tvg_id: '',
  stream_chno: null,
};

const fieldError = (error, field) =>
  error && typeof error === 'object' && error[field]
    ? [].concat(error[field]).join(' ')
    : null;

const StreamForm = ({ value, categories, busy, error, onCancel, onSave }) => {
  const [form, setForm] = useState(value);
  const set = (values) => setForm((current) => ({ ...current, ...values }));

  return (
    <Paper withBorder p="sm" role="group" aria-label="Stream">
      <Stack gap="xs">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" verticalSpacing="xs">
          <TextInput
            label="Name"
            withAsterisk
            value={form.name}
            error={fieldError(error, 'name')}
            onChange={(event) => set({ name: event.currentTarget.value })}
          />
          <Autocomplete
            label="Category"
            description="Chooses how the stream is used, like a provider category."
            withAsterisk
            data={categories}
            value={form.category}
            error={fieldError(error, 'category')}
            onChange={(category) => set({ category })}
          />
        </SimpleGrid>
        <TextInput
          label="Stream URL"
          withAsterisk
          placeholder="http://, https://, rtmp://, rtsp://, udp:// or srt://"
          value={form.url}
          error={fieldError(error, 'url')}
          onChange={(event) => set({ url: event.currentTarget.value })}
        />
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" verticalSpacing="xs">
          <TextInput
            label="Logo URL"
            value={form.logo_url || ''}
            onChange={(event) => set({ logo_url: event.currentTarget.value })}
          />
          <TextInput
            label="TVG-ID"
            value={form.tvg_id || ''}
            onChange={(event) => set({ tvg_id: event.currentTarget.value })}
          />
          <NumberInput
            label="Channel number"
            min={0}
            value={form.stream_chno ?? ''}
            onChange={(number) =>
              set({ stream_chno: number === '' ? null : number })
            }
          />
        </SimpleGrid>
        {error && typeof error === 'string' && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!form.name.trim() || !form.url.trim() || !form.category}
            onClick={() => onSave(form)}
          >
            {form.id ? 'Save stream' : 'Add stream'}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
};

// Streams of a manual account: entered here instead of fetched.
const M3UManualStreams = ({ account }) => {
  const [streams, setStreams] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    try {
      setStreams(await API.getManualStreams(account.id));
    } catch (exc) {
      setError(formatApiError(exc));
    }
  }, [account.id]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(
    () => [...new Set((streams || []).map((stream) => stream.category))],
    [streams]
  );

  const save = async (values) => {
    setBusy(true);
    setFormError(null);
    try {
      await API.saveManualStream(account.id, values.id, {
        ...values,
        logo_url: values.logo_url || null,
        tvg_id: values.tvg_id || null,
      });
      notifications.show({
        message: `${values.name} saved. The account refreshes its channels now.`,
        color: 'green.5',
      });
      setEditing(null);
      await load();
    } catch (exc) {
      // Field errors stay next to their field.
      setFormError(
        exc?.status === 400 && exc.body && typeof exc.body === 'object'
          ? exc.body
          : formatApiError(exc)
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (stream) => {
    setError(null);
    try {
      await API.deleteManualStream(account.id, stream.id);
      await load();
    } catch (exc) {
      setError(formatApiError(exc));
    }
  };

  return (
    <Stack gap="sm">
      <ConfirmationDialog
        opened={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const stream = deleting;
          setDeleting(null);
          remove(stream);
        }}
        title="Delete stream"
        message={`Delete "${deleting?.name}"? Channels lose this stream.`}
        confirmLabel="Delete"
        zIndex={1100}
      />
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text size="sm" c="dimmed">
          Streams of this account are entered here. Their categories work like
          provider categories: choose their use in Content, and channel rules
          find their streams.
        </Text>
        {!editing && (
          <Button
            leftSection={<Plus size={16} />}
            style={{ flexShrink: 0 }}
            onClick={() => {
              setFormError(null);
              setEditing({ ...EMPTY, category: categories[0] || '' });
            }}
          >
            Add stream
          </Button>
        )}
      </Group>
      {editing && (
        <StreamForm
          key={editing.id || 'new'}
          value={editing}
          categories={categories}
          busy={busy}
          error={formError}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}
      <ScrollArea.Autosize mah={360} type="auto">
        <Table striped stickyHeader verticalSpacing={4}>
          <TableThead>
            <TableTr>
              <TableTh>Name</TableTh>
              <TableTh>Category</TableTh>
              <TableTh>URL</TableTh>
              <TableTh w={80} />
            </TableTr>
          </TableThead>
          <TableTbody>
            {streams && !streams.length && (
              <TableTr>
                <TableTd colSpan={4}>
                  <Text size="sm" c="dimmed" ta="center">
                    No streams yet.
                  </Text>
                </TableTd>
              </TableTr>
            )}
            {(streams || []).map((stream) => (
              <TableTr key={stream.id}>
                <TableTd>
                  <Text size="sm">{stream.name}</Text>
                </TableTd>
                <TableTd>
                  <Text size="sm">{stream.category}</Text>
                </TableTd>
                <TableTd maw={280}>
                  <Text size="xs" c="dimmed" truncate="end" title={stream.url}>
                    {stream.url}
                  </Text>
                </TableTd>
                <TableTd>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      aria-label={`Edit ${stream.name}`}
                      onClick={() => {
                        setFormError(null);
                        setEditing({ ...EMPTY, ...stream });
                      }}
                    >
                      <Pencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`Delete ${stream.name}`}
                      onClick={() => setDeleting(stream)}
                    >
                      <Trash2 size={16} />
                    </ActionIcon>
                  </Group>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </ScrollArea.Autosize>
    </Stack>
  );
};

export default M3UManualStreams;
