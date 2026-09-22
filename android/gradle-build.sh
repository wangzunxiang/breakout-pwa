#!/usr/bin/env bash
# Build the Breakout 999 release APK (no wrapper, fixed toolchain).
set -euo pipefail
cd "$(dirname "$0")"

export JAVA_HOME=/home/kylin/.local/jdk17
export ANDROID_HOME=/home/kylin/.local/sdk

/home/kylin/.local/gradle/gradle-8.9/bin/gradle assembleRelease --no-daemon

APK="app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$APK" ]]; then
  APK="app/build/outputs/apk/release/app-release-unsigned.apk"
fi
echo "APK: $(pwd)/$APK"
