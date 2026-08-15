/**
 * MeshOS Server Entrypoint
 *
 * Serves the static client bundle and boots the WebRTC signaling layer.
 * MeshOS's server is intentionally thin: authentication (optional), room
 * management, and signaling only. All real collaboration data (chat,
 * files, whiteboard, clipboard, notes) flows peer-to-peer over WebRTC.
 */
'use strict';

const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const config = require('./config');
const { RoomManager } = require('./rooms');
const { attachSignalingServer } = require('./signaling');

const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));

// ---- Minimal in-memory rate limiter (per IP, sliding window) -------------
const rateBuckets = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  const fresh = bucket.filter((t) => now - t < config.RATE_LIMIT_WINDOW_MS);
  fresh.push(now);
  rateBuckets.set(ip, fresh);
  if (fresh.length > config.RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  next();
}
setInterval(() => rateBuckets.clear(), config.RATE_LIMIT_WINDOW_MS * 5).unref?.();

const roomManager = new RoomManager();

// ---- REST API --------------------------------------------------------------
// Used by the landing page to pre-create a room (so it can render the QR
// code / share link before the creator's browser opens the WebSocket) and
// to validate a room code before attempting to join.

app.post('/api/rooms', rateLimit, (req, res) => {
  const { name, password, requireApproval } = req.body || {};
  // See the ownerToken comment in rooms.js: this closes the window between
  // "room exists" and "creator's own WebSocket has actually joined it".
  const ownerToken = crypto.randomBytes(24).toString('hex');
  const room = roomManager.createRoom({
    name,
    passwordHash: password ? crypto.createHash('sha256').update(String(password)).digest('hex') : null,
    requireApproval: Boolean(requireApproval),
    ownerToken,
  });
  res.json({ room: room.toPublicJSON(), ownerToken });
});

app.get('/api/rooms/:code', rateLimit, (req, res) => {
  const room = roomManager.getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  res.json({ room: room.toPublicJSON() });
});

app.get('/api/stats', (req, res) => {
  res.json(roomManager.stats());
});

// ---- Link preview proxy -----------------------------------------------
// The server is otherwise content-blind by design, but browsers can't
// fetch arbitrary cross-origin HTML to read Open Graph tags. This proxy
// fetches a page ONCE on the sharer's behalf, extracts title/description/
// image, and returns just that — nothing is stored. Basic SSRF guards
// (scheme allow-list + private/loopback IP block) keep it from being used
// to probe internal network services.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      a === 0 || (a === 169 && b === 254) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80');
  }
  return true;
}

function extractMeta(html) {
  const get = (re) => (html.match(re) || [])[1];
  const og = (prop) => get(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']*)["']`, 'i'))
    || get(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${prop}["']`, 'i'));
  const title = og('title') || get(/<title[^>]*>([^<]*)<\/title>/i);
  const description = og('description') || get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const image = og('image');
  const decode = (s) => s && s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return { title: decode(title)?.trim().slice(0, 200) || null, description: decode(description)?.trim().slice(0, 300) || null, image: image || null };
}

app.get('/api/link-preview', rateLimit, async (req, res) => {
  const target = req.query.url;
  let parsed;
  try {
    parsed = new URL(target);
  } catch (_err) {
    return res.status(400).json({ error: 'Invalid URL.' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http/https URLs are supported.' });
  }

  try {
    const { address } = await dns.lookup(parsed.hostname);
    if (isPrivateIp(address)) return res.status(400).json({ error: 'That address cannot be previewed.' });
  } catch (_err) {
    return res.status(400).json({ error: 'Could not resolve host.' });
  }

  const client = parsed.protocol === 'https:' ? https : http;
  const request = client.get(parsed, {
    headers: { 'User-Agent': 'MeshOS-LinkPreview/1.0 (+stateless, no data retained)' },
    timeout: 5000,
  }, (upstream) => {
    if (upstream.statusCode >= 400) { upstream.resume(); return res.status(200).json({ title: null, description: null, image: null }); }
    let data = '';
    let bytes = 0;
    upstream.setEncoding('utf8');
    upstream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 300 * 1024) { upstream.destroy(); return; } // 300KB cap — plenty for <head>
      data += chunk;
    });
    upstream.on('end', () => res.json(extractMeta(data)));
    upstream.on('close', () => { if (!res.headersSent) res.json(extractMeta(data)); });
  });
  request.on('timeout', () => request.destroy(new Error('timeout')));
  request.on('error', () => { if (!res.headersSent) res.status(200).json({ title: null, description: null, image: null }); });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---- Static client -----------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'client')));

app.get('/w/:code', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'workspace.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// ---- Boot ----------------------------------------------------------------
const server = http.createServer(app);
attachSignalingServer(server, roomManager);

server.listen(config.PORT, () => {
  console.log(`\n  MeshOS server running`);
  console.log(`  → Local:   http://localhost:${config.PORT}`);
  console.log(`  → Signal:  ws://localhost:${config.PORT}/ws\n`);
});

module.exports = server;