const asyncHandler = require('../utils/asyncHandler');
const { storage } = require('../config/db');

const getNextId = (items) => (items.length ? Math.max(...items.map((item) => item.id)) + 1 : 1);

const pushNotification = ({ user_id, job_id = null, message, type = null }) => {
  const notification = {
    id: getNextId(storage.notifications),
    user_id: user_id || null,
    job_id,
    type,
    message,
    read: false,
    created_at: new Date(),
  };
  storage.notifications.push(notification);
  return notification;
};

const listNotifications = asyncHandler(async (req, res) => {
  const notifications = storage.notifications.filter((item) => item.user_id === req.user?.id || item.user_id === null);
  res.status(200).json({
    success: true,
    count: notifications.length,
    data: notifications,
  });
});

const markAsRead = asyncHandler(async (req, res) => {
  const notificationId = Number(req.params.id);
  const notification = storage.notifications.find((item) => item.id === notificationId && item.user_id === req.user?.id);

  if (!notification) {
    return res.status(404).json({
      success: false,
      message: 'Notification not found',
    });
  }

  notification.read = true;
  res.status(200).json({
    success: true,
    message: 'Notification marked as read',
    data: notification,
  });
});

const markAllAsRead = asyncHandler(async (req, res) => {
  storage.notifications.forEach((item) => {
    if (item.user_id === req.user?.id) {
      item.read = true;
    }
  });

  res.status(200).json({
    success: true,
    message: 'All notifications marked as read',
  });
});

module.exports = {
  listNotifications,
  markAsRead,
  markAllAsRead,
  pushNotification,
};
