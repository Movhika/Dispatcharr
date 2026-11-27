import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import StreamTestSettingsForm from '../StreamTestSettingsForm';
import API from '../../../../api';

vi.mock('../../../../api', () => ({
  default: { getStreamTestSettings: vi.fn(), saveStreamTestSettings: vi.fn() },
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

describe('StreamTestSettingsForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves the frame rate limit and sample length', async () => {
    API.getStreamTestSettings.mockResolvedValue({
      low_fps: 20,
      sample_seconds: 6,
      sort: 'quality',
    });
    API.saveStreamTestSettings.mockImplementation(async (values) => values);
    render(
      <MantineProvider>
        <StreamTestSettingsForm />
      </MantineProvider>
    );
    const fps = await screen.findByLabelText('Low frame rate below (fps)');
    expect(fps).toHaveValue('20');
    fireEvent.change(fps, { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/Sample length/), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(API.saveStreamTestSettings).toHaveBeenCalledWith({
        low_fps: 25,
        sample_seconds: 10,
        sort: 'quality',
      })
    );
  });
});
