# MeshOS

**Every browser on your network becomes a virtual computer in one shared, peer-to-peer workspace.**

MeshOS is a browser-based LAN collaboration platform — not a traditional OS. Open it in a browser, create or join a workspace with a room code (or a QR code), and you're dropped into a shared virtual desktop with every other connected device shown as a computer on the network. Chat, share files and clipboard content, draw on a whiteboard, take notes, share your screen — all peer-to-peer over WebRTC. The server never sees or stores your data; it only handles room bookkeeping and WebRTC signaling.

Stack: **HTML5, CSS3, vanilla JavaScript (ES modules), Node.js, Express, WebSockets, WebRTC.** No frontend framework.

---

## Quick start

```bash
npm install
npm start
```

Open `http://localhost:3000`. Create a workspace, then open the invite link in another tab (or another device on the same network) to see the mesh form.

```bash
npm run dev   # restarts on file changes (node --watch)
```

Requires Node.js 18+.

## Architecture

```
server/                  Thin Node/Express backend — signaling & room bookkeeping only
  index.js                 Express app, static file serving, REST API, link-preview proxy
  config.js                 Server-side constants (port, room code shape, rate limits, TURN/STUN)
  rooms.js                  RoomManager / Room / Participant — in-memory only, nothing persisted
  signaling.js               WebSocket message router: join, signal relay, admin actions, presence

client/
  index.html                Landing page — create/join a workspace
  workspace.html             The virtual desktop shell (boot screen, desktop, taskbar, start menu…)
  css/
    base.css                  Resets, CSS variables, shared form controls
    themes.css                 6 visual themes (Windows/macOS/Ubuntu/Cyberpunk/Hacker/Minimal) × dark/light
    landing.css                 Landing page styling
    desktop.css                 Desktop shell: windows, taskbar, start menu, notifications, modals
    apps.css                    Styling contract for all 13 apps
  js/
    config.js                  Client-side constants (ICE servers, app registry, chunk sizes…)
    landing.js                  Landing page logic — create/join flow, QR code, password/E2E toggle
    app.js                      Workspace bootstrap — connects, builds the desktop shell, launches apps
    utils/
      emitter.js                 Tiny pub/sub base class used by every stateful module
      helpers.js                  formatBytes, timeAgo, debounce, escapeHtml, linkify, colorFromString…
      icons.js                    Inline SVG icon set (no icon font/library)
      crypto.js                   AES-GCM end-to-end encryption via the Web Crypto API
      qrcode.js                   Thin wrapper around the vendored QR generator
      identity.js                 Local name/computer-name/session-password state
    ui/
      windowmanager.js            Draggable/resizable windows + taskbar entries
      contextmenu.js               Right-click menus
      notifications.js             Toasts + notification center
      themes.js                    Theme/mode/wallpaper application & persistence
      modal.js                     Reusable overlay/dialog builder
    network/
      socket.js                    WebSocket client — wraps the signaling protocol in typed events
      webrtc.js                    Full-mesh RTCPeerConnection management, 2 DataChannels per peer
      peers.js                     PeerDirectory — merges roster + live connection state for the UI
    apps/                         The 13 apps (see below), each a self-contained ES module
    vendor/
      qrcode.mjs                   Vendored MIT-licensed QR code generator (Kazuhiko Arase)
  assets/
    icons/favicon.svg
    wallpapers/*.svg               4 generated wallpapers
```

### Why the server is "thin"

`server/` only ever handles: serving static files, creating/looking-up rooms, relaying WebRTC signaling messages (offers/answers/ICE candidates) between the correct two peers, and enforcing room-level policy (lock, password, approval, mute chat, disable uploads, kick). It has **no database** — everything lives in memory and disappears when a room empties out or goes stale (`ROOM_TTL_MS` in `server/config.js`). Chat, files, clipboard, whiteboard strokes, and notes never touch the server at all; they're WebRTC DataChannel messages between browsers.

### Networking model

Each pair of peers in a room gets one `RTCPeerConnection` with two ordered `RTCDataChannel`s:

- **`main`** — JSON control messages: chat, presence, clipboard, whiteboard ops, notes ops, terminal broadcasts, link shares, pings.
- **`file`** — binary file chunks (each chunk framed with a 4-byte transfer id so multiple simultaneous transfers share one ordered channel) plus JSON transfer-control messages (offer/accept/cancel).

This is a genuine **full mesh**: with *N* people in a room, each browser holds *N−1* direct connections. That's simple and works great for small/medium groups (the sweet spot for a LAN collaboration tool); it isn't meant to scale to huge rooms, since bandwidth for anything broadcast (chat, whiteboard) grows with the number of peers.

### End-to-end encryption

Creating a workspace with encryption enabled generates an AES-GCM key with the Web Crypto API, client-side. The key is embedded in the invite link's URL **fragment** (`#key=...`), which browsers never send to any server — so the signaling server genuinely never sees it. Anyone with the link can decrypt; anyone without it (including MeshOS's own server) cannot.

