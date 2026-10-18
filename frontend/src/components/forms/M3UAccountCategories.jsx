import { useEffect, useRef, useState } from 'react';
import useChannelsStore from '../../store/channels';
import {
  hideNotification,
  showNotification,
} from '../../utils/notificationUtils.js';
import { formatApiError } from '../../utils';
import M3UCategorySummary from './M3UCategorySummary.jsx';

const M3UAccountCategories = ({ account, onEdit }) => {
  const [opening, setOpening] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const edit = async (tab) => {
    if (opening) return;
    setOpening(tab);
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
        onEdit(account, tab);
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
      if (mounted.current) setOpening(null);
    }
  };

  return (
    <M3UCategorySummary account={account} onEdit={edit} opening={opening} />
  );
};

export default M3UAccountCategories;
