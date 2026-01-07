<p align="center">
  <h1 align="center">🚀 OverSeek</h1>
  <p align="center"><strong>The Sovereign E-Commerce Intelligence Platform</strong></p>
  <p align="center"><em>Stop Overpaying. Start OverSeeking.</em></p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-brightgreen" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/stack-PERN-blueviolet" alt="Stack">
  <img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker Ready">
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

---

## ✨ Feature Highlights

### 📊 Analytics & Visitor Intelligence
- **Live Visitor Tracking**: See who's on your site right now with geographic mapping.
- **E-Commerce Stream**: Real-time feed of add-to-cart, checkout, and purchase events.
- **Search Term Analysis**: Understand what customers are searching for.
- **UTM Attribution**: First-click and last-click attribution modeling.
- **Abandoned Cart Detection**: Automatic identification and recovery flows.



### 👤 Customer 360 Profiles
- **Unified Timeline**: Orders, emails, chats, and site visits in one view.
- **LTV & AOV Metrics**: Lifetime value calculated automatically.
- **Behavioral Insights**: Entry/exit pages, time on site, and journey mapping.



### 🛒 WooCommerce Sync Engine
- **Deep Integration**: Bi-directional sync of orders, products, customers, and reviews.
- **Webhook Support**: Instant updates via `order.created`, `product.updated`, etc.
- **Delta Sync**: Only fetch what's changed to save bandwidth.
- **Historical Import**: Full backfill with "New Order" spam prevention.

### 📦 Inventory & Supply Chain
- **Stock Velocity Reports**: Identify fast/slow movers with days-of-inventory projections.
- **Bill of Materials (BOM)**: Track raw materials for manufactured goods.
- **Purchase Orders**: Manage inbound inventory with ETA tracking.
- **Picklist Generation**: Bin-location optimized PDFs for warehouse picking.
- **Supplier Management**: Track sources and shadow inventory.

### 🧾 Visual Invoice Designer
- **Drag-and-Drop Builder**: Create beautiful invoice templates with `react-grid-layout`.
- **Dynamic Variables**: Use `{{customer.name}}`, `{{order.total}}`, and more.
- **PDF Generation**: Print-ready invoices with full tax breakdowns.
- **Automation Ready**: Attach invoices to email sequences automatically.



### ⚡ Marketing Automation
- **Visual Flow Builder**: Drag-and-drop node editor powered by React Flow.
- **Smart Triggers**: Abandoned cart, post-purchase, welcome series, and more.
- **Condition Logic**: If/else branching based on order value, segments, etc.
- **Email Templates**: MJML-powered responsive designs.
- **Customer Segmentation**: Target groups by spend, order count, behavior.

### 💬 Unified Inbox & Chat
- **Live Chat Widget**: Embeddable widget with business hours detection.
- **IMAP Integration**: Pull emails directly into the dashboard.
- **Canned Responses**: Quick templates for common queries.
- **Presence Indicators**: See who else is viewing a conversation.

### 📈 Advanced Reporting
- **Report Builder**: Custom metrics with drag-and-drop dimensions.
- **Forecasting**: Linear regression-based revenue projections.
- **YoY Comparisons**: Period-over-period analysis.
- **Scheduled Reports**: Automated PDF/CSV delivery via email.
- **Export Engine**: One-click CSV and PDF downloads.

### 🔍 Global Search (OmniSearch)
- **Command Palette**: Press `Cmd+K` to search anything.
- **Elasticsearch Powered**: Sub-second queries across orders, products, customers.
- **Semantic Search**: AI-powered meaning-based search with pgvector.

### 🛠️ Developer & Admin Tools
- **Audit Logs**: Track who changed what, when.
- **Session Management**: View and revoke active sessions.
- **Two-Factor Auth**: TOTP-based 2FA support.
- **Bull Board**: Visual queue management for background jobs.
- **Health Dashboard**: System status, logs, and diagnostics.

---

## 🛠️ Tech Stack

Built with modern, battle-tested technologies:

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS |
| **State** | React Query, React Context |
| **Backend** | Node.js, Express, TypeScript |
| **Database** | PostgreSQL 16 + Prisma ORM |
| **Search** | Elasticsearch 7.17 |
| **Cache/Queue** | Redis 7 + BullMQ |
| **Real-Time** | Socket.io |
| **AI/Embeddings** | OpenRouter API + pgvector |
| **Infrastructure** | Docker & Docker Compose |

---

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+

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
├── client/                    # React (Vite) Frontend
│   ├── src/
│   │   ├── components/        # UI Components (Tailwind)
│   │   ├── hooks/             # Custom React Hooks
│   │   ├── pages/             # Dashboard Views
│   │   └── services/          # API Integration Layer
│   └── package.json
├── server/                    # Node.js (Express) Backend
│   ├── src/
│   │   ├── routes/            # API Endpoints
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
Paste a simple JSON config into the WordPress plugin to start tracking immediately:
```json
{
  "apiUrl": "https://your-overseek-instance.com",
  "accountId": "acc_123456789"
}
```

### Protocol B: Core Sync (Full Power)
Connect via WooCommerce REST API keys for bi-directional sync:
- **Read Access**: Analytics, reports, dashboards
- **Read/Write Access**: + Inventory updates, order management, tracking numbers

---

## 🔒 Security

- **JWT Authentication** with refresh token rotation
- **HMAC-SHA256** webhook verification
- **AES-256-GCM** encryption for credentials at rest
- **Rate Limiting** (5 login attempts/hour, 2000 API requests/15min)
- **Content Security Policy** via Helmet
- **Two-Factor Authentication** (TOTP)
- **Session Management** with revocation

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
