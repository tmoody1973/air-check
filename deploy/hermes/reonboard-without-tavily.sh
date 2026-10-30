#!/usr/bin/env bash
# Rebuilds the airc sandbox WITHOUT its own Tavily key (Plan 7 Task 6 step 4, Tarik's call Oct 29). Web search now goes
# only through the bridge's source_search, so the sandbox's Tavily provider rule (which also allowed /extract, decision
# 006 addendum) should be gone. Run on the VM as `user`, after `git pull` in ~/air-check and after the bridge holds
# TAVILY_API_KEY (deploy/bridge/add-research-keys.sh):
#   bash deploy/hermes/reonboard-without-tavily.sh [repo folder, default ~/air-check]
# docs/DEPLOY.md, "Plan 7: sourced research", has the order. Hermes in airc loses its memory (like any re-onboard).
# It never prints a secret. The Tavily key is never written anywhere: reonboard.sh gets a temporary copy of
# ~/.airc/secrets.env without the TAVILY_API_KEY line (mode 600, deleted on exit); the original is not changed.
set -euo pipefail
if [[ "$(id -un)" != "user" ]]; then
  echo "Run as user, not root: bash deploy/hermes/reonboard-without-tavily.sh" >&2
  exit 1
fi
export PATH="$HOME/.local/bin:$PATH:/usr/sbin" XDG_RUNTIME_DIR="/run/user/$(id -u)"
REPO="${1:-$HOME/air-check}"
REONBOARD="$HOME/.aircheck/reonboard.sh"
SECRETS="$HOME/.airc/secrets.env"
BACKUP_DIR="$HOME/.aircheck/agent-skill-backup"
STOPPED=0
RESTORED=0
TMP_SECRETS=""

stop() { echo "STOP: $*" >&2; exit 1; }
health() { curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:8642/health || true; }

