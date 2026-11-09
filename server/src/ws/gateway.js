'use strict';

const { WebSocketServer } = require('ws');
const config = require('../config');

const LOBBY = 'lobby';
const USERNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_ -]*$/;

/**
 * WebSocket gateway.
 *
 * Every frame is JSON shaped like { type, id, payload }:
 *   - type    names the message (see `handlers` below and docs in the README)
 *   - id      optional client-chosen id, echoed back on errors so the client
 *             can tell which request failed
 *   - payload message-specific data
 *
 * The gateway keeps a registry of connected sessions (socket -> user). Later
 * steps add friends, group conversations and call signaling as more handlers
 * on this same router.
 */
function createGateway(server) {
  const wss = new WebSocketServer({
    server,
    path: config.WS_PATH,
    maxPayload: config.MAX_PAYLOAD_BYTES,
  });

  /** @type {Map<import('ws').WebSocket, {username: string|null, alive: boolean, sentAt: number[]}>} */
  const sessions = new Map();
  const lobbyHistory = [];
  let nextMessageId = 1;

  function send(ws, type, payload, id) {
    if (ws.readyState !== ws.OPEN) return;
    const frame = { type, payload };
    if (id !== undefined) frame.id = id;
    ws.send(JSON.stringify(frame));
  }

  function sendError(ws, id, code, message) {
    send(ws, 'error', { code, message }, id);
  }

  function broadcast(type, payload) {
    for (const [ws, session] of sessions) {
      if (session.username) send(ws, type, payload);
    }
  }

  function userList() {
    const names = [];
    for (const session of sessions.values()) {
      if (session.username) names.push(session.username);
    }
    return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  function isNameTaken(name) {
    const wanted = name.toLowerCase();
    for (const session of sessions.values()) {
      if (session.username && session.username.toLowerCase() === wanted) return true;
    }
    return false;
  }

  function withinRateLimit(session) {
    const now = Date.now();
    session.sentAt = session.sentAt.filter((t) => now - t < config.RATE_WINDOW_MS);
    if (session.sentAt.length >= config.RATE_MAX) return false;
    session.sentAt.push(now);
    return true;
  }

  const handlers = {
    'session.join'(ws, session, payload, id) {
      if (session.username) {
        return sendError(ws, id, 'already_joined', 'You are already logged on.');
      }
      const name = typeof payload?.username === 'string' ? payload.username.trim() : '';
      if (
        name.length < 1 ||
        name.length > config.MAX_USERNAME_LENGTH ||
        !USERNAME_PATTERN.test(name)
      ) {
        return sendError(
          ws,
          id,
          'invalid_username',
          `User names are 1-${config.MAX_USERNAME_LENGTH} characters: letters, numbers, spaces, - and _.`
        );
      }
      if (isNameTaken(name)) {
        return sendError(ws, id, 'username_taken', `"${name}" is already logged on. Pick another name.`);
      }
      session.username = name;
      send(ws, 'session.ok', {
        username: name,
        conversationId: LOBBY,
        users: userList(),
        history: lobbyHistory,
      }, id);
      broadcast('presence', { users: userList() });
    },

    'session.leave'(ws, session, _payload, id) {
      if (!session.username) return;
      session.username = null;
      send(ws, 'session.left', {}, id);
      broadcast('presence', { users: userList() });
    },

    'message.send'(ws, session, payload, id) {
      if (!session.username) {
        return sendError(ws, id, 'not_joined', 'Log on before sending messages.');
      }
      if (payload?.conversationId !== LOBBY) {
        return sendError(ws, id, 'unknown_conversation', 'That conversation does not exist.');
      }
      const body = typeof payload.body === 'string' ? payload.body.trim() : '';
      if (body.length === 0) return; // ignore empty messages silently
      if (body.length > config.MAX_MESSAGE_LENGTH) {
        return sendError(ws, id, 'message_too_long', `Messages are limited to ${config.MAX_MESSAGE_LENGTH} characters.`);
      }
      if (!withinRateLimit(session)) {
        return sendError(ws, id, 'rate_limited', 'You are sending messages too quickly. Wait a moment.');
      }

      const message = {
        id: nextMessageId++,
        conversationId: LOBBY,
        from: session.username,
        body,
        ts: Date.now(),
      };
      lobbyHistory.push(message);
      if (lobbyHistory.length > config.HISTORY_LIMIT) lobbyHistory.shift();
      broadcast('message.new', message);
    },
  };

  wss.on('connection', (ws) => {
    const session = { username: null, alive: true, sentAt: [] };
    sessions.set(ws, session);

    ws.on('pong', () => {
      session.alive = true;
    });

    ws.on('message', (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return sendError(ws, undefined, 'bad_json', 'Messages must be valid JSON.');
      }
      if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string') {
        return sendError(ws, undefined, 'bad_frame', 'Messages need a "type".');
      }
      const id = typeof frame.id === 'string' || typeof frame.id === 'number' ? frame.id : undefined;
      if (!Object.hasOwn(handlers, frame.type)) {
        return sendError(ws, id, 'unknown_type', `Unknown message type "${frame.type}".`);
      }
      try {
        handlers[frame.type](ws, session, frame.payload, id);
      } catch (err) {
        console.error('Handler error for', frame.type, err);
        sendError(ws, id, 'server_error', 'Something went wrong on the server.');
      }
    });

    ws.on('close', () => {
      const hadName = session.username;
      sessions.delete(ws);
      if (hadName) broadcast('presence', { users: userList() });
    });

    ws.on('error', () => {
      // Errors are followed by 'close'; nothing extra to do here.
    });
  });

  // Drop connections that stop answering pings (closed laptops, lost Wi-Fi).
  const heartbeat = setInterval(() => {
    for (const [ws, session] of sessions) {
      if (!session.alive) {
        ws.terminate();
        continue;
      }
      session.alive = false;
      ws.ping();
    }
  }, config.HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return {
    wss,
    close() {
      clearInterval(heartbeat);
      for (const ws of sessions.keys()) ws.terminate();
      wss.close();
    },
  };
}

module.exports = { createGateway };
