#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/BrogueCE-master/src"
ZH_JSON="$ROOT_DIR/BrogueCE-master/bin/assets/zh_CN.json"
OUT_JSON="${1:-$ROOT_DIR/BrogueCE-master/bin/assets/zh_CN.visible.todo.json}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if ! command -v rg >/dev/null 2>&1; then
  echo "error: rg is required" >&2
  exit 1
fi

# Focus on player-facing modules first.
TARGETS=(
  "$SRC_DIR/brogue/IO.c"
  "$SRC_DIR/brogue/MainMenu.c"
  "$SRC_DIR/brogue/RogueMain.c"
  "$SRC_DIR/brogue/Items.c"
  "$SRC_DIR/brogue/Combat.c"
  "$SRC_DIR/platform/main.c"
)

rg --no-filename -oP '"(?:[^"\\]|\\.)*[A-Za-z](?:[^"\\]|\\.)*"' "${TARGETS[@]}" -S \
  | sed -E 's/^"//; s/"$//' \
  | sed -E '/^#include /d' \
  | sed -E '/^[A-Za-z0-9_\/.+-]+\.(h|c|png|txt|json|md|otf|ttf)$/d' \
  | sed -E '/^[A-Za-z_][A-Za-z0-9_]*$/d' \
  | LC_ALL=C grep -E '^[ -~]+$' \
  | grep -Ev '^\s*$' \
  | grep -Ev '^\s*[\-_=*#]{3,}\s*$' \
  | grep -Ev '^(Globals\.h|GlobalsBase\.h|Rogue\.h|platform\.h)$' \
  | grep -Ev '^\^v<>$' \
  | sort -u > "$TMP_DIR/all_strings.txt"

rg --no-filename -oP '^\s*"(?:[^"\\]|\\.)*"\s*:' "$ZH_JSON" -S \
  | sed -E 's/^\s*"//; s/"\s*:$//' \
  | sort -u > "$TMP_DIR/existing_keys.txt"

comm -23 "$TMP_DIR/all_strings.txt" "$TMP_DIR/existing_keys.txt" > "$TMP_DIR/missing.txt"

{
  echo "{"
  awk 'BEGIN{first=1}
  {
    gsub(/\\/, "\\\\", $0);
    gsub(/"/, "\\\"", $0);
    if (!first) printf(",\n");
    first=0;
    printf("  \"%s\": \"\"", $0);
  }
  END{printf("\n")}' "$TMP_DIR/missing.txt"
  echo "}"
} > "$OUT_JSON"

echo "Wrote: $OUT_JSON"
echo "Missing visible strings: $(wc -l < "$TMP_DIR/missing.txt" | tr -d ' ')"
