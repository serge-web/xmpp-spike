#!/bin/sh
# Operator bootstrap: the only out-of-band step. Creates the admin account; everything
# else is provisioned over XMPP with the admin's own credentials (SPIKE-BRIEF S4).
set -eu
ejabberdctl register admin localhost "${ADMIN_PASSWORD:-spike-password}" 2>/dev/null \
  || ejabberdctl change_password admin localhost "${ADMIN_PASSWORD:-spike-password}"
