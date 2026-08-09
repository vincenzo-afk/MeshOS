/**
 * MeshOS Signaling Socket
 *
 * Thin wrapper around the browser WebSocket that talks to
 * server/signaling.js. Normalizes every inbound message into a typed
 * event on this Emitter so network/webrtc.js and network/peers.js never
 * touch raw JSON. Handles auto-reconnect with backoff; the room-join
 * handshake itself is NOT silently retried after the first attempt so the
 * UI can surface a clear error (wrong password, room locked, etc).
 */
import { Emitter } from '../utils/emitter.js';
import { WS_PATH } from '../config.js';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10000;
const JOIN_TIMEOUT_MS = 9000;

export class MeshSocket extends Emitter {
  constructor() {
    super();
    /** @type {WebSocket|null} */
    this.ws = null;
    this.peerId = null;
    this.room = null;
    this.connected = false;

    this._joinPayload = null;
    this._pendingJoin = null;
    this._joinTimeoutTimer = null;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._manuallyClosed = false;
  }

  _url() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}${WS_PATH}`;
  }

  /**
   * Opens the connection and attempts to join a room.
   * @param {{roomCode:string, createIfMissing?:boolean, roomName?:string, password?:string, requireApproval?:boolean, meta:object}} payload
   * @returns {Promise<object>} resolves with the `joined` message, rejects with a user-facing Error
   */
  join(payload) {
    this._joinPayload = payload;
    this._manuallyClosed = false;
    return new Promise((resolve, reject) => {
      this._pendingJoin = { resolve, reject };
      clearTimeout(this._joinTimeoutTimer);
      this._joinTimeoutTimer = setTimeout(() => {
        if (this._pendingJoin) {
          this._pendingJoin.reject(new Error('Connection timed out. Check your network and try again.'));
          this._pendingJoin = null;
        }
      }, JOIN_TIMEOUT_MS);
      this._connect();
    });
  }

  _connect() {
    let socket;
    try {
      socket = new WebSocket(this._url());
    } catch (_err) {
      this._scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.addEventListener('open', () => {
      this.connected = true;
      this._reconnectAttempts = 0;
      this.emit('open');
      if (this._joinPayload) this._send({ type: 'join', ...this._joinPayload });
    });

    socket.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (_err) {
        return;
      }
      this._handleMessage(msg);
    });

    socket.addEventListener('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.emit('close', wasConnected);
      if (!this._manuallyClosed) this._scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      this.emit('socket-error');
    });
  }

  _scheduleReconnect() {
    if (this._manuallyClosed) return;
    clearTimeout(this._reconnectTimer);
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this._reconnectAttempts);
    this._reconnectAttempts += 1;
    this._reconnectTimer = setTimeout(() => {
      this.emit('reconnecting', this._reconnectAttempts);
      this._connect();
    }, delay);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'joined':
        this.peerId = msg.peerId;
        this.room = msg.room;
        if (this._pendingJoin) {
          clearTimeout(this._joinTimeoutTimer);
          this._pendingJoin.resolve(msg);
          this._pendingJoin = null;
        }
        this.emit('joined', msg);
        break;
      case 'pending-approval':
        this.room = msg.room;
        this.emit('pending-approval', msg.room);
        break;
      case 'approval-request':
        this.emit('approval-request', msg.peerId, msg.participant);
        break;
      case 'join-error':
        if (this._pendingJoin) {
          clearTimeout(this._joinTimeoutTimer);
          this._pendingJoin.reject(new Error(msg.message || 'Could not join workspace.'));
          this._pendingJoin = null;
        }
        this.emit('join-error', msg.message);
        break;
      case 'peer-joined':
        this.emit('peer-joined', msg.participant);
        break;
      case 'peer-left':
        this.emit('peer-left', msg.peerId);
        break;
      case 'signal':
        this.emit('signal', msg.from, msg.data);
        break;
      case 'room-updated':
        this.room = msg.room;
        this.emit('room-updated', msg.room);
        break;
      case 'kicked':
        this.emit('kicked', msg.reason);
        break;
      case 'error':
        this.emit('server-error', msg.message);
        break;
      case 'pong':
        this.emit('pong', msg.t);
        break;
      default:
        this.emit('unknown-message', msg);
    }
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  /** Relays a WebRTC offer/answer/ICE payload to an exact peer. */
  sendSignal(to, data) {
    return this._send({ type: 'signal', to, data });
  }

  /** Sends a room-administration action (lock, kick, mute-chat, ...). Owner-only, enforced server-side. */
  sendAdmin(action, extra = {}) {
    return this._send({ type: 'admin', action, ...extra });
  }

  ping() {
    return this._send({ type: 'ping', t: performance.now() });
  }

  /** Gracefully leaves the room and stops all reconnect attempts. */
  leave() {
    this._send({ type: 'leave' });
    this._manuallyClosed = true;
    clearTimeout(this._reconnectTimer);
    clearTimeout(this._joinTimeoutTimer);
    this._joinPayload = null;
    this.ws?.close();
  }
}
