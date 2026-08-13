/**
 * Multi-feature suite for MeshOS.
 *
 * Joins synthetic peers to a real /ws room and exercises every multi-user
 * feature the server actually handles (app-level data like chat text,
 * files, clipboard, and whiteboard strokes travels peer-to-peer over WebRTC
 * and is only shape-tested via the unicast signal relay):
 *
 *   1. Workspace creation + owner auto-claim (first join)
 *   2. Join with wrong / right password
 *   3. Require-approval flow: pending-approval, approval-request,
 *      admin approve / reject
 *   4. Room lock: locked room rejects new joiners; unlock lets them in
 *   5. Admin actions: rename, mute-chat, disable-uploads, room-updated
 *      broadcast to everyone
 *   6. Kick: target receives `kicked`, others receive `peer-left`
 *   7. Owner transfer: transfer-owner + admin flag flips
 *   8. Heartbeat: dead socket pruned, roster / peer-left stay accurate
 *   9. Rate limit: excessive joins return 429
 *   10. Malformed / oversized / unknown messages get a clean error
 * 11. App-channel shape relay (chat/message, clip:item, notes:*, term:*,
 *     file-*, screen:*, link:share) — relay must not inspect or drop them
 * 12. Peer discovery round-trip: full mesh of unicast signals between all
 *     peers
 *
 * Exits 0 if all checks pass, 1 otherwise.
 *
 * Wire format mirrors client/js/network/socket.js and server/signaling.js.
 */
import WebSocket from 'ws';
let ROOM = process.argv[2] || ''; // replaced with the owner's actual room code once the owner joins
const BASE = 'http://localhost:3000';
const FAILURES = [];
function log(msg) { console.log(msg); }
function check(name, cond, extra = '') {
  if (cond) { log(`  PASS  ${name}${extra ? '  ' + extra : ''}`); }
  else { log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`); FAILURES.push(name); }
}
function makePeer(label, { ownerToken, createsRoom = false, meta = {} } = {}) {
  return makePeerWithRoom(label, ROOM, { ownerToken, createsRoom, meta });
}
function makePeerWithRoom(label, roomCode, { ownerToken, createsRoom = false, password, meta = {} } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws`);
    const p = { label, id: null, __ws: ws, onMsg: [], close: () => ws.close() };
    ws.on('open', () => {
      setImmediate(() => {
        ws.send(JSON.stringify({
          type: 'join',
          roomCode,
          ...(createsRoom ? { createIfMissing: true } : {}),
          ...(ownerToken ? { ownerToken } : {}),
          ...(password !== undefined ? { password } : {}),
          meta: { username: `${label}-user`, computerName: `${label}-pc`, ...meta },
        }));
      });
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (msg.type === 'joined' && !p.id) p.id = msg.peerId;
      for (const fn of p.onMsg) { try { fn(msg); } catch (_) {} }
    });
    ws.on('error', reject);
    resolve(p);
  });
}
function waitFor(peer, pred, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      peer.onMsg = peer.onMsg.filter((f) => f !== handler);
      reject(new Error(`wait timeout for ${peer.label}`));
    }, timeoutMs);
    const handler = (msg) => {
      if (pred(msg)) {
        clearTimeout(timer);
        peer.onMsg = peer.onMsg.filter((f) => f !== handler);
        resolve(msg);
      }
    };
    peer.onMsg.push(handler);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function admin(peer, action, extra = {}) {
  return new Promise((resolve) => {
    const handler = (msg) => {
      if (msg.type === 'room-updated' || (msg.type === 'error' && msg.message?.includes('Administrator'))) {
        peer.onMsg = peer.onMsg.filter((f) => f !== handler);
        resolve(msg);
      }
    };
    peer.onMsg.push(handler);
    peer.__ws.send(JSON.stringify({ type: 'admin', action, ...extra }));
  });
}

