# MeshOS

**MeshOS** is a browser-based, peer-to-peer collaborative operating system designed for local networks and distributed teams. It transforms any connected browser into a virtual computer within a shared workspace, enabling real-time collaboration without the need for centralized data storage. By leveraging **WebRTC** for peer-to-peer data transfer and **WebSockets** for signaling, MeshOS ensures that your collaborative data remains private and ephemeral.

## Core Philosophy

The design of MeshOS is governed by three primary principles:

1.  **Privacy by Design**: The signaling server is "content-blind." It facilitates peer discovery and enforces room policies but never sees, stores, or logs chat messages, files, whiteboard data, or notes.
2.  **P2P Efficiency**: Once a connection is established, data travels directly between browsers. This reduces latency and eliminates the server as a bandwidth bottleneck, especially for large file transfers.
3.  **Zero-Installation Portability**: MeshOS runs entirely in the browser. There are no plugins, desktop apps, or complex configurations required for participants.

## Key Features

MeshOS provides a comprehensive suite of collaborative tools, all synchronized in real time across the mesh:

| Feature | Description | Technical Implementation |
| :--- | :--- | :--- |
| **Multiplayer Whiteboard** | Collaborative canvas with live cursor tracking and in-progress stroke previews. | `wb:` protocol over WebRTC DataChannels; Canvas API. |
| **Real-time Chat** | Persistent-session chat with typing indicators, reactions, and message pinning. | `chat:` protocol; end-to-end AES-GCM encryption support. |
| **P2P File Transfer** | High-speed, chunked file transfers with progress tracking and pause/resume capabilities. | `file:` protocol; WebRTC DataChannel chunking. |
| **Shared Notes** | Live-synced rich-text notes and checklists for meeting minutes and task tracking. | `notes:` protocol; Operational Transformation (OT) inspired sync. |
| **Screen Sharing** | Permission-based screen capture streamed directly to other participants. | `screen:` protocol; `getDisplayMedia()` API. |
| **Shared Clipboard** | A global clipboard for the workspace to share snippets, URLs, and commands. | `clip:` protocol; `localStorage` persistence. |
| **Network Topology** | An animated SVG visualization of the current mesh network and connection quality. | `topology:` protocol; D3-like SVG rendering. |
| **Terminal** | A simulated CLI for network diagnostics and workspace management. | `term:` protocol; custom command parser. |

## Architecture

MeshOS utilizes a hybrid architecture to balance ease of discovery with the privacy of peer-to-peer communication.

### 1. Signaling Layer (Node.js)
The signaling server, built with **Express** and **ws**, handles the initial handshake between peers. It manages:
*   **Room Membership**: Creating workspaces, generating room codes, and maintaining the participant roster.
*   **SDP/ICE Exchange**: Relaying WebRTC offer/answer and ICE candidates to establish P2P connections.
*   **Admin Controls**: Enforcing room locks, password protection, and participant moderation (kick/approve).

### 2. Peer-to-Peer Mesh (WebRTC)
Once signaling is complete, peers establish a full-mesh network of **DataChannels**.
*   **Reliable Channels**: Used for chat, notes, whiteboard operations, and administrative sync.
*   **Unreliable/Ordered Channels**: Used for high-frequency updates like live cursor positions and typing indicators.
*   **Binary Channels**: Optimized for chunked file transfers and media streaming.

### 3. Client Environment (Vanilla JS)
The frontend is a framework-free, high-performance "operating system" environment.
*   **Window Manager**: Handles overlapping windows, focus, and workspace layout.
*   **Theme Engine**: Supports six distinct themes (Windows, macOS, Ubuntu, Cyberpunk, Hacker, Minimal) with light/dark variants.
*   **Persistence**: Uses `localStorage` for user preferences and session identity.

## Getting Started

### Prerequisites
*   **Node.js**: Version 18.0.0 or higher.
*   **npm**: Included with Node.js.

### Installation
1.  Clone the repository:
    ```bash
    git clone https://github.com/vincenzo-afk/MeshOS.git
    cd MeshOS
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the server:
    ```bash
    npm start
    ```
4.  Open your browser to `http://localhost:3000`.

### Development Mode
To run with automatic server restarts on file changes:
```bash
npm run dev
```

## Security and Privacy

MeshOS is built to be a secure-by-default collaboration tool:

> "The server never sees your data. All collaboration happens directly between you and your peers."

*   **Encryption**: All P2P traffic is encrypted using standard DTLS-SRTP. Optional AES-GCM encryption is available for sensitive application data.
*   **Access Control**: Workspaces can be protected with passwords (SHA-256 hashed) and a join-approval queue managed by the room owner.
*   **Ephemeral State**: Room state is stored in memory and purged after the last participant leaves or the room expires.
*   **Rate Limiting**: The REST API includes per-IP rate limiting to prevent automated abuse.

## Deployment

### Cloud Platforms
*   **Render / Railway**: Ideal for MeshOS. Connect your repository and use `npm start`. Both platforms support WebSockets natively.
*   **VPS / Container**: Deploy using Docker or a process manager like PM2. Ensure your reverse proxy (Nginx/Caddy) is configured to handle WebSocket upgrades.

### NAT Traversal
For deployment beyond a local network, it is highly recommended to configure a **TURN server** in `client/js/config.js`. While STUN works for most residential setups, symmetric NATs (common in corporate and mobile networks) require TURN to guarantee connectivity.

## License

MeshOS is released under the **MIT License**. See the [LICENSE](./LICENSE) file for details.

---

*MeshOS - Collaborative computing, decentralized.*
