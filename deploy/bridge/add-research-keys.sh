#!/usr/bin/env bash
# Gives the bridge its Plan 7 research keys, without a value ever showing on screen or passing through an argument.
# Run on the Mac, after the Plan 7 bridge code is deployed (docs/DEPLOY.md, "Plan 7: sourced research"):
#   AIRCHECK_VM=user@<the VM's static IP> bash deploy/bridge/add-research-keys.sh <path to AuthKey_XXXX.p8>
# On the VM it:
#   - copies TAVILY_API_KEY from ~/.airc/secrets.env into ~/.aircheck/bridge.env (VM to VM, never through the Mac)
#   - adds APPLE_MUSIC_TEAM_ID and APPLE_MUSIC_KEY_ID, piped from ~/.aircheck-local/applemusic.env on the Mac
#   - writes the MusicKit key to ~/.aircheck/bridge/AuthKey.p8 (mode 600, owned by user) and sets APPLE_MUSIC_KEY_FILE
#   - restarts aircheck-bridge
# A name that already has a value in bridge.env is left alone (never a second line); an empty placeholder line is
# replaced. It prints only line counts per name, the bridge's /healthz and the apple_music= line from its log.
set -euo pipefail
VM="${AIRCHECK_VM:-}"
P8="${1:-}"
LOCAL_ENV="$HOME/.aircheck-local/applemusic.env"
[[ -n "$VM" ]] || { echo "Set AIRCHECK_VM=user@<the VM's static IP>" >&2; exit 1; }
[[ -f "$P8" && -r "$P8" ]] || { echo "Usage: AIRCHECK_VM=user@<vm> bash $0 <path to AuthKey_XXXX.p8>" >&2; exit 1; }
[[ "$(head -n 1 "$P8")" == "-----BEGIN PRIVATE KEY-----" ]] || { echo "$P8 does not look like a MusicKit .p8 key" >&2; exit 1; }
ids="$(grep -E '^APPLE_MUSIC_(TEAM|KEY)_ID=.+' "$LOCAL_ENV" || true)"
[[ "$(grep -c '^APPLE_MUSIC_TEAM_ID=' <<<"$ids")" == 1 && "$(grep -c '^APPLE_MUSIC_KEY_ID=' <<<"$ids")" == 1 ]] ||
  { echo "$LOCAL_ENV needs exactly one APPLE_MUSIC_TEAM_ID= and one APPLE_MUSIC_KEY_ID= line with a value" >&2; exit 1; }

# Shared by every remote step. Values arrive on stdin and are written with the printf builtin: never in argv.
LIB='set -euo pipefail
f="$HOME/.aircheck/bridge.env"
umask 077
[ -f "$f" ] || { echo "no $f on the VM" >&2; exit 1; }
has() { grep -q "^$1=." "$f"; }
add_lines() {
  local line name
  while IFS= read -r line; do
    name="${line%%=*}"
    if has "$name"; then echo "$name: already set in bridge.env, left alone"; continue; fi
    grep -v "^$name=[[:space:]]*\$" "$f" > "$f.tmp" || true   # drop an empty placeholder; cat keeps the file mode
    cat "$f.tmp" > "$f" && rm -f "$f.tmp"
    [ -z "$(tail -c1 "$f")" ] || echo >> "$f"   # no final newline: add one, so the new line is not glued on
    printf "%s\n" "$line" >> "$f"
    echo "$name: added"
  done
}'
remote() { ssh "$VM" "bash -c $(printf '%q' "$LIB
$1")"; }

echo "== Tavily key (VM to VM)"
remote 'line="$(sed -nE "s/^[[:space:]]*(export[[:space:]]+)?(TAVILY_API_KEY=.+)$/\2/p" "$HOME/.airc/secrets.env" | head -n 1)"
[ -n "$line" ] || { echo "TAVILY_API_KEY not found in ~/.airc/secrets.env" >&2; exit 1; }
printf "%s\n" "$line" | add_lines' </dev/null

echo "== Apple Music ids (Mac to VM)"
remote 'add_lines' <<<"$ids"

echo "== MusicKit key file (Mac to VM)"
remote 'cur="$(sed -n "s/^APPLE_MUSIC_KEY_FILE=//p" "$f" | head -n 1)"
if [ -n "$cur" ] && [ -f "$cur" ]; then cat >/dev/null; echo "APPLE_MUSIC_KEY_FILE: already set in bridge.env, key file left alone"; exit 0; fi
if [ -n "$cur" ]; then   # a path with no file behind it (the example value, say) counts as unset
  grep -v "^APPLE_MUSIC_KEY_FILE=" "$f" > "$f.tmp" || true
  cat "$f.tmp" > "$f" && rm -f "$f.tmp"
  echo "APPLE_MUSIC_KEY_FILE: set, but no file there; replacing it"
fi
k="$HOME/.aircheck/bridge/AuthKey.p8"
mkdir -p "$HOME/.aircheck/bridge"
(umask 077; cat > "$k.tmp")
chmod 600 "$k.tmp" && mv "$k.tmp" "$k"
[ -O "$k" ] || { echo "$k is not owned by $(id -un)" >&2; exit 1; }
printf "APPLE_MUSIC_KEY_FILE=%s\n" "$k" | add_lines' <"$P8"

echo "== Restart the bridge and check"
remote 'since="$(date "+%Y-%m-%d %H:%M:%S")"
sudo systemctl restart aircheck-bridge
for n in TAVILY_API_KEY APPLE_MUSIC_TEAM_ID APPLE_MUSIC_KEY_ID APPLE_MUSIC_KEY_FILE; do echo "$n: $(grep -c "^$n=" "$f") line(s)"; done
host="$(sed -n "s/^BRIDGE_HOST=//p" "$f")"; port="$(sed -n "s/^BRIDGE_PORT=//p" "$f")"
h=""
for _ in $(seq 1 15); do h="$(curl -s -m 5 --cacert "$HOME/.aircheck/ca/ca.crt" "https://$host:$port/healthz" || true)"; [ "$h" = ok ] && break; sleep 1; done
echo "bridge /healthz: ${h:-no answer}"
a="$(journalctl -u aircheck-bridge --since "$since" --no-pager -o cat 2>/dev/null | grep -oE "apple_music=(available|unavailable)( reason=[a-z_0-9]+)?" | tail -n 1 || true)"
echo "${a:-apple_music=unknown (no line yet; see journalctl -u aircheck-bridge -n 20)}"' </dev/null
