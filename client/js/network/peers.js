/**
 * MeshOS Peer Directory
 * Merges room roster metadata (from the signaling server) with live WebRTC
 * connection state (from network/webrtc.js) into one queryable directory
 * used by the Network Explorer, Topology Map, and Device Dashboard apps.
 */
import { Emitter } from '../utils/emitter.js';

export class PeerDirectory extends Emitter {
  constructor(socket, peerManager) {
    super();
    this.socket = socket;
    this.peerManager = peerManager;
    /** @type {Map<string, object>} */
    this.directory = new Map();
    this._pingTimers = new Map();

    socket.on('joined', (msg) => {
      msg.roster.forEach((p) => this._upsert(p));
      this.emit('change');
    });
    socket.on('peer-joined', (participant) => {
      this._upsert(participant);
      this.emit('change');
    });
    socket.on('peer-left', (peerId) => {
      this.directory.delete(peerId);
      this._clearPing(peerId);
      this.emit('change');
    });
    socket.on('room-updated', () => this.emit('change'));

    peerManager.on('peer-state', (peerId, state) => {
      const rec = this.directory.get(peerId);
      if (rec) {
        rec.connectionState = state;
        this.emit('change');
      }
    });

    peerManager.on('channel-open', (peerId, label) => {
      if (label === 'main') this._startPing(peerId);
    });

    peerManager.on('peer-disconnected', (peerId) => {
      const rec = this.directory.get(peerId);
      if (rec) rec.connectionState = 'disconnected';
      this._clearPing(peerId);
      this.emit('change');
    });

    peerManager.on('message', (peerId, label, msg) => {
      if (label !== 'main') return;
      if (msg.type === 'presence-ping') {
        this.peerManager.sendJSON(peerId, { type: 'presence-pong', t: msg.t });
      } else if (msg.type === 'presence-pong') {
        const rec = this.directory.get(peerId);
        if (rec) rec.latencyMs = Math.round(performance.now() - msg.t);
        this.emit('change');
      } else if (msg.type === 'presence-update') {
        this._upsert({ peerId, ...msg.meta });
        this.emit('change');
      }
    });
  }

  _upsert(participant) {
    const existing = this.directory.get(participant.peerId) || {};
    this.directory.set(participant.peerId, {
      ...existing,
      ...participant,
      connectionState: existing.connectionState || 'connecting',
      latencyMs: existing.latencyMs ?? null,
    });
  }

  _startPing(peerId) {
    this._clearPing(peerId);
    const send = () => this.peerManager.sendJSON(peerId, { type: 'presence-ping', t: performance.now() });
    send();
    this._pingTimers.set(peerId, setInterval(send, 5000));
  }

  _clearPing(peerId) {
    const t = this._pingTimers.get(peerId);
    if (t) clearInterval(t);
    this._pingTimers.delete(peerId);
  }

  list() {
    return Array.from(this.directory.values());
  }

  get(peerId) {
    return this.directory.get(peerId);
  }

  connectionQuality(peerId) {
    const rec = this.directory.get(peerId);
    if (!rec || rec.connectionState !== 'connected') return 'offline';
    if (rec.latencyMs == null) return 'good';
    if (rec.latencyMs < 80) return 'excellent';
    if (rec.latencyMs < 200) return 'good';
    return 'poor';
  }
}