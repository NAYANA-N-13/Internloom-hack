const asyncHandler = require('../utils/asyncHandler');
const { storage } = require('../config/db');

const parseBoolean = (value) => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
};

const listNotifications = asyncHandler(async (req, res) => {
  const { read, page = 1, limit = 20 } = req.query;
  const readFilter = parseBoolean(read);

  let notifications = storage.notifications.filter(
    (item) => item.user_id === req.user?.id || item.user_id === null
  );

  if (readFilter !== undefined) {
    notifications = notifications.filter((item) => item.read === readFilter);
  }

  const pageNumber = Math.max(1, Number(page) || 1);
  const pageLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const startIndex = (pageNumber - 1) * pageLimit;

  const paginatedNotifications = notifications
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(startIndex, startIndex + pageLimit);

  res.status(200).json({
    success: true,
    count: paginatedNotifications.length,
    total: notifications.length,
    page: pageNumber,
    limit: pageLimit,
    data: paginatedNotifications,
  });
});

const markNotificationsRead = asyncHandler(async (req, res) => {
  const ids = req.body?.ids || req.body?.id || req.body;
  const requestedIds = Array.isArray(ids) ? ids : [ids];
  const notificationIds = requestedIds
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!notificationIds.length) {
    return res.status(400).json({
      success: false,
      message: 'Please provide one or more notification IDs to mark as read',
    });
  }

  const updated = [];
  notificationIds.forEach((id) => {
    const notification = storage.notifications.find(
      (item) => item.id === id && item.user_id === req.user?.id
    );
    if (notification && !notification.read) {
      notification.read = true;
      updated.push(notification);
    }
  });

  res.status(200).json({
    success: true,
    message: `${updated.length} notification(s) marked as read`,
    count: updated.length,
    data: updated,
  });
});

const markAsRead = asyncHandler(async (req, res) => {
  const notificationId = Number(req.params.id);
  const notification = storage.notifications.find(
    (item) => item.id === notificationId && item.user_id === req.user?.id
  );

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
  const updated = [];
  storage.notifications.forEach((item) => {
    if (item.user_id === req.user?.id && !item.read) {
      item.read = true;
      updated.push(item);
    }
  });

  res.status(200).json({
    success: true,
    message: `${updated.length} notification(s) marked as read`,
    count: updated.length,
  });
});

module.exports = {
  listNotifications,
  markNotificationsRead,
  markAsRead,
  markAllAsRead,
};
