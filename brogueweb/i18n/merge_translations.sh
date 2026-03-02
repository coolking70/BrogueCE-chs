#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BASE_JSON="${1:-$ROOT_DIR/BrogueCE-master/bin/assets/zh_CN.json}"
PATCH_JSON="${2:-$ROOT_DIR/BrogueCE-master/bin/assets/zh_CN.todo.json}"
OUT_JSON="${3:-$ROOT_DIR/BrogueCE-master/bin/assets/zh_CN.merged.json}"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi
if [ ! -f "$BASE_JSON" ]; then
  echo "error: base json not found: $BASE_JSON" >&2
  exit 1
fi
if [ ! -f "$PATCH_JSON" ]; then
  echo "error: patch json not found: $PATCH_JSON" >&2
  exit 1
fi

jq -S -s '
  .[0] as $base
  | (.[1] | with_entries(select((.value | type) == "string" and .value != ""))) as $patch
  | $base + $patch
' "$BASE_JSON" "$PATCH_JSON" > "$OUT_JSON"

echo "Wrote: $OUT_JSON"
echo "Base entries : $(jq 'length' "$BASE_JSON")"
echo "Patch (non-empty) entries: $(jq '[to_entries[] | select(.value != "")] | length' "$PATCH_JSON")"
echo "Merged entries: $(jq 'length' "$OUT_JSON")"
