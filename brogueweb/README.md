# 🌐 Brogue CE Web (Emscripten)

中文版 Brogue CE 的 Web 版本，由 Emscripten 编译为 WebAssembly。

## 🎮 在线游戏

**立即玩：** [Brogue CE 中文版](https://coolking70.github.io/BrogueCE-chs/)

该版本由 GitHub Actions 自动编译和部署，每次推送都会更新。

---

## 📖 项目说明

本文件夹提供将 `BrogueCE-master` 编译为 WebAssembly 并在浏览器中运行的完整工具链。

## 📚 项目结构

```
brogueweb/
├── dist/                     # 编译输出（自动生成）
│   ├── index.html           # 网页版主页面
│   ├── index-mobile.html    # 移动端优化版本
│   ├── index.js             # JavaScript 运行时
│   ├── index.wasm           # WebAssembly 二进制
│   └── index.data           # Emscripten 数据文件
├── android/                  # Android 项目（Capacitor）
├── html/                     # 自定义 HTML 模板
├── i18n/                     # 国际化和汉化文件
├── build_web.sh             # Web 版本构建脚本
├── build_android.sh         # Android APK 构建脚本
├── serve.sh                 # 本地测试服务器
└── README.md                # 本文件
```

---

## 🚀 本地开发和构建

### 前置需求

- **Emscripten SDK** - WebAssembly 编译器
- **Node.js**（可选，用于本地测试）

### 步骤 1：安装 Emscripten

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

### 步骤 2：构建 Web 版本

从仓库根目录运行：

```bash
cd brogueweb
bash build_web.sh
```

构建的文件会保存在 `brogueweb/dist/` 目录中。

### 步骤 3：本地测试

```bash
bash serve.sh 8080
```

然后在浏览器中打开：
- http://localhost:8080/

---

## 🔄 GitHub Actions 自动化

### Web 版本（.github/workflows/build-web.yml）

自动执行：
1. 从 main 分支获取 `bin/` 资源
2. 使用 Emscripten 编译 WASM
3. 部署到 GitHub Pages：https://coolking70.github.io/BrogueCE-chs/

**触发条件：** 推送到 `claude/github-online-compilation-dUodh` 分支

---

## 📱 Android 版本

同一个 Web 工作流也会自动编译 Android APK。详见 [ANDROID_QUICKSTART.md](ANDROID_QUICKSTART.md)

---

## 📝 技术说明

### 构建方式
- **编译器：** Emscripten（C/C++ → WebAssembly）
- **渲染器：** SDL2（通过 Emscripten 适配）
- **虚拟文件系统：** Emscripten 预加载 `assets/` 和 `keymap.txt`

### 中文字体
- **主字体：** `BrogueCE-master/bin/assets/NotoSansSC-Regular.ttf`
- **备选字体：**
  - `NotoSansCJKsc-Regular.otf`
  - `SourceHanSansSC-Regular.otf`
  - `SourceHanSansCN-Regular.otf`

### 汉化配置
- **汉化数据：** `BrogueCE-master/bin/assets/zh_CN.json`（JSON 格式）
- **多语言支持：** 运行时可用 `--lang` 参数切换
  - `--lang zh_CN`：中文（默认）
  - `--lang en_US`：英文
- **自定义翻译文件：** 通过 `BROGUE_LANG_FILE` 环境变量指定

---

## 🌐 汉化管理

### 导出未翻译的字符串

完整扫描：
```bash
./i18n/export_untranslated.sh
```

仅玩家可见的字符串：
```bash
./i18n/export_untranslated_visible.sh
```

### 合并翻译文件

```bash
./i18n/merge_translations.sh
```

### 验证占位符一致性

检查 `%...` 和 `$HESHE` 风格的占位符：
```bash
./i18n/check_translations.sh
```

---

## 🐛 故障排除

**页面无法加载或游戏崩溃**
- 打开浏览器开发者工具（F12）
- 查看 Console 选项卡中的错误信息
- 检查网络选项卡是否有 HTTP 错误

**中文字体无法显示**
- 确保 `bin/assets/NotoSansSC-Regular.ttf` 存在
- 重新运行构建：`bash build_web.sh`

**资源文件缺失**
- 确保 `BrogueCE-master/bin/assets/` 和 `keymap.txt` 存在
- CI/CD 会自动从 main 分支获取

---

## 📚 相关文档

- [主项目 README](../README.md)
- [Android 快速开始](ANDROID_QUICKSTART.md)
- [Android 详细构建指南](ANDROID_BUILD.md)
- [分发指南](DISTRIBUTE.md)
- [游戏玩法说明](README_PLAY.md)
- [快速启动](QUICKSTART.md)

---

## 🔗 上游项目

- **BrogueCE：** https://github.com/tmewett/BrogueCE
- **Brogue 官方：** https://www.brogue.app/

---

**最后更新：** 2026-03-04
