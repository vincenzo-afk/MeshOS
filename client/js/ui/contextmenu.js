/**
 * MeshOS Context Menu
 * Generic right-click menu builder used by the desktop, network explorer,
 * file transfer list, chat, etc.
 */
import { getIcon } from '../utils/icons.js';

let menuEl = null;

function ensureMenuEl() {
  if (menuEl) return menuEl;
  menuEl = document.createElement('div');
  menuEl.className = 'context-menu glass';
  document.body.appendChild(menuEl);
  document.addEventListener('click', () => closeContextMenu());
  document.addEventListener('contextmenu', (e) => {
    if (!menuEl.contains(e.target)) closeContextMenu();
  });
  window.addEventListener('blur', () => closeContextMenu());
  return menuEl;
}

export function closeContextMenu() {
  if (menuEl) menuEl.classList.remove('open');
}

/**
 * @param {number} x
 * @param {number} y
 * @param {Array<{label:string, icon?:string, action?:Function, danger?:boolean}|'separator'>} items
 */
export function showContextMenu(x, y, items) {
  const el = ensureMenuEl();
  el.innerHTML = items
    .map((item) => {
      if (item === 'separator') return '<hr/>';
      return `<button data-idx data-danger="${!!item.danger}">${item.icon ? getIcon(item.icon, 14) : ''}<span>${item.label}</span></button>`;
    })
    .join('');

  const buttons = el.querySelectorAll('button');
  let bi = 0;
  items.forEach((item) => {
    if (item === 'separator') return;
    const btn = buttons[bi++];
    btn.style.color = item.danger ? 'var(--danger)' : '';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      item.action?.();
    });
  });

  el.classList.add('open');
  const rect = el.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  el.style.left = `${Math.min(x, maxX)}px`;
  el.style.top = `${Math.min(y, maxY)}px`;
}