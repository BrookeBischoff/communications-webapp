'use strict';

const path = require('node:path');

// All tunable values live here so they are easy to find and, later, to load
// from environment variables on the Droplet.
module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  // Bind to localhost by default. On the Droplet the reverse proxy (HTTPS)
  // will forward to this address; do not expose Node directly to the internet.
  HOST: process.env.HOST || '127.0.0.1',

  WS_PATH: '/ws',
  MAX_PAYLOAD_BYTES: 16 * 1024,

  // SQLite file. Created (with its folder) on first start; *.sqlite is gitignored.
  DB_PATH: process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'chat.sqlite'),

  // ---------- Accounts ----------
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 20,
  MAX_DISPLAY_NAME_LENGTH: 30,
  MIN_PASSWORD_LENGTH: 10,
  MAX_PASSWORD_LENGTH: 128, // caps the work a single request can make the hasher do

  SESSION_COOKIE: 'sid',
  SESSION_TTL_MS: 30 * 24 * 60 * 60 * 1000,
  // Set COOKIE_SECURE=true once the site is served over HTTPS (the Droplet).
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true',
  // Set TRUST_PROXY=true only when running behind the reverse proxy, so the
  // client IP for rate limiting comes from X-Forwarded-For.
  TRUST_PROXY: process.env.TRUST_PROXY === 'true',

  MAX_BODY_BYTES: 4 * 1024,

  // Login/registration throttle, per client IP.
  AUTH_RATE_MAX: 20,
  AUTH_RATE_WINDOW_MS: 15 * 60 * 1000,

  MAX_MESSAGE_LENGTH: 2000,

  // Temporary in-memory history for the single "lobby" conversation.
  // Replaced by the SQLite messages table in the persistence step.
  HISTORY_LIMIT: 50,

  // Simple flood protection: at most RATE_MAX messages per RATE_WINDOW_MS.
  RATE_MAX: 8,
  RATE_WINDOW_MS: 5000,

  HEARTBEAT_INTERVAL_MS: 30000,
};
