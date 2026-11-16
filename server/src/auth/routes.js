'use strict';

const config = require('../config');

/** Parse a Cookie header into { name: value }. */
function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name && !(name in cookies)) cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

function sessionCookie(token, maxAgeSeconds) {
  return [
    `${config.SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    config.COOKIE_SECURE ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

/**
 * Reject requests made from another web site: a browser always sends Origin on
 * cross-origin POSTs and WebSocket handshakes, and it must match our Host.
 * (Behind the reverse proxy, forward the Host header unchanged.)
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true; // not a browser cross-site request
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function clientIp(req) {
  if (config.TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',');
    const last = forwarded[forwarded.length - 1].trim(); // the address our proxy saw
    if (last) return last;
  }
  return req.socket.remoteAddress || 'unknown';
}

function createRateLimiter(max, windowMs) {
  const hits = new Map(); // ip -> timestamps
  return function allow(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(ip, recent);
      return false;
    }
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 10000) {
      for (const [key, times] of hits) if (now - times[times.length - 1] >= windowMs) hits.delete(key);
    }
    return true;
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > config.MAX_BODY_BYTES) tooLarge = true; // keep draining so the reply can still be sent
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('too large'), { status: 413 }));
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value && typeof value === 'object' && !Array.isArray(value)) resolve(value);
        else reject(Object.assign(new Error('bad json'), { status: 400 }));
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(text);
}

const sendError = (res, status, code, message, headers) =>
  sendJson(res, status, { error: { code, message } }, headers);

/**
 * HTTP endpoints for accounts:
 *   GET  /api/me        who am I? (200 { user } or 401)
 *   POST /api/register  { username, password, displayName } -> logs you in
 *   POST /api/login     { username, password }
 *   POST /api/logout
 * `onLogout(sessionId)` lets the gateway close that session's sockets.
 */
function createAuthRoutes({ auth, onLogout = () => {} }) {
  const allowAttempt = createRateLimiter(config.AUTH_RATE_MAX, config.AUTH_RATE_WINDOW_MS);
  const tokenOf = (req) => parseCookies(req.headers.cookie)[config.SESSION_COOKIE];

  async function postAuth(req, res, action) {
    if (!allowAttempt(clientIp(req))) {
      return sendError(res, 429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
    }
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, err.status || 400, 'bad_request', 'The request body must be a small JSON object.');
    }
    const result = await action(body);
    if (!result.ok) return sendError(res, result.status, result.code, result.message);
    sendJson(res, result.status || 200, { user: result.user }, {
      'Set-Cookie': sessionCookie(result.session.token, result.session.maxAgeSeconds),
    });
  }

  async function handle(req, res, pathname) {
    try {
      if (req.method === 'GET' && pathname === '/api/me') {
        const identity = auth.authenticate(tokenOf(req));
        if (!identity) return sendError(res, 401, 'not_logged_in', 'Not logged on.');
        return sendJson(res, 200, { user: identity.user });
      }

      const known = ['/api/register', '/api/login', '/api/logout'].includes(pathname);
      if (!known) return sendError(res, 404, 'not_found', 'Unknown API endpoint.');
      if (req.method !== 'POST') {
        return sendError(res, 405, 'method_not_allowed', 'Use POST.', { Allow: 'POST' });
      }
      if (!sameOrigin(req)) return sendError(res, 403, 'bad_origin', 'Cross-site requests are not allowed.');
      // Requiring JSON also blocks plain cross-site HTML form posts.
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
        return sendError(res, 415, 'bad_content_type', 'Send application/json.');
      }

      if (pathname === '/api/logout') {
        const sessionId = auth.logout(tokenOf(req));
        if (sessionId) onLogout(sessionId);
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
      }
      if (pathname === '/api/register') {
        return await postAuth(req, res, async (body) => {
          const result = await auth.register(body);
          return result.ok ? { ...result, status: 201 } : result;
        });
      }
      return await postAuth(req, res, (body) => auth.login(body));
    } catch (err) {
      console.error('API error', err);
      if (!res.headersSent) sendError(res, 500, 'server_error', 'Something went wrong on the server.');
    }
  }

  return { handle };
}

module.exports = { createAuthRoutes, parseCookies, sameOrigin };
