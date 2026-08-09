/**
 * Chat
 * Public workspace chat plus 1:1 DMs over the "main" WebRTC data channel.
 * State lives at module scope so history survives closing/reopening the
 * window; only the DOM is rebuilt on each mount.
 */
import { getIcon } from '../utils/icons.js';
import { escapeHtml, linkify, formatClock, initialsOf, uid, debounce } from '../utils/helpers.js';
import { encryptText, decryptText } from '../utils/crypto.js';

const REACTIONS = ['👍', '❤️', '😂', '🎉', '👀'];

const channels = new Map([['public', { messages: [], pinned: null }]]);
const typingUntil = new Map();
let wired = false;
let activeChannel = 'public';
const renderers = new Set();

function getChannel(id) {
  if (!channels.has(id)) channels.set(id, { messages: [], pinned: null });
  return channels.get(id);
}

async function encodeOutgoing(ctx, text) {
  if (ctx.cryptoKey) {
    const payload = await encryptText(ctx.cryptoKey, text);
    return { encrypted: true, ...payload };
  }
  return { encrypted: false, text };
}

async function decodeIncoming(ctx, msg) {
  if (msg.encrypted && ctx.cryptoKey) {
    try {
      return await decryptText(ctx.cryptoKey, msg);
    } catch (_err) {
      return '[Could not decrypt this message]';
    }
  }
  return msg.encrypted ? '[Encrypted message — no room key]' : msg.text;
}

function wire(ctx) {
  if (wired) return;
  wired = true;

  ctx.peerManager.on('message', async (peerId, label, msg) => {
    if (label !== 'main' || !String(msg.type || '').startsWith('chat:')) return;
    const peer = ctx.peerDirectory.get(peerId);
    const name = peer?.computerName || peerId;

    if (msg.type === 'chat:message') {
      const channelId = msg.dm ? peerId : 'public';
      const text = await decodeIncoming(ctx, msg);
      getChannel(channelId).messages.push({
        id: msg.id, ts: msg.ts, from: peerId, name, avatar: peer?.avatar, text, reactions: {}, read: false,
      });
      renderAll();
      if (channelId !== activeChannel) {
        ctx.notifications.toast('info', `${name}${msg.dm ? ' (DM)' : ''}`, text.slice(0, 80));
      }
    } else if (msg.type === 'chat:typing') {
      typingUntil.set(peerId, Date.now() + 3000);
      renderAll();
      setTimeout(renderAll, 3100);
    } else if (msg.type === 'chat:react') {
      if (!REACTIONS.includes(msg.emoji)) return; // reject anything outside the actual reaction set
      const ch = getChannel(msg.dm ? peerId : 'public');
      const m = ch.messages.find((x) => x.id === msg.msgId);
      if (m) {
        m.reactions[msg.emoji] = m.reactions[msg.emoji] || new Set();
        m.reactions[msg.emoji].add(peerId);
        renderAll();
      }
    } else if (msg.type === 'chat:pin') {
      const ch = getChannel(msg.dm ? peerId : 'public');
      ch.pinned = ch.messages.find((x) => x.id === msg.msgId) || null;
      renderAll();
    } else if (msg.type === 'chat:read') {
      const ch = getChannel(peerId);
      ch.messages.forEach((m) => { if (m.from === ctx.me.peerId && m.ts <= msg.upTo) m.read = true; });
      renderAll();
    }
  });
}

function renderAll() {
  renderers.forEach((r) => r());
}

/**
 * Opens the Chat app focused on a DM with `peerId`. WindowManager.open()
 * skips its mount callback when the (singleton) window already exists —
 * it just focuses it — so switching channels for an already-open window
 * has to happen out-of-band by updating the shared `activeChannel` and
 * re-running whatever render functions are currently registered.
 */
export function openDM(ctx, peerId) {
  activeChannel = peerId;
  if (ctx.windowManager.windows.has('win_chat')) {
    ctx.windowManager.focus('win_chat');
    renderAll();
  } else {
    ctx.windowManager.open('chat', (body, win) => mount(body, win, ctx, { openDM: peerId }));
  }
}

