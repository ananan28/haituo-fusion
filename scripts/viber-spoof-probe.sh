#!/bin/bash
# Verify whether we can per-process spoof IOPlatformUUID that Viber reads:
#  1) check Viber code-signing flags (hardened runtime? dyld env allowed?)
#  2) build the interposer dylib + test helper
#  3) prove the hook returns a fake UUID for the test helper
#  4) inject into real Viber and confirm it still runs (no crash) and hook loaded
set -uo pipefail
OUT=audit-results/viber-spoof.txt
mkdir -p audit-results
: > "$OUT"
say(){ echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$OUT"; }
FAKE="00000000-1111-2222-3333-444444444444"

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

say "=== 1) Viber code-signing flags ==="
codesign -dv --verbose=4 "$VIBER" 2>&1 | grep -iE "flags|runtime|library|dyld|Signature|TeamIdentifier" | tee -a "$OUT"
say "--- entitlements (hardened-runtime related) ---"
codesign -d --entitlements - "$VIBER" 2>&1 | tee -a "$OUT"

say "=== 2) build dylib + helper ==="
clang -dynamiclib -o /tmp/spoof_uuid.dylib scripts/spoof_uuid.c -framework IOKit -framework CoreFoundation 2>&1 | tee -a "$OUT"
clang -o /tmp/spoof_test scripts/spoof_test.c -framework IOKit -framework CoreFoundation 2>&1 | tee -a "$OUT"
ls -l /tmp/spoof_uuid.dylib /tmp/spoof_test | tee -a "$OUT"

say "=== 3) helper WITHOUT injection (real values) ==="
/tmp/spoof_test | tee -a "$OUT"

say "=== helper WITH injection (should show $FAKE) ==="
rm -f /tmp/spoof_uuid.log
DYLD_INSERT_LIBRARIES=/tmp/spoof_uuid.dylib FAKE_IO_PLATFORM_UUID="$FAKE" /tmp/spoof_test | tee -a "$OUT"
say "--- hook log ---"
cat /tmp/spoof_uuid.log 2>/dev/null | tee -a "$OUT"

say "=== 4) inject into real Viber ==="
W=$(mktemp -d); H="$W/home"; T="$W/tmp"; mkdir -p "$H" "$T"
rm -f /tmp/spoof_uuid.log
HOME="$H" CFFIXED_USER_HOME="$H" TMPDIR="$T/" DYLD_INSERT_LIBRARIES=/tmp/spoof_uuid.dylib FAKE_IO_PLATFORM_UUID="$FAKE" "$VIBER/Contents/MacOS/Viber" >/dev/null 2>&1 &
P=$!
sleep 45
say "viber pid=$P alive=$(kill -0 $P 2>/dev/null && echo yes || echo no)"
say "--- hook log (did it load into Viber?) ---"
cat /tmp/spoof_uuid.log 2>/dev/null | tee -a "$OUT"
# does Viber process actually have our dylib mapped?
say "--- dylib mapped in Viber process? ---"
vmmap "$P" 2>/dev/null | grep -i spoof | head -3 | tee -a "$OUT"
kill "$P" 2>/dev/null || true

say DONE
