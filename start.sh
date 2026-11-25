#!/bin/sh
# Fly.io (and most hosts) mount the data disk owned by root. Fix ownership,
# then run the app as the unprivileged "node" user.
# If a backup bucket is configured (BUCKET_NAME etc., set by `fly storage create`),
# the database is restored from it when the disk is empty, and every change is
# copied to it while the app runs (Litestream).
set -e
DATA_DIR="${DATA_DIR:-/data}"
export DATA_DIR
APP="node --disable-warning=ExperimentalWarning server.js"
AS_NODE=""
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  AS_NODE="setpriv --reuid=node --regid=node --init-groups"
fi

if [ -n "$BUCKET_NAME" ] && command -v litestream >/dev/null 2>&1; then
  echo "Backups: on (bucket $BUCKET_NAME)"
  # New or wiped disk: bring back the latest backup before starting
  $AS_NODE litestream restore -config /app/litestream.yml -if-db-not-exists -if-replica-exists "$DATA_DIR/recipes.db" || echo "Backups: restore failed, starting with the disk as it is"
  exec $AS_NODE litestream replicate -config /app/litestream.yml -exec "$APP"
fi

echo "Backups: off (no backup bucket configured)"
exec $AS_NODE $APP
