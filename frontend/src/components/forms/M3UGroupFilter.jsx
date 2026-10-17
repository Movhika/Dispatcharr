// Modal.js
import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Flex,
  LoadingOverlay,
  Modal,
  Stack,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from '@mantine/core';
import useChannelsStore from '../../store/channels';
import useVODStore from '../../store/useVODStore';
import LiveGroupFilter from './LiveGroupFilter';
import VODCategoryFilter from './VODCategoryFilter';
import { showNotification } from '../../utils/notificationUtils.js';
import {
  buildGroupStates,
  saveAndRefreshPlaylist,
  savePlaylistGroupSettings,
} from '../../utils/forms/M3uGroupFilterUtils.js';
import { detectGroupReservationOverlaps } from '../../utils/forms/GroupSyncUtils';
import API from '../../api.js';
import M3URulesModal from './M3URulesModal.jsx';
import editorClasses from './AccountEditor.module.css';
import useCategoryPreviewAvailability from '../../hooks/useCategoryPreviewAvailability.jsx';
import ConfirmationDialog from '../ConfirmationDialog.jsx';

const M3UGroupFilter = ({
  playlist = null,
  isOpen,
  onClose,
  isInitialSetup = false,
  onSetupSave,
  onEditAccount,
}) => {
  const channelGroups = useChannelsStore((s) => s.channelGroups);
  const fetchCategories = useVODStore((s) => s.fetchCategories);

  const [groupStates, setGroupStates] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [movieCategoryStates, setMovieCategoryStates] = useState([]);
  const [seriesCategoryStates, setSeriesCategoryStates] = useState([]);
  const [activeTab, setActiveTab] = useState('live');
  const [rulesScope, setRulesScope] = useState(null);
  const [childOverlayOpen, setChildOverlayOpen] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [paginationContainer, setPaginationContainer] = useState(null);
  const groupsAccount = useRef(null);
  const savedGroups = useRef('[]');
  const [discardAction, setDiscardAction] = useState(null);
  const { availability, hint: previewHint } = useCategoryPreviewAvailability(
    playlist?.id,
    isOpen
  );

  useEffect(() => {
    if (!isOpen) {
      setActiveTab('live');
      setRulesScope(null);
      groupsAccount.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (
      !isOpen ||
      !playlist ||
      groupsAccount.current === playlist.id ||
      Object.keys(channelGroups).length === 0
    )
      return;
    groupsAccount.current = playlist.id;
    const groups = buildGroupStates(channelGroups, playlist.channel_groups);
    savedGroups.current = JSON.stringify(groups);
    setGroupStates(groups);
  }, [playlist, channelGroups, isOpen]);

  // Fetch VOD categories when modal opens for XC accounts with VOD enabled
  useEffect(() => {
    if (
      isOpen &&
      playlist &&
      playlist.account_type === 'XC' &&
      playlist.enable_vod
    ) {
      fetchCategories();
    }
  }, [isOpen, playlist, fetchCategories]);

  const submit = async () => {
    const refreshIncludesVod =
      playlist.account_type === 'XC' &&
      playlist.enable_vod &&
      playlist.is_active !== false &&
      (isInitialSetup || playlist.vod_refresh_after_live !== false);

    // Advisory only: overlapping ranges are sometimes intentional (for
    // example, two providers carrying the same category that should
    // merge into one shared number range). The form already shows a
    // warning triangle on each affected group with the specific overlap
    // names on hover, so the toast just confirms the save proceeded.
    const overlaps = detectGroupReservationOverlaps(groupStates);
    if (overlaps.length > 0) {
      showNotification({
        title: 'Overlapping channel number ranges',
        message: `Saved with ${overlaps.length} overlapping range pair${overlaps.length === 1 ? '' : 's'}. Hover the warning icon on each group for details. Sync will assign whichever numbers are free at run time.`,
        color: 'yellow',
        autoClose: 6000,
      });
    }

    setIsLoading(true);
    setActiveAction('save');
    try {
      const save =
        isInitialSetup && !onSetupSave
          ? saveAndRefreshPlaylist
          : savePlaylistGroupSettings;
      await save(
        playlist,
        groupStates,
        movieCategoryStates,
        seriesCategoryStates,
        {},
        isInitialSetup
      );

      savedGroups.current = JSON.stringify(groupStates);
      setMovieCategoryStates((current) =>
        current.map((category) => ({
          ...category,
          original_enabled: category.enabled,
          original_custom_properties: { ...(category.custom_properties || {}) },
        }))
      );
      setSeriesCategoryStates((current) =>
        current.map((category) => ({
          ...category,
          original_enabled: category.enabled,
          original_custom_properties: { ...(category.custom_properties || {}) },
        }))
      );

      if (onSetupSave) {
        await onSetupSave();
        return;
      }

      showNotification({
        title: 'Category Settings Updated',
        message: isInitialSetup
          ? 'Settings saved. The initial refresh has been requested.'
          : 'Settings saved. Refresh actions use the saved settings.',
        color: 'green',
        autoClose: 3000,
      });

      if (isInitialSetup)
        showNotification({
          title: 'Live TV Refresh Started',
          message: refreshIncludesVod
            ? 'Live TV is refreshing now. VOD will be queued in the background after Live TV completes; its progress is shown separately.'
            : 'The saved Live TV settings are being applied. Channel sync runs after parsing completes.',
          color: 'blue',
          autoClose: 5000,
        });

      if (isInitialSetup) onClose();
    } catch (error) {
      showNotification({
        title: 'Settings were not saved',
        message: error.message || 'Please retry.',
        color: 'red',
      });
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  };

  const refresh = async () => {
    setIsLoading(true);
    setActiveAction('refresh');
    try {
      const vod = activeTab !== 'live';
      const result = vod
        ? await API.refreshVODContent(playlist.id)
        : await API.refreshLivePlaylist(playlist.id);
      if (result)
        showNotification({
          title: vod ? 'VOD Refresh Started' : 'Live TV Refresh Started',
          message: 'The saved settings are being applied.',
          color: 'blue',
        });
    } catch (error) {
      showNotification({
        title: 'Refresh was not started',
        message: error.message || 'Please retry.',
        color: 'red',
      });
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  };

  const applyRuleResult = (result) => {
    const ids = new Set(result.target_ids || []);
    const update = (current) =>
      current.map((row) =>
        ids.has(result.scope === 'live' ? row.channel_group : row.id)
          ? {
              ...row,
              enabled: result.enabled,
              original_enabled: result.enabled,
            }
          : row
      );
    if (result.scope === 'live') setGroupStates(update);
    else if (result.scope === 'movie') setMovieCategoryStates(update);
    else setSeriesCategoryStates(update);
  };

  const requestExit = (action) => {
    if (isLoading) return;
    const changed =
      savedGroups.current !== JSON.stringify(groupStates) ||
      [...movieCategoryStates, ...seriesCategoryStates].some(
        (row) =>
          row.enabled !== row.original_enabled ||
          JSON.stringify(row.custom_properties || {}) !==
            JSON.stringify(row.original_custom_properties || {})
      );
    if (onSetupSave && changed) setDiscardAction(() => action);
    else action();
  };

  if (!isOpen) {
    return <></>;
  }

  return (
    <Modal
      opened={isOpen}
      onClose={() => requestExit(onClose)}
      title="Categories"
      closeButtonProps={{ 'aria-label': 'Close categories' }}
      size="94vw"
      classNames={{
        content: editorClasses.content,
        body: editorClasses.body,
        header: editorClasses.header,
      }}
      styles={{
        content: { '--mantine-color-body': '#27272A' },
      }}
      lockScroll={false}
      withinPortal={true}
      trapFocus={!rulesScope && !childOverlayOpen && !discardAction}
      closeOnEscape={
        !rulesScope && !childOverlayOpen && !discardAction && !isLoading
      }
      yOffset="2vh"
      xOffset="3vw"
    >
      <LoadingOverlay visible={isLoading} overlayBlur={2} />
      <Stack className={editorClasses.form} gap={0}>
        <Tabs
          className={editorClasses.tabs}
          value={activeTab}
          onChange={(value) => {
            if (!isLoading) setActiveTab(value);
          }}
        >
          <TabsList className={editorClasses.tabList}>
            <TabsTab value="live">Live TV</TabsTab>
            <TabsTab
              value="vod-movie"
              disabled={!!onSetupSave && !playlist.enable_vod}
            >
              VOD - Movies
            </TabsTab>
            <TabsTab
              value="vod-series"
              disabled={!!onSetupSave && !playlist.enable_vod}
            >
              VOD - Series
            </TabsTab>
          </TabsList>

          <TabsPanel
            value="live"
            className={`${editorClasses.panel} ${editorClasses.categoryPanel}`}
          >
            <LiveGroupFilter
              playlist={playlist}
              groupStates={groupStates}
              setGroupStates={setGroupStates}
              onOpenRules={() => setRulesScope('live')}
              onOverlayChange={setChildOverlayOpen}
              paginationContainer={paginationContainer}
              paginationVisible={activeTab === 'live'}
              previewAvailableIds={availability?.live ?? null}
              previewUnavailableHint={previewHint}
            />
          </TabsPanel>

          <TabsPanel
            value="vod-movie"
            className={`${editorClasses.panel} ${editorClasses.categoryPanel}`}
          >
            <VODCategoryFilter
              playlist={playlist}
              categoryStates={movieCategoryStates}
              setCategoryStates={setMovieCategoryStates}
              type="movie"
              onOpenRules={() => setRulesScope('movie')}
              onOverlayChange={setChildOverlayOpen}
              paginationContainer={paginationContainer}
              paginationVisible={activeTab === 'vod-movie'}
              previewAvailableIds={availability?.movie ?? null}
              previewUnavailableHint={previewHint}
            />
          </TabsPanel>

          <TabsPanel
            value="vod-series"
            className={`${editorClasses.panel} ${editorClasses.categoryPanel}`}
          >
            <VODCategoryFilter
              playlist={playlist}
              categoryStates={seriesCategoryStates}
              setCategoryStates={setSeriesCategoryStates}
              type="series"
              onOpenRules={() => setRulesScope('series')}
              onOverlayChange={setChildOverlayOpen}
              paginationContainer={paginationContainer}
              paginationVisible={activeTab === 'vod-series'}
              previewAvailableIds={availability?.series ?? null}
              previewUnavailableHint={previewHint}
            />
          </TabsPanel>
        </Tabs>

        <Flex
          component="footer"
          aria-label="Category actions"
          className={`${editorClasses.footer} ${editorClasses.plainFooter} ${editorClasses.categoryFooter}`}
          mih={50}
          gap="xs"
          justify="flex-end"
          align="center"
          wrap="wrap"
        >
          <div
            ref={setPaginationContainer}
            className={editorClasses.paginationSlot}
          />
          <div className={editorClasses.categoryFooterActions}>
            {onEditAccount && (
              <Button
                variant="default"
                disabled={isLoading}
                onClick={() => requestExit(onEditAccount)}
              >
                Edit account
              </Button>
            )}
            {!isInitialSetup && (
              <Button
                variant="default"
                onClick={refresh}
                disabled={
                  isLoading ||
                  (activeTab !== 'live' &&
                    (!playlist.enable_vod || playlist.account_type !== 'XC'))
                }
                loading={activeAction === 'refresh'}
              >
                {activeTab === 'live' ? 'Refresh Live TV' : 'Refresh VOD'}
              </Button>
            )}
            <Button
              type="submit"
              variant="filled"
              color="blue"
              disabled={isLoading}
              loading={activeAction === 'save'}
              onClick={submit}
            >
              {isInitialSetup && !onSetupSave ? 'Save and Refresh' : 'Save'}
            </Button>
          </div>
        </Flex>
      </Stack>
      <M3URulesModal
        opened={!!rulesScope}
        onClose={() => setRulesScope(null)}
        title={`${rulesScope === 'live' ? 'Live TV' : rulesScope === 'movie' ? 'Movie' : 'Series'} import rules`}
        accountId={playlist.id}
        scope={rulesScope}
        onApplied={applyRuleResult}
      />
      <ConfirmationDialog
        opened={!!discardAction}
        onClose={() => setDiscardAction(null)}
        onConfirm={() => {
          const action = discardAction;
          setDiscardAction(null);
          action?.();
        }}
        title="Discard category changes?"
        message="These category changes have not been saved. The account remains available to resume setup later."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
      />
    </Modal>
  );
};

export default M3UGroupFilter;
