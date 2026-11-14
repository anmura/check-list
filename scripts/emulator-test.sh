#!/usr/bin/env bash
# Opens a list, sends the app to the background, lets Android kill it
# (as a phone does when it needs memory), opens it again and checks
# that the same list is shown.
set -euo pipefail
PKG=io.github.anmura.checklist
APK=android/app/build/outputs/apk/debug/app-debug.apk

adb install -r "$APK"
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
sleep 10
node scripts/cdp.mjs setup

adb shell input keyevent KEYCODE_HOME
sleep 3
adb shell am kill "$PKG"
sleep 2
if adb shell pidof "$PKG" >/dev/null; then
  echo "Process still alive, stopping it the hard way"
  adb shell am kill-all || true
fi
adb shell pidof "$PKG" || echo "App process is gone"

adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
sleep 10
node scripts/cdp.mjs check
