#!/usr/bin/env bash
# Creates Air Check's private certificate authority (CA), used only so the
# NemoClaw sandbox can trust the Crate bridge on the VM's private address.
# The CA key never leaves ~/.aircheck/ca/ and is never copied into the sandbox.
# Pass ca.crt alone as NEMOCLAW_CORPORATE_CA_BUNDLE: NemoClaw appends it to the
# sandbox trust store itself and rejects merged system bundles.
set -euo pipefail

DIR="${HOME}/.aircheck/ca"

if [[ -e "${DIR}/ca.key" ]]; then
  echo "refusing: ${DIR}/ca.key already exists" >&2
  exit 1
fi

mkdir -p "${DIR}"
chmod 700 "${DIR}"
umask 077

openssl ecparam -name prime256v1 -genkey -noout -out "${DIR}/ca.key"
openssl req -x509 -new -key "${DIR}/ca.key" -sha256 -days 1825 \
  -subj "/CN=Air Check private CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -out "${DIR}/ca.crt"
chmod 600 "${DIR}/ca.key"
chmod 644 "${DIR}/ca.crt"

echo "CA: ${DIR}/ca.crt (expires $(openssl x509 -in "${DIR}/ca.crt" -noout -enddate | cut -d= -f2))"
