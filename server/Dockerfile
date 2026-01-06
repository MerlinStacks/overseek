# Base stage
FROM node:18-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache openssl

# Copy package files

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build for production
RUN npm run build

# Expose port
EXPOSE 3000

# Start command
COPY start.sh .
RUN apk add --no-cache dos2unix && dos2unix start.sh && chmod +x start.sh
CMD ["./start.sh"]
