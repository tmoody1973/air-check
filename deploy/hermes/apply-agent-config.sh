#!/usr/bin/env bash
# Re-applies the agent settings a destroy + re-onboard loses, in both sandboxes, then reinstalls the
# station skills. Safe to run any time: every step sets a value or replaces a skill, nothing piles up.
# Run it after `~/.aircheck/reonboard.sh` or `onboard-demo.sh` (docs/DEPLOY.md), and install-forward.sh runs it.
#   skills.creation_nudge_interval: 0   Hermes never prompts itself to write new skills
#   skills.write_approval: true         a skill the agent writes waits for approval
# Why: on Oct 27 the agent wrote itself a skill with wrong limits (docs/FRICTION_LOG.md, Oct 28).
# Usage: apply-agent-config.sh [repo folder, default ~/air-check]
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH" XDG_RUNTIME_DIR="/run/user/$(id -u)"
REPO="${1:-$HOME/air-check}"
for sandbox in airc aircdemo; do
  openshell sandbox exec -n "$sandbox" -- bash -lc \
    "hermes config set skills.creation_nudge_interval 0 && hermes config set skills.write_approval true" >/dev/null
  # Read the values back from the file Hermes loads; stop if either did not stick.
  if ! openshell sandbox exec -n "$sandbox" -- cat /sandbox/.hermes/config.yaml |
       awk '/^[^ #]/ { s = ($0 ~ /^skills:/) }
            s && /^ +creation_nudge_interval: *0 *$/ { a = 1 }
            s && /^ +write_approval: *true *$/ { b = 1 }
            END { exit !(a && b) }'; then
    echo "$sandbox: skills.creation_nudge_interval / skills.write_approval did not read back as 0 / true" >&2
    exit 1
  fi
  echo "$sandbox: skill-creation lock set"
done
bash "$REPO/deploy/hermes/install-skills.sh" "$REPO"
