#!/bin/sh
# S8 restore into a brand-new data volume: tear the stack down *with its volume*, recreate the
# volume, unpack the archive, start. Pass extra compose files via COMPOSE_FILES if TLS is in use.
#   spike/docker/prosody/ops/restore.sh [in.tgz]
set -eu
cd "$(dirname "$0")/.."
IMAGE=prosodyim/prosody@sha256:3003867be7f61877890d0f2ff0f1e2a439fd727bfd4bf5bc250c9c3278d5f757
IN=${1:-backup/prosody-data.tgz}
FILES=${COMPOSE_FILES:--f compose.yaml}
# shellcheck disable=SC2086
docker compose $FILES down -v
# Labels let compose adopt the volume as its own (otherwise it warns "not created by Docker Compose").
docker volume create --label com.docker.compose.project=wrx-prosody --label com.docker.compose.volume=data \
  wrx-prosody_data >/dev/null
docker run --rm --network none --entrypoint sh \
  -v wrx-prosody_data:/var/lib/prosody -v "$(cd "$(dirname "$IN")" && pwd)":/backup:ro \
  "$IMAGE" -c "tar xzf /backup/$(basename "$IN") -C /var/lib/prosody && chown -R prosody:prosody /var/lib/prosody"
# shellcheck disable=SC2086
docker compose $FILES up -d --wait
