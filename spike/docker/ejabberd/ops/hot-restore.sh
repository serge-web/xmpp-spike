#!/bin/sh
# Restore a hot backup: stop, replace the SQLite file, start.
set -eu
cd "$(dirname "$0")/.."
docker compose stop ejabberd
docker run --rm -v wrx-ejabberd_db:/data -v "$PWD/backup:/backup:ro" alpine:3.20 \
  sh -c 'cp /backup/ejabberd-hot.db /data/ejabberd.db && rm -f /data/ejabberd.db-wal /data/ejabberd.db-shm && chown 9000:9000 /data/ejabberd.db'
docker compose start ejabberd
