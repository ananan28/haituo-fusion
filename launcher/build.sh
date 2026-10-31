#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="ViberLauncher"
APP="build/$APP_NAME.app"
DMG="ViberLauncher.dmg"

rm -rf build "$DMG" "$APP_NAME.zip"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -whole-module-optimization -parse-as-library \
    -o "$APP/Contents/MacOS/$APP_NAME" \
    ViberLauncher.swift \
    -framework SwiftUI -framework AppKit

# bundle the per-instance hardware-UUID spoof dylib (universal: x86_64 for Viber under Rosetta)
clang -arch x86_64 -arch arm64 -dynamiclib \
    -o "$APP/Contents/Resources/spoof_uuid.dylib" \
    ../scripts/spoof_uuid.c \
    -framework IOKit -framework CoreFoundation
codesign --force --sign - "$APP/Contents/Resources/spoof_uuid.dylib"

cp Info.plist "$APP/Contents/Info.plist"
chmod +x "$APP/Contents/MacOS/$APP_NAME"
codesign --force --deep --sign - "$APP"

ditto -c -k --keepParent "$APP" "$APP_NAME.zip"

DMGROOT="build/dmgroot"
mkdir -p "$DMGROOT"
cp -R "$APP" "$DMGROOT/"
ln -s /Applications "$DMGROOT/Applications"
if [ -n "${VIBER_APP_SRC:-}" ] && [ -d "$VIBER_APP_SRC" ]; then
  cp -R "$VIBER_APP_SRC" "$DMGROOT/"
  echo "bundled viber: $VIBER_APP_SRC"
fi
hdiutil create -volname "ViberMulti" -srcfolder "$DMGROOT" -ov -format UDZO "$DMG"

echo "app: $APP"
echo "zip: $(pwd)/$APP_NAME.zip"
echo "dmg: $(pwd)/$DMG"
