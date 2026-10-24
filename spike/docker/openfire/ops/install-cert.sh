#!/bin/sh
# S8: replace OpenFire's self-signed certificate with the internal-CA one (from make-test-ca.sh) and
# restart. Uses the image's own keytool, so it works offline. The keystore (JKS, password "changeit",
# OpenFire's default) lives on the data volume: /var/lib/openfire/conf/security/keystore.
# The same identity store serves c2s (5222/5223) and HTTP-bind/WebSocket TLS (7443).
# Equivalent admin-console path: Server > TLS/SSL Certificates > Identity Store > Import.
set -eu
cd "$(dirname "$0")/.."
C=wrx-openfire-openfire-1
KS=/var/lib/openfire/conf/security/keystore
docker cp tls/localhost.p12 "$C:/tmp/localhost.p12"
docker exec "$C" keytool -delete -alias localhost_rsa -keystore "$KS" -storepass changeit || true
docker exec "$C" keytool -importkeystore -noprompt -srckeystore /tmp/localhost.p12 -srcstoretype PKCS12 \
  -srcstorepass changeit -srcalias localhost_rsa -destkeystore "$KS" -deststorepass changeit -destalias localhost_rsa
docker exec "$C" chown openfire:openfire "$KS"
docker exec "$C" rm -f /tmp/localhost.p12
docker exec "$C" keytool -list -v -keystore "$KS" -storepass changeit -alias localhost_rsa | grep -E 'Owner|Issuer'
docker compose restart openfire
docker compose up -d --wait
