/**
 * MeshOS Landing Page
 * Handles the create/join workspace flows, live stat polling, and theme
 * toggling. Navigates to /w/{code}#key={base64} on success — the room key
 * fragment never touches the server.
 */
import { GITHUB_REPO_URL } from './config.js';
import { getIcon } from './utils/icons.js';
import { renderQRCode } from './utils/qrcode.js';
import { generateRoomKey, exportKeyToBase64 } from './utils/crypto.js';
import { setIdentity, setPendingPassword, setPendingOwnerToken, clearPendingOwnerToken } from './utils/identity.js';
import { prefs, applyPrefs, toggleMode } from './ui/themes.js';

applyPrefs();

// ---------- Icon injection ----------
document.getElementById('github-icon').innerHTML = getIcon('github', 18);
document.getElementById('github-icon').href = GITHUB_REPO_URL;
document.getElementById('theme-toggle-landing').innerHTML = getIcon(prefs.mode === 'dark' ? 'sun' : 'moon', 17);
document.getElementById('theme-toggle-landing').addEventListener('click', () => {
  toggleMode();
  document.getElementById('theme-toggle-landing').innerHTML = getIcon(prefs.mode === 'dark' ? 'sun' : 'moon', 17);
});
document.querySelectorAll('.btn-ico').forEach((el) => (el.innerHTML = getIcon('plus', 16)));
document.querySelectorAll('.fi[data-icon]').forEach((el) => (el.innerHTML = getIcon(el.dataset.icon, 20)));

// ---------- Toasts (lightweight, landing-only) ----------
function toast(kind, title, message) {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = `toast glass ${kind}`;
  el.innerHTML = `<div class="t-ico">${getIcon(kind === 'error' ? 'alert' : 'checkCircle', 15)}</div><div class="t-body"><b>${title}</b><p>${message || ''}</p></div>`;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ---------- Tabs ----------
const tabButtons = document.querySelectorAll('.tab-btn');
tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
    document.querySelectorAll('.tabpanel').forEach((p) => p.classList.remove('active'));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});
document.getElementById('hero-create-btn').addEventListener('click', () => {
  document.querySelector('.tab-btn[data-tab="create"]').click();
  document.getElementById('join-create-panel').scrollIntoView({ behavior: 'smooth' });
});
document.getElementById('hero-join-btn').addEventListener('click', () => {
  document.querySelector('.tab-btn[data-tab="join"]').click();
  document.getElementById('join-create-panel').scrollIntoView({ behavior: 'smooth' });
});

// ---------- Live stats ----------
async function pollStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    document.getElementById('stat-rooms').textContent = data.totalRooms ?? 0;
    document.getElementById('stat-peers').textContent = data.totalParticipants ?? 0;
  } catch (_) {
    /* server unreachable — leave placeholders */
  }
}
pollStats();
setInterval(pollStats, 10000);

// ---------- Create Workspace ----------
const pwToggle = document.getElementById('create-password-toggle');
const pwRow = document.getElementById('create-password-row');
pwToggle.addEventListener('change', () => { pwRow.style.display = pwToggle.checked ? 'block' : 'none'; });

let createdRoom = null;

