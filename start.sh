#!/bin/sh
# Fly.io (and most hosts) mount the data disk owned by root. Fix ownership,
# then run the app as the unprivileged "node" user.
set -e
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups node --disable-warning=ExperimentalWarning server.js
fi
exec node --disable-warning=ExperimentalWarning server.js
