import { useEffect, useRef, useState } from 'react';
import {
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  Radio,
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

const M3UAccountEPG = ({
  account,
  active = true,
  choice,
  onChoice,
  disabled = false,
}) => {
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);
  const creatingRef = useRef(false);
  const fetchEPGs = useEPGsStore((s) => s.fetchEPGs);

  useEffect(() => {
    if (!active || !account?.id || account.account_type !== 'XC') return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    API.getM3UEPG(account.id)
      .then((result) => {
        if (!cancelled) {
          setSource(result.source);
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
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const result = await API.createM3UEPG(account.id);
      setSource(result.source);
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
    }
  };

  return (
    <Paper withBorder p="sm">
      <Stack gap="sm">
        <Text fw={600}>EPG source</Text>
        {account.account_type !== 'XC' ? (
          <Text size="sm" c="dimmed">
            Automatic EPG creation is available for Xtream Codes accounts. Add a
            separate guide in EPG Sources for M3U URL or file accounts.
          </Text>
        ) : (
          <>
            {loading ? (
              <Text size="sm" c="dimmed">
                Loading EPG source…
              </Text>
            ) : failed ? (
              <Button
                variant="default"
                onClick={() => setReload((value) => value + 1)}
              >
                Retry
              </Button>
            ) : source ? (
              <>
                <Group gap="xs">
                  <Text>{source.name}</Text>
                  <Badge
                    color={source.is_active ? 'green' : 'gray'}
                    variant="light"
                  >
                    {source.is_active ? 'Enabled' : 'Disabled'}
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed">
                  This XMLTV source matches the saved provider connection.
                </Text>
              </>
            ) : (
              <Text size="sm" c="dimmed">
                No matching EPG source configured.
              </Text>
            )}
            {onChoice ? (
              <Radio.Group label="EPG setup" value={choice} onChange={onChoice}>
                <Stack gap="xs" mt="xs">
                  <Radio
                    value="create_epg"
                    label={source ? 'Use existing EPG' : 'Create EPG'}
                    description="Use the saved provider connection for the XMLTV guide."
                    disabled={disabled}
                  />
                  <Radio
                    value="skip_epg"
                    label="Skip EPG"
                    description="You can create it later in the account's EPG tab."
                    disabled={disabled}
                  />
                </Stack>
              </Radio.Group>
            ) : (
              !source &&
              !loading &&
              !failed && (
                <Group>
                  <Button
                    onClick={create}
                    loading={creating}
                    disabled={disabled}
                  >
                    Create EPG
                  </Button>
                </Group>
              )
            )}
          </>
        )}
        <Anchor component={Link} to="/sources/epg" size="sm">
          Manage EPG sources
        </Anchor>
      </Stack>
    </Paper>
  );
};

export default M3UAccountEPG;
