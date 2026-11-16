# Web-Based Communications Application

A small Discord/Skype-style app: real-time chat first, then friends, group chats, and voice calls.
This is the starter: a Node.js server and a Windows 95-style browser client with accounts and a shared lobby chat.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cd server
npm install #only run on first startup
npm start
```

Open <http://localhost:3000> in **two browser windows** (use a private window for the second, since
the login cookie is shared between tabs), choose **Register...** in each to create an account, and chat.
To run the automated server tests: `npm test`. To restart automatically while editing: `npm run dev`.

The database is created on first start at `server/data/chat.sqlite` (gitignored). Delete that file to
start over with no accounts.

## Layout

```
client/                     served as static files by the server
  index.html                desktop + taskbar shell
  css/app.css               our styles, layered on 98.css
  js/main.js                wires everything together
  js/api.js                 fetch helpers for /api/* (register, login, logout, me)
  js/state.js               the store: one state object, windows re-render from it
  js/ws.js                  WebSocket connection with automatic reconnect (start/close)
  js/windowManager.js       open/focus/drag/minimize windows and taskbar buttons
  js/startMenu.js           Start menu
  js/windows/               one file per window (login/register, chat; friends and calls later)
server/
  src/index.js              static files + /api routes + starts the gateway
  src/config.js             ports, limits, cookie and rate-limit settings
  src/auth/passwords.js     argon2id hashing and verification
  src/auth/service.js       register, login, sessions (no HTTP in here)
  src/auth/routes.js        POST /api/register|login|logout, GET /api/me, cookie and origin checks
  src/db/index.js           opens SQLite (WAL) and runs numbered migrations
  src/db/migrations/        001_accounts.sql: users, sessions
  src/ws/gateway.js         WebSocket router: authenticated sessions, presence, messages
  test/                     auth and gateway tests (node --test)
```

## How accounts work

- `POST /api/register` `{ username, password, displayName }` and `POST /api/login` `{ username, password }`
  return `{ user }` and set a `sid` cookie (HttpOnly, SameSite=Lax, 30 days). `POST /api/logout` ends it
  and closes that session's sockets. `GET /api/me` says who the cookie belongs to.
- Passwords are hashed with argon2id (random salt per password). Only the hash is stored.
- The cookie holds a random token; the database stores only its SHA-256, so a copied database file
  cannot be used to take over a session.
- User names are 3-20 characters (letters, numbers, `_`), unique ignoring case. Display names are up to
  30 characters and are what other people see. Passwords are 10-128 characters.
- Login failures give one generic message, and unknown user names still cost one hash check.
- Registration and login are limited to 20 attempts per IP per 15 minutes.
- POSTs must be `application/json` and, if the browser sends an `Origin`, it must match the `Host`.
  The same Origin check applies to WebSocket upgrades.

## How the pieces talk

The WebSocket accepts only browsers with a valid session cookie (checked during the upgrade) and sends
`session.ok` as soon as it opens. Every frame is JSON: `{ "type": "...", "id": "...", "payload": { ... } }`.

| Direction | type | payload |
| --- | --- | --- |
| client to server | `message.send` | `{ conversationId, body }` |
| server to client | `session.ok` | `{ user: { id, username, displayName }, conversationId, users, history }` |
| server to client | `presence` | `{ users: [{ id, displayName }] }` |
| server to client | `message.new` | `{ id, conversationId, fromId, from, body, ts }` |
| server to client | `error` | `{ code, message }` (`id` echoes the request) |

New features add new `type` values: add a handler in `gateway.js` on the server and a case in
`handleServerMessage` in `main.js` on the client.

## What is temporary

- **History is in memory** (last 50 lobby messages) and disappears when the server restarts.
  SQLite persistence (a `messages` migration) replaces it.
- **One conversation** (`lobby`). The message format already carries a `conversationId` so direct
  and group chats slot in later.
- **Sessions are checked when a socket connects**, not on every message. Logging off closes that
  session's sockets immediately; an expired session is noticed on the next reconnect.

## Notes

- The server listens on `127.0.0.1` only. To test from a phone on the same Wi-Fi, run
  `HOST=0.0.0.0 npm start` and open `http://<your-computer-ip>:3000`. Microphone access (needed for
  calls later) requires HTTPS, except on `localhost`.
- On the Droplet, behind the HTTPS reverse proxy, set `COOKIE_SECURE=true` and `TRUST_PROXY=true`,
  and make the proxy pass the original `Host` header and set `X-Forwarded-For`.
- `argon2` and `better-sqlite3` are native modules and normally install from prebuilt binaries. If
  `npm install` tries to compile and fails on Windows, install the "Desktop development with C++"
  workload from the Visual Studio Build Tools, or use a Node LTS release.
- 98.css is MIT licensed (<https://github.com/jdan/98.css>).
