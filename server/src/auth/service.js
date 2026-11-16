'use strict';

const crypto = require('node:crypto');
const config = require('../config');
const { hashPassword, verifyPassword, spendHashTime } = require('./passwords');

const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;
const CONTROL_CHARS = /\p{C}/u; // control, format and unassigned characters

const fail = (status, code, message) => ({ ok: false, status, code, message });
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function publicUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name };
}

/**
 * Accounts and sessions on top of the database. No HTTP in here: the routes
 * and the WebSocket gateway both call into this, and tests call it directly.
 */
function createAuth(db, { now = Date.now } = {}) {
  const q = {
    insertUser: db.prepare(
      'INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)'
    ),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    insertSession: db.prepare(
      'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ),
    sessionLookup: db.prepare(
      `SELECT u.id, u.username, u.display_name, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const created = now();
    q.insertSession.run(hashToken(token), userId, created, created + config.SESSION_TTL_MS);
    return { token, maxAgeSeconds: Math.floor(config.SESSION_TTL_MS / 1000) };
  }

  async function register({ username, password, displayName } = {}) {
    if (typeof username !== 'string' || typeof password !== 'string') {
      return fail(400, 'invalid_request', 'A user name and password are required.');
    }
    const name = username.trim();
    if (
      name.length < config.MIN_USERNAME_LENGTH ||
      name.length > config.MAX_USERNAME_LENGTH ||
      !USERNAME_PATTERN.test(name)
    ) {
      return fail(
        400,
        'invalid_username',
        `User names are ${config.MIN_USERNAME_LENGTH}-${config.MAX_USERNAME_LENGTH} characters: letters, numbers and _.`
      );
    }
    if (password.length < config.MIN_PASSWORD_LENGTH || password.length > config.MAX_PASSWORD_LENGTH) {
      return fail(
        400,
        'invalid_password',
        `Passwords are ${config.MIN_PASSWORD_LENGTH}-${config.MAX_PASSWORD_LENGTH} characters.`
      );
    }
    let shown = typeof displayName === 'string' ? displayName.trim().replace(/\s+/g, ' ') : '';
    if (shown === '') shown = name; // blank display name: fall back to the user name
    if (shown.length > config.MAX_DISPLAY_NAME_LENGTH || CONTROL_CHARS.test(shown)) {
      return fail(
        400,
        'invalid_display_name',
        `Display names are up to ${config.MAX_DISPLAY_NAME_LENGTH} characters, with no control characters.`
      );
    }
    if (q.userByName.get(name)) {
      return fail(409, 'username_taken', `"${name}" is already registered. Pick another user name.`);
    }

    const hash = await hashPassword(password);
    let id;
    try {
      id = q.insertUser.run(name, shown, hash, now()).lastInsertRowid;
    } catch (err) {
      // Two registrations for the same name racing past the check above.
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return fail(409, 'username_taken', `"${name}" is already registered. Pick another user name.`);
      }
      throw err;
    }
    return { ok: true, user: { id: Number(id), username: name, displayName: shown }, session: createSession(id) };
  }

  async function login({ username, password } = {}) {
    const bad = fail(401, 'bad_credentials', 'Incorrect user name or password.');
    if (typeof username !== 'string' || typeof password !== 'string') return bad;
    if (password.length > config.MAX_PASSWORD_LENGTH) return bad;
    const row = q.userByName.get(username.trim());
    if (!row) {
      await spendHashTime(password);
      return bad;
    }
    if (!(await verifyPassword(row.password_hash, password))) return bad;
    return { ok: true, user: publicUser(row), session: createSession(row.id) };
  }

  /** Look up the person behind a cookie token, or null. Safe to call with undefined. */
  function authenticate(token) {
    if (typeof token !== 'string' || token === '') return null;
    const sessionId = hashToken(token);
    const row = q.sessionLookup.get(sessionId);
    if (!row) return null;
    if (row.expires_at <= now()) {
      q.deleteSession.run(sessionId);
      return null;
    }
    return { sessionId, user: publicUser(row) };
  }

  /** End a session. Returns its id (so open sockets can be closed) or null. */
  function logout(token) {
    if (typeof token !== 'string' || token === '') return null;
    const sessionId = hashToken(token);
    q.deleteSession.run(sessionId);
    return sessionId;
  }

  function purgeExpiredSessions() {
    q.deleteExpired.run(now());
  }

  return { register, login, authenticate, logout, purgeExpiredSessions };
}

module.exports = { createAuth };
