#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/BrogueCE-master/src"
ZH_JSON="$ROOT_DIR/BrogueCE-master/bin/assets/zh_CN.json"
OUT_JSON="${1:-$ROOT_DIR/BrogueCE-master/bin/assets/zh_CN.todo.json}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if ! command -v rg >/dev/null 2>&1; then
  echo "error: rg is required" >&2
  exit 1
fi

if [ ! -f "$ZH_JSON" ]; then
  echo "error: translation file not found: $ZH_JSON" >&2
  exit 1
fi

# 1) Collect candidate C string literals (still escaped, without quotes)
rg --no-filename -oP '"(?:[^"\\]|\\.)*[A-Za-z](?:[^"\\]|\\.)*"' \
  --glob '!**/I18n.c' \
  "$SRC_DIR/brogue" "$SRC_DIR/variants" "$SRC_DIR/platform" -S \
  | sed -E 's/^"//; s/"$//' \
  | sed -E '/^#include /d' \
  | sed -E '/^[A-Za-z0-9_\/.+-]+\.(h|c|png|txt|json|md|otf|ttf)$/d' \
  | sed -E '/^[A-Za-z_][A-Za-z0-9_]*$/d' \
  | LC_ALL=C grep -E '^[ -~]+$' \
  | sort -u > "$TMP_DIR/all_strings.txt"

# 2) Collect existing zh_CN.json keys (escaped, without quotes)
rg --no-filename -oP '^\s*"(?:[^"\\]|\\.)*"\s*:' "$ZH_JSON" -S \
  | sed -E 's/^\s*"//; s/"\s*:$//' \
  | sort -u > "$TMP_DIR/existing_keys.txt"

# 3) Diff: strings that are not yet translated in zh_CN.json
comm -23 "$TMP_DIR/all_strings.txt" "$TMP_DIR/existing_keys.txt" > "$TMP_DIR/missing.txt"

# 4) Emit JSON template
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

missing_count="$(wc -l < "$TMP_DIR/missing.txt" | tr -d ' ')"
echo "Wrote: $OUT_JSON"
echo "Missing strings: $missing_count"
