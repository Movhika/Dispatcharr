// Modal.js
import React, { useEffect, useState } from 'react';
import useUserAgentsStore from '../../store/userAgents';
import useServerGroupsStore from '../../store/serverGroups';
import usePlaylistsStore from '../../store/playlists';
import M3UProfiles from './M3UProfiles';
import {
  Box,
  Button,
  Divider,
  FileInput,
  FileButton,
  Flex,
  Group,
  LoadingOverlay,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import M3UGroupFilter from './M3UGroupFilter';
import useChannelsStore from '../../store/channels';
import { isNotEmpty, useForm } from '@mantine/form';
import useEPGsStore from '../../store/epgs';
import useVODStore from '../../store/useVODStore';
import ScheduleInput from './ScheduleInput';
import { DateTimePicker } from '@mantine/dates';
import { showNotification } from '../../utils/notificationUtils.js';
import { addEPG } from '../../utils/forms/DummyEpgUtils.js';
import {
  addPlaylist,
  expDateFromPlaylist,
  expDateKey,
  getPlaylist,
  prepareSubmitValues,
  updatePlaylist,
} from '../../utils/forms/M3uUtils.js';
import ServerGroupsManagerModal from '../ServerGroupsManagerModal';
import API from '../../api';

const M3U = ({
  m3uAccount = null,
  isOpen,
  onClose,
  playlistCreated = false,
}) => {
  const userAgents = useUserAgentsStore((s) => s.userAgents);
  const serverGroups = useServerGroupsStore((s) => s.serverGroups);
  const fetchChannelGroups = useChannelsStore((s) => s.fetchChannelGroups);
  const fetchEPGs = useEPGsStore((s) => s.fetchEPGs);
  const fetchCategories = useVODStore((s) => s.fetchCategories);
  const updatePlaylistInStore = usePlaylistsStore((s) => s.updatePlaylist);

  const [playlist, setPlaylist] = useState(null);
  const [file, setFile] = useState(null);
  const [expDate, setExpDate] = useState(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [groupFilterModalOpen, setGroupFilterModalOpen] = useState(false);
  const [scheduleType, setScheduleType] = useState('interval');
  const [serverGroupsManagerOpen, setServerGroupsManagerOpen] = useState(false);
  const [serverGroupsCreateOnOpen, setServerGroupsCreateOnOpen] =
    useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [templateSavingOpen, setTemplateSavingOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);

  // Keep expiration in sync when the default profile is edited (store refreshes).
  // Do not rebind the whole form to the live playlist or unsaved edits are wiped.
  const accountId = playlist?.id ?? m3uAccount?.id;
  const storeExpDate = usePlaylistsStore((s) => {
    if (!accountId) return undefined;
    const stored = s.playlists.find((p) => p.id === accountId);
    if (!stored) return undefined;
    return stored.exp_date ?? null;
  });

  const form = useForm({
    mode: 'uncontrolled',
    initialValues: {
      name: '',
      server_url: '',
      user_agent: '0',
      server_group: '0',
      is_active: true,
      max_streams: 0,
      refresh_interval: 24,
      cron_expression: '',
      account_type: 'XC',
      create_epg: false,
      username: '',
      password: '',
      stale_stream_days: 7,
      priority: 0,
      enable_vod: false,
    },

    validate: {
      name: isNotEmpty('Please select a name'),
      user_agent: isNotEmpty('Please select a user-agent'),
    },
  });

  useEffect(() => {
    if (m3uAccount) {
      setPlaylist(m3uAccount);
      form.setValues({
        name: m3uAccount.name,
        server_url: m3uAccount.server_url,
        max_streams: m3uAccount.max_streams,
        user_agent: m3uAccount.user_agent ? `${m3uAccount.user_agent}` : '0',
        server_group: m3uAccount.server_group
          ? `${m3uAccount.server_group}`
          : '0',
        is_active: m3uAccount.is_active,
        refresh_interval: m3uAccount.refresh_interval,
        cron_expression: m3uAccount.cron_expression || '',
        account_type: m3uAccount.account_type,
        username: m3uAccount.username ?? '',
        password: '',
        stale_stream_days:
          m3uAccount.stale_stream_days !== undefined &&
          m3uAccount.stale_stream_days !== null
            ? m3uAccount.stale_stream_days
            : 7,
        priority:
          m3uAccount.priority !== undefined && m3uAccount.priority !== null
            ? m3uAccount.priority
            : 0,
        enable_vod: m3uAccount.enable_vod || false,
      });
      setExpDate(expDateFromPlaylist(m3uAccount.exp_date));

      // Determine schedule type from existing data
      setScheduleType(
        m3uAccount.cron_expression && m3uAccount.cron_expression.trim() !== ''
          ? 'cron'
          : 'interval'
      );
    } else {
      setPlaylist(null);
      form.reset();
      setScheduleType('interval');
      setExpDate(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m3uAccount]);

  useEffect(() => {
    if (!isOpen) return;
    API.getM3UAccountTemplates().then((items) => setTemplates(items || []));
  }, [isOpen]);

  const selectedTemplate = templates.find(
    (template) => String(template.id) === templateId
  );

  const applyTemplateValues = (template) => {
    if (!template) return;
    const settings = template.account_settings || {};
    form.setValues({
      account_type: template.account_type || form.getValues().account_type,
      max_streams: settings.max_streams ?? form.getValues().max_streams,
      refresh_interval:
        settings.refresh_interval ?? form.getValues().refresh_interval,
      stale_stream_days:
        settings.stale_stream_days ?? form.getValues().stale_stream_days,
      priority: settings.priority ?? form.getValues().priority,
      enable_vod: settings.enable_vod ?? form.getValues().enable_vod,
    });
  };

  const applyTemplate = async () => {
    if (!selectedTemplate) return;
    if (!playlist?.id) {
      applyTemplateValues(selectedTemplate);
      showNotification({
        title: 'Template selected',
        message:
          'Settings and copied rules will be applied when the account is created.',
        color: 'green',
      });
      return;
    }
    setTemplateBusy(true);
    try {
      const updated = await API.applyM3UAccountTemplate(
        selectedTemplate.id,
        playlist.id
      );
      setPlaylist(updated);
      updatePlaylistInStore(updated);
      applyTemplateValues(selectedTemplate);
      showNotification({
        title: 'Template applied',
        message:
          'Portable account settings, stream filters, and import rules were copied.',
        color: 'green',
      });
    } finally {
      setTemplateBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (!playlist?.id || !templateName.trim()) return;
    setTemplateBusy(true);
    try {
      const created = await API.saveM3UAccountAsTemplate(playlist.id, {
        name: templateName.trim(),
        description: templateDescription.trim(),
      });
      setTemplates((current) => [...current, created]);
      setTemplateId(String(created.id));
      setTemplateSavingOpen(false);
      setTemplateName('');
      setTemplateDescription('');
    } finally {
      setTemplateBusy(false);
    }
  };

  const exportTemplate = () => {
    if (!selectedTemplate) return;
    const portable = {
      name: selectedTemplate.name,
      description: selectedTemplate.description || '',
      account_type: selectedTemplate.account_type,
      account_settings: selectedTemplate.account_settings || {},
      filters: selectedTemplate.filters || [],
      group_rules: selectedTemplate.group_rules || [],
    };
    const blob = new Blob([JSON.stringify(portable, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedTemplate.name.replace(/[^a-z0-9_-]+/gi, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importTemplate = async (file) => {
    if (!file) return;
    setTemplateBusy(true);
    try {
      const values = JSON.parse(await file.text());
      const created = await API.createM3UAccountTemplate(values);
      setTemplates((current) => [...current, created]);
      setTemplateId(String(created.id));
      showNotification({
        title: 'Template imported',
        message:
          'No provider URL, username, or password is stored in templates.',
        color: 'green',
      });
    } catch (error) {
      showNotification({
        title: 'Template could not be imported',
        message: error?.message || 'The JSON file is invalid.',
        color: 'red',
      });
    } finally {
      setTemplateBusy(false);
    }
  };

  useEffect(() => {
    if (storeExpDate === undefined) return;
    const next = expDateFromPlaylist(storeExpDate);
    setExpDate((prev) => (expDateKey(prev) === expDateKey(next) ? prev : next));
  }, [storeExpDate]);

  const handleNewPlaylist = async (newPlaylist, values, create_epg) => {
    if (create_epg) {
      addEPG({
        name: values.name,
        source_type: 'xmltv',
        url: `${new URL(values.server_url).origin}/xmltv.php?username=${values.username}&password=${values.password}`,
        api_key: '',
        is_active: true,
        refresh_interval: 24,
      });
    }

    if (values.account_type != 'XC') {
      showNotification({
        title: 'Fetching M3U Groups',
        message:
          'Configure group filters and auto sync settings once complete.',
      });
      close();
      return;
    }

    const updatedPlaylist = await getPlaylist(newPlaylist);
    await Promise.all([fetchChannelGroups(), fetchEPGs()]);

    if (values.enable_vod) {
      fetchCategories();
    }

    setPlaylist(updatedPlaylist);
    setGroupFilterModalOpen(true);
  };

  const onSubmit = async () => {
    const { create_epg, ...rawValues } = form.getValues();
    const values = prepareSubmitValues(rawValues, expDate);
    if (!playlist?.id && templateId)
      values.account_template = Number(templateId);

    if (playlist?.id) {
      await updatePlaylist(playlist, values, file);
      form.reset();
      setFile(null);
      onClose();
      return;
    }

    const newPlaylist = await addPlaylist(values, file);
    await handleNewPlaylist(newPlaylist, values, create_epg);
  };

  const close = () => {
    form.reset();
    setFile(null);
    setPlaylist(null);
    onClose();
  };

  const closeGroupFilter = () => {
    setGroupFilterModalOpen(false);
    // After group filter setup for a new account, reset everything
    form.reset();
    setFile(null);
    setPlaylist(null);
    onClose();
  };

  useEffect(() => {
    if (playlistCreated) {
      setGroupFilterModalOpen(true);
    }
  }, [playlist, playlistCreated]);

  if (!isOpen) {
    return <></>;
  }

  return (
    <>
      <Modal
        size={960}
        opened={isOpen}
        onClose={close}
        title="M3U Account"
        scrollAreaComponent={Modal.NativeScrollArea}
        lockScroll={false}
        withinPortal={true}
        trapFocus={false}
        yOffset="2vh"
      >
        <LoadingOverlay visible={form.submitting} overlayBlur={2} />

        <form onSubmit={form.onSubmit(onSubmit)}>
          <Stack gap={5} mb="md">
            <Text fw={500} size="sm">
              Account template
            </Text>
            <Group align="flex-end" wrap="wrap">
              <Select
                placeholder="No template"
                searchable
                clearable
                data={templates.map((template) => ({
                  value: String(template.id),
                  label: template.name,
                }))}
                value={templateId || null}
                onChange={(value) => setTemplateId(value || '')}
                style={{ flex: 1, minWidth: 240 }}
              />
              <Button
                variant="default"
                disabled={!selectedTemplate}
                loading={templateBusy}
                onClick={applyTemplate}
              >
                Apply
              </Button>
              {playlist?.id && (
                <Button
                  variant="default"
                  onClick={() => setTemplateSavingOpen(true)}
                >
                  Save current
                </Button>
              )}
              <Button
                variant="default"
                disabled={!selectedTemplate}
                onClick={exportTemplate}
              >
                Export
              </Button>
              <FileButton onChange={importTemplate} accept="application/json">
                {(props) => (
                  <Button variant="default" {...props}>
                    Import
                  </Button>
                )}
              </FileButton>
            </Group>
            <Text size="xs" c="dimmed">
              Templates contain portable settings, stream filters, and import
              rules only. Provider URLs and credentials are never included.
            </Text>
          </Stack>
          <Group align="flex-start" gap="md" wrap="nowrap">
            <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
              <TextInput
                id="name"
                name="name"
                label="Name"
                description="Unique identifier for this M3U account"
                {...form.getInputProps('name')}
                key={form.key('name')}
              />
              <TextInput
                id="server_url"
                name="server_url"
                label="URL"
                description="Direct URL to the M3U playlist or server"
                {...form.getInputProps('server_url')}
                key={form.key('server_url')}
              />
              <Select
                id="account_type"
                name="account_type"
                label="Account Type"
                description={
                  <>
                    Standard for direct M3U URLs, <br />
                    Xtream Codes for panel-based services
                  </>
                }
                data={[
                  { value: 'STD', label: 'Standard' },
                  { value: 'XC', label: 'Xtream Codes' },
                ]}
                key={form.key('account_type')}
                {...form.getInputProps('account_type')}
              />

              {form.getValues().account_type == 'XC' && (
                <>
                  <TextInput
                    id="username"
                    name="username"
                    label="Username"
                    description="Username for Xtream Codes authentication"
                    {...form.getInputProps('username')}
                  />
                  <PasswordInput
                    id="password"
                    name="password"
                    label="Password"
                    description="Password for Xtream Codes authentication (leave empty to keep existing)"
                    {...form.getInputProps('password')}
                  />
                </>
              )}

              {form.getValues().account_type != 'XC' && (
                <>
                  <FileInput
                    id="file"
                    label="Upload files"
                    placeholder="Upload files"
                    description="Upload a local M3U file instead of using URL"
                    onChange={setFile}
                    styles={{
                      input: {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block',
                      },
                    }}
                  />
                  <DateTimePicker
                    label="Expiration Date"
                    description="Set an expiration date to receive a warning notification"
                    placeholder="No expiration"
                    clearable
                    valueFormat="MMM D, YYYY h:mm A"
                    value={expDate}
                    onChange={(v) => setExpDate(v ? new Date(v) : null)}
                  />
                </>
              )}
            </Stack>

            <Divider size="sm" orientation="vertical" />

            <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
              <NumberInput
                id="max_streams"
                name="max_streams"
                label="Max Streams"
                placeholder="0 = Unlimited"
                description="Maximum number of concurrent streams (0 for unlimited)"
                min={0}
                {...form.getInputProps('max_streams')}
                key={form.key('max_streams')}
              />
              <Select
                id="server_group"
                name="server_group"
                label="Server Group"
                description="Share login limits across accounts in a server group. Set max streams on each profile (unlimited profiles skip group enforcement)."
                key={form.key('server_group')}
                value={form.getValues().server_group}
                onChange={(value) => {
                  if (value === '__new__') {
                    setServerGroupsCreateOnOpen(true);
                    setServerGroupsManagerOpen(true);
                    return;
                  }
                  form.setFieldValue('server_group', value);
                }}
                data={[
                  { value: '0', label: '(None)' },
                  ...serverGroups.map((group) => ({
                    label: group.name,
                    value: `${group.id}`,
                  })),
                  { value: '__new__', label: '+ Add server group...' },
                ]}
              />
              <Button
                variant="subtle"
                size="compact-xs"
                onClick={() => {
                  setServerGroupsCreateOnOpen(false);
                  setServerGroupsManagerOpen(true);
                }}
                style={{ alignSelf: 'flex-start' }}
              >
                Manage server groups
              </Button>
              <Select
                id="user_agent"
                name="user_agent"
                label="User-Agent"
                description="User-Agent header to use when accessing this M3U source"
                {...form.getInputProps('user_agent')}
                key={form.key('user_agent')}
                data={[{ value: '0', label: '(Use Default)' }].concat(
                  userAgents.map((ua) => ({
                    label: ua.name,
                    value: `${ua.id}`,
                  }))
                )}
              />
            </Stack>

            <Divider size="sm" orientation="vertical" />

            <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
              <ScheduleInput
                scheduleType={scheduleType}
                onScheduleTypeChange={setScheduleType}
                intervalValue={form.getValues().refresh_interval}
                onIntervalChange={(v) =>
                  form.setFieldValue('refresh_interval', v)
                }
                cronValue={form.getValues().cron_expression}
                onCronChange={(expr) =>
                  form.setFieldValue('cron_expression', expr)
                }
                intervalLabel="Refresh Interval (hours)"
                intervalDescription={
                  <>
                    How often to automatically refresh M3U data
                    <br />
                    (0 to disable automatic refreshes)
                  </>
                }
              />
              <NumberInput
                min={0}
                max={365}
                label="Stale Stream Retention (days)"
                description="Streams not seen for this many days will be removed"
                {...form.getInputProps('stale_stream_days')}
              />

              {form.getValues().account_type == 'XC' && (
                <Box>
                  <NumberInput
                    min={0}
                    max={999}
                    label="VOD Priority"
                    description="Priority for VOD provider selection (higher numbers = higher priority). Used when multiple providers offer the same content."
                    {...form.getInputProps('priority')}
                    key={form.key('priority')}
                  />

                  <Group justify="space-between">
                    <Box>Enable VOD Scanning</Box>
                    <Switch
                      id="enable_vod"
                      name="enable_vod"
                      description="Scan and import VOD content (movies/series) from this Xtream account"
                      key={form.key('enable_vod')}
                      {...form.getInputProps('enable_vod', {
                        type: 'checkbox',
                      })}
                    />
                  </Group>

                  {!m3uAccount && (
                    <Group justify="space-between">
                      <Box>Create EPG</Box>
                      <Switch
                        id="create_epg"
                        name="create_epg"
                        description="Automatically create matching EPG source for this Xtream account"
                        key={form.key('create_epg')}
                        {...form.getInputProps('create_epg', {
                          type: 'checkbox',
                        })}
                      />
                    </Group>
                  )}
                </Box>
              )}
            </Stack>
          </Group>

          <Divider my="md" />

          <Flex
            gap="md"
            justify="space-between"
            align="center"
            wrap="wrap"
            mih={50}
          >
            <Switch
              id="is_active"
              name="is_active"
              label="Is Active"
              description="Enable or disable this M3U account"
              key={form.key('is_active')}
              {...form.getInputProps('is_active', { type: 'checkbox' })}
            />

            <Flex gap="xs" align="center">
              {playlist && (
                <>
                  <Button
                    variant="filled"
                    // color={theme.custom.colors.buttonPrimary}
                    size="sm"
                    onClick={() => {
                      // If this is an XC account with VOD enabled, fetch VOD categories
                      if (
                        m3uAccount?.account_type === 'XC' &&
                        m3uAccount?.enable_vod
                      ) {
                        fetchCategories();
                      }
                      setGroupFilterModalOpen(true);
                    }}
                  >
                    Groups
                  </Button>
                  <Button
                    variant="filled"
                    // color={theme.custom.colors.buttonPrimary}
                    size="sm"
                    onClick={() => setProfileModalOpen(true)}
                  >
                    Profiles
                  </Button>
                </>
              )}

              <Button
                type="submit"
                aria-label="Save M3U account"
                variant="filled"
                disabled={form.submitting}
                size="sm"
              >
                Save
              </Button>
            </Flex>
          </Flex>
        </form>
      </Modal>
      {playlist && (
        <>
          <M3UProfiles
            playlist={playlist}
            isOpen={profileModalOpen}
            onClose={() => setProfileModalOpen(false)}
            pendingExpDate={expDate}
          />
          <M3UGroupFilter
            isOpen={groupFilterModalOpen}
            playlist={playlist}
            onClose={closeGroupFilter}
          />
        </>
      )}

      <ServerGroupsManagerModal
        isOpen={serverGroupsManagerOpen}
        onClose={() => {
          setServerGroupsManagerOpen(false);
          setServerGroupsCreateOnOpen(false);
        }}
        openCreateOnMount={serverGroupsCreateOnOpen}
        onGroupCreated={(group) => {
          if (group?.id) {
            form.setFieldValue('server_group', `${group.id}`);
          }
        }}
      />
      <Modal
        opened={templateSavingOpen}
        onClose={() => setTemplateSavingOpen(false)}
        title="Save M3U account template"
      >
        <Stack>
          <TextInput
            label="Template name"
            required
            value={templateName}
            onChange={(event) => setTemplateName(event.currentTarget.value)}
          />
          <Textarea
            label="Description"
            value={templateDescription}
            onChange={(event) =>
              setTemplateDescription(event.currentTarget.value)
            }
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setTemplateSavingOpen(false)}
            >
              Cancel
            </Button>
            <Button loading={templateBusy} onClick={saveTemplate}>
              Save template
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

export default M3U;
