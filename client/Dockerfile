# syntax=docker/dockerfile:1.7

# Build stage - compile React/Vite to optimized static files
FROM node:22-slim AS builder

WORKDIR /app/client

# Increase Node memory for large builds
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Copy package files first for better layer caching
COPY client/package*.json ./

# Install dependencies (legacy-peer-deps for React 19 compatibility)
RUN --mount=type=cache,target=/root/.npm \
    npm install --legacy-peer-deps --prefer-offline --no-audit

# Copy source code and shared package used by invoice renderer
COPY client/ ./
COPY packages/overseek-core /app/packages/overseek-core

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
