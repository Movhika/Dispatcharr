import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import API from '../../api.js';
import useChannelsStore from '../../store/channels';
import useEPGsStore from '../../store/epgs';
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

const M3USetup = ({ account: initialAccount, onClose }) => {
  const [account, setAccount] = useState(initialAccount);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [epgChoice, setEPGChoice] = useState('');
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [categoriesSaved, setCategoriesSaved] = useState(false);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fetchChannelGroups = useChannelsStore((s) => s.fetchChannelGroups);
  const fetchEPGs = useEPGsStore((s) => s.fetchEPGs);
  const fetchCategories = useVODStore((s) => s.fetchCategories);

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
          if (!cancelled) setReady(true);
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
      if (action === 'create_epg') fetchEPGs().catch(() => {});
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
  const saveCategories = async () => {
    const current = await API.getPlaylist(account.id);
    if (!current)
      throw new Error('Category settings are saved. Reopen setup to continue.');
    setAccount(current);
    usePlaylistsStore.getState().updatePlaylist(current);
    setCategoriesSaved(true);
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
          if (!busy) onClose();
        }}
        title={`Set up ${account.name}`}
        closeButtonProps={{ 'aria-label': 'Close M3U setup' }}
        closeOnClickOutside={false}
        closeOnEscape={!busy}
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
          <div className={editorClasses.setupPanel}>
            {!categories ? (
              <M3UAccountEPG
                account={account}
                choice={epgChoice}
                onChoice={setEPGChoice}
                disabled={busy}
              />
            ) : (
              <Paper withBorder p="sm">
                <Stack gap="sm">
                  <Text fw={600}>Categories</Text>
                  {ready && !loadFailed ? (
                    <>
                      <Text size="sm" c="dimmed">
                        {categoriesSaved
                          ? 'Category settings saved.'
                          : 'Review which categories to import.'}{' '}
                        Finish starts the initial import using the saved
                        settings.
                      </Text>
                      <Group>
                        <Button
                          variant="default"
                          onClick={() => setCategoryEditorOpen(true)}
                          disabled={busy}
                        >
                          Edit categories
                        </Button>
                      </Group>
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
            )}
          </div>
          <Group
            component="footer"
            aria-label="M3U setup actions"
            justify="flex-end"
            gap="xs"
            mih={50}
            className={`${editorClasses.footer} ${editorClasses.plainFooter}`}
          >
            {categories && (!ready || loadFailed) && (
              <Button
                disabled={busy || (!loadFailed && !slowLoading)}
                loading={busy}
                onClick={() => advance('retry_categories')}
              >
                Retry
              </Button>
            )}
            <Button
              variant="default"
              disabled={busy}
              onClick={() =>
                advance(
                  categories && account.account_type === 'XC'
                    ? 'back_to_epg'
                    : 'back_to_content'
                )
              }
            >
              Back
            </Button>
            <Group gap="xs">
              {categories ? (
                <>
                  <Button
                    disabled={busy || !ready || loadFailed}
                    loading={busy}
                    onClick={() => advance('complete')}
                  >
                    Finish
                  </Button>
                </>
              ) : (
                <Button
                  disabled={busy || !epgChoice}
                  loading={busy}
                  onClick={() => advance(epgChoice)}
                >
                  Next
                </Button>
              )}
            </Group>
          </Group>
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
    </>
  );
};

export default M3USetup;
