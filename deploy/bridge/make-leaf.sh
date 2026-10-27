#!/usr/bin/env bash
# Issues the bridge's HTTPS certificate for one private IP, signed by the
# Air Check private CA (make-ca.sh). Valid 365 days; re-run to renew.
# Usage: make-leaf.sh 10.104.0.41
set -euo pipefail

IP="${1:?usage: make-leaf.sh <private-ip>}"
CA="${HOME}/.aircheck/ca"
OUT="${HOME}/.aircheck/bridge"

[[ -r "${CA}/ca.key" && -r "${CA}/ca.crt" ]] || { echo "run make-ca.sh first" >&2; exit 1; }

mkdir -p "${OUT}"
chmod 700 "${OUT}"
umask 077

EXT="$(mktemp)"
trap 'rm -f "${EXT}" "${OUT}/tls.csr"' EXIT
printf 'subjectAltName=IP:%s\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n' "${IP}" > "${EXT}"

openssl ecparam -name prime256v1 -genkey -noout -out "${OUT}/tls.key"
openssl req -new -key "${OUT}/tls.key" -subj "/CN=${IP}" -out "${OUT}/tls.csr"
openssl x509 -req -in "${OUT}/tls.csr" -CA "${CA}/ca.crt" -CAkey "${CA}/ca.key" \
  -CAcreateserial -days 365 -sha256 -extfile "${EXT}" -out "${OUT}/tls.crt"
chmod 600 "${OUT}/tls.key"
chmod 644 "${OUT}/tls.crt"

echo "leaf: ${OUT}/tls.crt for IP ${IP} (expires $(openssl x509 -in "${OUT}/tls.crt" -noout -enddate | cut -d= -f2))"
