import { useEffect, useRef, useState } from 'react';
import { Button, Group } from '@mantine/core';
import useChannelsStore from '../../store/channels';
import useVODStore from '../../store/useVODStore';
import {
  hideNotification,
  showNotification,
} from '../../utils/notificationUtils.js';
import { formatApiError } from '../../utils';
import M3UCategorySummary from './M3UCategorySummary.jsx';

const M3UAccountCategories = ({ account, onEdit }) => {
  const [opening, setOpening] = useState(false);
  const mounted = useRef(true);
  const fetchCategories = useVODStore((s) => s.fetchCategories);
  const vodCategories = useVODStore((s) => s.categories);
  const loaded = useVODStore((s) => s.categoriesLoaded);
  const loading = useVODStore((s) => s.categoriesLoading);
  const error = useVODStore((s) => s.categoriesError);
  const hasVOD = account.account_type === 'XC' && account.enable_vod;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const state = useVODStore.getState();
    if (
      hasVOD &&
      !state.categoriesLoaded &&
      !state.categoriesLoading &&
      !state.categoriesError
    )
      state.fetchCategories();
  }, [hasVOD, loaded, loading, error, fetchCategories]);

  const edit = async () => {
    if (opening) return;
    setOpening(true);
    try {
      // Names are needed by the selection editor, not by this count summary.
      const missingNames = () =>
        (account.channel_groups || []).some(
          (row) => !useChannelsStore.getState().channelGroups[row.channel_group]
        );
      if (missingNames())
        await useChannelsStore.getState().fetchChannelGroups();
      if (missingNames())
        throw new Error('Category names could not be loaded. Please retry.');
      if (mounted.current) {
        hideNotification(`m3u-categories-${account.id}`);
        onEdit(account);
      }
    } catch (failure) {
      if (!mounted.current) return;
      showNotification({
        id: `m3u-categories-${account.id}`,
        title: 'Category selection could not be opened',
        message: formatApiError(failure),
        color: 'red',
        autoClose: false,
      });
    } finally {
      if (mounted.current) setOpening(false);
    }
  };

  return (
    <M3UCategorySummary
      account={account}
      vodCategories={vodCategories}
      vodReady={loaded}
    >
      <Group>
        <Button variant="default" onClick={edit} loading={opening}>
          Edit selection
        </Button>
        {hasVOD && !loaded && error && (
          <Button
            variant="default"
            onClick={fetchCategories}
            disabled={loading}
          >
            Retry
          </Button>
        )}
      </Group>
    </M3UCategorySummary>
  );
};

export default M3UAccountCategories;
