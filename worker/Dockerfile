# Build context: repo root (needs shared/). Same layout as the repo: /app/worker + /app/shared.
FROM node:24-slim
WORKDIR /app/worker

# WebToEpub (GPLv3) straight from upstream; rebuild with --no-cache to pull parser fixes.
ADD --keep-git-dir=false https://github.com/dteviot/WebToEpub.git#ExperimentalTabMode vendor-WebToEpub

COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY worker/cli.js ./
COPY worker/src src
COPY shared /app/shared

ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    NOVEL_DB=/data/novel.db \
    NOVEL_LIBRARY=/library
# Named volumes copy this dir's ownership on first use, so the node user (1000) can write the DB.
RUN mkdir -p /data && chown node:node /data
USER node
CMD ["node", "cli.js", "worker"]
