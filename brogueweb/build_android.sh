#!/usr/bin/env bash
# ==============================================================================
# build_android.sh — Brogue CE 汉化版 Android APK 一键构建脚本
#
# 用法：
#   bash build_android.sh          # 完整流程：重新编译 WASM + 同步 + 构建 APK
#   bash build_android.sh --sync   # 仅同步 dist/ → Android，跳过 WASM 编译
#   bash build_android.sh --apk    # 仅构建 APK，跳过 WASM 编译和同步
#
# 输出：
#   android/app/build/outputs/apk/debug/app-debug.apk
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BROGUE_SRC="$ROOT_DIR/BrogueCE-master"
WEB_DIST="$SCRIPT_DIR/dist"
ANDROID_DIR="$SCRIPT_DIR/android"
ANDROID_ASSETS="$ANDROID_DIR/app/src/main/assets/public"
EMSDK_DIR="$SCRIPT_DIR/emsdk"

# 颜色输出
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ==============================================================================
# 解析参数
# ==============================================================================
DO_BUILD_WASM=true
DO_SYNC=true
DO_APK=true

for arg in "$@"; do
  case "$arg" in
    --sync) DO_BUILD_WASM=false; DO_APK=false ;;
    --apk)  DO_BUILD_WASM=false; DO_SYNC=false ;;
    --help|-h)
      sed -n '2,10p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *) error "未知参数: $arg（使用 --help 查看用法）" ;;
  esac
done

echo ""
echo "========================================================"
echo "  Brogue CE 汉化版 — Android APK 构建"
echo "========================================================"
echo ""

# ==============================================================================
# 步骤 1：合并翻译文件
# ==============================================================================
if $DO_BUILD_WASM; then
  info "步骤 1/3：合并翻译文件 (zh_CN.todo.json → zh_CN.merged.json)"
  MERGE_SCRIPT="$SCRIPT_DIR/i18n/merge_translations.sh"
  if [[ -f "$MERGE_SCRIPT" ]]; then
    bash "$MERGE_SCRIPT"
    success "翻译合并完成"
  else
    warn "未找到 merge_translations.sh，跳过翻译合并"
  fi
fi

# ==============================================================================
# 步骤 2：编译 WASM（用 Emscripten）
# ==============================================================================
if $DO_BUILD_WASM; then
  info "步骤 2/3：用 Emscripten 编译 WASM"

  # 激活 emsdk 环境
  if [[ -d "$EMSDK_DIR" ]]; then
    export PATH="$EMSDK_DIR/upstream/emscripten:$PATH"
    # 尝试自动找 node
    NODE_DIR=$(find "$EMSDK_DIR/node" -maxdepth 1 -type d -name "*_64bit" 2>/dev/null | sort | tail -1)
    [[ -n "$NODE_DIR" ]] && export PATH="$NODE_DIR/bin:$PATH"
  fi

  if ! command -v emcc >/dev/null 2>&1; then
    error "emcc 未找到。请先安装/激活 Emscripten：\n  source $EMSDK_DIR/emsdk_env.sh"
  fi

  info "  emcc 版本：$(emcc --version | head -1)"
  bash "$SCRIPT_DIR/build_web.sh"
  success "WASM 编译完成 → $WEB_DIST/"
else
  info "步骤 1/3：跳过 WASM 编译（--sync 或 --apk 模式）"
fi

