// Entry point: wires the store, the WebSocket connection, the window manager
// and the windows together. Windows draw from the store; incoming server
// messages update the store.

import { createStore } from './state.js';
import { createConnection } from './ws.js';
import { WindowManager } from './windowManager.js';
import { createStartMenu } from './startMenu.js';
import { openLoginWindow } from './windows/loginWindow.js';
import { openChatWindow } from './windows/chatWindow.js';

const MAX_MESSAGES = 200;

const store = createStore({
  status: 'connecting', // connecting | connected | disconnected
  username: null,
  conversationId: 'lobby',
  users: [],
  messages: [],
  loginError: '',
});

const manager = new WindowManager({
  desktop: document.getElementById('desktop'),
  tasks: document.getElementById('tasks'),
});

// The name to log on with again if the connection drops and comes back.
let wantedName = null;

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
      wantedName = payload.username;
      store.set({
        username: payload.username,
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
      handleServerError(payload);
      break;

    default:
      break; // session.left and anything newer than this client: ignore
  }
}

function handleServerError({ code, message }) {
  if (code === 'username_taken' || code === 'invalid_username') {
    // Logging on (or logging back on after a reconnect) failed: start over.
    wantedName = null;
    store.set({ username: null, users: [], loginError: message });
    manager.close('chat');
    showLogin();
  } else if (!store.get().username) {
    store.set({ loginError: message });
  } else if (code !== 'already_joined' && code !== 'not_joined') {
    addNotice(message);
  }
}

// ---------- Connection ----------

const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const connection = createConnection({
  url: `${protocol}://${location.host}/ws`,
  onStatus: (status) => store.set({ status }),
  onOpen: () => {
    if (wantedName) connection.send('session.join', { username: wantedName });
  },
  onMessage: handleServerMessage,
});

// ---------- Actions ----------

function showLogin() {
  if (manager.has('login')) manager.restore('login');
  else {
    openLoginWindow({
      manager,
      store,
      onSubmit: (name) => {
        wantedName = name;
        store.set({ loginError: '' });
        connection.send('session.join', { username: name });
      },
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

function logOff() {
  wantedName = null;
  connection.send('session.leave');
  store.set({ username: null, users: [], messages: [], loginError: '' });
  manager.close('chat');
  showLogin();
}

// ---------- Taskbar ----------

createStartMenu({
  button: document.getElementById('start-button'),
  getItems: () =>
    store.get().username
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

showLogin();
