/**
 * MeshOS Workspace Bootstrap
 * Entry point for /w/:code. Connects the signaling socket, brings up the
 * WebRTC mesh, and assembles the desktop shell (taskbar, start menu, tray,
 * notification center, quick settings) before handing control to the
 * individual app modules.
 */
import { GITHUB_REPO_URL, APP_DEFS, THEMES, WALLPAPERS } from './config.js';
import { getIcon } from './utils/icons.js';
import { formatClock, initialsOf, colorFromString, escapeHtml } from './utils/helpers.js';
import { getIdentity, setIdentity, getRememberedDefaults, getPendingPassword, clearPendingPassword, getPendingOwnerToken, buildJoinMeta } from './utils/identity.js';
import { importKeyFromBase64 } from './utils/crypto.js';
import { prefs, applyPrefs, setTheme, toggleMode, setWallpaper } from './ui/themes.js';
import { WindowManager } from './ui/windowmanager.js';
import { NotificationCenter } from './ui/notifications.js';
import { showContextMenu } from './ui/contextmenu.js';
import { openModal, closeModal, confirmDialog } from './ui/modal.js';
import { MeshSocket } from './network/socket.js';
import { PeerManager } from './network/webrtc.js';
import { PeerDirectory } from './network/peers.js';

import * as explorerApp from './apps/explorer.js';
import * as chatApp from './apps/chat.js';
import * as filesApp from './apps/files.js';
import * as clipboardApp from './apps/clipboard.js';
import * as whiteboardApp from './apps/whiteboard.js';
import * as notesApp from './apps/notes.js';
import * as terminalApp from './apps/terminal.js';
import * as screenshareApp from './apps/screenshare.js';
import * as topologyApp from './apps/topology.js';
import * as dashboardApp from './apps/dashboard.js';
import * as linksApp from './apps/links.js';
import * as codeApp from './apps/code.js';
import * as settingsApp from './apps/settings.js';

const APP_MODULES = {
  explorer: explorerApp, chat: chatApp, files: filesApp, clipboard: clipboardApp,
  whiteboard: whiteboardApp, notes: notesApp, terminal: terminalApp, screenshare: screenshareApp,
  topology: topologyApp, dashboard: dashboardApp, links: linksApp, code: codeApp, settings: settingsApp,
};
const DESKTOP_ICON_APPS = ['explorer', 'chat', 'files', 'whiteboard', 'notes', 'terminal'];
const DOCK_APPS = ['explorer', 'chat', 'files', 'whiteboard', 'clipboard', 'settings'];

applyPrefs();

// ---------------------------------------------------------------------------
// 1. Resolve the room code from the URL. Anything else is a routing error.
// ---------------------------------------------------------------------------
const pathMatch = location.pathname.match(/^\/w\/([A-Za-z0-9]{4,8})\/?$/);
if (!pathMatch) {
  location.href = '/';
  throw new Error('MeshOS: invalid workspace URL, redirecting home.');
}
const roomCode = pathMatch[1].toUpperCase();

const bootStatus = document.getElementById('boot-status');
function setBootStatus(text) {
  if (bootStatus) bootStatus.textContent = text;
}

