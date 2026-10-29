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

# The host forward to a sandbox sometimes stops listening while the sandbox and its gateway keep running
# (Oct 29, twice). Each forward has its own unit that systemd restarts in 3 s; if a probe still fails,
# restart that unit (narrow sudoers rule from install-forward.sh), and only if Hermes is still unreachable
# run `recover` once before calling it down. Prints nothing but the probe name and time (Hard Rule 8).
# Usage: heal <sandbox> <forward unit> <probe command>
heal() {
  local box="$1" unit="$2" probe="$3"
  if (( DRY_RUN )); then
    echo "would run: sudo systemctl restart ${unit} (skipped in dry run)"
    echo "would run: nemohermes ${box} recover (skipped in dry run)"
    return 1
  fi
  if sudo -n /usr/bin/systemctl restart "${unit}" >/dev/null 2>&1; then
    sleep "${HEAL_WAIT:-10}"
    bash -c "${probe}" >/dev/null 2>&1 && return 0
  fi
  XDG_RUNTIME_DIR=/run/user/1001 timeout 120 "${HOME}/.local/bin/nemohermes" "${box}" recover >/dev/null 2>&1
  sleep "${HEAL_WAIT:-10}"
}

# Adds one line to the queue of messages not yet sent. Keeps the last 20 lines: one Telegram message holds
# at most 4,096 characters.
queue() {
  { cat "${PENDING}" 2>/dev/null; echo "$1"; } | tail -n 20 > "${PENDING}.tmp" && mv "${PENDING}.tmp" "${PENDING}"
}

down=()
healed=()
for probe in "${PROBES[@]}"; do
  name="${probe%%|*}"
  cmd="${probe#*|}"
  if ! bash -c "${cmd}" >/dev/null 2>&1; then
    box="" unit=""
    [[ "${name}" == "Hermes" ]] && box="airc" unit="aircheck-hermes-forward.service"
    [[ "${name}" == "Demo Hermes" ]] && box="aircdemo" unit="aircheck-hermes-demo-forward.service"
    if [[ -n "${box}" ]] && heal "${box}" "${unit}" "${cmd}" && bash -c "${cmd}" >/dev/null 2>&1; then
      healed+=("${name}")
      echo "watchdog: ${name} link dropped, reconnected at $(date +%H:%M)"
    else
      down+=("${name}")
    fi
  fi
done
if (( ${#healed[@]} > 0 )); then
  # One line per run, queued so it goes out with any state message and survives a Telegram outage.
  queue "Air Check: agent link dropped and was reconnected at $(date +%H:%M)."
fi

# Agent-made skills. On Oct 27 the agent wrote itself a skill with wrong limits (docs/FRICTION_LOG.md, Oct 28).
# Any local skill the repo did not install gets one alert per sandbox and name, remembered in SKILLS_SEEN.
# Keep REPO_SKILLS equal to SKILLS in install-skills.sh (deploy/deploy.test.ts checks). Names only.
REPO_SKILLS=(rlr-description-safety rlr-mixcloud-title-and-tags)
SKILLS_SEEN="${HOME}/.aircheck/watchdog.skills-seen"
for sb in airc aircdemo; do
  # A sandbox that is down is the Agent skills probe's job, not this check's.
  list="$(XDG_RUNTIME_DIR=/run/user/1001 timeout 60 "${HOME}/.local/bin/nemohermes" "${sb}" skill list 2>/dev/null)" || continue
  # Rows look like "│ <name> │ local │ enabled │"; the "53 builtin, 2 local" summary line has no column bars.
  for skill in $(printf '%s\n' "${list}" | grep -E '[│|] *local *[│|]' | sed -E 's/^[│| ]*([A-Za-z0-9_.-]+).*/\1/'); do
    [[ " ${REPO_SKILLS[*]} " == *" ${skill} "* ]] && continue
    grep -qxF "${sb}:${skill}" "${SKILLS_SEEN}" 2>/dev/null && continue
    msg="Air Check: the agent made itself a new skill, ${skill}, in ${sb}. Check it before the next draft."
    if (( DRY_RUN )); then
      echo "${msg}"
      continue
    fi
    queue "${msg}"
    echo "${sb}:${skill}" >> "${SKILLS_SEEN}"
    echo "watchdog: new local skill in ${sb}: ${skill}"
  done
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
  queue "${msg}"
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
