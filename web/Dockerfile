FROM node:24-slim AS builder
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    NOVEL_ROOT=/app/novel \
    NOVEL_DB=/data/novel.db \
    PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder /build/web/.next/standalone ./
COPY --from=builder /build/web/.next/static ./.next/static
COPY --from=builder /build/web/public ./public
# Shared DB module + migrations (the only SQL lives in src/db.js)
COPY src/db.js novel/src/db.js
COPY db/migrations novel/db/migrations
# Named volumes copy this dir's ownership on first use, so the node user (1000) can write the DB.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
