#!/bin/sh
# Some hosts (Railway, for one) mount the data volume owned by root. Hand it to the app's user, then run
# the app as that unprivileged user, never as root.
set -e
DATA="${DATA_DIR:-/data}"
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$DATA"
  chown -R node:node "$DATA"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
