import { Group, Pagination, Select, Text } from '@mantine/core';

const ListPagination = ({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}) => (
  <Group gap="xs" justify="center" wrap="wrap">
    <Text size="xs">Rows</Text>
    <Select
      aria-label="Rows per page"
      size="xs"
      value={String(pageSize)}
      onChange={(value) => onPageSizeChange(Number(value))}
      data={[10, 25, 50, 100].map((value) => ({
        value: String(value),
        label: String(value),
      }))}
      allowDeselect={false}
      w={70}
    />
    {total > 0 && (
      <Pagination
        value={page}
        onChange={onPageChange}
        total={Math.max(1, Math.ceil(total / pageSize))}
        size="xs"
        withEdges
      />
    )}
    <Text size="xs" c="dimmed">
      {total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)}{' '}
      of {total}
    </Text>
  </Group>
);

export default ListPagination;
