# 分发 Brogue CE 中文版指南

## 为用户打包

### 最小化分发包（推荐）

只需要以下文件即可分发给用户：

```
brogue-ce-zh/
├── run.bat                 # Windows 用户双击这个
├── run.sh                  # macOS 用户运行这个
├── README_PLAY.md          # 使用说明
└── dist/                   # 游戏文件夹
    ├── index.html
    ├── index.js
    ├── index.wasm
    └── index.data
```

**打包大小：** 约 12MB（可以直接用 7-Zip 或 WinRAR 压缩）

### 分发步骤

#### 1. 为 Windows 用户打包

```bash
# 进入 brogueweb 目录
cd brogueweb

# 创建分发目录
mkdir -p dist_windows/brogue-ce-zh
cp run.bat dist_windows/brogue-ce-zh/
cp README_PLAY.md dist_windows/brogue-ce-zh/
cp -r dist dist_windows/brogue-ce-zh/

# 压缩（使用 7-Zip）
7z a brogue-ce-zh-windows.7z dist_windows/brogue-ce-zh/

# 或使用 ZIP（更兼容）
zip -r brogue-ce-zh-windows.zip dist_windows/brogue-ce-zh/
```

**输出：** `brogue-ce-zh-windows.zip` （~12MB）

#### 2. 为 macOS 用户打包

```bash
# 进入 brogueweb 目录
cd brogueweb

# 创建分发目录
mkdir -p dist_mac/brogue-ce-zh
cp run.sh dist_mac/brogue-ce-zh/
cp README_PLAY.md dist_mac/brogue-ce-zh/
cp -r dist dist_mac/brogue-ce-zh/

# 压缩
zip -r brogue-ce-zh-mac.zip dist_mac/brogue-ce-zh/
```

**输出：** `brogue-ce-zh-mac.zip` （~12MB）

### 一键分发脚本

创建 `package.sh`，一次性打包所有平台：

```bash
#!/bin/bash

mkdir -p releases

# Windows 包
mkdir -p temp/brogue-ce-zh
cp run.bat temp/brogue-ce-zh/
cp README_PLAY.md temp/brogue-ce-zh/
cp -r dist temp/brogue-ce-zh/
cd temp
zip -r ../releases/brogue-ce-zh-windows.zip brogue-ce-zh/
cd ..
rm -rf temp

# macOS 包
mkdir -p temp/brogue-ce-zh
cp run.sh temp/brogue-ce-zh/
cp README_PLAY.md temp/brogue-ce-zh/
cp -r dist temp/brogue-ce-zh/
cd temp
zip -r ../releases/brogue-ce-zh-mac.zip brogue-ce-zh/
cd ..
rm -rf temp

echo "✅ 打包完成！"
echo "📦 Windows: releases/brogue-ce-zh-windows.zip"
echo "📦 macOS:   releases/brogue-ce-zh-mac.zip"
```

---

## 用户安装步骤

### Windows 用户

1. 下载 `brogue-ce-zh-windows.zip`
2. 解压到任意位置
3. 双击 `run.bat` 启动游戏

**前提条件：** 已安装 Python（并添加到 PATH）

### macOS 用户

1. 下载 `brogue-ce-zh-mac.zip`
2. 解压到任意位置
3. 打开终端，运行：
   ```bash
   bash run.sh
   ```

**前提条件：** Python 3（通常已预装）

---

## 在线分发

### 选项 1：GitHub Releases

```bash
# 假设你有 GitHub 仓库
git add run.bat run.sh README_PLAY.md dist/
git commit -m "Release v1.0 - Chinese localization"
git tag v1.0
git push origin main --tags
```

然后在 GitHub Releases 页面上传两个 ZIP 文件。

### 选项 2：直接分享链接

可以上传到云盘（百度网盘、OneDrive 等）分享下载链接。

---

## 更新版本

当翻译更新时：

1. 重新编译网页版：
   ```bash
   make SYSTEM=WINDOWS bin/brogue.exe  # 如需更新原生版本
   # 或
   bash build_web.sh  # 更新网页版
   ```

2. 替换 `dist/` 文件夹中的文件

3. 重新打包分发

---

## 文件清单检查

分发前，确认包含这些文件：

- [ ] `run.bat` (Windows)
- [ ] `run.sh` (macOS)
- [ ] `README_PLAY.md` (使用说明)
- [ ] `dist/index.html`
- [ ] `dist/index.js`
- [ ] `dist/index.wasm`
- [ ] `dist/index.data`

**总大小应该 ~12MB**

---

## 技术细节

### 为什么这么小？

- 网页版直接使用已编译的 WASM
- 无需 Node.js、Electron 等运行时
- 只需 Python（几乎所有电脑都有）

### 为什么需要 Python？

- 仅用于启动本地 HTTP 服务器
- 这样做的原因：WASM 加载需要 http:// 协议，不能直接用 file://

### 能否去掉 Python 依赖？

**高级选项**（不推荐初学者）：

1. **使用 Electron** - 打包成真正的 .exe，无需 Python
   - 但文件会增加到 ~150MB

2. **使用便携式 Python** - 将 Python 打包进去
   - 文件会增加到 ~30-50MB

3. **使用其他服务器** - Node.js、PHP 等
   - 需要额外的运行时环境

---

## 常见问题

**Q: 用户说"双击 run.bat 没反应"**
- A: 通常是 Python 未安装。提供安装链接：https://www.python.org/

**Q: 能否做成单个 .exe 文件？**
- A: 可以用 Electron 或 PyInstaller，但会显著增加文件大小。

**Q: macOS 用户能否也用简单方式？**
- A: 可以，`run.sh` 同样简单，只需在终端运行。

---

祝分发顺利！
