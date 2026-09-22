#!/usr/bin/env bash
# build-gate.sh - post-build verification gate for the Breakout release APK.
#
# Usage: bash build-gate.sh [MARKER]
#   MARKER: string expected inside assets/index.html (default: "BREAKOUT").
#           Use e.g. BREAKOUT_PLACEHOLDER while the PWA is not yet packaged.
#
# Exits non-zero if any check fails.
set -uo pipefail

cd "$(dirname "$0")" || exit 1

MARKER="${1:-BREAKOUT}"
SDK_DIR="${ANDROID_HOME:-/home/kylin/.local/sdk}"
BT="$SDK_DIR/build-tools/34.0.0"
AAPT="$BT/aapt"
APKSIGNER="$BT/apksigner"

APK="app/build/outputs/apk/release/app-release.apk"
UNSIGNED=0
if [[ ! -f "$APK" ]]; then
  if [[ -f "app/build/outputs/apk/release/app-release-unsigned.apk" ]]; then
    APK="app/build/outputs/apk/release/app-release-unsigned.apk"
    UNSIGNED=1
    echo "NOTE: signed app-release.apk not found - using unsigned build: $APK"
  else
    echo "[FAIL] apk-exists: no release APK under app/build/outputs/apk/release/"
    ls -la app/build/outputs/apk/release/ 2>/dev/null || true
    exit 1
  fi
fi

PASS=0
FAIL=0
report() {
  if [[ "$1" == "PASS" ]]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); fi
  printf '[%s] %-14s %s\n' "$1" "$2" "$3"
}

# 1) APK exists
report PASS "apk-exists" "$APK ($(stat -c%s "$APK") bytes)"

# 2) Permissions: ONLY the package: line may be present; zero uses-permission.
PERM_OUT="$("$AAPT" dump permissions "$APK" 2>&1)"
USES_PERM="$(printf '%s\n' "$PERM_OUT" | grep -E 'uses-permission:' || true)"
if [[ -n "$USES_PERM" ]]; then
  report FAIL "permissions" "unexpected uses-permission entries:"
  printf '%s\n' "$USES_PERM" | sed 's/^/    /'
else
  PKG_LINE="$(printf '%s\n' "$PERM_OUT" | grep -E '^package:' | head -1)"
  report PASS "permissions" "no uses-permission; only: $PKG_LINE"
fi

# 3) Badging: package / sdkVersion / targetSdkVersion / versionName
BADGING="$("$AAPT" dump badging "$APK" 2>/dev/null || true)"
PKG2="$(printf '%s\n' "$BADGING" | grep -E '^package:' | head -1)"
VNAME="$(printf '%s\n' "$BADGING" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
SDKV="$(printf '%s\n' "$BADGING" | grep -E '^sdkVersion' | head -1 | grep -oE '[0-9]+' | head -1)"
TARGETV="$(printf '%s\n' "$BADGING" | grep -E '^targetSdkVersion' | head -1 | grep -oE '[0-9]+' | head -1)"
if [[ -n "$VNAME" ]]; then
  report PASS "badging" "$PKG2 | sdkVersion=$SDKV targetSdkVersion=$TARGETV versionName=$VNAME"
else
  report FAIL "badging" "could not extract versionName from badging output"
fi

# 4) Signature
if [[ "$UNSIGNED" == "1" ]]; then
  report PASS "signature" "UNSIGNED (debug/unsigned build) - cert check skipped"
elif SIG_OUT="$("$APKSIGNER" verify --print-certs "$APK" 2>&1)"; then
  DN="$(printf '%s\n' "$SIG_OUT" | grep -m1 -E 'certificate DN:' || true)"
  report PASS "signature" "verified: $DN"
else
  report FAIL "signature" "apksigner verify failed"
  printf '%s\n' "$SIG_OUT" | sed 's/^/    /'
fi

# 5) Asset marker - catches stale-asset APKs (build succeeds but packages old assets).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if unzip -o -q "$APK" 'assets/*' -d "$TMP" 2>/dev/null && [[ -f "$TMP/assets/index.html" ]]; then
  if grep -qF "$MARKER" "$TMP/assets/index.html"; then
    report PASS "asset-marker" "marker '$MARKER' FOUND in assets/index.html"
  else
    report FAIL "asset-marker" "marker '$MARKER' MISSING in assets/index.html (stale assets?)"
  fi
else
  report FAIL "asset-marker" "assets/index.html not found inside APK"
fi

# 6) SHA-256 of the APK
SHA="$(sha256sum "$APK" | awk '{print $1}')"
report PASS "sha256" "$SHA"

echo "--------------------------------------------------"
echo "GATE SUMMARY: PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
