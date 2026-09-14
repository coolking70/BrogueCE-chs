#!/bin/bash
# zcode headless runner — 供 Claude 编排 P1 循环使用
# 用法: zrun.sh <prompt文件> <cwd> <mode> [disallowed-tools] [--resume sess_xxx]
set -uo pipefail
KERNEL=/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
PINNED_VERSION=0.16.5
export AI_SDK_LOG_WARNINGS=false

# 版本漂移闸门：config schema 是社区逆向的，升级可能失效
ACTUAL=$(node "$KERNEL" --version 2>/dev/null | tr -d '[:space:]')
if [ "$ACTUAL" != "$PINNED_VERSION" ]; then
  echo "ABORT: 内核版本 $ACTUAL != 锚定的 $PINNED_VERSION，config schema 可能已失效。停下来人工确认。" >&2
  exit 90
fi

PROMPT_FILE="$1"; CWD="$2"; MODE="$3"; DENY="${4:-}"; shift 3; [ $# -gt 0 ] && shift
OUT="${ZRUN_OUT:-/tmp/zrun-last.json}"

# 前置注入项目常识（无状态会话不继承跨轮认知）
CONV="$CWD/ai_docs/project_conventions.md"
if [ -f "$CONV" ]; then
  FULL_PROMPT="$(printf '=== 项目常识（每轮必读，来自 ai_docs/project_conventions.md）===\n\n%s\n\n=== 本轮任务 ===\n\n%s' "$(cat "$CONV")" "$(cat "$PROMPT_FILE")")"
else
  echo "WARN: 未找到 $CONV，本轮未注入项目常识" >&2
  FULL_PROMPT="$(cat "$PROMPT_FILE")"
fi

ARGS=(--prompt "$FULL_PROMPT" --cwd "$CWD" --mode "$MODE" --json)
[ -n "$DENY" ] && ARGS+=(--disallowed-tools "$DENY")
[ $# -gt 0 ] && ARGS+=("$@")

node "$KERNEL" "${ARGS[@]}" 2>/dev/null | sed -n '/^{/,$p' > "$OUT"
RC=$?

python3 - "$OUT" <<'PY'
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception as e: print("PARSE_FAIL:",e); sys.exit(91)
u=d.get('usage',{})
print("sessionId =", d.get('sessionId'))
print("status    =", d.get('projection',{}).get('status'))
print("turns     =", d.get('projection',{}).get('turnCount'))
print("tokens    = in %s / out %s / total %s" % (u.get('inputTokens'),u.get('outputTokens'),u.get('totalTokens')))
print("--- response ---")
print(d.get('response',''))
PY
exit $RC
