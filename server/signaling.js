/**
 * MeshOS Signaling Layer
 *
 * Responsibilities ONLY:
 *   1. Room membership (join / leave / roster broadcast)
 *   2. Relaying WebRTC offer/answer/ICE candidates between exact peers
 *   3. Administrative actions (lock, mute, kick, approve, permissions)
 *   4. Connection health (heartbeat)
 *
 * This module never inspects, stores, or forwards chat text, files,
 * whiteboard data, clipboard content, or notes -- those travel directly
 * between browsers over WebRTC DataChannels once signaling completes.
 */
'use strict';

const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const config = require('./config');
const { Participant } = require('./rooms');

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (_) {
      /* socket closed mid-send, ignore */
    }
  }
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function attachSignalingServer(server, roomManager) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // A room can expire out from under still-connected participants (see the
  // ROOM_MAX_LIFETIME_MS comment in rooms.js) — tell each of them plainly
  // and close their connection cleanly rather than leaving them talking to
  // a room the server no longer has any record of.
  roomManager.on('room-expired', (room) => {
    for (const participant of room.participants.values()) {
      safeSend(participant.ws, { type: 'error', message: 'This workspace has expired and been closed.' });
      safeSend(participant.ws, { type: 'kicked', reason: 'Workspace expired' });
      try { participant.ws.close(4000, 'Workspace expired'); } catch (_err) { /* already closing */ }
    }
    for (const pending of room.pendingApprovals.values()) {
      safeSend(pending.ws, { type: 'join-error', message: 'This workspace has expired.' });
      try { pending.ws.close(4000, 'Workspace expired'); } catch (_err) { /* already closing */ }
    }
  });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.peerId = null;
    ws.roomCode = null;
    ws.ip = req.socket.remoteAddress;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      if (raw.length > config.MAX_WS_MESSAGE_BYTES) {
        return safeSend(ws, { type: 'error', message: 'Message too large.' });
      }
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return safeSend(ws, { type: 'error', message: 'Malformed message.' });
      }
      handleMessage(ws, msg, roomManager);
    });

    ws.on('close', () => handleLeave(ws, roomManager));
    ws.on('error', () => handleLeave(ws, roomManager));
  });

  // Heartbeat sweep: drop dead sockets, keep rosters accurate.
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        handleLeave(ws, roomManager);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, config.HEARTBEAT_INTERVAL_MS);
  interval.unref?.();

  wss.on('close', () => clearInterval(interval));

  return wss;
}

