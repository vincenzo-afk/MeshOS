/**
 * MeshOS Icon Library
 * Small, dependency-free stroke-icon set (feather-style) returned as raw
 * SVG strings so any module can drop `getIcon('chat')` into innerHTML.
 */

const ICONS = {
    logo: '<path d="M4 17V7l8-4 8 4v10l-8 4-8-4Z"/><path d="M4 7l8 4 8-4"/><path d="M12 11v10"/>',
    github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
    network: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    files: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M13 2v7h7"/>',
    clipboard: '<rect x="7" y="3" width="10" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>',
    whiteboard: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
    notes: '<path d="M9 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M18.4 2.6a2 2 0 1 1 2.8 2.8L12 14.6l-4 1 1-4Z"/>',
    terminal: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M6 9l4 3-4 3M12 15h6"/>',
    screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    topology: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.2 7.2 10 16M16.8 7.2 14 16M7.5 6h9"/>',
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8"/>',
    code: '<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    minimize: '<path d="M5 12h14"/>',
    maximize: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    wifi: '<path d="M2 8.5a16 16 0 0 1 20 0M5.5 12a11 11 0 0 1 13 0M9 15.5a6 6 0 0 1 6 0"/><circle cx="12" cy="19" r="1"/>',
    battery: '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 10v4"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z"/>',
    paperclip: '<path d="M21 11.5 12.4 20a5 5 0 0 1-7-7L14 4.4a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7.8-7.8"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
    pin: '<path d="M12 17v5M8 3h8l-1 7 3 3H6l3-3Z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    download: '<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 19h16"/>',
    upload: '<path d="M12 21V9m0 0 4 4m-4-4-4 4"/><path d="M4 21h16"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    play: '<path d="M6 4l14 8-14 8Z"/>',
    retry: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12Z"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
    crown: '<path d="M3 18h18l-1.5-9-4.5 4-3-6-3 6-4.5-4Z"/>',
    kick: '<path d="M17 8l4 4-4 4M21 12H9"/><path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="8.5" r="3"/><path d="M15.5 13.2a5.7 5.7 0 0 1 5.8 6.8"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/>',
    video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3Z"/>',
    palette: '<circle cx="12" cy="12" r="10"/><circle cx="8" cy="10" r="1.3"/><circle cx="12" cy="7.5" r="1.3"/><circle cx="16" cy="10" r="1.3"/><path d="M12 22a2 2 0 0 1-1.4-3.4c.6-.6.4-1.6-.4-1.9A6 6 0 0 1 12 5"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM19 14v3M14 19h3M17 19h4v4h-4z"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.5 12.5 20 3M17 6l3 3M14 9l2.5 2.5"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
    wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 6.2l1.4-1.4M17.8 11.8l1.4 1.4M12.2 6.2l-1.4-1.4M3 21l9-9"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    pen: '<path d="M3 21v-3.8L14.7 5.5a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L6.8 21Z"/>',
    eraser: '<path d="M20 20H8l-6-6 10-10 8 8Z"/><path d="M9.5 15.5 15 21"/>',
    shape: '<rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="17" r="4"/>',
    text: '<path d="M4 6h16M12 6v14M9 20h6"/>',
    sticky: '<path d="M4 4h13l3 3v13H4Z"/><path d="M17 4v6h6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-8 8"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
    zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/>',
  };
  
  /**
   * Returns a raw <svg> string for the given icon key. Falls back to a
   * generic dot so a missing key never breaks layout.
   * @param {string} name
   * @param {number} [size=18]
   */
  export function getIcon(name, size = 18) {
    const inner = ICONS[name] || '<circle cx="12" cy="12" r="3"/>';
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }
  
  export function iconNames() {
    return Object.keys(ICONS);
  }