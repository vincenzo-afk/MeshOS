/**
 * File Transfer
 * Sends files, or entire folders via <input webkitdirectory>, directly
 * over the WebRTC "file" data channel in 16KB chunks, each framed with a
 * 4-byte transfer id so several transfers can share one ordered channel.
 * Folder transfers keep each file's relative path as metadata (shown in
 * the transfer list; the actual downloaded filename is always just the
 * basename, since the HTML `download` attribute can't create real nested
 * folders) since browsers require a fresh permission prompt to write an
 * actual nested folder on disk; `dirWriter` is left as an extension point
 * for wiring up the File System Access API's `showDirectoryPicker()` if
 * that prompt is acceptable for your deployment. State is module-scoped
 * so transfers survive closing/reopening the window.
 *
 * Transfers are keyed by `${peerId}:${direction}:${transferId}` rather
 * than the raw numeric id alone — the id is only ever unique from the
 * sender's own point of view, so two different peers (or two directions
 * on the same connection) could otherwise pick the same random id and
 * silently corrupt each other's in-progress transfer.
 */
import { getIcon } from '../utils/icons.js';
import { escapeHtml, formatBytes, formatSpeed, formatDuration, uid, downloadBlob } from '../utils/helpers.js';
import { FILE_CHUNK_SIZE, DATACHANNEL_BUFFER_THRESHOLD } from '../config.js';
import { encryptBuffer, decryptBuffer } from '../utils/crypto.js';

/** @type {Map<string, object>} "peerId:direction:transferId" -> transfer state */
const transfers = new Map();
let selectedTargets = new Set();
let wired = false;
const renderers = new Set();

function key(peerId, direction, transferId) {
  return `${peerId}:${direction}:${transferId}`;
}

function renderAll() {
  renderers.forEach((r) => r());
}

function newTransferId() {
  return Math.floor(Math.random() * 0xfffffffe) + 1;
}

function frameChunk(transferId, bytes) {
  const out = new Uint8Array(4 + bytes.byteLength);
  new DataView(out.buffer).setUint32(0, transferId, false);
  out.set(new Uint8Array(bytes), 4);
  return out.buffer;
}

function unframeChunk(buffer) {
  const view = new DataView(buffer);
  return { transferId: view.getUint32(0, false), data: buffer.slice(4) };
}

function wire(ctx) {
  if (wired) return;
  wired = true;

  ctx.peerManager.on('binary', async (peerId, label, buf) => {
    if (label !== 'file') return;
    const { transferId, data } = unframeChunk(buf);
    const t = transfers.get(key(peerId, 'in', transferId));
    if (!t || t.status !== 'transferring') return;

    let chunk = data;
    if (ctx.cryptoKey) {
      try { chunk = await decryptBuffer(ctx.cryptoKey, data); } catch (_err) { /* corrupt chunk — skip */ return; }
    }

    if (t.dirWriter) {
      await t.dirWriter.write(chunk);
    } else {
      t.chunks.push(chunk);
    }
    t.received += chunk.byteLength;
    t.lastTickBytes = (t.lastTickBytes || 0) + chunk.byteLength;

    if (t.received >= t.size) {
      await finishIncoming(ctx, t);
    }
    renderAll();
  });

  ctx.peerManager.on('message', (peerId, label, msg) => {
    if (label !== 'file' || !String(msg.type || '').startsWith('file-')) return;

    if (msg.type === 'file-offer') {
      const t = {
        id: msg.transferId, peerId, direction: 'in', name: msg.name, relativePath: msg.relativePath || msg.name,
        size: msg.size, mime: msg.mime || 'application/octet-stream', received: 0, chunks: [], dirWriter: null,
        status: 'transferring', startedAt: Date.now(), lastTickBytes: 0, speed: 0,
      };
      transfers.set(key(peerId, 'in', t.id), t);
      ctx.peerManager.getPeer(peerId)?.sendJSON('file', { type: 'file-accept', transferId: t.id });
      ctx.notifications.toast('info', 'Incoming file', `${ctx.peerDirectory.get(peerId)?.computerName || 'A peer'} is sending "${msg.name}".`);
      renderAll();
    } else if (msg.type === 'file-cancel') {
      // A cancel can arrive from either side: the sender telling us they
      // stopped (we hold this as an "in" transfer) or the receiver telling
      // us to stop sending (we hold this as an "out" transfer).
      const inbound = transfers.get(key(peerId, 'in', msg.transferId));
      const outbound = transfers.get(key(peerId, 'out', msg.transferId));
      if (inbound && inbound.status === 'transferring') { inbound.status = 'canceled'; inbound.chunks = []; }
      if (outbound && outbound.status === 'transferring') outbound.status = 'canceled';
      renderAll();
    } else if (msg.type === 'file-complete') {
      const t = transfers.get(key(peerId, 'out', msg.transferId));
      if (t) { t.status = 'completed'; t.confirmed = true; renderAll(); }
    }
  });

  ctx.peerManager.on('peer-disconnected', (peerId) => {
    let changed = false;
    for (const t of transfers.values()) {
      if (t.peerId === peerId && t.status === 'transferring') {
        t.status = 'failed';
        t.chunks = [];
        changed = true;
      }
    }
    if (changed) renderAll();
  });

  setInterval(() => {
    for (const t of transfers.values()) {
      t.speed = t.lastTickBytes || 0;
      t.lastTickBytes = 0;
    }
    renderAll();
  }, 1000);
}

