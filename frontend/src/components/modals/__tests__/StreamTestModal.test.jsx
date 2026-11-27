import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import StreamTestModal from '../StreamTestModal';
import API from '../../../api';

vi.mock('../../../api', () => ({
  default: { testChannelStreams: vi.fn(), getStreamTestSettings: vi.fn() },
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const renderModal = (props = {}) =>
  render(
    <MantineProvider>
      <MemoryRouter>
        <StreamTestModal
          opened
          onClose={vi.fn()}
          channelIds={[4, 9]}
          {...props}
        />
      </MemoryRouter>
    </MantineProvider>
  );

describe('StreamTestModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getStreamTestSettings.mockResolvedValue({
      low_fps: 25,
      sample_seconds: 10,
      sort: 'none',
    });
  });

  it('starts a test with the saved defaults and the chosen sorting', async () => {
    const onClose = vi.fn();
    API.testChannelStreams.mockResolvedValue({ message: 'Testing 2' });
    renderModal({ onClose });
    expect(
      await screen.findByText(/Samples of 10 seconds, low frame rate below 25/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Keep the order/)).toBeChecked();
    expect(
      screen.getByRole('link', { name: 'Change in Settings' })
    ).toHaveAttribute('href', '/settings#live-stream-tests');
    fireEvent.click(screen.getByLabelText(/Fastest start first/));
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(API.testChannelStreams).toHaveBeenCalledWith([4, 9], 'startup');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Stream test started' })
    );
  });

  it('keeps the dialog open when a test is already running', async () => {
    const onClose = vi.fn();
    API.testChannelStreams.mockRejectedValue(
      new Error('A stream test is already running.')
    );
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }));
    expect(await screen.findByText(/already running/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
