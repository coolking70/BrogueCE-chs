# 安卓APK快速启动指南

## 🎯 选择你的方案

### 方案对比

| 特性 | Capacitor | Android Studio |
|------|-----------|----------------|
| **难度** | ⭐⭐ 简单 | ⭐⭐⭐ 中等 |
| **时间** | 5分钟 | 15分钟 |
| **APK大小** | 12-15MB | 8-10MB |
| **自动化** | 很好 | 需要手动 |
| **灵活性** | 中等 | 很高 |
| **官方支持** | 现代 | 标准 |

## ✨ 最简单方案：Capacitor（推荐）

### 1️⃣ 前置检查

```bash
node --version      # 需要 14+
npm --version       # 需要 6+
java -version       # 需要 JDK 11+
```

### 2️⃣ 一键初始化

在 `brogueweb` 目录运行：

```bash
bash setup-android.sh
```

这个脚本会：
- ✅ 检查所有依赖
- ✅ 安装 Capacitor
- ✅ 创建 Android 项目
- ✅ 配置文件

### 3️⃣ 打开 Android Studio

```bash
npx cap open android
```

### 4️⃣ 构建 APK

在 Android Studio 中：
```
Build → Build Bundle(s) / APK(s) → Build APK(s)
```

完成！APK 文件在：
```
android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 🔧 Android Studio 方案

如果你已有 Android Studio，也可以直接创建项目：

### 1️⃣ 创建项目

```
File → New Project → Empty Activity
```

配置：
- Name: `BrogueCE`
- Package: `com.brogue.ce.zh`
- Minimum SDK: API 21

### 2️⃣ 复制网页文件

创建目录：`app/src/main/assets/`

复制 4 个文件：
```
brogueweb/dist/index-mobile.html  → assets/index.html
brogueweb/dist/index.js           → assets/index.js
brogueweb/dist/index.wasm         → assets/index.wasm
brogueweb/dist/index.data         → assets/index.data
```

### 3️⃣ 替换 MainActivity.java

参考 `ANDROID_BUILD.md` 中的代码片段

### 4️⃣ 更新权限

在 `AndroidManifest.xml` 中添加：
```xml
<uses-permission android:name="android.permission.INTERNET" />
```

### 5️⃣ 构建 APK

```
Build → Build APK(s)
```

---

## 📱 优化细节

### ✅ 已为安卓优化：

1. **全屏显示**
   - Canvas 铺满整个屏幕
   - 隐藏所有多余 UI 元素
   - 隐藏地址栏和状态栏

2. **触摸优化**
   - 禁用双击缩放
   - 禁用长按菜单
   - 禁用手势缩放

3. **性能优化**
   - 使用 `index-mobile.html`（裁剪版本）
   - 禁用调试日志
   - 优化 Canvas 渲染

### 📄 使用 `index-mobile.html` 而不是 `index.html`

原始的 `index.html` 包含：
- Emscripten Logo
- 进度条和加载状态
- 调试控制面板
- 日志输出框

新的 `index-mobile.html`：
- ❌ 隐藏所有这些元素
- ✅ Canvas 全屏
- ✅ 触摸友好
- ✅ 移动优化

---

## 🚀 文件清单

### 创建的新文件

```
brogueweb/
├── dist/
│   └── index-mobile.html        ← 新：移动优化版本
├── ANDROID_BUILD.md              ← 详细说明
├── ANDROID_QUICKSTART.md         ← 本文件
├── setup-android.sh              ← 自动化脚本
├── package-android.json          ← Capacitor 配置
├── package.json                  ← npm 配置（Capacitor）
└── capacitor.config.json         ← Capacitor 配置
```

---

## ⚙️ 环境变量设置

如果遇到"ANDROID_HOME not found"错误：

### macOS
```bash
export ANDROID_HOME=~/Library/Android/sdk
export PATH=$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH
```

### Linux
```bash
export ANDROID_HOME=~/Android/Sdk
export PATH=$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH
```

### Windows (PowerShell)
```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME","C:\Users\YourName\AppData\Local\Android\Sdk","User")
[Environment]::SetEnvironmentVariable("Path","$env:ANDROID_HOME\tools;$env:ANDROID_HOME\platform-tools;$env:Path","User")
```

---

## 📦 APK 发布

### 调试版本（开发测试）
```
Build → Build APK(s) → Debug
```
- 文件：`app-debug.apk`
- 大小：~15MB
- 用途：测试

### 发布版本（正式应用）
```
Build → Build Bundle(s) / APK(s) → Release
```
需要：
1. 创建签名密钥：
   ```bash
   keytool -genkey -v -keystore brogue.keystore \
     -alias brogue -keyalg RSA -keysize 2048 -validity 10000
   ```
2. 在 Android Studio 中选择此密钥
3. 生成签名 APK

---

## 🎮 游戏内容

最终 APK 包含：
- ✅ 完整的中文汉化游戏
- ✅ 所有游戏功能
- ✅ 全屏模式
- ✅ 触摸优化
- ✅ 无需网络（离线运行）

---

## ❓ 常见问题

**Q: 怎样选择方案？**
- A: 如果你没用过 Android 开发，选 Capacitor（推荐）
- 如果你有 Android Studio 经验，选 Android Studio 方案

**Q: APK 多大？**
- A: Debug 约 15MB，Release 约 10MB（压缩后 ~5MB）

**Q: 支持什么安卓版本？**
- A: Android 5.0+（API 21+），涵盖 99% 的设备

**Q: 能装在手机上吗？**
- A: 可以。需要启用"未知来源"应用安装，或用 adb 安装

**Q: 游戏会卡顿吗？**
- A: 不会。WebAssembly 性能很好，除非设备特别老旧

---

## 📖 更多信息

- 详细步骤：`ANDROID_BUILD.md`
- Capacitor 文档：https://capacitorjs.com/
- Android Studio 文档：https://developer.android.com/studio/

---

## 🎯 下一步

**选择你的方案并运行！**

```bash
# 方案 1（推荐）
bash setup-android.sh

# 或者方案 2
# 打开 Android Studio，按照说明创建项目
```

祝构建顺利！🚀
