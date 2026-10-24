#!/bin/sh
# Download the official Ignite Realtime plugins this stack uses into ./plugins and verify sha256.
# Ignite does not publish plugin checksums; these were recorded on first download (2026-10-24).
set -eu
cd "$(dirname "$0")"
mkdir -p plugins
base=https://www.igniterealtime.org/projects/openfire/plugins
fetch() { # name version sha256
  f="plugins/$1.jar"
  [ -f "$f" ] || curl -fsSL -o "$f" "$base/$2/$1.jar"
  echo "$3  $f" | sha256sum -c -
}
# Monitoring Service 2.8.0 (2026-06-04): MUC message archive + MAM (XEP-0313). Needed for S5.
fetch monitoring 2.8.0 ed7d17743df7e034da3304e769164a0dd8b4c89f0a44b76d0008d6bac2c94ab1
# REST API 1.12.0 (2025-07-04): only for operations XMPP cannot do; see results/openfire.md (S4).
fetch restAPI 1.12.0 a1cd5b71437e5d6cd0bbf6a298537baa78f19a50f2104f4c1bb94595a350ccf6
