import React, { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { RefreshCw } from 'lucide-react';
import { VOD_PROFILE_REBUILD_EVENT } from '../utils/vodProfileUpdates.js';

const VODProfileRebuildNotice = ({ onOpenProfiles }) => {
  const [profilesAffected, setProfilesAffected] = useState(0);

  useEffect(() => {
    const showNotice = (event) => {
      setProfilesAffected(Number(event?.detail?.profilesAffected || 0));
    };
    window.addEventListener(VOD_PROFILE_REBUILD_EVENT, showNotice);
    return () =>
      window.removeEventListener(VOD_PROFILE_REBUILD_EVENT, showNotice);
  }, []);

  const close = () => setProfilesAffected(0);
  const openProfiles = () => {
    close();
    onOpenProfiles?.();
  };

  return (
    <Modal
      opened={profilesAffected > 0}
      onClose={close}
      title="Output profile rebuild required"
      centered
    >
      <Stack>
        <Alert color="yellow" icon={<RefreshCw size={17} />}>
          {profilesAffected === 1
            ? 'One prepared output profile is now outdated.'
            : `${profilesAffected} prepared output profiles are now outdated.`}
        </Alert>
        <Text size="sm">
          The saved VOD data is available in management immediately. Clients
          continue receiving each last completed profile catalog until its
          rebuild finishes. The change will be included in the next rebuild.
          Start it from Output profiles when you want the change published.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Later
          </Button>
          <Button leftSection={<RefreshCw size={15} />} onClick={openProfiles}>
            Open output profiles
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default VODProfileRebuildNotice;
