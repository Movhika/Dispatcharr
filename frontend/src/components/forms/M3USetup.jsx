import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import API from '../../api.js';
import useChannelsStore from '../../store/channels';
import useVODStore from '../../store/useVODStore';
import usePlaylistsStore from '../../store/playlists';
import {
  hideNotification,
  showNotification,
} from '../../utils/notificationUtils.js';
import { formatApiError } from '../../utils';
import M3UGroupFilter from './M3UGroupFilter.jsx';
import M3USetupSteps from './M3USetupSteps.jsx';
import editorClasses from './AccountEditor.module.css';
import M3UAccountEPG from './M3UAccountEPG.jsx';
import M3U from './M3U.jsx';
import ConfirmationDialog from '../ConfirmationDialog.jsx';

const M3USetup = ({ account: initialAccount, onClose }) => {
  const [account, setAccount] = useState(initialAccount);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [epgBusy, setEPGBusy] = useState(false);
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fetchChannelGroups = useChannelsStore((s) => s.fetchChannelGroups);
  const fetchCategories = useVODStore((s) => s.fetchCategories);
  const vodCategories = useVODStore((s) => s.categories);

  useEffect(() => {
    let cancelled = false;
    let timer;
    let attempts = 0;
    const load = async () => {
      try {
        const current = await API.getPlaylist(initialAccount.id);
        if (cancelled || busyRef.current) return;
        if (!current) {
          setLoadFailed(true);
          return;
        }
        if (!current.setup_step) {
          onCloseRef.current();
          return;
        }
        setAccount(current);
        usePlaylistsStore.getState().updatePlaylist(current);
        if (current.setup_step !== 'categories') return;
        if (current.status === 'error') {
          setLoadFailed(true);
        } else if (
          current.channel_groups?.length &&
          !['fetching', 'parsing'].includes(current.status)
        ) {
          await fetchChannelGroups();
          const groups = useChannelsStore.getState().channelGroups;
          if (
            current.channel_groups.some((row) => !groups[row.channel_group])
          ) {
            setLoadFailed(true);
            return;
          }
          if (current.account_type === 'XC' && current.enable_vod)
            await fetchCategories();
          if (current.enable_vod && useVODStore.getState().categoriesError) {
            setLoadFailed(true);
            return;
          }
          if (!cancelled) {
            setLoadFailed(false);
            setReady(true);
          }
        } else {
          setSlowLoading(++attempts >= 45);
          timer = setTimeout(load, 2000);
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    initialAccount.id,
    account.setup_step,
    reload,
    fetchChannelGroups,
    fetchCategories,
  ]);

  const advance = async (action) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const current = await API.advanceM3USetup(account.id, action);
      hideNotification(`m3u-setup-${account.id}`);
      setAccount(current);
      usePlaylistsStore.getState().updatePlaylist(current);
      if (action === 'retry_categories') {
        setReady(false);
        setLoadFailed(false);
        setSlowLoading(false);
        setReload((value) => value + 1);
      }
      if (action === 'complete') {
        showNotification({
          title: 'Setup complete',
          message:
            'Category settings saved. The initial import has been requested.',
          color: 'green',
        });
        onClose();
      }
      return true;
    } catch (error) {
      showNotification({
        id: `m3u-setup-${account.id}`,
        title: 'Setup could not continue',
        message: formatApiError(error),
        color: 'red',
        autoClose: false,
      });
      // The request may have committed even if its response was interrupted.
      setReload((value) => value + 1);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const categories = account.setup_step === 'categories';
  const categoriesSaved = account.setup_categories_reviewed === true;
  const selectionCounts = [
    { label: 'Live TV', rows: account.channel_groups || [] },
    ...(account.account_type === 'XC' && account.enable_vod
      ? ['movie', 'series'].map((type) => ({
          label: type === 'movie' ? 'Movies' : 'Series',
          rows: Object.values(vodCategories || {})
            .filter((category) => category.category_type === type)
            .flatMap((category) =>
              (category.m3u_accounts || []).filter(
                (relation) => relation.m3u_account === account.id
              )
            ),
        }))
      : []),
  ];
  const saveCategories = async () => {
    const current = await API.advanceM3USetup(account.id, 'confirm_categories');
    setAccount(current);
    usePlaylistsStore.getState().updatePlaylist(current);
    if (account.account_type === 'XC' && account.enable_vod)
      await fetchCategories();
    setCategoryEditorOpen(false);
  };
  if (['account', 'content'].includes(account.setup_step)) {
    return (
      <M3U
        m3uAccount={account}
        isOpen
        setupMode
        setupBusy={busy}
        onClose={onClose}
        onSetupBack={() => advance('back_to_account')}
        onSetupNext={(saved) =>
          advance(
            account.setup_step === 'account'
              ? 'continue_content'
              : saved.account_type === 'XC'
                ? 'continue_epg'
                : 'continue_categories'
          )
        }
      />
    );
  }
  return (
    <>
      <Modal
        opened={!categoryEditorOpen}
        onClose={() => {
          if (!busy && !epgBusy) setExitOpen(true);
        }}
        title={`Set up ${account.name}`}
        closeButtonProps={{ 'aria-label': 'Close M3U setup' }}
        closeOnClickOutside={false}
        closeOnEscape={!busy && !epgBusy && !exitOpen}
        trapFocus={!exitOpen}
        size="68vw"
        classNames={{
          content: `${editorClasses.content} ${editorClasses.accountContent} ${editorClasses.m3uContent}`,
          body: editorClasses.body,
          header: editorClasses.header,
        }}
        yOffset="2vh"
        xOffset="3vw"
      >
        <Stack gap={0} className={editorClasses.form}>
          <M3USetupSteps
            stage={account.setup_step || 'categories'}
            accountType={account.account_type}
          />
          {!categories ? (
            <M3UAccountEPG
              account={account}
              isInitialSetup
              onBusyChange={setEPGBusy}
              disabled={busy}
              onBack={() => advance('back_to_content')}
              onNext={() => advance('continue_categories')}
            />
          ) : (
            <>
              <div className={editorClasses.setupPanel}>
                <Paper withBorder p="sm">
                  <Stack gap="sm">
                    <Text fw={600}>Categories</Text>
                    {ready && !loadFailed ? (
                      <>
                        {selectionCounts.map(({ label, rows }) => (
                          <Group key={label} justify="space-between">
                            <Text size="sm">{label}</Text>
                            <Text size="sm" c="dimmed">
                              {rows.filter((row) => row.enabled).length} of{' '}
                              {rows.length} categories selected
                            </Text>
                          </Group>
                        ))}
                        <Text size="sm" c="dimmed">
                          {categoriesSaved
                            ? 'Selection saved. Finish & import starts the initial import.'
                            : 'Select the categories you want to import before finishing setup.'}
                        </Text>
                        {categoriesSaved && (
                          <Group>
                            <Button
                              variant="default"
                              onClick={() => setCategoryEditorOpen(true)}
                              disabled={busy}
                            >
                              Edit selection
                            </Button>
                          </Group>
                        )}
                      </>
                    ) : (
                      <Alert color={loadFailed ? 'red' : 'blue'}>
                        {loadFailed
                          ? 'Categories could not be loaded. Check the account settings, then retry. You can close this window and resume later.'
                          : slowLoading
                            ? 'Loading provider categories is taking longer than usual. You can keep waiting, close this window and resume later, or retry.'
                            : 'Loading provider categories. You can edit their selection when loading completes.'}
                      </Alert>
                    )}
                  </Stack>
                </Paper>
              </div>
              <Group
                component="footer"
                aria-label="M3U setup actions"
                justify="space-between"
                gap="xs"
                mih={50}
                className={`${editorClasses.footer} ${editorClasses.plainFooter}`}
              >
                <Button
                  variant="default"
                  disabled={busy || epgBusy}
                  onClick={() =>
                    advance(
                      account.account_type === 'XC'
                        ? 'back_to_epg'
                        : 'back_to_content'
                    )
                  }
                >
                  Back
                </Button>
                <Group gap="xs">
                  {!ready || loadFailed ? (
                    <Button
                      disabled={busy || (!loadFailed && !slowLoading)}
                      loading={busy}
                      onClick={() => advance('retry_categories')}
                    >
                      Retry
                    </Button>
                  ) : categoriesSaved ? (
                    <Button
                      disabled={busy || !ready || loadFailed}
                      loading={busy}
                      onClick={() => advance('complete')}
                    >
                      Finish &amp; import
                    </Button>
                  ) : (
                    <Button
                      disabled={busy}
                      onClick={() => setCategoryEditorOpen(true)}
                    >
                      Select categories
                    </Button>
                  )}
                </Group>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
      {categoryEditorOpen && (
        <M3UGroupFilter
          playlist={account}
          isOpen
          isInitialSetup
          onSetupSave={saveCategories}
          onClose={() => setCategoryEditorOpen(false)}
        />
      )}
      <ConfirmationDialog
        opened={exitOpen}
        onClose={() => setExitOpen(false)}
        onConfirm={() => {
          setExitOpen(false);
          onClose();
        }}
        title="Continue setup later?"
        message="Your account and saved setup progress will be kept. Use Continue setup to resume. The initial import starts only when you finish setup."
        confirmLabel="Continue later"
        confirmColor="blue"
        cancelLabel="Keep editing"
      />
    </>
  );
};

export default M3USetup;
