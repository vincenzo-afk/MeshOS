# Contributing to MeshOS

Thank you for your interest in contributing to MeshOS! We welcome contributions from the community to help make MeshOS the best browser-based collaborative operating system.

## Our Philosophy

MeshOS is built on the principle of **privacy through decentralization**. When contributing, please keep the following in mind:

*   **P2P First**: New collaborative features should extend the peer-to-peer surface (`client/js/network/`, `client/js/apps/`) rather than adding server-side persistence.
*   **Dependency Light**: We strive to keep the project framework-free and dependency-light. Avoid adding large libraries if a native browser API can achieve the same result.
*   **Server Blindness**: The server should remain "content-blind." It should only facilitate signaling and enforce room policies.

## How to Contribute

### 1. Reporting Bugs
If you find a bug, please open an issue on GitHub. Include:
*   A clear, descriptive title.
*   Steps to reproduce the bug.
*   Expected and actual behavior.
*   Browser and OS information.

### 2. Suggesting Features
We love new ideas! Before implementing a new feature, please open an issue to discuss it with the maintainers. This ensures the feature aligns with the project's goals and architecture.

### 3. Pull Requests
1.  Fork the repository and create a new branch from `main`.
2.  Implement your changes, following the existing code style.
3.  Ensure your changes don't break existing functionality. Run the provided tests:
    ```bash
    node tests/multi-peer-sync.mjs
    node tests/multi-feature.mjs
    ```
4.  Commit your changes with clear, descriptive commit messages.
5.  Open a Pull Request and describe what changed and why.

## Development Setup

1.  Clone your fork:
    ```bash
    git clone https://github.com/YOUR_USERNAME/MeshOS.git
    cd MeshOS
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the development server:
    ```bash
    npm run dev
    ```

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](./CODE_OF_CONDUCT.md). By participating in this project, you agree to abide by its terms.

## License

By contributing to MeshOS, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
