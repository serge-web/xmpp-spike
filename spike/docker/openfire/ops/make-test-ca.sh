#!/bin/sh
# S8: generate a throwaway internal test CA and a server certificate for localhost, and package the
# server key + chain as PKCS#12 for OpenFire's keystore.
# Output (gitignored): spike/docker/openfire/tls/{ca.crt,ca.key,localhost.crt,localhost.key,localhost.p12}
set -eu
cd "$(dirname "$0")/.."
mkdir -p tls
openssl req -x509 -newkey rsa:3072 -sha256 -days 30 -nodes \
  -keyout tls/ca.key -out tls/ca.crt -subj "/CN=WRX1 spike test CA (OpenFire)" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl req -newkey rsa:2048 -sha256 -nodes -keyout tls/localhost.key -out tls/server.csr -subj "/CN=localhost"
cat > tls/server.ext <<EXT
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1
EXT
openssl x509 -req -in tls/server.csr -CA tls/ca.crt -CAkey tls/ca.key -CAcreateserial -days 30 -sha256 \
  -extfile tls/server.ext -out tls/localhost.crt
openssl verify -CAfile tls/ca.crt tls/localhost.crt
# Alias localhost_rsa = the entry OpenFire's autosetup created; replacing it keeps OpenFire's own naming.
openssl pkcs12 -export -name localhost_rsa -inkey tls/localhost.key -in tls/localhost.crt -certfile tls/ca.crt \
  -passout pass:changeit -out tls/localhost.p12