// ---------------------------------------------------------------------------
// 2. Resolve the E2E room key from the URL fragment, if present.
// ---------------------------------------------------------------------------
async function resolveCryptoKey() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const keyB64 = params.get('key');
  if (!keyB64) return null;
  try {
    return await importKeyFromBase64(keyB64);
  } catch (_err) {
    console.warn('[MeshOS] Could not import the room key from the invite link.');
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. Identity + join flow. If the person landed here directly (e.g. scanned
//    a QR code) they won't have gone through the landing-page form, so we
//    prompt for a name inline before attempting to join.
// ---------------------------------------------------------------------------
function promptForIdentity({ needsPassword = false, errorMessage = '' } = {}) {
  return new Promise((resolve) => {
    const remembered = getRememberedDefaults();
    const modal = openModal({
      title: 'Join this workspace',
      dismissible: false,
      bodyHTML: `
        ${errorMessage ? `<p class="desc" style="color:var(--danger);">${escapeHtml(errorMessage)}</p>` : ''}
        <div class="form-row"><label>Your name</label><input id="ident-username" type="text" maxlength="24" placeholder="e.g. Priya" value="${escapeHtml(remembered.username || '')}" /></div>
        <div class="form-row" style="margin-top:10px;"><label>Computer name</label><input id="ident-computername" type="text" maxlength="28" placeholder="e.g. Priya's Laptop" value="${escapeHtml(remembered.computerName || '')}" /></div>
        ${needsPassword ? '<div class="form-row" style="margin-top:10px;"><label>Workspace password</label><input id="ident-password" type="password" placeholder="Required to join" /></div>' : ''}
      `,
      actions: [
        {
          label: 'Join Workspace',
          variant: 'primary',
          closeOnClick: true,
          onClick: () => {
            const username = document.getElementById('ident-username').value.trim() || 'Guest';
            const computerName = document.getElementById('ident-computername').value.trim();
            const password = needsPassword ? document.getElementById('ident-password').value : (getPendingPassword() || '');
            setIdentity({ username, computerName });
            resolve({ username, computerName, password });
          },
        },
      ],
    });
    modal.querySelector('#ident-username')?.focus();
  });
}

async function attemptJoin() {
  const cryptoKey = await resolveCryptoKey();

  let identity = getIdentity();
  let password = getPendingPassword();

  if (!identity.username) {
    const filled = await promptForIdentity({ needsPassword: false });
    identity = filled;
    password = filled.password;
  }

  setBootStatus('Connecting to signaling server…');

  const doJoin = (pw) => socket.join({
    roomCode,
    createIfMissing: false,
    password: pw || undefined,
    ownerToken: getPendingOwnerToken() || undefined,
    meta: buildJoinMeta(),
  });

  try {
    const joined = await doJoin(password);
    return { joined, cryptoKey };
  } catch (err) {
    clearPendingPassword();
    const message = err?.message || 'Could not join workspace.';
    const needsPassword = /password/i.test(message);
    const filled = await promptForIdentity({ needsPassword, errorMessage: message });
    const joined = await doJoin(filled.password);
    return { joined, cryptoKey };
  }
}

// ---------------------------------------------------------------------------
// 4. Boot.
// ---------------------------------------------------------------------------
const socket = new MeshSocket();
let peerManager, peerDirectory, wm, notifications;
let isAdmin = false;

socket.on('reconnecting', (n) => setBootStatus(`Reconnecting… (attempt ${n})`));
socket.on('kicked', (reason) => {
  alert(`You were removed from this workspace: ${reason || 'No reason given.'}`);
  location.href = '/';
});
socket.on('server-error', (message) => {
  notifications?.toast('error', 'Server error', message);
});

attemptJoin()
  .then(({ joined, cryptoKey }) => {
    isAdmin = joined.room?.ownerId === joined.peerId;
    boot(joined, cryptoKey);
  })
  .catch((err) => {
    setBootStatus(err.message || 'Could not connect. Returning to the home page…');
    setTimeout(() => { location.href = '/'; }, 2200);
  });

function boot(joined, cryptoKey) {
  peerManager = new PeerManager(socket);
  peerDirectory = new PeerDirectory(socket, peerManager);
  wm = new WindowManager(document.getElementById('desktop'), document.getElementById('taskbar-apps'));
  notifications = new NotificationCenter(
    document.getElementById('toast-stack'),
    document.getElementById('notif-center'),
    document.getElementById('tray-notif-badge')
  );

  const identity = getIdentity();
  const me = {
    peerId: socket.peerId,
    username: identity.username,
    computerName: identity.computerName,
    avatar: colorFromString(identity.username + identity.computerName),
  };

  const ctx = {
    socket, peerManager, peerDirectory, notifications, windowManager: wm,
    modal: { openModal, closeModal, confirmDialog },
    roomCode, cryptoKey, me,
    isAdmin: () => isAdmin,
    getRoom: () => socket.room,
    getGithubUrl: () => GITHUB_REPO_URL,
  };

  peerManager.on('peer-connected', (peerId) => {
    const p = peerDirectory.get(peerId);
    notifications.toast('success', 'Device connected', p ? `${p.computerName} joined the mesh.` : 'A new device connected.');
  });
  peerManager.on('peer-disconnected', (peerId) => {
    const p = peerDirectory.get(peerId);
    notifications.toast('info', 'Device disconnected', p ? `${p.computerName} left the mesh.` : 'A device disconnected.');
  });

  socket.on('room-updated', (room) => {
    isAdmin = room.ownerId === socket.peerId;
    updateAdminAffordances();
  });
  socket.on('approval-request', (peerId, participant) => {
    if (!isAdmin) return;
    notifications.toast('info', 'Join request', `${participant.username} wants to join.`, { timeout: 15000 });
    openModal({
      title: 'Approve new participant?',
      bodyHTML: `<p class="desc"><b>${escapeHtml(participant.username)}</b> (${escapeHtml(participant.computerName)}) wants to join this workspace.</p>`,
      actions: [
        { label: 'Reject', variant: 'danger', onClick: () => socket.sendAdmin('reject', { peerId }) },
        { label: 'Approve', variant: 'primary', onClick: () => socket.sendAdmin('approve', { peerId }) },
      ],
    });
  });

  document.getElementById('boot-screen').classList.add('hidden');
  setTimeout(() => document.getElementById('boot-screen')?.remove(), 550);

  buildDesktopIcons(ctx);
  buildDock(ctx);
  buildTaskbar(ctx);
  buildStartMenu(ctx);
  buildQuickSettings(ctx);
  wireTrayClock();
  wireDesktopContextMenu(ctx);

  window.addEventListener('beforeunload', () => {
    peerManager.closeAll();
    socket.leave();
  });

  notifications.toast('success', 'Connected', `You're in "${joined.room.name}" as ${me.username}.`);
}

// ---------------------------------------------------------------------------
// App launcher
// ---------------------------------------------------------------------------
function openApp(appId, ctx) {
  const mod = APP_MODULES[appId];
  if (!mod || typeof mod.mount !== 'function') {
    console.warn(`[MeshOS] Unknown app "${appId}"`);
    return;
  }
  ctx.windowManager.open(appId, (body, win) => mod.mount(body, win, ctx));
}

// ---------------------------------------------------------------------------
// Desktop icons
// ---------------------------------------------------------------------------
function buildDesktopIcons(ctx) {
  const container = document.getElementById('desktop-icons');
  container.innerHTML = DESKTOP_ICON_APPS.map((id) => {
    const def = APP_DEFS[id];
    return `<div class="desktop-icon" data-app="${id}"><div class="ico">${getIcon(def.icon, 22)}</div><span>${def.title}</span></div>`;
  }).join('');
  container.querySelectorAll('.desktop-icon').forEach((el) => {
    el.addEventListener('dblclick', () => openApp(el.dataset.app, ctx));
    el.addEventListener('click', () => {
      container.querySelectorAll('.desktop-icon').forEach((o) => o.classList.remove('selected'));
      el.classList.add('selected');
    });
  });
}

function buildDock(ctx) {
  const dock = document.getElementById('dock');
  dock.innerHTML = DOCK_APPS.map((id) => {
    const def = APP_DEFS[id];
    return `<button class="dock-item" data-app="${id}" title="${def.title}">${getIcon(def.icon, 20)}</button>`;
  }).join('');
  dock.querySelectorAll('.dock-item').forEach((el) => {
    el.addEventListener('click', () => openApp(el.dataset.app, ctx));
  });
}

// ---------------------------------------------------------------------------
// Taskbar (start button, search, tray)
// ---------------------------------------------------------------------------
function buildTaskbar(ctx) {
  document.getElementById('start-btn').innerHTML = getIcon('logo', 18);
  document.getElementById('start-btn').addEventListener('click', () => toggleFloating('start-menu'));

  document.getElementById('taskbar-search').innerHTML = `${getIcon('search', 15)}<span>Search apps</span>`;
  document.getElementById('taskbar-search').addEventListener('click', () => {
    toggleFloating('start-menu');
    document.getElementById('start-search-input')?.focus();
  });

  document.getElementById('tray-room').innerHTML = getIcon('network', 16);
  document.getElementById('tray-room').addEventListener('click', () => openRoomInfoModal(ctx));

  document.getElementById('tray-github').innerHTML = getIcon('github', 16);
  document.getElementById('tray-github').addEventListener('click', () => window.open(ctx.getGithubUrl(), '_blank', 'noopener'));

  document.getElementById('tray-notif').innerHTML = `${getIcon('bell', 16)}`;
  document.getElementById('tray-notif').appendChild(document.getElementById('tray-notif-badge'));
  document.getElementById('tray-notif').addEventListener('click', () => toggleFloating('notif-center'));

  document.getElementById('tray-quicksettings').innerHTML = getIcon('settings', 16);
  document.getElementById('tray-quicksettings').addEventListener('click', () => toggleFloating('quick-settings'));

  document.getElementById('notif-clear-btn').addEventListener('click', () => ctx.notifications.clearAll());
}

function toggleFloating(id) {
  const el = document.getElementById(id);
  const wasOpen = el.classList.contains('open');
  ['start-menu', 'notif-center', 'quick-settings'].forEach((otherId) => {
    document.getElementById(otherId).classList.remove('open');
  });
  if (!wasOpen) el.classList.add('open');
}
document.addEventListener('click', (e) => {
  ['start-menu', 'notif-center', 'quick-settings'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el.classList.contains('open')) return;
    const trigger = e.target.closest(`#tray-notif, #tray-quicksettings, #start-btn, #taskbar-search, #${id}`);
    if (!trigger) el.classList.remove('open');
  });
});

