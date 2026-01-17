<p align="center">
  <h1 align="center">🚀 OverSeek</h1>
  <p align="center"><strong>Your Store's Command Center</strong></p>
  <p align="center"><em>Everything about your WooCommerce store. One dashboard. Zero monthly fees.</em></p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.1-brightgreen" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker Ready">
  <img src="https://img.shields.io/badge/AI-powered-ff6b6b?logo=openai&logoColor=white" alt="AI Powered">
</p>

---

## 📸 Screenshots

<p align="center">
  <img src="Sample Screenshots/Analytics Examples.png" alt="Analytics Dashboard" width="48%">
  <img src="Sample Screenshots/Default Reports.png" alt="Reports" width="48%">
</p>
<p align="center">
  <img src="Sample Screenshots/Product List.png" alt="Product List" width="48%">
  <img src="Sample Screenshots/Visitor Profile.png" alt="Visitor Profile" width="48%">
</p>
<p align="center">
  <img src="Sample Screenshots/Report Builder.png" alt="Report Builder" width="48%">
  <img src="Sample Screenshots/Invoice Generator.png" alt="Invoice Generator" width="48%">
</p>

---

## What is OverSeek?

**OverSeek puts you back in control of your e-commerce data.**

If you run a WooCommerce store, you know the pain: Metorik for analytics ($79/mo), Crisp for chat ($75/mo), Klaviyo for emails ($45/mo), and a dozen other tools that barely talk to each other. That's $200+ per month, your customer data scattered across a dozen SaaS platforms, and no single source of truth.

OverSeek fixes that. It's a self-hosted dashboard that syncs with your WooCommerce store and gives you:

- 📊 **Real-time analytics** — See who's on your site right now, what's in their cart, and where they came from
- 💬 **Unified inbox** — Email, live chat, Facebook, Instagram—all in one place
- 🤖 **AI that actually helps** — Ask questions about your data, draft customer replies, optimize your ads
- 📦 **Inventory tools** — Stock alerts, purchase orders, picklists, the works
- ⚡ **Marketing automation** — Abandoned cart flows, welcome series, post-purchase emails

All running on your server. Your data never leaves your control.

---

## Quick Start

```bash
git clone https://github.com/MerlinStacks/overseek.git
cd overseek
cp .env.example .env
docker-compose up -d
npm install && npm run db:migrate && npm run dev
```

Open `http://localhost:5173` and you're in.

> **Requirements:** Docker, Node.js 22+

---

## Core Features

### 📊 Analytics & Tracking
See your store in real-time. Live visitors on a globe, add-to-cart events streaming in, abandoned carts flagged automatically. Works even with ad blockers (server-side tracking).

### 💬 Unified Inbox
One inbox for everything. Emails (via IMAP), live chat widget, Facebook messages, Instagram DMs. Canned responses, AI-drafted replies, conversation search. No more tab-switching.

### 🤖 AI Marketing Co-Pilot
Connect your Google Ads and Meta Ads accounts. The AI analyzes your campaigns across 7, 30, and 90-day windows, spots trends, and gives you specific recommendations—with confidence scores so you know what to trust.

### 📈 Business Intelligence
Daily/weekly email digests land in your inbox with revenue, top products, and traffic sources. Customer cohort analysis shows you which acquisition channels bring the best long-term customers. Product rankings reveal your winners and losers.

### 📦 Inventory & Warehouse
Low stock alerts based on sales velocity (not just static thresholds). Bill of Materials for bundles and kits. Purchase orders with supplier management. Picklists that optimize your warehouse walking path.

### ⚡ Marketing Automation
Visual flow builder with drag-and-drop. Abandoned cart sequences, post-purchase follow-ups, welcome series. MJML-powered email templates that look great everywhere.

### 👤 Customer Profiles
Full 360° view of every customer. Order history, lifetime value, all their conversations, every page they've visited. Know who you're talking to.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4 |
| Backend | Node.js 22, Fastify 5, Prisma 7 |
| Database | PostgreSQL 16, Elasticsearch 9, Redis 7 |
| AI | OpenRouter API (GPT-4, Claude, etc.) |
| Infrastructure | Docker Compose |

---

## WooCommerce Integration

Two ways to connect:

1. **Tracking Only** — Drop our WordPress plugin in, paste your config, start seeing visitors immediately
2. **Full Sync** — Connect via WooCommerce REST API keys for two-way sync of orders, products, and customers

---

## Security

- **Argon2id** password hashing
- **JWT** with refresh token rotation
- **2FA** support (TOTP)
- **Rate limiting** built-in
- **Secure headers** via Fastify Helmet

---

## Project Structure

```
overseek/
├── client/              # React frontend
├── server/              # Fastify backend
├── overseek-wc-plugin/  # WordPress plugin
└── docker-compose.yml   # Infrastructure
```

---

## Documentation

- [Changelog](./CHANGELOG.md) — What's new
- [Contributing](./CONTRIBUTING.md) — How to help
- [Code of Conduct](./CODE_OF_CONDUCT.md) — Community guidelines

---

## Contributing

Found a bug? Want to add a feature? PRs welcome.

1. Fork it
2. Create your branch (`git checkout -b feature/cool-thing`)
3. Commit your changes
4. Push and open a PR

---

## License

MIT — do what you want with it.

---

<p align="center">
  <strong>Built for store owners who want control back.</strong>
  <br>
  <em>Your data. Your server. Your rules.</em>
</p>
