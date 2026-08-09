/**
 * MeshOS Theme Manager
 * Applies data-theme / data-mode attributes to <html> and persists the
 * user's choice locally (this is a per-device UI preference, not
 * workspace/room data, so it is fine to keep in localStorage).
 */
import { THEMES, WALLPAPERS } from '../config.js';

const STORAGE_KEY = 'meshos.prefs.v1';

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (_) {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (_) {
    /* private-browsing / quota — silently ignore */
  }
}

export const prefs = {
  theme: 'windows',
  mode: 'dark',
  wallpaper: WALLPAPERS[0],
  ...loadPrefs(),
};

export function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  document.documentElement.setAttribute('data-mode', prefs.mode);
  const desktop = document.getElementById('desktop');
  if (desktop) desktop.style.backgroundImage = `url(${prefs.wallpaper})`;
}

export function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  prefs.theme = theme;
  savePrefs(prefs);
  applyPrefs();
}

export function setMode(mode) {
  prefs.mode = mode === 'light' ? 'light' : 'dark';
  savePrefs(prefs);
  applyPrefs();
}

export function toggleMode() {
  setMode(prefs.mode === 'dark' ? 'light' : 'dark');
}

export function setWallpaper(url) {
  prefs.wallpaper = url;
  savePrefs(prefs);
  applyPrefs();
}