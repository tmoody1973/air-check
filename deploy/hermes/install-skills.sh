#!/usr/bin/env bash
# Install the station skills into both Hermes sandboxes. Run after any destroy + re-onboard:
# skills survive stop/start and `rebuild`, but not a destroy (NemoHermes v0.0.137 docs, checked 2026-10-28).
# `skill install` refuses to replace a same-name skill, so each one is removed first.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH" XDG_RUNTIME_DIR="/run/user/$(id -u)"
REPO="${1:-$HOME/air-check}"
SKILLS=(rlr-description-safety rlr-mixcloud-title-and-tags rlr-show-notes rlr-pre-air-verify rlr-deep-dive)
for sandbox in airc aircdemo; do
  for skill in "${SKILLS[@]}"; do
    nemohermes "$sandbox" skill remove "$skill" >/dev/null 2>&1 || true
    nemohermes "$sandbox" skill install "$REPO/skills/$skill"
  done
  echo "== $sandbox"
  nemohermes "$sandbox" skill list 2>/dev/null | grep -E "rlr-" || { echo "$sandbox: station skills missing" >&2; exit 1; }
done
