# X2j：偷窃怪（MA_HIT_STEAL_FLEE）搬物与永久逃跑，普通怪状态机缺口（不移动生成流）

> **本地执行（Mac 轨）。X-1 剩余工作 §7.1 "X2-AI与生命周期"之 AI 单元。**

## 0. 规格

**`ai_docs/reports/x-1-survey.report.md` 的 §4 N10、§7.1 是权威规格**（`bd40bbc0`）：

> N10 盗窃/一般AI：`M:1257–1260、1872` 改 FLEEING/消息，**未实现 C/Combat.c:480–510 的选择包内物→carriedItem→MODE_PERM_FLEEING**。
> U12b 只补 mode 及盟友子流程，不能等同完整普通怪状态机。
> §7.1：盗窃搬物/永久逃跑、一般怪状态机、blink 缓存（建议拆 AI、死亡、bolt 三单元——本轮为 AI）

## 1. 范围（**全部请自行核实 CE**）

- CE `specialHit` MA_HIT_STEAL_FLEE（Combat.c 约 :480–510）：从玩家背包选物（CE 选物规则：排除已装备？数量拆分？按 CE）、放入 `carriedItem`、`MODE_PERM_FLEEING`、消息；
  偷窃怪被杀/被抓时掉落携带物；逃出视野后的行为（CE 是否消失/逃离楼层——按 CE 实际代码，如 monkey 逃跑后 `MB_...`）
- CE `updateMonsterState`（Monsters.c 约 :1700–1810）普通怪完整状态转换：睡眠→唤醒（噪声/潜行）、追踪/游荡/逃跑切换条件、MODE_PERM_FLEEING 保持、恐惧/血量阈值、盟友分支已由 U12a/b 覆盖——逐条对照 web，补齐缺口
- blink 缓存（U07 登记的学习/缓存边界，若 X-1 仍列为缺）
- U12b 登记的 Items.c:5193/6793 两处 PERM_FLEEING 检查
- 自然交互证据：真实 monkey 偷窃 → 逃跑 → 追杀取回物品；存读档中途

## 2. 约束

📌 **任务书与 CE 冲突时以 CE 为准并写明**；**撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；
**不得改变 test:drift / 深层基线**（运行期行为；若生成期怪物初始状态受影响须归因并重捕获）；黄金 trace 若翻红须单变量归因后按原方法重录并登记；
**反查闭包含 p1_30、U24、U01/U03、U07、U10、U12a/b、U14a、U16、X2c、ai_*、p4_*、w_16/18/23 与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift + 深层基线；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/x2j.report.md`。
