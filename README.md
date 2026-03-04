# 🎮 Brogue CE 中文版

完全汉化的 Brogue Classic Edition，现已支持**网页版**和 **Android APK** 自动构建和发布！

[English](README_EN.md) | **中文**

---

## 🚀 快速开始

### 📱 网页版（推荐，无需安装）

**立即玩：** [Brogue CE 中文版](https://coolking70.github.io/BrogueCE-chs/)

✅ 完全免费
✅ 无需安装
✅ 跨平台支持（Windows、Mac、Linux、iOS、Android）
✅ 离线运行（加载后无需网络）

**浏览器要求：** Chrome、Firefox、Edge（最新版本）

---

### 📦 Android 版本

在 GitHub Release 中下载最新的 `app-debug.apk`

**安装步骤：**
1. 下载 APK 文件到手机
2. 设置 → 安全 → 启用"未知来源"应用安装
3. 打开 APK 文件，点击安装

或使用 adb：
```bash
adb install app-debug.apk
```

**系统要求：** Android 5.0+ (API 21+)

---

## 📖 项目说明

### 结构

```
BrogueCE-chs/
├── BrogueCE-master/          # 上游源代码
│   ├── src/                  # C 源代码
│   ├── bin/                  # 游戏资源（assets、字体等）
│   └── ...
├── brogueweb/                # Web 版本构建
│   ├── dist/                 # 编译输出（HTML、JS、WASM）
│   ├── android/              # Android 项目
│   ├── build_web.sh          # Web 版本构建脚本
│   ├── build_android.sh      # Android APK 构建脚本
│   └── ...
├── .github/workflows/        # GitHub Actions 自动化
│   ├── build-web.yml         # Web 版本 CI/CD
│   └── build-android.yml     # Android APK CI/CD
└── README.md                 # 本文件
```

### 🔄 自动构建流程

所有构建都通过 GitHub Actions 自动完成：

| 平台 | 构建流程 | 触发条件 | 输出 |
|------|--------|--------|------|
| **Web** | Emscripten → HTML/JS/WASM | 推送到开发分支 | GitHub Pages 实时部署 |
| **Android** | Web + Gradle | 推送到开发分支 | GitHub Release APK |

---

## 🛠️ 本地开发

### 前置需求

- **Node.js 14+**
- **Java JDK 11+**（Android 构建）
- **Emscripten** （Web 构建）
- **Android SDK** （Android 构建）

### 构建 Web 版本

```bash
# 激活 Emscripten
source /path/to/emsdk/emsdk_env.sh

# 构建
cd brogueweb
bash build_web.sh

# 本地测试
bash serve.sh 8080
# 打开浏览器访问 http://localhost:8080
```

### 构建 Android APK

```bash
cd brogueweb
bash build_android.sh

# APK 路径：android/app/build/outputs/apk/debug/app-debug.apk
```

详见 [brogueweb/ANDROID_QUICKSTART.md](brogueweb/ANDROID_QUICKSTART.md)

---

## 📝 汉化内容

✅ **完整汉化包括：**
- 主菜单和界面
- 所有怪物和物品名称
- 地形和特殊效果
- 游戏提示和消息
- 信息面板和统计数据

**汉化文件：** `BrogueCE-master/bin/assets/zh_CN.json`

---

## 🔗 相关链接

- **原始项目：** [tmewett/BrogueCE](https://github.com/tmewett/BrogueCE)
- **游戏介绍：** [Brogue 官方网站](https://www.brogue.app/)
- **汉化版仓库：** [coolking70/BrogueCE-chs](https://github.com/coolking70/BrogueCE-chs)

---

## 📋 功能清单

- ✅ 完整的 Brogue CE 游戏功能
- ✅ 完全中文汉化
- ✅ Web 版本（Emscripten + WebAssembly）
- ✅ Android APK 版本
- ✅ 自动构建和部署（CI/CD）
- ✅ GitHub Pages 实时托管
- ✅ GitHub Release 发布
- ✅ 离线运行支持

---

## ⚖️ 许可证

本项目采用原始 BrogueCE 的许可证。详见 [LICENSE.txt](BrogueCE-master/LICENSE.txt)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**祝游戏愉快！🎮✨**

Last updated: 2026-03-04
