FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Generate Prisma Client (if we add robust DB later)
# RUN npx prisma generate

EXPOSE 4000

CMD ["npm", "start"]
