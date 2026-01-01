# Stage 1: Build & Compile
FROM node:22-alpine AS builder
WORKDIR /app

# Install all dependencies (including devDependencies for tsc)
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Prune dev dependencies for production
RUN npm prune --production

# Stage 2: Production Runner
FROM node:22-alpine
WORKDIR /app

# Copy production dependencies
COPY --from=builder /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 4000
CMD ["npm", "start"]
