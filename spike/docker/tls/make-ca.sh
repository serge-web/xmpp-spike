#!/bin/sh
# S8: generate a throwaway internal CA and a server certificate for "localhost" (and the service
# subdomains). Output goes to ./out (gitignored). Usage: sh make-ca.sh
set -eu
cd "$(dirname "$0")"
mkdir -p out && cd out
[ -f ca.key ] || openssl req -x509 -newkey rsa:3072 -nodes -keyout ca.key -out ca.crt -days 3650 -subj "/CN=WRX1 Spike Test CA"
cat > san.cnf <<'CNF'
subjectAltName = DNS:localhost, DNS:conference.localhost, DNS:pubsub.localhost, IP:127.0.0.1
extendedKeyUsage = serverAuth
CNF
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=localhost"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 825 -extfile san.cnf
cat server.crt server.key > server.pem   # ejabberd wants cert+key in one PEM
chmod 644 server.pem server.key
echo "CA: $(pwd)/ca.crt  server: $(pwd)/server.pem"
