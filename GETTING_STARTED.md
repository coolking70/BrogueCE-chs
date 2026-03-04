# 🚀 快速开始指南

## 中文 / English

---

## 📱 中文版 - 快速开始

### 方案 1：网页版（推荐，无需安装）

**👉 [点击这里开始游戏](https://coolking70.github.io/BrogueCE-chs/)**

✅ **优点：**
- 完全免费
- 无需安装任何软件
- 支持所有平台（Windows、Mac、Linux、iPhone、iPad、Android）
- 加载后可离线运行
- 自动保存进度（存储在浏览器）

**⚙️ 系统要求：**
- 任何现代浏览器（Chrome、Firefox、Safari、Edge）
- 联网下载游戏（之后可离线运行）
- 最低 100MB 可用空间

**📖 使用说明：**
1. 点击上面的链接
2. 等待游戏加载（第一次加载 3-5 秒）
3. 按 `?` 查看按键说明
4. 开始游戏！

---

### 方案 2：Android 应用

**📦 下载步骤：**

1. **获取 APK 文件**
   - 访问 [GitHub Releases](https://github.com/coolking70/BrogueCE-chs/releases)
   - 下载最新的 `app-debug.apk` 文件
   - 或从 [Actions Artifacts](https://github.com/coolking70/BrogueCE-chs/actions) 下载

2. **安装到手机**
   - **方法 A（最简单）**
     - 将 APK 文件传输到手机（USB、邮件、QQ 等）
     - 打开 APK 文件
     - 点击"安装"

   - **方法 B（使用 adb）**
     ```bash
     adb install app-debug.apk
     ```

3. **首次启动**
   - 手机可能提示"未知来源应用"
   - 设置 → 安全 → 启用"未知来源"
   - 再次点击 APK 文件安装

**⚙️ 系统要求：**
- Android 5.0 及以上
- 最低 50MB 可用空间

**✨ 优点：**
- 原生应用体验
- 更快的响应速度
- 可锁屏后继续游戏
- 完全离线运行

---

### 方案 3：本地编译

如果你是开发者，可以自己编译：

```bash
# 1. 克隆仓库
git clone https://github.com/coolking70/BrogueCE-chs.git
cd BrogueCE-chs

# 2. 构建 Web 版本
cd brogueweb
bash build_web.sh

# 3. 本地测试
bash serve.sh 8080
# 打开浏览器：http://localhost:8080

# 或构建 Android APK
bash build_android.sh
# APK 位置：android/app/build/outputs/apk/debug/app-debug.apk
```

详见 [README.md](README.md) 和 [brogueweb/README.md](brogueweb/README.md)

---

## 🎮 游戏基础

### 基本按键

| 按键 | 功能 |
|------|------|
| **方向键** / **HJKL** | 移动/攻击 |
| **G** | 拿起物品 |
| **D** | 丢弃物品 |
| **E** | 装备物品 |
| **I** | 打开物品栏 |
| **A** | 自动探索 |
| **S** | 查看统计 |
| **R** | 重新开始 |
| **Q** | 退出游戏 |
| **?** | 查看按键说明 |

### 游戏目标

1. 深入地牢，寻找大量的金币和装备
2. 打败怪物，避免死亡
3. 达到地牢的最深处（通常是第 26 层）
4. 找到传奇物品和宝物

### 提示

- 🏃 **逃跑**总是一个有效的策略
- 💰 **集中寻找金币**会让你更强大
- 🧻 **识别药水和卷轴**对生存至关重要
- 🚪 **利用地形**躲避敌人
- 💾 **定期保存游戏**（自动保存）

---

## ❓ 常见问题

**Q: 游戏会卡顿或很慢吗？**
A: 不会。WebAssembly 性能很好，除非你的设备特别老旧（10 年以上的手机）。Web 版本和 Android 版本速度几乎相同。

**Q: 我的游戏进度会保存吗？**
A: 是的，Web 版本使用浏览器的本地存储自动保存。Android 版本也会保存。

**Q: 可以导入/导出存档吗？**
A: 目前不支持，但我们正在开发此功能。

**Q: 可以玩多人游戏吗？**
A: 不支持。这是单人游戏。

**Q: 游戏需要网络连接吗？**
A: 第一次加载需要下载游戏文件。之后可以完全离线运行。

**Q: 支持什么语言？**
A: 目前支持：
- 🇨🇳 中文简体（默认）
- 🇬🇧 英文

**Q: 如何切换语言？**
A: 游戏菜单中选择"设置"（Settings）→ 语言（Language）

**Q: 游戏是免费的吗？**
A: 是的，完全免费。支持开源开发！

**Q: 我找到了 bug，该怎么办？**
A: 请在 [GitHub Issues](https://github.com/coolking70/BrogueCE-chs/issues) 中报告。

---

## 🔗 有用的链接

| 资源 | 链接 |
|------|------|
| **在线游戏** | https://coolking70.github.io/BrogueCE-chs/ |
| **GitHub 仓库** | https://github.com/coolking70/BrogueCE-chs |
| **官方网站** | https://www.brogue.app |
| **上游项目** | https://github.com/tmewett/BrogueCE |
| **Wiki 与指南** | https://brogue.fandom.com |

---

## 📞 获取帮助

- **游戏问题**：查看 [Wiki](https://brogue.fandom.com)
- **技术问题**：[报告 Issue](https://github.com/coolking70/BrogueCE-chs/issues)
- **汉化问题**：[讨论翻译](https://github.com/coolking70/BrogueCE-chs/issues)

---

## 🎯 推荐游玩流程

1. **新手玩家**
   - 先玩 Web 版本（加载快，方便）
   - 体验 3-5 局，学习基本操作
   - 如果喜欢，可以下载 Android 版本

2. **有经验的玩家**
   - 直接使用 Android 版本（更沉浸式）
   - 或继续用 Web 版本（跨平台）

3. **开发者**
   - 本地编译（修改源代码）
   - 提交改进（Pull Request）

---

**祝你游戏愉快！🎮✨**

*Last updated: 2026-03-04*
