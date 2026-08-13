/**
 * Settings
 * Profile (name/computer name — rebroadcasts presence on change), theme
 * and wallpaper (delegates to ui/themes.js), and, for the room owner,
 * the same administrative toggles available from the tray's room-info
 * modal, kept here too since Settings is the expected home for this.
 */
import { getIcon } from '../utils/icons.js';
import { escapeHtml } from '../utils/helpers.js';
import { setIdentity } from '../utils/identity.js';
import { prefs, setTheme, setMode, setWallpaper } from '../ui/themes.js';
import { THEMES, WALLPAPERS } from '../config.js';

export function mount(body, win, ctx) {
  body.innerHTML = `
    <div class="settings-shell">
      <div class="settings-section">
        <h4>Profile</h4>
        <div class="form-row"><label>Your name</label><input id="set-username" type="text" maxlength="24" value="${escapeHtml(ctx.me.username)}" /></div>
        <div class="form-row" style="margin-top:8px;"><label>Computer name</label><input id="set-computername" type="text" maxlength="28" value="${escapeHtml(ctx.me.computerName)}" /></div>
        <button class="btn btn-primary btn-sm" id="set-save-profile" style="margin-top:10px;">Save</button>
      </div>

      <div class="settings-section">
        <h4>Appearance</h4>
        <div style="margin-bottom:8px;font-size:12px;color:var(--text-2);">Theme</div>
        <div class="theme-swatches" id="set-themes"></div>
        <div style="margin:14px 0 8px;font-size:12px;color:var(--text-2);">Wallpaper</div>
        <div class="theme-swatches" id="set-wallpapers"></div>
        <div class="toggle-row" style="margin-top:14px;">
          <div><div class="label">Dark mode</div></div>
          <label class="switch"><input type="checkbox" id="set-darkmode" ${prefs.mode === 'dark' ? 'checked' : ''} /><span class="track"></span></label>
        </div>
      </div>

      ${ctx.isAdmin() ? `
      <div class="settings-section">
        <h4>Administrator</h4>
        <div class="toggle-row"><div><div class="label">Lock room</div></div><label class="switch"><input type="checkbox" id="set-lock" ${ctx.getRoom()?.locked ? 'checked' : ''} /><span class="track"></span></label></div>
        <div class="toggle-row"><div><div class="label">Mute chat</div></div><label class="switch"><input type="checkbox" id="set-mute" ${ctx.getRoom()?.chatMuted ? 'checked' : ''} /><span class="track"></span></label></div>
        <div class="toggle-row"><div><div class="label">Disable uploads</div></div><label class="switch"><input type="checkbox" id="set-uploads" ${ctx.getRoom()?.uploadsDisabled ? 'checked' : ''} /><span class="track"></span></label></div>
        <div class="form-row" style="margin-top:10px;"><label>Room name</label><input id="set-roomname" type="text" maxlength="64" value="${escapeHtml(ctx.getRoom()?.name || '')}" /></div>
        <button class="btn btn-ghost btn-sm" id="set-rename" style="margin-top:8px;">Rename room</button>
      </div>` : ''}

      <div class="settings-section">
        <h4>About</h4>
        <p class="desc">MeshOS turns every browser on this network into a virtual computer in one shared, peer-to-peer workspace. Nothing you do here is stored on a server.</p>
        <button class="btn btn-ghost btn-sm" id="set-github">${getIcon('github', 13)} Star on GitHub</button>
      </div>
    </div>`;

  body.querySelector('#set-save-profile').addEventListener('click', () => {
    const username = body.querySelector('#set-username').value.trim() || 'Guest';
    const computerName = body.querySelector('#set-computername').value.trim() || ctx.me.computerName;
    setIdentity({ username, computerName });
    ctx.me.username = username;
    ctx.me.computerName = computerName;
    ctx.peerManager.broadcastJSON({ type: 'presence-update', meta: { username, computerName, avatar: ctx.me.avatar } });
    ctx.notifications.toast('success', 'Profile updated', 'Your new name is now visible to everyone in the workspace.');
  });

  const THEME_COLORS = { windows: '#3B82F6', macos: '#0A84FF', ubuntu: '#E95420', cyberpunk: '#F92C8B', hacker: '#00FF66', minimal: '#EDEDED' };
  const themeWrap = body.querySelector('#set-themes');
  themeWrap.innerHTML = THEMES.map((t) => `<div class="theme-swatch ${t === prefs.theme ? 'active' : ''}" data-theme="${t}" style="background:${THEME_COLORS[t]};" title="${t}"></div>`).join('');
  themeWrap.querySelectorAll('.theme-swatch').forEach((el) => el.addEventListener('click', () => {
    setTheme(el.dataset.theme);
    themeWrap.querySelectorAll('.theme-swatch').forEach((s) => s.classList.toggle('active', s === el));
  }));

  const wallWrap = body.querySelector('#set-wallpapers');
  wallWrap.innerHTML = WALLPAPERS.map((url) => `<div class="theme-swatch ${url === prefs.wallpaper ? 'active' : ''}" data-wallpaper="${url}" style="background-image:url(${url});background-size:cover;"></div>`).join('');
  wallWrap.querySelectorAll('.theme-swatch').forEach((el) => el.addEventListener('click', () => {
    setWallpaper(el.dataset.wallpaper);
    wallWrap.querySelectorAll('.theme-swatch').forEach((s) => s.classList.toggle('active', s === el));
  }));

  body.querySelector('#set-darkmode').addEventListener('change', (e) => setMode(e.target.checked ? 'dark' : 'light'));

  body.querySelector('#set-lock')?.addEventListener('change', (e) => ctx.socket.sendAdmin('lock', { value: e.target.checked }));
  body.querySelector('#set-mute')?.addEventListener('change', (e) => ctx.socket.sendAdmin('mute-chat', { value: e.target.checked }));
  body.querySelector('#set-uploads')?.addEventListener('change', (e) => ctx.socket.sendAdmin('disable-uploads', { value: e.target.checked }));
  body.querySelector('#set-rename')?.addEventListener('click', () => {
    const value = body.querySelector('#set-roomname').value.trim();
    if (value) ctx.socket.sendAdmin('rename', { value });
  });

  body.querySelector('#set-github').addEventListener('click', () => window.open(ctx.getGithubUrl(), '_blank', 'noopener'));
}
