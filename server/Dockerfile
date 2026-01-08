# Base stage - using slim (Debian) for better npm compatibility
FROM node:18-slim

WORKDIR /app/server

# Install system dependencies (build tools for native modules)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files (standalone, not using workspaces)
COPY server/package.json server/package-lock.json ./

# Install dependencies using lockfile
RUN npm ci --legacy-peer-deps

# Copy server source code
COPY server/ .

# Generate Prisma Client (requires DATABASE_URL at build time)
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate

# Build for production
RUN npm run build

# Expose port
EXPOSE 3000

# Start command
RUN chmod +x start.sh
CMD ["./start.sh"]
