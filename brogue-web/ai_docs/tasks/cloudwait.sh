#!/bin/bash
# 等待 Codex Cloud 任务离开 PENDING/RUNNING 态。
# 用法: cloudwait.sh <task_id> [轮询秒数=60] [上限分钟=90]
C=/Applications/ChatGPT.app/Contents/Resources/codex
T="$1"; INTERVAL="${2:-60}"; MAX_MIN="${3:-90}"
[ -z "$T" ] && { echo "用法: cloudwait.sh <task_id>"; exit 2; }
deadline=$(( $(date +%s) + MAX_MIN*60 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  S=$("$C" cloud status "$T" 2>&1 | head -1)
  case "$S" in
    *"[PENDING]"*|*"[RUNNING]"*|*"[QUEUED]"*) ;;
    *) echo "$S"; exit 0 ;;
  esac
  sleep "$INTERVAL"
done
echo "达到 ${MAX_MIN} 分钟上限，仍未结束"