function handleMessage(ws, msg, roomManager) {
  switch (msg.type) {
    case 'join':
      return handleJoin(ws, msg, roomManager);
    case 'signal':
      return handleSignal(ws, msg, roomManager);
    case 'admin':
      return handleAdmin(ws, msg, roomManager);
    case 'leave':
      return handleLeave(ws, roomManager);
    case 'ping':
      return safeSend(ws, { type: 'pong', t: msg.t });
    default:
      return safeSend(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
  }
}

function handleJoin(ws, msg, roomManager) {
  const roomCode = (msg.roomCode || '').toUpperCase().trim();
  let room = roomManager.getRoom(roomCode);

  if (msg.createIfMissing && !room) {
    room = roomManager.createRoom({
      name: msg.roomName,
      passwordHash: msg.password ? hashPassword(msg.password) : null,
      requireApproval: Boolean(msg.requireApproval),
    });
  }

  if (!room) {
    return safeSend(ws, { type: 'join-error', message: 'Room not found. Check the code and try again.' });
  }

  if (room.locked && room.participants.size > 0) {
    return safeSend(ws, { type: 'join-error', message: 'This workspace is locked by the administrator.' });
  }

  if (room.passwordHash && hashPassword(msg.password || '') !== room.passwordHash) {
    return safeSend(ws, { type: 'join-error', message: 'Incorrect workspace password.' });
  }

  if (room.participants.size >= config.ROOM_MAX_PARTICIPANTS) {
    return safeSend(ws, { type: 'join-error', message: 'Workspace is full.' });
  }

  const peerId = crypto.randomUUID();
  const participant = new Participant(peerId, ws, msg.meta || {});

  const isFirstParticipant = room.participants.size === 0;

  // Refuse to hand out unauthorized ownership of a room that was reserved
  // via the REST create-room flow but whose real creator hasn't connected
  // yet (see the ownerToken comment in rooms.js).
  if (isFirstParticipant && room.ownerToken && room.ownerToken !== msg.ownerToken) {
    return safeSend(ws, {
      type: 'join-error',
      message: 'Waiting for the workspace host to finish connecting. Please try again in a moment.',
    });
  }

  if (isFirstParticipant) {
    room.ownerId = peerId;
    participant.isAdmin = true;
    room.ownerToken = null; // one-time claim
  }

  ws.peerId = peerId;
  ws.roomCode = room.code;
  room.touch();

  const finalizeJoin = () => {
    room.participants.set(peerId, participant);
    safeSend(ws, {
      type: 'joined',
      peerId,
      room: room.toPublicJSON(),
      roster: room.rosterJSON(),
    });
    broadcastToRoom(room, { type: 'peer-joined', participant: participant.toPublicJSON() }, peerId);
  };

  if (!isFirstParticipant && room.requireApproval) {
    room.pendingApprovals.set(peerId, participant);
    safeSend(ws, { type: 'pending-approval', room: room.toPublicJSON() });
    const owner = room.participants.get(room.ownerId);
    if (owner) {
      safeSend(owner.ws, {
        type: 'approval-request',
        peerId,
        participant: participant.toPublicJSON(),
      });
    }
    return;
  }

  finalizeJoin();
}

function handleSignal(ws, msg, roomManager) {
  const room = roomManager.getRoom(ws.roomCode);
  if (!room || !ws.peerId) return;
  const target = room.participants.get(msg.to);
  if (!target) return;
  room.touch();
  safeSend(target.ws, { type: 'signal', from: ws.peerId, data: msg.data });
}

function handleAdmin(ws, msg, roomManager) {
  const room = roomManager.getRoom(ws.roomCode);
  if (!room || !ws.peerId) return;
  const actor = room.participants.get(ws.peerId);
  if (!actor || !actor.isAdmin) {
    return safeSend(ws, { type: 'error', message: 'Administrator privileges required.' });
  }

  room.touch();

  switch (msg.action) {
    case 'lock':
      room.locked = Boolean(msg.value);
      break;
    case 'rename':
      room.name = String(msg.value || room.name).slice(0, 64);
      break;
    case 'mute-chat':
      room.chatMuted = Boolean(msg.value);
      break;
    case 'disable-uploads':
      room.uploadsDisabled = Boolean(msg.value);
      break;
    case 'approve': {
      const pending = room.pendingApprovals.get(msg.peerId);
      if (pending) {
        room.pendingApprovals.delete(msg.peerId);
        room.participants.set(pending.peerId, pending);
        safeSend(pending.ws, {
          type: 'joined',
          peerId: pending.peerId,
          room: room.toPublicJSON(),
          roster: room.rosterJSON(),
        });
        broadcastToRoom(room, { type: 'peer-joined', participant: pending.toPublicJSON() }, pending.peerId);
      }
      break;
    }
    case 'reject': {
      const pending = room.pendingApprovals.get(msg.peerId);
      if (pending) {
        room.pendingApprovals.delete(msg.peerId);
        safeSend(pending.ws, { type: 'join-error', message: 'The administrator declined your request to join.' });
        pending.ws.close();
      }
      break;
    }
    case 'kick': {
      const target = room.participants.get(msg.peerId);
      if (target) {
        safeSend(target.ws, { type: 'kicked', reason: msg.reason || 'Removed by administrator.' });
        room.participants.delete(msg.peerId);
        broadcastToRoom(room, { type: 'peer-left', peerId: msg.peerId }, null);
        target.ws.close();
      }
      break;
    }
    case 'transfer-owner': {
      const target = room.participants.get(msg.peerId);
      if (target) {
        actor.isAdmin = false;
        target.isAdmin = true;
        room.ownerId = target.peerId;
      }
      break;
    }
    default:
      return safeSend(ws, { type: 'error', message: `Unknown admin action: ${msg.action}` });
  }

  broadcastToRoom(room, { type: 'room-updated', room: room.toPublicJSON() }, null);
}

function handleLeave(ws, roomManager) {
  if (!ws.roomCode || !ws.peerId) return;
  const room = roomManager.getRoom(ws.roomCode);
  if (!room) return;

  room.participants.delete(ws.peerId);
  room.pendingApprovals.delete(ws.peerId);
  room.touch();

  if (room.ownerId === ws.peerId && room.participants.size > 0) {
    const next = room.participants.values().next().value;
    next.isAdmin = true;
    room.ownerId = next.peerId;
  }

  broadcastToRoom(room, { type: 'peer-left', peerId: ws.peerId }, null);

  if (room.isEmpty()) {
    // leave it to the sweep timer (grace period) instead of deleting instantly,
    // so brief refresh/reconnect cycles don't destroy an active workspace.
  }

  ws.peerId = null;
  ws.roomCode = null;
}

function broadcastToRoom(room, payload, excludePeerId) {
  for (const [peerId, participant] of room.participants) {
    if (peerId === excludePeerId) continue;
    safeSend(participant.ws, payload);
  }
}

module.exports = { attachSignalingServer };