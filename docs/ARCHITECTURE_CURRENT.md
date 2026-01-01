# Architecture Documentation (Current State)

## 1. High-Level Overview

OverSeek (formerly WooDash) is a local-first, high-performance dashboard for WooCommerce. It uses a **Monorepo** structure managed by TurboRepo, containing a Fastify backend (`apps/api`) and a React frontend (`apps/web`).

### Core Differences from Legacy Architecture
- **Backend Framework:** Migrated from Express to **Fastify** for improved performance.
- **Routing:** Uses **React Router v7** instead of Wouter.
- **Package Manager:** uses `pnpm` workspace.
- **Build System:** Vite v7 + TurboRepo.

---

## 2. Directory Structure

```
/
├── apps/
│   ├── api/            # Fastify Backend (Node.js 22)
│   └── web/            # React 19 Frontend (Vite)
├── packages/
│   ├── ui/             # [EMPTY] Placeholder for future shared components
│   └── database/       # [EMPTY] Placeholder for shared schema
└── docker-compose.yml  # Orchestration
```

> **Note:** Although the project uses a Monorepo structure (TurboRepo), the `packages/` directory is currently empty. The DB schema resides in `apps/api/src/db` and UI components are local to `apps/web`.

---

## 3. Backend Architecture (`apps/api`)

### Tech Stack
- **Runtime:** Node.js 22
- **Framework:** Fastify v5
- **Database:** PostgreSQL 16 (via Drizzle ORM) + Redis 7
- **Authentication:** Argon2 + Session Cookies (`@fastify/cookie`)
- **Real-time:** Socket.io

### Key Modules (`apps/api/src/`)
- `routes/`: API Enpoints properly separated by domain.
    - `auth.ts`: Login, Logout, Session management.
    - `sync.ts`: Web Worker coordination and data synchronization endpoints.
    - `proxy.ts`: specialized proxy to bypass WooCommerce CORS issues.
    - `analytics.ts`: Dashboard metrics and aggregation.
- `sync/`: **Core Sync Engine**
    - `engine.ts`: Contains `syncEntity` logic to pagination through WooCommerce API and upsert into PostgreSQL.
    - `live.ts`: Real-time webhook handlers.
- `middleware/`: shared Fastify hooks.

---

## 4. Frontend Architecture (`apps/web`)

### Tech Stack
- **Framework:** React 19
- **Build Tool:** Vite 7
- **Router:** React Router v7
- **State Management:** Context API + Dexie.js (IndexedDB)
- **Styling:** Tailwind CSS + custom glassmorphism variables.

### Key Concepts
1. **Local-First Data:** heavy data (Products, Orders) is synced to `Dexie.js` in the browser. The UI queries IndexedDB for instant filtering/sorting.
2. **Web Worker Sync:** `sync.worker.js` runs in the background to fetch data from the API/Proxy without freezing the main thread.
3. **Glassmorphism UI:** centralized in `index.css` and `App.css`.

---

## 5. Deployment (Docker)

The project uses a standard `docker-compose.yml` for production:
- **`app-api`**: exposed on port 4000.
- **`app-web`**: Nginx container serving static build, exposed on port 8080 (or 5173 dev).
- **`db`**: PostgreSQL 15.
- **`redis`**: Redis Alpine.

### Build Note
The frontend uses a multi-stage Dockerfile (`node:22-slim` -> `nginx:alpine`).
The backend uses `node:22-alpine`.
