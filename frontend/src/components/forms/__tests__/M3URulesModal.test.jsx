import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
import M3URulesModal from '../M3URulesModal.jsx';

vi.mock('../M3URulesEditor.jsx', () => ({
  default: ({ onStateChange }) => (
    <>
      <button onClick={() => onStateChange({ dirty: true, busy: false })}>
        Edit a row
      </button>
      <button onClick={() => onStateChange({ dirty: false, busy: false })}>
        Save row
      </button>
      <button onClick={() => onStateChange({ dirty: true, busy: true })}>
        Start saving
      </button>
      <button
        onClick={() =>
          onStateChange({ dirty: false, busy: false, overlayOpen: true })
        }
      >
        Open preview
      </button>
    </>
  ),
}));

const Harness = () => {
  const [opened, setOpened] = useState(true);
  return (
    <MantineProvider>
      <M3URulesModal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Import rules"
        accountId={7}
      />
    </MantineProvider>
  );
};

describe('rule dialog unsaved changes', () => {
  it('asks before discarding, supports keep editing and marks already saved changes as retained', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Edit a row'));
    fireEvent.click(screen.getByLabelText('Close modal'));
    await screen.findByText('Unsaved changes');
    expect(
      screen.getByText(/Already saved changes will be kept/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Keep editing'));
    await waitFor(() =>
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    );
    expect(screen.getByText('Edit a row')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close modal'));
    await screen.findByText('Unsaved changes');
    fireEvent.click(screen.getByText('Discard'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  });

  it('closes directly after saving and prevents closing during a request', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Start saving'));
    expect(screen.getByLabelText('Close modal')).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save row'));
    fireEvent.click(screen.getByLabelText('Close modal'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('does not close the editor when Escape belongs to a nested dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open preview'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });
});
