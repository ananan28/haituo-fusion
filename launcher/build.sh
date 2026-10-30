#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="ViberLauncher"
APP="build/$APP_NAME.app"
DMG="ViberLauncher.dmg"

rm -rf build "$DMG" "$APP_NAME.zip"
mkdir -p "$APP/Contents/MacOS"

swiftc -O -whole-module-optimization \
    -o "$APP/Contents/MacOS/$APP_NAME" \
    ViberLauncher.swift \
    -framework SwiftUI -framework AppKit

cp Info.plist "$APP/Contents/Info.plist"
chmod +x "$APP/Contents/MacOS/$APP_NAME"
codesign --force --sign - "$APP"

ditto -c -k --keepParent "$APP" "$APP_NAME.zip"

DMGROOT="build/dmgroot"
mkdir -p "$DMGROOT"
cp -R "$APP" "$DMGROOT/"
ln -s /Applications "$DMGROOT/Applications"
hdiutil create -volname "ViberMulti" -srcfolder "$DMGROOT" -ov -format UDZO "$DMG"

echo "app: $APP"
echo "zip: $(pwd)/$APP_NAME.zip"
echo "dmg: $(pwd)/$DMG"
