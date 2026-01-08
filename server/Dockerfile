# Base stage - using slim (Debian) instead of Alpine for better npm compatibility
FROM node:18-slim

WORKDIR /app/server

# Install system dependencies (build tools for native modules)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy server package files
COPY package.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy server source code
COPY . .

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
