# Security Policy & Architecture

## Core Security Architecture
OverSeek Dashboard utilizes a Local-First, Proxy-Mediated architecture designed to minimize attack surface and ensure data sovereignty.

### 1. Data Sovereignty (Local-First)
- **Storage:** All business data (Orders, Customers, Products) is stored locally in the user's browser using IndexedDB (via Dexie.js).
- **Isolation:** Data is never sent to a central OverSeek cloud. It syncs directly between the User's Browser and the User's WooCommerce Store.
- **Encryption:** Sensitive credentials (Consumer Keys) are stored in the local browser database.

### 2. The Smart Proxy (Node.js + Redis)
To bypass CORS restrictions securely, a self-hosted "Smart Proxy" mediates requests:
- **No Persistence:** The Proxy does **not** permanently store business data. It caches responses in Redis (TTL 5 mins) for performance and forwards requests.
- **Fail-Open Design:** If the caching layer (Redis) fails, the Proxy securely falls back to direct API communication, ensuring availability.
- **Authentication:** The Proxy forwards WooCommerce Authentication headers. It supports both Header-based and Query-String authentication (for failover resilience).

### 3. WordPress Helper Plugin (Safe Mode)
The `overseek-helper.php` plugin (v2.4+) operates in "Safe Mode":
- **Universal Namespace:** Supports `overseek/v1`, `wc-dash/v1`, and `woodash/v1` namespaces to evade WAF blocking.
- **Capability Checks:** All custom endpoints enforce `manage_woocommerce` capabilities.
- **Self-Healing:** Automatically repairs Permalinks on Admin Init.

## Reporting a Vulnerability

We take the security of OverSeek seriously. If you believe you have found a vulnerability:

1.  **Do not open a public GitHub issue.**
2.  Email securely to `security@overseek.io` (or current maintainer).
3.  Include a Proof of Concept (PoC) if possible.

## Supported Versions

| Version | Status | Notes |
| ------- | ------ | ----- |
| 2.x     | ✅ Supported | Current Stable (Proxy + PWA) |
| 1.x     | ❌ EOL | Legacy (Direct API) |

## Policy on Disclosures
We follow a 90-day responsible disclosure policy. We ask that you give us reasonable time to patch the issue before publicizing it.
