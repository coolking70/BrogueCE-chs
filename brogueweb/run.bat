@echo off
REM Brogue CE 中文版 - Windows 启动脚本
REM 双击此文件即可运行游戏

setlocal enabledelayedexpansion

REM 获取脚本所在目录
cd /d "%~dp0"

REM 检查 Python 是否安装
python --version >nul 2>&1
if errorlevel 1 (
    echo 错误：未找到 Python！
    echo.
    echo 请先安装 Python（推荐 Python 3.6+）
    echo 下载地址：https://www.python.org/downloads/
    echo.
    echo 安装时请勾选"Add Python to PATH"
    echo.
    pause
    exit /b 1
)

echo.
echo ===============================================
echo   Brogue CE 中文版
echo ===============================================
echo.
echo 正在启动本地服务器...
echo.

REM 查找可用的端口（默认 8000）
set PORT=8000
for /l %%i in (8000,1,8010) do (
    netstat -ano | findstr ":%i" >nul
    if errorlevel 1 (
        set PORT=%%i
        goto port_found
    )
)

:port_found
echo 服务器地址：http://localhost:%PORT%/dist/
echo.
echo 游戏将在浏览器中自动打开...
echo 关闭此窗口可停止服务器
echo.
echo ===============================================
echo.

REM 启动服务器并打开浏览器
start http://localhost:%PORT%/dist/
timeout /t 2 /nobreak

python -m http.server %PORT%
