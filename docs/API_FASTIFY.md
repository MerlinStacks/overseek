# API Documentation (Fastify)

Base URL: `/api`

## Authentication (`/api/auth`)
- `POST /login`: Authenticate user.
- `POST /logout`: Destroy session.
- `GET /me`: Get current user profile.

## Synchronization (`/api/sync`)
- `GET /status`: Check sync worker status.
- `POST /trigger`: Manually trigger a sync job.

## Proxy (`/api/proxy`)
Acts as a middleware to connect to WooCommerce instances that may have strict CORS or blocking rules.
- `GET /*`: Forwards requests to the configured WooCommerce store.
- `POST /*`: Forwards write operations.

## Analytics (`/api/analytics`)
- `GET /dashboard`: Aggregated stats for the home dashboard.
- `GET /visitors`: Real-time visitor log.

## Marketing (`/api/marketing`)
- `GET /campaigns`: Fetch ad campaigns.
- `POST /campaigns`: Create/Edit campaigns.

## Settings (`/api/settings`)
- `GET /`: Retrieve global app settings.
- `PATCH /`: Update settings.

## Admin (`/api/admin`)
- `GET /users`: List system users.
- `POST /users`: Create new user.
- `DELETE /users/:id`: Remove user.
