/**
 * Network Topology
 * Renders the full-mesh WebRTC graph as an SVG: one node per peer (plus
 * "you" in the center), with links colored/animated by connection quality.
 */
import { initialsOf, escapeHtml } from '../utils/helpers.js';

const QUALITY_COLOR = { excellent: 'var(--success)', good: 'var(--accent-2)', poor: 'var(--warning)', offline: 'var(--text-2)' };

export function mount(body, win, ctx) {
  body.innerHTML = `
    <div class="topology-wrap">
      <svg id="topo-svg" viewBox="0 0 600 460" preserveAspectRatio="xMidYMid meet"></svg>
      <div class="topo-legend glass" id="topo-legend"></div>
    </div>`;
  const svg = body.querySelector('#topo-svg');
  const legend = body.querySelector('#topo-legend');

  legend.innerHTML = Object.entries(QUALITY_COLOR).map(([q, c]) => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;"><span style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block;"></span>${q}</div>`).join('');

  function render() {
    const peers = ctx.peerDirectory.list();
    const cx = 300, cy = 230, radius = Math.min(180, 60 + peers.length * 14);
    const nodes = [{ id: ctx.me.peerId, name: ctx.me.computerName, x: cx, y: cy, me: true }];
    peers.forEach((p, i) => {
      const angle = (i / Math.max(1, peers.length)) * Math.PI * 2 - Math.PI / 2;
      nodes.push({ id: p.peerId, name: p.computerName, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), quality: ctx.peerDirectory.connectionQuality(p.peerId), latency: p.latencyMs });
    });

    const links = nodes.slice(1).map((n) => `
      <line class="topo-link" x1="${cx}" y1="${cy}" x2="${n.x}" y2="${n.y}" stroke="${QUALITY_COLOR[n.quality] || QUALITY_COLOR.offline}"></line>
      ${n.latency != null ? `<text x="${(cx + n.x) / 2}" y="${(cy + n.y) / 2}" font-size="9" fill="var(--text-2)" text-anchor="middle">${n.latency}ms</text>` : ''}
    `).join('');

    const nodesHTML = nodes.map((n) => `
      <g class="topo-node" transform="translate(${n.x},${n.y})">
        <circle r="${n.me ? 26 : 22}" fill="${n.me ? 'var(--accent)' : 'var(--surface-solid)'}" stroke="${n.me ? 'var(--accent-2)' : QUALITY_COLOR[n.quality] || QUALITY_COLOR.offline}"></circle>
        <text text-anchor="middle" dy="4" fill="${n.me ? '#fff' : 'var(--text-0)'}" font-weight="700" font-size="10">${escapeHtml(initialsOf(n.name))}</text>
        <text text-anchor="middle" dy="${n.me ? 42 : 38}" font-size="10">${escapeHtml(n.name)}</text>
      </g>`).join('');

    svg.innerHTML = links + nodesHTML;
  }

  render();
  const off = ctx.peerDirectory.on('change', render);
  ctx.windowManager.on('close', (w) => { if (w.id === win.id) off(); });
}
