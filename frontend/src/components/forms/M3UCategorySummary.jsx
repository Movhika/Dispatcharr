import { createElement } from 'react';
import {
  Button,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { ArrowRight, Clapperboard, Film, Tv } from 'lucide-react';
import classes from './M3UAccountSummary.module.css';

const M3UCategorySummary = ({
  account,
  showCounts = true,
  onEdit,
  opening = null,
  children,
}) => {
  const savedCounts = account.category_selection_counts;
  const live = account.channel_groups || [];
  const counts = [
    {
      label: 'Live TV',
      tab: 'live',
      icon: Tv,
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
          ...(savedCounts?.[type] || { selected: 0, total: 0 }),
        }))
      : []),
  ];

  return (
    <section aria-label="Category selection">
      <Stack gap="sm">
        {showCounts ? (
          <div className={classes.categoryGrid}>
            {counts.map(({ label, tab, icon, selected, total }) => (
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
                <Progress
                  value={total > 0 ? (selected / total) * 100 : 0}
                  size={5}
                  radius="xl"
                  aria-label={`Selected ${label} categories`}
                />
                {onEdit && (
                  <Button
                    variant="default"
                    className={classes.editButton}
                    rightSection={<ArrowRight size={16} aria-hidden="true" />}
                    aria-label={`Edit ${label} categories`}
                    loading={opening === tab}
                    disabled={opening !== null}
                    onClick={() => onEdit(tab)}
                  >
                    Edit selection
                  </Button>
                )}
              </Paper>
            ))}
          </div>
        ) : (
          <Text fw={600}>Categories</Text>
        )}
        {children}
      </Stack>
    </section>
  );
};

export default M3UCategorySummary;
