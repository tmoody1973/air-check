#!/usr/bin/env bash
# Air Check watchdog: probes Hermes (and later the bridge) and sends Tarik one
# Telegram message when something goes down and one when it comes back.
# Silent while nothing changes. No links, no secrets in the message.
# Usage: watchdog.sh [--dry-run]   (dry run prints the message instead of sending)
set -uo pipefail

STATE="${HOME}/.aircheck/watchdog.state"
SECRETS="${HOME}/.airc/secrets.env"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# name|command — each command exits 0 when healthy.
PROBES=(
  "Hermes|curl -sf -m 5 -o /dev/null http://127.0.0.1:8642/health"
  "Crate bridge|curl -sf -m 5 -o /dev/null --cacert ${HOME}/.aircheck/ca/ca.crt https://10.104.0.41:8443/healthz"
)

down=()
for probe in "${PROBES[@]}"; do
  name="${probe%%|*}"
  cmd="${probe#*|}"
  bash -c "${cmd}" >/dev/null 2>&1 || down+=("${name}")
done

now="ok"
(( ${#down[@]} > 0 )) && now="down:$(IFS=,; echo "${down[*]}")"
before="$(cat "${STATE}" 2>/dev/null || echo ok)"

[[ "${now}" == "${before}" ]] && exit 0

if [[ "${now}" == "ok" ]]; then
  msg="Air Check: everything is back up at $(date +%H:%M) (was ${before#down:} down)."
else
  msg="Air Check: ${now#down:} is down since $(date +%H:%M). Console unaffected."
fi

if (( DRY_RUN )); then
  echo "${msg}"
  exit 0
fi

# shellcheck disable=SC1090
set -a; . "${SECRETS}"; set +a
chat="${TELEGRAM_ALLOWED_IDS%%,*}"
if curl -sf -m 10 -o /dev/null "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
     --data-urlencode "chat_id=${chat}" --data-urlencode "text=${msg}"; then
  echo "${now}" > "${STATE}"
else
  # Leave the state unchanged so the next tick retries the message.
  echo "watchdog: Telegram send failed" >&2
  exit 1
fi
