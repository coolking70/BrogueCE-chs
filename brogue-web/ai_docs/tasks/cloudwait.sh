#!/bin/bash
# 等待 Codex Cloud 任务进入终态。
# 用法: cloudwait.sh <task_id> [轮询秒=60] [上限分钟=90]
#
# 2026-09-22 重写。初版有两个 bug，都让它谎报「跑完了」：
#   ① 把「非 PENDING/RUNNING 的任何输出」当成完成——而 codex cloud 的
#      get_task_details 端点会瞬时故障，报错行同样不匹配那两个词，于是误判；
#   ② 用 `codex cloud status`，该子命令在端点故障时会**挂住不返回**，
#      没有超时保护。
# 现在的口径：
#   · 只认**显式终态**（READY/FAILED/ERROR/CANCELLED/COMPLETED）；
#   · 走 `codex cloud list`（实测比 status 稳），从中 grep 本任务；
#   · 每次轮询套超时（macOS 无 timeout 命令，用后台+kill）；
#   · 取不到状态一律**继续等**，连续失败超过 MAX_MISS 次才放弃并明说；
#   · 终态需连续 2 次确认（防瞬时脏读）。

C=/Applications/ChatGPT.app/Contents/Resources/codex
T="$1"; INTERVAL="${2:-60}"; MAX_MIN="${3:-90}"
POLL_TIMEOUT=45          # 单次 list 的最长等待
MAX_MISS=10              # 连续取不到状态的容忍次数
CONFIRM=2                # 终态需连续确认次数

[ -z "$T" ] && { echo "用法: cloudwait.sh <task_id> [轮询秒] [上限分钟]"; exit 2; }

# 带超时地取一次该任务的状态行；成功回显状态词，失败回显空。
poll() {
    local out
    out=$( { "$C" cloud list 2>/dev/null & local p=$!;
             ( sleep "$POLL_TIMEOUT"; kill -9 $p 2>/dev/null ) & local k=$!;
             wait $p 2>/dev/null; kill -9 $k 2>/dev/null; } )
    # list 的格式：URL 行后跟一行 "  [STATE] 标题"
    printf '%s\n' "$out" | grep -A1 -F "$T" | grep -oE '\[[A-Z]+\]' | head -1
}

deadline=$(( $(date +%s) + MAX_MIN * 60 ))
miss=0; hits=0; last=""

while [ "$(date +%s)" -lt "$deadline" ]; do
    st=$(poll)
    if [ -z "$st" ]; then
        miss=$((miss + 1)); hits=0
        if [ "$miss" -ge "$MAX_MISS" ]; then
            echo "连续 $miss 次取不到状态（接口故障或任务 ID 有误）——停止等待，请人工确认"
            exit 3
        fi
    else
        miss=0
        case "$st" in
            '[READY]'|'[FAILED]'|'[ERROR]'|'[CANCELLED]'|'[COMPLETED]')
                if [ "$st" = "$last" ]; then
                    hits=$((hits + 1))
                    if [ "$hits" -ge "$CONFIRM" ]; then
                        echo "任务 $T 进入终态 $st（连续 $CONFIRM 次确认）"
                        exit 0
                    fi
                else
                    hits=1
                fi
                ;;
            *) hits=0 ;;   # PENDING / RUNNING / QUEUED 等非终态
        esac
        last="$st"
    fi
    sleep "$INTERVAL"
done
echo "达到 ${MAX_MIN} 分钟上限，任务仍未进入终态（最后见到：${last:-无})"
exit 1
