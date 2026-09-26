# X2f：投掷伤害数学按 CE（不移动生成流）

> **本地执行（Windows 轨）。X-1 剩余工作 §7.1 "X2-投掷数学"。**

## 0. 规格

**`ai_docs/reports/x-1-survey.report.md` 的 §4 N08、§7.1 是权威规格**（`bd40bbc0`）：

> N08：`Combat.resolveThrownWeapon:424–427` 重新 parseDamageString，再用 parts.clumping，**忽略已保存的 item.clumping**；乘 damageFraction 后 `Math.round`。
> CE `Items.c:6817–6819` `randClump(theItem->damage)` 并整数截断。近战 U13 黄金测试与投掷自动命中短路修复不能关闭这两项；**需同时核对数值与 RNG 调用数**
> §7.1：item 完整 range/clump、CE 定点截断、命中/免疫短路耗骰；防与近战/符文顺序互相覆盖

## 1. 范围（**全部请自行核实 CE**）

- CE `hitMonsterWithProjectileWeapon`（Items.c 约 :6780–6860）全流程：命中判定（含自动命中条件）、`randClump(item->damage)`（使用实例的 lowerBound/upperBound/clumpFactor）、
  力量/附魔修正（`netEnchant`、`damageFraction` 定点）、整数截断顺序、偷袭/麻痹倍率、护甲符文（U15d-2 的 melee=false 分支）、免疫/无敌短路时的 RNG 消耗
- 与近战 `attack()` 共享的公式复用同一实现（U13），不得复制一份再分叉
- 黄金值：CE C oracle 编译原函数，对若干武器/附魔/力量/目标组合给出伤害分布与 RNG 调用次数
- 黄金 trace（UR2 含投掷）若因正当行为变化翻红：单变量归因后按原方法重录并登记

## 2. 约束

📌 **任务书与 CE 冲突时以 CE 为准并写明**；**撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；
**不得改变 test:drift / 深层基线**；**反查闭包含 p1_30、U24、U13、U15d-1/2、b_2 投掷、UR2 trace、CombatFormulas 与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/x2f.report.md`。
