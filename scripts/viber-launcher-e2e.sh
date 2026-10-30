#!/bin/bash
# End-to-end: GUI launcher (same code path as the "按数量启动" button) -> N real Viber instances.
# Verifies: N processes alive, each on its own ~/ViberMulti/profiles/<id>, keep-alive revive, screenshot.
set -uo pipefail
cd "$(dirname "$0")/.."

AUTO="${AUTO:-4}"
OUT_DIR=audit-results
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/e2e-run.log"
: > "$LOG"
say() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }

VIBER=/Applications/Viber.app/Contents/MacOS/Viber
SHOT=launcher-e2e.png
INSTALL_SRC="preinstalled"
T0=$SECONDS

say "== install =="
if [ ! -x "$VIBER" ]; then
  INSTALL_SRC=""
  for url in \
    https://download.cdn.viber.com/desktop/mac_10_14/Viber.dmg \
    https://download.cdn.viber.com/desktop/mac_10_13/Viber.dmg \
    https://download.viber.com/desktop/mac/online/Viber.dmg; do
    say "download $url"
    if curl -sS -L --retry 4 --retry-delay 3 --connect-timeout 30 --max-time 900 -o /tmp/Viber.dmg "$url"; then
      size=$(stat -f%z /tmp/Viber.dmg 2>/dev/null || echo 0)
      say "downloaded bytes=$size"
      if [ "$size" -gt 1024 ]; then
        MNT=$(mktemp -d)
        if hdiutil attach -nobrowse -readonly -mountpoint "$MNT" /tmp/Viber.dmg >>"$LOG" 2>&1; then
          APP=$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)
          say "mounted app: $APP"
          if [ -n "$APP" ]; then cp -R "$APP" /Applications/ >>"$LOG" 2>&1 || true; fi
          hdiutil detach "$MNT" -force >>"$LOG" 2>&1 || true
        fi
        [ -x "$VIBER" ] && { INSTALL_SRC="$url"; break; }
      fi
    fi
  done
else
  say "Viber already installed"
fi
xattr -dr com.apple.quarantine /Applications/Viber.app >>"$LOG" 2>&1 || true
VIBER_OK=no; [ -x "$VIBER" ] && VIBER_OK=yes
say "viber executable: $VIBER_OK (source: ${INSTALL_SRC:-none})"

say "== build launcher =="
bash ./launcher/build.sh >>"$LOG" 2>&1
LAUNCHER=launcher/build/ViberLauncher.app/Contents/MacOS/ViberLauncher
LAUNCHER_OK=no; [ -x "$LAUNCHER" ] && LAUNCHER_OK=yes
say "launcher built: $LAUNCHER_OK"

if [ "$VIBER_OK" != "yes" ] || [ "$LAUNCHER_OK" != "yes" ]; then
  say "abort: prerequisites missing"
  tail -40 "$LOG"
  python3 - "$OUT_DIR/launcher-e2e.json" "$VIBER_OK" "$LAUNCHER_OK" "${INSTALL_SRC:-none}" <<'PY'
