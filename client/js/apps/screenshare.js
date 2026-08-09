/**
 * Screen Share
 * Captures the local screen/window/tab via getDisplayMedia and attaches
 * the track to every connected RTCPeerConnection. Viewing is entirely
 * permission-based: nothing streams until the sharer explicitly starts,
 * and a toast tells each peer who started sharing.
 *
 * Sharing/viewing state lives at module scope (not per-mount) so that:
 *  - closing and reopening the window doesn't orphan the previous
 *    capture or leave a stale 'ended' listener attached to the track,
 *  - a peer who joins *while* someone is already sharing still gets the
 *    track the moment their connection comes up, instead of only peers
 *    who were already connected when sharing started.
 */
import { getIcon } from '../utils/icons.js';

let wired = false;
let localStream = null; // stream WE are broadcasting, if any
let remoteStream = null; // stream we're currently viewing from someone else
let remoteSharerId = null;
const renderers = new Set();

function renderAll() {
  renderers.forEach((r) => r());
}

function wire(ctx) {
  if (wired) return;
  wired = true;

  ctx.peerManager.on('track', (peerId, track, stream) => {
    remoteSharerId = peerId;
    remoteStream = stream;
    renderAll();
  });

  ctx.peerManager.on('message', (peerId, label, msg) => {
    if (label !== 'main') return;
    if (msg.type === 'screen:start') {
      ctx.notifications.toast('info', 'Screen share started', `${ctx.peerDirectory.get(peerId)?.computerName || 'A peer'} is sharing their screen.`);
    } else if (msg.type === 'screen:stop') {
      if (remoteSharerId === peerId) { remoteSharerId = null; remoteStream = null; }
      renderAll();
    }
  });

  // A peer who connects *after* we've already started sharing still needs
  // the track pushed to their brand-new RTCPeerConnection.
  ctx.peerManager.on('peer-connected', (peerId) => {
    if (!localStream) return;
    const [track] = localStream.getVideoTracks();
    if (track) ctx.peerManager.getPeer(peerId)?.addStreamTrack(track, localStream);
  });

  ctx.peerManager.on('peer-disconnected', (peerId) => {
    if (remoteSharerId === peerId) { remoteSharerId = null; remoteStream = null; renderAll(); }
  });
}

function stopSharing(ctx) {
  if (!localStream) return;
  localStream.getTracks().forEach((t) => t.stop());
  localStream = null;
  ctx.peerManager.broadcastJSON({ type: 'screen:stop' });
  renderAll();
}

async function startSharing(ctx) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    ctx.notifications.toast('error', 'Not supported', 'Your browser does not support screen sharing.');
    return;
  }
  // Starting a new share while an old one is still live would otherwise
  // orphan the previous capture — the browser keeps recording and its
  // native "you are sharing" indicator stays up even though our own UI
  // has moved on to the new stream and lost any reference to the old one.
  if (localStream) stopSharing(ctx);

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    localStream = stream;
    const [track] = stream.getVideoTracks();
    ctx.peerDirectory.list().forEach((p) => ctx.peerManager.getPeer(p.peerId)?.addStreamTrack(track, stream));
    ctx.peerManager.broadcastJSON({ type: 'screen:start' });
    // Fires when the browser's own "Stop sharing" bar is used, or the
    // shared tab/window/screen is closed at the OS level.
    track.addEventListener('ended', () => stopSharing(ctx));
    renderAll();
  } catch (_err) {
    /* user dismissed the picker — nothing to clean up */
  }
}

export function mount(body, win, ctx) {
  wire(ctx);
  body.innerHTML = `
    <div class="share-shell">
      <div class="share-video-wrap" id="share-video-wrap">
        <div class="empty-state">${getIcon('screen', 34)}<p>Nobody is sharing their screen yet.</p></div>
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-primary btn-sm" id="share-start">${getIcon('screen', 14)} Share my screen</button>
        <button class="btn btn-ghost btn-sm" id="share-stop" style="display:none;">${getIcon('x', 14)} Stop sharing</button>
      </div>
    </div>`;

  const wrap = body.querySelector('#share-video-wrap');
  const startBtn = body.querySelector('#share-start');
  const stopBtn = body.querySelector('#share-stop');

  function render() {
    if (localStream) {
      wrap.innerHTML = '<video autoplay muted playsinline></video>';
      wrap.querySelector('video').srcObject = localStream;
      startBtn.style.display = 'none';
      stopBtn.style.display = '';
    } else if (remoteStream) {
      wrap.innerHTML = '<video autoplay playsinline></video>';
      wrap.querySelector('video').srcObject = remoteStream;
      startBtn.style.display = '';
      stopBtn.style.display = 'none';
    } else {
      wrap.innerHTML = `<div class="empty-state">${getIcon('screen', 34)}<p>Nobody is sharing their screen yet.</p></div>`;
      startBtn.style.display = '';
      stopBtn.style.display = 'none';
    }
  }

  startBtn.addEventListener('click', () => startSharing(ctx));
  stopBtn.addEventListener('click', () => stopSharing(ctx));

  renderers.add(render);
  ctx.windowManager.on('close', (w) => { if (w.id === win.id) renderers.delete(render); });
  render();
}