function wireTrayClock() {
  const clock = document.getElementById('tray-clock');
  const dateEl = document.getElementById('tray-date');
  const tick = () => {
    clock.firstChild.textContent = formatClock();
    dateEl.textContent = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };
  tick();
  setInterval(tick, 1000 * 15);
}

// ---------------------------------------------------------------------------
// Start menu
// ---------------------------------------------------------------------------
function buildStartMenu(ctx) {
  document.getElementById('start-search-icon').innerHTML = getIcon('search', 15);
  const grid = document.getElementById('start-app-grid');
  const renderGrid = (filter = '') => {
    const entries = Object.entries(APP_DEFS).filter(([, def]) => def.title.toLowerCase().includes(filter.toLowerCase()));
    grid.innerHTML = entries.map(([id, def]) => `
      <div class="app-grid-item" data-app="${id}">
        <div class="ico">${getIcon(def.icon, 18)}</div>
        <span>${def.title}</span>
      </div>`).join('') || `<div class="empty-state" style="grid-column:1/-1;">${getIcon('search', 28)}<p>No apps match "${escapeHtml(filter)}"</p></div>`;
    grid.querySelectorAll('.app-grid-item').forEach((el) => {
      el.addEventListener('click', () => {
        openApp(el.dataset.app, ctx);
        document.getElementById('start-menu').classList.remove('open');
      });
    });
  };
  renderGrid();
  document.getElementById('start-search-input').addEventListener('input', (e) => renderGrid(e.target.value));

  document.getElementById('start-user-avatar').textContent = initialsOf(ctx.me.username);
  document.getElementById('start-user-avatar').style.background = `linear-gradient(135deg, ${ctx.me.avatar}, var(--accent-2))`;
  document.getElementById('start-user-name').textContent = ctx.me.username;
  document.getElementById('start-user-computer').textContent = ctx.me.computerName;
  document.getElementById('start-leave-btn').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Leave workspace?', message: 'You can rejoin later with the same room code.', confirmLabel: 'Leave' });
    if (ok) { socket.leave(); location.href = '/'; }
  });
}

