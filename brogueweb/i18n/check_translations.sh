#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
JSON_FILE="${1:-$ROOT_DIR/BrogueCE-master/bin/assets/zh_CN.json}"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi
if [ ! -f "$JSON_FILE" ]; then
  echo "error: json file not found: $JSON_FILE" >&2
  exit 1
fi

extract_printf_tokens() {
  # Captures common printf-style placeholders like %s, %d, %i, %hu, %0.2f, etc.
  # %% is treated as a literal percent and ignored.
  printf '%s' "$1" \
    | grep -oE '%([0-9]+\$)?[-+0#]*[0-9]*(\.[0-9]+)?(hh|h|l|ll|j|z|t|L)?[diuoxXfFeEgGaAcCsSpn]' \
    | sort || true
}

extract_template_tokens() {
  # Captures game-specific tokens such as $HESHE, $HIMHER, $HISHER
  printf '%s' "$1" | grep -oE '\$[A-Z_]+' | sort || true
}

normalize_multiset() {
  if [ -t 0 ]; then
    return
  fi
  tr '\n' '\n' | sed '/^$/d' | tr '\n' '|' | sed 's/|$//'
}

entry_count=0
untranslated_count=0
printf_mismatch_count=0
template_mismatch_count=0

while IFS= read -r row_b64; do
  entry_count=$((entry_count + 1))

  row_json="$(printf '%s' "$row_b64" | base64 --decode)"
  key="$(printf '%s' "$row_json" | jq -r '.key')"
  val="$(printf '%s' "$row_json" | jq -r '.value')"

  if [ -z "$val" ]; then
    untranslated_count=$((untranslated_count + 1))
    continue
  fi

  key_printf="$(extract_printf_tokens "$key" | normalize_multiset)"
  val_printf="$(extract_printf_tokens "$val" | normalize_multiset)"
  if [ "$key_printf" != "$val_printf" ]; then
    printf_mismatch_count=$((printf_mismatch_count + 1))
    echo "[printf-mismatch]"
    echo "  key: $key"
    echo "  val: $val"
    echo "  key tokens: ${key_printf:-<none>}"
    echo "  val tokens: ${val_printf:-<none>}"
    echo
  fi

  key_tpl="$(extract_template_tokens "$key" | normalize_multiset)"
  val_tpl="$(extract_template_tokens "$val" | normalize_multiset)"
  if [ "$key_tpl" != "$val_tpl" ]; then
    template_mismatch_count=$((template_mismatch_count + 1))
    echo "[template-mismatch]"
    echo "  key: $key"
    echo "  val: $val"
    echo "  key tokens: ${key_tpl:-<none>}"
    echo "  val tokens: ${val_tpl:-<none>}"
    echo
  fi

done < <(jq -rc 'to_entries[] | @base64' "$JSON_FILE")

echo "Checked file: $JSON_FILE"
echo "Entries: $entry_count"
echo "Untranslated (empty value): $untranslated_count"
echo "Printf mismatches: $printf_mismatch_count"
echo "Template mismatches: $template_mismatch_count"

if [ "$printf_mismatch_count" -gt 0 ] || [ "$template_mismatch_count" -gt 0 ]; then
  exit 2
fi
