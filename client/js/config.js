/**
 * MeshOS Client Configuration
 * Single source of truth for constants shared across the client modules.
 */

// ---------------------------------------------------------------------------
// Replace this with your own repository URL. It is intentionally isolated
// as a single constant so the "Star on GitHub" icon in the nav bar can be
// re-pointed in one place.
// ---------------------------------------------------------------------------
export const GITHUB_REPO_URL = 'https://github.com/vincenzo-afk/MeshOS';

export const WS_PATH = '/ws';

// Public STUN servers for NAT traversal. For symmetric-NAT / restrictive
// networks you should add your own TURN server credentials here.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const FILE_CHUNK_SIZE = 16 * 1024; // 16KB — safe default for RTCDataChannel
export const DATACHANNEL_BUFFER_THRESHOLD = 8 * 1024 * 1024; // back-pressure ceiling

export const APP_DEFS = {
  explorer:  { title: 'Network Explorer', icon: 'network', width: 620, height: 440 },
  chat:      { title: 'Chat',             icon: 'chat',    width: 520, height: 520 },
  files:     { title: 'File Transfer',    icon: 'files',   width: 520, height: 500 },
  clipboard: { title: 'Shared Clipboard',  icon: 'clipboard', width: 420, height: 480 },
  whiteboard:{ title: 'Whiteboard',       icon: 'whiteboard', width: 780, height: 540 },
  notes:     { title: 'Notes',            icon: 'notes',   width: 620, height: 480 },
  terminal:  { title: 'Terminal',         icon: 'terminal', width: 600, height: 400 },
  screenshare:{ title: 'Screen Share',    icon: 'screen',  width: 640, height: 460 },
  topology:  { title: 'Network Topology', icon: 'topology', width: 640, height: 460 },
  dashboard: { title: 'Device Dashboard', icon: 'dashboard', width: 560, height: 440 },
  links:     { title: 'Shared Links',     icon: 'link',    width: 480, height: 460 },
  code:      { title: 'Code Snippet',     icon: 'code',    width: 600, height: 460 },
  settings:  { title: 'Settings',         icon: 'settings', width: 460, height: 480 },
};

export const THEMES = ['windows', 'macos', 'ubuntu', 'cyberpunk', 'hacker', 'minimal'];

export const WALLPAPERS = [
  '/assets/wallpapers/wallpaper-1.svg',
  '/assets/wallpapers/wallpaper-2.svg',
  '/assets/wallpapers/wallpaper-3.svg',
  '/assets/wallpapers/wallpaper-4.svg',
];