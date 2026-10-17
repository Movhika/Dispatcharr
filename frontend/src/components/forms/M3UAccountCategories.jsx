import { useEffect, useState } from 'react';
import { Button, Group, Text } from '@mantine/core';
import API from '../../api.js';
import useChannelsStore from '../../store/channels';
import useVODStore from '../../store/useVODStore';
import {
  hideNotification,
  showNotification,
} from '../../utils/notificationUtils.js';
import { formatApiError } from '../../utils';
import M3UCategorySummary from './M3UCategorySummary.jsx';

const M3UAccountCategories = ({ account, refreshKey = 0, onEdit }) => {
  const [current, setCurrent] = useState(account);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const fetchChannelGroups = useChannelsStore((s) => s.fetchChannelGroups);
  const fetchCategories = useVODStore((s) => s.fetchCategories);
  const vodCategories = useVODStore((s) => s.categories);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setFailed(false);
      try {
        const [saved] = await Promise.all([
          API.getPlaylist(account.id),
          fetchChannelGroups(),
        ]);
        if (!saved) {
          if (!cancelled) setFailed(true);
          return;
        }
        const groups = useChannelsStore.getState().channelGroups;
        if (
          (saved.channel_groups || []).some((row) => !groups[row.channel_group])
        )
          throw new Error('Category names could not be loaded. Please retry.');
        if (saved.account_type === 'XC' && saved.enable_vod) {
          await fetchCategories();
          if (useVODStore.getState().categoriesError)
            throw new Error(
              'VOD categories could not be loaded. Please retry.'
            );
        }
        if (!cancelled) {
          setCurrent(saved);
          hideNotification(`m3u-categories-${account.id}`);
        }
      } catch (error) {
        if (!cancelled) {
          setFailed(true);
          showNotification({
            id: `m3u-categories-${account.id}`,
            title: 'Category selection could not be loaded',
            message: formatApiError(error),
            color: 'red',
            autoClose: false,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [account.id, refreshKey, reload, fetchChannelGroups, fetchCategories]);

  return (
    <M3UCategorySummary
      account={current}
      vodCategories={vodCategories}
      showCounts={!loading && !failed}
    >
      {loading ? (
        <Text size="sm" c="dimmed">
          Loading category selection…
        </Text>
      ) : failed ? (
        <Group>
          <Button
            variant="default"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry
          </Button>
        </Group>
      ) : (
        <>
          <Text size="sm" c="dimmed">
            Refresh actions use the saved category selection.
          </Text>
          <Group>
            <Button variant="default" onClick={() => onEdit(current)}>
              Edit selection
            </Button>
          </Group>
        </>
      )}
    </M3UCategorySummary>
  );
};

export default M3UAccountCategories;
