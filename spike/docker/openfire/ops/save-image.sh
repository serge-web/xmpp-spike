#!/bin/sh
# S8: export everything an offline host needs: the pinned image and the plugin jars.
# `docker save repo@sha256:...` writes an untagged archive, so save the tag (compose's
# `repo:tag@digest` reference then resolves locally after `docker load`).
# Output (gitignored): spike/docker/openfire/image/{openfire-5.1.2.tar,plugins/*.jar,SHA256SUMS}
set -eu
cd "$(dirname "$0")/.."
DIGEST=sha256:5c9119cd4ea6edaa4dfead0cccbeb98847614d47d61715de8fd98c3b189670d6
docker pull "ghcr.io/igniterealtime/openfire@$DIGEST"
docker tag "ghcr.io/igniterealtime/openfire@$DIGEST" ghcr.io/igniterealtime/openfire:v5.1.2
./fetch-plugins.sh
mkdir -p image/plugins
docker save -o image/openfire-5.1.2.tar ghcr.io/igniterealtime/openfire:v5.1.2
cp plugins/*.jar image/plugins/
(cd image && sha256sum openfire-5.1.2.tar plugins/*.jar > SHA256SUMS && cat SHA256SUMS)
# On the offline host (copy this directory with the repo):
#   docker load -i image/openfire-5.1.2.tar && cp image/plugins/*.jar plugins/
#   docker compose -f compose.yaml -f compose.offline.yaml up -d --wait
