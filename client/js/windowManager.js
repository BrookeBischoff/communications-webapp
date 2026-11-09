// Window manager: creates 98.css-style windows on the desktop, keeps track of
// which one has focus, lets them be dragged and minimized, and mirrors each
// one as a button on the taskbar.

const MIN_VISIBLE = 80; // px of a window that must stay on screen when dragging

export class WindowManager {
  constructor({ desktop, tasks }) {
    this.desktop = desktop;
    this.tasks = tasks;
    this.windows = new Map();
    this.nextZ = 10;
    this.activeId = null;
    this.cascade = 0;
  }

  has(id) {
    return this.windows.has(id);
  }

  /**
   * Open a window, or bring it back if one with this id already exists.
   * `content` is a DOM element placed inside the window body.
   */
  open({ id, title, width = 360, height, content, onClose }) {
    if (this.windows.has(id)) {
      this.restore(id);
      return this.windows.get(id);
    }

    const el = document.createElement('div');
    el.className = 'window app-window';
    el.style.width = `${width}px`;
    if (height) el.style.height = `${height}px`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);

    const titleBar = document.createElement('div');
    titleBar.className = 'title-bar';
    const titleText = document.createElement('div');
    titleText.className = 'title-bar-text';
    titleText.textContent = title;
    const controls = document.createElement('div');
    controls.className = 'title-bar-controls';
    const minimizeButton = document.createElement('button');
    minimizeButton.type = 'button';
    minimizeButton.setAttribute('aria-label', 'Minimize');
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close');
    controls.append(minimizeButton, closeButton);
    titleBar.append(titleText, controls);

    const body = document.createElement('div');
    body.className = 'window-body';
    body.append(content);

    el.append(titleBar, body);
    this.desktop.append(el);

    const task = document.createElement('button');
    task.type = 'button';
    task.className = 'task';
    task.textContent = title;
    this.tasks.append(task);

    const entry = { id, el, titleText, task, onClose, minimized: false, z: 0 };
    this.windows.set(id, entry);

    // Cascade new windows so they do not stack exactly on top of each other.
    const offset = (this.cascade++ % 6) * 26;
    const x = Math.max(4, Math.round((this.desktop.clientWidth - el.offsetWidth) / 2) - 60 + offset);
    const y = Math.max(4, 36 + offset);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    el.addEventListener('pointerdown', () => this.focus(id), true);
    minimizeButton.addEventListener('click', () => this.minimize(id));
    closeButton.addEventListener('click', () => this.close(id));
    task.addEventListener('click', () => {
      if (entry.minimized || this.activeId !== id) this.restore(id);
      else this.minimize(id);
    });
    this._enableDragging(entry, titleBar);

    this.focus(id);
    return entry;
  }

  focus(id) {
    const entry = this.windows.get(id);
    if (!entry || entry.minimized) return;
    entry.z = ++this.nextZ;
    entry.el.style.zIndex = String(entry.z);
    this.activeId = id;
    this._refresh();
  }

  minimize(id) {
    const entry = this.windows.get(id);
    if (!entry) return;
    entry.minimized = true;
    entry.el.hidden = true;
    if (this.activeId === id) this.activeId = this._topVisibleId();
    this._refresh();
  }

  restore(id) {
    const entry = this.windows.get(id);
    if (!entry) return;
    entry.minimized = false;
    entry.el.hidden = false;
    this.focus(id);
  }

  close(id) {
    const entry = this.windows.get(id);
    if (!entry) return;
    this.windows.delete(id);
    entry.el.remove();
    entry.task.remove();
    if (this.activeId === id) this.activeId = this._topVisibleId();
    this._refresh();
    if (entry.onClose) entry.onClose();
  }

  setTitle(id, title) {
    const entry = this.windows.get(id);
    if (!entry) return;
    entry.titleText.textContent = title;
    entry.task.textContent = title;
  }

  _topVisibleId() {
    let best = null;
    for (const entry of this.windows.values()) {
      if (!entry.minimized && (!best || entry.z > best.z)) best = entry;
    }
    return best ? best.id : null;
  }

  _refresh() {
    for (const entry of this.windows.values()) {
      const active = entry.id === this.activeId;
      entry.el.querySelector('.title-bar').classList.toggle('inactive', !active);
      entry.task.classList.toggle('active', active);
    }
  }

  _enableDragging(entry, titleBar) {
    titleBar.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = entry.el.offsetLeft;
      const originY = entry.el.offsetTop;
      titleBar.setPointerCapture(event.pointerId);

      const move = (e) => {
        const maxX = this.desktop.clientWidth - MIN_VISIBLE;
        const maxY = this.desktop.clientHeight - 24;
        const x = Math.min(maxX, Math.max(MIN_VISIBLE - entry.el.offsetWidth, originX + e.clientX - startX));
        const y = Math.min(maxY, Math.max(0, originY + e.clientY - startY));
        entry.el.style.left = `${x}px`;
        entry.el.style.top = `${y}px`;
      };
      const end = () => {
        titleBar.removeEventListener('pointermove', move);
        titleBar.removeEventListener('pointerup', end);
        titleBar.removeEventListener('pointercancel', end);
      };
      titleBar.addEventListener('pointermove', move);
      titleBar.addEventListener('pointerup', end);
      titleBar.addEventListener('pointercancel', end);
    });
  }
}
