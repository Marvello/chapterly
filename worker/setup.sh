#!/usr/bin/env sh
# Fetch WebToEpub's parsers (GPLv3) at the commit pinned in the Dockerfile (ARG WEBTOEPUB_REF), so tests
# run against what ships. Re-run after changing the pin.
set -e
cd "$(dirname "$0")"   # runs from worker/ wherever it is called from
REF=$(sed -n 's/^ARG WEBTOEPUB_REF=//p' Dockerfile)
[ -n "$REF" ] || { echo "no ARG WEBTOEPUB_REF in worker/Dockerfile" >&2; exit 1; }
if [ ! -d vendor-WebToEpub/.git ]; then
  git init -q vendor-WebToEpub
  git -C vendor-WebToEpub remote add origin https://github.com/dteviot/WebToEpub.git
fi
git -C vendor-WebToEpub fetch -q --depth 1 origin "$REF"
git -C vendor-WebToEpub checkout -q FETCH_HEAD
npm ci
