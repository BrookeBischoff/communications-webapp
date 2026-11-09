'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const WebSocket = require('ws');
const { createGateway } = require('../src/ws/gateway');

// Start a gateway on a random port and return helpers for talking to it.
async function startServer() {
  const server = http.createServer();
  const gateway = createGateway(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const inbox = [];
    const waiting = [];
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      const index = waiting.findIndex((w) => w.type === frame.type);
      if (index >= 0) waiting.splice(index, 1)[0].resolve(frame);
      else inbox.push(frame);
    });
    await new Promise((resolve) => ws.on('open', resolve));
    return {
      ws,
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

  return {
    connect,
    async stop() {
      gateway.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('joining returns the user list and announces presence', async () => {
  const s = await startServer();
  try {
    const alice = await s.connect();
    alice.send('session.join', { username: 'Alice' }, '1');
    const ok = await alice.next('session.ok');
    assert.strictEqual(ok.id, '1');
    assert.deepStrictEqual(ok.payload.users, ['Alice']);
    assert.strictEqual(ok.payload.conversationId, 'lobby');

    const bob = await s.connect();
    bob.send('session.join', { username: 'Bob' });
    await bob.next('session.ok');
    const presence = await alice.next('presence');
    // Alice receives her own join presence first, then Bob's.
    const latest = presence.payload.users.length === 2 ? presence : await alice.next('presence');
    assert.deepStrictEqual(latest.payload.users, ['Alice', 'Bob']);
  } finally {
    await s.stop();
  }
});

test('messages are broadcast to everyone and kept as history', async () => {
  const s = await startServer();
  try {
    const alice = await s.connect();
    alice.send('session.join', { username: 'Alice' });
    await alice.next('session.ok');
    const bob = await s.connect();
    bob.send('session.join', { username: 'Bob' });
    await bob.next('session.ok');

    alice.send('message.send', { conversationId: 'lobby', body: '  hello  ' });
    const received = await bob.next('message.new');
    assert.strictEqual(received.payload.from, 'Alice');
    assert.strictEqual(received.payload.body, 'hello');
    assert.ok(typeof received.payload.ts === 'number');

    const carol = await s.connect();
    carol.send('session.join', { username: 'Carol' });
    const ok = await carol.next('session.ok');
    assert.strictEqual(ok.payload.history.length, 1);
    assert.strictEqual(ok.payload.history[0].body, 'hello');
  } finally {
    await s.stop();
  }
});

test('names must be valid and unique (case-insensitive)', async () => {
  const s = await startServer();
  try {
    const alice = await s.connect();
    alice.send('session.join', { username: 'Alice' });
    await alice.next('session.ok');

    const other = await s.connect();
    other.send('session.join', { username: 'alice' }, 'x');
    const taken = await other.next('error');
    assert.strictEqual(taken.payload.code, 'username_taken');
    assert.strictEqual(taken.id, 'x');

    other.send('session.join', { username: '<script>' });
    assert.strictEqual((await other.next('error')).payload.code, 'invalid_username');
    other.send('session.join', { username: 'a'.repeat(21) });
    assert.strictEqual((await other.next('error')).payload.code, 'invalid_username');
    other.send('session.join', {});
    assert.strictEqual((await other.next('error')).payload.code, 'invalid_username');
  } finally {
    await s.stop();
  }
});

test('leaving frees the name', async () => {
  const s = await startServer();
  try {
    const alice = await s.connect();
    alice.send('session.join', { username: 'Alice' });
    await alice.next('session.ok');
    alice.send('session.leave');
    await alice.next('session.left');

    const again = await s.connect();
    again.send('session.join', { username: 'Alice' });
    await again.next('session.ok');
  } finally {
    await s.stop();
  }
});

test('bad input is rejected without crashing the server', async () => {
  const s = await startServer();
  try {
    const c = await s.connect();
    c.ws.send('not json');
    assert.strictEqual((await c.next('error')).payload.code, 'bad_json');
    c.ws.send(JSON.stringify({ nope: true }));
    assert.strictEqual((await c.next('error')).payload.code, 'bad_frame');
    c.send('does.not.exist', {});
    assert.strictEqual((await c.next('error')).payload.code, 'unknown_type');
    c.send('constructor', {});
    assert.strictEqual((await c.next('error')).payload.code, 'unknown_type');

    c.send('message.send', { conversationId: 'lobby', body: 'hi' });
    assert.strictEqual((await c.next('error')).payload.code, 'not_joined');

    c.send('session.join', { username: 'Dana' });
    await c.next('session.ok');
    c.send('message.send', { conversationId: 'elsewhere', body: 'hi' });
    assert.strictEqual((await c.next('error')).payload.code, 'unknown_conversation');
    c.send('message.send', { conversationId: 'lobby', body: 'x'.repeat(2001) });
    assert.strictEqual((await c.next('error')).payload.code, 'message_too_long');
  } finally {
    await s.stop();
  }
});

test('flooding is rate limited', async () => {
  const s = await startServer();
  try {
    const c = await s.connect();
    c.send('session.join', { username: 'Spammer' });
    await c.next('session.ok');
    for (let i = 0; i < 9; i += 1) c.send('message.send', { conversationId: 'lobby', body: `m${i}` });
    const err = await c.next('error');
    assert.strictEqual(err.payload.code, 'rate_limited');
  } finally {
    await s.stop();
  }
});

test('disconnecting updates presence for everyone else', async () => {
  const s = await startServer();
  try {
    const alice = await s.connect();
    alice.send('session.join', { username: 'Alice' });
    await alice.next('session.ok');
    const bob = await s.connect();
    bob.send('session.join', { username: 'Bob' });
    await bob.next('session.ok');
    bob.ws.close();
    // Drain presence frames until the one without Bob arrives.
    let users;
    do {
      users = (await alice.next('presence')).payload.users;
    } while (users.includes('Bob'));
    assert.deepStrictEqual(users, ['Alice']);
  } finally {
    await s.stop();
  }
});
