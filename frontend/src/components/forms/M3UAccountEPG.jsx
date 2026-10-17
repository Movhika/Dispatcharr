import { useEffect, useRef, useState } from 'react';
import {
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { Link } from 'react-router-dom';
import API from '../../api.js';
import useEPGsStore from '../../store/epgs';
import {
  hideNotification,
  showNotification,
} from '../../utils/notificationUtils.js';
import { formatApiError } from '../../utils';
import { format, useDateTimeFormat } from '../../utils/dateTimeUtils.js';
import { formatStatusText } from '../../utils/tables/EPGsTableUtils.js';
import SourceStatus from '../SourceStatus.jsx';
import cardClasses from '../tables/M3UsTable.module.css';

const M3UAccountEPG = ({
  account,
  active = true,
  isInitialSetup = false,
  disabled = false,
  onBusyChange,
}) => {
  const [source, setSource] = useState(null);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);
  const creatingRef = useRef(false);
  const sourceSnapshotRef = useRef(null);
  const fetchEPGs = useEPGsStore((s) => s.fetchEPGs);
  const liveSource = useEPGsStore((s) => s.epgs?.[source?.id]);
  // The detail response is fresher than a pre-existing store entry. Only
  // replace it when the store subsequently receives an actual update.
  const current =
    liveSource && liveSource !== sourceSnapshotRef.current
      ? liveSource
      : source;
  const { fullDateTimeFormat } = useDateTimeFormat();

  useEffect(() => {
    if (!active || !account?.id || account.account_type !== 'XC') return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    API.getM3UEPG(account.id)
      .then((result) => {
        if (!cancelled) {
          sourceSnapshotRef.current =
            useEPGsStore.getState().epgs?.[result.source?.id];
          setSource(result.source);
          setCanCreate(result.can_create === true);
          hideNotification(`m3u-epg-${account.id}`);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setFailed(true);
        showNotification({
          id: `m3u-epg-${account.id}`,
          title: 'EPG source could not be loaded',
          message: formatApiError(error),
          color: 'red',
          autoClose: false,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, account?.id, account?.account_type, reload]);

  const create = async () => {
    if (creatingRef.current || !canCreate || current) return;
    creatingRef.current = true;
    setCreating(true);
    onBusyChange?.(true);
    try {
      const result = await API.createM3UEPG(account.id);
      sourceSnapshotRef.current =
        useEPGsStore.getState().epgs?.[result.source?.id];
      setSource(result.source);
      setCanCreate(result.can_create === true);
      hideNotification(`m3u-epg-${account.id}`);
      fetchEPGs().catch(() => {});
    } catch (error) {
      showNotification({
        id: `m3u-epg-${account.id}`,
        title: 'EPG source was not created',
        message: formatApiError(error),
        color: 'red',
        autoClose: false,
      });
    } finally {
      creatingRef.current = false;
      setCreating(false);
      onBusyChange?.(false);
    }
  };

  if (account.account_type !== 'XC') return null;

  const status = current?.is_active === false ? 'disabled' : current?.status;
  const statusColor =
    {
      fetching: 'blue.5',
      parsing: 'indigo.5',
      error: 'red.5',
      success: 'green.5',
    }[status] || 'gray.5';

  return (
    <Paper
      component={current ? 'article' : 'section'}
      aria-label={current ? `EPG source ${current.name}` : 'EPG source'}
      className={cardClasses.card}
      withBorder
      radius="md"
      p="sm"
    >
      <Stack gap="sm">
        {loading ? (
          <Text size="sm" c="dimmed">
            Loading EPG source…
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
        ) : current ? (
          <>
            <Group gap="xs">
              <Text fw={700} truncate className={cardClasses.name}>
                {current.name}
              </Text>
              <Badge variant="light">XMLTV</Badge>
              <SourceStatus
                label={formatStatusText(status)}
                color={statusColor}
              />
            </Group>
            <div>
              <Text size="xs" fw={600} mb={4}>
                Last refresh
              </Text>
              <Text size="xs" c="dimmed">
                {current.updated_at
                  ? format(current.updated_at, fullDateTimeFormat)
                  : 'Never'}
              </Text>
            </div>
          </>
        ) : (
          <>
            <Text fw={600}>EPG source</Text>
            <Text size="sm" c="dimmed">
              {canCreate
                ? 'No matching EPG source configured.'
                : 'Complete and save the account connection before creating its EPG source.'}
            </Text>
            {canCreate && (
              <Group>
                <Button onClick={create} loading={creating} disabled={disabled}>
                  Create EPG
                </Button>
              </Group>
            )}
          </>
        )}
        {!isInitialSetup && (
          <Anchor component={Link} to="/sources/epg" size="sm">
            Manage EPG sources
          </Anchor>
        )}
      </Stack>
    </Paper>
  );
};

export default M3UAccountEPG;
