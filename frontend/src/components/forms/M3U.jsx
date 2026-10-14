// Modal.js
import React, { useEffect, useState } from 'react';
import useUserAgentsStore from '../../store/userAgents';
import useServerGroupsStore from '../../store/serverGroups';
import usePlaylistsStore from '../../store/playlists';
import M3UProfiles from './M3UProfiles';
import {
  Button,
  FileInput,
  Flex,
  Group,
  LoadingOverlay,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  PasswordInput,
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
import { M3U_HASH_KEY_OPTIONS } from '../../utils/m3uHashKey.js';
import ServerGroupsManagerModal from '../ServerGroupsManagerModal';
import {
  useDateTimeFormat,
  useTimeHelpers,
} from '../../utils/dateTimeUtils.js';
import editorClasses from './AccountEditor.module.css';

const helpLabel = (label, help) => (
  <Group gap={5} wrap="nowrap">
    <Text span inherit>
      {label}
    </Text>
    <Tooltip
      label={help}
      multiline
      maw={360}
      withArrow
      events={{ hover: true, focus: true, touch: true }}
    >
      <Text
        span
        size="xs"
        c="dimmed"
        tabIndex={0}
        aria-label={`${label} help`}
        style={{ cursor: 'help' }}
      >
        ⓘ
      </Text>
    </Tooltip>
  </Group>
);

const ScheduleStatus = ({ schedule, lastCompleted, formatDate, nextLabel }) => (
  <Text size="xs" c="dimmed">
    Last: {lastCompleted ? formatDate(lastCompleted) : 'Never'} · Next:{' '}
    {nextLabel ||
      (schedule?.enabled
        ? schedule.next_run_at
          ? formatDate(schedule.next_run_at)
          : 'Unavailable'
        : 'Not scheduled')}
  </Text>
);

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

  const [playlist, setPlaylist] = useState(null);
  const [file, setFile] = useState(null);
  const [expDate, setExpDate] = useState(null);
  const [groupFilterModalOpen, setGroupFilterModalOpen] = useState(false);
  const [profileOverlayOpen, setProfileOverlayOpen] = useState(false);
  const [initialGroupSetup, setInitialGroupSetup] = useState(false);
  const [scheduleType, setScheduleType] = useState('interval');
  const [vodScheduleType, setVodScheduleType] = useState('interval');
  const [vodEnabled, setVodEnabled] = useState(false);
  const [vodRefreshAfterLive, setVodRefreshAfterLive] = useState(true);
  const [accountType, setAccountType] = useState('XC');
  const [serverGroupsManagerOpen, setServerGroupsManagerOpen] = useState(false);
  const [hasHashKeyOverride, setHasHashKeyOverride] = useState(false);
  const [activeTab, setActiveTab] = useState('account');
  const [pendingCreation, setPendingCreation] = useState(null);
  const [finishingCreation, setFinishingCreation] = useState(false);
  const [serverGroupsCreateOnOpen, setServerGroupsCreateOnOpen] =
    useState(false);

  const {
    timeFormat: timeformat,
    dateYearFormat,
    fullDateTimeFormat,
  } = useDateTimeFormat();
  const { toUserTime } = useTimeHelpers();

  // Keep expiration in sync when the default profile is edited (store refreshes).
  // Do not rebind the whole form to the live playlist or unsaved edits are wiped.
  const accountId = playlist?.id ?? m3uAccount?.id;
  const storedAccount = usePlaylistsStore((s) =>
    s.playlists.find((p) => p.id === accountId)
  );
  const statusPlaylist = storedAccount || playlist;
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
      xc_live_refresh_min_age_minutes: 30,
      cron_expression: '',
      vod_refresh_interval: 0,
      vod_cron_expression: '',
      vod_refresh_after_live: true,
      account_type: 'XC',
      username: '',
      password: '',
      stale_stream_days: 7,
      priority: 0,
      enable_vod: false,
      hash_key: [],
    },

    validate: {
      name: isNotEmpty('Please select a name'),
      user_agent: isNotEmpty('Please select a user-agent'),
    },
  });

  useEffect(() => {
    setActiveTab('account');
    setPendingCreation(null);
    if (m3uAccount) {
      setInitialGroupSetup(false);
      setPlaylist(m3uAccount);
      setAccountType(m3uAccount.account_type);
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
        xc_live_refresh_min_age_minutes:
          m3uAccount.xc_live_refresh_min_age_minutes ?? 30,
        cron_expression: m3uAccount.cron_expression || '',
        vod_refresh_interval: m3uAccount.vod_refresh_interval ?? 0,
        vod_cron_expression: m3uAccount.vod_cron_expression || '',
        vod_refresh_after_live: m3uAccount.vod_refresh_after_live !== false,
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
        hash_key: m3uAccount.hash_key
          ? m3uAccount.hash_key.split(',').filter(Boolean)
          : [],
      });
      setHasHashKeyOverride(
        !!(
          m3uAccount.hash_key &&
          m3uAccount.hash_key.split(',').filter(Boolean).length
        )
      );
      setExpDate(expDateFromPlaylist(m3uAccount.exp_date));

      // Determine schedule type from existing data
      setScheduleType(
        m3uAccount.cron_expression && m3uAccount.cron_expression.trim() !== ''
          ? 'cron'
          : 'interval'
      );
      setVodScheduleType(
        m3uAccount.vod_cron_expression?.trim() ? 'cron' : 'interval'
      );
      setVodEnabled(Boolean(m3uAccount.enable_vod));
      setVodRefreshAfterLive(m3uAccount.vod_refresh_after_live !== false);
    } else {
      setInitialGroupSetup(false);
      setPlaylist(null);
      setAccountType('XC');
      form.reset();
      setScheduleType('interval');
      setVodScheduleType('interval');
      setVodEnabled(false);
      setVodRefreshAfterLive(true);
      setExpDate(null);
      setHasHashKeyOverride(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m3uAccount]);

  useEffect(() => {
    if (storeExpDate === undefined) return;
    const next = expDateFromPlaylist(storeExpDate);
    setExpDate((prev) => (expDateKey(prev) === expDateKey(next) ? prev : next));
  }, [storeExpDate]);

  const handleNewPlaylist = async (newPlaylist, values) => {
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
    if (!updatedPlaylist?.id) throw new Error('Account details unavailable');
    await Promise.all([fetchChannelGroups(), fetchEPGs()]);

    if (values.enable_vod) {
      fetchCategories();
    }

    setPlaylist(updatedPlaylist);
    setInitialGroupSetup(true);
    setGroupFilterModalOpen(true);
  };

  const onSubmit = async () => {
    const rawValues = form.getValues();
    const values = prepareSubmitValues(rawValues, expDate);

    if (playlist?.id) {
      // Enabled is controlled in the overview, not by a stale editor snapshot.
      delete values.is_active;
      await updatePlaylist(playlist, values, file);
      form.reset();
      setFile(null);
      onClose();
      return;
    }

    const newPlaylist = await addPlaylist(values, file);
    if (!newPlaylist?.id) return;
    if (values.account_type === 'XC') {
      // The account already exists before asking about its optional EPG source.
      setPlaylist(newPlaylist);
      setPendingCreation({ playlist: newPlaylist, values, epgCreated: false });
    } else {
      await handleNewPlaylist(newPlaylist, values);
    }
  };

  const finishCreation = async (createEpg) => {
    if (!pendingCreation || finishingCreation) return;
    setFinishingCreation(true);
    let creatingEpg = createEpg && !pendingCreation.epgCreated;
    try {
      const { playlist: newPlaylist, values } = pendingCreation;
      if (creatingEpg) {
        const url = new URL('/xmltv.php', values.server_url);
        url.searchParams.set('username', values.username || '');
        url.searchParams.set('password', values.password || '');
        const epg = await addEPG({
          name: values.name,
          source_type: 'xmltv',
          url: url.toString(),
          api_key: '',
          is_active: true,
          refresh_interval: 24,
        });
        // The API already reports failures and returns no source in that case.
        if (!epg?.id) return;
        setPendingCreation((current) => ({ ...current, epgCreated: true }));
        creatingEpg = false;
      }
      await handleNewPlaylist(newPlaylist, values);
      setPendingCreation(null);
    } catch {
      showNotification({
        title: creatingEpg
          ? 'EPG source was not created'
          : 'Categories could not be loaded',
        message: creatingEpg
          ? 'The M3U account is already created. Retry or continue without an EPG source.'
          : 'The M3U account is already created. Please retry opening its categories.',
        color: 'red',
      });
    } finally {
      setFinishingCreation(false);
    }
  };

  const close = () => {
    form.reset();
    setFile(null);
    setPlaylist(null);
    setInitialGroupSetup(false);
    setPendingCreation(null);
    onClose();
  };

  const closeGroupFilter = () => {
    setGroupFilterModalOpen(false);
    if (!initialGroupSetup) return;
    // After group filter setup for a new account, reset everything
    form.reset();
    setFile(null);
    setPlaylist(null);
    setInitialGroupSetup(false);
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
        size="68vw"
        opened={isOpen && !pendingCreation}
        onClose={close}
        title={m3uAccount?.id ? 'Edit M3U account' : 'Create M3U account'}
        classNames={{
          content: `${editorClasses.content} ${editorClasses.accountContent}`,
          body: editorClasses.body,
          header: editorClasses.header,
        }}
        lockScroll={false}
        withinPortal={true}
        trapFocus={
          !groupFilterModalOpen &&
          !serverGroupsManagerOpen &&
          !profileOverlayOpen
        }
        closeOnEscape={
          !groupFilterModalOpen &&
          !serverGroupsManagerOpen &&
          !profileOverlayOpen
        }
        yOffset="2vh"
        xOffset="3vw"
      >
        <LoadingOverlay visible={form.submitting} overlayBlur={2} />

        <form onSubmit={form.onSubmit(onSubmit)} className={editorClasses.form}>
          <Tabs
            value={activeTab}
            onChange={setActiveTab}
            className={`${editorClasses.tabs} ${editorClasses.accountTabs}`}
          >
            <TabsList className={editorClasses.tabList}>
              <TabsTab value="account">Account</TabsTab>
              <TabsTab value="content">Content</TabsTab>
              <TabsTab value="profiles" disabled={!playlist?.id}>
                Profiles
              </TabsTab>
            </TabsList>
            <TabsPanel
              value="account"
              className={`${editorClasses.panel} ${editorClasses.accountPanel}`}
              data-editor-active={activeTab === 'account'}
              aria-hidden={activeTab !== 'account'}
              inert={activeTab !== 'account'}
            >
              <SimpleGrid
                cols={{ base: 1, sm: 2 }}
                spacing="md"
                verticalSpacing="xs"
              >
                <Paper withBorder p="sm">
                  <Stack
                    gap={4}
                    style={{ minWidth: 0 }}
                    role="group"
                    aria-label="Account settings"
                  >
                    <Text fw={600}>Account</Text>
                    {playlist?.is_active === false && (
                      <Text size="xs" c="dimmed">
                        Disabled — enable this account from the overview.
                      </Text>
                    )}
                    <TextInput
                      id="name"
                      name="name"
                      label="Name"
                      {...form.getInputProps('name')}
                      key={form.key('name')}
                    />
                    <Select
                      id="account_type"
                      name="account_type"
                      label="Account Type"
                      data={[
                        { value: 'STD', label: 'Standard' },
                        { value: 'XC', label: 'Xtream Codes' },
                      ]}
                      key={form.key('account_type')}
                      {...form.getInputProps('account_type')}
                      onChange={(value) => {
                        form.setFieldValue('account_type', value);
                        setAccountType(value);
                      }}
                    />

                    <TextInput
                      id="server_url"
                      name="server_url"
                      label="URL"
                      placeholder={
                        accountType === 'XC'
                          ? 'Xtream Codes server URL'
                          : 'M3U playlist URL'
                      }
                      {...form.getInputProps('server_url')}
                      key={form.key('server_url')}
                    />

                    {accountType === 'XC' && (
                      <>
                        <TextInput
                          id="username"
                          name="username"
                          label="Username"
                          {...form.getInputProps('username')}
                        />
                        <PasswordInput
                          id="password"
                          name="password"
                          label="Password"
                          placeholder={
                            playlist?.id
                              ? 'Leave empty to keep existing password'
                              : undefined
                          }
                          {...form.getInputProps('password')}
                        />
                      </>
                    )}

                    {accountType !== 'XC' && (
                      <>
                        <FileInput
                          id="file"
                          label="Upload files"
                          placeholder="Upload files"
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
                          label={helpLabel(
                            'Expiration Date',
                            'Set an expiration date to receive a warning notification.'
                          )}
                          aria-label="Expiration Date"
                          placeholder="No expiration"
                          clearable
                          valueFormat={`${dateYearFormat} ${timeformat}`}
                          value={expDate}
                          onChange={(v) => setExpDate(v ? new Date(v) : null)}
                        />
                      </>
                    )}
                  </Stack>
                </Paper>

                <Paper withBorder p="sm">
                  <Stack
                    gap={4}
                    style={{ minWidth: 0 }}
                    role="group"
                    aria-label="Connection settings"
                  >
                    <Text fw={600}>Connection</Text>
                    <NumberInput
                      id="max_streams"
                      name="max_streams"
                      label={helpLabel(
                        'Max Streams',
                        'Maximum concurrent streams for the default connection profile. Use 0 for unlimited.'
                      )}
                      aria-label="Max Streams"
                      placeholder="0 = Unlimited"
                      min={0}
                      {...form.getInputProps('max_streams')}
                      key={form.key('max_streams')}
                    />
                    <Select
                      id="server_group"
                      name="server_group"
                      label={helpLabel(
                        'Server Group',
                        'Link M3U and XC accounts that belong to the same provider subscription so connection limits are tracked across all imported sources. Matching effective logins share the same counter; unlimited profiles are not restricted.'
                      )}
                      aria-label="Server Group"
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
                      label={helpLabel(
                        'User-Agent',
                        'User-Agent header used when accessing this M3U source.'
                      )}
                      aria-label="User-Agent"
                      {...form.getInputProps('user_agent')}
                      key={form.key('user_agent')}
                      data={[{ value: '0', label: '(Use Default)' }].concat(
                        userAgents.map((ua) => ({
                          label: ua.name,
                          value: `${ua.id}`,
                        }))
                      )}
                    />
                    <MultiSelect
                      id="hash_key"
                      name="hash_key"
                      label={helpLabel(
                        'Hash Key Override',
                        'Fields used to identify this account’s streams. Empty inherits the global default. Changing this rehashes only this account.'
                      )}
                      aria-label="Hash Key Override"
                      placeholder={
                        hasHashKeyOverride ? undefined : 'Use global default'
                      }
                      clearable
                      data={M3U_HASH_KEY_OPTIONS}
                      {...form.getInputProps('hash_key')}
                      onChange={(value) => {
                        form.getInputProps('hash_key').onChange(value);
                        setHasHashKeyOverride(!!(value && value.length));
                      }}
                      key={form.key('hash_key')}
                    />
                  </Stack>
                </Paper>
              </SimpleGrid>
            </TabsPanel>
            <TabsPanel
              value="content"
              className={`${editorClasses.panel} ${editorClasses.accountPanel}`}
              data-editor-active={activeTab === 'content'}
              aria-hidden={activeTab !== 'content'}
              inert={activeTab !== 'content'}
            >
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                <Paper withBorder p="sm">
                  <Stack
                    gap={4}
                    style={{ minWidth: 0 }}
                    role="group"
                    aria-label="Live TV settings"
                  >
                    <Text fw={600}>Live TV</Text>
                    {accountType === 'XC' && (
                      <NumberInput
                        min={0}
                        max={10080}
                        allowDecimal={false}
                        label={helpLabel(
                          'Client refresh cooldown (minutes)',
                          'Minimum wait after a successful Live refresh. Applies to all users; 0 disables this cooldown. Failed requests are still rate-limited per provider.'
                        )}
                        aria-label="Client refresh cooldown (minutes)"
                        {...form.getInputProps(
                          'xc_live_refresh_min_age_minutes'
                        )}
                        key={form.key('xc_live_refresh_min_age_minutes')}
                      />
                    )}
                    <NumberInput
                      min={0}
                      max={365}
                      label={helpLabel(
                        'Stale Stream Retention (days)',
                        'Streams not seen for this many days will be removed.'
                      )}
                      aria-label="Stale Stream Retention (days)"
                      {...form.getInputProps('stale_stream_days')}
                    />
                  </Stack>
                </Paper>

                <Paper withBorder p="sm">
                  <Stack
                    gap={4}
                    style={{ minWidth: 0 }}
                    role="group"
                    aria-label="VOD settings"
                  >
                    <Group justify="space-between">
                      <Text fw={600}>VOD</Text>
                      <Tooltip
                        label="Import movies and series from this Xtream Codes account."
                        multiline
                        maw={320}
                        withArrow
                      >
                        <Paper withBorder px="xs" py={6} radius="md">
                          <Switch
                            id="enable_vod"
                            name="enable_vod"
                            label="Enabled"
                            aria-label="Enable VOD"
                            disabled={accountType !== 'XC'}
                            checked={accountType === 'XC' && vodEnabled}
                            onChange={(event) => {
                              const enabled = event.currentTarget.checked;
                              setVodEnabled(enabled);
                              form.setFieldValue('enable_vod', enabled);
                            }}
                          />
                        </Paper>
                      </Tooltip>
                    </Group>
                    {accountType === 'XC' ? (
                      <NumberInput
                        min={0}
                        max={999}
                        label={helpLabel(
                          'VOD Priority',
                          'Higher numbers have higher priority when multiple providers offer the same VOD content.'
                        )}
                        aria-label="VOD Priority"
                        disabled={!vodEnabled}
                        {...form.getInputProps('priority')}
                        key={form.key('priority')}
                      />
                    ) : (
                      <Text size="sm" c="dimmed">
                        VOD scanning is available for Xtream Codes accounts
                        only.
                      </Text>
                    )}
                  </Stack>
                </Paper>

                <Paper withBorder p="sm">
                  <Stack
                    gap={4}
                    role="group"
                    aria-label="Live TV refresh schedule"
                  >
                    <Text fw={600}>Live TV refresh schedule</Text>
                    <ScheduleInput
                      scheduleType={scheduleType}
                      onScheduleTypeChange={setScheduleType}
                      intervalValue={form.getValues().refresh_interval}
                      onIntervalChange={(value) =>
                        form.setFieldValue('refresh_interval', value)
                      }
                      cronValue={form.getValues().cron_expression}
                      onCronChange={(value) =>
                        form.setFieldValue('cron_expression', value)
                      }
                      intervalLabel="Live TV refresh interval (hours)"
                      intervalDescription="Use 0 to disable automatic Live TV refreshes."
                    />
                    {playlist?.id && (
                      <ScheduleStatus
                        schedule={statusPlaylist?.live_refresh_schedule}
                        lastCompleted={
                          statusPlaylist?.custom_properties?.refresh_timings
                            ?.live_completed_at || statusPlaylist?.updated_at
                        }
                        formatDate={(value) =>
                          toUserTime(value).format(fullDateTimeFormat)
                        }
                      />
                    )}
                  </Stack>
                </Paper>

                <Paper withBorder p="sm">
                  <Stack gap={4} role="group" aria-label="VOD refresh schedule">
                    <Group justify="space-between">
                      <Text fw={600}>VOD refresh schedule</Text>
                      <Tooltip
                        label="When disabled, VOD refresh runs after a successful scheduled Live TV refresh."
                        multiline
                        maw={320}
                        withArrow
                      >
                        <Paper withBorder px="xs" py={6} radius="md">
                          <Switch
                            label="Enabled"
                            aria-label="Enable separate VOD refresh schedule"
                            disabled={accountType !== 'XC' || !vodEnabled}
                            checked={
                              accountType === 'XC' && !vodRefreshAfterLive
                            }
                            onChange={(event) => {
                              const afterLive = !event.currentTarget.checked;
                              setVodRefreshAfterLive(afterLive);
                              form.setFieldValue(
                                'vod_refresh_after_live',
                                afterLive
                              );
                            }}
                          />
                        </Paper>
                      </Tooltip>
                    </Group>
                    {accountType === 'XC' && vodEnabled ? (
                      !vodRefreshAfterLive ? (
                        <ScheduleInput
                          scheduleType={vodScheduleType}
                          onScheduleTypeChange={setVodScheduleType}
                          intervalValue={form.getValues().vod_refresh_interval}
                          onIntervalChange={(value) =>
                            form.setFieldValue('vod_refresh_interval', value)
                          }
                          cronValue={form.getValues().vod_cron_expression}
                          onCronChange={(value) =>
                            form.setFieldValue('vod_cron_expression', value)
                          }
                          intervalLabel="VOD refresh interval (hours)"
                          intervalDescription="Use 0 to disable automatic VOD refreshes."
                        />
                      ) : (
                        <Text size="sm" c="dimmed">
                          VOD refreshes after a successful scheduled Live TV
                          refresh.
                        </Text>
                      )
                    ) : (
                      <Text size="sm" c="dimmed">
                        Enable VOD scanning to configure automatic VOD
                        refreshes.
                      </Text>
                    )}
                    {playlist?.id && (
                      <ScheduleStatus
                        schedule={statusPlaylist?.vod_refresh_schedule}
                        lastCompleted={
                          statusPlaylist?.custom_properties?.refresh_timings
                            ?.vod_completed_at
                        }
                        formatDate={(value) =>
                          toUserTime(value).format(fullDateTimeFormat)
                        }
                        nextLabel={
                          statusPlaylist?.account_type === 'XC' &&
                          statusPlaylist?.enable_vod &&
                          statusPlaylist?.vod_refresh_after_live !== false &&
                          statusPlaylist?.live_refresh_schedule?.enabled
                            ? 'After Live TV refresh'
                            : undefined
                        }
                      />
                    )}
                  </Stack>
                </Paper>
              </SimpleGrid>
            </TabsPanel>
            <TabsPanel
              value="profiles"
              className={`${editorClasses.panel} ${editorClasses.accountPanel}`}
              data-editor-active={activeTab === 'profiles'}
              aria-hidden={activeTab !== 'profiles'}
              inert={activeTab !== 'profiles'}
            >
              {playlist?.id && (
                <M3UProfiles
                  playlist={playlist}
                  embedded
                  pendingExpDate={expDate}
                  onOverlayChange={setProfileOverlayOpen}
                />
              )}
            </TabsPanel>
          </Tabs>

          <Flex
            component="footer"
            aria-label="M3U account actions"
            className={editorClasses.footer}
            gap="md"
            justify="flex-end"
            align="center"
            wrap="nowrap"
            mih={50}
          >
            <Flex gap="xs" align="center">
              {playlist && (
                <>
                  <Button
                    variant="default"
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
                    Categories
                  </Button>
                </>
              )}

              <Button
                type="submit"
                variant="filled"
                disabled={form.submitting}
                size="sm"
              >
                {playlist?.id ? 'Save' : 'Create'}
              </Button>
            </Flex>
          </Flex>
        </form>
      </Modal>
      <Modal
        opened={!!pendingCreation}
        onClose={close}
        title="Create matching EPG source?"
        centered
        closeOnClickOutside={false}
        closeOnEscape={!finishingCreation}
        withCloseButton={!finishingCreation}
      >
        <Stack>
          <Text size="sm">
            The M3U account has been created. Would you also like to create an
            XMLTV EPG source using this account’s provider and credentials?
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => finishCreation(false)}
              disabled={finishingCreation}
            >
              {pendingCreation?.epgCreated ? 'Continue' : 'Skip'}
            </Button>
            {!pendingCreation?.epgCreated && (
              <Button
                onClick={() => finishCreation(true)}
                loading={finishingCreation}
              >
                Create EPG
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
      {playlist && (
        <>
          <M3UGroupFilter
            isOpen={groupFilterModalOpen}
            playlist={playlist}
            isInitialSetup={initialGroupSetup}
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
    </>
  );
};

export default M3U;
