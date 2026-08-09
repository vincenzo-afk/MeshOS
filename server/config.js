/**
 * MeshOS Server Configuration
 * Central place for tunable server constants. No file storage settings exist
 * here on purpose -- MeshOS never persists user data or transferred files.
 */
'use strict';

module.exports = {
  PORT: process.env.PORT || 3000,

  // A room is destroyed automatically after this many milliseconds with
  // zero connected participants (grace period so refreshes don't kill it).
  ROOM_EMPTY_TTL_MS: 5 * 60 * 1000, // 5 minutes

  // A room is destroyed if it has been open this long regardless of activity,
  // unless the admin has "pinned" it (future extension point).
  ROOM_MAX_LIFETIME_MS: 12 * 60 * 60 * 1000, // 12 hours

  // Hard cap on participants per room to keep the WebRTC mesh sane
  // (full-mesh topology grows O(n^2) connections).
  ROOM_MAX_PARTICIPANTS: 24,

  // Room codes: short, human-friendly, hard to brute force in bulk
  // when combined with rate limiting.
  ROOM_CODE_LENGTH: 6,
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // no 0/O/1/I

  // Basic rate limiting for room creation / join attempts per IP.
  RATE_LIMIT_WINDOW_MS: 60 * 1000,
  RATE_LIMIT_MAX_REQUESTS: 40,

  // WebSocket heartbeat so dead peers are pruned from the roster quickly.
  HEARTBEAT_INTERVAL_MS: 15 * 1000,
  HEARTBEAT_TIMEOUT_MS: 35 * 1000,

  // Maximum chat/system message size accepted over the signaling channel
  // (bulk data such as files never touches the server at all).
  MAX_WS_MESSAGE_BYTES: 64 * 1024,
};