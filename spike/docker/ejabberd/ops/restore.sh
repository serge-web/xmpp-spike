#!/bin/sh
# S8 restore: destroy the database volume, recreate it from backup/ejabberd-db.tgz, start.
set -eu
cd "$(dirname "$0")/.."
docker compose down -v
docker volume create wrx-ejabberd_db >/dev/null
docker run --rm -v wrx-ejabberd_db:/data -v "$PWD/backup:/backup:ro" alpine:3.20 \
  sh -c 'tar xzf /backup/ejabberd-db.tgz -C /data && chown -R 9000:9000 /data'
docker compose up -d
