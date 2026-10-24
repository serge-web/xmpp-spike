#!/bin/sh
# S8: generate a throwaway internal test CA and a server certificate for the Prosody hosts.
# Output (gitignored): spike/docker/prosody/tls/{ca.crt,ca.key,certs/localhost.crt,certs/localhost.key}
set -eu
cd "$(dirname "$0")/.."
mkdir -p tls/certs
openssl req -x509 -newkey rsa:3072 -sha256 -days 30 -nodes \
  -keyout tls/ca.key -out tls/ca.crt -subj "/CN=WRX1 spike test CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl req -newkey rsa:2048 -sha256 -nodes -keyout tls/certs/localhost.key -out tls/server.csr -subj "/CN=localhost"
cat > tls/server.ext <<EXT
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,DNS:conference.localhost,DNS:pubsub.localhost,DNS:anon.localhost
EXT
openssl x509 -req -in tls/server.csr -CA tls/ca.crt -CAkey tls/ca.key -CAcreateserial -days 30 -sha256 \
  -extfile tls/server.ext -out tls/certs/localhost.crt
# Prosody runs as the unprivileged prosody user inside the image and must be able to read the key.
chmod 644 tls/certs/localhost.crt tls/certs/localhost.key
openssl verify -CAfile tls/ca.crt tls/certs/localhost.crt
