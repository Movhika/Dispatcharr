import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  TagsInput,
  Text,
  TextInput,
} from '@mantine/core';
import { Plus, Save, Trash2, Wrench } from 'lucide-react';
import API from '../api';
import { showNotification } from '../utils/notificationUtils';

const emptyPolicy = () => ({
  id: null,
  name: 'Default VOD policy',
  export_mode: 'compact',
  is_default: true,
  is_active: true,
  users: [],
  hard_constraints: {
    required_audio_languages: [],
    required_subtitle_languages: [],
    min_height: 0,
    max_height: 0,
    allow_unknown_metadata: true,
    cross_category_failover: false,
  },
  ranking: ['category_priority', 'resolution', 'account_priority'],
  category_rules: [],
});

const normalizeList = (response) => response?.results || response || [];

const VODSourceManagerModal = ({ opened, onClose }) => {
  const [policies, setPolicies] = useState([]);
  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [playbacks, setPlaybacks] = useState([]);
  const [draft, setDraft] = useState(emptyPolicy());
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [manualPlayback, setManualPlayback] = useState(null);
  const [manualMetadata, setManualMetadata] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const [policyData, categoryData, userData, playbackData] =
        await Promise.all([
          API.getVODAccessPolicies(),
          API.getVODCategoryRelations(),
          API.getUsers(),
          API.getVODPlaybackSessions(),
        ]);
      const nextPolicies = normalizeList(policyData);
      setPolicies(nextPolicies);
      setCategories(normalizeList(categoryData));
      setUsers(normalizeList(userData));
      setPlaybacks(normalizeList(playbackData));
      setDraft(nextPolicies[0] || emptyPolicy());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (opened) load();
  }, [opened]);

  const userOptions = users.map((user) => ({
    value: String(user.id),
    label: user.username,
  }));

  const categoryRuleMap = useMemo(
    () =>
      new Map(
        (draft.category_rules || []).map((rule) => [
          Number(rule.category_relation),
          rule,
        ])
      ),
    [draft.category_rules]
  );

  const visibleCategories = categories
    .filter((relation) => relation.enabled)
    .filter((relation) =>
      `${relation.account_name} ${relation.category_name}`
        .toLowerCase()
        .includes(categoryFilter.toLowerCase())
    );

  const setConstraint = (key, value) => {
    setDraft((current) => ({
      ...current,
      hard_constraints: {
        ...(current.hard_constraints || {}),
        [key]: value,
      },
    }));
  };

  const toggleCategory = (relation, checked) => {
    setDraft((current) => {
      const rest = (current.category_rules || []).filter(
        (rule) => Number(rule.category_relation) !== relation.id
      );
      return {
        ...current,
        category_rules: checked
          ? [
              ...rest,
              {
                category_relation: relation.id,
                enabled: true,
                priority: 0,
              },
            ]
          : rest,
      };
    });
  };

  const setCategoryPriority = (relationId, priority) => {
    setDraft((current) => ({
      ...current,
      category_rules: (current.category_rules || []).map((rule) =>
        Number(rule.category_relation) === relationId
          ? { ...rule, priority: Number(priority) || 0 }
          : rule
      ),
    }));
  };

  const savePolicy = async () => {
    const payload = {
      name: draft.name,
      export_mode: draft.export_mode,
      is_default: draft.is_default,
      is_active: draft.is_active,
      users: (draft.users || []).map(Number),
      hard_constraints: draft.hard_constraints || {},
      ranking: draft.ranking || [],
      category_rules: (draft.category_rules || []).map((rule) => ({
        category_relation: Number(rule.category_relation),
        enabled: rule.enabled !== false,
        priority: Number(rule.priority) || 0,
      })),
    };
    const saved = draft.id
      ? await API.updateVODAccessPolicy(draft.id, payload)
      : await API.createVODAccessPolicy(payload);
    setPolicies((current) => [
      saved,
      ...current.filter((policy) => policy.id !== saved.id),
    ]);
    setDraft(saved);
    showNotification({
      title: 'VOD policy saved',
      message:
        'XC output and failover now use the same category and quality rules.',
      color: 'green',
    });
  };

  const deletePolicy = async () => {
    if (!draft.id) return;
    await API.deleteVODAccessPolicy(draft.id);
    const remaining = policies.filter((policy) => policy.id !== draft.id);
    setPolicies(remaining);
    setDraft(remaining[0] || emptyPolicy());
  };

  const openManualEditor = (playback) => {
    const effective = playback.source_effective_metadata || {};
    const values = effective.values || {};
    const provenance = effective.provenance || {};
    setManualMetadata(
      Object.fromEntries(
        Object.entries(values).filter(([key]) => provenance[key] === 'manual')
      )
    );
    setManualPlayback(playback);
  };

  const saveManualMetadata = async () => {
    const metadata = Object.fromEntries(
      Object.entries(manualMetadata).filter(
        ([, value]) => value !== '' && value !== null && value !== undefined
      )
    );
    await API.updateVODSourceManualMetadata(
      manualPlayback.source_asset,
      metadata,
      Object.keys(metadata)
    );
    setManualPlayback(null);
    await load();
  };

  const primaryRanking = draft.ranking?.[0] || 'category_priority';
  const setPrimaryRanking = (value) => {
    const values = ['category_priority', 'resolution', 'account_priority'];
    setDraft((current) => ({
      ...current,
      ranking: [value, ...values.filter((item) => item !== value)],
    }));
  };

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title="VOD source management"
        size="90vw"
        scrollAreaComponent={Modal.NativeScrollArea}
      >
        <Tabs defaultValue="policies">
          <TabsList>
            <TabsTab value="policies">User output & failover</TabsTab>
            <TabsTab value="history">Playback history</TabsTab>
          </TabsList>

          <TabsPanel value="policies" pt="md">
            <Stack>
              <Group justify="space-between" align="end">
                <Select
                  label="Policy"
                  value={draft.id ? String(draft.id) : null}
                  placeholder="New policy"
                  data={policies.map((policy) => ({
                    value: String(policy.id),
                    label: policy.name,
                  }))}
                  onChange={(value) =>
                    setDraft(
                      policies.find((policy) => String(policy.id) === value) ||
                        emptyPolicy()
                    )
                  }
                  w={280}
                />
                <Group>
                  <Button
                    variant="default"
                    leftSection={<Plus size={15} />}
                    onClick={() => setDraft(emptyPolicy())}
                  >
                    New
                  </Button>
                  <ActionIcon
                    aria-label="Delete policy"
                    color="red"
                    variant="subtle"
                    disabled={!draft.id}
                    onClick={deletePolicy}
                  >
                    <Trash2 size={17} />
                  </ActionIcon>
                </Group>
              </Group>

              <Group grow align="end">
                <TextInput
                  label="Name"
                  value={draft.name || ''}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.currentTarget.value })
                  }
                />
                <Select
                  label="XC catalog mode"
                  value={draft.export_mode}
                  data={[
                    { value: 'compact', label: 'Compact — one best source' },
                    {
                      value: 'variants',
                      label: 'Variants — separate editions',
                    },
                  ]}
                  onChange={(value) =>
                    setDraft({ ...draft, export_mode: value })
                  }
                />
                <Select
                  label="First ranking criterion"
                  value={primaryRanking}
                  data={[
                    { value: 'category_priority', label: 'Category priority' },
                    { value: 'resolution', label: 'Resolution' },
                    { value: 'account_priority', label: 'M3U priority' },
                  ]}
                  onChange={setPrimaryRanking}
                />
              </Group>

              <MultiSelect
                label="Users"
                data={userOptions}
                value={(draft.users || []).map(String)}
                onChange={(values) => setDraft({ ...draft, users: values })}
                searchable
                clearable
              />

              <Group>
                <Checkbox
                  label="Default for users without an assigned policy"
                  checked={draft.is_default || false}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      is_default: event.currentTarget.checked,
                    })
                  }
                />
                <Checkbox
                  label="Allow failover across selected categories"
                  checked={Boolean(
                    draft.hard_constraints?.cross_category_failover
                  )}
                  onChange={(event) =>
                    setConstraint(
                      'cross_category_failover',
                      event.currentTarget.checked
                    )
                  }
                />
                <Checkbox
                  label="Active"
                  checked={draft.is_active !== false}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      is_active: event.currentTarget.checked,
                    })
                  }
                />
                <Checkbox
                  label="Allow sources with unknown metadata"
                  checked={
                    draft.hard_constraints?.allow_unknown_metadata !== false
                  }
                  onChange={(event) =>
                    setConstraint(
                      'allow_unknown_metadata',
                      event.currentTarget.checked
                    )
                  }
                />
              </Group>

              <Group grow align="end">
                <TagsInput
                  label="Allowed audio languages"
                  placeholder="deu, eng"
                  value={draft.hard_constraints?.required_audio_languages || []}
                  onChange={(value) =>
                    setConstraint('required_audio_languages', value)
                  }
                />
                <TagsInput
                  label="Required subtitle languages"
                  placeholder="deu, eng"
                  value={
                    draft.hard_constraints?.required_subtitle_languages || []
                  }
                  onChange={(value) =>
                    setConstraint('required_subtitle_languages', value)
                  }
                />
                <NumberInput
                  label="Minimum height"
                  min={0}
                  step={120}
                  value={draft.hard_constraints?.min_height || 0}
                  onChange={(value) => setConstraint('min_height', value)}
                />
                <NumberInput
                  label="Maximum height"
                  min={0}
                  step={120}
                  value={draft.hard_constraints?.max_height || 0}
                  onChange={(value) => setConstraint('max_height', value)}
                />
              </Group>

              <Alert color="blue" variant="light">
                Compact export and failover use the same hard limits and
                ranking. An explicitly selected allowed source stays first;
                failover never crosses into a forbidden language/category.
              </Alert>

              <TextInput
                placeholder="Filter account or category..."
                value={categoryFilter}
                onChange={(event) =>
                  setCategoryFilter(event.currentTarget.value)
                }
              />
              <ScrollArea h={330}>
                <Table stickyHeader striped withTableBorder>
                  <TableThead>
                    <TableTr>
                      <TableTh w={80}>Expose</TableTh>
                      <TableTh>M3U account</TableTh>
                      <TableTh>Category</TableTh>
                      <TableTh w={130}>Priority</TableTh>
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {visibleCategories.map((relation) => {
                      const rule = categoryRuleMap.get(relation.id);
                      return (
                        <TableTr key={relation.id}>
                          <TableTd>
                            <Checkbox
                              aria-label={`Expose ${relation.category_name}`}
                              checked={Boolean(rule)}
                              onChange={(event) =>
                                toggleCategory(
                                  relation,
                                  event.currentTarget.checked
                                )
                              }
                            />
                          </TableTd>
                          <TableTd>{relation.account_name}</TableTd>
                          <TableTd>
                            {relation.category_name} ({relation.category_type})
                          </TableTd>
                          <TableTd>
                            <NumberInput
                              size="xs"
                              disabled={!rule}
                              value={rule?.priority || 0}
                              onChange={(value) =>
                                setCategoryPriority(relation.id, value)
                              }
                            />
                          </TableTd>
                        </TableTr>
                      );
                    })}
                  </TableTbody>
                </Table>
              </ScrollArea>

              <Group justify="flex-end">
                <Button
                  leftSection={<Save size={15} />}
                  onClick={savePolicy}
                  loading={loading}
                >
                  Save policy
                </Button>
              </Group>
            </Stack>
          </TabsPanel>

          <TabsPanel value="history" pt="md">
            <Alert color="gray" variant="light" mb="md">
              Redirect entries are unconfirmed. Proxy entries record transferred
              bytes. Technical language/track metadata changes only through
              player telemetry or the manual editor below.
            </Alert>
            <ScrollArea h="65vh">
              <Table stickyHeader striped withTableBorder>
                <TableThead>
                  <TableTr>
                    <TableTh>Started</TableTh>
                    <TableTh>Title</TableTh>
                    <TableTh>Source</TableTh>
                    <TableTh>User</TableTh>
                    <TableTh>Status</TableTh>
                    <TableTh>Data</TableTh>
                    <TableTh w={70}>Edit</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {playbacks.map((playback) => (
                    <TableTr key={playback.id}>
                      <TableTd>
                        {new Date(playback.started_at).toLocaleString()}
                      </TableTd>
                      <TableTd>{playback.content_name}</TableTd>
                      <TableTd>
                        {playback.account_name}
                        {playback.category_name
                          ? ` — ${playback.category_name}`
                          : ''}
                      </TableTd>
                      <TableTd>{playback.username || '—'}</TableTd>
                      <TableTd>{playback.status}</TableTd>
                      <TableTd>
                        {(
                          Number(playback.bytes_sent || 0) /
                          1024 /
                          1024
                        ).toFixed(1)}{' '}
                        MB
                      </TableTd>
                      <TableTd>
                        <ActionIcon
                          aria-label="Edit source metadata"
                          variant="subtle"
                          disabled={!playback.source_asset}
                          onClick={() => openManualEditor(playback)}
                        >
                          <Wrench size={16} />
                        </ActionIcon>
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            </ScrollArea>
          </TabsPanel>
        </Tabs>
      </Modal>

      <Modal
        opened={Boolean(manualPlayback)}
        onClose={() => setManualPlayback(null)}
        title="Manual source metadata (highest priority)"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Saved fields are locked and will not be overwritten by later
            playback observations.
          </Text>
          <TagsInput
            label="Audio languages"
            value={manualMetadata.audio_languages || []}
            onChange={(value) =>
              setManualMetadata({ ...manualMetadata, audio_languages: value })
            }
          />
          <TagsInput
            label="Subtitle languages"
            value={manualMetadata.subtitle_languages || []}
            onChange={(value) =>
              setManualMetadata({
                ...manualMetadata,
                subtitle_languages: value,
              })
            }
          />
          <Select
            clearable
            label="Resolution"
            data={['480p', '576p', '720p', '1080p', '1440p', '2160p']}
            value={manualMetadata.resolution || null}
            onChange={(value) =>
              setManualMetadata({ ...manualMetadata, resolution: value || '' })
            }
          />
          <Button onClick={saveManualMetadata}>Save and lock values</Button>
        </Stack>
      </Modal>
    </>
  );
};

export default VODSourceManagerModal;
