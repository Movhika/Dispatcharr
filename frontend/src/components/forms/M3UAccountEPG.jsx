import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Group, Paper, Stack, Text } from '@mantine/core';
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
import editorClasses from './AccountEditor.module.css';

const EPGSourceSummary = ({ source, dateFormat, matching = false }) => {
  const status = source.is_active === false ? 'disabled' : source.status;
  const statusColor =
    {
      fetching: 'blue.5',
      parsing: 'indigo.5',
      error: 'red.5',
      success: 'green.5',
    }[status] || 'gray.5';
  const type =
    {
      xmltv: 'XMLTV',
      schedules_direct: 'Schedules Direct',
      dummy: 'Custom Dummy',
    }[source.source_type] ||
    source.source_type ||
    'XMLTV';
  return (
    <Stack gap="sm">
      {matching && (
        <Text size="xs" c="dimmed">
          Matching EPG source
        </Text>
      )}
      <Group gap="xs">
        <Text fw={700} truncate className={cardClasses.name}>
          {source.name}
        </Text>
        <Badge variant="light">{type}</Badge>
        <SourceStatus label={formatStatusText(status)} color={statusColor} />
      </Group>
      <div>
        <Text size="xs" fw={600} mb={4}>
          Last refresh
        </Text>
        <Text size="xs" c="dimmed">
          {source.updated_at ? format(source.updated_at, dateFormat) : 'Never'}
        </Text>
      </div>
    </Stack>
  );
};

const M3UAccountEPG = ({
  account,
  active = true,
  isInitialSetup = false,
  disabled = false,
  onBusyChange,
  onBack,
  onNext,
}) => {
  const [source, setSource] = useState(null);
  const [otherSources, setOtherSources] = useState([]);
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
          setOtherSources(result.other_sources || []);
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
      setOtherSources(result.other_sources || []);
      setCanCreate(result.can_create === true);
      hideNotification(`m3u-epg-${account.id}`);
      fetchEPGs().catch(() => {});
      if (isInitialSetup) await onNext?.();
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

  const card = (
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
          <EPGSourceSummary
            source={current}
            dateFormat={fullDateTimeFormat}
            matching={isInitialSetup}
          />
        ) : (
          <>
            <Text fw={600}>
              {isInitialSetup ? 'Matching EPG source' : 'EPG source'}
            </Text>
            <Text size="sm" c="dimmed">
              {canCreate
                ? 'No matching EPG source configured.'
                : 'Complete and save the account connection before creating its EPG source.'}
            </Text>
            {canCreate && !isInitialSetup && (
              <Group>
                <Button onClick={create} loading={creating} disabled={disabled}>
                  Create EPG
                </Button>
              </Group>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );

  if (!isInitialSetup) return card;
  return (
    <>
      <div className={editorClasses.setupPanel}>
        <Stack gap="md">
          {card}
          {!loading && !failed && otherSources.length > 0 && (
            <section aria-label="Other configured EPG sources">
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  Other configured EPG sources
                </Text>
                <Text size="xs" c="dimmed">
                  These sources may cover the channels you need. Matching
                  depends on their channel IDs.
                </Text>
                {otherSources.map((other) => (
                  <Paper
                    key={other.id}
                    component="article"
                    aria-label={`EPG source ${other.name}`}
                    className={cardClasses.card}
                    withBorder
                    radius="md"
                    p="sm"
                  >
                    <EPGSourceSummary
                      source={other}
                      dateFormat={fullDateTimeFormat}
                    />
                  </Paper>
                ))}
              </Stack>
            </section>
          )}
        </Stack>
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
          disabled={disabled || creating}
          onClick={onBack}
        >
          Back
        </Button>
        <Group gap="xs">
          {current ? (
            <Button disabled={disabled || creating || loading} onClick={onNext}>
              Next
            </Button>
          ) : (
            <>
              <Button
                variant="default"
                disabled={disabled || creating || loading}
                onClick={onNext}
              >
                Skip EPG
              </Button>
              <Button
                onClick={create}
                loading={creating}
                disabled={disabled || loading || failed || !canCreate}
              >
                Create EPG
              </Button>
            </>
          )}
        </Group>
      </Group>
    </>
  );
};

export default M3UAccountEPG;
