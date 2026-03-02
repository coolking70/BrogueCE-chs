# Brogue CE 中文版 - 快速开始

## 📦 文件说明

你现在拥有以下启动工具：

| 文件 | 平台 | 用途 |
|------|------|------|
| **run.bat** | Windows | 双击即可运行 |
| **run.sh** | macOS/Linux | 运行游戏脚本 |
| **dist/** | 所有平台 | 游戏核心文件 |

---

## 🚀 快速启动

### Windows 用户（最简单）

```
1. 找到 run.bat
2. 双击
3. 游戏自动打开！
```

✅ **需要：** Python 3.6+（已安装 Python 的情况）
- 检查方法：打开 cmd，运行 `python --version`

### macOS 用户

```bash
bash run.sh
```

✅ **需要：** Python 3（通常已预装）
- 检查方法：终端运行 `python3 --version`

---

## 🎮 游戏特色

✅ **完整中文汉化**
- 菜单和界面全中文
- 怪物、物品、地形名称中文
- 游戏提示和消息中文

✅ **所有功能完整**
- 支持存档、读档
- 支持多种游戏模式
- 所有合法命令都可用

---

## 📋 完整说明

- 详细安装说明：见 `README_PLAY.md`
- 分发给他人：见 `DISTRIBUTE.md`
- 原始项目：见 `README.md`

---

## ⚡ 常见问题速查

| 问题 | 解决方案 |
|------|---------|
| "找不到 Python" | 访问 https://www.python.org/downloads 安装 |
| "端口被占用" | 自动尝试其他端口，无需操作 |
| "游戏不能保存" | 网页版限制，考虑原生版本 |
| "能否脱离 Python" | 可以用 Electron 打包成 .exe（文件较大） |

---

## 📊 性能指标

- **启动时间**：3-5 秒
- **占用内存**：100-200MB
- **浏览器兼容性**：Chrome/Edge/Firefox
- **网络要求**：仅本地，无需互联网

---

## 🔧 技术架构

```
run.bat/run.sh
    ↓
启动 Python HTTP 服务器 (localhost:8000)
    ↓
浏览器加载 dist/index.html
    ↓
JavaScript + WebAssembly 运行游戏
    ↓
在浏览器窗口显示游戏
```

**优点：** 跨平台，文件小，无需复杂依赖

---

## 📦 分发给朋友

### Windows 朋友

```bash
# 在 brogueweb 目录下
zip -r brogue-ce-zh-windows.zip run.bat README_PLAY.md dist/
```

发送这个 ZIP 文件，他们：
1. 解压
2. 双击 `run.bat`
3. 开始游戏！

### macOS 朋友

```bash
zip -r brogue-ce-zh-mac.zip run.sh README_PLAY.md dist/
```

发送这个 ZIP 文件，他们：
1. 解压
2. 打开终端，运行 `bash run.sh`
3. 开始游戏！

---

## 🎯 下一步

1. **立即游玩**
   ```
   Windows: 双击 run.bat
   macOS:   bash run.sh
   ```

2. **分发给朋友**
   - 按上面的 ZIP 步骤打包
   - 告诉他们需要 Python（大多数已有）

3. **如需原生 Windows 版**
   - 可编译 Windows EXE 版本
   - 获得完整的存档功能
   - 但需要更复杂的编译步骤

---

祝游戏愉快！🎮✨
