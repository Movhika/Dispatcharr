import React from 'react';
import {
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from '@mantine/core';

const VODSourcePreviewTable = ({
  rows = [],
  loading = false,
  getRowKey = (row) => row.id,
  getProviderTitle = (row) => row.provider_title || row.name || '',
  getCanonicalTitle = null,
  getProviderName = null,
  getCategoryName = null,
  emptyText = 'No imported content found.',
  minWidth = 420,
}) => {
  const showCanonical = typeof getCanonicalTitle === 'function';
  const showOrigin =
    typeof getProviderName === 'function' ||
    typeof getCategoryName === 'function';
  const columnCount = 1 + Number(showCanonical) + Number(showOrigin);

  return (
    <Table striped highlightOnHover withTableBorder stickyHeader miw={minWidth}>
      <TableThead>
        <TableTr>
          <TableTh>Provider title</TableTh>
          {showCanonical && <TableTh>Canonical title</TableTh>}
          {showOrigin && <TableTh>Provider / category</TableTh>}
        </TableTr>
      </TableThead>
      <TableTbody>
        {rows.map((row) => (
          <TableTr key={getRowKey(row)}>
            <TableTd>{getProviderTitle(row) || '—'}</TableTd>
            {showCanonical && (
              <TableTd>{getCanonicalTitle(row) || '—'}</TableTd>
            )}
            {showOrigin && (
              <TableTd>
                <Text size="sm">{getProviderName?.(row) || '—'}</Text>
                <Text size="xs" c="dimmed">
                  {getCategoryName?.(row) || 'Uncategorized'}
                </Text>
              </TableTd>
            )}
          </TableTr>
        ))}
        {!loading && rows.length === 0 && (
          <TableTr>
            <TableTd colSpan={columnCount}>
              <Text ta="center" c="dimmed" py="lg">
                {emptyText}
              </Text>
            </TableTd>
          </TableTr>
        )}
      </TableTbody>
    </Table>
  );
};

export default VODSourcePreviewTable;
