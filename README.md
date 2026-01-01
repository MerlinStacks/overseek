# ⚡ OverSeek

> **The Local-First Intelligence Engine for WooCommerce.**
> 
> *Instant analytics, real-time collaboration, and warehouse logistics—without slowing down your store.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/react-19.0-blue.svg)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/fastify-5.0-black.svg)](https://fastify.dev/)
[![TurboRepo](https://img.shields.io/badge/turborepo-enabled-red.svg)](https://turbo.build/)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg)](https://www.docker.com/)

---

## 🚀 Why OverSeek?

OverSeek is a modern, decoupled dashboard that runs separately from your WordPress site. By syncing data to a local browser database (**IndexedDB**), it offers:

-   **Zero-Latency Navigation:** Browse thousands of orders and products instantly. No loading spinners.
-   **Real-Time Collaboration:** See who is viewing an order *right now* to prevent shipping collisions.
-   **Air-Gapped Security:** Your API keys stay in your browser. We never see your data.
-   **Warehouse Grade:** Includes a dedicated high-contrast Barcode Scanner mode for logistics teams.

## ✨ Key Features

### 📊 Real-Time Analytics
Live steam of sales, visitor traffic, and cart abandonment. Powered by WebSockets and Redis.

### 🏭 Warehouse Logistics (New!)
-   **Barcode Scanner Mode:** A dedicated, keyboard-driven UI for HID scanners.
-   **Custom Pipelines:** Define your own Kanban stages (e.g., "Laser Engraving", "Quality Check").

### 🤖 AI-Powered Insights
Connect your own OpenRouter/Gemini keys to get:
-   **Inventory Forecasting:** Predict stock runouts before they happen.
-   **Smart Suggestions:** Ad spend optimization and pricing strategies.

### 🔌 Integrations
-   **Lifestyle:** Sync Fitbit/Waze data for personal productivity context.
-   **Communication:** Auto-send Slack/Email digests.

## 🛠️ Architecture

OverSeek uses a modern Monorepo structure managed by **TurboRepo**:

| Component | Tech Stack | Description |
| :--- | :--- | :--- |
| **Frontend** | React 19, Vite 7, Tailwind | The glassmorphism UI. Runs entirely in-browser. |
| **Backend** | Node.js 22, Fastify 5 | Handles OAuth, Proxying, and Webhooks. |
| **Database** | PostgreSQL 16 + Redis 7 | Archival storage and Pub/Sub messaging. |
| **Sync Engine** | Web Workers + Dexie.js | Background synchronization logic. |

👉 **[Read the Full Architecture Documentation](docs/ARCHITECTURE_CURRENT.md)**

## 📦 Getting Started

### Prerequisites
-   Docker & Docker Compose
-   Node.js 20+ (for local dev)
-   pnpm

### Quick Start (Production)

1.  **Clone & Deploy:**
    ```bash
    git clone https://github.com/MerlinStacks/overseek.git
    cd overseek
    docker-compose up -d --build
    ```

2.  **Access Dashboard:**
    Open `http://localhost:5173` (or your server IP).

### Development Mode

```bash
# Install dependencies
pnpm install

# Start both Frontend and Backend
pnpm dev
```

## 📚 Documentation

We have comprehensive documentation available in the `docs/` directory:

-   **[Security Audit](docs/SECURITY_AUDIT.md)** (Passed 2026-01-01)
-   **[Database Schema](docs/DATABASE_SCHEMA.md)**
-   **[Deployment Guide](docs/DEPLOYMENT.md)**
-   **[Feature Specifications](docs/spec/)** (PDFs, AI, Automation)

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md).

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
