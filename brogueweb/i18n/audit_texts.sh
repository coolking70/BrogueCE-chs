#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/BrogueCE-master/src"
OUT_FILE="${1:-$ROOT_DIR/brogueweb/i18n/audit-report.txt}"

TARGETS=(
  "$SRC_DIR/brogue"
  "$SRC_DIR/variants"
  "$SRC_DIR/platform"
)

mkdir -p "$(dirname "$OUT_FILE")"

{
  echo "Brogue CE i18n audit"
  echo "Generated at: $(date '+%Y-%m-%d %H:%M:%S')"
  echo

  echo "[1] Approximate count of string literals with Latin chars"
  rg -n '"[^\"]*[A-Za-z][^\"]*"' "${TARGETS[@]}" -S | wc -l | awk '{print "count=" $1}'
  echo

  echo "[2] Approximate count of printf-like format placeholders"
  rg -n '%[0-9\.\-]*[sdifcuxX]' "${TARGETS[@]}" -S | wc -l | awk '{print "count=" $1}'
  echo

  echo "[3] Pronoun template placeholders (must preserve)"
  rg -n '\$HESHE|\$HIMHER|\$HISHER|\$HIMSELFHERSELF' "$SRC_DIR/brogue" "$SRC_DIR/variants" -S | wc -l | awk '{print "count=" $1}'
  echo

  echo "[4] Top files by translatable-string density"
  rg -n '"[^\"]*[A-Za-z][^\"]*"' "${TARGETS[@]}" -S \
    | awk -F: '{print $1}' \
    | sort | uniq -c | sort -nr | head -n 30
  echo

  echo "[5] Hot spots that are layout-sensitive"
  rg -n 'strLenWithoutEscapes|wrapText\(|printString\(' "$SRC_DIR/brogue" -S | head -n 120
  echo

  echo "[6] UTF-8 blockers in input/render path"
  rg -n 'SDL_TEXTINPUT|event.text.text\[0\]|fontIndex\(|plotCharToBuffer\(|glyphToUnicode' "$SRC_DIR/platform" "$SRC_DIR/brogue" -S | head -n 120
} > "$OUT_FILE"

echo "Wrote: $OUT_FILE"
