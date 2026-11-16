'use strict';

const { WebSocketServer } = require('ws');
const config = require('../config');
const { sameOrigin } = require('../auth/routes');

const LOBBY = 'lobby';

/**
 * WebSocket gateway.
 *
 * Every frame is JSON shaped like { type, id, payload }:
 *   - type    names the message (see `handlers` below and docs in the README)
 *   - id      optional client-chosen id, echoed back on errors so the client
 *             can tell which request failed
 *   - payload message-specific data
 *
 * Connections are authenticated during the HTTP upgrade: `authenticate(req)`
 * (supplied by index.js) reads the session cookie and returns
 * { sessionId, user } or null. Anonymous or cross-site upgrades never become
 * sockets. As soon as a socket opens the server sends `session.ok`.
 *
 * The gateway keeps a registry of connected sessions (socket -> user). Later
 * steps add friends, group conversations and call signaling as more handlers
 * on this same router.
 */
function createGateway(server, { authenticate }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.MAX_PAYLOAD_BYTES });

  /** @type {Map<import('ws').WebSocket, {user: {id: number, username: string, displayName: string}, sessionId: string, alive: boolean, sentAt: number[]}>} */
  const sessions = new Map();
  const lobbyHistory = [];
  let nextMessageId = 1;

  function reject(socket, status, text) {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  server.on('upgrade', (req, socket, head) => {
    let pathname = null;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      // fall through to the 404 below
    }
    if (pathname !== config.WS_PATH) return reject(socket, 404, 'Not Found');
    if (!sameOrigin(req)) return reject(socket, 403, 'Forbidden');
    const identity = authenticate(req);
    if (!identity) return reject(socket, 401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, identity));
  });

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
    for (const ws of sessions.keys()) send(ws, type, payload);
  }

  // One entry per person, even with several tabs open.
  function userList() {
    const people = new Map();
    for (const { user } of sessions.values()) {
      people.set(user.id, { id: user.id, displayName: user.displayName });
    }
    return [...people.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    );
  }

  function withinRateLimit(session) {
    const now = Date.now();
    session.sentAt = session.sentAt.filter((t) => now - t < config.RATE_WINDOW_MS);
    if (session.sentAt.length >= config.RATE_MAX) return false;
    session.sentAt.push(now);
    return true;
  }

  const handlers = {
    'message.send'(ws, session, payload, id) {
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
        fromId: session.user.id,
        from: session.user.displayName,
        body,
        ts: Date.now(),
      };
      lobbyHistory.push(message);
      if (lobbyHistory.length > config.HISTORY_LIMIT) lobbyHistory.shift();
      broadcast('message.new', message);
    },
  };

  wss.on('connection', (ws, _req, identity) => {
    const session = { user: identity.user, sessionId: identity.sessionId, alive: true, sentAt: [] };
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
      sessions.delete(ws);
      broadcast('presence', { users: userList() });
    });

    ws.on('error', () => {
      // Errors are followed by 'close'; nothing extra to do here.
    });

    send(ws, 'session.ok', {
      user: identity.user,
      conversationId: LOBBY,
      users: userList(),
      history: lobbyHistory,
    });
    broadcast('presence', { users: userList() });
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
    /** Close every socket that belongs to a logged-out session. */
    disconnectSession(sessionId) {
      for (const [ws, session] of sessions) {
        if (session.sessionId === sessionId) ws.close(1000, 'logged out');
      }
    },
    close() {
      clearInterval(heartbeat);
      for (const ws of sessions.keys()) ws.terminate();
      wss.close();
    },
  };
}

module.exports = { createGateway };
