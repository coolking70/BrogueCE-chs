#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/BrogueCE-master"
OUT_DIR="$ROOT_DIR/brogueweb/dist"

if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc not found. Please install/activate Emscripten first."
  echo "hint: source /path/to/emsdk/emsdk_env.sh"
  exit 1
fi

mkdir -p "$OUT_DIR"

BROGUE_SOURCES=()
while IFS= read -r file; do
  BROGUE_SOURCES+=("$file")
done < <(find "$SRC_DIR/src/brogue" -name '*.c' | sort)

VARIANT_SOURCES=()
while IFS= read -r file; do
  VARIANT_SOURCES+=("$file")
done < <(find "$SRC_DIR/src/variants" -name '*.c' | sort)

PLATFORM_SOURCES=(
  "$SRC_DIR/src/platform/main.c"
  "$SRC_DIR/src/platform/platformdependent.c"
  "$SRC_DIR/src/platform/null-platform.c"
  "$SRC_DIR/src/platform/sdl2-platform.c"
  "$SRC_DIR/src/platform/tiles.c"
)

COMMON_CFLAGS=(
  -Isrc/brogue
  -Isrc/platform
  -Isrc/variants
  -std=c99
  -Wall
  -Wpedantic
  -Werror=implicit
  -Wno-parentheses
  -Wno-unused-result
  -Wformat
  -Werror=format-security
  -Wformat-overflow=0
  -Wmissing-prototypes
  -O2
)

DEFINES=(
  -DDATADIR=.
  -DBROGUE_SDL
  -DBROGUE_UTF8_TEXT
  "-DBROGUE_EXTRA_VERSION=\"\""
)

EM_FLAGS=(
  -sUSE_SDL=2
  -sUSE_SDL_IMAGE=2
  -sUSE_SDL_TTF=2
  "-sSDL2_IMAGE_FORMATS=['png']"
  -sASYNCIFY
  -sALLOW_BLOCKING_ON_MAIN_THREAD=1
  -sALLOW_MEMORY_GROWTH=1
  -sASSERTIONS=1
  -sSTACK_SIZE=1048576
)

PRELOAD=(
  --preload-file "$SRC_DIR/bin/assets@/assets"
  --preload-file "$SRC_DIR/bin/keymap.txt@/keymap.txt"
)

if [ -f "$SRC_DIR/bin/assets/NotoSansSC-Regular.ttf" ]; then
  PRELOAD+=(--preload-file "$SRC_DIR/bin/assets/NotoSansSC-Regular.ttf@/assets/NotoSansSC-Regular.ttf")
else
  echo "warning: $SRC_DIR/bin/assets/NotoSansSC-Regular.ttf not found; Chinese glyphs will fallback."
fi

pushd "$SRC_DIR" >/dev/null

emcc \
  "${BROGUE_SOURCES[@]}" \
  "${VARIANT_SOURCES[@]}" \
  "${PLATFORM_SOURCES[@]}" \
  "${COMMON_CFLAGS[@]}" \
  "${DEFINES[@]}" \
  "${EM_FLAGS[@]}" \
  "${PRELOAD[@]}" \
  -lm \
  -o "$OUT_DIR/index.html"

popd >/dev/null

# 替换 Emscripten 生成的 HTML 为自定义全屏版本（去除多余UI、移动端优化）
CUSTOM_HTML="$(dirname "$0")/html/index.html"
if [ -f "$CUSTOM_HTML" ]; then
  cp "$CUSTOM_HTML" "$OUT_DIR/index.html"
  echo "Applied custom HTML shell: $CUSTOM_HTML"
fi

echo "Build complete: $OUT_DIR/index.html"
