# Web-Based Communications Application

A small Discord/Skype-style app: real-time chat first, then friends, group chats, and voice calls.
This is the starter: a Node.js server and a Windows 95-style browser client with a shared lobby chat.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cd server
npm install #only run on first startup
npm start
```

Open <http://localhost:3000> in **two browser tabs**, log on with a different name in each, and chat.
To run the automated server tests: `npm test`. To restart automatically while editing: `npm run dev`.

## Layout

```
client/                     served as static files by the server
  index.html                desktop + taskbar shell
  css/app.css               our styles, layered on 98.css
  js/main.js                wires everything together
  js/state.js               the store: one state object, windows re-render from it
  js/ws.js                  WebSocket connection with automatic reconnect
  js/windowManager.js       open/focus/drag/minimize windows and taskbar buttons
  js/startMenu.js           Start menu
  js/windows/               one file per window (login, chat; friends and calls later)
server/
  src/index.js              static file server + starts the gateway
  src/config.js             ports and limits
  src/ws/gateway.js         WebSocket router: sessions, presence, messages
  test/                     gateway tests (node --test)
```

## How the pieces talk

Every WebSocket frame is JSON: `{ "type": "...", "id": "...", "payload": { ... } }`.

| Direction | type | payload |
| --- | --- | --- |
| client to server | `session.join` | `{ username }` |
| client to server | `session.leave` | none |
| client to server | `message.send` | `{ conversationId, body }` |
| server to client | `session.ok` | `{ username, conversationId, users, history }` |
| server to client | `presence` | `{ users }` |
| server to client | `message.new` | `{ id, conversationId, from, body, ts }` |
| server to client | `error` | `{ code, message }` (`id` echoes the request) |

New features add new `type` values: add a handler in `gateway.js` on the server and a case in
`handleServerMessage` in `main.js` on the client.

## What is temporary

- **No accounts yet.** Anyone can pick any free name. Registration and login (salted password hashes)
  replace `session.join`.
- **History is in memory** (last 50 lobby messages) and disappears when the server restarts.
  SQLite persistence replaces it.
- **One conversation** (`lobby`). The message format already carries a `conversationId` so direct
  and group chats slot in later.

## Notes

- The server listens on `127.0.0.1` only. To test from a phone on the same Wi-Fi, run
  `HOST=0.0.0.0 npm start` and open `http://<your-computer-ip>:3000`. Microphone access (needed for
  calls later) requires HTTPS, except on `localhost`.
- 98.css is MIT licensed (<https://github.com/jdan/98.css>).