// ---------------------------------------------------------------------------
// Quick settings
// ---------------------------------------------------------------------------
function buildQuickSettings(ctx) {
  const modeBtn = document.getElementById('qs-mode');
  const lockBtn = document.getElementById('qs-lock');
  const e2eBtn = document.getElementById('qs-e2e');

  const renderToggles = () => {
    modeBtn.innerHTML = `${getIcon(prefs.mode === 'dark' ? 'sun' : 'moon', 18)}<span>${prefs.mode === 'dark' ? 'Light mode' : 'Dark mode'}</span>`;
    const room = ctx.getRoom();
    lockBtn.innerHTML = `${getIcon(room?.locked ? 'lock' : 'unlock', 18)}<span>${room?.locked ? 'Locked' : 'Lock room'}</span>`;
    lockBtn.classList.toggle('active', Boolean(room?.locked));
    lockBtn.style.display = ctx.isAdmin() ? '' : 'none';
    e2eBtn.innerHTML = `${getIcon('key', 18)}<span>${ctx.cryptoKey ? 'E2E on' : 'E2E off'}</span>`;
    e2eBtn.classList.toggle('active', Boolean(ctx.cryptoKey));
  };
  renderToggles();

  modeBtn.addEventListener('click', () => { toggleMode(); renderToggles(); });
  lockBtn.addEventListener('click', () => {
    if (!ctx.isAdmin()) return;
    socket.sendAdmin('lock', { value: !ctx.getRoom()?.locked });
    setTimeout(renderToggles, 200);
  });
  e2eBtn.addEventListener('click', () => {
    ctx.notifications.toast('info', 'End-to-end encryption', ctx.cryptoKey
      ? 'Messages and files in this workspace are encrypted with a key that never touched the server.'
      : 'This workspace was created without end-to-end encryption. Ask the host to re-share an encrypted invite link.');
  });
  ctx.socket.on('room-updated', renderToggles);

  const themeWrap = document.getElementById('qs-theme-swatches');
  const THEME_COLORS = { windows: '#3B82F6', macos: '#0A84FF', ubuntu: '#E95420', cyberpunk: '#F92C8B', hacker: '#00FF66', minimal: '#EDEDED' };
  themeWrap.innerHTML = THEMES.map((t) => `<div class="theme-swatch" data-theme="${t}" title="${t}" style="background:${THEME_COLORS[t]};"></div>`).join('');
  const markActiveTheme = () => themeWrap.querySelectorAll('.theme-swatch').forEach((el) => el.classList.toggle('active', el.dataset.theme === prefs.theme));
  markActiveTheme();
  themeWrap.querySelectorAll('.theme-swatch').forEach((el) => el.addEventListener('click', () => { setTheme(el.dataset.theme); markActiveTheme(); }));

  const wallWrap = document.getElementById('qs-wallpaper-swatches');
  wallWrap.innerHTML = WALLPAPERS.map((url, i) => `<div class="theme-swatch" data-wallpaper="${url}" title="Wallpaper ${i + 1}" style="background-image:url(${url});background-size:cover;"></div>`).join('');
  const markActiveWallpaper = () => wallWrap.querySelectorAll('.theme-swatch').forEach((el) => el.classList.toggle('active', el.dataset.wallpaper === prefs.wallpaper));
  markActiveWallpaper();
  wallWrap.querySelectorAll('.theme-swatch').forEach((el) => el.addEventListener('click', () => { setWallpaper(el.dataset.wallpaper); markActiveWallpaper(); }));
}

