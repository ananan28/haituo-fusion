#!/bin/bash
# Prove per-process IOPlatformUUID spoof works against (re-signed) Viber:
#  1) build interposer dylib + helper; verify helper injection returns fake UUID
#  2) re-sign Viber ad-hoc to strip hardened runtime (preserving entitlements)
#  3) inject into re-signed Viber and confirm dylib loads and app stays alive
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

say "=== 1) build dylib + helper ==="
clang -dynamiclib -o /tmp/spoof_uuid.dylib scripts/spoof_uuid.c -framework IOKit -framework CoreFoundation 2>&1 | tee -a "$OUT"
clang -o /tmp/spoof_test scripts/spoof_test.c -framework IOKit -framework CoreFoundation 2>&1 | tee -a "$OUT"

say "=== 2) helper WITHOUT injection ==="
/tmp/spoof_test | tee -a "$OUT"

say "=== 3) helper WITH injection (expect $FAKE) ==="
rm -f /tmp/spoof_uuid.log
DYLD_INSERT_LIBRARIES=/tmp/spoof_uuid.dylib FAKE_IO_PLATFORM_UUID="$FAKE" /tmp/spoof_test | tee -a "$OUT"
say "--- hook log ---"
cat /tmp/spoof_uuid.log 2>/dev/null | tee -a "$OUT"

say "=== 4) re-sign Viber ad-hoc (strip hardened runtime, keep entitlements) ==="
codesign -d --entitlements :- "$VIBER" > /tmp/viber-ent.plist 2>/dev/null
say "entitlements extracted bytes=$(stat -f%z /tmp/viber-ent.plist 2>/dev/null || echo 0)"
codesign --force --deep --sign - --entitlements /tmp/viber-ent.plist "$VIBER" 2>&1 | tee -a "$OUT"
say "after re-sign flags:"
codesign -dv --verbose=2 "$VIBER" 2>&1 | grep -iE "flags|Signature" | tee -a "$OUT"

say "=== 4b) re-signed Viber WITHOUT injection (baseline: does re-sign alone break it?) ==="
W=$(mktemp -d); H="$W/home"; T="$W/tmp"; mkdir -p "$H" "$T"
HOME="$H" CFFIXED_USER_HOME="$H" TMPDIR="$T/" "$VIBER/Contents/MacOS/Viber" >/dev/null 2>&1 &
P0=$!
sleep 30
say "baseline pid=$P0 alive=$(kill -0 $P0 2>/dev/null && echo yes || echo no)"
kill "$P0" 2>/dev/null || true

say "=== 5) inject into re-signed Viber ==="
W=$(mktemp -d); H="$W/home"; T="$W/tmp"; mkdir -p "$H" "$T"
rm -f /tmp/spoof_uuid.log
HOME="$H" CFFIXED_USER_HOME="$H" TMPDIR="$T/" DYLD_INSERT_LIBRARIES=/tmp/spoof_uuid.dylib FAKE_IO_PLATFORM_UUID="$FAKE" "$VIBER/Contents/MacOS/Viber" >/dev/null 2>&1 &
P=$!
sleep 45
say "viber pid=$P alive=$(kill -0 $P 2>/dev/null && echo yes || echo no)"
say "--- hook log (did dylib load into Viber?) ---"
cat /tmp/spoof_uuid.log 2>/dev/null | tee -a "$OUT"
say "--- dylib mapped in Viber? ---"
vmmap "$P" 2>/dev/null | grep -i spoof | head -3 | tee -a "$OUT"
kill "$P" 2>/dev/null || true

say DONE
