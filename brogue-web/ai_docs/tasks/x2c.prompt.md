# X2c：legacy 命中状态归属——盟友攻击不得把状态写到未受击玩家（不移动生成流）

> **本地执行（Windows 轨）。X-1 剩余工作 §7.1 "X2-legacy命中归属"。**

## 0. 规格

**`ai_docs/reports/x-1-survey.report.md` 的 §4 N02、§3 K25、§7.1 是权威规格**（`bd40bbc0`）：

> N02：自然目录 `src/data/monsters.json:49–51、218–220、1504–1506` 给 kobold/goblin/vampire 保留 confused/paralyzed（legacy onHitStatus）。`M:522–529` 构造器复制；
> 盟友攻击分支 :1505–1509 同时调用玩家状态 helper 和怪物状态 helper；`G.applyMonsterOnHitStatus:6062` 目标固定 `this.player`。
> 复现：seed1212，kobold 盟友打 rat → **玩家 confused 0→2**，rat 仍 0。另：rat 的 goldDropChance/itemDropChance 数据不进实例（M:305–306 默认 0）——**不能**声称按 JSON 掉金币
> §7.1：**逐自然物种核 CE 状态/免疫/MA 位**；确保盟友攻击不写未受击玩家；覆盖普通、几何、投掷/法伤等实际目标。**不得全清 legacy 表**

## 1. 范围（**全部请自行核实 CE**）

- 逐个带 legacy `onHitStatus` / `statusImmunities` / 掉落字段的自然物种，对照 CE monsterCatalog（flags、abilityFlags 的 MA_HIT_*、MA_CAUSES_*、DF_ON_DEATH、免疫）：
  CE 有对应能力 → 走 CE 能力出口（目标为实际受击者）；CE 无 → 标为 web 自创并按 D2 口径处理（不作用于任何人，数据留形），**逐物种写明依据**
- 所有命中路径（怪打玩家、怪打怪含盟友、几何攻击、投掷、法伤反射）的状态施加目标 = 实际受击者；`applyMonsterOnHitStatus` 按目标参数化
- legacy 掉落字段（goldDropChance/itemDropChance）与 CE item hopper 的关系写清，不改变当前"实例默认 0"的实际行为（除非 CE 依据）
- 若 kobold 等在 CE 本无状态命中，删除其实际生效但保留数据留形与守卫

## 2. 约束

📌 **任务书与 CE 冲突时以 CE 为准并写明**；**撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；
**不得改变 test:drift / 深层基线**；黄金 trace（UR2/UR3/UR4）若因正当行为变化翻红须单变量归因后按原方法重录并登记；
**反查闭包含 p1_30、U24、U01/U03、U06、U12a/b、U13、p4_*、w_*、invented_content_pool、monster_stats_effect 与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/x2c.report.md`。
