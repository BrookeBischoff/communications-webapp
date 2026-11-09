// Chat window: message log, list of people online, and a message box.
// It never changes state itself. It draws from the store and reports what the
// user did through callbacks, so it can be reused for private and group chats.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function openChatWindow({ manager, store, onSend }) {
  const root = el('div', 'chat');

  const columns = el('div', 'chat-columns');
  const log = el('div', 'sunken-panel chat-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-label', 'Messages');

  const side = el('div', 'chat-side');
  const fieldset = el('fieldset');
  fieldset.append(el('legend', '', 'Online'));
  const userList = el('ul', 'tree-view chat-users');
  fieldset.append(userList);
  side.append(fieldset);
  columns.append(log, side);

  const form = el('form', 'chat-form');
  const input = el('input');
  input.type = 'text';
  input.maxLength = 2000;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Message');
  const sendButton = el('button', 'default', 'Send');
  sendButton.type = 'submit';
  form.append(input, sendButton);

  const statusBar = el('div', 'status-bar');
  const statusConnection = el('p', 'status-bar-field');
  const statusCount = el('p', 'status-bar-field');
  statusBar.append(statusConnection, statusCount);

  root.append(columns, form, statusBar);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    if (onSend(text) !== false) input.value = '';
    input.focus();
  });

  let unsubscribe = () => {};
  manager.open({
    id: 'chat',
    title: 'Chat - Lobby',
    width: 520,
    height: 380,
    content: root,
    onClose: () => unsubscribe(),
  });

  let drawnMessages = null;
  let drawnUsers = null;
  let drawnName = null;

  function renderLog(state) {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    if (state.messages.length === 0) {
      log.replaceChildren(el('p', 'chat-empty', 'No messages yet. Say hello.'));
      return;
    }
    const lines = state.messages.map((message) => {
      if (message.system) return el('p', 'chat-line system', message.body);
      const line = el('p', message.from === state.username ? 'chat-line mine' : 'chat-line');
      line.append(
        el('span', 'chat-time', formatTime(message.ts)),
        el('span', 'chat-name', `${message.from}:`),
        el('span', 'chat-body', message.body)
      );
      return line;
    });
    log.replaceChildren(...lines);
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }

  function renderUsers(state) {
    const items = state.users.map((name) => el('li', name === state.username ? 'me' : '', name));
    userList.replaceChildren(...items);
  }

  function render(state) {
    if (state.messages !== drawnMessages || state.username !== drawnName) renderLog(state);
    if (state.users !== drawnUsers || state.username !== drawnName) renderUsers(state);
    drawnMessages = state.messages;
    drawnUsers = state.users;
    drawnName = state.username;

    if (state.status === 'connected') {
      statusConnection.textContent = `Logged on as ${state.username}`;
    } else if (state.status === 'connecting') {
      statusConnection.textContent = 'Connecting...';
    } else {
      statusConnection.textContent = 'Disconnected. Reconnecting...';
    }
    statusCount.textContent = `${state.users.length} online`;
  }

  unsubscribe = store.subscribe(render);
  render(store.get());
  input.focus();
}
