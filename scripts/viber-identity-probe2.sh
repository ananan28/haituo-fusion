#!/bin/bash
# Run one isolated Viber instance (no login), then inspect which REAL-domain and
# profile locations hold device identity / install id, and dump config.db schema.
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

# snapshot real-domain viber paths BEFORE launch
say "=== BEFORE: real-domain viber paths ==="
find "$HOME/Library/Group Containers" "$HOME/Library/Containers" "$HOME/Library/Application Support" "$HOME/Library/Preferences" -maxdepth 2 -iname '*viber*' 2>/dev/null | tee -a "$OUT"

W=$(mktemp -d)
H="$W/home"; T="$W/tmp"; mkdir -p "$H" "$T"
say "=== launch isolated instance (no login) ==="
HOME="$H" CFFIXED_USER_HOME="$H" TMPDIR="$T/" "$VIBER/Contents/MacOS/Viber" >/dev/null 2>&1 &
PID=$!
sleep 120
say "pid=$PID alive=$(kill -0 $PID 2>/dev/null && echo yes || echo no)"
kill "$PID" 2>/dev/null || true
sleep 4

say "=== AFTER: real-domain viber paths ==="
find "$HOME/Library/Group Containers" "$HOME/Library/Containers" "$HOME/Library/Application Support" "$HOME/Library/Preferences" -maxdepth 3 -iname '*viber*' 2>/dev/null | tee -a "$OUT"

say "=== full real plist ==="
plutil -p "$HOME/Library/Preferences/com.viber.osx.plist" 2>&1 | tee -a "$OUT"

say "=== group container contents ==="
for g in "vgroup.com.viber.osx" "vgroup.com.viber.osx.macvibershare" "group.com.viber.osx"; do
  d="$HOME/Library/Group Containers/$g"
  if [ -d "$d" ]; then
    say "### $g ###"
    find "$d" -maxdepth 4 2>/dev/null | tee -a "$OUT"
    for f in $(find "$d" -type f -maxdepth 4 2>/dev/null | head -20); do
      say "-- file: $(basename "$f") ($(stat -f%z "$f") bytes) --"
      if [ "$(stat -f%z "$f")" -lt 2000 ]; then cat "$f" 2>/dev/null | tee -a "$OUT"; echo; fi
    done
  else
    say "### $g ### (not present)"
  fi
done

say "=== container com.viber.osx ==="
find "$HOME/Library/Containers/com.viber.osx" -maxdepth 5 2>/dev/null | head -60 | tee -a "$OUT"

say "=== fake profile (isolated HOME) contents ==="
find "$H" -maxdepth 5 \( -iname '*viber*' -o -name 'config.db' -o -name '*.dat' \) 2>/dev/null | tee -a "$OUT"

say "=== config.db schema ==="
DB=$(find "$H" -name config.db 2>/dev/null | head -1)
if [ -n "$DB" ]; then
  say "db path: $DB"
  sqlite3 "$DB" ".tables" 2>&1 | tee -a "$OUT"
  sqlite3 "$DB" ".schema" 2>&1 | grep -iE "CREATE TABLE" | head -60 | tee -a "$OUT"
else
  say "no config.db found in isolated HOME"
fi

say "=== binary: identity-related path strings ==="
strings "$VIBER/Contents/MacOS/Viber" 2>/dev/null | grep -iE "Group Containers|vgroup\.com\.viber|/Containers/|IOPlatformUUID|com\.viber\.osx/" | sort -u | head -40 | tee -a "$OUT"

say DONE
