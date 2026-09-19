#!/bin/bash
# zcode headless runner — 供 Claude 编排 P1 循环使用
# 用法: zrun.sh <prompt文件> <cwd> <mode> [disallowed-tools] [--resume sess_xxx]
set -uo pipefail
# 2026-09-19：内核直接跑会报「无法定位 CLI ZCode Built-in Provider Config」。
# 成因不是环境变量，是内核写死的相对推导与 app 实际布局对不上：
#   r = dirname(resolve(entrypoint))                       → .../Resources/glm
#   候选1 = r/provider/zcode-builtin.json                  → 不存在
#   候选2 = resolve(r, "../../../../../config/provider/…") → 往上 5 级跳出根，成了 /config/…
# 实际文件在 Resources/config/provider/。垫片目录复刻内核预期的布局
# （两个软链，不改 app 包），使候选1 命中。重装 ZCode 后需重建：
#   mkdir -p ~/.zcode-cli-shim/provider
#   ln -s /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs ~/.zcode-cli-shim/
#   ln -s /Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json ~/.zcode-cli-shim/provider/
KERNEL="$HOME/.zcode-cli-shim/zcode.cjs"
[ -e "$KERNEL" ] || KERNEL=/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
PINNED_VERSION=0.16.5
export AI_SDK_LOG_WARNINGS=false

# 版本漂移闸门：config schema 是社区逆向的，升级可能失效
ACTUAL=$(node "$KERNEL" --version 2>/dev/null | tr -d '[:space:]')
if [ "$ACTUAL" != "$PINNED_VERSION" ]; then
  echo "ABORT: 内核版本 $ACTUAL != 锚定的 $PINNED_VERSION，config schema 可能已失效。停下来人工确认。" >&2
  exit 90
fi

PROMPT_FILE="$1"; CWD="$2"; MODE="$3"; DENY="${4:-}"; shift 3; [ $# -gt 0 ] && shift

# mode 白名单闸门：内核只认这四个值。传别的（例如按 Claude Code 习惯写
# acceptEdits）内核会直接退出且不吐 JSON，于是下游 PARSE_FAIL 报的是
# "Expecting value: line 1 column 1"——与**配额耗尽**的报错字符串一模一样，
# 极易误判成撞了 5 小时上限。2026-09-17 投 B-3 时真踩过一次。
case "$MODE" in
  build|edit|plan|yolo) ;;
  *) echo "ABORT: --mode '$MODE' 不是内核认的值。只能是 build / edit / plan / yolo。" >&2
     echo "       （注意：这不是配额问题。传错 mode 的 PARSE_FAIL 与配额耗尽同字符串。）" >&2
     exit 92 ;;
esac
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
