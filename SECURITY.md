# Security Policy

## Supported Versions

We actively maintain and provide security updates for the following versions of MeshOS:

| Version | Supported |
| :--- | :--- |
| 1.0.x | ✅ Yes |
| < 1.0.0 | ❌ No |

## Reporting a Vulnerability

We take the security of MeshOS seriously. If you discover a security vulnerability, please do not report it through public issues or social media. Instead, follow these steps:

1.  **Private Disclosure**: Email your findings to the maintainers at `itsmebk2007@gmail.com`.
2.  **Information to Include**:
    *   A description of the vulnerability and its potential impact.
    *   Steps to reproduce the vulnerability (a proof-of-concept is highly appreciated).
    *   Any suggested fixes or mitigations.
3.  **Response Time**: We will acknowledge your report within 48 hours and provide a timeline for a fix.
4.  **Public Disclosure**: We ask that you give us a reasonable amount of time to fix the vulnerability before disclosing it publicly. Once fixed, we will credit you for the discovery in our release notes (unless you prefer to remain anonymous).

## Security Principles

MeshOS is designed with several security layers:
*   **WebRTC Encryption**: All P2P traffic is encrypted using DTLS-SRTP.
*   **Signaling Security**: The signaling server enforces room access via passwords and approval queues.
*   **Content Blindness**: The server never stores or inspects collaborative data.
*   **Rate Limiting**: Protection against brute-force and DoS attacks on the REST API.

Thank you for helping keep MeshOS secure!
