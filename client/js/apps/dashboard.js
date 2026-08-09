/**
 * Device Dashboard
 * Surfaces whatever the browser will tell us about this device: screen
 * resolution, battery, network type, memory, language/timezone, and
 * current activity. Everything here reads local `navigator`/`screen`
 * APIs — nothing is sent anywhere.
 */
import { getIcon } from '../utils/icons.js';
import { detectBrowser, detectOS, formatBytes } from '../utils/helpers.js';

function cardHTML(label, value, icon, barPct = null) {
  return `
    <div class="dash-card">
      <div class="dc-label">${getIcon(icon, 12)} ${label}</div>
      <div class="dc-value">${value}</div>
      ${barPct != null ? `<div class="dc-bar progress-track"><div class="progress-fill" style="width:${barPct}%;"></div></div>` : ''}
    </div>`;
}

export function mount(body, win, ctx) {
  body.innerHTML = `<div class="dash-grid" id="dash-grid"></div>`;
  const grid = body.querySelector('#dash-grid');

  async function render() {
    const cards = [];
    cards.push(cardHTML('Computer name', ctx.me.computerName, 'monitor'));
    cards.push(cardHTML('Operating system', detectOS(), 'cpu'));
    cards.push(cardHTML('Browser', detectBrowser(), 'globe'));
    cards.push(cardHTML('Screen resolution', `${screen.width}×${screen.height}`, 'grid'));
    cards.push(cardHTML('Viewport', `${window.innerWidth}×${window.innerHeight}`, 'grid'));
    cards.push(cardHTML('Language', navigator.language || 'Unknown', 'globe'));
    cards.push(cardHTML('Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown', 'globe'));
    cards.push(cardHTML('CPU cores', navigator.hardwareConcurrency || 'Unknown', 'cpu'));

    if (navigator.deviceMemory) cards.push(cardHTML('Device memory', `${navigator.deviceMemory} GB`, 'cpu'));
    if (performance.memory) {
      const used = performance.memory.usedJSHeapSize;
      const limit = performance.memory.jsHeapSizeLimit;
      cards.push(cardHTML('Tab memory use', formatBytes(used), 'cpu', Math.round((used / limit) * 100)));
    }
    if (navigator.connection) {
      cards.push(cardHTML('Network', `${navigator.connection.effectiveType || 'unknown'}${navigator.connection.downlink ? ` · ${navigator.connection.downlink}Mbps` : ''}`, 'wifi'));
    }
    cards.push(cardHTML('Peers connected', ctx.peerDirectory.list().length, 'network'));
    cards.push(cardHTML('Room', `${ctx.getRoom()?.code || ctx.roomCode}`, 'network'));

    if (navigator.getBattery) {
      try {
        const battery = await navigator.getBattery();
        cards.push(cardHTML('Battery', `${Math.round(battery.level * 100)}%${battery.charging ? ' (charging)' : ''}`, 'battery', Math.round(battery.level * 100)));
      } catch (_err) { /* not available */ }
    }

    grid.innerHTML = cards.join('');
  }

  render();
  const iv = setInterval(render, 5000);
  ctx.windowManager.on('close', (w) => { if (w.id === win.id) clearInterval(iv); });
}
