#!/bin/sh
# S8 cold backup: stop Prosody, archive the data volume (SQLite DB: users, rooms, affiliations,
# PubSub nodes/items, MAM), start again. Uses the pinned Prosody image's own tar, so it works offline.
#   spike/docker/prosody/ops/backup.sh [out.tgz]
set -eu
cd "$(dirname "$0")/.."
IMAGE=prosodyim/prosody@sha256:3003867be7f61877890d0f2ff0f1e2a439fd727bfd4bf5bc250c9c3278d5f757
OUT=${1:-backup/prosody-data.tgz}
mkdir -p "$(dirname "$OUT")"
docker compose stop prosody
docker run --rm --network none --entrypoint tar \
  -v wrx-prosody_data:/var/lib/prosody:ro -v "$(cd "$(dirname "$OUT")" && pwd)":/backup \
  "$IMAGE" czf "/backup/$(basename "$OUT")" -C /var/lib/prosody --exclude=prosody.sock .
docker compose start prosody
ls -l "$OUT"
