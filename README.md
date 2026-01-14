<p align="center">
  <h1 align="center">🚀 OverSeek</h1>
  <p align="center"><strong>The Sovereign E-Commerce Intelligence Platform</strong></p>
  <p align="center"><em>Stop Overpaying. Start OverSeeking.</em></p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-brightgreen" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/stack-PERN-blueviolet" alt="Stack">
  <img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker Ready">
  <img src="https://img.shields.io/badge/AI-powered-ff6b6b?logo=openai&logoColor=white" alt="AI Powered">
  <img src="https://img.shields.io/badge/Fastify-000000?logo=fastify&logoColor=white" alt="Fastify Powered">
</p>

---

## 💡 Why OverSeek?

Tired of paying **$200+/month** for fragmented SaaS tools like Metorik, Matomo, Crisp, and FunnelKit?

OverSeek is your **open-source command center**—a self-hosted, privacy-first platform that unifies analytics, automation, inventory, and customer intelligence into one powerful dashboard.

| Feature | OverSeek | Others |
|---------|----------|--------|
| **Data Ownership** | 100% yours, on your server | Locked in third-party silos |
| **Real-Time Intelligence** | Sub-second via Socket.io | Minutes of delay |
| **Monthly Cost** | $0 | $200-500+/month |
| **WooCommerce Native** | Deep bi-directional sync | Basic API polling |
| **AI-Powered Insights** | Built-in assistant & content tools | Expensive add-ons |

---

## ✨ Feature Highlights

### 🤖 "Iron Core" Architecture (v2.0)
- **High-Performance Backend**: Migrated to **Fastify 5** for maximum throughput and low latency.
- **Modern Frontend**: Built with **React 19** and **Tailwind CSS v4** for a cutting-edge UX.
- **Security First**: **Argon2id** hashing, **Pino** secure logging, and rigorous input validation.
- **Scalable Infrastructure**: Powered by **Elasticsearch 9**, **Redis 7**, and **PostgreSQL 16**.

### 🧠 AI-Powered Intelligence
- **Data-Aware AI Assistant**: Chat with your store data—ask questions about sales, customers, and ads.
- **AI Draft Replies**: Generative AI suggestions in the inbox with full conversation context.
- **AI Product Rewriting**: One-click AI-powered product description generation.
- **Multi-Model Support**: Connect to any OpenRouter-compatible model (GPT-4, Claude, etc.).

### 📊 Analytics & Visitor Intelligence
- **Live Visitor Tracking**: Real-time geographic mapping of active visitors.
- **E-Commerce Stream**: Live feed of add-to-cart, checkout, and purchase events.
- **Visitor Journey History**: Sessionized browsing history with interactivity tracking.
- **UTM/MTM Attribution**: First-click and last-click attribution models.
- **Abandoned Cart Detection**: Automatic identification and recovery flows.

### 👤 Customer 360 Profiles
- **Unified Timeline**: Orders, emails, chats, and site visits in one view.
- **LTV & AOV Metrics**: Lifetime value calculated automatically.
- **Behavioral Insights**: Entry/exit pages, time on site, and journey mapping.

### 🛒 WooCommerce Sync Engine
- **Deep Integration**: Bi-directional sync of orders, products, customers, and reviews.
- **Webhook Support**: Instant updates via `order.created`, `product.updated`, etc.
- **Delta Sync**: Only fetch what's changed to save bandwidth.

### 📣 Google Ads Integration
- **OAuth Connection**: Securely link your Google Ads account.
- **Campaign Monitoring**: Track spend, impressions, clicks, and conversions.
- **ROAS Tracking**: Automatic Return on Ad Spend calculations.

### 📱 Meta Ads Integration
- **OAuth Connection**: Securely link Meta Business accounts (Facebook/Instagram).
- **Campaign Insights**: Track reach, impressions, clicks, and conversions.
- **Cross-Platform Analysis**: Compare performance across Google and Meta campaigns.

### 🤖 AI Marketing Co-Pilot
- **Intelligent Optimization**: AI-powered ad recommendations replacing manual analysis.
- **Multi-Period Analysis**: Compare 7d, 30d, and 90d performance with statistical significance.
- **LTV-Based Optimization**: Shift focus from immediate ROAS to Customer Lifetime Value.
- **Funnel-Aware Insights**: Differentiate Top-of-Funnel vs Bottom-of-Funnel benchmarks.
- **Explainable AI**: Confidence scoring with transparent reasoning behind suggestions.

### 📦 Inventory & Supply Chain
- **Stock Velocity Reports**: Identify fast/slow movers with days-of-inventory projections.
- **Bill of Materials (BOM)**: Track raw materials for manufactured goods.
- **Purchase Orders**: Manage inbound inventory with ETA tracking.

### 🧾 Visual Invoice & Email Designer
- **Drag-and-Drop Builder**: Create beautiful invoice templates.
- **Dynamic Variables**: Use `{{customer.name}}`, `{{order.total}}`, and more.
- **PDF Generation**: Print-ready invoices with full tax breakdowns.

