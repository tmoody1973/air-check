#!/usr/bin/env bash
# Puts the Hermes host forwards (8642 airc, 8643 aircdemo) under systemd. Run on the VM as `user`, after
# `git pull` in ~/air-check:
#   bash deploy/hermes/install-forward.sh          install (or re-install) and check
#   bash deploy/hermes/install-forward.sh --test   the same, then kill each forward once and watch it come back
# Safe to re-run. It stops a running forward only when its full argv is exactly the unit's ExecStart
# (forward-adopt.sh); anything else on 8642/8643 stops the script before it changes anything.
# docs/DEPLOY.md, "The Hermes sandbox", has the background.
set -euo pipefail
if [[ "$(id -un)" != "user" ]]; then
  echo "Run as user, not root: bash deploy/hermes/install-forward.sh" >&2
  exit 1
fi
TEST=0
[[ "${1:-}" == "--test" ]] && TEST=1
export PATH="$HOME/.local/bin:$PATH:/usr/sbin" XDG_RUNTIME_DIR="/run/user/$(id -u)"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
UNITS=(aircheck-hermes-forward.service aircheck-hermes-demo-forward.service)

want_of() { sed -n 's/^ExecStart=//p' "$HERE/$1"; }
port_of() { local w; w="$(want_of "$1")"; echo "${w##*--local 127.0.0.1:}"; }
listener() { ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2 || true; }
health() { curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$1/health" || true; }
prop() { systemctl show -p "$1" --value "$2"; }

echo "== 1. Preflight (changes nothing)"
for u in "${UNITS[@]}"; do
  port="$(port_of "$u")"
  pid="$(listener "$port")"
  if [[ -z "$pid" && -n "$(ss -ltnH "sport = :$port" 2>/dev/null)" ]]; then
    echo "STOP: something this user cannot see holds port $port. Nothing was changed." >&2
    exit 1
  fi
  if [[ -z "$pid" ]]; then
    echo "$port: nothing listening now, so the unit's argv cannot be compared; the /health check below decides"
    continue
  fi
  got="$(tr '\0' ' ' < "/proc/$pid/cmdline")"
  got="${got% }"
  if [[ "$got" != "$(want_of "$u")" ]]; then
    echo "STOP: port $port is held by pid $pid running a different command than $u. Nothing was changed." >&2
    echo "  live: $got" >&2
    echo "  unit: $(want_of "$u")" >&2
    exit 1
  fi
  echo "$port: pid $pid matches $u exactly"
done

echo "== 2. Files"
for f in forward-adopt.sh watchdog.sh apply-agent-config.sh; do bash -n "$HERE/$f"; done
install -d -m 700 "$HOME/.aircheck"
install -m 755 "$HERE/forward-adopt.sh" "$HOME/.aircheck/forward-adopt.sh"
sudo install -m 644 "$HERE/aircheck-hermes-forward.service" "$HERE/aircheck-hermes-demo-forward.service" \
  "$HERE/aircheck-watchdog.service" /etc/systemd/system/
sudo visudo -cf "$HERE/aircheck-forward.sudoers" >/dev/null
sudo install -m 440 -o root -g root "$HERE/aircheck-forward.sudoers" /etc/sudoers.d/aircheck-forward
sudo systemctl daemon-reload

echo "== 3. Hand each port to its unit"
for u in "${UNITS[@]}"; do
  "$HOME/.aircheck/forward-adopt.sh" "/etc/systemd/system/$u"
  sudo systemctl enable --quiet "$u"
  sudo systemctl restart "$u"
done

echo "== 4. Watchdog script (dry run follows)"
bash "$HERE/install-watchdog.sh"

echo "== 5. Agent config and skills"
bash "$HERE/apply-agent-config.sh" "$REPO"

echo "== 6. Checks"
fail=0
for u in "${UNITS[@]}"; do
  port="$(port_of "$u")"
  code=000
  for _ in $(seq 1 20); do
    code="$(health "$port")"
    [[ "$code" == 200 ]] && break
    sleep 1
  done
  main="$(prop MainPID "$u")"
  owner="$(listener "$port")"
  echo "$u: /health $code, ActiveState=$(prop ActiveState "$u"), NRestarts=$(prop NRestarts "$u"), MainPID=$main, listener pid=${owner:-none}"
  ss -ltnpH "sport = :$port" || true
  if [[ "$code" != 200 || "$owner" != "$main" ]]; then
    echo "FAIL: $u (want /health 200 and the listener to be the unit's MainPID)" >&2
    fail=1
  fi
done
sudo -n -l /usr/bin/systemctl restart aircheck-hermes-forward.service >/dev/null || { echo "FAIL: sudoers rule not active" >&2; fail=1; }
systemctl show -p KillMode aircheck-watchdog.service | grep -qx 'KillMode=process' || { echo "FAIL: watchdog KillMode" >&2; fail=1; }

if (( TEST && ! fail )); then
  echo "== 7. Test: kill each forward once; systemd must bring it back"
  for u in "${UNITS[@]}"; do
    port="$(port_of "$u")"
    before="$(prop NRestarts "$u")"
    main="$(prop MainPID "$u")"
    kill "${main}"
    code=000 waited=0
    while (( waited < 10 )); do
      sleep 1
      waited=$((waited + 1))
      code="$(health "$port")"
      [[ "$code" == 200 && "$(prop MainPID "$u")" != "$main" ]] && break
    done
    after="$(prop NRestarts "$u")"
    echo "$u: killed pid $main, /health $code after ${waited}s, NRestarts $before -> $after, new MainPID $(prop MainPID "$u")"
    if [[ "$code" != 200 || "$after" != "$((before + 1))" ]]; then
      echo "FAIL: $u did not come back within 10 s with one restart" >&2
      fail=1
    fi
  done
fi

(( fail )) && { echo "Some checks failed. Stop here and keep the output above." >&2; exit 1; }
echo "All checks passed."