function updateAdminAffordances() {
  document.querySelectorAll('[data-admin-only]').forEach((el) => {
    el.style.display = isAdmin ? '' : 'none';
  });
}

// ---------------------------------------------------------------------------
// Room info / admin panel
// ---------------------------------------------------------------------------
function openRoomInfoModal(ctx) {
  const room = ctx.getRoom();
  const shareUrl = `${location.origin}${location.pathname}${location.hash || ''}`;
  const adminControls = ctx.isAdmin() ? `
    <div class="settings-section" style="margin-top:16px;">
      <h4>Administrator controls</h4>
      <div class="toggle-row"><div><div class="label">Lock room</div></div><label class="switch"><input type="checkbox" id="ri-lock" ${room.locked ? 'checked' : ''} /><span class="track"></span></label></div>
      <div class="toggle-row"><div><div class="label">Mute chat</div></div><label class="switch"><input type="checkbox" id="ri-mute" ${room.chatMuted ? 'checked' : ''} /><span class="track"></span></label></div>
      <div class="toggle-row"><div><div class="label">Disable uploads</div></div><label class="switch"><input type="checkbox" id="ri-uploads" ${room.uploadsDisabled ? 'checked' : ''} /><span class="track"></span></label></div>
    </div>` : '';

  const modal = openModal({
    title: room.name,
    bodyHTML: `
      <p class="desc">Room code: <b style="letter-spacing:0.1em;">${room.code}</b> · ${room.participantCount} connected</p>
      <div class="form-row"><input type="text" readonly value="${escapeHtml(shareUrl)}" id="ri-share-link" /></div>
      ${adminControls}
    `,
    actions: [
      { label: 'Copy invite link', variant: 'ghost', closeOnClick: false, onClick: async () => {
        const input = document.getElementById('ri-share-link');
        input.select();
        try { await navigator.clipboard.writeText(input.value); ctx.notifications.toast('success', 'Copied', 'Invite link copied.'); } catch (_) { document.execCommand('copy'); }
      } },
      { label: 'Close', variant: 'primary' },
    ],
  });

  if (ctx.isAdmin()) {
    modal.querySelector('#ri-lock').addEventListener('change', (e) => ctx.socket.sendAdmin('lock', { value: e.target.checked }));
    modal.querySelector('#ri-mute').addEventListener('change', (e) => ctx.socket.sendAdmin('mute-chat', { value: e.target.checked }));
    modal.querySelector('#ri-uploads').addEventListener('change', (e) => ctx.socket.sendAdmin('disable-uploads', { value: e.target.checked }));
  }
}

// ---------------------------------------------------------------------------
// Desktop right-click menu
// ---------------------------------------------------------------------------
function wireDesktopContextMenu(ctx) {
  document.getElementById('desktop').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.mesh-window') || e.target.closest('.desktop-icon')) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Network Explorer', icon: 'network', action: () => openApp('explorer', ctx) },
      { label: 'Open Chat', icon: 'chat', action: () => openApp('chat', ctx) },
      { label: 'Terminal', icon: 'terminal', action: () => openApp('terminal', ctx) },
      'separator',
      { label: 'Change wallpaper', icon: 'palette', action: () => toggleFloating('quick-settings') },
      { label: 'Workspace info', icon: 'network', action: () => openRoomInfoModal(ctx) },
    ]);
  });
}
