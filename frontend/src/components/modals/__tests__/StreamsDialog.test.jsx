import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import StreamsDialog from '../StreamsDialog';

vi.mock('../../tables/StreamsTable', () => ({
  default: () => <div data-testid="streams-table">StreamsTable</div>,
}));

describe('StreamsDialog', () => {
  it('loads the streams table only while open', async () => {
    const { rerender } = render(
      <MantineProvider>
        <StreamsDialog opened={false} onClose={vi.fn()} />
      </MantineProvider>
    );
    expect(screen.queryByTestId('streams-table')).not.toBeInTheDocument();
    rerender(
      <MantineProvider>
        <StreamsDialog opened onClose={vi.fn()} />
      </MantineProvider>
    );
    expect(await screen.findByTestId('streams-table')).toBeInTheDocument();
    expect(screen.getByText(/Manual streams account/)).toBeInTheDocument();
  });
});
