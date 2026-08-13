/**
 * Multi-peer sync simulator for MeshOS.
 * Joins N synthetic peers to the same room over the real /ws signaling
 * endpoint and verifies:
 *   - owner token claim on first join
 *   - roster consistency & peer-joined / peer-left broadcasts
 *   - ping/pong RTT replies
 *   - signal relay of arbitrary messages between peers
 *   - stale owner token rejection for wrong tokens
 * Exits 0 if all checks pass, 1 otherwise.
 *
 * Wire format mirrors client/js/network/socket.js:
 *   client sends {type:'signal', to, data}; server relays {type:'signal', from, data}
 *   client sends {type:'ping', t}; server replies {type:'pong', t}
 */
import WebSocket from 'ws';

const ROOM = process.argv[2] || '4QYQV5';
const TOKEN = process.argv[3] || '';
const BASE = 'http://localhost:3000';
const FAILURES = [];

function log(msg) { console.log(msg); }

function check(name, cond, extra = '') {
  if (cond) { log(`  PASS  ${name}${extra ? '  ' + extra : ''}`); }
  else { log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`); FAILURES.push(name); }
}

function makePeer(label, { ownerToken = '' } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws`);
    const p = { label, id: null, __ws: ws, onMsg: [], close: () => ws.close() };
    ws.on('open', () => {
      // Defer the join message until the next tick so the caller has time to
      // register its listeners via register() / onMsg before any server
      // response can arrive.
      setImmediate(() => {
        ws.send(JSON.stringify({
          type: 'join',
          roomCode: ROOM,
          createIfMissing: false,
          ...(ownerToken ? { ownerToken } : {}),
          meta: { username: `${label}-user`, computerName: `${label}-pc` },
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

async function run() {
  // Register broadcast collectors up front so every peer-joined / peer-left
  // event lands in seen[] / leftSeen[] regardless of when it arrives.
  const peerIds = [];
  const joinedMsgs = [];
  const seen = []; // per-peer Set of peerIds discovered via broadcasts
  const leftSeen = []; // per-peer Set of peerIds that left
  function register(p, idx) {
    peerIds[idx] = p;
    seen[idx] = new Set();
    leftSeen[idx] = new Set();
    p.onMsg.push((m) => {
      if (m.type === 'peer-joined') seen[idx].add(m.participant?.peerId);
      if (m.type === 'peer-left') leftSeen[idx].add(m.peerId);
    });
  }

  // --- 1. Owner joins and claims ownership ---
  log('1. Owner joins...');
  const owner = await makePeer('owner', { ownerToken: TOKEN });
  register(owner, 0);
  const ownerJoined = await waitFor(owner, (m) => m.type === 'joined' || m.type === 'error' || m.type === 'server-error');
  joinedMsgs[0] = ownerJoined;
  check('owner join succeeded', ownerJoined.type === 'joined', `msg=${ownerJoined.type}${ownerJoined.message ? ': ' + ownerJoined.message : ''}`);
  check('owner is admin (room.ownerId === peerId)', ownerJoined.room?.ownerId === ownerJoined.peerId,
    `ownerId=${ownerJoined.room?.ownerId} peerId=${ownerJoined.peerId}`);
  check('owner roster empty', Array.isArray(ownerJoined.roster) && ownerJoined.roster.length === 0, `roster=${JSON.stringify(ownerJoined.roster)}`);

  // --- 2. Two more peers join ---
  log('2. Peers joining...');
  const p2 = await makePeer('peer2');
  register(p2, 1);
  const p2j = await waitFor(p2, (m) => m.type === 'joined' || m.type === 'error');
  joinedMsgs[1] = p2j;
  check('peer2 join succeeded', p2j.type === 'joined', `msg=${p2j.type}`);

  const p3 = await makePeer('peer3');
  register(p3, 2);
  const p3j = await waitFor(p3, (m) => m.type === 'joined' || m.type === 'error');
  joinedMsgs[2] = p3j;
  check('peer3 join succeeded', p3j.type === 'joined', `msg=${p3j.type}`);

  // Let the last peer-joined broadcast settle so every peer knows everyone.
  await new Promise((r) => setTimeout(r, 1500));
  const sawP2 = seen[0].has(p2j.peerId);
  check('owner saw peer-joined for peer2', sawP2);
  const sawP3 = seen[0].has(p3j.peerId);
  check('owner saw peer-joined for peer3', sawP3);

  // --- 3. Roster consistency ---
  // The roster in a join message is a snapshot taken at join time, so peers
  // who joined earlier only know about peers discovered via peer-joined
  // broadcasts. Verify: (a) no peer's roster includes itself (the fix), and
  // (b) every peer can account for all others through roster + broadcasts.
  log('3. Roster consistency...');
  const allIds = joinedMsgs.map((j) => j.peerId);
  for (let i = 0; i < 3; i += 1) {
    const p = peerIds[i];
    const j = joinedMsgs[i];
    check(`${p.label} roster excludes self`, !j.roster.some((r) => r.peerId === j.peerId));
    for (const r of j.roster) seen[i].add(r.peerId);
    const expected = allIds.filter((id) => id !== j.peerId);
    check(`${p.label} knows all others (roster + broadcasts)`, expected.every((id) => seen[i].has(id)),
      `missing=${expected.filter((id) => !seen[i].has(id)).join(',') || 'none'} roster_ids=${j.roster.map((r) => r.peerId.slice(0, 8)).join(',')}`);
  }

  // --- 4. Ping / pong RTT ---
  log('4. Ping/pong RTT...');
  const results = await Promise.all([owner, p2, p3].map(async (p) => {
    const t = Date.now();
    p.__ws.send(JSON.stringify({ type: 'ping', t }));
    try {
      const pong = await waitFor(p, (m) => m.type === 'pong' && m.t === t, 3000);
      return { p: p.label, ms: Date.now() - t, echoed: pong.t };
    } catch (_) { return { p: p.label, ms: null }; }
  }));
  for (const r of results) check(`ping/pong ${r.p}`, r.ms != null && r.ms < 5000, r.ms != null ? `${r.ms}ms` : 'no pong');

  // --- 5. Signal relay ---
  log('5. Signal relay...');
  const relayed = waitFor(owner, (m) => m.type === 'signal' && m.from === p2j.peerId && m.data?.kind === 'probe', 5000)
    .then((m) => m)
    .catch(() => null);
  p2.__ws.send(JSON.stringify({ type: 'signal', to: ownerJoined.peerId, data: { kind: 'probe', hi: 42 } }));
  const probeMsg = await relayed;
  check('owner received relayed signal from peer2', !!probeMsg && probeMsg.data.hi === 42);

  // --- 6. peer-left broadcast ---
  log('6. peer-left handling...');
  p3.close();
  await new Promise((r) => setTimeout(r, 1200));
  check('owner saw peer-left for peer3', leftSeen[0].has(p3j.peerId));
  check('peer2 saw peer-left for peer3', leftSeen[1].has(p3j.peerId));

  // --- 7. Wrong owner token rejected ---
  log('7. Wrong owner token rejection...');
  const rogue = await makePeer('rogue', { ownerToken: '000000000000000000000000000000000000000000000000' });
  const rogueMsg = await waitFor(rogue, (m) => m.type === 'joined' || m.type === 'error' || m.type === 'server-error', 6000);
  check('rogue with wrong token did NOT join as owner',
    rogueMsg.type !== 'joined' || (rogueMsg.room?.ownerId !== rogueMsg.peerId), `msg=${rogueMsg.type}`);
  rogue.close();

  // --- 8. Cleanup ---
  owner.close();
  p2.close();
  await new Promise((r) => setTimeout(r, 300));

  log(FAILURES.length === 0 ? '\nALL CHECKS PASSED' : `\n${FAILURES.length} CHECK(S) FAILED`);
  process.exit(FAILURES.length === 0 ? 0 : 1);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
