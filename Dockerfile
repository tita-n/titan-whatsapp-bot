# Multi-stage Dockerfile for TITAN Bot
FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 make g++ git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund || npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Expose Express port
EXPOSE 3000

CMD ["npm", "start"]
