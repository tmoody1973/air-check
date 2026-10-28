#!/usr/bin/env bash
# Air Check watchdog: probes Hermes (and later the bridge) and sends Tarik one
# Telegram message when something goes down and one when it comes back.
# Silent while nothing changes. No links, no secrets in the message.
# Usage: watchdog.sh [--dry-run]   (dry run prints the message instead of sending)
set -uo pipefail

STATE="${HOME}/.aircheck/watchdog.state"
# Messages not yet delivered. A transition is queued here the moment it is seen, so an
# outage still gets reported if Telegram was down and the service recovered meanwhile.
PENDING="${HOME}/.aircheck/watchdog.pending"
SECRETS="${HOME}/.airc/secrets.env"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# name|command — each command exits 0 when healthy.
PROBES=(
  "Hermes|curl -sf -m 5 -o /dev/null http://127.0.0.1:8642/health"
  "Demo Hermes|curl -sf -m 5 -o /dev/null http://127.0.0.1:8643/health"
  "Crate bridge|curl -sf -m 5 -o /dev/null --cacert ${HOME}/.aircheck/ca/ca.crt https://10.104.0.41:8443/healthz"
  "Relay|systemctl is-active --quiet aircheck-relay"
  "Media|systemctl is-active --quiet aircheck-media"
  "Publisher|systemctl is-active --quiet aircheck-publisher"
  # One probe per sandbox so an alert names which agent lost its tools. Any JSON spacing.
  "Agent tools|for s in aircheck crate; do XDG_RUNTIME_DIR=/run/user/1001 ${HOME}/.local/bin/nemohermes airc mcp status \"\$s\" --json 2>/dev/null | grep -q '\"registered\": *true' || exit 1; done"
  "Demo agent tools|for s in aircheck crate; do XDG_RUNTIME_DIR=/run/user/1001 ${HOME}/.local/bin/nemohermes aircdemo mcp status \"\$s\" --json 2>/dev/null | grep -q '\"registered\": *true' || exit 1; done"
  "Agent skills|for s in airc aircdemo; do XDG_RUNTIME_DIR=/run/user/1001 ${HOME}/.local/bin/nemohermes \"\$s\" skill list 2>/dev/null | grep -q rlr-description-safety || exit 1; done"
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

if [[ "${now}" != "${before}" ]]; then
  # Split "down:A,B" into lists to tell a partial recovery from a new outage.
  IFS=',' read -ra was <<< "${before#down:}"
  recovered=()
  if [[ "${before}" != "ok" ]]; then
    for n in "${was[@]}"; do
      [[ ",${now#down:}," == *",${n},"* ]] || recovered+=("${n}")
    done
  fi

  if [[ "${now}" == "ok" ]]; then
    msg="Air Check: everything is back up at $(date +%H:%M) (was ${before#down:} down)."
  elif (( ${#recovered[@]} > 0 )); then
    msg="Air Check: $(IFS=,; echo "${recovered[*]}") recovered at $(date +%H:%M); ${now#down:} still down."
  else
    msg="Air Check: ${now#down:} is down since $(date +%H:%M). Console unaffected."
  fi

  if (( DRY_RUN )); then
    echo "${msg}"
    exit 0
  fi
  # Queue before recording the new state, so a crash in between re-alerts rather than drops.
  # Keep the last 20 lines: one Telegram message holds at most 4,096 characters.
  { cat "${PENDING}" 2>/dev/null; echo "${msg}"; } | tail -n 20 > "${PENDING}.tmp" && mv "${PENDING}.tmp" "${PENDING}"
  echo "${now}" > "${STATE}"
fi

if (( DRY_RUN )); then
  [[ -s "${PENDING}" ]] && echo "(queued) $(cat "${PENDING}")"
  exit 0
fi
[[ -s "${PENDING}" ]] || exit 0

# Read only the two values needed (not the whole secrets file).
TELEGRAM_BOT_TOKEN="$(grep '^TELEGRAM_BOT_TOKEN=' "${SECRETS}" | cut -d= -f2-)"
TELEGRAM_ALLOWED_IDS="$(grep '^TELEGRAM_ALLOWED_IDS=' "${SECRETS}" | cut -d= -f2-)"
chat="${TELEGRAM_ALLOWED_IDS%%,*}"
# The URL (which holds the bot token) goes in via stdin config so it never shows in `ps`.
if printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "${TELEGRAM_BOT_TOKEN}" |
     curl -sf -m 10 -o /dev/null -K - \
       --data-urlencode "chat_id=${chat}" --data-urlencode "text=$(cat "${PENDING}")"; then
  rm -f "${PENDING}"
else
  # Keep the queue so the next tick retries the message.
  echo "watchdog: Telegram send failed" >&2
  exit 1
fi
