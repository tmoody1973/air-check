#!/usr/bin/env bash
# Run on the VM after `git pull` in ~/air-check: installs the watchdog and dry-runs it.
set -euo pipefail
src="${HOME}/air-check/deploy/hermes/watchdog.sh"
dst="${HOME}/.aircheck/watchdog.sh"
bash -n "${src}"
[[ -f "${dst}" ]] && cp -p "${dst}" "${dst}.bak"
install -m 755 "${src}" "${dst}"
"${dst}" --dry-run
echo "watchdog installed (previous copy: ${dst}.bak)"
