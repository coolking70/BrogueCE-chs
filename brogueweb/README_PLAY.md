# Brogue CE 中文版 - 快速启动指南

## 系统要求

- **Windows**：Python 3.6+ 已安装
- **macOS**：Python 3 已安装（通常自带）

## 方式 1：一键启动（推荐）

### Windows
1. 找到 `run.bat` 文件
2. **双击** 运行
3. 游戏会在浏览器中自动打开

### macOS
1. 打开终端（Terminal）
2. 运行以下命令：
   ```bash
   bash run.sh
   ```
   或者直接双击 `run.sh` 文件
3. 游戏会在浏览器中自动打开

---

## 方式 2：手动启动

如果脚本不工作，可以手动启动：

### Windows
1. 打开命令提示符（cmd.exe）
2. 进入到 brogueweb 目录：
   ```
   cd path\to\brogueweb
   ```
3. 运行：
   ```
   python -m http.server 8000
   ```
4. 在浏览器中访问：`http://localhost:8000/dist/`

### macOS
1. 打开终端
2. 进入到 brogueweb 目录：
   ```bash
   cd path/to/brogueweb
   ```
3. 运行：
   ```bash
   python3 -m http.server 8000
   ```
4. 在浏览器中访问：`http://localhost:8000/dist/`

---

## 常见问题

### 问：运行时显示"找不到Python"

**Windows 用户：**
- 需要安装 Python（推荐 3.10+）
- 访问 https://www.python.org/downloads/
- **安装时一定要勾选"Add Python to PATH"**

**macOS 用户：**
- 通常已预装，运行 `python3 --version` 检查
- 如果没有，用 Homebrew 安装：`brew install python3`

### 问：端口已被占用

脚本会自动尝试其他端口（8000-8010）。如果全部被占用，可手动指定：

```bash
python -m http.server 9000
```

然后访问 `http://localhost:9000/dist/`

### 问：游戏不能存档

这是网页版的限制。考虑编译原生 Windows 版本获得完整功能。

### 问：关闭终端后游戏停止

这是正常的。游戏运行需要保持服务器启动。

---

## 游戏内容

这是 **Brogue CE 完整中文汉化版**，包含：

- ✅ 完整的中文界面和菜单
- ✅ 怪物、物品、地形名称全中文
- ✅ 游戏消息和提示信息中文
- ✅ 所有游戏功能完整

---

## 文件说明

```
brogueweb/
├── run.sh              # macOS 启动脚本
├── run.bat             # Windows 启动脚本
├── dist/               # 游戏文件
│   ├── index.html      # 主页面
│   ├── index.js        # 游戏逻辑
│   ├── index.wasm      # 编译代码
│   └── index.data      # 游戏数据
└── README_PLAY.md      # 本文件
```

---

## 反馈与改进

如有问题或建议，欢迎提交反馈！

祝游戏愉快！🎮
