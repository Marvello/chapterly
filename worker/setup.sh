#!/usr/bin/env sh
# Fetch/refresh WebToEpub's parsers (GPLv3). Re-run to pull upstream parser fixes.
set -e
cd "$(dirname "$0")"   # runs from worker/ wherever it is called from
if [ -d vendor-WebToEpub/.git ]; then
  git -C vendor-WebToEpub pull --ff-only
else
  git clone --depth 1 -b ExperimentalTabMode https://github.com/dteviot/WebToEpub.git vendor-WebToEpub
fi
npm install
