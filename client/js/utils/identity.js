/**
 * MeshOS Local Identity
 *
 * Your name, computer name, and workspace password are per-device UI
 * convenience state, not workspace data, so they live in sessionStorage
 * (scoped to this tab -- each browser tab is its own "virtual computer")
 * with a localStorage fallback purely to pre-fill the form next time.
 * None of this ever reaches the signaling server except as the `meta`
 * object sent with the join request.
 */
import { detectOS, detectBrowser, colorFromString, randomComputerName } from './helpers.js';

const SESSION_KEY = 'meshos.identity.v1';
const REMEMBERED_KEY = 'meshos.identity.remembered.v1';
const PENDING_PW_KEY = 'meshos.pendingPassword.v1';
const PENDING_OWNER_TOKEN_KEY = 'meshos.pendingOwnerToken.v1';

function readJSON(storage, key) {
  try {
    return JSON.parse(storage.getItem(key)) || {};
  } catch (_err) {
    return {};
  }
}

function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (_err) {
    /* private browsing / quota exceeded — non-fatal, identity just won't persist */
  }
}

/** Stores the identity for this tab's session and remembers it as a default for next time. */
export function setIdentity({ username, computerName }) {
  const identity = {
    username: String(username || 'Guest').slice(0, 24),
    computerName: String(computerName || randomComputerName()).slice(0, 28),
  };
  writeJSON(sessionStorage, SESSION_KEY, identity);
  writeJSON(localStorage, REMEMBERED_KEY, identity);
  return identity;
}

/** Returns the identity set earlier in this tab's session, if any. */
export function getIdentity() {
  return readJSON(sessionStorage, SESSION_KEY);
}

/** Returns the last-remembered name/computer-name, used to pre-fill the landing forms. */
export function getRememberedDefaults() {
  return readJSON(localStorage, REMEMBERED_KEY);
}

export function setPendingPassword(password) {
  try {
    sessionStorage.setItem(PENDING_PW_KEY, password || '');
  } catch (_err) {
    /* ignore */
  }
}

export function getPendingPassword() {
  try {
    return sessionStorage.getItem(PENDING_PW_KEY) || '';
  } catch (_err) {
    return '';
  }
}

export function clearPendingPassword() {
  try {
    sessionStorage.removeItem(PENDING_PW_KEY);
  } catch (_err) {
    /* ignore */
  }
}

/**
 * The one-time secret returned by POST /api/rooms, proving to the
 * signaling server that this browser is the room's actual creator (not
 * just someone who learned the code before the creator's own WebSocket
 * connected). See the matching comment in server/rooms.js.
 */
export function setPendingOwnerToken(token) {
  try {
    sessionStorage.setItem(PENDING_OWNER_TOKEN_KEY, token || '');
  } catch (_err) {
    /* ignore */
  }
}

export function getPendingOwnerToken() {
  try {
    return sessionStorage.getItem(PENDING_OWNER_TOKEN_KEY) || '';
  } catch (_err) {
    return '';
  }
}

export function clearPendingOwnerToken() {
  try {
    sessionStorage.removeItem(PENDING_OWNER_TOKEN_KEY);
  } catch (_err) {
    /* ignore */
  }
}

/** Builds the full `meta` object sent with the `join` signaling message. */
export function buildJoinMeta() {
  const identity = getIdentity();
  const username = identity.username || 'Guest';
  const computerName = identity.computerName || randomComputerName();
  return {
    username,
    computerName,
    avatar: colorFromString(username + computerName),
    os: detectOS(),
    browserInfo: {
      name: detectBrowser(),
      userAgent: navigator.userAgent,
      language: navigator.language,
    },
  };
}
