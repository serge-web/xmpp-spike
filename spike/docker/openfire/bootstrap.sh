#!/bin/bash
# Operator bootstrap for the OpenFire stack: the only out-of-band step, run once on the host after
# `docker compose up`. The admin account itself is created by <autosetup> in openfire.xml; everything
# game-related is provisioned over XMPP with the admin's own credentials (spike/tests/provision/openfire.ts).
#
# What this does, and why it is not in openfire.xml: OpenFire keeps MUC *service* settings in the
# ofMucServiceProp table (MUCPersistenceManager), not in system properties, so autosetup cannot set them
# and there is no XMPP command for them. The supported way is the admin console page
# "Group Chat > Room Creation Permissions", which we drive with curl, authenticated as the admin user.
#
# Result: room creation restricted (service property create.anyone=true -- the name is inverted in
# OpenFire's code: it stores roomCreationRestricted), only admin@localhost may create rooms.
set -euo pipefail
B="${OPENFIRE_CONSOLE:-http://localhost:9090}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-spike-password}"
DOMAIN="${XMPP_DOMAIN:-localhost}"
J=$(mktemp)
trap 'rm -f "$J"' EXIT

csrf_of() { grep -oE 'name="csrf" value="[^"]+"' | head -1 | sed 's/.*value="//;s/"$//'; }
page() { curl -fsS -c "$J" -b "$J" "$B/$1"; }

csrf=$(page login.jsp | csrf_of)
code=$(curl -sS -c "$J" -b "$J" -o /dev/null -w '%{http_code}' --data-urlencode "csrf=$csrf" \
  -d login=true -d username=admin --data-urlencode "password=$ADMIN_PASSWORD" "$B/login.jsp")
[ "$code" = 302 ] || { echo "admin console login failed (HTTP $code)" >&2; exit 1; }

csrf=$(page 'muc-create-permission.jsp?mucname=conference' | csrf_of)
curl -fsS -c "$J" -b "$J" -o /dev/null --data-urlencode "csrf=$csrf" -d mucname=conference \
  -d allowAllRegisteredUsers=false -d openPerms=false "$B/muc-create-permission.jsp?save"

csrf=$(page 'muc-create-permission.jsp?mucname=conference' | csrf_of)
curl -fsS -c "$J" -b "$J" -o /dev/null --data-urlencode "csrf=$csrf" -d mucname=conference \
  --data-urlencode "userJID=admin@$DOMAIN" "$B/muc-create-permission.jsp?add"

# Verify: the restricted radio is checked and admin is listed.
out=$(page 'muc-create-permission.jsp?mucname=conference')
echo "$out" | grep -q "admin@$DOMAIN" || { echo "admin not in room-creation list" >&2; exit 1; }
echo "$out" | grep -A2 'id="restrictedPermissionsRadio"' | grep -q checked || { echo "room creation not restricted" >&2; exit 1; }
echo "bootstrap ok: MUC room creation restricted to admin@$DOMAIN"
