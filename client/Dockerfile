# syntax=docker/dockerfile:1.7

# Build stage - compile React/Vite to optimized static files
FROM node:22-slim AS builder

WORKDIR /app

ARG BUILD_ID
ENV VITE_BUILD_ID=$BUILD_ID

# Increase Node memory for large builds
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Copy root workspace files for npm workspace resolution
COPY package.json package-lock.json ./

# Create server stub for workspace resolution
RUN mkdir -p server && echo '{"name":"overseek-server","version":"1.0.0"}' > server/package.json

# Copy shared core package.json (required for workspace dependency resolution)
COPY packages/overseek-core/package.json packages/overseek-core/

# Copy client package.json
COPY client/package.json client/

# Install dependencies (legacy-peer-deps for React 19 compatibility)
RUN --mount=type=cache,target=/root/.npm \
    npm install --workspace=client --workspace=@overseek/core --legacy-peer-deps --prefer-offline --no-audit

# Copy source code and shared package used by invoice renderer
COPY client/ ./client/
COPY packages/overseek-core/ ./packages/overseek-core/

WORKDIR /app/client

# Build shared workspace package required by client imports
RUN npm run build -w @overseek/core

# Build production bundle (skip tsc, let vite handle it)
RUN npx vite build

# Production stage - serve with Nginx
FROM nginx:alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Copy built assets from builder stage
COPY --from=builder /app/client/dist /usr/share/nginx/html

# Copy nginx config for SPA routing and API proxying
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -sf http://localhost/health || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