### ⚡ Marketing Automation
- **Visual Flow Builder**: Drag-and-drop node canvas.
- **Smart Triggers**: Abandoned cart, post-purchase, welcome series.
- **Email Templates**: MJML-powered responsive designs.

### 💬 Unified Inbox & Chat
- **Live Chat Widget**: Embeddable widget with business hours detection.
- **IMAP Integration**: Pull emails directly into the dashboard.
- **Email Threading**: Bi-directional threading with `In-Reply-To` support.
- **Social Messaging**: Respond to standard communication channels.
- **Rich Canned Responses**: Reusable templates with full formatting support.
- **Conversation Search & Merge**: Find and consolidate customer threads.

### 📊 Proactive Business Intelligence
- **Email Digests**: Automated Daily/Weekly reports with trend analysis.
- **Customer Cohorts**: Retention, acquisition source, and product-based segmentation.
- **Product Rankings**: Top/Bottom performer benchmarking with profit margins.

### 🛠️ Developer & Admin Tools
- **Audit Logs**: Track who changed what, when.
- **Session Management**: View and revoke active sessions.
- **Two-Factor Auth**: TOTP-based 2FA support.
- **Health Dashboard**: System status, logs, and diagnostics.
- **Notification Engine**: Centralized alerting with diagnostic logging.

---

## 🛠️ Tech Stack

Built with modern, battle-tested technologies:

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, Vite, TypeScript 5.8+, Tailwind CSS v4 |
| **State** | React Query, Zustand |
| **Backend** | Node.js 22+, Fastify 5, TypeScript (ESM) |
| **Database** | PostgreSQL 16 + Prisma 7 (Driver Adapter) |
| **Search** | Elasticsearch 9.x |
| **Cache/Queue** | Redis 7 + BullMQ |
| **Real-Time** | Socket.io |
| **AI/Embeddings** | OpenRouter API + pgvector |
| **Infrastructure** | Docker & Docker Compose |

---

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 22+ (required for Prisma 7)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/MerlinStacks/overseek.git
cd overseek

# 2. Copy environment variables
cp .env.example .env

# 3. Start the infrastructure (Postgres, Elasticsearch, Redis)
docker-compose up -d

# 4. Install dependencies
npm install

# 5. Run database migrations
npm run db:migrate

# 6. Start development servers
npm run dev
```

**Access Points:**
- 🌐 Frontend: `http://localhost:5173`
- 🔌 API: `http://localhost:3000`
- 📊 Bull Board: `http://localhost:3000/admin/queues` (Super Admin only)

---

## 📂 Project Structure

```
overseek/
├── client/                    # React 19 (Vite) Frontend
│   ├── src/
│   │   ├── components/        # UI Components (Tailwind v4)
│   │   ├── hooks/             # Custom React Hooks
│   │   ├── pages/             # Dashboard Views
│   │   └── services/          # API Integration Layer
│   └── package.json
├── server/                    # Node.js (Fastify) Backend
│   ├── src/
│   │   ├── routes/            # Fastify Routes
│   │   ├── services/          # Business Logic
│   │   ├── workers/           # BullMQ Background Jobs
│   │   └── prisma/            # Database Schema & Migrations
│   └── package.json
├── overseek-wc-plugin/        # WordPress/WooCommerce Plugin
├── docker-compose.yml         # Infrastructure Orchestration
└── package.json               # Monorepo Workspace Config
```

---

## 🔌 WooCommerce Integration

OverSeek uses a **dual-protocol** approach for maximum flexibility:

### Protocol A: Live Analytics (Zero-Config)
Paste a simple JSON config into the WordPress plugin to start tracking immediately.

### Protocol B: Core Sync (Full Power)
Connect via WooCommerce REST API keys for bi-directional sync of orders, inventory, and products.

---

## 🔒 Security

- **Argon2id Hashing**: State-of-the-art password security.
- **Fastify Helmet**: Secure HTTP headers.
- **JWT Authentication**: With rotation and session revocation.
- **Rate Limiting**: Built-in protection against abuse.
- **Two-Factor Authentication**: TOTP support.

---

## 📖 Documentation

- **[Full Manual](./Overseek_Manual.md)**: Complete feature guide and API reference
- **[Changelog](./CHANGELOG.md)**: Version history and release notes
- **[Contributing](./CONTRIBUTING.md)**: How to contribute
- **[Code of Conduct](./CODE_OF_CONDUCT.md)**: Community guidelines

---

## 🤝 Contributing

We believe in open source. Found a bug? Want to add a feature?

1. **Fork** the repository
2. **Branch** (`git checkout -b feature/amazing-feature`)
3. **Commit** (`git commit -m 'Add amazing feature'`)
4. **Push** (`git push origin feature/amazing-feature`)
5. **Pull Request** and we'll review!

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">
  <strong>Built with ❤️ for E-Commerce Merchants Who Demand Better</strong>
  <br>
  <em>Own your data. Know your customers. Grow your business.</em>
</p>