export function mount(body, win, ctx, opts = {}) {
  wire(ctx);
  if (opts.openDM) activeChannel = opts.openDM;

  body.classList.add('app-shell');
  body.innerHTML = `
    <div class="chat-layout">
      <div class="chat-sidebar" id="chat-sidebar"></div>
      <div class="chat-main">
        <div class="app-toolbar">
          <b style="font-size:12.5px;" id="chat-title">Public</b>
          <div class="spacer"></div>
          <button class="icon-mini-btn" id="chat-search-btn" title="Search messages">${getIcon('search', 15)}</button>
        </div>
        <div class="chat-search-bar" id="chat-search-bar"><input type="text" placeholder="Search messages…" id="chat-search-input" /></div>
        <div class="pin-bar" id="chat-pin-bar" style="display:none;"></div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="typing-indicator" id="chat-typing"></div>
        <div class="chat-input-row">
          <textarea id="chat-input" rows="1" placeholder="Message…"></textarea>
          <button class="icon-mini-btn" id="chat-send" title="Send">${getIcon('send', 16)}</button>
        </div>
      </div>
    </div>`;

  const sidebarEl = body.querySelector('#chat-sidebar');
  const titleEl = body.querySelector('#chat-title');
  const messagesEl = body.querySelector('#chat-messages');
  const typingEl = body.querySelector('#chat-typing');
  const pinBarEl = body.querySelector('#chat-pin-bar');
  const inputEl = body.querySelector('#chat-input');
  const searchBar = body.querySelector('#chat-search-bar');
  const searchInput = body.querySelector('#chat-search-input');

  let searchTerm = '';

  function renderSidebar() {
    const peers = ctx.peerDirectory.list();
    const rows = [
      `<div class="chat-channel ${activeChannel === 'public' ? 'active' : ''}" data-ch="public"><span class="presence-dot"></span>Public room</div>`,
      ...peers.map((p) => `<div class="chat-channel ${activeChannel === p.peerId ? 'active' : ''}" data-ch="${p.peerId}"><span class="presence-dot"></span>${escapeHtml(p.computerName)}</div>`),
    ];
    sidebarEl.innerHTML = rows.join('');
    sidebarEl.querySelectorAll('.chat-channel').forEach((el) => {
      el.addEventListener('click', () => { activeChannel = el.dataset.ch; sendReadReceipt(); renderMessages(); renderSidebar(); });
    });
  }

  function sendReadReceipt() {
    if (activeChannel === 'public') return;
    const ch = getChannel(activeChannel);
    const last = ch.messages[ch.messages.length - 1];
    if (last) ctx.peerManager.sendJSON(activeChannel, { type: 'chat:read', upTo: last.ts });
  }

  function renderMessages() {
    const ch = getChannel(activeChannel);
    const peer = activeChannel !== 'public' ? ctx.peerDirectory.get(activeChannel) : null;
    titleEl.textContent = peer ? `${peer.computerName} (DM)` : 'Public room';

    pinBarEl.style.display = ch.pinned ? 'flex' : 'none';
    if (ch.pinned) pinBarEl.innerHTML = `${getIcon('pin', 13)} <b>Pinned:</b> ${escapeHtml(ch.pinned.text).slice(0, 90)}`;

    const filtered = searchTerm ? ch.messages.filter((m) => m.text.toLowerCase().includes(searchTerm.toLowerCase())) : ch.messages;
    messagesEl.innerHTML = filtered.map(messageHTML).join('') || `<div class="empty-state" style="height:auto;padding:30px 0;">${getIcon('chat', 30)}<p>No messages yet. Say hello!</p></div>`;
    messagesEl.scrollTop = messagesEl.scrollHeight;

    messagesEl.querySelectorAll('.chat-msg').forEach((el) => {
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        import('../ui/contextmenu.js').then(({ showContextMenu }) => {
          showContextMenu(e.clientX, e.clientY, [
            { label: 'Pin message', icon: 'pin', action: () => pinMessage(el.dataset.id) },
            'separator',
            ...REACTIONS.map((emoji) => ({ label: `React ${emoji}`, action: () => react(el.dataset.id, emoji) })),
          ]);
        });
      });
    });
  }

  function messageHTML(m) {
    const mine = m.from === ctx.me.peerId;
    const reactionsHTML = Object.entries(m.reactions || {}).filter(([, s]) => s.size).map(([emoji, s]) => `<span>${escapeHtml(emoji)} ${s.size}</span>`).join('');
    return `
      <div class="chat-msg ${mine ? 'mine' : ''}" data-id="${escapeHtml(m.id)}">
        <div class="avatar" style="background:${mine ? '' : escapeHtml(m.avatar || 'var(--accent)')};">${escapeHtml(initialsOf(m.name || 'You'))}</div>
        <div>
          ${!mine ? `<div class="name">${escapeHtml(m.name)}</div>` : ''}
          <div class="bubble">${linkify(m.text)}</div>
          ${reactionsHTML ? `<div class="chat-reactions">${reactionsHTML}</div>` : ''}
          <div class="meta"><span>${formatClock(m.ts)}</span>${mine && activeChannel !== 'public' ? `<span>${m.read ? 'Seen' : 'Sent'}</span>` : ''}</div>
        </div>
      </div>`;
  }

  async function pinMessage(msgId) {
    ctx.peerManager.broadcastJSON({ type: 'chat:pin', msgId, dm: activeChannel !== 'public' });
    if (activeChannel !== 'public') ctx.peerManager.sendJSON(activeChannel, { type: 'chat:pin', msgId, dm: true });
    const ch = getChannel(activeChannel);
    ch.pinned = ch.messages.find((m) => m.id === msgId) || null;
    renderMessages();
  }

  function react(msgId, emoji) {
    const ch = getChannel(activeChannel);
    const m = ch.messages.find((x) => x.id === msgId);
    if (m) {
      m.reactions[emoji] = m.reactions[emoji] || new Set();
      m.reactions[emoji].add(ctx.me.peerId);
    }
    const payload = { type: 'chat:react', msgId, emoji, dm: activeChannel !== 'public' };
    if (activeChannel === 'public') ctx.peerManager.broadcastJSON(payload);
    else ctx.peerManager.sendJSON(activeChannel, payload);
    renderMessages();
  }

  const notifyTyping = debounce(() => {
    const payload = { type: 'chat:typing' };
    if (activeChannel === 'public') ctx.peerManager.broadcastJSON(payload);
    else ctx.peerManager.sendJSON(activeChannel, payload);
  }, 400);

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    const id = uid('msg');
    const ts = Date.now();
    const ch = getChannel(activeChannel);
    ch.messages.push({ id, ts, from: ctx.me.peerId, name: ctx.me.username, avatar: ctx.me.avatar, text, reactions: {}, read: false });
    renderMessages();

    const encoded = await encodeOutgoing(ctx, text);
    const payload = { type: 'chat:message', id, ts, dm: activeChannel !== 'public', ...encoded };
    if (activeChannel === 'public') ctx.peerManager.broadcastJSON(payload);
    else ctx.peerManager.sendJSON(activeChannel, payload);
  }

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(100, inputEl.scrollHeight)}px`;
    notifyTyping();
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  body.querySelector('#chat-send').addEventListener('click', sendMessage);

  body.querySelector('#chat-search-btn').addEventListener('click', () => {
    searchBar.classList.toggle('open');
    if (searchBar.classList.contains('open')) searchInput.focus();
    else { searchTerm = ''; searchInput.value = ''; renderMessages(); }
  });
  searchInput.addEventListener('input', (e) => { searchTerm = e.target.value; renderMessages(); });

  function renderTyping() {
    const now = Date.now();
    const names = [];
    for (const [peerId, until] of typingUntil) {
      if (until > now && (activeChannel === 'public' || activeChannel === peerId)) {
        names.push(ctx.peerDirectory.get(peerId)?.computerName || 'Someone');
      }
    }
    typingEl.textContent = names.length ? `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…` : '';
  }

  const render = () => { renderSidebar(); renderMessages(); renderTyping(); };
  renderers.add(render);
  const offDirectory = ctx.peerDirectory.on('change', renderSidebar);
  ctx.windowManager.on('close', (w) => { if (w.id === win.id) { renderers.delete(render); offDirectory(); } });

  render();
  sendReadReceipt();
}
