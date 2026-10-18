import React, { useEffect, useState } from 'react';
import M3UProfile from './M3UProfile';
import AccountInfoModal from './AccountInfoModal';
import usePlaylistsStore from '../../store/playlists';
import ConfirmationDialog from '../ConfirmationDialog';
import useWarningsStore from '../../store/warnings';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { Info, Network, SquarePen, Trash2 } from 'lucide-react';
import {
  deleteM3UProfile,
  updateM3UProfile,
} from '../../utils/forms/M3uProfileUtils.js';
import {
  getExpirationInfo,
  isAccountExpired,
  profileSortComparator,
} from '../../utils/forms/M3uProfilesUtils.js';
import cardClasses from '../tables/M3UsTable.module.css';
import summaryClasses from './M3UAccountSummary.module.css';

const M3uProfileCard = ({
  item,
  accountType,
  onClickInfo,
  onClickEdit,
  onClickDelete,
  onChangeMaxStreams,
  onChangeActive,
}) => {
  const accountStatus = item.custom_properties?.user_info?.status ?? null;
  const expirationInfo = getExpirationInfo(item);
  const expired = isAccountExpired(item);

  return (
    <Paper
      component="article"
      aria-label={`Connection profile ${item.name}`}
      className={summaryClasses.card}
      withBorder
      radius="md"
      p="md"
    >
      <div className={summaryClasses.profileRow}>
        <Stack gap={4} className={summaryClasses.profileIdentity}>
          <Group gap="xs">
            <Text fw={600}>{item.name}</Text>
            {item.is_default && (
              <Badge variant="light" color="gray">
                Default
              </Badge>
            )}
            {accountType === 'XC' &&
              item.custom_properties &&
              accountStatus && (
                <Badge
                  size="sm"
                  color={
                    accountStatus === 'Active'
                      ? 'green'
                      : expired
                        ? 'red'
                        : 'gray'
                  }
                  variant="light"
                >
                  {accountStatus}
                </Badge>
              )}
            {accountType === 'XC' &&
              item.custom_properties &&
              expirationInfo && (
                <Badge size="sm" color={expirationInfo.color} variant="light">
                  {expirationInfo.text}
                </Badge>
              )}
          </Group>
          {item.custom_properties?.notes && (
            <Text size="xs" c="dimmed">
              {item.custom_properties.notes}
            </Text>
          )}
        </Stack>
        <div className={summaryClasses.profileControls}>
          <NumberInput
            label="Max Streams"
            aria-label={`Max Streams for ${item.name}`}
            value={item.max_streams}
            disabled={item.is_default}
            onChange={onChangeMaxStreams}
            size="sm"
            w={104}
          />
          <Paper
            className={cardClasses.controls}
            withBorder
            px={6}
            py={4}
            radius="md"
            w={212}
            maw="100%"
            h="auto"
            mih={38}
            style={{ flexShrink: 1 }}
            role="group"
            aria-label={`Actions for ${item.name}`}
          >
            <Group gap="xs" justify="space-between" w="100%">
              <Switch
                checked={item.is_active}
                onChange={onChangeActive}
                disabled={item.is_default}
                label="Active"
                aria-label={`Active ${item.name}`}
                labelPosition="left"
                size="sm"
              />
              <Group gap={4} wrap="nowrap">
                {accountType === 'XC' && item.custom_properties && (
                  <Tooltip label="View account information">
                    <ActionIcon
                      variant="subtle"
                      size="md"
                      color="blue"
                      onClick={onClickInfo}
                      aria-label={`View account information for ${item.name}`}
                    >
                      <Info size={17} />
                    </ActionIcon>
                  </Tooltip>
                )}
                <Tooltip
                  label={
                    item.is_default
                      ? 'Edit profile name and notes'
                      : 'Edit profile'
                  }
                >
                  <ActionIcon
                    variant="subtle"
                    size="md"
                    color="yellow"
                    onClick={onClickEdit}
                    aria-label={
                      item.is_default
                        ? `Edit ${item.name} name and notes`
                        : `Edit ${item.name}`
                    }
                  >
                    <SquarePen size={17} />
                  </ActionIcon>
                </Tooltip>
                {!item.is_default && (
                  <Tooltip label="Delete profile">
                    <ActionIcon
                      color="red"
                      onClick={onClickDelete}
                      size="md"
                      variant="subtle"
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 size={17} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            </Group>
          </Paper>
        </div>
      </div>
    </Paper>
  );
};

const M3UProfiles = ({
  playlist = null,
  isOpen,
  onClose,
  pendingExpDate,
  embedded = false,
  onOverlayChange,
}) => {
  const allProfiles = usePlaylistsStore((s) => s.profiles);
  const fetchPlaylist = usePlaylistsStore((s) => s.fetchPlaylist);
  const isWarningSuppressed = useWarningsStore((s) => s.isWarningSuppressed);
  const suppressWarning = useWarningsStore((s) => s.suppressWarning);

  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [profileToDelete, setProfileToDelete] = useState(null);
  const [deletingProfile, setDeletingProfile] = useState(false);
  const [accountInfoOpen, setAccountInfoOpen] = useState(false);
  useEffect(() => {
    onOverlayChange?.(
      profileEditorOpen || confirmDeleteOpen || accountInfoOpen
    );
    return () => onOverlayChange?.(false);
  }, [profileEditorOpen, confirmDeleteOpen, accountInfoOpen, onOverlayChange]);
  const [selectedProfileForInfo, setSelectedProfileForInfo] = useState(null);
  // Snapshot at editor open so live main-form Date changes do not reset the form.
  const [editorPendingExpDate, setEditorPendingExpDate] = useState(undefined);

  const handleRefreshAccountInfo = async () => {
    // Refresh the playlist data to get updated account info
    if (playlist?.id) {
      await fetchPlaylist(playlist.id);
    }
  };

  useEffect(() => {
    try {
      // Make sure playlist exists, has an id, and profiles exist for this playlist
      if (playlist && playlist.id && allProfiles && allProfiles[playlist.id]) {
        setProfiles(allProfiles[playlist.id]);
      } else {
        // Reset profiles if none are available
        setProfiles([]);
      }
    } catch (error) {
      console.error('Error setting profiles:', error);
      setProfiles([]);
    }
  }, [allProfiles, playlist]);

  const editProfile = (profile = null) => {
    if (profile) {
      setProfile(profile);
    }
    setEditorPendingExpDate(pendingExpDate);
    setProfileEditorOpen(true);
  };
  const deleteProfile = async (id) => {
    if (!playlist || !playlist.id) return;

    // Get profile details for the confirmation dialog
    const profileObj = profiles.find((p) => p.id === id);
    setProfileToDelete(profileObj);
    setDeleteTarget(id);

    // Skip warning if it's been suppressed
    if (isWarningSuppressed('delete-profile')) {
      return executeDeleteProfile(id);
    }

    setConfirmDeleteOpen(true);
  };

  const executeDeleteProfile = async (id) => {
    if (!playlist || !playlist.id) return;
    setDeletingProfile(true);
    try {
      await deleteM3UProfile(playlist.id, id);
    } catch (error) {
      console.error('Error deleting profile:', error);
    } finally {
      setDeletingProfile(false);
      setConfirmDeleteOpen(false);
    }
  };

  const toggleActive = async (values) => {
    if (!playlist || !playlist.id) return;
    try {
      await updateM3UProfile(playlist.id, {
        ...values,
        is_active: !values.is_active,
      });
    } catch (error) {
      console.error('Error toggling profile active state:', error);
    }
  };

  const modifyMaxStreams = async (value, item) => {
    if (!playlist || !playlist.id) return;
    try {
      await updateM3UProfile(playlist.id, {
        ...item,
        max_streams: value,
      });
    } catch (error) {
      console.error('Error updating max streams:', error);
    }
  };

  const closeEditor = () => {
    setProfileEditorOpen(false);
    // Delay clearing the profile until after the modal animation completes
    setTimeout(() => {
      setProfile(null);
      setEditorPendingExpDate(undefined);
    }, 300); // Mantine modal animation typically takes ~200-300ms
  };

  const showAccountInfo = (profile) => {
    setSelectedProfileForInfo(profile);
    setAccountInfoOpen(true);
  };

  const closeAccountInfo = () => {
    setSelectedProfileForInfo(null);
    setAccountInfoOpen(false);
  };

  // Don't render if modal is not open, or if playlist data is invalid
  if ((!embedded && !isOpen) || !playlist || !playlist.id) {
    return <></>;
  }

  // Make sure profiles is always an array even if we have no data
  const profilesArray = Array.isArray(profiles) ? profiles : [];

  const profileList = (
    <Paper
      component="section"
      aria-label="Connection profiles"
      className={summaryClasses.card}
      withBorder
      radius="md"
      p="md"
    >
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" size="lg" radius="md">
            <Network size={20} aria-hidden="true" />
          </ThemeIcon>
          <Text fw={600} className={summaryClasses.cardHeading}>
            Connection profiles
          </Text>
        </Group>
        <Stack gap="sm">
          {[...profilesArray].sort(profileSortComparator).map((item) => {
            return (
              <M3uProfileCard
                key={item.id}
                item={item}
                accountType={playlist?.account_type}
                onClickInfo={() => showAccountInfo(item)}
                onChangeMaxStreams={(value) => modifyMaxStreams(value, item)}
                onChangeActive={() => toggleActive(item)}
                onClickEdit={() => editProfile(item)}
                onClickDelete={() => deleteProfile(item.id)}
              />
            );
          })}
        </Stack>
        <section
          aria-label="Connection profile actions"
          className={summaryClasses.selectionActions}
        >
          <Button variant="filled" onClick={() => editProfile()}>
            Add connection profile
          </Button>
        </section>
      </Stack>
    </Paper>
  );

  return (
    <>
      {embedded ? (
        profileList
      ) : (
        <Modal
          opened={isOpen}
          onClose={onClose}
          title="Connection Profiles"
          scrollAreaComponent={Modal.NativeScrollArea}
          lockScroll={false}
          withinPortal={true}
          yOffset="2vh"
        >
          {profileList}
        </Modal>
      )}

      <M3UProfile
        m3u={playlist}
        profile={profile}
        isOpen={profileEditorOpen}
        onClose={closeEditor}
        pendingExpDate={editorPendingExpDate}
      />
      <ConfirmationDialog
        opened={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => executeDeleteProfile(deleteTarget)}
        loading={deletingProfile}
        title="Confirm Profile Deletion"
        message={
          profileToDelete ? (
            <div style={{ whiteSpace: 'pre-line' }}>
              {`Are you sure you want to delete the following profile?

Name: ${profileToDelete.name}
Max Streams: ${profileToDelete.max_streams}

This action cannot be undone.`}
            </div>
          ) : (
            'Are you sure you want to delete this profile? This action cannot be undone.'
          )
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        actionKey="delete-profile"
        onSuppressChange={suppressWarning}
        size="md"
      />
      <AccountInfoModal
        isOpen={accountInfoOpen}
        onClose={closeAccountInfo}
        profile={selectedProfileForInfo}
        onRefresh={handleRefreshAccountInfo}
      />
    </>
  );
};

export default M3UProfiles;
