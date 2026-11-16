'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { openDatabase } = require('../src/db');
const { createAuth } = require('../src/auth/service');
const config = require('../src/config');
const { startServer, PASSWORD } = require('./helpers');

test('registering stores an argon2id hash, never the password', async () => {
  const db = openDatabase(':memory:');
  const auth = createAuth(db);
  const result = await auth.register({ username: 'Alice', password: PASSWORD, displayName: '  Alice   A  ' });
  assert.ok(result.ok);
  assert.strictEqual(result.user.displayName, 'Alice A');
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(result.user.id);
  assert.ok(row.password_hash.startsWith('$argon2id$'));
  assert.ok(!row.password_hash.includes(PASSWORD));
  // Same password, different account: different salt, different hash.
  await auth.register({ username: 'Bob', password: PASSWORD });
  const [a, b] = db.prepare('SELECT password_hash FROM users ORDER BY id').all();
  assert.notStrictEqual(a.password_hash, b.password_hash);
  db.close();
});

test('registration validates input and rejects duplicate names case-insensitively', async () => {
  const db = openDatabase(':memory:');
  const auth = createAuth(db);
  const code = async (input) => (await auth.register(input)).code;
  assert.strictEqual(await code({ username: 'ab', password: PASSWORD }), 'invalid_username');
  assert.strictEqual(await code({ username: 'a b c', password: PASSWORD }), 'invalid_username');
  assert.strictEqual(await code({ username: '<script>', password: PASSWORD }), 'invalid_username');
  assert.strictEqual(await code({ username: 'a'.repeat(21), password: PASSWORD }), 'invalid_username');
  assert.strictEqual(await code({ username: 'carol', password: 'short' }), 'invalid_password');
  assert.strictEqual(await code({ username: 'carol', password: 'x'.repeat(129) }), 'invalid_password');
  assert.strictEqual(await code({ username: 'carol', password: PASSWORD, displayName: 'x'.repeat(31) }), 'invalid_display_name');
  assert.strictEqual(await code({ username: 'carol', password: PASSWORD, displayName: 'bad\u0000name' }), 'invalid_display_name');
  assert.strictEqual(await code({ username: 5, password: PASSWORD }), 'invalid_request');
  assert.strictEqual(await code({}), 'invalid_request');

  const first = await auth.register({ username: 'Dana', password: PASSWORD });
  assert.ok(first.ok);
  assert.strictEqual(first.user.displayName, 'Dana'); // blank display name falls back
  assert.strictEqual(await code({ username: 'dana', password: PASSWORD }), 'username_taken');
  db.close();
});

test('login accepts the right password and gives one generic failure', async () => {
  const db = openDatabase(':memory:');
  const auth = createAuth(db);
  await auth.register({ username: 'Erin', password: PASSWORD, displayName: 'Erin E' });

  const ok = await auth.login({ username: 'erin', password: PASSWORD });
  assert.ok(ok.ok);
  assert.strictEqual(ok.user.displayName, 'Erin E');

  const wrong = await auth.login({ username: 'Erin', password: 'wrong password!!' });
  const unknown = await auth.login({ username: 'Nobody', password: PASSWORD });
  assert.strictEqual(wrong.status, 401);
  assert.deepStrictEqual(wrong, unknown); // cannot tell a wrong password from a missing account
  db.close();
});

test('sessions authenticate, expire and end on logout', async () => {
  const db = openDatabase(':memory:');
  let clock = 1_000_000;
  const auth = createAuth(db, { now: () => clock });
  const { session } = await auth.register({ username: 'Finn', password: PASSWORD });

  const stored = db.prepare('SELECT id FROM sessions').get();
  assert.notStrictEqual(stored.id, session.token); // only a hash is stored
  assert.strictEqual(auth.authenticate(session.token).user.username, 'Finn');
  assert.strictEqual(auth.authenticate('made-up-token'), null);
  assert.strictEqual(auth.authenticate(undefined), null);

  clock += config.SESSION_TTL_MS + 1;
  assert.strictEqual(auth.authenticate(session.token), null);

  clock = 1_000_000;
  const again = (await auth.login({ username: 'Finn', password: PASSWORD })).session;
  assert.ok(auth.authenticate(again.token));
  auth.logout(again.token);
  assert.strictEqual(auth.authenticate(again.token), null);
  db.close();
});

test('HTTP: register, who am I, logout, login', async () => {
  const s = await startServer();
  try {
    const post = (p, body, headers = {}) =>
      fetch(s.url(p), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];

    const reg = await post('/api/register', { username: 'Gus', password: PASSWORD, displayName: 'Gus G' });
    assert.strictEqual(reg.status, 201);
    const setCookie = reg.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.strictEqual((await reg.json()).user.displayName, 'Gus G');
    const cookie = cookieOf(reg);

    const me = await fetch(s.url('/api/me'), { headers: { Cookie: cookie } });
    assert.strictEqual(me.status, 200);
    assert.strictEqual((await me.json()).user.username, 'Gus');
    assert.strictEqual((await fetch(s.url('/api/me'))).status, 401);

    const out = await post('/api/logout', {}, { Cookie: cookie });
    assert.strictEqual(out.status, 200);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.strictEqual((await fetch(s.url('/api/me'), { headers: { Cookie: cookie } })).status, 401);

    assert.strictEqual((await post('/api/login', { username: 'gus', password: 'nope nope nope' })).status, 401);
    const login = await post('/api/login', { username: 'gus', password: PASSWORD });
    assert.strictEqual(login.status, 200);
    assert.ok(cookieOf(login).startsWith('sid='));
  } finally {
    await s.stop();
  }
});

test('HTTP: rejects cross-site, wrong content type, bad bodies and GET on POST routes', async () => {
  const s = await startServer();
  try {
    const body = JSON.stringify({ username: 'Hana', password: PASSWORD });
    const send = (headers, payload = body) =>
      fetch(s.url('/api/register'), { method: 'POST', headers, body: payload });

    assert.strictEqual((await send({ 'Content-Type': 'application/json', Origin: 'http://evil.example' })).status, 403);
    assert.strictEqual((await send({ 'Content-Type': 'text/plain' })).status, 415);
    assert.strictEqual((await send({ 'Content-Type': 'application/json' }, 'not json')).status, 400);
    assert.strictEqual((await send({ 'Content-Type': 'application/json' }, '[]')).status, 400);
    assert.strictEqual((await send({ 'Content-Type': 'application/json' }, JSON.stringify({ x: 'y'.repeat(5000) }))).status, 413);
    assert.strictEqual((await fetch(s.url('/api/register'))).status, 405);
    assert.strictEqual((await fetch(s.url('/api/nope'))).status, 404);
    // Nothing above should have created the account.
    assert.strictEqual((await send({ 'Content-Type': 'application/json', Origin: s.url('') })).status, 201);
  } finally {
    await s.stop();
  }
});

test('HTTP: repeated attempts from one address are throttled', async () => {
  const s = await startServer();
  try {
    let last;
    for (let i = 0; i <= config.AUTH_RATE_MAX; i += 1) {
      last = await fetch(s.url('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nobody', password: 'x' }),
      });
    }
    assert.strictEqual(last.status, 429);
  } finally {
    await s.stop();
  }
});
