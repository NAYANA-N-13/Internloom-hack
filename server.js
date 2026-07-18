require('dotenv').config();

const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const studentsRoutes = require('./routes/students');
const jobsRoutes = require('./routes/jobs');
const applicationsRoutes = require('./routes/applications');
const notificationsRoutes = require('./routes/notifications');
const rateLimiter = require('./middleware/rateLimiter');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimiter);

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'InternLoom API is running',
    database: 'connected',
    serverTime: new Date(),
  });
});

app.use(express.static('public'));
app.use('/api/auth', authRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/notifications', notificationsRoutes);

app.use(notFound);
app.use(errorHandler);

async function startServer() {
  app.listen(PORT, () => {
    console.log(`InternLoom server listening on port ${PORT}`);
  });
}

startServer();

module.exports = app;
