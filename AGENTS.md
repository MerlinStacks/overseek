# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

OverSeek v2 is a self-hosted WooCommerce command center (analytics, unified inbox, AI co-pilot, inventory management). It is a monorepo with a React 19 frontend, Fastify 5 backend, and a WordPress/WooCommerce plugin.

## Commands

All commands assume you are running inside Docker containers (the standard dev environment).

### Development

```bash
# Start both client and server concurrently (from repo root)
npm run dev

# Start server only
cd server && npm run dev

# Start client only
cd client && npm run dev
```

### Building

```bash
cd server && npm run build          # TypeScript compilation
cd server && npm run build:typecheck # Type check only
cd client && npm run build          # Vite production build
```

### Linting

```bash
cd server && npm run lint
cd client && npm run lint
```

### Testing

```bash
# Run all server tests
docker exec overseekv2-api-1 npx vitest run

# Run a specific test file
docker exec overseekv2-api-1 npx vitest run src/services/__tests__/MyService.test.ts

# Watch mode
docker exec -it overseekv2-api-1 npx vitest

# Client tests
cd client && npm run test:run
```

### Database

```bash
# Apply schema changes (development)
docker exec overseekv2-api-1 npx prisma db push

# Regenerate Prisma client after schema changes
docker exec overseekv2-api-1 npx prisma generate

# Open database GUI
docker exec -it overseekv2-api-1 npx prisma studio

# Run migrations (from repo root)
npm run db:migrate
npm run db:generate
```

## Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4 |
| Backend | Fastify 5, Node.js 22+, TypeScript |
| ORM | Prisma 7 (PostgreSQL 17 + pgvector) |
| Search | Elasticsearch 9.x |
| Cache/Queue | Redis 7 + BullMQ |
| Real-time | Socket.IO 4.8 |
| Testing | Vitest |
| AI | OpenRouter (proxies to various LLMs) |

### Data Flow

```
WooCommerce Store → WordPress Plugin → Fastify API → PostgreSQL / Elasticsearch / Redis → React Frontend
```

The WordPress plugin (`overseek-wc-plugin/`) syncs WooCommerce data to the platform via REST API calls. The Fastify API serves the React frontend and handles all business logic.

### Backend Structure

- `server/src/routes/` — Fastify route plugins (registered in `app.ts` with `/api/` prefix)
- `server/src/services/` — Business logic, one service per domain
- `server/src/workers/` — BullMQ worker registration and SIGTERM shutdown
- `server/src/services/queue/QueueFactory.ts` — Queue creation/worker factory
- `server/src/services/scheduler/` — Cron-like schedulers (BullMQ repeatable + setInterval)
- `server/src/middleware/` — Auth, validation, tracking
- `server/src/utils/` — Shared utilities (prisma, logger, redis, elastic)
- `server/prisma/schema.prisma` — Single schema file for all 80+ models

### Frontend Structure

- `client/src/pages/` — Route-level components (lazy-loaded)
- `client/src/components/[feature]/` — Feature-specific components
- `client/src/components/ui/` — Reusable primitives (Dialog, EmptyState, etc.)
- `client/src/context/` — React contexts (AuthContext, AccountContext, SocketContext)
- `client/src/hooks/` — Custom hooks
- Route registration is in `client/src/App.tsx` — add lazy import + `<Route>` inside `DashboardLayout`

## Critical Patterns

### Multi-tenancy (MOST IMPORTANT)

Every Prisma model storing account data **must** have `accountId`. Every query **must** filter by `accountId`. Every mutation must verify ownership before updating/deleting.

```typescript
// ALWAYS scope queries to accountId
const items = await prisma.item.findMany({ where: { accountId } });

// ALWAYS verify ownership before mutation
const existing = await prisma.item.findFirst({ where: { id, accountId } });
if (!existing) return reply.code(404).send({ error: 'Not found' });
```

### API Routes

Routes are Fastify plugins in `server/src/routes/`. Auth is applied via `preHandler: requireAuthFastify`. This provides `request.user` and `request.accountId` (from `X-Account-ID` header). Validate all input with Zod using `.safeParse()`.

```typescript
const featureRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get('/', { preHandler: requireAuthFastify }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });
        // ...
    });
};
export default featureRoutes;
```

Register in `server/src/app.ts`: `app.register(featureRoutes, { prefix: '/api/feature' });`

### Frontend Data Fetching

Use native `fetch` with auth headers — **do not use React Query** for data fetching in components.

```tsx
const { token } = useAuth();
const { selectedAccount } = useAccount();

const res = await fetch('/api/endpoint', {
    headers: {
        'Authorization': `Bearer ${token}`,
        'X-Account-ID': selectedAccount.id,
    }
});
```

### Services

Services are singleton classes exported as instances (`export const featureService = new FeatureService()`). Use `Logger` (not `console.log`) with `[ServiceName]` prefix. Services live in `server/src/services/`.

### Queue Workers

Add a queue name to `QUEUES` in `QueueFactory.ts`, register a worker in `server/src/workers/index.ts` via `QueueFactory.createWorker()`, and enqueue from services via `QueueFactory.getQueue(QUEUES.X).add(...)`.

### Database Schema Changes

1. Edit `server/prisma/schema.prisma`
2. Run `docker exec overseekv2-api-1 npx prisma db push`
3. Run `docker exec overseekv2-api-1 npx prisma generate`
4. Restart TS server in IDE if types don't update

New models require: `accountId String`, relation to `Account` with `onDelete: Cascade`, and `@@index([accountId])`.

### Design System

Glass card pattern: `bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg`

Primary color: `indigo-600`. Always include dark mode variants.

## File Size Limits

- Route files: 200–300 lines (max 500; decompose into `routes/feature/` sub-routers)
- Service files: 150–250 lines (max 400)
- Page components: 100–250 lines
- UI components: 50–150 lines

## Commit Style

Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`

## Agent Skills

Detailed coding patterns are documented in `.agent/skills/`:
- `api-route-development/` — Full Fastify route templates and patterns
- `react-component-patterns/` — Component templates, routing, design system
- `service-layer-patterns/` — Service templates, AI tool integration, BullMQ
- `prisma-database/` — Schema patterns, query recipes, migration workflow
- `testing-standards/` — Vitest templates, mock recipes
- `worker-queue-scheduler/` — Queue/worker/scheduler architecture
- `realtime-events/` — Socket.IO patterns
- `error-handling-and-caching/` — Caching strategy, error boundaries
