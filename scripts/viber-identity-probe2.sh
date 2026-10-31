#!/bin/bash
# Decisive test: launch TWO isolated (logged-out) Viber instances, wait until each
# initializes its profile, then compare device-identity sources (config.db, group
# containers, shared plist) to see whether identity is per-instance or shared.
set -uo pipefail
OUT=audit-results/viber-identity2.txt
mkdir -p audit-results
: > "$OUT"
say(){ echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$OUT"; }

VIBER=/Applications/Viber.app
if [ ! -d "$VIBER" ]; then
  for url in https://download.cdn.viber.com/desktop/mac_10_14/Viber.dmg https://download.viber.com/desktop/mac/online/Viber.dmg; do
    if curl -sS -L --retry 3 --retry-delay 2 --connect-timeout 30 --max-time 900 -o /tmp/Viber.dmg "$url" && [ "$(stat -f%z /tmp/Viber.dmg 2>/dev/null || echo 0)" -gt 1024 ]; then
      MNT=$(mktemp -d)
      if hdiutil attach -nobrowse -readonly -mountpoint "$MNT" /tmp/Viber.dmg >/dev/null 2>&1; then
        APP=$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)
        [ -n "$APP" ] && cp -R "$APP" /Applications/
        hdiutil detach "$MNT" -force >/dev/null 2>&1 || true
      fi
      [ -d "$VIBER" ] && break
    fi
  done
fi

W=$(mktemp -d)
HA="$W/a/home"; TA="$W/a/tmp"
HB="$W/b/home"; TB="$W/b/tmp"
mkdir -p "$HA" "$TA" "$HB" "$TB"

say "launch A"
HOME="$HA" CFFIXED_USER_HOME="$HA" TMPDIR="$TA/" "$VIBER/Contents/MacOS/Viber" >/dev/null 2>&1 &
PA=$!
say "launch B"
HOME="$HB" CFFIXED_USER_HOME="$HB" TMPDIR="$TB/" "$VIBER/Contents/MacOS/Viber" >/dev/null 2>&1 &
PB=$!

say "waiting for both profiles to initialize (config.db present)..."
DBA=""; DBB=""
deadline=$((SECONDS + 600))
while [ $SECONDS -lt $deadline ]; do
  [ -z "$DBA" ] && DBA=$(find "$HA" -name config.db 2>/dev/null | head -1)
  [ -z "$DBB" ] && DBB=$(find "$HB" -name config.db 2>/dev/null | head -1)
  if [ -n "$DBA" ] && [ -n "$DBB" ]; then break; fi
  sleep 10
done
say "A alive=$(kill -0 $PA 2>/dev/null && echo yes || echo no) db=${DBA:-none}"
say "B alive=$(kill -0 $PB 2>/dev/null && echo yes || echo no) db=${DBB:-none}"

# give a little more time for plist/group-container writes, then kill
sleep 20
kill "$PA" "$PB" 2>/dev/null || true
sleep 4

say "=== A profile tree (viber-related) ==="
find "$HA" -maxdepth 6 \( -iname '*viber*' -o -name 'config.db' \) 2>/dev/null | tee -a "$OUT"
say "=== B profile tree (viber-related) ==="
find "$HB" -maxdepth 6 \( -iname '*viber*' -o -name 'config.db' \) 2>/dev/null | tee -a "$OUT"

dumpdb(){
  local tag="$1" db="$2"
  say "=== [$tag] config.db ($(stat -f%z "$db" 2>/dev/null||echo 0) bytes) ==="
  if [ -f "$db" ]; then
    sqlite3 "$db" ".tables" 2>&1 | tee -a "$OUT"
    sqlite3 "$db" ".dump" 2>&1 | head -120 | tee -a "$OUT"
  fi
}
dumpdb A "$DBA"
dumpdb B "$DBB"

say "=== shared real-domain after two instances ==="
find "$HOME/Library/Group Containers" "$HOME/Library/Containers" "$HOME/Library/Application Support" "$HOME/Library/Preferences" -maxdepth 3 -iname '*viber*' 2>/dev/null | tee -a "$OUT"
say "--- real plist ---"
plutil -p "$HOME/Library/Preferences/com.viber.osx.plist" 2>&1 | tee -a "$OUT"
say "--- group containers ---"
for g in "vgroup.com.viber.osx" "vgroup.com.viber.osx.macvibershare"; do
  d="$HOME/Library/Group Containers/$g"
  if [ -d "$d" ]; then say "### $g ###"; find "$d" -maxdepth 4 2>/dev/null | tee -a "$OUT"; else say "### $g ### (not present)"; fi
done

say DONE
