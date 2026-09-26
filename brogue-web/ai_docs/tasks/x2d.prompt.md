# X2d：附魔/解除诅咒卷轴按 CE（不移动生成流）

> **本地执行（Windows 轨）。X-1 剩余工作 §7.1 "X2-卷轴装备语义"。**

## 0. 规格

**`ai_docs/reports/x-1-survey.report.md` 的 §4 N03、N04、§7.1 是权威规格**（`bd40bbc0`）：

> N03：`G.canEnchantTarget → ItemUseCoordinator.ts:31–35` 武器护甲仅允许已装备的那件；`enchantEquippedItem` 只加 enchantment，未减 strengthRequired/增 timesEnchanted，
> 负值未升到非负便不解除诅咒；无符文物品另有 20% 随机授符文（**无 CE 依据**）。CE `Items.c:7824–7850、7892`：可选包内各合格物品、增 timesEnchanted、
> 武器护甲力量需求下降、无条件按 uncurse 处理，不随机授新符文
> N04：`removeCurseFromInventory` 用 find 只处理第一件，清诅咒且把负附魔置 0；CE `Items.c:7806–7808` 遍历全包，`uncurse:7740–7745` 只清 flag
> §7.1：包内所有合格附魔目标、力量/次数/诅咒/弹药组；去掉无 CE 依据的随机授符文；解除全包诅咒且保负 E；**UI 选物与回放一起守护**

## 1. 范围（**全部请自行核实 CE**）

- 附魔卷轴：可选目标集合按 CE（包内 WEAPON/ARMOR/RING/STAFF/WAND/CHARM 等合格类别，含未装备与投掷武器堆），每类效果按 CE（timesEnchanted++、
  武器护甲 strengthRequired--、法杖/魔杖/护符/戒指已由 W-7/U15b/U15c 接的部分保持）、uncurse 规则、ITEM_RUNIC 已有符文的揭示逻辑；**删除随机授符文**
- 解除诅咒卷轴：遍历全包，按 CE uncurse 只清诅咒标志，负附魔保留；消息/自动鉴定按 CE
- 背包 UI 选物、确认、取消，以及 U27 命令日志回放一并验证（选中未装备物品、取消附魔选择等）
- 黄金 trace（UR2 覆盖卷轴）若因正当行为变化翻红：单变量归因后按原方法重录并登记

## 2. 约束

📌 **任务书与 CE 冲突时以 CE 为准并写明**；**撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；
**不得改变 test:drift / 深层基线**；**反查闭包含 p1_30、U24、U01/U03、U27、UR2、W-7、U15b/c/d、scroll_effects、b_1*、invented_content_pool、p1_37 与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/x2d.report.md`。
