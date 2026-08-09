/**
 * MeshOS WebRTC Mesh Manager
 *
 * MeshOS uses a full-mesh topology: every browser opens a direct encrypted
 * RTCPeerConnection to every other browser in the room. The signaling
 * server (network/socket.js) only relays offers/answers/ICE candidates —
 * it never sees decrypted media or data.
 *
 * Glare avoidance: only the newcomer initiates connections to the roster
 * they receive on join. Existing participants always wait for an incoming
 * offer from the newcomer, so two peers never race to send simultaneous
 * offers to each other.
 *
 * Each peer connection carries two reliable, ordered DataChannels:
 *   - "main": JSON-encoded control messages (chat, presence, clipboard,
 *             whiteboard ops, notes ops, terminal, link shares, pings)
 *   - "file": binary file chunks (each chunk prefixed with a 4-byte
 *             transfer id so multiple simultaneous transfers can share
 *             one ordered channel) plus JSON transfer-control messages.
 */
import { Emitter } from '../utils/emitter.js';
import { ICE_SERVERS } from '../config.js';

const CHANNEL_LABELS = ['main', 'file'];

class Peer extends Emitter {
  constructor(peerId, { initiator }) {
    super();
    this.peerId = peerId;
    this.initiator = initiator;
    this.channels = {};
    this.connectionState = 'new';
    this.latencyMs = null;
    this.remoteStream = null;
    this._makingOffer = false;

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) this.emit('ice-candidate', ev.candidate.toJSON());
    };

    this.pc.onconnectionstatechange = () => {
      this.connectionState = this.pc.connectionState;
      this.emit('state', this.connectionState);
    };

    this.pc.ontrack = (ev) => {
      this.remoteStream = ev.streams[0];
      this.emit('track', ev.track, ev.streams[0]);
    };

    this.pc.ondatachannel = (ev) => {
      this._wireChannel(ev.channel);
    };

    // Fires again any time tracks are added/removed after the initial
    // connection (e.g. starting a screen share mid-session). The very
    // first negotiationneeded (fired by creating the data channels below)
    // is intentionally ignored — that initial offer is sent explicitly by
    // PeerManager._connectTo once this constructor returns.
    this._readyForRenegotiation = false;
    this.pc.onnegotiationneeded = async () => {
      if (!this._readyForRenegotiation || this._makingOffer) return;
      try {
        const offer = await this.createOffer();
        this.emit('renegotiate', offer);
      } catch (err) {
        console.warn('[MeshOS] renegotiation failed', err);
      }
    };

    if (initiator) {
      for (const label of CHANNEL_LABELS) {
        const ch = this.pc.createDataChannel(label, { ordered: true });
        this._wireChannel(ch);
      }
    }
  }

  /** Called once the very first offer/answer handshake has been sent, so
   *  later onnegotiationneeded events (new tracks, etc.) are allowed through. */
  markReadyForRenegotiation() {
    this._readyForRenegotiation = true;
  }

  _wireChannel(channel) {
    channel.binaryType = 'arraybuffer';
    this.channels[channel.label] = channel;
    channel.onopen = () => this.emit('channel-open', channel.label);
    channel.onclose = () => this.emit('channel-close', channel.label);
    channel.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let obj;
        try {
          obj = JSON.parse(ev.data);
        } catch (_) {
          return;
        }
        this.emit('json', channel.label, obj);
      } else {
        this.emit('binary', channel.label, ev.data);
      }
    };
  }

  isChannelOpen(label) {
    return this.channels[label]?.readyState === 'open';
  }

  sendJSON(label, obj) {
    const ch = this.channels[label];
    if (ch && ch.readyState === 'open') {
      ch.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  sendBinary(label, buffer) {
    const ch = this.channels[label];
    if (ch && ch.readyState === 'open') {
      ch.send(buffer);
      return true;
    }
    return false;
  }

  bufferedAmount(label) {
    return this.channels[label]?.bufferedAmount ?? 0;
  }

  async createOffer() {
    this._makingOffer = true;
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      return offer;
    } finally {
      this._makingOffer = false;
    }
  }

  async handleOffer(offer) {
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(answer) {
    await this.pc.setRemoteDescription(answer);
  }

  async addIceCandidate(candidate) {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn('[MeshOS] ICE candidate error', err);
    }
  }

  addStreamTrack(track, stream) {
    this.pc.addTrack(track, stream);
  }

  removeAllSenders() {
    this.pc.getSenders().forEach((s) => {
      if (s.track) {
        try {
          this.pc.removeTrack(s);
        } catch (_) {}
      }
    });
  }

  close() {
    Object.values(this.channels).forEach((ch) => {
      try {
        ch.close();
      } catch (_) {}
    });
    try {
      this.pc.close();
    } catch (_) {}
  }
}

