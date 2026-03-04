# 🔧 Android APK 编译问题排查指南

## 快速诊断

如果 GitHub Actions 中的 Android APK 编译失败，请按以下步骤排查：

### 步骤 1：本地诊断

```bash
bash diagnose_android_build.sh
```

这个脚本会检查：
- ✅ Node.js 和 npm
- ✅ Java JDK
- ✅ Android SDK 和环境变量
- ✅ Web 文件（dist/）
- ✅ npm 依赖
- ✅ Gradle 配置

### 步骤 2：查看诊断结果

脚本会显示所有检查的结果。如果某个检查失败，按照提示安装或配置缺失的工具。

### 步骤 3：本地编译测试

诊断通过后，运行：

```bash
bash diagnose_android_build.sh --build
```

这会执行完整的本地 APK 编译。

---

## 常见问题和解决方案

### ❌ "Node.js not found"

**原因：** 未安装 Node.js

**解决方案：**
```bash
# macOS
brew install node

# Ubuntu/Debian
sudo apt-get install nodejs npm

# Windows
# 下载安装器：https://nodejs.org/
```

验证安装：
```bash
node --version    # 应该 >= 14.0.0
npm --version     # 应该 >= 6.0.0
```

---

### ❌ "Java not found"

**原因：** 未安装 JDK

**解决方案：**
```bash
# macOS
brew install openjdk@11

# Ubuntu/Debian
sudo apt-get install openjdk-11-jdk

# Windows
# 下载 Adoptium JDK: https://adoptium.net/
```

验证安装：
```bash
java -version   # 应该显示 JDK 11+
```

---

### ❌ "Android SDK not found" 或 "ANDROID_HOME not set"

**原因：** Android SDK 未安装或环境变量未配置

**解决方案：**

#### 1. 安装 Android Studio
- 下载：https://developer.android.com/studio
- 安装后，SDK 会自动安装在默认位置

#### 2. 设置 ANDROID_HOME 环境变量

**macOS/Linux：**
```bash
# 找到 Android SDK 位置
# 通常在 $HOME/Android/Sdk 或 $HOME/Library/Android/sdk

# 添加到 ~/.bashrc 或 ~/.zshrc
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH"

# 应用改变
source ~/.bashrc  # 或 source ~/.zshrc
```

**Windows (PowerShell)：**
```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME","C:\Users\YourName\AppData\Local\Android\Sdk","User")
$env:ANDROID_HOME = "C:\Users\YourName\AppData\Local\Android\Sdk"
$env:PATH = "$env:ANDROID_HOME\tools;$env:ANDROID_HOME\platform-tools;$env:PATH"
```

验证设置：
```bash
echo $ANDROID_HOME    # 应该显示 SDK 路径
```

---

### ❌ "dist/ directory not found"

**原因：** Web 版本未编译

**解决方案：**
```bash
cd brogueweb
bash build_web.sh
```

这需要 Emscripten 已安装。详见 [brogueweb/README.md](brogueweb/README.md)

---

### ❌ "APK 编译失败" 或 "编译错误"

**常见原因和解决方案：**

#### 1. Gradle 版本问题
```bash
cd brogueweb/android
./gradlew --version  # 检查 Gradle 版本
```

如果版本过旧，运行：
```bash
./gradlew wrapper --gradle-version=8.0  # 更新 Gradle
```

#### 2. SDK 版本不匹配

检查 `variables.gradle`：
```gradle
ext {
    minSdkVersion = 24      # 最低 Android 7.0
    compileSdkVersion = 36  # 编译使用 Android 15
    targetSdkVersion = 36
}
```

确保 Android SDK 中已安装相应版本：
```bash
# macOS/Linux
sdkmanager "platforms;android-36" "build-tools;36.0.0"

# 或在 Android Studio 中：
# Settings → SDK Manager → SDK Platforms/Build Tools
```

#### 3. 内存不足

编辑 `android/gradle.properties`：
```gradle
org.gradle.jvmargs=-Xmx4096m  # 增加到 4GB
```

#### 4. 文件权限问题

```bash
cd brogueweb/android
chmod +x gradlew
chmod -R 755 .gradle
```

---

### ❌ "build/outputs/apk/ 目录不存在"

**原因：** 编译没有成功到生成 APK 的阶段

**解决方案：**
```bash
cd brogueweb/android

# 清理之前的构建
./gradlew clean

# 重新编译，显示详细输出
./gradlew assembleDebug --info

# 查看完整错误日志
./gradlew assembleDebug --stacktrace
```

检查输出中的具体错误消息。

---

### ⚠️ "npx: command not found"

**原因：** npm 未正确安装或 npm 全局包路径有问题

**解决方案：**
```bash
# 重新安装 npm
npm install -g npm@latest

# 或直接使用本地 npx
cd brogueweb
./node_modules/.bin/cap sync android
```

---

### ⚠️ "Capacitor sync 失败"

**原因：** 依赖未安装或配置错误

**解决方案：**
```bash
cd brogueweb

# 清理并重新安装
rm -rf node_modules package-lock.json
npm install

# 重新同步
npx cap sync android
```

---

## 📋 完整本地构建步骤

如果诊断脚本显示所有检查都通过，但仍需手动编译：

```bash
# 1. 进入 brogueweb 目录
cd brogueweb

# 2. 编译 Web 版本（如果还未编译）
bash build_web.sh

# 3. 安装 npm 依赖
npm install

# 4. 同步文件到 Android
npx cap sync android

# 5. 进入 Android 目录
cd android

# 6. 配置 local.properties（如果不存在）
echo "sdk.dir=$ANDROID_HOME" > local.properties

# 7. 编译 APK
./gradlew assembleDebug

# 8. 检查输出
ls -lh app/build/outputs/apk/debug/app-debug.apk
```

---

## 🔄 GitHub Actions 编译失败的常见原因

### 1. **Android SDK 初始化失败**
   - 解决：检查 workflow 中的 SDK 版本配置

### 2. **Web 文件未正确同步**
   - 解决：确保 `npx cap sync` 在 gradle 之前运行

### 3. **npm 依赖缓存问题**
   - 解决：清空 GitHub Actions 缓存后重新运行

### 4. **磁盘空间不足**
   - 解决：GitHub Actions runners 通常有足够空间，但如果失败检查日志

---

## 📞 获取帮助

如果以上步骤都不能解决问题：

1. **查看完整的编译日志**
   - GitHub Actions: Actions → 最新运行 → Build APK 步骤
   - 本地：添加 `--stacktrace` 和 `--info` 标志

2. **报告 Issue**
   - https://github.com/coolking70/BrogueCE-chs/issues
   - 包含：
     - 操作系统和版本
     - Java/Android SDK/Gradle 版本
     - 完整的错误输出

3. **查看相关文档**
   - [Capacitor Android 文档](https://capacitorjs.com/docs/android)
   - [Gradle 文档](https://gradle.org/guides/)
   - [Android Studio 帮助](https://developer.android.com/studio/intro)

---

**祝编译顺利！🚀**
