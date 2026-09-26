# X2e：补齐 CE 其余六种护符（数据/效果/冷却/显示/保存，再入池）（⚠️ 移动生成流）

> **本地执行（Mac 轨）。X-1 剩余工作 §7.1 "X2-原生效果分族"之护符族。**

## 0. 规格

**`ai_docs/reports/x-1-survey.report.md` 的 §4 N07、§7.1 是权威规格**（`bd40bbc0`）：

> N07：`CharmModel.ts:3–12` / `ItemLoader.genCharms` 只有六种；对 `V/GlobalsBrogue.c:713–726`，**另外六种护符未实现**（U15c 已登记：LEVITATION、SHATTERING、GUARDIAN、TELEPORTATION、RECHARGING、NEGATION）
> §7.1：**每族先数据/状态/交互/显示/保存，再讨论恢复自然池**

## 1. 范围（**全部请自行核实 CE**）

- 六种护符逐个按 CE `useCharm`（Items.c 约 :7507–7581）与 `charmEffectTable`：效果量/持续期/冷却公式（fixpt，复用 `CharmModel` 的 POW 表与 `fpPow`）、附魔、充能卷轴/消魔作用
  - levitation（悬浮状态）、shattering（碎墙，复用 U15a 碎墙卷轴原语）、guardian（召唤谱影守卫，复用 U16/U15d 谱影生命周期）、
    teleportation（随机传送，复用现有 teleport 选择与提交）、recharging（给法杖充能，复用 W-6 原语）、negation（消魔，复用消魔卷轴原语）
  - **复用既有原语，不另写一套**
- 目录按 CE charmTable 顺序与频率加入 `genCharms`（12 种），CE 出生附魔已由 U15c 实现；机器 CHARM 请求（U05）同步受益
- 详情/i18n 按 CE 数值；U01 字段合同；不做旧存档迁移

## 2. 生成流

先 drift + 深层基线记录 → 单变量归因（数据与效果（不入池）、目录顺序/频率入池各一段）→ 独立守卫（CE C oracle：效果量与冷却黄金值）→ 一次重捕获（浅层与深层分别）。
黄金 trace（UR2/UR3/UR4）若翻红：单变量归因后按原方法重录并登记。📌 用户裁决：生成变化不是卡点。

## 3. 约束

📌 **任务书与 CE 冲突时以 CE 为准并写明**；**撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；
**反查闭包含 p1_30、U24、U01/U03、U05、U15a/c、U16、U22 Discoveries、W-6/7/13、b_4a、w_5、invented_content_pool、UR2–UR4 trace 与所有读源码守卫**；不产生 CRLF。

## 4. 门禁与报告

R∪S + build + test:drift + 深层基线；**全量 npm test 完整跑完**；最终复跑声明；基线前后哈希。报告 `ai_docs/reports/x2e.report.md`。
