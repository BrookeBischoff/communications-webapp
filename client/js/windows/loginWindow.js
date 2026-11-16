// "Log on" window with a Register mode. It collects the details and reports
// them through callbacks; main.js does the request and the store carries the
// result back (loginError, busy).

function row(id, labelText, { type = 'text', autocomplete = 'off', maxLength } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field-row-stacked';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  const input = document.createElement('input');
  input.id = id;
  input.type = type;
  input.autocomplete = autocomplete;
  input.spellcheck = false;
  if (maxLength) input.maxLength = maxLength;
  wrapper.append(label, input);
  return { wrapper, input };
}

export function openLoginWindow({ manager, store, onLogin, onRegister }) {
  let mode = 'login'; // login | register

  const form = document.createElement('form');
  form.className = 'login-body';
  form.noValidate = true;

  const intro = document.createElement('p');

  const username = row('login-name', 'User name:', { autocomplete: 'username', maxLength: 20 });
  const displayName = row('login-display', 'Display name (shown to others):', {
    autocomplete: 'nickname',
    maxLength: 30,
  });
  const password = row('login-password', 'Password:', { type: 'password', maxLength: 128 });
  const confirm = row('login-confirm', 'Confirm password:', {
    type: 'password',
    autocomplete: 'new-password',
    maxLength: 128,
  });

  const error = document.createElement('p');
  error.className = 'login-error';
  error.setAttribute('role', 'alert');

  const actions = document.createElement('div');
  actions.className = 'login-actions';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'default';
  actions.append(toggle, submit);

  form.append(
    intro,
    username.wrapper,
    displayName.wrapper,
    password.wrapper,
    confirm.wrapper,
    error,
    actions
  );

  function applyMode() {
    const registering = mode === 'register';
    displayName.wrapper.hidden = !registering;
    confirm.wrapper.hidden = !registering;
    password.input.autocomplete = registering ? 'new-password' : 'current-password';
    intro.textContent = registering
      ? 'Create an account. Passwords need at least 10 characters.'
      : 'Log on to join the chat.';
    submit.textContent = registering ? 'Register' : 'Log on';
    toggle.textContent = registering ? 'Back to log on' : 'Register...';
    manager.setTitle('login', registering ? 'Create an account' : 'Log on to Chat');
  }

  toggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    applyMode();
    store.set({ loginError: '' });
    username.input.focus();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (store.get().busy) return;
    const name = username.input.value.trim();
    const pass = password.input.value;
    if (!name || !pass) {
      store.set({ loginError: 'Enter a user name and password.' });
      return;
    }
    if (mode === 'login') {
      onLogin({ username: name, password: pass });
    } else if (pass !== confirm.input.value) {
      store.set({ loginError: 'The passwords do not match.' });
    } else {
      onRegister({ username: name, password: pass, displayName: displayName.input.value });
    }
  });

  let unsubscribe = () => {};
  manager.open({
    id: 'login',
    title: 'Log on to Chat',
    width: 320,
    content: form,
    onClose: () => unsubscribe(),
  });
  applyMode();

  function render(state) {
    submit.disabled = state.busy;
    toggle.disabled = state.busy;
    error.textContent = state.loginError;
  }
  unsubscribe = store.subscribe(render);
  render(store.get());
  username.input.focus();
}
