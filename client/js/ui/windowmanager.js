/**
 * MeshOS Window Manager
 * Creates and manages draggable/resizable windows inside #desktop, and
 * keeps the taskbar's running-apps list in sync.
 */
import { getIcon } from '../utils/icons.js';
import { APP_DEFS } from '../config.js';
import { Emitter } from '../utils/emitter.js';

let zCounter = 10;

export class WindowManager extends Emitter {
  constructor(desktopEl, taskbarAppsEl) {
    super();
    this.desktopEl = desktopEl;
    this.taskbarAppsEl = taskbarAppsEl;
    /** @type {Map<string, {el:HTMLElement, appId:string, taskbarEl:HTMLElement}>} */
    this.windows = new Map();
    this._cascadeOffset = 0;
  }

  /**
   * Opens (or focuses, if already open and singleton) a window for the given app.
   * @param {string} appId - key in APP_DEFS
   * @param {(body:HTMLElement, win:object) => void} mount - renders app content into body
   * @param {{singleton?:boolean, title?:string, params?:object}} [opts]
   */
  open(appId, mount, opts = {}) {
    const existingId = `win_${appId}`;
    if (opts.singleton !== false && this.windows.has(existingId)) {
      this.focus(existingId);
      return this.windows.get(existingId);
    }

    const def = APP_DEFS[appId] || { title: appId, icon: 'grid', width: 480, height: 400 };
    const winId = opts.singleton === false ? `win_${appId}_${Date.now()}` : existingId;

    const el = document.createElement('div');
    el.className = 'mesh-window';
    el.dataset.winId = winId;
    el.dataset.appId = appId;

    const w = Math.min(def.width, window.innerWidth - 40);
    const h = Math.min(def.height, window.innerHeight - 120);
    this._cascadeOffset = (this._cascadeOffset + 28) % 200;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.left = `${60 + this._cascadeOffset}px`;
    el.style.top = `${50 + this._cascadeOffset}px`;

    el.innerHTML = `
      <div class="win-titlebar">
        <div class="win-icon">${getIcon(def.icon, 12)}</div>
        <div class="win-title">${opts.title || def.title}</div>
        <div class="win-controls">
          <button class="win-min" title="Minimize" aria-label="Minimize">${getIcon('minimize', 13)}</button>
          <button class="win-max" title="Maximize" aria-label="Maximize">${getIcon('maximize', 13)}</button>
          <button class="win-close" title="Close" aria-label="Close">${getIcon('close', 13)}</button>
        </div>
      </div>
      <div class="win-body"></div>
      <div class="win-resize-handle"></div>
    `;

    this.desktopEl.appendChild(el);

    const body = el.querySelector('.win-body');
    const winRecord = {
      id: winId,
      appId,
      el,
      body,
      minimized: false,
      maximized: false,
      _restoreRect: null,
    };
    this.windows.set(winId, winRecord);

    this._wireChrome(winRecord);
    this._addTaskbarEntry(winRecord, def, opts.title);

    this.focus(winId);
    try {
      mount(body, winRecord);
    } catch (err) {
      console.error(`[MeshOS] failed to mount app "${appId}"`, err);
      body.innerHTML = `<div class="empty-state">${getIcon('alert', 32)}<p>This app failed to load.</p></div>`;
    }

    this.emit('open', winRecord);
    return winRecord;
  }

  _wireChrome(win) {
    const { el } = win;
    const titlebar = el.querySelector('.win-titlebar');
    win._cleanupFns = [];

    el.addEventListener('mousedown', () => this.focus(win.id));

    // Drag
    let dragging = false, startX, startY, startLeft, startTop;
    const onTitlebarMouseDown = (e) => {
      if (e.target.closest('.win-controls')) return;
      if (win.maximized) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startLeft = el.offsetLeft; startTop = el.offsetTop;
      e.preventDefault();
    };
    const onDragMove = (e) => {
      if (!dragging) return;
      el.style.left = `${Math.max(0, startLeft + (e.clientX - startX))}px`;
      el.style.top = `${Math.max(0, startTop + (e.clientY - startY))}px`;
    };
    const onDragUp = () => { dragging = false; };
    titlebar.addEventListener('mousedown', onTitlebarMouseDown);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragUp);

