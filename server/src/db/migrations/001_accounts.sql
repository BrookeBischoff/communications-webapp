-- Accounts and login sessions. Timestamps are milliseconds since the epoch.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE, -- login name; "alice" and "Alice" collide
  display_name  TEXT NOT NULL,                       -- what other people see
  password_hash TEXT NOT NULL,                       -- argon2id string (salt and parameters included)
  created_at    INTEGER NOT NULL
);

-- The browser holds a random token in a cookie; only its SHA-256 is stored here,
-- so a leaked database file cannot be used to take over a session.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);
