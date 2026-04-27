# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy root workspace files first (required for npm workspaces)
COPY package.json package-lock.json ./

# Create placeholder for sibling workspace (client) - required for npm workspace resolution
RUN mkdir -p client && echo '{"name":"client-stub","version":"1.0.0"}' > client/package.json

# Copy server package.json
COPY server/package.json server/

# Install server dependencies using workspace
RUN --mount=type=cache,target=/root/.npm \
    npm install --workspace=server --legacy-peer-deps --prefer-offline --no-audit

# Copy shared core package source and build it for runtime imports
COPY packages/overseek-core/ packages/overseek-core/
RUN npm run build -w packages/overseek-core

# Copy server source
COPY server/ server/

WORKDIR /app/server

# Generate Prisma Client (requires DATABASE_URL at build time)
# NOTE: Only use ARG, not ENV - ENV would persist to runtime and override docker-compose env
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN DATABASE_URL=${DATABASE_URL} npx prisma generate

# Build for production
RUN npm run build

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:22-slim AS production

WORKDIR /app

# Install only runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy root workspace files
COPY package.json package-lock.json ./

# Create client stub for workspace resolution
RUN mkdir -p client && echo '{"name":"client-stub","version":"1.0.0"}' > client/package.json

# Copy server package.json and install production dependencies only
COPY server/package.json server/
RUN --mount=type=cache,target=/root/.npm \
    npm install --workspace=server --legacy-peer-deps --omit=dev --prefer-offline --no-audit

# Copy required shared package for runtime imports
COPY --from=builder /app/packages/overseek-core/dist /app/packages/overseek-core/dist
COPY --from=builder /app/packages/overseek-core/package.json /app/packages/overseek-core/package.json

# Copy built artifacts from builder stage
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/prisma ./server/prisma

# Regenerate Prisma client for production runtime (ensures correct binaries)
# NOTE: Only use ARG for build-time generation - runtime DATABASE_URL comes from docker-compose env
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN DATABASE_URL=${DATABASE_URL} cd server && npx prisma generate

# Copy start script
COPY server/start.sh ./server/

WORKDIR /app/server

# Ensure start script is executable
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health/live || exit 1

CMD ["./start.sh"]