# Starts what step 2 stopped: the forward first (it adopts or replaces the forward the onboard started; a stray under
# 30 s old is left alone and the unit retries every second), then the relay and the watchdog timer.
restore() {
  (( STOPPED && ! RESTORED )) || return 0
  RESTORED=1
  sudo systemctl start --no-block aircheck-hermes-forward || echo "could not start aircheck-hermes-forward" >&2
  local code=000
  for _ in $(seq 1 90); do
    code="$(health)"
    [[ "$code" == 200 ]] && break
    sleep 1
  done
  echo "aircheck-hermes-forward: $(systemctl is-active aircheck-hermes-forward || true), /health $code"
  sudo systemctl start aircheck-relay aircheck-watchdog.timer || echo "could not start aircheck-relay or aircheck-watchdog.timer" >&2
  echo "aircheck-relay: $(systemctl is-active aircheck-relay || true), aircheck-watchdog.timer: $(systemctl is-active aircheck-watchdog.timer || true)"
}
cleanup() {
  local rc=$?
  [[ -n "$TMP_SECRETS" ]] && rm -f "$TMP_SECRETS"
  if (( STOPPED && ! RESTORED )); then
    echo "== Restoring the forward, relay and watchdog after a stop" >&2
    restore || true
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "== 1. Preflight (changes nothing)"
[[ -z "$(ss -Htn state established '( sport = :8642 )' 2>/dev/null)" ]] ||
  stop "a draft or research run is talking to Hermes on 8642. Wait for it to finish, then run this again. Nothing was changed."
grep -q 'rlr-show-notes' "$REPO/deploy/hermes/install-skills.sh" ||
  stop "$REPO is older than Plan 7 (install-skills.sh has no research skills). git pull first. Nothing was changed."
cmp -s "$REPO/deploy/hermes/watchdog.sh" "$HOME/.aircheck/watchdog.sh" ||
  stop "the installed watchdog is not the repo copy, so it would call the new research skills agent-made. Run: bash $REPO/deploy/hermes/install-watchdog.sh, then this again. Nothing was changed."
[[ -f "$REONBOARD" ]] || stop "$REONBOARD is missing. Nothing was changed."
[[ -f "$SECRETS" ]] || stop "$SECRETS is missing. Nothing was changed."
status="$(nemohermes airc status 2>&1 || true)"
grep -q 'Ready' <<<"$status" ||
  stop "airc is not Ready, and the destroy in reonboard.sh needs it running (docs/DEPLOY.md, 'If the sandbox is in Error'). Nothing was changed."

# How reonboard.sh reads secrets.env decides how it gets the copy: an env var or first argument it already supports
# ("${NAME:-$HOME/.airc/secrets.env}" or "${1:-...}"). Comment lines are ignored; line numbers are the file's.
rb_code="$(grep -nvE '^[[:space:]]*#' "$REONBOARD" || true)"
refs="$(grep 'secrets\.env' <<<"$rb_code" || true)"
override="$(grep -oE '\$\{([A-Za-z_][A-Za-z0-9_]*|1):[-=][^}]*secrets\.env\}' <<<"$refs" | head -n 1 | sed -E 's/^\$\{([A-Za-z0-9_]+):.*/\1/' || true)"
if [[ -z "$override" ]] || grep -vqF "\${$override:" <<<"$refs"; then
  echo "reonboard.sh reads secrets.env here, with no setting this script can point at a copy:" >&2
  echo "${refs:-  (no line names secrets.env)}" >&2
  stop "one-time manual step (docs/DEPLOY.md, 'Plan 7: sourced research'): cp $REONBOARD $REONBOARD.pre-plan7, then in $REONBOARD replace the secrets.env path on the line(s) above with \"\${AIRC_SECRETS_FILE:-\$HOME/.airc/secrets.env}\". Run this script again. Nothing was changed."
fi
if grep -qi 'tavily' <<<"$rb_code"; then
  echo "reonboard.sh names Tavily itself (values hidden):" >&2
  grep -i 'tavily' <<<"$rb_code" | sed -E 's/=[^[:space:]]*/=<hidden>/g' >&2
  stop "remove the Tavily key or the tavily preset from those lines of $REONBOARD (keep a copy first), then run this again. Nothing was changed."
fi
echo "reonboard.sh reads secrets.env through \${$override}: it will get a copy without TAVILY_API_KEY"
others="$(grep -vE '^[[:space:]]*(export[[:space:]]+)?TAVILY_API_KEY=' "$SECRETS" | grep -i 'tavily' | cut -d= -f1 || true)"
if [[ -n "$others" ]]; then
  echo "secrets.env names Tavily in more than TAVILY_API_KEY (names only):" >&2
  echo "$others" >&2
  stop "remove or rename those lines in $SECRETS by hand (keep a copy first), then run this again. Nothing was changed."
fi

echo
echo "This destroys and re-onboards airc (about a minute). Hermes in airc loses its memory. aircdemo is not touched."
read -r -p "Type rebuild to go on: " answer
[[ "$answer" == rebuild ]] || stop "not confirmed. Nothing was changed."

echo "== 2. Pause the watchdog, the relay and the airc forward"
STOPPED=1
sudo systemctl stop aircheck-watchdog.timer aircheck-watchdog.service aircheck-relay aircheck-hermes-forward

echo "== 3. Back up the airc skills and Hermes config"
install -d -m 700 "$BACKUP_DIR"
backup="$BACKUP_DIR/airc-$(date +%Y%m%d-%H%M%S).tgz"
( umask 077; openshell sandbox exec -n airc -- bash -lc 'cd /sandbox/.hermes && tar -czf - config.yaml $(ls -d skills 2>/dev/null)' > "$backup" )
saved="$(tar -tzf "$backup" || true)"
grep -qx 'config.yaml' <<<"$saved" || stop "the backup $backup has no config.yaml; airc was not rebuilt."
echo "saved $backup ($(grep -c '/SKILL.md$' <<<"$saved" || true) skills)"

echo "== 4. Re-onboard airc without TAVILY_API_KEY (tavily preset left out)"
TMP_SECRETS="$(umask 077; mktemp "$HOME/.aircheck/secrets.reonboard.XXXXXX")"
chmod 600 "$TMP_SECRETS"
grep -vE '^[[:space:]]*(export[[:space:]]+)?TAVILY_API_KEY=' "$SECRETS" > "$TMP_SECRETS" || true
echo "secrets copy: $(grep -c '=' "$TMP_SECRETS" || true) settings, $(grep -cE '^[[:space:]]*(export[[:space:]]+)?TAVILY_API_KEY=' "$SECRETS" || true) TAVILY_API_KEY line(s) left out"
if [[ "$override" == 1 ]]; then
  env -u TAVILY_API_KEY bash "$REONBOARD" "$TMP_SECRETS"
else
  env -u TAVILY_API_KEY "$override=$TMP_SECRETS" bash "$REONBOARD"
fi
rm -f "$TMP_SECRETS"
TMP_SECRETS=""

echo "== 5. The relay's gateway token for airc"
# A new sandbox may get a new gateway token. The relay needs the current one; the value is never printed.
relay_env="$HOME/.aircheck/relay.env"
NEW_TOK="$(nemohermes airc gateway-token --quiet)"
[[ -n "$NEW_TOK" ]] || stop "nemohermes airc gateway-token printed nothing."
export NEW_TOK
if awk -F= '$1 == "AIRC_GATEWAY_TOKEN" { ok = (substr($0, index($0, "=") + 1) == ENVIRON["NEW_TOK"]) } END { exit !ok }' "$relay_env"; then
  echo "relay.env: AIRC_GATEWAY_TOKEN unchanged"
else
  cp -p "$relay_env" "$relay_env.pre-reonboard"
  ( umask 077; awk '/^AIRC_GATEWAY_TOKEN=/ { print "AIRC_GATEWAY_TOKEN=" ENVIRON["NEW_TOK"]; next } { print }' "$relay_env" > "$relay_env.tmp" )
  chmod 600 "$relay_env.tmp" && mv "$relay_env.tmp" "$relay_env"
  echo "relay.env: AIRC_GATEWAY_TOKEN updated to the new sandbox's token (old file: $relay_env.pre-reonboard)"
fi
unset NEW_TOK

echo "== 6. Register the bridge tools again (crate with every deny, aircheck), then re-wire"
CRATE_MCP_TOKEN="$(grep ^CRATE_MCP_TOKEN= ~/.aircheck/bridge.env | cut -d= -f2-)"
AIRCHECK_MCP_TOKEN="$(grep ^AIRCHECK_MCP_TOKEN= ~/.aircheck/bridge.env | cut -d= -f2-)"
export CRATE_MCP_TOKEN AIRCHECK_MCP_TOKEN
[[ -n "$CRATE_MCP_TOKEN" && -n "$AIRCHECK_MCP_TOKEN" ]] || stop "bridge.env lacks CRATE_MCP_TOKEN or AIRCHECK_MCP_TOKEN."
nemohermes airc mcp remove crate >/dev/null 2>&1 || true
nemohermes airc mcp remove aircheck >/dev/null 2>&1 || true
nemohermes airc mcp add crate --url https://10.104.0.41:8443/crate/mcp --env CRATE_MCP_TOKEN --trusted-private-host 10.104.0.41 --deny-tool "telegraph_*" --deny-tool "tumblr_*" --deny-tool "browser_*" --deny-tool "whosampled_*" --deny-tool bandcamp_get_fan_collection --deny-tool bandcamp_get_artist_page --deny-tool bandcamp_get_album --deny-tool bandcamp_get_artist_tracks --deny-tool bandcamp_get_bandcamp_editorial
nemohermes airc mcp add aircheck --url https://10.104.0.41:8443/aircheck/mcp --env AIRCHECK_MCP_TOKEN --trusted-private-host 10.104.0.41
unset CRATE_MCP_TOKEN AIRCHECK_MCP_TOKEN
timeout 120 nemohermes airc mcp restart

echo "== 7. Skill-writing lock and station skills (both sandboxes)"
bash "$REPO/deploy/hermes/apply-agent-config.sh" --with-skills "$REPO"

echo "== 8. Start the forward, then the relay and the watchdog timer"
restore

echo "== 9. Checks"
st="$(nemohermes airc status 2>&1 || true)"
if grep -qi 'tavily' <<<"$st"; then
  grep -i 'tavily' <<<"$st" >&2
  stop "nemohermes airc status still lists a tavily policy. Send Tarik's assistant this output; do not delete anything by hand."
fi
echo "ok: nemohermes airc status lists no tavily policy"
pol="$(nemohermes airc policy get 2>&1 || true)"
if grep -qE '_provider_airc_tavily_search|api\.tavily\.com' <<<"$pol"; then
  grep -nE -B2 -A10 '_provider_airc_tavily_search|api\.tavily\.com' <<<"$pol" >&2
  stop "the Tavily provider rule came back after the re-onboard (NemoClaw's saved registry?). Send this output for docs/FRICTION_LOG.md and decision 006; do not try to delete it."
fi
echo "ok: policy get has no _provider_airc_tavily_search and no api.tavily.com"
crate="$(nemohermes airc mcp status crate --json --tools 2>&1 || true)"
grep -q '"registered": *true' <<<"$crate" && ! grep -qi 'mismatch' <<<"$crate" || stop "mcp status crate is not ready (want registered, no mismatch). Try: timeout 120 nemohermes airc mcp restart"
echo "ok: mcp status crate is ready"
tools="$(nemohermes airc mcp status aircheck --json --tools 2>&1 || true)"
grep -q 'source_search' <<<"$tools" && grep -q 'research_submit' <<<"$tools" ||
  stop "mcp status aircheck --tools does not list source_search and research_submit. Is the bridge deployed (Plan 7)?"
echo "ok: mcp status aircheck --tools lists source_search and research_submit"
want=($(sed -n 's/^SKILLS=(\(.*\))$/\1/p' "$REPO/deploy/hermes/install-skills.sh"))
listing="$(timeout 45 openshell sandbox exec -n airc -- bash -lc 'COLUMNS=200 hermes skills list --source local' 2>/dev/null || true)"
have="$(grep -E '[│|] *local *[│|]' <<<"$listing" | sed -E 's/^[│| ]*([A-Za-z0-9_.-]+(…)?).*/\1/' || true)"
for s in "${want[@]}"; do grep -qxF "$s" <<<"$have" || stop "skill list in airc lacks $s. Run: bash $REPO/deploy/hermes/install-skills.sh"; done
for s in $have; do [[ " ${want[*]} " == *" $s "* ]] || stop "skill list in airc has a skill the repo did not install: $s. Check it before the next draft."; done
echo "ok: skill list shows the rlr- skills (${want[*]}) and no agent-made skill"
got="$(openshell sandbox exec -n airc -- bash -lc 'hermes config get skills.creation_nudge_interval && hermes config get skills.write_approval' | awk 'NF { print $NF }' | paste -sd ' ' - || true)"
[[ "$got" == "0 true" || "$got" == "0 True" ]] || stop "airc config read back '${got:-nothing}', want creation_nudge_interval 0 and write_approval true."
echo "ok: skills.creation_nudge_interval 0 and skills.write_approval true read back"
code="$(health)"
[[ "$code" == 200 ]] || stop "/health on 8642 is $code, want 200. See: systemctl status aircheck-hermes-forward"
echo "ok: /health on 8642 is 200"
echo
echo "All checks passed. Last, by hand: send the Telegram bot a message and confirm it replies."