    // Resize
    const handle = el.querySelector('.win-resize-handle');
    let resizing = false, rStartX, rStartY, rW, rH;
    const onHandleMouseDown = (e) => {
      resizing = true;
      rStartX = e.clientX; rStartY = e.clientY;
      rW = el.offsetWidth; rH = el.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    };
    const onResizeMove = (e) => {
      if (!resizing) return;
      el.style.width = `${Math.max(320, rW + (e.clientX - rStartX))}px`;
      el.style.height = `${Math.max(200, rH + (e.clientY - rStartY))}px`;
      this.emit('resize', win);
    };
    const onResizeUp = () => { resizing = false; };
    handle.addEventListener('mousedown', onHandleMouseDown);
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', onResizeUp);

    win._cleanupFns.push(() => {
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onDragUp);
      window.removeEventListener('mousemove', onResizeMove);
      window.removeEventListener('mouseup', onResizeUp);
    });

    // Double-click titlebar = maximize toggle
    titlebar.addEventListener('dblclick', (e) => {
      if (e.target.closest('.win-controls')) return;
      this.toggleMaximize(win.id);
    });

    el.querySelector('.win-min').addEventListener('click', () => this.minimize(win.id));
    el.querySelector('.win-max').addEventListener('click', () => this.toggleMaximize(win.id));
    el.querySelector('.win-close').addEventListener('click', () => this.close(win.id));
  }

  _addTaskbarEntry(win, def, titleOverride) {
    const tb = document.createElement('button');
    tb.className = 'taskbar-app active';
    tb.innerHTML = `<span class="dot"></span>${getIcon(def.icon, 14)}<span>${titleOverride || def.title}</span>`;
    tb.addEventListener('click', () => {
      if (win.minimized) this.restore(win.id);
      else if (win.el.classList.contains('focused')) this.minimize(win.id);
      else this.focus(win.id);
    });
    this.taskbarAppsEl.appendChild(tb);
    win.taskbarEl = tb;
  }

  focus(winId) {
    const win = this.windows.get(winId);
    if (!win) return;
    this.windows.forEach((w) => {
      w.el.classList.remove('focused');
      w.taskbarEl?.classList.remove('active');
    });
    win.el.style.zIndex = ++zCounter;
    win.el.classList.add('focused');
    win.taskbarEl?.classList.add('active');
    if (win.minimized) this.restore(winId);
  }

  minimize(winId) {
    const win = this.windows.get(winId);
    if (!win) return;
    win.minimized = true;
    win.el.classList.add('minimized');
    win.taskbarEl?.classList.remove('active');
  }

  restore(winId) {
    const win = this.windows.get(winId);
    if (!win) return;
    win.minimized = false;
    win.el.classList.remove('minimized');
    this.focus(winId);
  }

  toggleMaximize(winId) {
    const win = this.windows.get(winId);
    if (!win) return;
    if (!win.maximized) {
      win._restoreRect = {
        left: win.el.style.left, top: win.el.style.top,
        width: win.el.style.width, height: win.el.style.height,
      };
      win.el.style.left = '0'; win.el.style.top = '0';
      win.el.style.width = '100%'; win.el.style.height = 'calc(100% - 56px)';
      win.maximized = true;
      win.el.classList.add('maximized');
    } else {
      const r = win._restoreRect;
      if (r) Object.assign(win.el.style, r);
      win.maximized = false;
      win.el.classList.remove('maximized');
    }
    this.emit('resize', win);
  }

  close(winId) {
    const win = this.windows.get(winId);
    if (!win) return;
    win._cleanupFns?.forEach((fn) => fn());
    win.el.remove();
    win.taskbarEl?.remove();
    this.windows.delete(winId);
    this.emit('close', win);
  }

  closeByApp(appId) {
    this.close(`win_${appId}`);
  }

  bringAppToFront(appId) {
    this.focus(`win_${appId}`);
  }
}