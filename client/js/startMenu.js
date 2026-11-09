// Start menu: a small pop-up above the Start button. The items are computed
// each time it opens, so they always match whether the user is logged on.

export function createStartMenu({ button, getItems }) {
  const menu = document.createElement('ul');
  menu.id = 'start-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  document.body.append(menu);

  function close() {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  function open() {
    menu.replaceChildren();
    for (const item of getItems()) {
      const li = document.createElement('li');
      li.setAttribute('role', 'none');
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.setAttribute('role', 'menuitem');
      choice.textContent = item.label;
      choice.disabled = Boolean(item.disabled);
      choice.addEventListener('click', () => {
        close();
        item.action();
      });
      li.append(choice);
      menu.append(li);
    }
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }

  button.addEventListener('click', () => (menu.hidden ? open() : close()));

  document.addEventListener('pointerdown', (event) => {
    if (menu.hidden) return;
    if (menu.contains(event.target) || button.contains(event.target)) return;
    close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      close();
      button.focus();
    }
  });
}
