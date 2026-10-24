#!/bin/sh
# S8 restore into a brand-new data volume: tear the stack down *with its volume*, recreate the volume,
# unpack the archive, start. The MUC room-creation restriction (bootstrap.sh) lives in the DB, so it
# is restored too; do not re-run bootstrap.sh.
#   spike/docker/openfire/ops/restore.sh [in.tgz]
set -eu
cd "$(dirname "$0")/.."
IMAGE=ghcr.io/igniterealtime/openfire:v5.1.2@sha256:5c9119cd4ea6edaa4dfead0cccbeb98847614d47d61715de8fd98c3b189670d6
IN=${1:-backup/openfire-data.tgz}
docker compose down -v
docker volume create --label com.docker.compose.project=wrx-openfire --label com.docker.compose.volume=data \
  wrx-openfire_data >/dev/null
docker run --rm --network none --entrypoint tar \
  -v wrx-openfire_data:/var/lib/openfire -v "$(cd "$(dirname "$IN")" && pwd)":/backup:ro \
  "$IMAGE" xzpf "/backup/$(basename "$IN")" -C /var/lib/openfire
docker compose up -d --wait
