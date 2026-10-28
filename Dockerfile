# better-sqlite3 compiles from source when no prebuilt binary matches the platform
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json index.js setup.js ./
COPY lib ./lib

# Tokens live in /data; mount a volume there so they survive container rebuilds
RUN mkdir /data && chown node:node /data
VOLUME /data
ENV TWITCHGATE_DB=/data/twitchgate.db \
    TWITCHGATE_HOST=0.0.0.0 \
    TWITCHGATE_PORT=2570

USER node
EXPOSE 2570 2571

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:2571/gate/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "index.js"]
