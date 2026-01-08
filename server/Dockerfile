# Base stage - using slim (Debian) for better npm compatibility
FROM node:18-slim

WORKDIR /app

# Install system dependencies (build tools for native modules)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy root package files (needed for workspace/lockfile resolution)
COPY package.json package-lock.json ./

# Copy server package files
COPY server/package.json ./server/

# Create client placeholder with minimal package.json (workspace requirement)
COPY client/package.json ./client/

# Install dependencies using workspace
RUN npm install --workspace=server --legacy-peer-deps

# Copy server source code
COPY server/ ./server/

WORKDIR /app/server

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
