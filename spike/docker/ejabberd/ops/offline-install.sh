#!/bin/sh
# S8: prove an offline install from a locally saved image archive.
#   1. On a connected machine: sh ops/offline-install.sh save    -> image/ejabberd-26.09.tar
#   2. On the offline host:    sh ops/offline-install.sh load-run
set -eu
cd "$(dirname "$0")/.."
IMG=ejabberd/ecs:26.09@sha256:8ebff5b218e686d5dbd93850ea17556d5b70d4c15918c3613e9302a357798e0e
TAG=wrx/ejabberd:26.09   # tag before saving: an archive saved by digest loads untagged
case "${1:-}" in
  save)
    docker pull "$IMG" && docker tag "$IMG" "$TAG"
    mkdir -p image && docker save "$TAG" -o image/ejabberd-26.09.tar
    sha256sum image/ejabberd-26.09.tar ;;
  load-run)
    docker load -i image/ejabberd-26.09.tar
    docker rm -f wrx-ejd-offline 2>/dev/null || true
    docker run -d --name wrx-ejd-offline --network none --pull never \
      -v "$PWD/ejabberd.yml:/home/ejabberd/conf/ejabberd.yml:ro" "$TAG"
    for i in $(seq 1 30); do docker exec wrx-ejd-offline ejabberdctl status >/dev/null 2>&1 && break; sleep 2; done
    docker exec wrx-ejd-offline ejabberdctl status
    docker exec wrx-ejd-offline ejabberdctl register offline-check localhost pw
    docker exec wrx-ejd-offline ejabberdctl registered_users localhost
    docker exec wrx-ejd-offline sh -c 'ip -o link 2>/dev/null || cat /proc/net/dev'
    docker rm -f wrx-ejd-offline >/dev/null ;;
  *) echo "usage: $0 save|load-run"; exit 2 ;;
esac