# ==============================================================================
# 步骤 3：同步 dist/ → Android assets
# ==============================================================================
if $DO_SYNC; then
  info "步骤 2/3：同步 Web 文件到 Android 资产目录"

  [[ -d "$WEB_DIST" ]] || error "dist/ 目录不存在：$WEB_DIST\n请先运行完整构建（不带参数）生成 WASM"
  [[ -d "$ANDROID_ASSETS" ]] || error "Android 资产目录不存在：$ANDROID_ASSETS"

  # 只同步游戏文件，保留 Capacitor 专用的 cordova*.js
  SYNC_FILES=(index.html index-mobile.html index.js index.wasm index.data)
  SYNCED=0
  SKIPPED=0

  for f in "${SYNC_FILES[@]}"; do
    SRC="$WEB_DIST/$f"
    DST="$ANDROID_ASSETS/$f"
    if [[ ! -f "$SRC" ]]; then
      warn "  dist/ 中缺少 $f，跳过"
      (( SKIPPED++ )) || true
      continue
    fi
    # 比较大小+时间戳，无变化则跳过
    if [[ -f "$DST" ]] && \
       [[ "$(stat -f%z "$SRC" 2>/dev/null || stat -c%s "$SRC")" == "$(stat -f%z "$DST" 2>/dev/null || stat -c%s "$DST")" ]] && \
       [[ "$SRC" -ot "$DST" || "$SRC" -nt "$DST" && \
          "$(md5 -q "$SRC" 2>/dev/null || md5sum "$SRC" | cut -d' ' -f1)" == \
          "$(md5 -q "$DST" 2>/dev/null || md5sum "$DST" | cut -d' ' -f1)" ]]; then
      info "  $f — 无变化，跳过"
      (( SKIPPED++ )) || true
      continue
    fi
    cp "$SRC" "$DST"
    SIZE=$(du -sh "$DST" | cut -f1)
    info "  已复制 $f  ($SIZE)"
    (( SYNCED++ )) || true
  done

  success "同步完成：$SYNCED 个文件已更新，$SKIPPED 个无变化"
else
  info "步骤 2/3：跳过文件同步（--apk 模式）"
fi

# ==============================================================================
# 步骤 4：Gradle 构建 APK
# ==============================================================================
if $DO_APK; then
  info "步骤 3/3：Gradle 构建 Debug APK"

  # 优先使用 Android Studio 内置 JDK 21，其次用系统 Java
  AS_JBR="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  if [[ -d "$AS_JBR" ]]; then
    export JAVA_HOME="$AS_JBR"
    export PATH="$JAVA_HOME/bin:$PATH"
    info "  使用 Android Studio 内置 JDK：$(java -version 2>&1 | head -1)"
  elif ! command -v java >/dev/null 2>&1; then
    error "未找到 Java。请安装 JDK 21+：\n  brew install --cask temurin@21"
  else
    JAVA_VER=$(java -version 2>&1 | head -1)
    info "  Java：$JAVA_VER"
  fi

  # 检查 Android SDK
  ANDROID_HOME="${ANDROID_HOME:-/Users/$(whoami)/Library/Android/sdk}"
  if [[ ! -d "$ANDROID_HOME" ]]; then
    error "Android SDK 未找到（ANDROID_HOME=$ANDROID_HOME）\n请安装 Android Studio 后重试"
  fi
  info "  Android SDK：$ANDROID_HOME"

  # 写入 local.properties（确保 sdk.dir 正确）
  echo "sdk.dir=$ANDROID_HOME" > "$ANDROID_DIR/local.properties"

  GRADLEW="$ANDROID_DIR/gradlew"
  [[ -f "$GRADLEW" ]] || error "gradlew 未找到：$GRADLEW"
  chmod +x "$GRADLEW"

  info "  运行 ./gradlew assembleDebug ..."
  cd "$ANDROID_DIR"
  ./gradlew assembleDebug --quiet

  APK_PATH="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
  if [[ -f "$APK_PATH" ]]; then
    APK_SIZE=$(du -sh "$APK_PATH" | cut -f1)
    echo ""
    echo "========================================================"
    success "APK 构建成功！"
    echo "  路径：$APK_PATH"
    echo "  大小：$APK_SIZE"
    echo "========================================================"
    echo ""
    echo "安装到已连接设备（如有）："
    echo "  adb install -r \"$APK_PATH\""
    echo ""
  else
    error "APK 未生成，请检查 Gradle 输出"
  fi
else
  info "步骤 3/3：跳过 APK 构建（--sync 模式）"
  echo ""
  success "完成。"
  echo ""
fi