async function finishIncoming(ctx, t) {
  t.status = 'completed';
  if (!t.dirWriter) {
    const blob = new Blob(t.chunks, { type: t.mime });
    t.blob = blob;
    t.chunks = [];
    downloadBlob(blob, t.name);
  } else {
    try { await t.dirWriter.close(); } catch (_err) { /* already closed */ }
  }
  ctx.peerManager.getPeer(t.peerId)?.sendJSON('file', { type: 'file-complete', transferId: t.id });
}

async function sendFileToPeer(ctx, file, peerId, relativePath) {
  const transferId = newTransferId();
  const peer = ctx.peerManager.getPeer(peerId);
  if (!peer || !peer.isChannelOpen('file')) {
    ctx.notifications.toast('error', 'Cannot send file', `${ctx.peerDirectory.get(peerId)?.computerName || 'That device'} isn't connected right now.`);
    return;
  }

  const t = {
    id: transferId, peerId, direction: 'out', name: file.name, relativePath: relativePath || file.name,
    size: file.size, sent: 0, status: 'transferring', paused: false,
    startedAt: Date.now(), lastTickBytes: 0, speed: 0, file, confirmed: false,
  };
  transfers.set(key(peerId, 'out', transferId), t);
  renderAll();

  peer.sendJSON('file', { type: 'file-offer', transferId, name: file.name, relativePath: t.relativePath, size: file.size, mime: file.type });

  let offset = 0;
  while (offset < file.size) {
    if (t.status === 'canceled') return;
    if (!peer.isChannelOpen('file')) {
      t.status = 'failed';
      renderAll();
      return;
    }
    if (t.paused) { await sleep(150); continue; }
    if (peer.bufferedAmount('file') > DATACHANNEL_BUFFER_THRESHOLD) { await sleep(60); continue; }

    const slice = await file.slice(offset, offset + FILE_CHUNK_SIZE).arrayBuffer();
    const payload = ctx.cryptoKey ? await encryptBuffer(ctx.cryptoKey, slice) : slice;
    peer.sendBinary('file', frameChunk(transferId, payload));

    offset += slice.byteLength;
    t.sent = offset;
    t.lastTickBytes += slice.byteLength;
    renderAll();
  }
  // All bytes handed to the channel; final status flips to "completed" for
  // real once the receiver's "file-complete" ack arrives (handled above),
  // but we optimistically mark it here too in case the ack is slow to
  // avoid the progress bar looking stuck at 100% with no status text.
  if (t.status === 'transferring') t.status = 'completed';
  renderAll();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function sendFiles(ctx, fileList, targets) {
  const files = Array.from(fileList);
  if (targets.length === 0) {
    ctx.notifications.toast('error', 'No recipients', 'No other devices are connected to send to.');
    return;
  }
  for (const peerId of targets) {
    for (const file of files) {
      sendFileToPeer(ctx, file, peerId, file.webkitRelativePath || file.name);
    }
  }
}

export function mount(body, win, ctx, opts = {}) {
  wire(ctx);
  if (opts.preselectPeer) selectedTargets = new Set([opts.preselectPeer]);

  body.classList.add('app-shell');
  body.innerHTML = `
    <div class="app-toolbar">
      <div class="ico">${getIcon('files', 15)}</div>
      <b style="font-size:12.5px;">Send &amp; receive files</b>
      <div class="spacer"></div>
      <button class="icon-mini-btn" id="ft-pick-file" title="Choose files">${getIcon('paperclip', 15)}</button>
      <button class="icon-mini-btn" id="ft-pick-folder" title="Choose a folder">${getIcon('grid', 15)}</button>
    </div>
    <div class="ft-target-row" id="ft-targets"></div>
    <div class="ft-dropzone" id="ft-dropzone">${getIcon('upload', 24)}<div>Drag &amp; drop files or a folder here, or use the buttons above.</div></div>
    <div class="transfer-list" id="ft-list"></div>
    <input type="file" id="ft-file-input" multiple style="display:none;" />
    <input type="file" id="ft-folder-input" webkitdirectory multiple style="display:none;" />
  `;

  const dropzone = body.querySelector('#ft-dropzone');
  const listEl = body.querySelector('#ft-list');
  const targetsEl = body.querySelector('#ft-targets');
  const fileInput = body.querySelector('#ft-file-input');
  const folderInput = body.querySelector('#ft-folder-input');

  function renderTargets() {
    const peers = ctx.peerDirectory.list();
    if (peers.length === 0) {
      targetsEl.innerHTML = `<span style="font-size:11.5px;color:var(--text-2);">No other devices connected yet.</span>`;
      return;
    }
    targetsEl.innerHTML = peers.map((p) => `<div class="ft-target-chip ${selectedTargets.has(p.peerId) ? 'selected' : ''}" data-peer="${p.peerId}">${escapeHtml(p.computerName)}</div>`).join('');
    targetsEl.querySelectorAll('.ft-target-chip').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.peer;
        selectedTargets.has(id) ? selectedTargets.delete(id) : selectedTargets.add(id);
        renderTargets();
      });
    });
  }

  function activeTargets() {
    if (selectedTargets.size > 0) return Array.from(selectedTargets).filter((id) => ctx.peerDirectory.get(id));
    return ctx.peerDirectory.list().map((p) => p.peerId);
  }

  function transferRowHTML(t) {
    const pct = t.size ? Math.min(100, Math.round(((t.direction === 'in' ? t.received : t.sent) / t.size) * 100)) : 0;
    const peerName = ctx.peerDirectory.get(t.peerId)?.computerName || 'Unknown device';
    const remaining = t.size - (t.direction === 'in' ? t.received : t.sent);
    const eta = t.speed > 0 ? formatDuration(remaining / t.speed) : '—';
    const canControl = t.direction === 'out' && t.status === 'transferring';
    const statusText = t.status === 'transferring' ? `${formatSpeed(t.speed)} · ETA ${eta}`
      : t.status === 'completed' ? 'Done'
      : t.status === 'canceled' ? 'Canceled'
      : t.status === 'failed' ? 'Connection lost'
      : t.paused ? 'Paused' : '';
    return `
      <div class="transfer-item" data-key="${escapeHtml(key(t.peerId, t.direction, t.id))}">
        <div class="ti-top">
          <span class="ti-name" title="${escapeHtml(t.relativePath)}">${t.direction === 'in' ? '↓' : '↑'} ${escapeHtml(t.relativePath || t.name)}</span>
          <div class="ti-actions">
            ${canControl ? `<button class="ti-pause" title="${t.paused ? 'Resume' : 'Pause'}">${getIcon(t.paused ? 'play' : 'pause', 12)}</button>` : ''}
            ${t.status === 'transferring' ? `<button class="ti-cancel" title="Cancel">${getIcon('x', 12)}</button>` : ''}
            ${(t.status === 'canceled' || t.status === 'failed') && t.direction === 'out' ? `<button class="ti-retry" title="Retry">${getIcon('retry', 12)}</button>` : ''}
            ${t.status === 'completed' && t.blob ? `<button class="ti-save" title="Save again">${getIcon('save', 12)}</button>` : ''}
          </div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%;${t.status === 'failed' ? 'background:var(--danger);' : ''}"></div></div>
        <div class="ti-sub">
          <span>${peerName}</span><span>${formatBytes(t.size)}</span>
          <span>${statusText}</span>
        </div>
      </div>`;
  }

  function render() {
    const list = Array.from(transfers.values()).sort((a, b) => b.startedAt - a.startedAt);
    listEl.innerHTML = list.length
      ? list.map(transferRowHTML).join('')
      : `<div class="empty-state">${getIcon('files', 30)}<p>No transfers yet. Files never touch the server — everything moves directly between browsers.</p></div>`;

    listEl.querySelectorAll('.transfer-item').forEach((row) => {
      const t = transfers.get(row.dataset.key);
      if (!t) return;
      row.querySelector('.ti-pause')?.addEventListener('click', () => { t.paused = !t.paused; render(); });
      row.querySelector('.ti-cancel')?.addEventListener('click', () => {
        t.status = 'canceled';
        ctx.peerManager.getPeer(t.peerId)?.sendJSON('file', { type: 'file-cancel', transferId: t.id });
        render();
      });
      row.querySelector('.ti-retry')?.addEventListener('click', () => {
        transfers.delete(row.dataset.key);
        sendFileToPeer(ctx, t.file, t.peerId, t.relativePath);
      });
      row.querySelector('.ti-save')?.addEventListener('click', () => downloadBlob(t.blob, t.name));
    });
  }

  ['dragenter', 'dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length) sendFiles(ctx, files, activeTargets());
  });

  body.querySelector('#ft-pick-file').addEventListener('click', () => fileInput.click());
  body.querySelector('#ft-pick-folder').addEventListener('click', () => folderInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files.length) sendFiles(ctx, fileInput.files, activeTargets()); fileInput.value = ''; });
  folderInput.addEventListener('change', () => { if (folderInput.files.length) sendFiles(ctx, folderInput.files, activeTargets()); folderInput.value = ''; });

  renderTargets();
  const render2 = () => { render(); renderTargets(); };
  renderers.add(render2);
  const offDirectory = ctx.peerDirectory.on('change', renderTargets);
  ctx.windowManager.on('close', (w) => { if (w.id === win.id) { renderers.delete(render2); offDirectory(); } });
  render();
}

/**
 * Opens the File Transfer app with `peerId` preselected as the send
 * target. Mirrors chat.js's openDM(): WindowManager.open() skips its
 * mount callback for an already-open singleton window, so switching the
 * preselected target for a window that's already open has to happen by
 * updating shared state and re-running the registered render functions.
 */
export function openForPeer(ctx, peerId) {
  selectedTargets = new Set([peerId]);
  if (ctx.windowManager.windows.has('win_files')) {
    ctx.windowManager.focus('win_files');
    renderAll();
  } else {
    ctx.windowManager.open('files', (body, win) => mount(body, win, ctx, { preselectPeer: peerId }));
  }
}
