import { createElement } from 'react';
import {
  Button,
  Group,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { Clapperboard, Film, Tv } from 'lucide-react';
import classes from './M3UAccountSummary.module.css';

const M3UCategorySummary = ({
  account,
  showCounts = true,
  onEdit,
  opening = false,
  editLabel = 'Edit selection',
  editDisabled = false,
  children,
}) => {
  const savedCounts = account.category_selection_counts;
  const live = account.channel_groups || [];
  const custom = account.custom_properties || {};
  const counts = [
    {
      label: 'Live TV',
      tab: 'live',
      icon: Tv,
      unit: 'streams',
      entries: custom.live_catalog_counts,
      ...(savedCounts?.live || {
        selected: live.filter((row) => row.enabled).length,
        total: live.length,
      }),
    },
    ...(account.account_type === 'XC' && account.enable_vod
      ? ['movie', 'series'].map((type) => ({
          label: type === 'movie' ? 'Movies' : 'Series',
          tab: `vod-${type}`,
          icon: type === 'movie' ? Film : Clapperboard,
          unit: type === 'movie' ? 'movies' : 'series',
          entries:
            custom.vod_catalog_counts?.[type === 'movie' ? 'movies' : 'series'],
          ...(savedCounts?.[type] || { selected: 0, total: 0 }),
        }))
      : []),
  ];

  return (
    <section aria-label="Category selection">
      <Stack gap="sm">
        {showCounts ? (
          <div className={classes.categoryGrid}>
            {counts.map(
              ({ label, tab, icon, selected, total, unit, entries }) => (
                <Paper
                  key={tab}
                  component="article"
                  aria-label={`${label} categories`}
                  withBorder
                  radius="md"
                  p="md"
                  className={`${classes.card} ${classes.categoryCard}`}
                >
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon variant="light" size="lg" radius="md">
                      {createElement(icon, { size: 20, 'aria-hidden': true })}
                    </ThemeIcon>
                    <Text fw={600} className={classes.cardHeading}>
                      {label}
                    </Text>
                  </Group>
                  <Text size="lg" fw={600} className={classes.count}>
                    {selected} of {total} categories selected
                  </Text>
                  <Tooltip
                    label={
                      entries
                        ? 'Provider entries / imported entries from the last successful refresh'
                        : 'Entry counts are available after the first successful import'
                    }
                    multiline
                    w={280}
                  >
                    <div>
                      <Text size="xs" c="dimmed">
                        Provider / imported {unit}
                      </Text>
                      <Text size="sm" className={classes.count}>
                        {entries
                          ? `${entries.provider_total} / ${entries.selected_total}`
                          : '— / —'}
                      </Text>
                    </div>
                  </Tooltip>
                </Paper>
              )
            )}
          </div>
        ) : (
          <Text fw={600}>Categories</Text>
        )}
        {onEdit && (
          <Paper
            withBorder
            radius="md"
            p="sm"
            component="section"
            aria-label="Category selection actions"
            className={classes.selectionActions}
          >
            <Button
              variant="default"
              onClick={onEdit}
              loading={opening}
              disabled={editDisabled}
            >
              {editLabel}
            </Button>
          </Paper>
        )}
        {children}
      </Stack>
    </section>
  );
};

export default M3UCategorySummary;
