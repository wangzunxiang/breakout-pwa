# TASK — Android WebView shell project for the Breakout PWA (U2)

Work ONLY inside:
  /mnt/e/codex/breakout/android/
Do NOT modify anything outside android/ except creating gradle build caches in your
home dir. Do NOT build or touch the PWA source (that lives in ../web and is provided
later). Your job is the ANDROID SHELL PROJECT + build + release-signing pipeline.

## What the app is
A pure native single-Activity Android app that loads a local PWA from app assets via
WebView. ZERO permissions (no INTERNET, no network at all — that is a hard, system-level
guarantee; the PWA is fully offline). Zero third-party dependencies. No JS<->native bridge
(no addJavascriptInterface). The PWA content (index.html, css/, js/, manifest.json,
icons/, sw.js) is copied into android/app/src/main/assets/ at build time by me (Hermes)
in a later gate — for now create a minimal PLACEHOLDER so the project compiles.

## Toolchain (ALREADY INSTALLED — do not download anything)
  JAVA_HOME  = /home/kylin/.local/jdk17
  ANDROID_HOME = /home/kylin/.local/sdk   (has platforms/android-34, build-tools/34.0.0, platform-tools)
  gradle     = /home/kylin/.local/gradle/gradle-8.9/bin/gradle   (use `gradle`, NO wrapper)
Build command (verified):
  JAVA_HOME=/home/kylin/.local/jdk17 ANDROID_HOME=/home/kylin/.local/sdk \
    /home/kylin/.local/gradle/gradle-8.9/bin/gradle assembleRelease --no-daemon
Network for maven: use aliyun maven mirror (fast). dl.google.com is slow but reachable.

