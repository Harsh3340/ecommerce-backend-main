'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mysql = require('mysql2/promise');

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';

// ---------------------------------------------------------------------------
// Express app setup
// ---------------------------------------------------------------------------
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------
let db = null;

async function connectDatabase() {
  if (!DATABASE_URL) {
    console.warn('[db] DATABASE_URL is not set — skipping database connection');
    return null;
  }

  try {
    const pool = mysql.createPool(DATABASE_URL);

    // Verify the connection is reachable
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();

    console.log('[db] Connected to MySQL database');
    return pool;
  } catch (err) {
    console.error('[db] Failed to connect to MySQL database:', err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/health', async (req, res) => {
  const dbStatus = db
    ? await db
        .getConnection()
        .then((conn) => { conn.release(); return 'connected'; })
        .catch(() => 'unreachable')
    : 'not configured';

  res.status(200).json({
    status: 'ok',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    database: dbStatus,
  });
});

// 404 handler — must come after all routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    ...(NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------
let server;

async function start() {
  try {
    db = await connectDatabase();

    server = app.listen(PORT, () => {
      console.log(`[server] Ecommerce backend running on port ${PORT} (${NODE_ENV})`);
    });
  } catch (err) {
    console.error('[server] Startup failed:', err.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  console.log(`[server] Received ${signal} — shutting down gracefully`);

  if (server) {
    server.close(async () => {
      console.log('[server] HTTP server closed');

      if (db) {
        try {
          await db.end();
          console.log('[db] Database pool closed');
        } catch (err) {
          console.error('[db] Error closing database pool:', err.message);
        }
      }

      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      console.error('[server] Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled rejection:', reason);
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception:', err);
  shutdown('uncaughtException');
});

start();

module.exports = app; // exported for testing