document.getElementById('create-submit-btn').addEventListener('click', async () => {
  const username = document.getElementById('create-username').value.trim();
  const computerName = document.getElementById('create-computername').value.trim();
  const roomName = document.getElementById('create-roomname').value.trim();
  const password = pwToggle.checked ? document.getElementById('create-password').value : '';
  const requireApproval = document.getElementById('create-approval-toggle').checked;
  const useE2E = document.getElementById('create-e2e-toggle').checked;

  if (!username) return toast('error', 'Name required', 'Please tell us what to call you.');
  if (pwToggle.checked && !password) return toast('error', 'Password required', 'Enter a password or turn off password protection.');

  const btn = document.getElementById('create-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: roomName || undefined, password: password || undefined, requireApproval }),
    });
    if (!res.ok) throw new Error('Could not create workspace.');
    const { room, ownerToken } = await res.json();

    let keyFragment = '';
    if (useE2E) {
      const key = await generateRoomKey();
      const b64 = await exportKeyToBase64(key);
      keyFragment = `#key=${b64}`;
    }

    const shareUrl = `${location.origin}/w/${room.code}${keyFragment}`;
    createdRoom = { code: room.code, shareUrl, password };

    setIdentity({ username, computerName });
    setPendingPassword(password);
    setPendingOwnerToken(ownerToken);

    document.getElementById('room-code-text').textContent = room.code;
    document.getElementById('share-link-input').value = shareUrl;
    renderQRCode(document.getElementById('qr-container'), shareUrl, 176);
    document.getElementById('create-result').style.display = 'block';
    document.getElementById('create-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('success', 'Workspace created', `Room code ${room.code} is ready.`);
  } catch (err) {
    toast('error', 'Something went wrong', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Workspace';
  }
});

document.getElementById('copy-link-btn').addEventListener('click', async () => {
  const input = document.getElementById('share-link-input');
  input.focus();
  input.select();
  try {
    await navigator.clipboard.writeText(input.value);
    toast('success', 'Copied', 'Invite link copied to clipboard.');
  } catch (_) {
    document.execCommand('copy');
  }
});

document.getElementById('enter-workspace-btn').addEventListener('click', () => {
  if (createdRoom) location.href = createdRoom.shareUrl;
});

// ---------- Join Workspace ----------
const codeInputs = Array.from(document.querySelectorAll('#join-code-input input'));
codeInputs.forEach((input, idx) => {
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (input.value && idx < codeInputs.length - 1) codeInputs[idx + 1].focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && idx > 0) codeInputs[idx - 1].focus();
  });
  input.addEventListener('paste', (e) => {
    const text = (e.clipboardData.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (text.length > 1) {
      e.preventDefault();
      text.split('').slice(0, 6).forEach((ch, i) => { if (codeInputs[i]) codeInputs[i].value = ch; });
      codeInputs[Math.min(text.length, 6) - 1]?.focus();
    }
  });
});

let pastedKeyFragment = '';
document.getElementById('join-link-paste').addEventListener('input', (e) => {
  const val = e.target.value.trim();
  if (!val) return;
  try {
    const url = new URL(val);
    const match = url.pathname.match(/\/w\/([A-Z0-9]{4,8})/i);
    if (match) {
      match[1].toUpperCase().split('').slice(0, 6).forEach((ch, i) => { if (codeInputs[i]) codeInputs[i].value = ch; });
    }
    const hashKey = new URLSearchParams(url.hash.replace('#', '')).get('key');
    if (hashKey) pastedKeyFragment = `#key=${hashKey}`;
  } catch (_) {
    /* not a full URL — ignore, they may just be typing a code manually */
  }
});

document.getElementById('join-submit-btn').addEventListener('click', async () => {
  const code = codeInputs.map((i) => i.value).join('').toUpperCase();
  const username = document.getElementById('join-username').value.trim();
  const computerName = document.getElementById('join-computername').value.trim();
  const password = document.getElementById('join-password').value;

  if (code.length !== 6) return toast('error', 'Enter the full code', 'Room codes are 6 characters.');
  if (!username) return toast('error', 'Name required', 'Please tell us what to call you.');

  const btn = document.getElementById('join-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Checking…';

  try {
    const res = await fetch(`/api/rooms/${code}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Workspace not found.');
    }
    const { room } = await res.json();
    if (room.hasPassword && !password) {
      toast('error', 'Password required', 'This workspace is password protected.');
      return;
    }

    setIdentity({ username, computerName });
    setPendingPassword(password);
    clearPendingOwnerToken(); // this is a plain join, not claiming a room we just created
    location.href = `${location.origin}/w/${code}${pastedKeyFragment}`;
  } catch (err) {
    toast('error', 'Could not join', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Join Workspace →';
  }
});