#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

APP="build/ViberLauncher.app"
rm -rf build
mkdir -p "$APP/Contents/MacOS"

swiftc -O -whole-module-optimization \
    -o "$APP/Contents/MacOS/ViberLauncher" \
    ViberLauncher.swift \
    -framework SwiftUI -framework AppKit

cp Info.plist "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" >/dev/null 2>&1 || echo "warn: ad-hoc codesign failed (app still runnable locally)"

ditto -c -k --keepParent "$APP" ViberLauncher.zip
echo "built: $APP"
echo "zip:   $(pwd)/ViberLauncher.zip"
