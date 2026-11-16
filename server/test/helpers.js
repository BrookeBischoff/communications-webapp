'use strict';

const http = require('node:http');
const WebSocket = require('ws');
const { openDatabase } = require('../src/db');
const { createAuth } = require('../src/auth/service');
const { createAuthRoutes, parseCookies } = require('../src/auth/routes');
const { createGateway } = require('../src/ws/gateway');
const config = require('../src/config');

const PASSWORD = 'correct horse battery';

// A full server (in-memory database, HTTP routes, gateway) on a random port.
async function startServer() {
  const db = openDatabase(':memory:');
  const auth = createAuth(db);
  let gateway = null;
  const routes = createAuthRoutes({ auth, onLogout: (id) => gateway.disconnectSession(id) });
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) return routes.handle(req, res, pathname);
    res.writeHead(404);
    res.end();
  });
  gateway = createGateway(server, {
    authenticate: (req) => auth.authenticate(parseCookies(req.headers.cookie)[config.SESSION_COOKIE]),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  // Open a socket with the given headers and collect its frames.
  function openSocket(headers) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    const inbox = [];
    const waiting = [];
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      const index = waiting.findIndex((w) => w.type === frame.type);
      if (index >= 0) waiting.splice(index, 1)[0].resolve(frame);
      else inbox.push(frame);
    });
    return {
      ws,
      opened: new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      }),
      send: (type, payload, id) => ws.send(JSON.stringify({ type, id, payload })),
      next(type) {
        const index = inbox.findIndex((f) => f.type === type);
        if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 1500);
          waiting.push({ type, resolve: (f) => { clearTimeout(timer); resolve(f); } });
        });
      },
    };
  }

  // Register an account and connect as it. The server sends session.ok on open.
  async function connect(username, displayName) {
    const result = await auth.register({ username, password: PASSWORD, displayName });
    if (!result.ok) throw new Error(result.message);
    const client = openSocket({ Cookie: `${config.SESSION_COOKIE}=${result.session.token}` });
    await client.opened;
    client.user = result.user;
    client.token = result.session.token;
    return client;
  }

  const url = (p) => `http://127.0.0.1:${port}${p}`;

  return {
    auth, port, url, openSocket, connect,
    async stop() {
      gateway.close();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}

module.exports = { startServer, PASSWORD };
