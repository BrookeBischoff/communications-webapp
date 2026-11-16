// Entry point: wires the store, the WebSocket connection, the window manager
// and the windows together. Windows draw from the store; incoming server
// messages update the store.
//
// Logging on is an HTTP request (/api/login or /api/register). That sets the
// session cookie; only then does the WebSocket connect, and the server
// announces who we are with `session.ok`.

import { createStore } from './state.js';
import { createConnection } from './ws.js';
import { api } from './api.js';
import { WindowManager } from './windowManager.js';
import { createStartMenu } from './startMenu.js';
import { openLoginWindow } from './windows/loginWindow.js';
import { openChatWindow } from './windows/chatWindow.js';

const MAX_MESSAGES = 200;

const store = createStore({
  status: 'disconnected', // connecting | connected | disconnected
  user: null, // { id, username, displayName } once logged on
  conversationId: 'lobby',
  users: [], // [{ id, displayName }] currently online
  messages: [],
  loginError: '',
  busy: false, // a login or registration request is in flight
});

const manager = new WindowManager({
  desktop: document.getElementById('desktop'),
  tasks: document.getElementById('tasks'),
});

function addNotice(body) {
  store.set((state) => ({
    messages: [
      ...state.messages,
      { id: `notice-${Date.now()}-${Math.random()}`, system: true, body, ts: Date.now() },
    ].slice(-MAX_MESSAGES),
  }));
}

// ---------- Server messages ----------

function handleServerMessage(frame) {
  const payload = frame.payload;
  switch (frame.type) {
    case 'session.ok':
      store.set({
        user: payload.user,
        conversationId: payload.conversationId,
        users: payload.users,
        messages: payload.history.slice(-MAX_MESSAGES),
        loginError: '',
      });
      manager.close('login');
      showChat();
      break;

    case 'presence':
      store.set({ users: payload.users });
      break;

    case 'message.new':
      store.set((state) => ({ messages: [...state.messages, payload].slice(-MAX_MESSAGES) }));
      break;

    case 'error':
      addNotice(payload.message);
      break;

    default:
      break; // anything newer than this client: ignore
  }
}

// ---------- Connection ----------

const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const connection = createConnection({
  url: `${protocol}://${location.host}/ws`,
  onStatus: (status) => store.set({ status }),
  onOpen: () => {},
  onMessage: handleServerMessage,
  onClose: checkSession,
});

// A dropped socket is usually just the network (the connection retries by
// itself). But if the session itself has ended (expired, or logged off in
// another tab), the server refuses the reconnect, so go back to the log-on window.
async function checkSession() {
  const me = await api.get('/api/me');
  if (me.status === 401) endSession('Your session has ended. Please log on again.');
}

function endSession(message = '') {
  connection.close();
  store.set({ user: null, users: [], messages: [], loginError: message });
  manager.close('chat');
  showLogin();
}

// ---------- Actions ----------

async function authenticate(path, body) {
  if (store.get().busy) return;
  store.set({ busy: true, loginError: '' });
  const result = await api.post(path, body);
  if (result.ok) {
    store.set({ busy: false });
    connection.start(); // the login window closes when session.ok arrives
  } else {
    store.set({ busy: false, loginError: result.error });
  }
}

function showLogin() {
  if (manager.has('login')) manager.restore('login');
  else {
    openLoginWindow({
      manager,
      store,
      onLogin: (credentials) => authenticate('/api/login', credentials),
      onRegister: (details) => authenticate('/api/register', details),
    });
  }
}

function showChat() {
  if (manager.has('chat')) manager.restore('chat');
  else {
    openChatWindow({
      manager,
      store,
      onSend: (text) => {
        const sent = connection.send('message.send', {
          conversationId: store.get().conversationId,
          body: text,
        });
        if (!sent) addNotice('Not connected. Your message was not sent.');
        return sent;
      },
    });
  }
}

async function logOff() {
  endSession(); // stop the socket first so it does not try to reconnect
  await api.post('/api/logout');
}

// ---------- Taskbar ----------

createStartMenu({
  button: document.getElementById('start-button'),
  getItems: () =>
    store.get().user
      ? [
          { label: 'Chat', action: showChat },
          { label: 'Log off', action: logOff },
        ]
      : [{ label: 'Log on...', action: showLogin }],
});

const trayStatus = document.getElementById('tray-status');
const STATUS_LABEL = { connected: 'Online', connecting: 'Connecting...', disconnected: 'Offline' };
store.subscribe((state) => {
  trayStatus.textContent = STATUS_LABEL[state.status];
});

const trayClock = document.getElementById('tray-clock');
function updateClock() {
  trayClock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
updateClock();
setInterval(updateClock, 15000);

// ---------- Start up ----------

// Already logged on (cookie still valid)? Reconnect straight away. Otherwise ask.
api.get('/api/me').then((me) => {
  if (me.ok) connection.start();
  else showLogin();
});
