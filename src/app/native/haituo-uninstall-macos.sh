#!/bin/sh
# Complete removal of Haituo-owned locations only. Signal/WhatsApp standalone roots are never included.
set -u
bundle=${1:-}
test_root=${2:-}
if [ -n "$test_root" ]; then base="$test_root"; else base="$HOME"; sleep 2; fi
failed=0
remove_owned() { if [ -e "$1" ] || [ -L "$1" ]; then /bin/rm -rf -- "$1" || failed=1; fi; }
for name in Haituo haituo 海拓; do
 remove_owned "$base/Library/Application Support/$name"
 remove_owned "$base/Library/Caches/$name"
 remove_owned "$base/Library/Logs/$name"
done
for name in com.haituo.desktop com.haituo.desktop.ShipIt; do
 remove_owned "$base/Library/Caches/$name"
 remove_owned "$base/Library/Preferences/$name.plist"
 remove_owned "$base/Library/Saved Application State/$name.savedState"
 remove_owned "$base/Library/LaunchAgents/$name.plist"
done
if [ -z "$test_root" ]; then
 for service in '海拓 Safe Storage' 'Haituo Safe Storage' 'haituo Safe Storage'; do
  /usr/bin/security delete-generic-password -s "$service" >/dev/null 2>&1
  result=$?
  if [ "$result" -ne 0 ] && [ "$result" -ne 44 ]; then failed=1; fi
 done
fi
# Include renamed or version-suffixed installations with our bundle identifier.
for app in "$bundle" "$base/Applications/"*.app "/Applications/"*.app; do
 [ -d "$app/Contents" ] || continue
 [ -z "$test_root" ] || case "$app" in "$test_root/"*) ;; *) continue ;; esac
 id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist" 2>/dev/null || true)
 if [ "$id" = 'com.haituo.desktop' ]; then
  if [ -z "$test_root" ]; then /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$app" >/dev/null 2>&1 || true; fi
  remove_owned "$app"
 fi
done
if [ "$failed" -ne 0 ] && [ -z "$test_root" ]; then
 /usr/bin/osascript -e 'display dialog "海拓部分文件未能删除，请检查权限或退出全部海拓进程后重试。本次不视为彻底卸载成功。" buttons {"确定"} default button 1' >/dev/null 2>&1 || true
fi
if [ -z "$test_root" ]; then script_dir=$(dirname "$0"); case "$script_dir" in "${TMPDIR:-/tmp/}"haituo-uninstall-*) /bin/rm -rf -- "$script_dir" ;; esac; fi
exit "$failed"
