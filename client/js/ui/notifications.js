/**
 * MeshOS Notification System
 * Desktop-style toast popups + a persistent notification-center panel
 * accessible from the system tray.
 */
import { getIcon } from '../utils/icons.js';
import { formatClock, escapeHtml } from '../utils/helpers.js';

const ICON_BY_KIND = { success: 'checkCircle', error: 'alert', info: 'bell', warning: 'alert' };

export class NotificationCenter {
  constructor(toastStackEl, panelEl, trayBadgeEl) {
    this.toastStack = toastStackEl;
    this.panel = panelEl;
    this.trayBadge = trayBadgeEl;
    this.items = [];
  }

  toast(kind, title, message, { silent = false, timeout = 5000 } = {}) {
    if (!silent) {
      const el = document.createElement('div');
      el.className = `toast glass ${kind}`;
      el.innerHTML = `
        <div class="t-ico">${getIcon(ICON_BY_KIND[kind] || 'bell', 15)}</div>
        <div class="t-body"><b>${escapeHtml(title)}</b><p>${escapeHtml(message || '')}</p></div>
      `;
      this.toastStack.appendChild(el);
      setTimeout(() => {
        el.style.transition = 'opacity .25s ease, transform .25s ease';
        el.style.opacity = '0';
        el.style.transform = 'translateX(30px)';
        setTimeout(() => el.remove(), 260);
      }, timeout);
    }

    this.items.unshift({ kind, title, message, ts: Date.now() });
    this.items = this.items.slice(0, 40);
    this._renderPanel();
    this._updateBadge();
  }

  _updateBadge() {
    if (!this.trayBadge) return;
    const count = this.items.length;
    if (count === 0) {
      this.trayBadge.style.display = 'none';
    } else {
      this.trayBadge.style.display = 'flex';
      this.trayBadge.textContent = count > 9 ? '9+' : count;
    }
  }

  clearAll() {
    this.items = [];
    this._renderPanel();
    this._updateBadge();
  }

  _renderPanel() {
    if (!this.panel) return;
    const body = this.panel.querySelector('.notif-body');
    if (!body) return;
    if (this.items.length === 0) {
      body.innerHTML = `<div class="notif-empty">You're all caught up.</div>`;
      return;
    }
    body.innerHTML = this.items
      .map(
        (n) => `
        <div class="notif-item">
          <div class="n-top"><span>${escapeHtml(n.title)}</span><span class="n-time">${formatClock(n.ts)}</span></div>
          <div>${escapeHtml(n.message || '')}</div>
        </div>`
      )
      .join('');
  }
}