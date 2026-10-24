#!/bin/sh
# S8: export the pinned image for an offline install.
# NOTE: `docker save repo@sha256:...` writes an *untagged* archive; after `docker load` the image is
# addressable only by ID and compose's `repo:tag@digest` reference does not resolve (it tries to pull).
# So tag first and save the tag; after load, `prosodyim/prosody:13.0@sha256:...` resolves locally.
set -eu
cd "$(dirname "$0")/.."
DIGEST=sha256:3003867be7f61877890d0f2ff0f1e2a439fd727bfd4bf5bc250c9c3278d5f757
docker pull "prosodyim/prosody@$DIGEST"
docker tag "prosodyim/prosody@$DIGEST" prosodyim/prosody:13.0
mkdir -p image
docker save -o image/prosody-13.0.7.tar prosodyim/prosody:13.0
sha256sum image/prosody-13.0.7.tar
# On the offline host: docker load -i prosody-13.0.7.tar
#   docker compose -f compose.yaml -f compose.offline.yaml up -d --wait
