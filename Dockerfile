# Multi-stage Dockerfile for TITAN Bot
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Expose Express port
EXPOSE 3000

CMD ["npm", "start"]
