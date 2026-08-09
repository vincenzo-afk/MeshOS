/**
 * Terminal
 * A simulated command-line interface for exploring the mesh — no real
 * shell access. Designed for collaboration/education: `ping` measures
 * actual DataChannel round-trip latency to a peer, `broadcast` sends a
 * line to every other open terminal in the room.
 */
import { escapeHtml, uid } from '../utils/helpers.js';

let wired = false;
const renderers = new Set();
const broadcastLog = [];

function wire(ctx) {
  if (wired) return;
  wired = true;
  ctx.peerManager.on('message', (peerId, label, msg) => {
    if (label !== 'main') return;
    if (msg.type === 'term:broadcast') {
      const name = ctx.peerDirectory.get(peerId)?.computerName || peerId;
      broadcastLog.push({ kind: 'sys', text: `[broadcast] ${name}: ${msg.text}` });
      renderers.forEach((r) => r());
    } else if (msg.type === 'term:ping-req') {
      ctx.peerManager.sendJSON(peerId, { type: 'term:ping-res', t: msg.t });
    }
  });
}

const HELP = `Available commands:
  help                 Show this help text
  clear                Clear the terminal
  users                List connected users
  devices              List connected devices (alias of "users")
  network               Show mesh/network summary
  room                  Show current room info
  ping <name|peerId>    Measure round-trip latency to a peer
  broadcast <message>   Send a line to everyone's terminal
  upload / download     Hints for the File Transfer app
  whoami                Show your identity on this device`;

export function mount(body, win, ctx) {
  wire(ctx);
  body.innerHTML = `
    <div class="terminal-shell" id="term-output"></div>
    <div class="terminal-input-row" style="padding:0 12px 12px;">
      <span class="prompt">meshos&gt;</span>
      <input type="text" id="term-input" autocomplete="off" spellcheck="false" placeholder="type 'help'" />
    </div>`;
  const outputEl = body.querySelector('#term-output');
  const inputEl = body.querySelector('#term-input');
  const history = [];
  let historyIdx = -1;
  const lines = [{ kind: 'sys', text: `MeshOS Terminal — connected to room ${ctx.roomCode}. Type "help" to get started.` }];

  function print(text, kind = 'out') { lines.push({ kind, text }); renderLines(); }
  function renderLines() {
    outputEl.innerHTML = lines.concat(broadcastLog).map((l) => `<div class="terminal-line ${l.kind}">${escapeHtml(l.text)}</div>`).join('');
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  async function run(raw) {
    const line = raw.trim();
    if (!line) return;
    lines.push({ kind: 'cmd', text: line });
    history.push(line);
    historyIdx = history.length;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');

    switch (cmd.toLowerCase()) {
      case 'help': print(HELP); break;
      case 'clear': lines.length = 0; renderLines(); return;
      case 'whoami': print(`${ctx.me.username}@${ctx.me.computerName} (${ctx.me.peerId.slice(0, 8)})`); break;
      case 'users':
      case 'devices': {
        const peers = ctx.peerDirectory.list();
        print(peers.length ? peers.map((p) => `${p.computerName}  ${p.username}${p.isAdmin ? '  [admin]' : ''}  ${ctx.peerDirectory.connectionQuality(p.peerId)}`).join('\n') : 'No other devices connected.');
        break;
      }
      case 'network': {
        const peers = ctx.peerDirectory.list();
        const connected = peers.filter((p) => p.connectionState === 'connected').length;
        print(`Mesh topology: full-mesh WebRTC\nPeers in roster: ${peers.length}\nActive P2P connections: ${connected}`);
        break;
      }
      case 'room': {
        const room = ctx.getRoom();
        print(`Room: ${room.name} (${room.code})\nParticipants: ${room.participantCount}\nLocked: ${room.locked}\nChat muted: ${room.chatMuted}\nUploads disabled: ${room.uploadsDisabled}\nEncryption: ${ctx.cryptoKey ? 'end-to-end enabled' : 'off'}`);
        break;
      }
      case 'ping': {
        if (!arg) { print('Usage: ping <name|peerId>', 'err'); break; }
        const target = ctx.peerDirectory.list().find((p) => p.peerId === arg || p.computerName.toLowerCase() === arg.toLowerCase());
        if (!target) { print(`No such device: ${arg}`, 'err'); break; }
        const t0 = performance.now();
        const id = uid('ping');
        let off = () => {};
        let timer;
        const gotReply = await new Promise((resolve) => {
          off = ctx.peerManager.on('message', (peerId, label, msg) => {
            if (peerId === target.peerId && label === 'main' && msg.type === 'term:ping-res' && msg.t === id) {
              resolve(true);
            }
          });
          ctx.peerManager.sendJSON(target.peerId, { type: 'term:ping-req', t: id });
          timer = setTimeout(() => resolve(false), 3000);
        });
        off(); // unsubscribe on BOTH the reply path and the timeout path — leaving this
        clearTimeout(timer); // listener/timer dangling on every timed-out ping is a real leak
        print(gotReply ? `Reply from ${target.computerName}: time=${Math.round(performance.now() - t0)}ms` : `Request to ${target.computerName} timed out.`, gotReply ? 'out' : 'err');
        break;
      }
      case 'broadcast':
        if (!arg) { print('Usage: broadcast <message>', 'err'); break; }
        ctx.peerManager.broadcastJSON({ type: 'term:broadcast', text: arg });
        print(`Broadcast sent to ${ctx.peerDirectory.list().length} device(s).`);
        break;
      case 'upload':
      case 'download':
        print('Open the "File Transfer" app from the Start menu to send or receive files peer-to-peer.');
        break;
      default:
        print(`Command not found: ${cmd}. Type "help" for a list of commands.`, 'err');
    }
  }

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = inputEl.value; inputEl.value = ''; run(v); }
    else if (e.key === 'ArrowUp') { if (historyIdx > 0) { historyIdx--; inputEl.value = history[historyIdx] || ''; } e.preventDefault(); }
    else if (e.key === 'ArrowDown') { if (historyIdx < history.length) { historyIdx++; inputEl.value = history[historyIdx] || ''; } e.preventDefault(); }
  });

  const render = renderLines;
  renderers.add(render);
  ctx.windowManager.on('close', (w) => { if (w.id === win.id) renderers.delete(render); });
  render();
  setTimeout(() => inputEl.focus(), 50);
}
