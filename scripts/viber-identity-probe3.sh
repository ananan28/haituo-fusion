#!/bin/bash
# Dump the shared real-domain container + grep binary for DeviceKey generation source.
set -uo pipefail
OUT=audit-results/viber-identity3.txt
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

W=$(mktemp -d); H="$W/home"; T="$W/tmp"; mkdir -p "$H" "$T"
say "launch isolated instance"
HOME="$H" CFFIXED_USER_HOME="$H" TMPDIR="$T/" "$VIBER/Contents/MacOS/Viber" >/dev/null 2>&1 &
P=$!
deadline=$((SECONDS + 400))
while [ $SECONDS -lt $deadline ]; do
  [ -n "$(find "$H" -name config.db 2>/dev/null | head -1)" ] && break
  sleep 10
done
sleep 15
kill "$P" 2>/dev/null || true
sleep 4

say "=== real-domain Containers (viber-related), recursive ==="
for c in "$HOME/Library/Containers"/*viber*; do
  [ -e "$c" ] || continue
  say "### $(basename "$c") ###"
  find "$c" -maxdepth 6 2>/dev/null | tee -a "$OUT"
  for f in $(find "$c" -type f -maxdepth 6 2>/dev/null | head -30); do
    sz=$(stat -f%z "$f" 2>/dev/null || echo 0)
    say "-- $(basename "$f") ($sz bytes) --"
    if [ "$sz" -lt 3000 ] && [ "$sz" -gt 0 ]; then cat "$f" 2>/dev/null | tee -a "$OUT"; echo; fi
  done
done

say "=== also check Group Containers dir (any viber) ==="
find "$HOME/Library/Group Containers" -maxdepth 3 2>/dev/null | grep -i viber | tee -a "$OUT"

say "=== binary: DeviceKey / DownloadID / machine-id generation ==="
strings "$VIBER/Contents/MacOS/Viber" 2>/dev/null | grep -iE "DeviceKey|DownloadID|machineId|MachineId|getMachineId|hardwareId|createUuid|QUuid|IOPlatformUUID|macvibershare|installationId" | sort -u | head -60 | tee -a "$OUT"

say DONE
