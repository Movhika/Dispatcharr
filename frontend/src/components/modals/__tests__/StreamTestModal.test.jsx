import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import StreamTestModal from '../StreamTestModal';
import API from '../../../api';

vi.mock('../../../api', () => ({
  default: { testChannelStreams: vi.fn() },
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const renderModal = (props = {}) =>
  render(
    <MantineProvider>
      <StreamTestModal
        opened
        onClose={vi.fn()}
        channelIds={[4, 9]}
        {...props}
      />
    </MantineProvider>
  );

describe('StreamTestModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts a test with the chosen sorting', async () => {
    const onClose = vi.fn();
    API.testChannelStreams.mockResolvedValue({ message: 'Testing 2' });
    renderModal({ onClose });
    expect(screen.getByLabelText(/Best quality first/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/Fastest start first/));
    fireEvent.change(screen.getByLabelText('Low frame rate below (fps)'), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(API.testChannelStreams).toHaveBeenCalledWith([4, 9], 'startup', 12);
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