## The 13 apps

| App | What it does |
|---|---|
| **Network Explorer** | Grid of every connected device — click through to a detail panel with latency/OS/browser and quick actions |
| **Chat** | Public room chat + 1:1 DMs, typing indicators, emoji reactions, message pinning, search, read receipts |
| **File Transfer** | Drag-and-drop files or folders, chunked P2P transfer with progress/speed/ETA, pause/resume/cancel/retry, transfer history |
| **Shared Clipboard** | Broadcast text/URLs/code to the whole workspace, with history |
| **Whiteboard** | Real-time collaborative canvas — pen, eraser, shapes, arrows, sticky notes, text, images, zoom/pan, undo, PNG export |
| **Notes** | Shared rich-text notes and checklists, synced live |
| **Terminal** | Simulated CLI (`help`, `users`, `ping`, `broadcast`, `network`, `room`, …) — educational, not a real shell |
| **Screen Share** | `getDisplayMedia()` capture streamed over WebRTC, permission-based |
| **Network Topology** | Animated SVG graph of the mesh, colored by connection quality |
| **Device Dashboard** | Local browser/OS/screen/battery/memory stats (nothing sent anywhere) |
| **Shared Links** | Broadcast URLs with lightweight previews (via a stateless server-side proxy — see below) |
| **Code Snippet** | A small shared code editor with line numbers and live sync |
| **Settings** | Profile, theme, wallpaper, and (for the room owner) admin controls |

### A note on "Shared Links" previews

Browsers can't fetch another site's raw HTML to read its Open Graph tags (CORS). `GET /api/link-preview?url=...` fetches the page **once**, on the sharer's behalf, extracts `<title>`/`og:title`/`og:description`/`og:image`, and returns just that — nothing is cached or persisted. It blocks non-http(s) schemes and resolves-then-rejects private/loopback/link-local IP ranges to prevent it being used to probe your internal network.

## Themes

Six visual themes — Windows, macOS, Ubuntu, Cyberpunk, Hacker, Minimal — each with dark and light variants, switchable live from Quick Settings or the Settings app. Wallpaper and theme choices persist locally (`localStorage`) per browser.

## Security

- Every peer connection is a standard encrypted WebRTC `RTCPeerConnection` (DTLS-SRTP).
- Optional additional end-to-end AES-GCM encryption for chat/files layered on top (see above) — the key never reaches the server.
- Room codes are drawn from a 33-character alphabet with ambiguous characters (`0`, `O`, `1`, `I`) removed.
- Optional password protection (hashed server-side, never stored in plaintext) and join-approval queue.
- Per-IP rate limiting on the REST API.
- Rooms and their in-memory state are garbage-collected after a configurable idle period.
- The server is deliberately "content-blind": it relays signaling messages and enforces room policy, but never stores chat, files, whiteboard data, or notes.

## Deployment

MeshOS is a single Node process serving both the static client and the WebSocket signaling endpoint (`/ws`), so it deploys anywhere that runs a long-lived Node process:

- **Render / Railway** — connect the repo, build command `npm install`, start command `npm start`. Both support WebSockets on their standard web service tier out of the box.
- **Vercel** — works for the static client, but Vercel's serverless functions don't support long-lived WebSocket connections, so the signaling server needs to run elsewhere (Render/Railway/a VPS/a container). Point the client at that signaling host by adjusting `WS_PATH`/host resolution in `client/js/config.js` and `network/socket.js` if you split them.
- **Any VPS/container** — `npm install && npm start` behind a reverse proxy (nginx/Caddy) that forwards `Upgrade: websocket` to the Node process, with TLS termination for `wss://`.

For anything beyond a local network demo, set `ICE_SERVERS` in `client/js/config.js` to include a TURN server — plain STUN is not enough once either peer is behind a symmetric NAT, which is common on real-world Wi-Fi/mobile networks.

## Roadmap

- TURN server auto-provisioning docs (coturn / a managed provider) for guaranteed connectivity across restrictive NATs
- Selective forwarding (SFU) fallback mode for larger rooms where full mesh bandwidth becomes the bottleneck
- File System Access API integration so folder transfers can write a real nested directory on the receiving end (currently: relative paths are preserved as metadata, but each file downloads individually)
- Persistent (opt-in, still E2E-encrypted) note/whiteboard history across sessions using a client-side IndexedDB cache
- Mobile-optimized taskbar/window management

## Contributing

Issues and PRs welcome. Please keep the "server never stores collaboration data" principle intact for anything touching `server/` — new features should extend the peer-to-peer surface (`network/`, `apps/`), not add server-side persistence.

1. Fork, branch off `main`
2. `npm install`
3. Make your change; keep modules dependency-light and framework-free per the project's constraints
4. Open a PR describing what changed and why

## License

MIT — see [LICENSE](./LICENSE). The vendored QR code generator (`client/js/vendor/qrcode.mjs`) is MIT-licensed by Kazuhiko Arase.
