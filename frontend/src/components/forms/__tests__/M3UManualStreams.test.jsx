import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import M3UManualStreams from '../M3UManualStreams';
import API from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    getManualStreams: vi.fn(),
    saveManualStream: vi.fn(),
    deleteManualStream: vi.fn(),
  },
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const STREAM = {
  id: 5,
  name: 'Webcam Harbour',
  url: 'rtsp://cam.example.test/harbour',
  category: 'Webcams',
  logo_url: null,
  tvg_id: null,
  stream_chno: null,
};

const renderStreams = () =>
  render(
    <MantineProvider>
      <M3UManualStreams account={{ id: 9, name: 'My streams' }} />
    </MantineProvider>
  );

describe('M3UManualStreams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getManualStreams.mockResolvedValue([STREAM]);
  });

  it('lists streams and adds one in an existing category', async () => {
    API.saveManualStream.mockResolvedValue({ ...STREAM, id: 6 });
    renderStreams();
    expect(await screen.findByText('Webcam Harbour')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add stream' }));
    expect(screen.getByRole('textbox', { name: /Category/ })).toHaveValue(
      'Webcams'
    );
    fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Webcam Beach' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Stream URL/ }), {
      target: { value: 'http://cam.example.test/beach.m3u8' },
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Add stream' }).at(-1)
    );
    await waitFor(() =>
      expect(API.saveManualStream).toHaveBeenCalledWith(
        9,
        undefined,
        expect.objectContaining({
          name: 'Webcam Beach',
          url: 'http://cam.example.test/beach.m3u8',
          category: 'Webcams',
          logo_url: null,
        })
      )
    );
    await waitFor(() => expect(API.getManualStreams).toHaveBeenCalledTimes(2));
  });

  it('shows field errors next to their field', async () => {
    const error = new Error('HTTP error! Status: 400');
    error.status = 400;
    error.body = { url: ['Enter a stream URL.'] };
    API.saveManualStream.mockRejectedValue(error);
    renderStreams();
    fireEvent.click(await screen.findByLabelText('Edit Webcam Harbour'));
    fireEvent.click(screen.getByRole('button', { name: 'Save stream' }));
    expect(await screen.findByText('Enter a stream URL.')).toBeInTheDocument();
    expect(API.saveManualStream).toHaveBeenCalledWith(
      9,
      5,
      expect.objectContaining({ name: 'Webcam Harbour' })
    );
  });

  it('asks before deleting a stream', async () => {
    API.deleteManualStream.mockResolvedValue({});
    renderStreams();
    fireEvent.click(await screen.findByLabelText('Delete Webcam Harbour'));
    expect(
      await screen.findByText(/Channels lose this stream/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(API.deleteManualStream).toHaveBeenCalledWith(9, 5)
    );
  });
});
