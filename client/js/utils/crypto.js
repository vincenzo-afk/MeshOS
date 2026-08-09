/**
 * MeshOS End-to-End Encryption Helpers
 *
 * Uses the browser's native Web Crypto API (AES-GCM). The symmetric room
 * key is generated client-side and shared only via the URL fragment
 * (`#key=...`), which browsers never transmit to the server — so MeshOS's
 * signaling server can never see, derive, or store it.
 */

const te = new TextEncoder();
const td = new TextDecoder();

export async function generateRoomKey() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return key;
}

export async function exportKeyToBase64(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufferToBase64(raw);
}

export async function importKeyFromBase64(b64) {
  const raw = base64ToBuffer(b64);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function encryptText(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext));
  return { iv: bufferToBase64(iv), data: bufferToBase64(ciphertext) };
}

export async function decryptText(key, payload) {
  const iv = base64ToBuffer(payload.iv);
  const data = base64ToBuffer(payload.data);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return td.decode(plain);
}

/** Encrypts a binary chunk (e.g. a file chunk) and returns iv+ciphertext concatenated. */
export async function encryptBuffer(key, arrayBuffer) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, arrayBuffer);
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return out.buffer;
}

export async function decryptBuffer(key, combinedBuffer) {
  const bytes = new Uint8Array(combinedBuffer);
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64ToBuffer(b64) {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '==='.slice((norm.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}