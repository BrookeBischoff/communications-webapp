'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { createGateway } = require('./ws/gateway');

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'client');
// 98.css ships its stylesheet and fonts together; the fonts load relative to
// the stylesheet, so the whole dist folder is served under /vendor/.
const VENDOR_DIR = path.resolve(__dirname, '..', 'node_modules', '98.css', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Map a URL path to a file inside CLIENT_DIR or VENDOR_DIR, or null if unsafe. */
function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  let root = CLIENT_DIR;
  let relative = decoded === '/' ? '/index.html' : decoded;
  if (relative.startsWith('/vendor/')) {
    root = VENDOR_DIR;
    relative = relative.slice('/vendor'.length);
  }

  const full = path.join(root, path.normalize(relative));
  // Refuse anything that escapes the root folder (e.g. ../ tricks).
  if (!full.startsWith(root + path.sep)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  const { pathname } = new URL(req.url, 'http://localhost');
  const file = resolveFile(pathname);
  if (!file) {
    res.writeHead(400);
    return res.end('Bad request');
  }

  fs.stat(file, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache', // always revalidate while developing
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

const gateway = createGateway(server);

server.listen(config.PORT, config.HOST, () => {
  console.log(`Chat server running at http://${config.HOST}:${config.PORT}`);
});

function shutdown() {
  gateway.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
