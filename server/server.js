require('dotenv').config();

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

// ---------------------------------------------------------------------------
// Environment sanity checks
// ---------------------------------------------------------------------------
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('JWT_SECRET is not set. Refusing to start in production.');
    process.exit(1);
  }
  console.warn('JWT_SECRET missing in .env - using an insecure development secret.');
  process.env.JWT_SECRET = 'dev-only-insecure-secret-change-me';
}

const PORT = process.env.PORT || 5000;
const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173', // Vite
  'http://localhost:3000', // Create React App
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // allow tools like curl/Postman (no Origin header) and whitelisted browsers
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/grievances', require('./routes/grievance'));

// 404 for unknown routes
app.use((req, res) => res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` }));

// Central error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: Object.values(err.errors).map((e) => e.message).join(', ') });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid value for ${err.path}` });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: 'Duplicate value: record already exists' });
  }

  console.error(err);
  const status = err.status || 500;
  return res.status(status).json({
    message: status < 500 ? err.message : 'Internal server error',
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
(async () => {
  await connectDB();
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
})();