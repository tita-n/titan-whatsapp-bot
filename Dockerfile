# Multi-stage Dockerfile for TITAN Bot
FROM node:18-alpine AS builder
RUN apk add --no-cache ffmpeg python3 make g++ git
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:18-alpine
RUN apk add --no-cache ffmpeg python3 make g++ git
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Expose Express port
EXPOSE 3000

CMD ["npm", "start"]
