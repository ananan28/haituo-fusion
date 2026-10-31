#!/bin/bash
# Inspect Viber.app to find where it derives device identity / session storage,
# so we can tell keychain collision vs hardware fingerprint for multi-instance login.
set -uo pipefail
OUT=audit-results/viber-identity.txt
mkdir -p audit-results
: > "$OUT"
say(){ echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$OUT"; }

VIBER=/Applications/Viber.app
if [ ! -d "$VIBER" ]; then
  for url in https://download.cdn.viber.com/desktop/mac_10_14/Viber.dmg https://download.cdn.viber.com/desktop/mac_10_13/Viber.dmg https://download.viber.com/desktop/mac/online/Viber.dmg; do
    say "download $url"
    if curl -sS -L --retry 3 --retry-delay 2 --connect-timeout 30 --max-time 900 -o /tmp/Viber.dmg "$url" && [ "$(stat -f%z /tmp/Viber.dmg 2>/dev/null || echo 0)" -gt 1024 ]; then
      MNT=$(mktemp -d)
      if hdiutil attach -nobrowse -readonly -mountpoint "$MNT" /tmp/Viber.dmg >/dev/null 2>&1; then
        APP=$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)
        if [ -n "$APP" ]; then cp -R "$APP" /Applications/; fi
        hdiutil detach "$MNT" -force >/dev/null 2>&1 || true
      fi
      [ -d "$VIBER" ] && break
    fi
  done
fi

BIN="$VIBER/Contents/MacOS/Viber"
say "=== bundle ==="
say "exists: $([ -d "$VIBER" ] && echo yes || echo no)"
say "$(file "$BIN" 2>/dev/null)"

say "=== Info.plist (key fields) ==="
for k in CFBundleIdentifier CFBundleShortVersionString CFBundleVersion CFBundleURLTypes; do
  say "-- $k --"
  /usr/libexec/PlistBuddy -c "Print :$k" "$VIBER/Contents/Info.plist" 2>&1 | head -30 | tee -a "$OUT"
done

say "=== code signature entitlements ==="
codesign -d --entitlements - "$VIBER" 2>&1 | tee -a "$OUT" | head -60

say "=== frameworks (tech stack) ==="
ls "$VIBER/Contents/Frameworks" 2>/dev/null | tee -a "$OUT"

say "=== resources (first 80) ==="
ls "$VIBER/Contents/Resources" 2>/dev/null | head -80 | tee -a "$OUT"

say "=== binary string scan (identity/keychain tokens) ==="
for t in ViberPC deviceId device_id installationId installId "kSecClass" "SecItem" keychain Keychain IOPlatformUUID IOPlatformSerialNumber config.db reg.dat authToken token; do
  say "### $t ###"
  strings "$BIN" 2>/dev/null | grep -i -m 6 "$t" | tee -a "$OUT"
done

say "=== also scan Frameworks for identity strings ==="
for f in "$VIBER"/Contents/Frameworks/*.framework/*/Viber* "$VIBER"/Contents/Frameworks/*; do
  [ -f "$f" ] || continue
  hits=$(strings "$f" 2>/dev/null | grep -iE "ViberPC|deviceId|kSecClass|keychain" | head -4)
  if [ -n "$hits" ]; then
    say "-- $(basename "$f") --"
    echo "$hits" | tee -a "$OUT"
  fi
done

say "DONE"
