/**
 * MeshOS Room Management
 *
 * The server is deliberately "dumb" about content: it only tracks who is in
 * which room, room-level settings, and administrative permissions. No chat
 * text, files, whiteboard strokes, or clipboard content ever passes through
 * or is stored on the server -- that all flows peer-to-peer over WebRTC.
 */
'use strict';

const { EventEmitter } = require('events');
const config = require('./config');

function generateRoomCode() {
  const { ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } = config;
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

class Room {
  constructor(code, options = {}) {
    this.code = code;
    // Client-supplied and broadcast to every participant, so it's capped
    // the same way Participant's fields are (see the comment there).
    this.name = (typeof options.name === 'string' && options.name.trim()) ? options.name.trim().slice(0, 64) : `Workspace ${code}`;
    this.passwordHash = options.passwordHash || null; // never store plaintext
    this.locked = false;
    this.requireApproval = Boolean(options.requireApproval);
    this.chatMuted = false;
    this.uploadsDisabled = false;
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
    this.ownerId = null; // peerId of the room owner (first creator, transferable)
    // One-time secret handed only to whoever created this room via the REST
    // API. The landing page creates the room (so it can show the QR code
    // and share link) *before* its own WebSocket ever joins, which leaves
    // a real window — sometimes many seconds, how ever long the creator
    // takes to click through — where the room exists with zero
    // participants. Without this token, anyone who learned the room code
    // during that window could connect first and silently become the
    // unauthorized owner/admin, bypassing "require approval" entirely.
    // Cleared the instant the real owner claims it.
    this.ownerToken = options.ownerToken || null;
    this.participants = new Map(); // peerId -> participant meta
    this.pendingApprovals = new Map(); // peerId -> participant meta awaiting admin decision
  }

  touch() {
    this.lastActivityAt = Date.now();
  }

  isEmpty() {
    return this.participants.size === 0;
  }

  isExpiredByLifetime() {
    return Date.now() - this.createdAt > config.ROOM_MAX_LIFETIME_MS;
  }

  isExpiredByInactivity() {
    return this.isEmpty() && Date.now() - this.lastActivityAt > config.ROOM_EMPTY_TTL_MS;
  }

  toPublicJSON() {
    return {
      code: this.code,
      name: this.name,
      locked: this.locked,
      requireApproval: this.requireApproval,
      chatMuted: this.chatMuted,
      uploadsDisabled: this.uploadsDisabled,
      hasPassword: Boolean(this.passwordHash),
      participantCount: this.participants.size,
      ownerId: this.ownerId,
      createdAt: this.createdAt,
    };
  }

  rosterJSON(excludePeerId = null) {
    return Array.from(this.participants.values())
      .filter((p) => p.peerId !== excludePeerId)
      .map((p) => p.toPublicJSON());
  }
}

class Participant {
  constructor(peerId, ws, meta = {}) {
    this.peerId = peerId;
    this.ws = ws;
    // Every field here is client-supplied and gets broadcast verbatim to
    // every other participant, so it's capped/coerced defensively — the
    // server doesn't otherwise care what's in it (no HTML/JS is ever
    // executed here), but an unbounded string is still a cheap way to
    // bloat every roster broadcast in the room.
    this.computerName = Participant._clampString(meta.computerName, 'Unnamed-PC', 40);
    this.username = Participant._clampString(meta.username, 'Guest', 32);
    this.avatar = Participant._clampString(meta.avatar, null, 32);
    this.browserInfo = {
      name: Participant._clampString(meta.browserInfo?.name, 'Unknown', 40),
      userAgent: Participant._clampString(meta.browserInfo?.userAgent, '', 200),
      language: Participant._clampString(meta.browserInfo?.language, '', 20),
    };
    this.os = Participant._clampString(meta.os, 'Unknown OS', 40);
    this.isAdmin = false;
    this.joinedAt = Date.now();
    this.lastSeenAt = Date.now();
    this.alive = true;
  }

  static _clampString(value, fallback, maxLen) {
    if (typeof value !== 'string' || value.length === 0) return fallback;
    return value.slice(0, maxLen);
  }

  toPublicJSON() {
    return {
      peerId: this.peerId,
      computerName: this.computerName,
      username: this.username,
      avatar: this.avatar,
      browserInfo: this.browserInfo,
      os: this.os,
      isAdmin: this.isAdmin,
      joinedAt: this.joinedAt,
    };
  }
}

class RoomManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this._sweepTimer = setInterval(() => this.sweepExpiredRooms(), 30 * 1000);
    this._sweepTimer.unref?.();
  }

  createRoom(options = {}) {
    let code;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));

    const room = new Room(code, options);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get((code || '').toUpperCase());
  }

  removeRoom(code) {
    this.rooms.delete(code);
  }

  sweepExpiredRooms() {
    for (const [code, room] of this.rooms) {
      if (room.isExpiredByInactivity()) {
        // Empty and idle — nobody to notify, just drop it.
        this.rooms.delete(code);
      } else if (room.isExpiredByLifetime()) {
        // This can happen to a room that's still actively in use. Emit
        // first so signaling.js can gracefully close each participant's
        // WebSocket with an explanation *before* the room record
        // disappears out from under them — otherwise they'd be left in a
        // silently broken state where the room no longer exists
        // server-side but their tab has no idea.
        this.emit('room-expired', room);
        this.rooms.delete(code);
      }
    }
  }

  stats() {
    let totalParticipants = 0;
    for (const room of this.rooms.values()) totalParticipants += room.participants.size;
    return { totalRooms: this.rooms.size, totalParticipants };
  }
}

module.exports = { Room, Participant, RoomManager, generateRoomCode };