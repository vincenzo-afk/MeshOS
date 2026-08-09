/**
 * Network Explorer
 * Lists every peer currently in the room (from PeerDirectory) as a card
 * grid, similar to Windows Network / Finder. Clicking a device drills
 * into a detail panel with connection stats and quick actions.
 */
import { getIcon } from '../utils/icons.js';
import { initialsOf, escapeHtml, timeAgo } from '../utils/helpers.js';
import { openDM } from './chat.js';
import { openForPeer } from './files.js';

const QUALITY_LABEL = { excellent: 'Excellent', good: 'Good', poor: 'Poor', offline: 'Offline' };

export function mount(body, win, ctx) {
  body.classList.add('app-shell');
  body.innerHTML = `
    <div class="app-toolbar">
      <div class="ico">${getIcon('network', 15)}</div>
      <b style="font-size:12.5px;">Connected devices</b>
      <div class="spacer"></div>
      <span class="badge you" id="explorer-count">0 online</span>
    </div>
    <div id="explorer-body" style="flex:1;overflow-y:auto;"></div>
  `;
  const listEl = body.querySelector('#explorer-body');
  const countEl = body.querySelector('#explorer-count');

  function render() {
    const peers = ctx.peerDirectory.list();
    countEl.textContent = `${peers.length} online`;

    if (peers.length === 0) {
      listEl.innerHTML = `<div class="empty-state">${getIcon('network', 36)}<p>No other devices are connected yet. Share the invite link or QR code to bring more computers into this mesh.</p></div>`;
      return;
    }

    listEl.innerHTML = `<div class="explorer-grid">${peers.map(cardHTML).join('')}</div>`;
    listEl.querySelectorAll('.device-card').forEach((el) => {
      el.addEventListener('click', () => renderDetail(el.dataset.peer));
    });
  }

  function cardHTML(p) {
    const quality = ctx.peerDirectory.connectionQuality(p.peerId);
    return `
      <div class="device-card" data-peer="${p.peerId}">
        <div class="dc-avatar" style="background:linear-gradient(135deg, ${escapeHtml(p.avatar || 'var(--accent)')}, var(--accent-2));">${escapeHtml(initialsOf(p.computerName))}</div>
        <div class="dc-name">${escapeHtml(p.computerName)}</div>
        <div class="dc-user">${escapeHtml(p.username)}${p.isAdmin ? ' · Host' : ''}</div>
        <div class="dc-status" style="color:${quality === 'offline' ? 'var(--text-2)' : quality === 'poor' ? 'var(--warning)' : 'var(--success)'};">
          <span class="d"></span>${QUALITY_LABEL[quality]}
        </div>
      </div>`;
  }

  function renderDetail(peerId) {
    const p = ctx.peerDirectory.get(peerId);
    if (!p) return render();
    const quality = ctx.peerDirectory.connectionQuality(peerId);
    listEl.innerHTML = `
      <div class="device-detail">
        <button class="btn btn-ghost btn-sm" id="explorer-back">${getIcon('arrow', 13)} Back</button>
        <div style="text-align:center;margin:18px 0;">
          <div class="dc-avatar" style="width:64px;height:64px;font-size:20px;margin:0 auto 10px;background:linear-gradient(135deg, ${escapeHtml(p.avatar || 'var(--accent)')}, var(--accent-2));">${escapeHtml(initialsOf(p.computerName))}</div>
          <div style="font-weight:800;font-size:15px;">${escapeHtml(p.computerName)}</div>
          <div style="color:var(--text-2);font-size:12.5px;">${escapeHtml(p.username)} ${p.isAdmin ? '<span class="badge owner">Host</span>' : ''}</div>
        </div>
        <div class="dd-row"><span>Status</span><span>${QUALITY_LABEL[quality]}${p.latencyMs != null ? ` · ${p.latencyMs}ms` : ''}</span></div>
        <div class="dd-row"><span>Operating system</span><span>${escapeHtml(p.os || 'Unknown')}</span></div>
        <div class="dd-row"><span>Browser</span><span>${escapeHtml(p.browserInfo?.name || 'Unknown')}</span></div>
        <div class="dd-row"><span>Joined</span><span>${p.joinedAt ? timeAgo(p.joinedAt) : '—'}</span></div>
        <div class="device-actions">
          <button class="btn btn-primary btn-sm" id="explorer-chat">${getIcon('chat', 14)} Message</button>
          <button class="btn btn-ghost btn-sm" id="explorer-files">${getIcon('files', 14)} Send file</button>
          ${ctx.isAdmin() && p.peerId !== ctx.me.peerId ? `<button class="btn btn-danger btn-sm" id="explorer-kick">${getIcon('kick', 14)} Remove</button>` : ''}
        </div>
      </div>`;
    listEl.querySelector('#explorer-back').addEventListener('click', render);
    listEl.querySelector('#explorer-chat').addEventListener('click', () => openDM(ctx, peerId));
    listEl.querySelector('#explorer-files').addEventListener('click', () => openForPeer(ctx, peerId));
    listEl.querySelector('#explorer-kick')?.addEventListener('click', async () => {
      const ok = await ctx.modal.confirmDialog({ title: 'Remove this device?', message: `${p.computerName} will be disconnected from the workspace.`, confirmLabel: 'Remove', danger: true });
      if (ok) ctx.socket.sendAdmin('kick', { peerId });
    });
  }

  render();
  const off = ctx.peerDirectory.on('change', render);
  ctx.windowManager.on('close', (w) => { if (w.id === win.id) off(); });
}
