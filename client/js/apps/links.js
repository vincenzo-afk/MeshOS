/**
 * Shared Links
 * Broadcasts URLs to the workspace. Rich previews (title/description/
 * image) are fetched through a small stateless server proxy — the
 * server never stores anything, it just fetches the page once on the
 * sharer's behalf and returns the Open Graph tags (browsers can't fetch
 * arbitrary cross-origin HTML themselves).
 */
import { getIcon } from '../utils/icons.js';
import { escapeHtml, timeAgo, uid } from '../utils/helpers.js';

const links = [];
let wired = false;
const renderers = new Set();

/** Only ever render http(s) links as clickable — anything else (javascript:,
 *  data:, vbscript:, etc.) could execute arbitrary code just by being
 *  clicked, and a malicious peer can send a raw `link:share` message with
 *  any `url` value directly, bypassing whatever the sender's own textarea
 *  would have normalized. */
function isSafeUrl(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch (_err) {
    return false;
  }
}

function wire(ctx) {
  if (wired) return;
  wired = true;
  ctx.peerManager.on('message', (peerId, label, msg) => {
    if (label !== 'main' || msg.type !== 'link:share') return;
    if (typeof msg.url !== 'string' || !isSafeUrl(msg.url)) return;
    const peer = ctx.peerDirectory.get(peerId);
    links.unshift({ id: msg.id, ts: msg.ts, from: peer?.computerName || 'Someone', url: msg.url, preview: msg.preview || null });
    renderers.forEach((r) => r());
    ctx.notifications.toast('info', 'Link shared', `${peer?.computerName || 'Someone'} shared a link.`);
  });
}

async function fetchPreview(url) {
  try {
    const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (_err) {
    return null;
  }
}

export function mount(body, win, ctx) {
  wire(ctx);
  body.classList.add('app-shell');
  body.innerHTML = `
    <div class="app-toolbar">
      <div class="ico">${getIcon('link', 15)}</div>
      <b style="font-size:12.5px;">Shared links</b>
      <div class="spacer"></div>
      <input type="text" id="link-search" placeholder="Search…" style="width:120px;" />
    </div>
    <div class="clip-list" id="link-list"></div>
    <div class="clip-compose">
      <textarea id="link-input" style="height:36px;" placeholder="Paste a URL…"></textarea>
      <button class="btn btn-primary btn-sm" id="link-send">${getIcon('send', 14)}</button>
    </div>`;

  const listEl = body.querySelector('#link-list');
  const inputEl = body.querySelector('#link-input');
  const searchEl = body.querySelector('#link-search');
  let filter = '';

  function render() {
    const filtered = filter ? links.filter((l) => l.url.toLowerCase().includes(filter.toLowerCase())) : links;
    listEl.innerHTML = filtered.length
      ? filtered.map((l) => `
        <div class="clip-item">
          <div class="ci-top"><span>${escapeHtml(l.from)}</span><span>${timeAgo(l.ts)}</span></div>
          ${l.preview?.title ? `<b style="font-size:12.5px;">${escapeHtml(l.preview.title)}</b><br/>` : ''}
          ${l.preview?.description ? `<span style="font-size:11.5px;color:var(--text-2);">${escapeHtml(l.preview.description).slice(0, 120)}</span><br/>` : ''}
          <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" style="font-size:11.5px;color:var(--accent);word-break:break-all;">${escapeHtml(l.url)}</a>
        </div>`).join('')
      : `<div class="empty-state">${getIcon('link', 30)}<p>No links shared yet.</p></div>`;
  }

  body.querySelector('#link-send').addEventListener('click', async () => {
    let url = inputEl.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (!isSafeUrl(url)) { ctx.notifications.toast('error', 'Invalid link', 'Only http/https links can be shared.'); return; }
    inputEl.value = '';
    const id = uid('link');
    const ts = Date.now();
    links.unshift({ id, ts, from: 'You', url, preview: null });
    render();

    const preview = await fetchPreview(url);
    const entry = links.find((l) => l.id === id);
    if (entry) entry.preview = preview;
    render();
    ctx.peerManager.broadcastJSON({ type: 'link:share', id, ts, url, preview });
  });
  searchEl.addEventListener('input', (e) => { filter = e.target.value; render(); });

  renderers.add(render);
  ctx.windowManager.on('close', (w) => { if (w.id === win.id) renderers.delete(render); });
  render();
}
