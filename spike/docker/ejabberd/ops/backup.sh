#!/bin/sh
# S8 cold backup: stop ejabberd, archive the database volume (SQLite + Mnesia), start again.
set -eu
cd "$(dirname "$0")/.."
mkdir -p backup
docker compose stop ejabberd
docker run --rm -v wrx-ejabberd_db:/data:ro -v "$PWD/backup:/backup" alpine:3.20 \
  tar czf /backup/ejabberd-db.tgz -C /data .
docker compose start ejabberd
ls -l backup/ejabberd-db.tgz
