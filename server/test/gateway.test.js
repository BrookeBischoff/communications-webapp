'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers');

test('connecting with a valid session returns who you are, who is online and history', async () => {
  const s = await startServer();
  try {
    const alice = await s.connect('Alice', 'Alice A');
    const ok = await alice.next('session.ok');
    assert.strictEqual(ok.payload.user.username, 'Alice');
    assert.strictEqual(ok.payload.user.displayName, 'Alice A');
    assert.deepStrictEqual(ok.payload.users.map((u) => u.displayName), ['Alice A']);
    assert.strictEqual(ok.payload.conversationId, 'lobby');

    const bob = await s.connect('Bob');
    await bob.next('session.ok');
    let latest;
    do {
      latest = await alice.next('presence');
    } while (latest.payload.users.length < 2);
    assert.deepStrictEqual(latest.payload.users.map((u) => u.displayName), ['Alice A', 'Bob']);
  } finally {
    await s.stop();
  }
});

test('sockets without a valid session, or from another site, are refused', async () => {
  const s = await startServer();
  try {
    const status = (headers) =>
      new Promise((resolve) => {
        const c = s.openSocket(headers);
        c.ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
        c.ws.on('open', () => resolve('opened'));
        c.ws.on('error', () => {});
      });
    assert.strictEqual(await status({}), 401);
    assert.strictEqual(await status({ Cookie: 'sid=made-up' }), 401);

    const alice = await s.connect('Alice');
    assert.strictEqual(await status({ Cookie: `sid=${alice.token}`, Origin: 'http://evil.example' }), 403);
    assert.strictEqual(await status({ Cookie: `sid=${alice.token}`, Origin: `http://127.0.0.1:${s.port}` }), 'opened');
  } finally {
    await s.stop();
  }
});

test('messages are broadcast with the display name and kept as history', async () => {
  const s = await startServer();
  try {
    const alice = await s.connect('Alice', 'Alice A');
    const bob = await s.connect('Bob');

    alice.send('message.send', { conversationId: 'lobby', body: '  hello  ' });
    const received = await bob.next('message.new');
    assert.strictEqual(received.payload.from, 'Alice A');
    assert.strictEqual(received.payload.fromId, alice.user.id);
    assert.strictEqual(received.payload.body, 'hello');
    assert.ok(typeof received.payload.ts === 'number');

    const carol = await s.connect('Carol');
    const ok = await carol.next('session.ok');
    assert.strictEqual(ok.payload.history.length, 1);
    assert.strictEqual(ok.payload.history[0].body, 'hello');
  } finally {
    await s.stop();
  }
});

test('one person with two tabs appears once in the user list', async () => {
  const s = await startServer();
  try {
    const first = await s.connect('Alice');
    const second = s.openSocket({ Cookie: `sid=${first.token}` });
    await second.opened;
    const ok = await second.next('session.ok');
    assert.strictEqual(ok.payload.users.length, 1);
  } finally {
    await s.stop();
  }
});

test('bad input is rejected without crashing the server', async () => {
  const s = await startServer();
  try {
    const c = await s.connect('Dana');
    c.ws.send('not json');
    assert.strictEqual((await c.next('error')).payload.code, 'bad_json');
    c.ws.send(JSON.stringify({ nope: true }));
    assert.strictEqual((await c.next('error')).payload.code, 'bad_frame');
    c.send('does.not.exist', {});
    assert.strictEqual((await c.next('error')).payload.code, 'unknown_type');
    c.send('constructor', {});
    assert.strictEqual((await c.next('error')).payload.code, 'unknown_type');
    c.send('session.join', { username: 'Mallory' }); // the old anonymous login is gone
    assert.strictEqual((await c.next('error')).payload.code, 'unknown_type');

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
    const c = await s.connect('Spammer');
    for (let i = 0; i < 9; i += 1) c.send('message.send', { conversationId: 'lobby', body: `m${i}` });
    assert.strictEqual((await c.next('error')).payload.code, 'rate_limited');
  } finally {
    await s.stop();
  }
});

test('disconnecting updates presence for everyone else', async () => {
  const s = await startServer();
  try {
    const alice = await s.connect('Alice');
    const bob = await s.connect('Bob');
    bob.ws.close();
    let users;
    do {
      users = (await alice.next('presence')).payload.users;
    } while (users.some((u) => u.displayName === 'Bob'));
    assert.deepStrictEqual(users.map((u) => u.displayName), ['Alice']);
  } finally {
    await s.stop();
  }
});

test('logging out closes that session\'s sockets', async () => {
  const s = await startServer();
  try {
    const alice = await s.connect('Alice');
    const closed = new Promise((resolve) => alice.ws.on('close', resolve));
    const res = await fetch(s.url('/api/logout'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `sid=${alice.token}` },
      body: '{}',
    });
    assert.strictEqual(res.status, 200);
    await closed;
  } finally {
    await s.stop();
  }
});
