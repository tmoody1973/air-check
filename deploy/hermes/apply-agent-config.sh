#!/usr/bin/env bash
# Turns off the agent's own skill writing in both sandboxes and checks it stuck:
#   skills.creation_nudge_interval: 0   Hermes never prompts itself to write new skills
#   skills.write_approval: true         a skill the agent writes waits for approval
# Why: on Oct 27 the agent wrote itself a skill with wrong limits (docs/FRICTION_LOG.md, Oct 28).
# For aircdemo this is a real change (it was 15 / false on Oct 29); for airc it re-confirms what is set.
# Safe to run any time: it only sets two values.
# Usage: apply-agent-config.sh [--with-skills] [repo folder, default ~/air-check]
#   --with-skills  also reinstall the station skills (install-skills.sh). Use it after a destroy + re-onboard
#                  (docs/DEPLOY.md); install-forward.sh runs this script without it.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH" XDG_RUNTIME_DIR="/run/user/$(id -u)"
WITH_SKILLS=0
if [[ "${1:-}" == "--with-skills" ]]; then
  WITH_SKILLS=1
  shift
fi
REPO="${1:-$HOME/air-check}"
for sandbox in airc aircdemo; do
  # One call per sandbox: set both, then print both back (the last word of each line is the value).
  got="$(openshell sandbox exec -n "$sandbox" -- bash -lc \
    "hermes config set skills.creation_nudge_interval 0 >/dev/null && hermes config set skills.write_approval true >/dev/null && hermes config get skills.creation_nudge_interval && hermes config get skills.write_approval" |
    awk 'NF { print $NF }' | paste -sd ' ' - || true)"
  if [[ "$got" != "0 true" && "$got" != "0 True" ]]; then
    echo "$sandbox: skill writing NOT turned off (read back: ${got:-nothing}; want 0 true)" >&2
    exit 1
  fi
  label="$sandbox"
  [[ "$sandbox" == aircdemo ]] && label="aircdemo (demo agent)"
  echo "$label: skill writing turned off (creation_nudge_interval 0, write_approval true)"
done
if (( WITH_SKILLS )); then
  bash "$REPO/deploy/hermes/install-skills.sh" "$REPO"
fi
