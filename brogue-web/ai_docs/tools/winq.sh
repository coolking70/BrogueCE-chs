#!/bin/bash
# Windows 执行方队列（192.168.0.106，E:\bench；worker.ps1 须由用户在桌面启动）
# 用法：winq.sh send <id> <task-book-rel-path> [model] [effort] | status <id> | fetch <id> [base]
# 工作文件放 ~/.cache/brogue-winq（/private/tmp 重启会被清空）
R=/Users/coolking70/Documents/同步空间/brogue; S=$HOME/.cache/brogue-winq
H=coolking@192.168.0.106; SSH="ssh -o BatchMode=yes -o ConnectTimeout=10"
case "$1" in
 send)
  id=$2; book=$3; model=${4:-gpt-6-sol}; effort=${5:-medium}; base=$(git -C $R rev-parse HEAD)
  mkdir -p $S/$id && git -C $R bundle create $S/$id/bundle main >/dev/null 2>&1
  printf '请阅读并执行 %s 中的任务。规格以任务书 §0 引用的 X-0 勘察报告条目为准。报告写到任务书指定的路径。完成后不要提交 git。' "$book" > $S/$id/prompt.txt
  printf '{"model":"%s","effort":"%s","base":"%s"}' "$model" "$effort" "$base" > $S/$id/meta.json
  $SSH $H "mkdir E:\\bench\\queue\\$id 2>nul & echo ok" < /dev/null >/dev/null
  scp -q -o BatchMode=yes $S/$id/bundle $S/$id/prompt.txt $S/$id/meta.json $H:E:/bench/queue/$id/ && \
  $SSH $H "type nul > E:\\bench\\queue\\$id\\ready" < /dev/null && echo "sent $id base=$base model=$model/$effort";;
 status) $SSH $H "type E:\\bench\\queue\\$2\\done.json 2>nul & type E:\\bench\\worker.log 2>nul" < /dev/null | tail -6;;
 fetch)
  id=$2; mkdir -p $S/$id/out
  if [ -n "$3" ]; then base=$3; else
    scp -q -o BatchMode=yes "$H:E:/bench/queue/$id/meta.json" $S/$id/meta.json 2>/dev/null
    base=$(python3 -c "import json,codecs;print(json.load(codecs.open('$S/$id/meta.json','r','utf-8-sig'))['base'])"); fi
  $SSH $H "cd /d E:\\bench\\work\\$id && git add -A && git diff --cached --binary $base --output=E:\\bench\\queue\\$id\\result.patch" < /dev/null
  scp -q -o BatchMode=yes "$H:E:/bench/queue/$id/result.patch" "$H:E:/bench/queue/$id/last.txt" "$H:E:/bench/queue/$id/done.json" $S/$id/out/ && ls -la $S/$id/out;;
esac