export class PeerManager extends Emitter {
  constructor(socket) {
    super();
    this.socket = socket;
    /** @type {Map<string, Peer>} */
    this.peers = new Map();

    socket.on('joined', (msg) => {
      msg.roster.forEach((p) => {
        if (p.peerId !== socket.peerId) this._connectTo(p.peerId, true);
      });
    });

    socket.on('peer-left', (peerId) => {
      const peer = this.peers.get(peerId);
      if (peer) {
        // Delete first so the peer's own 'state' listener (which may still
        // fire asynchronously once pc.close() settles) sees this peerId as
        // already gone and skips re-emitting peer-disconnected.
        this.peers.delete(peerId);
        peer.close();
      }
      this.emit('peer-disconnected', peerId);
    });

    socket.on('signal', (from, data) => {
      this._handleSignal(from, data);
    });
  }

  _connectTo(peerId, initiator) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);

    const peer = new Peer(peerId, { initiator });
    this.peers.set(peerId, peer);

    peer.on('ice-candidate', (candidate) => {
      this.socket.sendSignal(peerId, { kind: 'ice', candidate });
    });

    peer.on('state', (state) => {
      if (!this.peers.has(peerId)) return; // already torn down (e.g. via an explicit peer-left)
      this.emit('peer-state', peerId, state);
      if (state === 'connected') this.emit('peer-connected', peerId);
      if (state === 'failed' || state === 'closed') {
        // A genuinely failed/closed connection must be removed from the
        // map, not just flagged — otherwise a stale, permanently-broken
        // Peer object sits at this peerId forever and _connectTo()'s
        // `if (this.peers.has(peerId)) return ...` short-circuit would
        // silently hand out that dead connection to any future caller,
        // with no way to ever reconnect to this peer again.
        this.peers.delete(peerId);
        peer.close();
        this.emit('peer-disconnected', peerId);
      }
    });

    peer.on('channel-open', (label) => this.emit('channel-open', peerId, label));

    peer.on('json', (label, obj) => this.emit('message', peerId, label, obj));
    peer.on('binary', (label, buf) => this.emit('binary', peerId, label, buf));
    peer.on('track', (track, stream) => this.emit('track', peerId, track, stream));
    peer.on('renegotiate', (offer) => {
      this.socket.sendSignal(peerId, { kind: 'offer', offer });
    });

    if (initiator) {
      peer.createOffer().then((offer) => {
        this.socket.sendSignal(peerId, { kind: 'offer', offer });
        peer.markReadyForRenegotiation();
      });
    }

    return peer;
  }

  async _handleSignal(from, data) {
    let peer = this.peers.get(from);

    if (data.kind === 'offer') {
      if (!peer) peer = this._connectTo(from, false);
      const answer = await peer.handleOffer(data.offer);
      this.socket.sendSignal(from, { kind: 'answer', answer });
      peer.markReadyForRenegotiation();
    } else if (data.kind === 'answer') {
      if (peer) await peer.handleAnswer(data.answer);
    } else if (data.kind === 'ice') {
      if (peer) await peer.addIceCandidate(data.candidate);
    }
  }

  getPeer(peerId) {
    return this.peers.get(peerId);
  }

  connectedPeerIds() {
    return Array.from(this.peers.entries())
      .filter(([, p]) => p.connectionState === 'connected')
      .map(([id]) => id);
  }

  /** Broadcasts a JSON control message to all connected peers over "main". */
  broadcastJSON(obj, excludePeerId = null) {
    for (const [peerId, peer] of this.peers) {
      if (peerId === excludePeerId) continue;
      peer.sendJSON('main', obj);
    }
  }

  sendJSON(peerId, obj) {
    return this.peers.get(peerId)?.sendJSON('main', obj);
  }

  closeAll() {
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
  }
}