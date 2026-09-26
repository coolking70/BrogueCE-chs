# X2a：录像 checkpoint 提交时点与参考屏关闭入命令边界（不移动生成流）

> **本地执行（Windows 轨）。X-1 剩余工作 §7.1 第一项。**

## 0. 规格

**`ai_docs/reports/x-1-survey.report.md` 的 §4 N01 与 §7.1 "X2-录像提交时点" 是权威规格**（`bd40bbc0`），并延续 U27 合同（`ai_docs/reports/u-27.report.md`）：

> N01：正常浏览器 `GameCanvas.vue:279` 开启 `animationEnabled`；`G.executeCommand` 执行后立即 `recordInputEvent`，而 `beginAdvancement` 只建立推进迭代器、尚未完成怪物/环境回合；
> `replaySeek` 强制同步完成回合再比较 checkpoint → 动画录像必 OOS（seed424242 新局一条 wait 即复现）。另 `ReferenceOverlay.vue:27–31` 关闭发现屏不经 executeCommand。
> §7.1：动画完成后的 checkpoint；同步/动画/seek 一致；参考屏鼠标及 Escape 关闭入统一命令；保持确认/选物/自动行走合同；**真实浏览器新录像零 OOS**

## 1. 范围

- checkpoint（位置/深度/tick/回合/双流 RNG）在该命令的**全部推进完成后**记录；同步、动画分帧、seek 三条路径同一时点、同一结果
- 录像事件本身（命令 + 决策）仍在命令边界记录，不因动画产生重复/遗漏事件
- 参考屏（发现屏等）的鼠标关闭与 Escape 关闭走统一命令边界，回放 modal 分支不错位
- 验收：真实浏览器（动画开）录制混合序列（行走、等待、搜索、背包操作、确认/取消、发现屏开关、自动行走、楼梯）→ 导出 → 重载 → 逐条回放与 seek **零 OOS**；
  同 seed 动画开/关录像 checkpoint 逐条相等；故意篡改仍准确报 OOS；U27/UR4 既有断言不放宽
- 不改 U27 录像格式版本以外的语义；若 checkpoint 时点变化需要格式版本递增，旧版本录像按项目裁决直接拒绝

## 2. 约束

📌 **撞上守卫时改代码，不改守卫**；守卫靠旧规则才绿时先反事实证明、只修前提、交验收方裁决；**不得改变 test:drift**；
UR2/UR3/UR4 黄金 trace 若因正当变化翻红须单变量归因后重录并登记；
**反查闭包含 p1_30、U24、U00/U03、U27、UR1–UR4、p2_*、ui_*、ReplayControls/App/GameCanvas/ReferenceOverlay 源码读取守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/x2a.report.md`。