import json, sys
path, viber_ok, launcher_ok, src = sys.argv[1:5]
json.dump({"verdict": "blocked", "install": {"viber_ok": viber_ok == "yes", "source": src},
           "launcher_built": launcher_ok == "yes", "errors": ["prerequisites missing"]},
          open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  exit 1
fi

say "== run launcher --auto $AUTO =="
rm -rf "$HOME/ViberMulti"
"$LAUNCHER" --auto "$AUTO" >/tmp/launcher.out 2>&1 &
LPID=$!
say "launcher pid=$LPID"

count=0
deadline=$((SECONDS + 600))
while [ $SECONDS -lt $deadline ]; do
  count=$(pgrep -f "$VIBER" | wc -l | tr -d ' ')
  say "viber processes: $count"
  [ "$count" -ge "$AUTO" ] && break
  sleep 10
done
BOOT_SECONDS=$((SECONDS - T0))
say "boot phase done in ${BOOT_SECONDS}s with count=$count"

sleep 20
swift scripts/windowcount.swift >/tmp/windows.txt 2>>"$LOG" || true
say "windows: $(tr '\n' ';' </tmp/windows.txt)"

: >/tmp/pids.txt
for pid in $(pgrep -f "$VIBER" | sort -n); do
  prof=$(lsof -p "$pid" -Fn 2>/dev/null | grep -o "$HOME/ViberMulti/profiles/[A-Za-z0-9-]*" | head -1)
  wins=$(awk -v p="$pid" '$1==p{print $2}' /tmp/windows.txt | head -1)
  echo "$pid ${prof:-none} ${wins:-0}" >>/tmp/pids.txt
done
cat /tmp/pids.txt >>"$LOG"
COUNT_BEFORE=$(pgrep -f "$VIBER" | wc -l | tr -d ' ')

say "== keep-alive: kill one instance =="
VICTIM=$(pgrep -f "$VIBER" | sort -n | head -1)
if [ -n "${VICTIM:-}" ]; then
  kill -9 "$VICTIM" 2>/dev/null || true
  say "killed pid=$VICTIM"
  sleep 5
  REVIVED=no
  deadline=$((SECONDS + 180))
  while [ $SECONDS -lt $deadline ]; do
    c=$(pgrep -f "$VIBER" | wc -l | tr -d ' ')
    if [ "$c" -ge "$AUTO" ]; then REVIVED=yes; break; fi
    sleep 5
  done
  COUNT_AFTER=$(pgrep -f "$VIBER" | wc -l | tr -d ' ')
  say "revived=$REVIVED count_after=$COUNT_AFTER"
else
  REVIVED=no; COUNT_AFTER=0
  say "no victim found"
fi

swift scripts/windowcount.swift >/tmp/windows2.txt 2>>"$LOG" || true
sleep 3
screencapture -x "$SHOT" >>"$LOG" 2>&1 || true
SHOT_SHA=$(shasum -a 256 "$SHOT" 2>/dev/null | awk '{print $1}')
say "screenshot: $SHOT sha256=${SHOT_SHA:-none}"

{
  echo "--- launcher stdout ---"; tail -20 /tmp/launcher.out
  echo "--- launcher stderr ---"; tail -20 /tmp/launcher.err 2>/dev/null
  echo "--- accounts.json ---"; cat "$HOME/ViberMulti/accounts.json" 2>/dev/null | head -c 1200
  echo; echo "--- windows after revive ---"; cat /tmp/windows2.txt
} >>"$LOG" 2>&1

pkill -f "$VIBER" >>"$LOG" 2>&1 || true
kill "$LPID" >>"$LOG" 2>&1 || true

python3 - "$OUT_DIR/launcher-e2e.json" "$AUTO" "$VIBER_OK" "${INSTALL_SRC:-none}" "$COUNT_BEFORE" \
  "$REVIVED" "$COUNT_AFTER" "${VICTIM:-0}" "$BOOT_SECONDS" "${SHOT_SHA:-none}" "$LPID" <<'PY'
import json, os, sys
path, auto, viber_ok, src, before, revived, after, victim, boot, shot_sha, lpid = sys.argv[1:12]
rows = []
for line in open("/tmp/pids.txt", encoding="utf-8"):
    parts = line.split()
    if len(parts) >= 3:
        rows.append({"pid": int(parts[0]), "profile": parts[1], "windows": int(parts[2])})
profiles = [r["profile"] for r in rows if r["profile"] != "none"]
state = {}
try:
    state = json.load(open(os.path.expanduser("~/ViberMulti/accounts.json"), encoding="utf-8"))
except Exception:
    pass
ev = {
    "verdict": {},
    "launcher": {"auto_arg": int(auto), "build_ok": viber_ok == "yes",
                 "boot_seconds": int(boot), "accounts_in_state": len(state.get("accounts", [])),
                 "target_in_state": state.get("target"), "keep_alive_in_state": state.get("keepAlive")},
    "install": {"viber_ok": viber_ok == "yes", "source": src},
    "processes": {"count_before": int(before), "rows": rows,
                  "distinct_profiles": len(set(profiles)),
                  "all_under_vibermulti": all("/ViberMulti/profiles/" in p for p in profiles) if profiles else False,
                  "instances_with_window": sum(1 for r in rows if r["windows"] > 0),
                  "windows_total": sum(r["windows"] for r in rows)},
    "keepalive": {"victim_pid": int(victim), "revived": revived == "yes", "count_after": int(after)},
    "screenshot_sha256": shot_sha,
    "errors": [],
}
p = ev["processes"]
ev["verdict"] = {
    "instances_requested": int(auto),
    "instances_running": p["count_before"],
    "profiles_separate": p["distinct_profiles"] >= min(int(auto), p["count_before"]),
    "all_windows_present": p["instances_with_window"] >= min(int(auto), p["count_before"]),
    "keepalive_works": ev["keepalive"]["revived"],
}
json.dump(ev, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(json.dumps(ev["verdict"], ensure_ascii=False))
PY
say "evidence: $OUT_DIR/launcher-e2e.json"
