const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 100;

const ipRequestLog = new Map();

const cleanupOldRequests = (timestamps, now) => {
  while (timestamps.length && timestamps[0] <= now - RATE_LIMIT_WINDOW_MS) {
    timestamps.shift();
  }
};

const rateLimiter = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  const timestamps = ipRequestLog.get(ip) || [];
  cleanupOldRequests(timestamps, now);

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
    });
  }

  timestamps.push(now);
  ipRequestLog.set(ip, timestamps);

  next();
};

module.exports = rateLimiter;
