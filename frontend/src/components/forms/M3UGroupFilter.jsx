// Modal.js
import React, { useEffect, useState } from 'react';
import {
  Button,
  Flex,
  Group,
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
import M3UDeveloperCatalog from './M3UDeveloperCatalog';
import { showNotification } from '../../utils/notificationUtils.js';
import {
  buildGroupStates,
  saveAndRefreshPlaylist,
} from '../../utils/forms/M3uGroupFilterUtils.js';
import { detectGroupReservationOverlaps } from '../../utils/forms/GroupSyncUtils';

const M3UGroupFilter = ({ playlist = null, isOpen, onClose }) => {
  const channelGroups = useChannelsStore((s) => s.channelGroups);
  const fetchCategories = useVODStore((s) => s.fetchCategories);

  const [groupStates, setGroupStates] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [movieCategoryStates, setMovieCategoryStates] = useState([]);
  const [seriesCategoryStates, setSeriesCategoryStates] = useState([]);
  const [activeTab, setActiveTab] = useState('live');
  const [developerMode, setDeveloperMode] = useState(false);

  const toggleDeveloperMode = (enabled) => {
    setDeveloperMode(enabled);
    if (!enabled && activeTab === 'raw-data') setActiveTab('live');
  };

  useEffect(() => {
    if (isOpen) return;
    setDeveloperMode(false);
    setActiveTab('live');
  }, [isOpen]);

  useEffect(() => {
    if (Object.keys(channelGroups).length === 0) return;
    setGroupStates(buildGroupStates(channelGroups, playlist.channel_groups));
  }, [playlist, channelGroups]);

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
    try {
      await saveAndRefreshPlaylist(
        playlist,
        groupStates,
        movieCategoryStates,
        seriesCategoryStates,
        {}
      );

      showNotification({
        title: 'Group Settings Updated',
        message: 'Settings saved. Starting M3U refresh to apply changes...',
        color: 'green',
        autoClose: 3000,
      });

      showNotification({
        title: 'M3U Refresh Started',
        message:
          'The M3U account is being refreshed. Channel sync will occur automatically after parsing completes.',
        color: 'blue',
        autoClose: 5000,
      });

      onClose();
    } catch (error) {
      console.error('Error updating group settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return <></>;
  }

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title={
        <Group justify="space-between" wrap="nowrap" w="100%">
          <span>Source import</span>
          <Button
            size="xs"
            aria-label="Developer mode"
            variant={developerMode ? 'filled' : 'default'}
            color={developerMode ? 'yellow' : 'gray'}
            onClick={() => toggleDeveloperMode(!developerMode)}
          >
            Developer mode
          </Button>
        </Group>
      }
      size="90vw"
      styles={{
        content: {
          '--mantine-color-body': '#27272A',
          height: '92vh',
          overflowX: 'hidden',
        },
        body: {
          height: 'calc(92vh - 60px)',
          overflowX: 'hidden',
        },
        title: { flex: 1 },
      }}
      scrollAreaComponent={Modal.NativeScrollArea}
      lockScroll={false}
      withinPortal={true}
      yOffset="4vh"
    >
      <LoadingOverlay visible={isLoading} overlayBlur={2} />
      <Stack mih="100%">
        <Tabs value={activeTab} onChange={setActiveTab}>
          <TabsList>
            <TabsTab value="live">Live</TabsTab>
            <TabsTab value="vod-movie">VOD - Movies</TabsTab>
            <TabsTab value="vod-series">VOD - Series</TabsTab>
            <TabsTab value="raw-data" disabled={!developerMode}>
              Raw Data
            </TabsTab>
          </TabsList>

          <TabsPanel value="live">
            <LiveGroupFilter
              playlist={playlist}
              groupStates={groupStates}
              setGroupStates={setGroupStates}
            />
          </TabsPanel>

          <TabsPanel value="vod-movie">
            <VODCategoryFilter
              playlist={playlist}
              categoryStates={movieCategoryStates}
              setCategoryStates={setMovieCategoryStates}
              type="movie"
            />
          </TabsPanel>

          <TabsPanel value="vod-series">
            <VODCategoryFilter
              playlist={playlist}
              categoryStates={seriesCategoryStates}
              setCategoryStates={setSeriesCategoryStates}
              type="series"
            />
          </TabsPanel>

          <TabsPanel value="raw-data">
            {developerMode && <M3UDeveloperCatalog accountId={playlist.id} />}
          </TabsPanel>
        </Tabs>

        <Flex mih={50} gap="xs" justify="flex-end" align="flex-end">
          <Button variant="default" onClick={onClose} size="xs">
            Cancel
          </Button>
          <Button
            type="submit"
            variant="filled"
            color="blue"
            disabled={isLoading}
            onClick={submit}
          >
            Save and Refresh
          </Button>
        </Flex>
      </Stack>
    </Modal>
  );
};

export default M3UGroupFilter;
