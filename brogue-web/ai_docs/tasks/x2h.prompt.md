# X2h：自创内容退池的"不可触达"覆盖公开 test 模式（不移动正常生成流）

> **本地执行（Windows 轨）。X-1 剩余工作 §7.1 "X2-退池可达性"。**

## 0. 规格

**`ai_docs/reports/x-1-survey.report.md` 的 §4 N09、§7.1 是权威规格**（`bd40bbc0`）：

> N09：`BlueprintEngine.ts:673–710` 的 11 个自创蓝图仍被 `blueprintQualifies` 拒绝；`ItemLoader.ts:67–99` gen 池过滤退池内容——**正常自然生成退池有效**。
> 但 `components/MainMenu.vue:120` 公开 test 模式，`GenerationCoordinator:152 → G.generateTestDepth:1967` 建测试展陈，**按完整数据而非正常 gen 池放物**：
> D1 halberd；D2 wand_of_fire、wand_of_lightning；D3 scroll_of_amnesia；D4 potion_of_healing；D5 staff_of_light；D9 dagger+venom、dagger+vampirism、leather_armor+vitality ——
> **跨公开模式的不可触达要求未满足**
> §7.1：明确公开 test 模式合同；按真实菜单→测试层→物品操作验证 D2 历史物品/符文不成为未授权玩家内容；保正常池守卫，**勿重新放回 11 自创蓝图**

## 1. 范围

- 盘点 test 模式展陈中出现的全部物品/符文/怪物/蓝图，逐项标注 CE 原生 / web 自创（依据 D2 退池清单、`invented_content_pool`、`RETIRED_INVENTED_BLUEPRINT_IDS`、`excludeFromGeneration`）
- 按"项目开发阶段"合同处理：test 模式**不得产出自创内容**——把展陈中的自创物品/符文替换为对应的 CE 原生物品（保持测试展陈的教学/调试用途），或从展陈中移除；
  不删自创定义本身（D2 留形），不隐藏菜单入口（除非确无用途且写明理由）
- 守卫：从真实菜单进入 test 模式 → 遍历全部测试层 → 断言零自创内容（物品 identityId、runicType、蓝图 id）；正常模式守卫保持
- 若 test 模式的某些展陈依赖自创内容作为唯一示例，写明替换选择

## 2. 约束

📌 **撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；**不得改变 test:drift / 深层基线**（正常模式生成不动）；
**反查闭包含 p1_30、U24、invented_content_pool、B-4a/b、V 系列 test 模式相关、MainMenu/App 源码读取守卫与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/x2h.report.md`。
