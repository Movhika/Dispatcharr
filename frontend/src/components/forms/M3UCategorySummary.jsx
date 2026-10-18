import { Group, Paper, Stack, Text } from '@mantine/core';

const M3UCategorySummary = ({ account, showCounts = true, children }) => {
  const savedCounts = account.category_selection_counts;
  const live = account.channel_groups || [];
  const counts = [
    {
      label: 'Live TV',
      ...(savedCounts?.live || {
        selected: live.filter((row) => row.enabled).length,
        total: live.length,
      }),
    },
    ...(account.account_type === 'XC' && account.enable_vod
      ? ['movie', 'series'].map((type) => ({
          label: type === 'movie' ? 'Movies' : 'Series',
          ...(savedCounts?.[type] || { selected: 0, total: 0 }),
        }))
      : []),
  ];

  return (
    <Paper
      withBorder
      p="sm"
      component="section"
      aria-label="Category selection"
    >
      <Stack gap="sm">
        <Text fw={600}>Categories</Text>
        {showCounts &&
          counts.map(({ label, selected, total }) => (
            <Group key={label} justify="space-between">
              <Text size="sm">{label}</Text>
              <Text size="sm" c="dimmed">
                {selected} of {total} categories selected
              </Text>
            </Group>
          ))}
        {children}
      </Stack>
    </Paper>
  );
};

export default M3UCategorySummary;
