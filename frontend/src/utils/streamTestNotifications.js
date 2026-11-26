import { notifications } from '@mantine/notifications';
import API from '../api';

const ID = 'stream-test-progress';

const counts = (data) => {
  const problems = [
    data.black && `${data.black} black`,
    data.frozen && `${data.frozen} frozen`,
    data.low_fps && `${data.low_fps} low frame rate`,
  ].filter(Boolean);
  return (
    `${data.ok || 0} working${problems.length ? ` (${problems.join(', ')})` : ''}, ` +
    `${data.failed || 0} failed, ${data.busy || 0} skipped (no free connection)`
  );
};

// Shows the progress of a stream test run and its result.
export const handleStreamTestEvent = (type, data) => {
  if (type === 'stream_test_progress') {
    const notification = {
      id: ID,
      title: 'Testing streams',
      message: `${data.done} of ${data.total} tested: ${counts(data)}`,
      color: 'blue.5',
      autoClose: false,
      withCloseButton: false,
      loading: true,
    };
    if (data.done === 1) notifications.show(notification);
    else notifications.update(notification);
    return;
  }
  if (type === 'stream_test') {
    notifications.hide(ID);
    notifications.show({
      title: data.success ? 'Stream test complete' : 'Stream test failed',
      message: data.success
        ? `${data.total} streams: ${counts(data)}.${data.sorted ? ` ${data.sorted} channels sorted.` : ''}`
        : data.message || 'The stream test stopped.',
      color: data.success
        ? data.failed || data.black || data.frozen
          ? 'orange'
          : 'green.5'
        : 'red',
      autoClose: 10000,
    });
    if (data.success) API.requeryChannels();
  }
};
