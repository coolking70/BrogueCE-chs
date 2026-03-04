#!/bin/bash
# Android APK Build Diagnostics and Build Helper
# Usage: bash diagnose_android_build.sh [--build]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/brogueweb/android"
DIST_DIR="$SCRIPT_DIR/brogueweb/dist"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

echo ""
echo "========================================================"
echo "  Android APK Build Diagnostics"
echo "========================================================"
echo ""

# 1. Check prerequisites
info "检查前置条件..."

if ! command -v node >/dev/null 2>&1; then
  error "Node.js not found. Install from: https://nodejs.org/"
fi
success "Node.js: $(node --version)"

if ! command -v npm >/dev/null 2>&1; then
  error "npm not found. Please install Node.js"
fi
success "npm: $(npm --version)"

if ! command -v java >/dev/null 2>&1; then
  error "Java not found. Install JDK 11+: https://adoptium.net/"
fi
success "Java: $(java -version 2>&1 | head -1)"

# 2. Check Android SDK
if [ -z "$ANDROID_HOME" ]; then
  warn "ANDROID_HOME not set. Checking common locations..."

  for SDK_PATH in \
    "$HOME/Android/Sdk" \
    "$HOME/Library/Android/sdk" \
    "/opt/android-sdk"; do
    if [ -d "$SDK_PATH" ]; then
      export ANDROID_HOME="$SDK_PATH"
      warn "Found Android SDK at: $ANDROID_HOME"
      break
    fi
  done

  if [ -z "$ANDROID_HOME" ]; then
    error "Android SDK not found. Install Android Studio: https://developer.android.com/studio"
  fi
else
  success "ANDROID_HOME: $ANDROID_HOME"
fi

if [ ! -d "$ANDROID_HOME" ]; then
  error "ANDROID_HOME directory not found: $ANDROID_HOME"
fi

# 3. Check required directories
echo ""
info "检查项目结构..."

[ -d "$DIST_DIR" ] || error "dist/ directory not found: $DIST_DIR"
success "Web dist directory: $DIST_DIR"

[ -d "$ANDROID_DIR" ] || error "android/ directory not found: $ANDROID_DIR"
success "Android project: $ANDROID_DIR"

# 4. Check web files
echo ""
info "检查编译的Web文件..."

WEB_FILES=(index.html index.js index.wasm index.data)
MISSING_FILES=()

for file in "${WEB_FILES[@]}"; do
  if [ -f "$DIST_DIR/$file" ]; then
    SIZE=$(du -h "$DIST_DIR/$file" | cut -f1)
    success "✓ $file ($SIZE)"
  else
    MISSING_FILES+=("$file")
    warn "✗ $file (missing)"
  fi
done

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
  error "Missing web files: ${MISSING_FILES[*]}"
fi

# 5. Check npm dependencies
echo ""
info "检查npm依赖..."

if [ ! -d "$SCRIPT_DIR/brogueweb/node_modules" ]; then
  warn "node_modules not found. Installing dependencies..."
  cd "$SCRIPT_DIR/brogueweb"
  npm install
  cd "$SCRIPT_DIR"
  success "Dependencies installed"
else
  success "Dependencies already installed"
fi

# 6. Sync files to Android
echo ""
info "同步Web文件到Android..."

cd "$SCRIPT_DIR/brogueweb"
npx cap sync android 2>&1 | tail -20

success "Files synced"

# 7. Check Gradle wrapper
echo ""
info "检查Gradle..."

GRADLEW="$ANDROID_DIR/gradlew"
if [ ! -f "$GRADLEW" ]; then
  error "gradlew not found: $GRADLEW"
fi

chmod +x "$GRADLEW"
success "Gradle wrapper ready"

# 8. Show Gradle version
GRADLE_VERSION=$("$GRADLEW" --version 2>&1 | head -1)
success "Gradle: $GRADLE_VERSION"

# 9. Summary
echo ""
echo "========================================================"
echo "  诊断完成"
echo "========================================================"
echo ""
echo "所有检查通过！现在可以编译APK。"
echo ""

# If --build flag provided, proceed with build
if [ "$1" = "--build" ]; then
  echo "开始编译APK..."
  cd "$ANDROID_DIR"

  # Configure local.properties
  echo "sdk.dir=$ANDROID_HOME" > local.properties

  # Build
  "$GRADLEW" assembleDebug

  APK_PATH="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
  if [ -f "$APK_PATH" ]; then
    echo ""
    success "APK 编译成功！"
    echo "路径: $APK_PATH"
    SIZE=$(du -h "$APK_PATH" | cut -f1)
    echo "大小: $SIZE"
    echo ""
  else
    error "APK 编译失败或未找到输出文件"
  fi
else
  echo "要开始编译APK，运行："
  echo "  bash diagnose_android_build.sh --build"
  echo ""
fi
