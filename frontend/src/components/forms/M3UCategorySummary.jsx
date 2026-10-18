import { Group, Paper, Stack, Text } from '@mantine/core';

const M3UCategorySummary = ({
  account,
  vodCategories,
  showCounts = true,
  vodReady = true,
  children,
}) => {
  const counts = [
    { label: 'Live TV', rows: account.channel_groups || [] },
    ...(account.account_type === 'XC' && account.enable_vod
      ? ['movie', 'series'].map((type) => ({
          label: type === 'movie' ? 'Movies' : 'Series',
          pending: !vodReady,
          rows: Object.values(vodCategories || {})
            .filter((category) => category.category_type === type)
            .flatMap((category) =>
              (category.m3u_accounts || []).filter(
                (relation) => relation.m3u_account === account.id
              )
            ),
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
          counts.map(({ label, rows, pending }) => (
            <Group key={label} justify="space-between">
              <Text size="sm">{label}</Text>
              <Text size="sm" c="dimmed" aria-busy={pending || undefined}>
                {pending ? (
                  '…'
                ) : (
                  <>
                    {rows.filter((row) => row.enabled).length} of {rows.length}{' '}
                    categories selected
                  </>
                )}
              </Text>
            </Group>
          ))}
        {children}
      </Stack>
    </Paper>
  );
};

export default M3UCategorySummary;
