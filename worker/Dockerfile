# Build context: repo root (needs shared/). Same layout as the repo: /app/worker + /app/shared.
FROM node:24-slim
WORKDIR /app/worker

# WebToEpub (GPLv3), pinned to the commit CI tests against. The ONLY place the pin lives: setup.sh reads it
# from here. To pull parser fixes: set it to `git ls-remote https://github.com/dteviot/WebToEpub.git
# ExperimentalTabMode`, run worker/setup.sh, run the tests, commit.
ARG WEBTOEPUB_REF=5b2965d6fffca0afedf8ba39c71796cab2710468
ADD --keep-git-dir=false https://github.com/dteviot/WebToEpub.git#${WEBTOEPUB_REF} vendor-WebToEpub

COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY worker/cli.js ./
COPY worker/src src
COPY shared /app/shared

ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    CHAPTERLY_DB=/data/chapterly.db \
    CHAPTERLY_LIBRARY=/library
# Named volumes copy this dir's ownership on first use, so the node user (1000) can write the DB.
RUN mkdir -p /data && chown node:node /data
USER node
CMD ["node", "cli.js", "worker"]
