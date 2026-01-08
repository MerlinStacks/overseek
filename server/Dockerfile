# Base stage
FROM node:18-alpine

WORKDIR /app/server

# Install system dependencies
RUN apk add --no-cache openssl

# Copy server package files
COPY package.json ./

# Install dependencies
RUN npm install

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
RUN apk add --no-cache dos2unix && dos2unix start.sh && chmod +x start.sh
CMD ["./start.sh"]
