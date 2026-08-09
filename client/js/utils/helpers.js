/** MeshOS shared helper utilities. */

export function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
  }
  
  export function formatSpeed(bytesPerSec) {
    return `${formatBytes(bytesPerSec)}/s`;
  }
  
  export function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 1) return '<1s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
  
  export function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
  
  export function formatClock(ts = Date.now()) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  export function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  
  /** Very small, safe autolinker — escapes first, then wraps bare URLs. */
  export function linkify(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  }
  
  export function uid(prefix = 'id') {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }
  
  export function debounce(fn, wait = 200) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }
  
  export function throttle(fn, wait = 100) {
    let last = 0;
    let timeout = null;
    return (...args) => {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        last = now;
        fn(...args);
      } else {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          last = Date.now();
          fn(...args);
        }, remaining);
      }
    };
  }
  
  export function initialsOf(name = '?') {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || '?';
  }
  
  const PALETTE = ['#6C5CE7', '#00B894', '#0984E3', '#E17055', '#D63031', '#00CEC9', '#E84393', '#FDCB6E'];
  export function colorFromString(str = '') {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return PALETTE[Math.abs(hash) % PALETTE.length];
  }
  
  export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  
  export function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }
  
  export function detectOS() {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac OS X/i.test(ua)) return 'macOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Unknown OS';
  }
  
  export function detectBrowser() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'Edge';
    if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
    return 'Unknown Browser';
  }
  
  export function randomComputerName() {
    const adjectives = ['Swift', 'Nova', 'Quiet', 'Bright', 'Cobalt', 'Amber', 'Cryo', 'Lunar', 'Solar', 'Rapid'];
    const nouns = ['Node', 'Station', 'Terminal', 'Relay', 'Forge', 'Beacon', 'Circuit', 'Vertex'];
    const n = Math.floor(Math.random() * 900) + 100;
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${nouns[Math.floor(Math.random() * nouns.length)]}-${n}`;
  }