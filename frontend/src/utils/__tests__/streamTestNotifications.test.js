import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifications } from '@mantine/notifications';
import API from '../../api';
import { handleStreamTestEvent } from '../streamTestNotifications';

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn(), update: vi.fn(), hide: vi.fn() },
}));

vi.mock('../../api', () => ({ default: { requeryChannels: vi.fn() } }));

describe('handleStreamTestEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows progress first and updates it afterwards', () => {
    const progress = { done: 1, total: 3, ok: 1, failed: 0, busy: 0 };
    handleStreamTestEvent('stream_test_progress', progress);
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'stream-test-progress',
        message:
          '1 of 3 tested: 1 working, 0 failed, 0 skipped (no free connection)',
      })
    );
    handleStreamTestEvent('stream_test_progress', { ...progress, done: 2 });
    expect(notifications.update).toHaveBeenCalledTimes(1);
  });

  it('reports the result and reloads channels after success', () => {
    handleStreamTestEvent('stream_test', {
      success: true,
      total: 3,
      ok: 2,
      failed: 1,
      busy: 0,
      sorted: 2,
    });
    expect(notifications.hide).toHaveBeenCalledWith('stream-test-progress');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Stream test complete',
        color: 'orange',
        message: expect.stringContaining('2 channels sorted.'),
      })
    );
    expect(API.requeryChannels).toHaveBeenCalled();
  });

  it('names picture problems of working streams', () => {
    handleStreamTestEvent('stream_test', {
      success: true,
      total: 4,
      ok: 4,
      failed: 0,
      busy: 0,
      black: 1,
      frozen: 0,
      low_fps: 2,
      sorted: 0,
    });
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'orange',
        message:
          '4 streams: 4 working (1 black, 2 low frame rate), 0 failed, 0 skipped (no free connection).',
      })
    );
  });

  it('reports a failed run without reloading', () => {
    handleStreamTestEvent('stream_test', { success: false, message: 'boom' });
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Stream test failed', message: 'boom' })
    );
    expect(API.requeryChannels).not.toHaveBeenCalled();
  });
});
