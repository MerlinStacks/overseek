# Base stage - using slim (Debian) for better npm compatibility
FROM node:22-slim

WORKDIR /app

# Install system dependencies (build tools for native modules)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    curl \
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
RUN npm install --workspace=server --legacy-peer-deps

# Copy server source
COPY server/ server/

WORKDIR /app/server

# Generate Prisma Client (requires DATABASE_URL at build time)
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV DATABASE_URL=${DATABASE_URL}
RUN npx prisma generate

# Build for production
RUN npm run build

# Expose port
EXPOSE 3000

# Start command (convert CRLF to LF for Linux compatibility)
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh
CMD ["./start.sh"]
