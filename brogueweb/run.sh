#!/bin/bash

# Brogue CE 中文版 - macOS 启动脚本
# 运行方式：bash run.sh 或 ./run.sh

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo "==============================================="
echo -e "  ${GREEN}Brogue CE 中文版${NC}"
echo "==============================================="
echo ""

# 检查 Python 是否安装
if ! command -v python3 &> /dev/null; then
    if ! command -v python &> /dev/null; then
        echo -e "${RED}错误：未找到 Python！${NC}"
        echo ""
        echo "请先安装 Python（推荐 Python 3.6+）"
        echo "可通过以下方式安装："
        echo ""
        echo "  1. 使用 Homebrew："
        echo "     brew install python3"
        echo ""
        echo "  2. 或访问：https://www.python.org/downloads/"
        echo ""
        exit 1
    fi
    PYTHON="python"
else
    PYTHON="python3"
fi

echo "正在启动本地服务器..."
echo ""

# 查找可用的端口（默认 8000）
PORT=8000
for i in {8000..8010}; do
    if ! lsof -Pi :$i -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        PORT=$i
        break
    fi
done

echo -e "服务器地址：${GREEN}http://localhost:$PORT/dist/${NC}"
echo ""
echo "游戏将在浏览器中自动打开..."
echo "按 Ctrl+C 可停止服务器"
echo ""
echo "==============================================="
echo ""

# 打开浏览器
sleep 2 && open "http://localhost:$PORT/dist/" &

# 启动服务器
$PYTHON -m http.server $PORT
