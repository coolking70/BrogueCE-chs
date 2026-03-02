#!/bin/bash

# Brogue CE 安卓构建 - 快速设置脚本
# 使用方法: bash setup-android.sh

set -e

echo "=========================================="
echo "  Brogue CE 中文版 - 安卓APK构建"
echo "=========================================="
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js"
    echo "请访问 https://nodejs.org/ 安装 Node.js 14 或更高版本"
    exit 1
fi
echo "✅ Node.js: $(node --version)"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到 npm"
    exit 1
fi
echo "✅ npm: $(npm --version)"

# 检查 Java
if ! command -v java &> /dev/null; then
    echo "❌ 错误: 未找到 Java JDK"
    echo "请访问 https://www.oracle.com/java/technologies/downloads/ 安装 JDK 11 或更高版本"
    exit 1
fi
echo "✅ Java: $(java -version 2>&1 | head -n 1)"

# 检查 Android SDK
if [ -z "$ANDROID_HOME" ]; then
    echo "⚠️  警告: ANDROID_HOME 环境变量未设置"
    echo "请设置环境变量指向 Android SDK 位置"
    echo "macOS: export ANDROID_HOME=~/Library/Android/sdk"
    echo "Linux: export ANDROID_HOME=~/Android/Sdk"
    echo "Windows: setx ANDROID_HOME C:\\Users\\YourUsername\\AppData\\Local\\Android\\Sdk"
fi

echo ""
echo "=========================================="
echo "  开始初始化 Capacitor 项目"
echo "=========================================="
echo ""

# 全局安装 Capacitor CLI
echo "📦 安装 Capacitor CLI..."
npm install -g @capacitor/cli

# 初始化 npm 项目
if [ ! -f "package.json" ]; then
    echo "📝 初始化 npm 项目..."
    npm init -y
fi

# 安装依赖
echo "📥 安装依赖..."
npm install @capacitor/core @capacitor/cli @capacitor/android

# 初始化 Capacitor
echo "⚙️  初始化 Capacitor..."
if [ ! -f "capacitor.config.json" ]; then
    cat > capacitor.config.json << 'EOF'
{
  "appId": "com.brogue.ce.zh",
  "appName": "Brogue CE",
  "webDir": "dist",
  "server": {
    "androidScheme": "https",
    "cleartext": true
  },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 0
    }
  }
}
EOF
    echo "✅ capacitor.config.json 已创建"
fi

# 添加安卓平台
if [ ! -d "android" ]; then
    echo "📱 添加安卓平台..."
    npx cap add android
fi

# 同步文件
echo "🔄 同步 Web 文件到 Android 项目..."
npx cap sync

echo ""
echo "=========================================="
echo "  ✅ 初始化完成！"
echo "=========================================="
echo ""
echo "📖 下一步:"
echo "  1. 打开 Android Studio:"
echo "     npx cap open android"
echo ""
echo "  2. 在 Android Studio 中构建 APK:"
echo "     Build → Build Bundle(s) / APK(s) → Build APK(s)"
echo ""
echo "  3. APK 文件位置:"
echo "     android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "📝 详细说明见: ANDROID_BUILD.md"
echo ""
