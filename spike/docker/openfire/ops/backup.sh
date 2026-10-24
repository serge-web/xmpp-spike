#!/bin/sh
# S8 cold backup: stop OpenFire, archive the whole data volume (conf/openfire.xml + security keystores,
# embedded HSQLDB with users, rooms, affiliations, PubSub nodes/items, Monitoring MAM archive, plugins),
# start again. Uses the pinned image's own tar, so it works offline.
#   spike/docker/openfire/ops/backup.sh [out.tgz]
set -eu
cd "$(dirname "$0")/.."
IMAGE=ghcr.io/igniterealtime/openfire:v5.1.2@sha256:5c9119cd4ea6edaa4dfead0cccbeb98847614d47d61715de8fd98c3b189670d6
OUT=${1:-backup/openfire-data.tgz}
mkdir -p "$(dirname "$OUT")"
docker compose stop openfire
docker run --rm --network none --entrypoint tar \
  -v wrx-openfire_data:/var/lib/openfire:ro -v "$(cd "$(dirname "$OUT")" && pwd)":/backup \
  "$IMAGE" czf "/backup/$(basename "$OUT")" -C /var/lib/openfire .
docker compose start openfire
docker compose up -d --wait
ls -l "$OUT"
