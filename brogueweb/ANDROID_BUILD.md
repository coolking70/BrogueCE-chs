# Brogue CE 中文版 - 安卓APK打包指南

## 📋 前置需求

### 软件安装
1. **Node.js 14+** - https://nodejs.org/
2. **Java JDK 11+** - https://www.oracle.com/java/technologies/downloads/
3. **Android Studio** - https://developer.android.com/studio
4. **Android SDK** - 通过 Android Studio 安装

### 系统环境变量
添加以下到系统 PATH：
- `JAVA_HOME` → JDK 安装目录
- `ANDROID_HOME` → Android SDK 目录（通常在 `~/Library/Android/sdk`）

---

## 🚀 方案 1：使用 Capacitor（推荐，最简单）

Capacitor 是 Ionic 团队开发的现代化框架，比 Cordova 简单很多。

### 步骤 1：初始化 Capacitor 项目

```bash
cd brogueweb

# 安装 Capacitor CLI
npm install -g @capacitor/cli

# 初始化项目
npm init -y
npm install @capacitor/core @capacitor/cli
npx cap init

# 根据提示输入：
# App name: Brogue CE
# App Package ID: com.brogue.ce.zh
```

### 步骤 2：配置 Capacitor

编辑 `capacitor.config.json`：

```json
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
```

### 步骤 3：添加安卓平台

```bash
npm install @capacitor/android
npx cap add android
```

### 步骤 4：配置安卓应用

编辑 `android/app/src/main/AndroidManifest.xml`，添加权限：

```xml
<!-- 在 <manifest> 中添加 -->
<uses-permission android:name="android.permission.INTERNET" />
```

编辑 `android/app/build.gradle`，确保 API 版本：

```gradle
android {
    compileSdkVersion 33

    defaultConfig {
        minSdkVersion 21
        targetSdkVersion 33
    }
}
```

### 步骤 5：构建APK

```bash
# 同步 web 文件到 Android
npx cap sync

# 打开 Android Studio
npx cap open android
```

**在 Android Studio 中：**
1. 菜单 → Build → Build Bundle(s) / APK(s) → Build APK(s)
2. 等待构建完成
3. APK 文件位置：`android/app/build/outputs/apk/debug/app-debug.apk`

---

## 🔧 方案 2：使用 Android Studio WebView（简单）

如果你已有 Android Studio，直接创建原生应用最简单。

### 步骤 1：创建新项目

1. 打开 Android Studio
2. File → New → New Project
3. 选择 "Empty Activity"
4. 配置：
   - Name: BrogueCE
   - Package: com.brogue.ce.zh
   - Minimum SDK: API 21

### 步骤 2：创建 WebView Activity

编辑 `MainActivity.java`：

```java
package com.brogue.ce.zh;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowManager;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 隐藏状态栏和导航栏
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);

        WebView webView = new WebView(this);
        setContentView(webView);

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebViewClient(new WebViewClient());

        // 加载本地 HTML（复制 dist 文件到 assets）
        webView.loadUrl("file:///android_asset/index-mobile.html");
    }
}
```

### 步骤 3：添加网页文件

1. 在 `app/src/main/assets/` 目录下创建文件夹（没有的话创建）
2. 复制以下文件到 `assets/`：
   ```
   assets/
   ├── index-mobile.html
   ├── index.js
   ├── index.wasm
   └── index.data
   ```

### 步骤 4：更新 AndroidManifest.xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.brogue.ce.zh">

    <!-- 添加权限 -->
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/Theme.BrogueCE">

        <activity android:name=".MainActivity"
            android:exported="true"
            android:screenOrientation="portrait">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
```

### 步骤 5：构建APK

1. Build → Build Bundle(s) / APK(s) → Build APK(s)
2. 选择 Debug 或 Release
3. APK 生成在 `app/build/outputs/apk/`

---

## 🎨 优化建议

### 1. 全屏显示
✅ 已在 `index-mobile.html` 中配置
- Canvas 自动铺满整个屏幕
- 隐藏所有 Emscripten UI 元素

### 2. 触摸优化
✅ 已在 `index-mobile.html` 中实现
- 禁用双击缩放
- 禁用长按菜单
- 禁用手势缩放

### 3. 屏幕方向
建议 **竖屏模式**（已在 AndroidManifest.xml 中设置）
- 如需改为横屏，改为 `android:screenOrientation="landscape"`

### 4. 应用图标

创建应用图标（512x512）并放在 `app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`

---

## 📦 发布配置

### 生成 Release APK

1. **生成密钥库**：
   ```bash
   keytool -genkey -v -keystore brogue.keystore -alias brogue -keyalg RSA -keysize 2048 -validity 10000
   ```

2. **配置签名** (Android Studio)：
   - Build → Generate Signed Bundle / APK
   - 选择 APK
   - 选择你创建的 `.keystore` 文件
   - 填入密钥信息
   - 选择 Release 构建类型

3. **输出**：`app/release/app-release.apk`

---

## 🔍 常见问题

### Q: 网页文件加载失败
**A:** 确保 `assets/` 目录结构正确：
```
assets/
├── index-mobile.html    （改名为 index.html）
├── index.js
├── index.wasm
└── index.data
```

### Q: WebView 显示白屏
**A:** 检查：
1. AndroidManifest.xml 中有 `INTERNET` 权限
2. WebView 的 JavaScript 已启用
3. HTML 文件路径正确

### Q: APK 太大
**A:**
- 使用 Release 构建（减少 ~30%）
- 启用 ProGuard/R8 混淆
- 分割 APK 按 ABI（Build → Build APK(s) → v8a only）

### Q: 游戏运行很慢
**A:**
1. 确保使用 Release 构建，不是 Debug
2. 检查设备是否支持 WebAssembly
3. 确保足够的内存（至少 500MB）

---

## 📋 文件清单

### Capacitor 项目需要：
- ✅ `dist/index.html` (或 `index-mobile.html`)
- ✅ `dist/index.js`
- ✅ `dist/index.wasm`
- ✅ `dist/index.data`
- ✅ `capacitor.config.json`
- ✅ `package.json`

### Android Studio 项目需要：
- ✅ `app/src/main/assets/index-mobile.html`
- ✅ `app/src/main/assets/index.js`
- ✅ `app/src/main/assets/index.wasm`
- ✅ `app/src/main/assets/index.data`
- ✅ `MainActivity.java`
- ✅ `AndroidManifest.xml`

---

## 🚀 快速开始

**对于 Capacitor（推荐）：**

```bash
cd brogueweb
npm install -g @capacitor/cli
npm init -y
npm install @capacitor/core @capacitor/cli
npx cap init
npm install @capacitor/android
npx cap add android
npx cap sync
npx cap open android
```

然后在 Android Studio 中 Build → Build APK(s)

---

## 📱 发布应用

打包好后，可以发布到：
1. **GitHub Releases** - 直接下载安装
2. **Google Play Store** - 正式应用商店
3. **F-Droid** - 开源应用商店
4. **APK 分发网站** - APKMirror 等

---

## 性能指标

| 指标 | 数值 |
|------|------|
| APK 大小 | 12-15MB（Debug），8-10MB（Release） |
| 启动时间 | 3-5 秒 |
| 内存占用 | 100-200MB |
| 兼容性 | Android 5.0+ (API 21+) |

---

需要我帮你详细配置某个方案吗？
