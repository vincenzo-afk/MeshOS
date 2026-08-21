# MeshOS: A Decentralized, P2P Collaborative Workspace

**MeshOS** is a cutting-edge, browser-based operating system designed to empower distributed teams and local networks through seamless, decentralized collaboration. By leveraging the power of **WebRTC** for direct peer-to-peer communication and **WebSockets** for efficient signaling, MeshOS creates a virtual, shared workspace where every connected browser acts as a node in a high-performance mesh network.

## The MeshOS Philosophy

MeshOS is built on a foundation of three core tenets that redefine how we collaborate online:

1.  **Privacy-First Architecture**: We believe your collaborative data belongs to you. The signaling server is designed to be "content-blind," facilitating discovery and enforcing room policies without ever seeing, storing, or logging your private communications or files.
2.  **High-Performance P2P Mesh**: By moving data directly between browsers, MeshOS eliminates central bottlenecks. This ensures low-latency interactions and high-speed file transfers, even when working with large assets.
3.  **Universal Portability**: MeshOS requires no installation, plugins, or desktop clients. It is a pure web experience, turning any modern browser into a powerful collaborative workstation instantly.

## Comprehensive Collaborative Suite

MeshOS integrates a full array of productivity tools, all synchronized across the mesh in real-time:

| Feature | Description | Protocol & Technology |
| :--- | :--- | :--- |
| **Collaborative Whiteboard** | A multi-user canvas with live cursor tracking, name tags, and in-progress stroke previews. | `wb:` over WebRTC DataChannels; HTML5 Canvas. |
| **Real-time Chat** | A secure chat environment with typing indicators, emoji reactions, and message pinning. | `chat:` protocol; support for end-to-end AES-GCM encryption. |
| **Direct File Transfer** | Peer-to-peer, chunked file transfers with real-time progress, speed, and ETA metrics. | `file:` protocol; high-throughput WebRTC binary channels. |
| **Shared Notes** | Live-synced rich-text notes and checklists for collaborative meeting minutes. | `notes:` protocol; decentralized state synchronization. |
| **Screen Sharing** | Permission-based screen capture streamed directly to peers without intermediate servers. | `screen:` protocol; WebRTC MediaStream API. |
| **Global Clipboard** | A shared clipboard for the entire workspace to quickly distribute snippets and URLs. | `clip:` protocol; local persistence for session continuity. |
| **Network Topology** | A live, animated SVG visualization of the mesh network and connection health. | `topology:` protocol; dynamic SVG rendering engine. |
| **System Terminal** | A simulated CLI for advanced network diagnostics and workspace administration. | `term:` protocol; custom-built command parser. |

## Technical Architecture

MeshOS is engineered for stability, privacy, and performance.

### 1. The Signaling Layer (Node.js)
The signaling server acts as the "matchmaker" for the mesh. Built with **Express** and **ws**, it manages room membership, relays SDP/ICE handshakes, and enforces administrative policies such as room locks and join-approval queues.

### 2. The P2P Data Mesh (WebRTC)
The heart of MeshOS is a full-mesh network of **RTCPeerConnections**. We utilize:
*   **Reliable DataChannels**: For critical state sync like chat, notes, and whiteboard operations.
*   **Unreliable/Ordered Channels**: Optimized for high-frequency, low-latency updates like cursor positions.
*   **Binary Channels**: For efficient, chunked P2P file transfers.

### 3. The Client-Side "OS" (Vanilla JS)
The frontend is a lightweight, high-performance environment built with vanilla JavaScript. It features a custom **Window Manager** for multitasking and a **Theme Engine** supporting six distinct visual styles (Windows, macOS, Ubuntu, Cyberpunk, Hacker, Minimal) with light and dark variants.

## Getting Started

### Installation
1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/vincenzo-afk/MeshOS.git
    cd MeshOS
    ```
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Launch the Server**:
    ```bash
    npm start
    ```
4.  **Access the Workspace**: Navigate to `http://localhost:3000` in your browser.

### Development
For a smoother development experience with automatic reloading:
```bash
npm run dev
```

## Security & Governance

MeshOS provides enterprise-grade security controls for every workspace:
*   **Encrypted Communication**: All peer-to-peer data is protected by standard DTLS-SRTP encryption.
*   **Access Control**: Owners can secure rooms with SHA-256 hashed passwords and manage a join-approval queue.
*   **Privacy Guard**: The server is content-blind; it never stores chat history, files, or whiteboard data.
*   **Administrative Moderation**: Room owners have the power to mute chat, disable uploads, lock rooms, and manage participants.

## Deployment

MeshOS is a self-contained Node.js application, making it easy to deploy on platforms like **Render**, **Railway**, or any VPS. For deployments beyond a local network, configuring a **TURN server** in `client/js/config.js` is recommended to ensure connectivity through restrictive NATs.

## License

MeshOS is open-source software licensed under the **MIT License**.

---

*MeshOS: Collaboration, Decentralized.*
