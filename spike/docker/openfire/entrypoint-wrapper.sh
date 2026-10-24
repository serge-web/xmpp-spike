#!/bin/bash
# WRX1 spike: thin wrapper around the image's own /sbin/entrypoint.sh (unchanged).
# The stock entrypoint creates /var/lib/openfire/embedded-db on the data volume but never links it,
# while EmbeddedConnectionProvider opens $OPENFIRE_HOME/embedded-db (/usr/local/openfire/embedded-db),
# i.e. the container layer. Without this link the embedded database is lost when the container is recreated.
set -e
mkdir -p /var/lib/openfire/embedded-db
ln -sfn /var/lib/openfire/embedded-db /usr/local/openfire/embedded-db
exec /sbin/entrypoint.sh "$@"