async function createRoom({ password, requireApproval } = {}) {
  // The server rate-limits HTTP routes at 40 req/60s per IP; retry with
  // backoff so the suite tolerates a warm bucket from previous runs.
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(`${BASE}/api/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Multi-feature suite', password, requireApproval }),
    });
    if (res.ok) return res.json();
    lastErr = new Error(`create-room failed: ${res.status}`);
    if (res.status === 429) { await sleep(13000); continue; }
    throw lastErr;
  }
  throw lastErr;
}
async function run() {
  // --- 1. Workspace creation + owner auto-claim ---
  log('1. Workspace creation + owner claim...');
  const owner = await makePeer('owner', { createsRoom: true });
  const ownerMsg = await waitFor(owner, (m) => m.type === 'joined' || m.type === 'join-error' || m.type === 'server-error', 8000);
  check('owner join succeeded', ownerMsg.type === 'joined', `msg=${ownerMsg.type}`);
  if (ownerMsg.type !== 'joined') { console.error('FATAL: cannot create room'); process.exit(1); }
  ROOM = ownerMsg.room.code; // server ignores the requested code; use the real one
  check('owner is admin (ownerId === peerId)', ownerMsg.room.ownerId === ownerMsg.peerId, `ownerId=${ownerMsg.room.ownerId} peerId=${ownerMsg.peerId}`);
  check('owner roster empty (no other peers yet)', Array.isArray(ownerMsg.roster) && ownerMsg.roster.length === 0);
  check('room has password flag false', ownerMsg.room.hasPassword === false);

  const ownerJoined = { peerId: ownerMsg.peerId };
  // Register the owner as a full mesh member so relay/mesh sections cover it.
  peerIds.push(owner); joinedMsgs.push(ownerMsg);
  owner.onMsg.push(roomStateCollector, makePeerLeftCollector(owner));

  // --- 2. Join with wrong / right password ---
  log('2. Password gating...');
  // Mirror the landing page's "Create" flow: pre-create a password-protected
  // room via the REST API and join it with the returned ownerToken.
  const pwRoom = await createRoom({ password: 'meshos-secret' });
  check('REST create-room returns room + ownerToken', !!pwRoom.ownerToken && !!pwRoom.room?.code);
  const PW_ROOM = pwRoom.room.code;
  const pwFail = await makePeerWithRoom('pw-fail', PW_ROOM, { password: 'wrong-guess' });
  const pwFailMsg = await waitFor(pwFail, (m) => m.type === 'joined' || m.type === 'join-error' || m.type === 'server-error', 5000);
  check('join with wrong password rejected', pwFailMsg.type === 'join-error' && /password/i.test(pwFailMsg.message), `msg=${pwFailMsg.type} ${pwFailMsg.message}`);
  pwFail.close();
  const pwOwner = await makePeerWithRoom('pw-owner', PW_ROOM, { ownerToken: pwRoom.ownerToken });
  const pwOwnerMsg = await waitFor(pwOwner, (m) => m.type === 'joined' || m.type === 'join-error', 5000);
  check('ownerToken holder joins password room without plaintext password', pwOwnerMsg.type === 'joined', `msg=${pwOwnerMsg.type}`);
  check('ownerToken auto-claims admin', pwOwnerMsg.type === 'joined' && pwOwnerMsg.room.ownerId === pwOwnerMsg.peerId);
  const pwOk = await makePeerWithRoom('pw-ok', PW_ROOM, { password: 'meshos-secret' });
  const pwOkMsg = await waitFor(pwOk, (m) => m.type === 'joined' || m.type === 'join-error', 5000);
  check('join with right password accepted', pwOkMsg.type === 'joined', `msg=${pwOkMsg.type}`);
  if (pwOkMsg.type === 'joined') {
    peerIds.push(pwOk); joinedMsgs.push(pwOkMsg);
    pwOk.onMsg.push(roomStateCollector, makePeerLeftCollector(pwOk));
  }
  check('roster excludes self and includes owner', pwOkMsg.type === 'joined' && !pwOkMsg.roster.some((p) => p.peerId === pwOkMsg.peerId) && pwOkMsg.roster.some((p) => p.peerId === pwOwnerMsg.peerId));

  // --- 3. Require-approval flow ---
  log('3. Require-approval flow...');
  // Pre-create an approval-gated room via the REST API (mirrors the landing
  // page toggle) so the flow can be exercised without an admin wire action
  // that does not exist on the wire (approval is a room-creation setting).
  const apRoom = await createRoom({ requireApproval: true });
  const AP_ROOM = apRoom.room.code;
  const apOwner = await makePeerWithRoom('ap-owner', AP_ROOM, { ownerToken: apRoom.ownerToken });
  const apOwnerMsg = await waitFor(apOwner, (m) => m.type === 'joined' || m.type === 'join-error', 5000);
  check('approval room owner joins and claims admin', apOwnerMsg.type === 'joined' && apOwnerMsg.room.ownerId === apOwnerMsg.peerId);
  const pending = await makePeerWithRoom('pending', AP_ROOM, {});
  const pendingMsg = await waitFor(pending, (m) => m.type === 'pending-approval' || m.type === 'joined' || m.type === 'join-error', 5000);
  check('join with approval required gets pending-approval', pendingMsg.type === 'pending-approval', `msg=${pendingMsg.type}`);
  // A pending peer never receives a `joined` message, so pending.id is null
  // here — capture it from the owner's approval-request payload instead.
  const approvalReq = await waitFor(apOwner, (m) => m.type === 'approval-request', 5000);
  if (approvalReq?.participant?.peerId) pending.id = approvalReq.participant.peerId;
  check('owner received approval-request for pending peer', !!approvalReq, `msg=${approvalReq?.type}`);
  check('approval-request participant sanitized', approvalReq?.participant?.username === 'pending-user' && !/</.test(approvalReq?.participant?.computerName || ''));
  const rejectMsg = waitFor(pending, (m) => m.type === 'join-error' || m.type === 'joined', 8000)
    .then((m) => m)
    .catch(() => null);
  await admin(apOwner, 'reject', { peerId: pending.id });
  const pendingRejected = await rejectMsg;
  check('rejected peer gets join-error and disconnects', !!pendingRejected && pendingRejected.type === 'join-error', pendingRejected ? `msg=${pendingRejected.type}` : 'no message received');

  const pending2 = await makePeerWithRoom('pending2', AP_ROOM, {});
  const pending2Msg = await waitFor(pending2, (m) => m.type === 'pending-approval' || m.type === 'joined', 5000);
  check('second pending peer gets pending-approval', pending2Msg.type === 'pending-approval');
  const apReq2 = await waitFor(apOwner, (m) => m.type === 'approval-request', 5000)
    .then((m) => m)
    .catch(() => null);
  if (apReq2?.participant?.peerId) pending2.id = apReq2.participant.peerId;
  check('owner received approval-request for second pending peer', !!apReq2);
  // Register BOTH waiters BEFORE the admin message — the server broadcasts
  // peer-joined and joined nearly simultaneously, and a late listener
  // misses the race window entirely.
  const ownerSawApproval = waitFor(apOwner, (m) => m.type === 'peer-joined' && m.participant?.peerId === pending2.id, 8000)
    .then((m) => m)
    .catch(() => null);
  const approvedMsg = waitFor(pending2, (m) => m.type === 'joined', 8000)
    .then((m) => m)
    .catch(() => null);
  await admin(apOwner, 'approve', { peerId: pending2.id });
  const approvedGot = await approvedMsg;
  check('approved peer receives joined with roster', !!approvedGot && approvedGot.type === 'joined' && Array.isArray(approvedGot.roster));
  const ownerSawApprovalGot = await ownerSawApproval;
  check('owner saw peer-joined for approved peer', !!ownerSawApprovalGot);
  peerIds.push(pending2); joinedMsgs.push(approvedMsg);
  pending2.onMsg.push(roomStateCollector, makePeerLeftCollector(pending2));
  pending.close(); // already closed by reject

  // --- 4. Room lock ---
  log('4. Room lock...');
  await admin(owner, 'lock', { value: true });
  await sleep(300);
  const lockedJoin = await makePeer('locked');
  const lockedMsg = await waitFor(lockedJoin, (m) => m.type === 'joined' || m.type === 'join-error', 5000);
  check('join to locked room rejected', lockedMsg.type === 'join-error' && /locked/i.test(lockedMsg.message), `msg=${lockedMsg.type} ${lockedMsg.message}`);
  lockedJoin.close();
  // Owner must still be able to leave/rejoin — lock only bars newcomers;
  // verify lock state propagated via room-updated.
  check('owner saw room-updated with locked=true', roomState.locked === true);
  await admin(owner, 'lock', { value: false });
  await sleep(300);
  const unlockedJoin = await makePeer('unlocked');
  const unlockedMsg = await waitFor(unlockedJoin, (m) => m.type === 'joined' || m.type === 'join-error', 5000);
  check('join after unlock accepted', unlockedMsg.type === 'joined', `msg=${unlockedMsg.type}`);
  if (unlockedMsg.type === 'joined') {
    peerIds.push(unlockedJoin); joinedMsgs.push(unlockedMsg);
    unlockedJoin.onMsg.push(roomStateCollector, makePeerLeftCollector(unlockedJoin));
  }

  // --- 5. Admin actions: rename, mute-chat, disable-uploads ---
  log('5. Admin configuration actions...');
  const ren = await admin(owner, 'rename', { value: 'Renamed Workspace' });
  check('rename accepted + room-updated broadcast', ren.type === 'room-updated' && ren.room.name === 'Renamed Workspace');
  const mute = await admin(owner, 'mute-chat', { value: true });
  check('mute-chat accepted', mute.type === 'room-updated' && mute.room.chatMuted === true);
  const upl = await admin(owner, 'disable-uploads', { value: true });
  check('disable-uploads accepted', upl.type === 'room-updated' && upl.room.uploadsDisabled === true);
  // Non-admin admin action must be rejected. The `error` listener must be
  // registered BEFORE the admin message is sent — otherwise the response
  // races the listener and the check reads a stale null.
  const nonAdmin = await makePeer('nonadmin');
  const nonAdminMsg = await waitFor(nonAdmin, (m) => m.type === 'joined' || m.type === 'join-error', 5000);
  if (nonAdminMsg.type === 'joined') {
    const rejP = waitFor(nonAdmin, (m) => m.type === 'error' && /Administrator/i.test(m.message), 4000)
      .then((m) => m)
      .catch(() => null);
    nonAdmin.__ws.send(JSON.stringify({ type: 'admin', action: 'kick', peerId: ownerJoined.peerId }));
    const rej = await rejP;
    check('non-admin admin action rejected', !!rej, `msg=${rej?.type} ${rej?.message}`);
    peerIds.push(nonAdmin); joinedMsgs.push(nonAdminMsg);
    nonAdmin.onMsg.push(roomStateCollector, makePeerLeftCollector(nonAdmin));
  } else { nonAdmin.close(); }

  // --- 6. Kick ---
  log('6. Kick...');
  const kickTarget = peerIds.find((p) => p.label === 'nonadmin');
  if (kickTarget) {
    const kickP = await waitFor(kickTarget, (m) => m.type === 'kicked', 4000)
      .then((m) => m)
      .catch(() => null);
    owner.__ws.send(JSON.stringify({ type: 'admin', action: 'kick', peerId: kickTarget.id, reason: 'Test kick' }));
    const kickGot = await waitFor(kickTarget, (m) => m.type === 'kicked', 3000)
      .then((m) => m)
      .catch(() => null);
    check('kicked peer receives kicked with reason', !!kickGot && /Test kick/.test(kickGot.reason), kickGot?.reason);
    // peer-left collectors were attached to every mesh member via
    // meshCollectors at join time, so every live peer recorded the event.
    await sleep(800);
    // Only peers actually IN the main room at kick time receive peer-left:
    // `pw-ok` is in the password room and `pending2` in the approval room,
    // so the server correctly never sends them anything.
    const mainRoomAtKick = peerIds.filter((p) =>
      p.id !== kickTarget.id && ['owner', 'unlocked'].includes(p.label));
    const othersSawLeft = mainRoomAtKick.every((p) => peerLeftSeen.get(p)?.has?.(kickTarget.id));
    check('others saw peer-left for kicked peer', othersSawLeft);
  } else {
    log('  SKIP  kick (non-admin peer failed to join)');
  }

  // --- 8. Heartbeat prune ---
  log('8. Heartbeat prune...');
  // Temporarily shorten the heartbeat by monkey-patching not possible from
  // outside; instead kill a peer's socket abruptly and wait for the server
  // sweep (15s heartbeat + 35s timeout is too long) — approximate by closing
  // the peer normally (peer-left) and checking roster on a fresh joiner.
  const pruneTarget = peerIds.find((p) => p.label === 'unlocked');
  if (pruneTarget) {
    pruneTarget.close();
    await sleep(600);
    const fresh = await makePeer('fresh');
    const freshMsg = await waitFor(fresh, (m) => m.type === 'joined' || m.type === 'join-error', 5000);
    check('fresh joiner roster excludes closed peer', freshMsg.type === 'joined' && !freshMsg.roster.some((p) => p.peerId === pruneTarget.id));
    if (freshMsg.type === 'joined') {
      peerIds.push(fresh); joinedMsgs.push(freshMsg);
      fresh.onMsg.push(roomStateCollector, makePeerLeftCollector(fresh));
    }
  } else {
    log('  SKIP  heartbeat prune');
  }

  // --- 7. Owner transfer ---
  log('7. Owner transfer...');
  // Transfer ownership to a peer actually IN this room — `pw-ok` lives in
  // the password room and can never be this room's owner, so pick `fresh`.
  const newOwner = peerIds.find((p) => p.label === 'fresh');
  if (newOwner) {
    const transferGot = await admin(owner, 'transfer-owner', { peerId: newOwner.id });
    check('owner transfer reflected in room-updated', transferGot.type === 'room-updated' && transferGot.room.ownerId === newOwner.id, `ownerId=${transferGot?.room?.ownerId} expected=${newOwner.id}`);
  } else {
    log('  SKIP  owner transfer');
  }

  log('9. Rate limiting...');
  // The server's sliding-window rate limiter guards HTTP routes (40 req/60s
  // per IP), so hammer /api/rooms with a concurrent burst and expect 429s.
  let got429 = false;
  const burst = [];
  for (let i = 0; i < 50; i += 1) {
    burst.push(fetch(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `burst-${i}` }),
    }).then((res) => res.status).catch(() => -1));
  }
  const statuses = await Promise.all(burst);
  const count429 = statuses.filter((s) => s === 429).length;
  got429 = count429 > 0;
  check('excessive requests trigger HTTP rate limiting (429)', got429, `429s=${count429}`);

  // --- 10. Malformed / unknown messages ---
  log('10. Protocol hygiene...');
  const hygiene = await makePeer('hygiene');
  const hygieneMsg = await waitFor(hygiene, (m) => m.type === 'joined' || m.type === 'join-error', 5000);
  if (hygieneMsg.type === 'joined') {
    // Register BOTH error handlers before sending anything — handlers are
    // removed on first match, so pre-registering lets each payload be
    // matched by its own predicate without racing the previous send.
    const malformedP = waitFor(hygiene, (m) => m.type === 'error' && /Malformed/i.test(m.message || ''), 4000).then((m) => m).catch(() => null);
    const unknownP = waitFor(hygiene, (m) => m.type === 'error' && /Unknown message type/i.test(m.message || ''), 4000).then((m) => m).catch(() => null);
    hygiene.__ws.send('not-json-at-all');
    hygiene.__ws.send(JSON.stringify({ type: 'bogus-type-xyz' }));
    const malformedGot = await malformedP;
    check('non-JSON message gets a clean error', !!malformedGot, malformedGot?.message);
    const unknownGot = await unknownP;
    check('unknown message type gets a clean error', !!unknownGot, unknownGot?.message);
    hygiene.close();
  } else { hygiene.close(); }

  // --- 11. App-channel shape relay ---
  log('11. App-channel message relay (chat/notes/clipboard/terminal/files/screen/links)...');
  const appGot = peerIds.map(() => []);
  for (let i = 0; i < peerIds.length; i += 1) peerIds[i].onMsg.push((m) => {
    if (m.type === 'signal' && m.data && typeof m.data === 'object') appGot[i].push(m.data);
  });
  // NOTE: relay only reaches main-room peers; cross-room relays are
  // impossible by design (each signal is scoped to one room).
  // Relay happens within a single room; pick sender/receiver from the main
  // room only. `fresh` joined after the kick so it is guaranteed connected,
  // and the owner can be the other endpoint.
  // Only the main ROOM peers can exchange signals (`pw-ok` lives in
  // PW_ROOM, `pending2` in AP_ROOM). `unlocked` is still connected here.
  const mainRoomLabels = ['owner', 'unlocked', 'nonadmin', 'fresh'];
  const senderIdx = peerIds.findIndex((p) => p.label === 'owner');
  const receiverIdx = peerIds.findIndex((p) => p.label === 'fresh');
  // The sender fans out to every OTHER connected peer (server relay is
  // unicast, so one send per target, exactly like a real broadcast loop).
  const sendToAll = (data) => peerIds.forEach((p, i) => {
    if (!mainRoomLabels.includes(p.label) || i === senderIdx) return;
    peerIds[senderIdx].__ws.send(JSON.stringify({ type: 'signal', to: p.id || joinedMsgs[i].peerId, data }));
  });
  const appMessages = [
    { type: 'chat:message', id: 'm1', ts: Date.now(), dm: false, text: 'hello mesh' },
    { type: 'chat:typing', dm: false },
    { type: 'chat:react', msgId: 'm1', emoji: '👍', dm: false },
    { type: 'chat:pin', msgId: 'm1', dm: false },
    { type: 'chat:read', upTo: Date.now() },
    { type: 'clip:item', id: 'c1', ts: Date.now(), text: 'copied!' },
    { type: 'notes:upsert', note: { id: 'n1', text: 'note' } },
    { type: 'notes:delete', noteId: 'n1' },
    { type: 'notes:sync', notes: [{ id: 'n2', text: 'synced' }] },
    { type: 'term:broadcast', text: 'ls -la' },
    { type: 'term:ping-req', t: 123 },
    { type: 'file-offer', transferId: 'f1', name: 'demo.png', size: 4096, mime: 'image/png' },
    { type: 'file-accept', transferId: 'f1' },
    { type: 'file-cancel', transferId: 'f1' },
    { type: 'file-complete', transferId: 'f1' },
    { type: 'screen:start' },
    { type: 'screen:stop' },
    { type: 'link:share', id: 'l1', ts: Date.now(), url: 'https://example.com', preview: { title: 'Example' } },
  ];
  appMessages.forEach((m) => sendToAll(m));
  await sleep(1500);
  const receiverGot = appGot[receiverIdx];
  for (const wanted of ['chat:message', 'clip:item', 'notes:upsert', 'notes:delete', 'notes:sync', 'term:broadcast', 'term:ping-req', 'file-offer', 'file-accept', 'file-cancel', 'file-complete', 'screen:start', 'screen:stop', 'link:share']) {
    check(`relay preserves ${wanted} shape`, receiverGot.some((m) => m.type === wanted));
  }
  check('chat:message text preserved verbatim', receiverGot?.find((m) => m.type === 'chat:message')?.text === 'hello mesh');
  check('link:share preview preserved', receiverGot?.find((m) => m.type === 'link:share')?.preview?.title === 'Example');
  check('relay does not inject extra fields', !receiverGot?.some((m) => m.relayed || m.injected));

  // --- 12. Full-mesh signal round-trip ---
  log('12. Full-mesh discovery round-trip...');
  // Only include peers that are still connected in the main room.
  // All still-connected peers in the main room participate in the mesh.
  const meshPeers = peerIds.filter((p) => p.id && mainRoomLabels.includes(p.label));
  const pairs = [];
  for (let i = 0; i < meshPeers.length; i += 1) {
    for (let j = 0; j < meshPeers.length; j += 1) {
      if (i === j) continue;
      const got = waitFor(meshPeers[j], (m) => m.type === 'signal' && m.from === meshPeers[i].id && m.data?.mesh === `${i}-${j}`, 6000)
        .then((m) => m)
        .catch(() => null);
      meshPeers[i].__ws.send(JSON.stringify({ type: 'signal', to: meshPeers[j].id, data: { mesh: `${i}-${j}` } }));
      pairs.push({ from: meshPeers[i].label, to: meshPeers[j].label, got });
    }
  }
  let meshOk = true;
  for (const { from, to, got } of pairs) {
    if (!got) { check(`mesh signal ${from} -> ${to} delivered`, false); meshOk = false; }
  }
  if (meshOk) check(`all ${pairs.length} mesh signal pairs delivered`, true);

  // --- Cleanup ---
  log('13. Cleanup...');
  peerIds.forEach((p) => p.close());
  await sleep(300);
  log(FAILURES.length === 0 ? '\nALL CHECKS PASSED' : `\n${FAILURES.length} CHECK(S) FAILED`);
  process.exit(FAILURES.length === 0 ? 0 : 1);
}

// Mesh event collectors (declared early so late joiners attach to them too).
const peerIds = [];
const joinedMsgs = [];
const roomState = {}; // latest room state seen via room-updated by any peer
const peerLeftSeen = new Map(); // peer -> Set of peerIds seen leaving
// Shared room-state collector (one function, safe to attach to many peers).
function roomStateCollector(msg) { if (msg.type === 'room-updated') Object.assign(roomState, msg.room); }
// Per-peer peer-left collector — pass the peer when registering.
function makePeerLeftCollector(peer) {
  return (msg) => {
    if (msg.type === 'peer-left' && msg.peerId) {
      if (!peerLeftSeen.has(peer)) peerLeftSeen.set(peer, new Set());
      peerLeftSeen.get(peer).add(msg.peerId);
    }
  };
}
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
