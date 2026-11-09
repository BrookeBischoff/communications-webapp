'use strict';

// All tunable values live here so they are easy to find and, later, to load
// from environment variables on the Droplet.
module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  // Bind to localhost by default. On the Droplet the reverse proxy (HTTPS)
  // will forward to this address; do not expose Node directly to the internet.
  HOST: process.env.HOST || '127.0.0.1',

  WS_PATH: '/ws',
  MAX_PAYLOAD_BYTES: 16 * 1024,

  MAX_USERNAME_LENGTH: 20,
  MAX_MESSAGE_LENGTH: 2000,

  // Temporary in-memory history for the single "lobby" conversation.
  // Replaced by the SQLite messages table in the persistence step.
  HISTORY_LIMIT: 50,

  // Simple flood protection: at most RATE_MAX messages per RATE_WINDOW_MS.
  RATE_MAX: 8,
  RATE_WINDOW_MS: 5000,

  HEARTBEAT_INTERVAL_MS: 30000,
};
