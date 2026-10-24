#!/bin/sh
# S8 hot backup: SQLite online backup while ejabberd keeps serving. Output: backup/ejabberd-hot.db
set -eu
cd "$(dirname "$0")/.."
mkdir -p backup
docker compose exec -T ejabberd sqlite3 /home/ejabberd/database/ejabberd.db ".backup /tmp/ejabberd-hot.db"
docker compose exec -T ejabberd sqlite3 /tmp/ejabberd-hot.db "PRAGMA integrity_check;"
docker compose cp ejabberd:/tmp/ejabberd-hot.db backup/ejabberd-hot.db
docker compose exec -T ejabberd rm /tmp/ejabberd-hot.db
ls -l backup/ejabberd-hot.db
