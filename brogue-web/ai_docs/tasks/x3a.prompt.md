# X3a：已完成死亡事务的对象不得参与活体判断（不移动生成流）

> **本地执行（Mac 轨）。X-2 §6 XN01。**

## 0. 规格

**`ai_docs/reports/x-2-survey.report.md` §6 XN01 是权威规格**：
> `G:7715–7759` 同步落物/DF 并置 `deathProcessed`，按 CE 延后物理摘链；`TimeCoordinator.ts:353–357` 回合前清扫，`:464–466` 尾声清扫——名单中留有"hp=0、事务已完成、不占格"对象是正常中间态。
> 问题：`MonsterAI.ts:50–65,85–91` 恐惧扫描遍历 `[player,...monsters]` 未过滤已死目标。CE `Monsters.c:1753–1762` 用 `iterateCreatures`，其 `:925–947` 初始化与前进均跳过 `MB_HAS_DIED`。
> 探针 seed22013：死亡 revenant 仍令 rat FLEEING；清扫后恢复 HUNTING；同回合走位与主流 RNG 计数不同

## 1. 范围（**全部请自行核实 CE**）

- 提供与 CE `iterateCreatures` 等价的活体迭代器（跳过已完成死亡事务者），并**全仓盘点**所有遍历 `game.monsters`/`[player,...monsters]` 做活体判断的消费者（恐惧、寻敌、盟友选敌、气味、召唤计数、群体效果、领袖/随从、目标选择、光源、UI 可见等），
  按 CE 各处实际用的迭代方式（iterateCreatures vs 直接链表）逐一对齐；**保留**死亡事务期间的占用语义与延后摘链时点（X2k）
- 守卫：同回合已死目标不参与恐惧/寻敌等；位置/RNG 与清扫后等价；寄宿释放、爆炸连锁、复活、重入交叉用例
- 黄金 trace 若翻红：单变量归因后按原方法重录并登记

## 2. 约束

📌 **任务书与 CE 冲突时以 CE 为准并写明**；**撞上守卫时改代码，不改守卫**；**不得改变 test:drift / 深层基线**；
**反查闭包含 p1_30、U24、U12a/b、U16、X2j、X2k、X2l、ai_*、p4_*、w_* 与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift + 深层基线；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/x3a.report.md`。
