import { notifications } from '@mantine/notifications';

export function showNotification(notificationObject) {
  return notifications.show(notificationObject);
}

export function updateNotification(notificationId, notificationObject) {
  return notifications.update({ ...notificationObject, id: notificationId });
}

export function hideNotification(notificationId) {
  return notifications.hide(notificationId);
}
