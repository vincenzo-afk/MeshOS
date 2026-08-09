/**
 * Shared Clipboard
 * Broadcasts copied text/URLs/code to the whole workspace (or specific
 * peers). History persists for the session at module scope.
 */
import { getIcon } from '../utils/icons.js';
import { escapeHtml, linkify, timeAgo, uid } from '../utils/helpers.js';

const items = [];
let wired = false;
const renderers = new Set();

function wire(ctx) {
  if (wired) return;
  wired = true;
  ctx.peerManager.on('message', (peerId, label, msg) => {
    if (label !== 'main' || msg.type !== 'clip:item') return;
    const peer = ctx.peerDirectory.get(peerId);
    items.unshift({ id: msg.id, ts: msg.ts, from: peer?.computerName || 'Someone', text: msg.text });
    renderers.forEach((r) => r());
    ctx.notifications.toast('info', 'Clipboard shared', `${peer?.computerName || 'Someone'} shared something to the clipboard.`);
  });
}

export function mount(body, win, ctx) {
  wire(ctx);
  body.classList.add('app-shell');
  body.innerHTML = `
    <div class="app-toolbar">
      <div class="ico">${getIcon('clipboard', 15)}</div>
      <b style="font-size:12.5px;">Shared clipboard</b>
      <div class="spacer"></div>
      <button class="icon-mini-btn" id="clip-clear" title="Clear history">${getIcon('trash', 14)}</button>
    </div>
    <div class="clip-list" id="clip-list"></div>
    <div class="clip-compose">
      <textarea id="clip-input" placeholder="Paste or type text, a URL, or a code snippet…"></textarea>
      <button class="btn btn-primary btn-sm" id="clip-send">${getIcon('send', 14)}</button>
    </div>
  `;

  const listEl = body.querySelector('#clip-list');
  const inputEl = body.querySelector('#clip-input');

  function render() {
    listEl.innerHTML = items.length
      ? items.map((it) => `
        <div class="clip-item" data-id="${escapeHtml(it.id)}">
          <div class="ci-top"><span>${escapeHtml(it.from)}</span><span>${timeAgo(it.ts)}</span></div>
          <pre>${linkify(it.text)}</pre>
          <div style="margin-top:6px;"><button class="btn btn-ghost btn-sm clip-copy">${getIcon('copy', 12)} Copy</button></div>
        </div>`).join('')
      : `<div class="empty-state">${getIcon('clipboard', 30)}<p>Nothing shared yet. Anything you send here reaches every connected device instantly.</p></div>`;

    listEl.querySelectorAll('.clip-item').forEach((el) => {
      el.querySelector('.clip-copy').addEventListener('click', async () => {
        const it = items.find((x) => x.id === el.dataset.id);
        try { await navigator.clipboard.writeText(it.text); ctx.notifications.toast('success', 'Copied', 'Added to your local clipboard.'); } catch (_err) { /* clipboard permission denied */ }
      });
    });
  }

  body.querySelector('#clip-send').addEventListener('click', () => {
    const text = inputEl.value.trim();
    if (!text) return;
    const id = uid('clip');
    const ts = Date.now();
    items.unshift({ id, ts, from: 'You', text });
    inputEl.value = '';
    render();
    ctx.peerManager.broadcastJSON({ type: 'clip:item', id, ts, text });
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) body.querySelector('#clip-send').click();
  });
  body.querySelector('#clip-clear').addEventListener('click', () => { items.length = 0; render(); });

  renderers.add(render);
  ctx.windowManager.on('close', (w) => { if (w.id === win.id) renderers.delete(render); });
  render();
}
