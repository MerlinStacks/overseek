# Base stage
FROM node:18-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache openssl

# Copy root package files (needed for workspace dependency resolution)
COPY package.json package-lock.json ./

# Copy server package files
COPY server/package.json ./server/

# Install all workspace dependencies
RUN npm install --workspace=server

# Copy server source code
COPY server/ ./server/

WORKDIR /app/server

# Generate Prisma Client
RUN npx prisma generate

# Build for production
RUN npm run build

# Expose port
EXPOSE 3000

# Start command
COPY server/start.sh .
RUN apk add --no-cache dos2unix && dos2unix start.sh && chmod +x start.sh
CMD ["./start.sh"]
