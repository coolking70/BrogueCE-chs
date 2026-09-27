# X3b：显示归一化进入录制与回放共同命令边界；详情力量需求 0（不移动生成流）

> **本地执行（Windows 轨）。X-2 §6 XN02、XN03。**

## 0. 规格

**`ai_docs/reports/x-2-survey.report.md` §6 XN02、XN03 是权威规格**：
> XN02：`G:2613–2622 executeCommand` 先 `finishTransientDisplay()` 再 `applyCommand`；`G:2799–2818 replayStep` 直接 `applyCommand` 无归一化；`G:2629–2648` 的 `item:use` 直接 `useArcanaItem` 绕开 `performPlayerAction` 收尾。
> flare 显示改临时可见性（`G:4383–4425`）→ `BoltTargeting.ts:25–40` 目标筛选 → 默认 cursor 变化。镜像夹具：quaff→flare tick→use→confirm，回放在第 3 条 OOS。
> XN03：`DetailGenerator.ts:357` `item.strengthRequired || 12` 把合法 0 当缺省；战斗 `Combat.ts:105–110` 与 CE `Combat.c:66–83` 用实际需求。

## 1. 范围

- **XN02**：把显示/瞬态归一化（`finishTransientDisplay` 等）放到**录制与回放共用的唯一命令边界**，覆盖全部命令类型（item use/throw/选物/确认、移动、自动行走、楼梯…）、单步/自动回放、seek、不同渲染帧间隔；
  守卫：同一录像在"命令间插入任意数量的显示帧"与"不插入"下目标、充能、时间、两流 RNG、结局完全一致；真坏记录仍准确 OOS；**不放宽 checkpoint 比较**
- **XN03**：详情伤害/数值使用与战斗共享的同一公式与实际力量需求（0 合法；仅在字段缺失时回退），保留未鉴定信息边界；补 0 需求/正需求/未鉴定三类详情守卫
- 黄金 trace 若翻红：单变量归因后按原方法重录并登记

## 2. 约束

📌 **撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；**不得改变 test:drift / 深层基线**；
**反查闭包含 p1_30、U24、U27、X2a、X2m、X2d、UR2/UR4 trace、DetailGenerator.test、ui_* 与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/x3b.report.md`。
