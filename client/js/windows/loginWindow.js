// "Log on" window. For now it only asks for a user name; real accounts
// (password, registration) replace this in the next step.

const STATUS_TEXT = {
  connected: '',
  connecting: 'Connecting to the server...',
  disconnected: 'Connection lost. Trying to reconnect...',
};

export function openLoginWindow({ manager, store, onSubmit }) {
  const form = document.createElement('form');
  form.className = 'login-body';
  form.noValidate = true;

  const intro = document.createElement('p');
  intro.textContent = 'Type a user name to join the chat.';

  const row = document.createElement('div');
  row.className = 'field-row';
  const label = document.createElement('label');
  label.htmlFor = 'login-name';
  label.textContent = 'User name:';
  const input = document.createElement('input');
  input.id = 'login-name';
  input.type = 'text';
  input.maxLength = 20;
  input.autocomplete = 'off';
  input.spellcheck = false;
  row.append(label, input);

  const error = document.createElement('p');
  error.className = 'login-error';
  error.setAttribute('role', 'alert');

  const note = document.createElement('p');
  note.className = 'login-note';

  const actions = document.createElement('div');
  actions.className = 'login-actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'default';
  submit.textContent = 'Log on';
  actions.append(submit);

  form.append(intro, row, error, note, actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name || submit.disabled) return;
    onSubmit(name);
  });

  let unsubscribe = () => {};
  manager.open({
    id: 'login',
    title: 'Log on to Chat',
    width: 320,
    content: form,
    onClose: () => unsubscribe(),
  });

  function render(state) {
    submit.disabled = state.status !== 'connected';
    error.textContent = state.loginError;
    note.textContent = STATUS_TEXT[state.status] ?? '';
  }
  unsubscribe = store.subscribe(render);
  render(store.get());
  input.focus();
}