## Project structure (Gradle, Kotlin, AGP, no wrapper)
android/
  settings.gradle
  gradle.properties
  build.gradle                    (root)
  local.properties                (sdk.dir=/home/kylin/.local/sdk)   [must be gitignored]
  signing.properties              (gitignored; created by build script)
  .gitignore
  gradle-build.sh                 (sets JAVA_HOME/ANDROID_HOME, runs assembleRelease)
  build-gate.sh                   (the post-build verification gate — see below)
  app/
    build.gradle
    src/main/
      AndroidManifest.xml
      java/com/secops/breakout/MainActivity.kt
      res/values/strings.xml
      res/values/styles.xml
      res/mipmap-anydpi-v26/ic_launcher.xml  (adaptive icon) + res/drawable/* as needed
      res/xml/ (if needed)
      assets/
        index.html                (PLACEHOLDER now — a small valid page with a div#app and
                                  a marker string "BREAKOUT_PLACEHOLDER" so the gate can grep)
        (css/, js/, manifest.json, icons/  — I will fill real PWA here in the gate)

## Manifest — HARD REQUIREMENTS
- <uses-permission> : NONE at all. (aapt dump permissions must show only the package: line)
- allowBackup="false", android:extractNativeLibraries="false"
- single Activity, exported=true, LAUNCHER intent
- screenOrientation="portrait" (or "unspecified" — pick portrait, the game is vertical-ish;
  actually Breakout is landscape-friendly: use "sensorLandscape" OR "unspecified". 
  DECISION: use "unspecified" so it works in any orientation; the PWA is responsive.)
- usesCleartextTraffic NOT needed (no network). Do NOT add it.
- targetSdk 34, minSdk 26, compileSdk 34
- Application label = "Breakout 999"
- versionCode 1, versionName "1.0.0"

## MainActivity.kt (Kotlin) — behavior
- AppCompatActivity or plain Activity? Use android.app.Activity (no androidx, to keep zero
  third-party deps and avoid dependency download). Plain Activity it is.
- Immersive full-screen (hide system bars) + FLAG_KEEP_SCREEN_ON.
- WebView setup:
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.cacheMode = WebSettings.LOAD_NO_CACHE
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.geolocationEnabled = false
    NO addJavascriptInterface.
- shouldOverrideUrlLoading: only allow "file:///android_asset/" and "about:blank";
  otherwise cancel the load and return true.
- loadUrl("file:///android_asset/index.html")
- Lifecycle: onPause/onResume/destroy with standard WebView handling (pauseTimers/resumeTimers/destroy).
- Handle back button: if webView.canGoBack() go back, else finish. (It won't, since no nav.)
- IMPORTANT Kotlin pitfall: String.valueOf(x) does NOT compile in Kotlin (resolves to
  kotlin.String, no such static). Use x.toString() or string templates. Don't trip on this.

## gradle.properties
  android.useAndroidX=false
  org.gradle.daemon=false
  org.gradle.jvmargs=-Xmx2048m
  kotlin.code.style=official

## Root settings.gradle — repositories (aliyun first, google() fallback)
  pluginManagement + dependencyResolutionManagement with:
    maven { url "https://maven.aliyun.com/repository/public" }
    maven { url "https://maven.aliyun.com/repository/google" }
    maven { url "https://maven.aliyun.com/repository/gradle-plugin" }
    google()
    mavenCentral()
  rootProject.name = "breakout"
  include ':app'

## app/build.gradle
- com.android.application
- namespace "com.secops.breakout"
- compileSdk 34, minSdk 26, targetSdk 34
- defaultConfig applicationId "com.secops.breakout", versionCode 1, versionName "1.0.0"
- kotlin (kotlin-android plugin), compileOptions Java 17
- buildTypes.release: minifyEnabled false
- RELEASE SIGNING (see below): read signing.properties if present (storeFile, storePassword,
  keyAlias, keyPassword). If signing.properties is MISSING or storeFile doesn't exist,
  SKIP release signing config (just produce a plain release build) — do NOT fail the build.
  Use `def keystoreProps = new Properties(); def ksFile = rootProject.file('signing.properties');
  if (ksFile.exists()) { keystoreProps.load(new FileInputStream(ksFile));
    signingConfigs { release { ... } } }` pattern.

## Build scripts (make them robust; these are the pipeline artifacts)
gradle-build.sh:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "$(dirname "$0")"
  export JAVA_HOME=/home/kylin/.local/jdk17
  export ANDROID_HOME=/home/kylin/.local/sdk
  /home/kylin/.local/gradle/gradle-8.9/bin/gradle assembleRelease --no-daemon
  # print APK path

build-gate.sh — POST-BUILD VERIFICATION GATE (run after a successful build). It must:
  1. Locate the release APK: app/build/outputs/apk/release/app-release.apk (find it; if only
     unsigned app-release-unsigned.apk exists, use that and note it).
  2. aapt dump permissions <apk>  -> assert ONLY the "package:" line, zero uses-permission.
     (aapt is at /home/kylin/.local/sdk/build-tools/34.0.0/aapt)
  3. aapt dump badging <apk> | grep -E "package:|versionName|sdkVersion" -> print versionName.
  4. apksigner verify --print-certs <apk>  (at build-tools/34.0.0/apksigner). If the APK is
     unsigned (no signing.properties), print "UNSIGNED (debug/unsigned build)" and skip cert check.
  5. unzip -o -q <apk> 'assets/*' -d <tmp> and grep the extracted assets/index.html for a marker
     (parameterize the marker as $1, default "BREAKOUT"). Report found/missing — this catches
     a stale-asset APK (the #1 historical failure: build succeeds but packages old assets).
  6. sha256sum <apk> -> print it.
  The script prints PASS/FAIL per check and a final summary; exit non-zero if any hard check
  (permissions, apk existence) fails.

## keystore — create a release keystore for THIS app
  mkdir -p /home/kylin/keystore
  Create /home/kylin/keystore/breakout-release.keystore (RSA 2048, alias=breakout,
  keypass/storepass a generated strong password, validity 10000 days) using keytool
  (JAVA_HOME bin/keytool). Then write /home/kylin/.local... NO — write the keystore path +
  passwords into android/signing.properties (gitignored) so the release build signs.
  Use /home/kylin/.local/jdk17/bin/keytool.
  Format of signing.properties:
     storeFile=/home/kylin/keystore/breakout-release.keystore
     storePassword=<pass>
     keyAlias=breakout
     keyPassword=<pass>
  .gitignore MUST include: signing.properties, local.properties, .gradle/, build/, app/build/,
  *.keystore, *.apksigner, .kotlin/

## SELF-CHECK you MUST run before finishing (paste results)
1. Run the build: bash gradle-build.sh  -> must produce an APK. Paste the APK path + gradle BUILD SUCCESSFUL line.
2. Run the gate: bash build-gate.sh BREAKOUT_PLACEHOLDER -> paste full output. It must show
   permissions = package: only, versionName=1.0.0, and the placeholder marker FOUND.
3. Confirm NO uses-permission lines exist (grep the aapt permissions output).
4. List the files you created under android/.
Do NOT git commit (I handle git). Do NOT push. Do NOT modify ../web.

## Final reply (concise)
- Build result (APK path + size + BUILD SUCCESSFUL)
- build-gate.sh full output
- files created
- the release keystore location + alias (do NOT print the password in full; mask it)
- any deviations from this spec and why
