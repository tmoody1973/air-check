#!/usr/bin/env bash
# Frees a forward unit's port from an unsupervised copy of the same NemoClaw forward, so the unit can bind it.
# Usage: forward-adopt.sh <unit file>     (the unit's ExecStartPre, and install-forward.sh)
# The listener is stopped only when its full argv equals the unit's ExecStart= exactly: that is the forward
# NemoClaw's `recover` starts outside the unit. Anything else on the port is left alone and this exits 1.
# The unit's own running process is left alone too, so re-running the installer is harmless.
# A matching listener younger than MIN_AGE seconds is left alone as well (exit 1, the unit retries in 1 s):
# NemoClaw may have just started it during an onboard or `recover`, and a stray gets old enough soon.
set -euo pipefail
PROC="${PROC_ROOT:-/proc}"
MIN_AGE="${MIN_AGE:-30}"
unit="$1"
want="$(sed -n 's/^ExecStart=//p' "${unit}")"
port="${want##*--local 127.0.0.1:}"
if [[ -z "${want}" || ! "${port}" =~ ^[0-9]+$ ]]; then
  echo "forward-adopt: no forward ExecStart in ${unit}" >&2
  exit 2
fi

listener() { ss -ltnpH "sport = :${port}" 2>/dev/null | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2 || true; }

pid="$(listener)"
[[ -n "${pid}" ]] || exit 0
own="$(systemctl show -p MainPID --value "$(basename "${unit}")" 2>/dev/null || echo 0)"
[[ "${pid}" == "${own}" ]] && exit 0
got="$(tr '\0' ' ' < "${PROC}/${pid}/cmdline")"
got="${got% }"
if [[ "${got}" != "${want}" ]]; then
  echo "forward-adopt: port ${port} is held by pid ${pid} running something else; left alone:" >&2
  echo "  ${got}" >&2
  exit 1
fi
age="$(ps -o etimes= -p "${pid}" | tr -d ' ')"
if [[ ! "${age}" =~ ^[0-9]+$ ]] || (( age < MIN_AGE )); then
  echo "forward-adopt: forward pid ${pid} on port ${port} is ${age:-?} s old (under ${MIN_AGE} s); left alone, retrying" >&2
  exit 1
fi
kill "${pid}"
for _ in $(seq 1 50); do
  if [[ -z "$(listener)" ]]; then
    echo "forward-adopt: stopped unsupervised forward pid ${pid} on port ${port}"
    exit 0
  fi
  sleep 0.1
done
echo "forward-adopt: pid ${pid} still holds port ${port}" >&2
exit 1
