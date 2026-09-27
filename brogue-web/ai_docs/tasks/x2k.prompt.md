# X2k：死亡即时收口、落物与复活候选按 CE（不移动生成流）

> **本地执行（Mac 轨）。X-1 剩余工作 §7.1 "X2-AI与生命周期"之死亡单元（X2j 偷窃携物出口、X2l 玩家反射致死已合并）。**

## 0. 规格

**`ai_docs/reports/x-1-survey.report.md` 的 §4 N10、§7.1 是权威规格**（`bd40bbc0`）：

> N10 死亡/落物/复活：`G.removeDeadMonsters:7590` 批量收口；`dropCarriedItem`/`resurrectAlly:9159` 仍用 web 候选/回退，与 **CE 立即 killCreature 及距离图口径**不同。
> 寄宿/学习/purgatory 存在，不再重复派"从零实现复活"。

## 1. 范围（**全部请自行核实 CE**）

- CE `killCreature`（Monsters.c 约 :4090 起）**即时**收口：死亡当下的 DF_ON_DEATH、`makeMonsterDropItem`（X2j 已提取）、领袖继任（U16）、寄宿释放、`MB_IS_DYING` 语义、从怪物列表移除的时点；
  web 当前"标记死亡→回合尾批量 removeDeadMonsters"与 CE 的可观察差异（同一回合后续行动能否与已死怪交互、死亡顺序、RNG 消耗顺序）逐条对齐
- 落物位置：CE `makeMonsterDropItem` 用 `getQualifyingPathLocNear` 等（距离图口径）按 CE
- 复活候选：CE `resurrectAlly`（Monsters.c 约 :2898）从 purgatory 选择 `totalPowerCount` 最高者、落位 `getQualifyingPathLocNear`；web 候选/回退与 CE 对齐
- 与 U16、X2j、X2l、X2g（潜没者静默移除）既有出口共用同一收口，不再分叉
- 若即时收口改变运行期 RNG 顺序：黄金 trace（UR2/UR3/UR4）单变量归因后重录并登记

## 2. 约束

📌 **任务书与 CE 冲突时以 CE 为准并写明**；**撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；
**不得改变 test:drift / 深层基线**（除非生成期死亡路径受影响——须归因）；
**反查闭包含 p1_30、U24、U01/U03、U06、U10、U11、U16、U17a、X2c、X2g、X2j、X2l、p1_24 死亡归宿、p4_*、w_* 与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift + 深层基线；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/x2k.report.md`。
