#!/bin/bash
set -euo pipefail

# Only needed in Claude Code cloud sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm ci --no-audit --no-fund

# Start the Docker daemon if it isn't running.
if ! docker info >/dev/null 2>&1; then
  sudo -n dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
