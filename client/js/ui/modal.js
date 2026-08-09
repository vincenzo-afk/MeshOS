/**
 * MeshOS Modal Dialog
 * Generic overlay + modal builder used for room settings, password
 * prompts, approval requests, confirmations, and other one-off dialogs
 * that don't warrant a full desktop window.
 */
import { escapeHtml } from '../utils/helpers.js';

let overlayEl = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'overlay';
  overlayEl.innerHTML = '<div class="modal glass"></div>';
  document.body.appendChild(overlayEl);
  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === overlayEl && overlayEl.dataset.dismissible !== '0') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open') && overlayEl.dataset.dismissible !== '0') {
      closeModal();
    }
  });
  return overlayEl;
}

export function closeModal() {
  if (overlayEl) overlayEl.classList.remove('open');
}

export function isModalOpen() {
  return Boolean(overlayEl && overlayEl.classList.contains('open'));
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.bodyHTML]
 * @param {Array<{label:string, variant?:'primary'|'ghost'|'danger', onClick?:Function, closeOnClick?:boolean}>} [opts.actions]
 * @param {boolean} [opts.dismissible=true]
 * @returns {HTMLElement} the `.modal` element, so callers can wire up inputs inside bodyHTML
 */
export function openModal({ title, bodyHTML = '', actions = [], dismissible = true }) {
  const overlay = ensureOverlay();
  const modal = overlay.querySelector('.modal');
  modal.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <div class="modal-body">${bodyHTML}</div>
    <div class="modal-actions"></div>
  `;
  const actionsEl = modal.querySelector('.modal-actions');
  actions.forEach((a) => {
    const btn = document.createElement('button');
    const variantClass = a.variant === 'primary' ? 'btn-primary' : a.variant === 'danger' ? 'btn-danger' : 'btn-ghost';
    btn.className = `btn ${variantClass} btn-sm`;
    btn.textContent = a.label;
    btn.addEventListener('click', () => {
      a.onClick?.();
      if (a.closeOnClick !== false) closeModal();
    });
    actionsEl.appendChild(btn);
  });
  overlay.dataset.dismissible = dismissible ? '1' : '0';
  overlay.classList.add('open');
  return modal;
}

/** Convenience wrapper: returns a Promise<boolean> resolved by the user's choice. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    openModal({
      title,
      bodyHTML: `<p class="desc">${escapeHtml(message)}</p>`,
      dismissible: true,
      actions: [
        { label: 'Cancel', variant: 'ghost', onClick: () => { settled = true; resolve(false); } },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => { settled = true; resolve(true); } },
      ],
    });
    // If dismissed via backdrop/Escape without clicking a button, treat as cancel.
    const check = () => {
      if (!isModalOpen() && !settled) {
        settled = true;
        resolve(false);
      } else if (isModalOpen()) {
        setTimeout(check, 150);
      }
    };
    setTimeout(check, 150);
  });
}
