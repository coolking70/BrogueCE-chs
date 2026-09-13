# brogue-web 还原度攻坚路线图（2026-09-13 制定）

基线文档：`parity_gap_analysis.md`（差距清单）+ `parity_gap_review.md`（核验与更正）。
**`parity_plan.md` 与 `task.md` 已过期，不再作为依据。**

## 排序原则

1. **先建验收网，再动引擎。** 目前零测试，任何公式级改动都无法证明不回退。
2. **数据 > 调度 > 行为 > 生成器。** 数据断层（怪物属性、horde、开局装备）改动量最小、体感收益最大；tick 调度是后续一切速度机制的地基；地牢生成器是最大工程，放最后。
3. **每个任务必须能独立验收**，且不依赖后续任务才能看出效果。

## 里程碑

| 阶段 | 内容 | 预估 | 门禁 |
|---|---|---|---|
| **P0** | 测试与验收基建 | 小 | `npm test` 绿，冒烟 2000 回合不崩 |
| **P1** | 数据与开局地基（本轮重点） | 中 | 怪物有真实 acc/def/regen/speed；D1-D26 各层陆生怪正常刷出；开局有匕首/皮甲/飞镖/口粮 |
| **P2** | tick 制时间系统 | 中 | 豺狼双倍速、食人魔慢攻、haste/slow 真实生效 |
| **P3** | 战斗与物品行为真实化 | 大 | 符文走 CE 概率公式；9 个占位卷轴落地；法杖成长曲线 + 瞄准 |
| **P4** | 怪物行为（远程/召唤/分裂/自爆/特殊怪修正） | 大 | 炮塔与施法者远程生效；Warden 不可杀 |
| **P5** | 地牢生成器与环境重写 | 最大 | 走廊/环路/四类湖泊/promoteTile |
| **P6** | 存档-回放-盟友-收尾 | 中 | 同 seed 读档后楼层内容不变 |

本文档只详细展开 **P0 与 P1**（可立即外包执行）。P2 起在前一阶段验收后再细化。

---

# P0：测试与验收基建

## P0-1 引入 vitest + 纯函数黄金测试

**为什么**：`CombatFormulas.ts` 是全项目移植最忠实的部分，但也是后续最容易被改坏的部分。必须先用 CE 的实际数值锁死。

**改什么**
- `package.json` 加 `vitest`（devDep）与 `"test": "vitest run"`、`"test:watch": "vitest"`。
- 新建 `src/engine/Combat/CombatFormulas.test.ts`，对 `strengthModifier / netEnchant / accuracyFraction / defenseFraction / hitProbability / armorProtection / clumpedRoll` 写黄金值断言。黄金值从 `BrogueCE-master/src/brogue/Combat.c` 与 `PowerTables.c` 推导，**每条断言的注释必须写明 CE 源文件与行号**。
- 新建 `src/engine/Random.test.ts`：同 seed 连续取 1000 个数，快照比对，锁死 RNG 序列。

**验收**
- `npm test` 全绿，`npm run build` 仍全绿。
- 故意把 `accuracyFraction` 的 1.065 改成 1.06，测试必须失败（执行者需在报告中贴出这次反向验证的输出）。

## P0-2 headless 冒烟与确定性 harness

**为什么**：`Game.ts` 除 `Game.ts:4320` 一行 `window` 守卫外不依赖 DOM，可直接在 node 里跑。这是唯一可行的自动化验收手段。

**改什么**
- 新建 `src/test/harness.ts`：导出 `createHeadlessGame(seed, mode)`（内部完成 i18next 的最小 init，所有文案走 `defaultValue`）与 `runTurns(game, n, policy)`，policy 默认为"随机合法方向移动 + 遇敌攻击"。
- 新建 `src/test/smoke.test.ts`：
  - 固定 seed 跑 2000 回合不抛异常；
  - 同 seed 两次生成，D1-D5 的地图 terrain 指纹（逐格 terrain 的哈希）必须一致；
  - 断言 D1-D26 每层生成后 `monsters.length > 0`（**当前会失败，这是 P1-2 的红灯测试，允许先标 `.fails()` 或 skip 并注明**）。

**验收**
- `npm test` 绿（红灯测试显式标注）。
- 报告中给出：2000 回合跑完耗时、期间触发的日志条数、有无 unhandled rejection。

---

# P1：数据与开局地基

> 四个任务彼此独立，可并行；但都必须在 P0 合入之后开始。

## P1-1 合并 `monsters_ce2.json` 的真实属性

**背景**：运行时用的 `monsters.json`（67 条）没有 `accuracy/defense/regen/moveSpeed/attackSpeed`，`Monster.ts:104-109` 全落默认值。带全部真实数值的 `monsters_ce2.json`（67 条）是死文件，全仓库无引用。后果：`CombatFormulas` 里忠实移植的 `0.987^defense` 永远等于 1，troll 不回血、豺狼不加速。

**改什么**
- 写一次性脚本（放 `scripts/merge_monster_stats.cjs`，可提交），以 `id` 为键把 ce2 的 `accuracy / defense / regen / moveSpeed / attackSpeed` 合并进 `monsters.json`。
- **冲突处理规则（必须严格遵守）**：`monsters.json` 现有的 `minDepth / maxDepth / behaviorFlags / abilityFlags / statusImmunities / statusResistTurns / onHit* / goldDropChance / itemDropChance / description / color` **一律保留，不被 ce2 覆盖**。只新增上述 5 个数值字段。
- 合并后与 `BrogueCE-master/src/brogue/Globals.c:1025` 的 `monsterCatalog`（**不在 variants/GlobalsBrogue.c**） **逐条复核这 5 个字段**，列出所有不一致项并以 CE 为准修正。
- 删除 `src/data/monsters_ce.json`（已知含损坏数据）与 `src/data/monsters_ce2.json`（合并后即死）。
- `Monster.ts` 的 `?? 100 / ?? 0` 默认值保留作兜底，但新增一条构建期校验：任何缺这 5 个字段的条目在 `initConsumables` 同级的加载点 `console.warn`。

**验收**
- 新增 `src/data/monsters.test.ts`：断言 67 条**全部**具备 5 个字段且在合理区间（accuracy 0-300、defense 0-200、moveSpeed/attackSpeed 均为 100 的倍数或 CE 原值）。
- 抽查断言：`rat` acc=80 def=0 regen=20；`jackal` moveSpeed=50；`ogre` attackSpeed=200；`troll` regen>0。数值以 CE `GlobalsBrogue.c` 为准，断言注释注明行号。
- 报告中给出"复核 CE 后修正了哪些条目"的完整清单。

## P1-14 饥饿系统的 CE 行为补全（P1-4 列出、未实现）

P1-4 只做了核心四条偏差，以下 CE 行为仍缺（均附 CE 出处）：

- 瘫痪（paralyzed）期间不消耗 nutrition（`Time.c:2214-2215`）
- 携带 Amulet of Yendor 时 nutrition 仅 20% 概率消耗（`Time.c:2216`）
- nutrition ≤ 1 且包内有食物时强制进食（`Time.c:949-963`）
- 饥饿提示在无食物时追加 "and have no food"（`Time.c:930-934`）
- 不够饿时进食提示 "not yet hungry"（`Items.c:7482`）
- 回血速率受 `regenerationBonus`（再生戒指附魔）修正
  （`Items.c:8742-8745`、`PowerTables.c:134`）——依赖戒指系统，见 §3.2

另：web 自创的 `regenerating` 状态（CE 无 `STATUS_REGENERATING`）被保留，
加速幅度沿用旧实现的 0.6 倍回满时间。属 web 扩展，重构时需决定去留。

## P1-15 `isProtected` 接入实际生效点（P1-8a 建立字段但无消费方）

P1-8a 给 `Item` 加了 `isProtected`（protect 卷轴设置、存档持久化），但**当前没有任何
游戏机制读取它**。应接入的点：

- **防酸怪腐蚀**：`Monster.ts:434` 附近，`MA_HIT_DEGRADE_ARMOR` 类怪物直接
  `enchantment -= 1`，未检查 `isProtected`。CE 中被保护的装备豁免此效果。
- **防负附魔**：CE 的 `checkForDisenchantment` 豁免。web 尚无该系统，
  需与 §3.4 的鉴定/诅咒系统一并做。

## P1-16 剩余 3 个占位卷轴（需新系统支撑）

- `negate_burst` → CE `negationBlast`（Items.c:8004）：剥夺范围内生物的魔法能力
  与装备附魔，需要"魔法剥夺"系统
- `sanctuary_burst` → CE（Items.c:7941）：在玩家周围铺设怪物无法进入的地形，
  需要地形铺设能力
- `shatter_burst` → CE `crystalize(9)`（Items.c:8007）：把半径内的墙变成水晶墙，
  需要地形改造 + 视野重算

另：**`amnesia` 是 web 自创，CE 无此卷轴**（parity_gap_analysis.md §10.4）。
P1-8a 按指示未动。删除与否是产品决策，待定。

## P1-12 水生 horde 的落点匹配（P1-2b 忠实实现 CE 约束后的副作用）

CE 的 horde 有 `spawnsIn` 字段（如 EEL/KRAKEN 为 DEEP_WATER），`randomMatchingLocation`
会把它们落进对应地形。web 的开局铺怪落点池只收集普通 `FLOOR` 格，周期刷怪也排除水格，
于是 `hordeFitsTerrain` 恒假 → failsafe 重抽跳过，**水生 horde 两条路径都刷不出来**。

需要给落点收集补"按 spawnsIn 匹配的地形格"来源。注意这与 §5 的湖泊生成相关——
当前深水只有 0-2 团 blob，即使落点匹配修好，水生怪的出现率仍会偏低。

## P1-13 修复 monster_stats_effect.test.ts 的统计脆弱性

`monster_stats_effect.test.ts:194` 断言 `legacy.hits === legacy.attacks` 严格相等，
但 `Monster.ts` 的游走分支使用未播种 `Math.random()`，且 `Game.ts` 的幻态绊趔
（hallucinating 35% 偏转移动）会把"预期攻击"偏成移动，使命中数少于攻击数。
实测在 P1-1 基线上即偶发失败（143 vs 146、185 vs 186），复跑即绿。

**这对自动化循环是实际风险**：偶发失败会让验收误判一个好轮次。
改为断言比率区间（如 hits/attacks > 0.95）而非严格相等。
根治要等 `Math.random()` 收进 seeded rng（见 P6 前置条件）。

## P1-7 怪物伤害记法修正（**本轮验收发现，当前最严重的数据缺陷**）

**症状**：`monsters.json` 的 `damage` 把 CE 的 `{min,max}` 直接写成了 `"MINdMAX"`，
但 `Combat.parseDamageString("XdY")` 的语义是 `min=X, max=X*Y`。于是 **43/67 只怪物
伤害被放大，平均 4.4 倍，最高 17 倍**：

| 怪物 | web 记法 | web 实际伤害 | CE 伤害 | 均值倍数 |
|---|---|---|---|---|
| dragon | `25d50` | **25-1250** | 25-50 | 17.0x |
| tentacle_horror | `25d35` | 25-875 | 25-35 | 15.0x |
| underworm | `18d22` | 18-396 | 18-22 | 10.3x |
| kraken / revenant | `15d20` | 15-300 | 15-20 | 9.0x |
| troll | `10d15` | **10-150** | 10-15 | 6.4x |
| ogre | `9d13` | **9-117** | 9-13 | 5.7x |

玩家满血 30 HP——**一只 ogre 或 troll 的单次攻击就能把玩家秒杀数次**。这是与
P1-5 武器表完全同类的错误（`{min,max}` 被误写为 `MINdMAX`），只是发生在怪物侧。

**改法**：与 P1-5 一致，改用 `1dN+M` 记法（`N = max−min+1`，`M = min−1`），
使 `parseDamageString` 解析出的 min/max 与 CE 一致且 clumping=1。
注意 CE 怪物的 clumpFactor 并非全为 1（如 eel `{3,7,2}`、ogre `{9,13,2}`），
但 `Combat.ts` 当前硬编码 clumping=1 忽略该值，故本任务先对齐 min/max，
clumpFactor 待 clumping 接线时一并处理（记入 P3）。

**另有 12 只 CE damage 为 `{0,0,0}`（不攻击）的怪物**，web 写成占位 `"1d1"`
（bloat / 各类 totem / turret / wisp / sentinel / phylactery / phoenix_egg 等），
改 0 会牵动 Combat 的最小伤害下限逻辑，需连同处理。

**优先级**：应排在 P1-2 之前。当前中深层怪物的伤害数值是错的，
任何基于实战的平衡观察都不可信。

## P1-2 重新提取 `hordes.json`（**当前最严重的单点缺陷**）

**背景**：CE `hordeCatalog_Brogue`（`GlobalsBrogue.c:744` 起，至 `};` 共 175 条）中常规可刷 58 条；`hordes.json` 只有 132 条，常规可刷仅 **15 条**，且构成为 `RAT×2 KOBOLD×2 JACKAL×2 EEL×2 VAMPIRE_BAT BOG_MONSTER×2 NAGA SALAMANDER KRAKEN×2` —— 深度 5 和 10 各只有 4 条可用且以水生怪为主。**goblin/ogre/troll/wraith 等陆生主力从不自然刷出**，中深层地牢事实上接近空场。

**改什么**
- 写解析脚本 `scripts/extract_hordes.cjs`，从 `GlobalsBrogue.c` 的 `hordeCatalog_Brogue[]` 完整提取 **175 条**，字段：`leader / members[{type,minCount,maxCount}] / minLevel / maxLevel / frequency / spawnsIn / machine / flags`。注意 CE 的结构体是位置参数且尾部字段可省略，**省略即默认值**（`spawnsIn=0`、`machine=0`、`flags=0`），不要把省略当 null 丢弃。
- `Game.ts:711-723` 的 flag 过滤**保持不变**（它是忠于 CE 的），只需确认新数据进来后常规池 ≈58 条。
- `Game.ts:730` 的均匀随机改为 **frequency 加权抽取**（CE `pickHordeType`：在候选集中按 frequency 累加权重抽样）。删掉那条 `Should be weighted random` 注释。
- 补 **out-of-depth**：CE 有 10% 概率用 `depth + rand(1, 3)` 的档位抽 horde（带 `HORDE_NEVER_OOD` 的候选排除）。
- 补 **periodic spawn fuse**：每层生成时设 `monsterSpawnFuse = rand(125, 175)`，归零时刷一个 horde 并重置。CE 参考 `Time.c` 的 `monsterSpawnFuse` 与 `spawnPeriodicHorde`。

**验收**

> 2026-09-14 更新（P0-2 实测修正）：原计划的"每层 `monsters.length > 0`"红灯断言**不成立**——
> 每层固定刷 3-5 个 horde，池非空即不会有空层，该断言恒真。真正的量化指标是**物种覆盖**：
> 当前常规 horde 池（领袖+成员）只能产出 **9 个物种**（BOG_MONSTER / EEL / JACKAL / KOBOLD /
> KRAKEN / NAGA / RAT / SALAMANDER / VAMPIRE_BAT），占 67 种的 13%。P0-2 逐层表里出现的
> Spider / Pixie / Dragon / Golem / Lich / Wraith 等**全部来自笼子与蓝图机关**——
> 即 CE 中属于特殊/俘虏/机关的内容，在网页版被迫承担了常规生态的职能。

- `hordes.json` 条数 = 175；flag 过滤后常规池条数 ≥ 55。
- **常规 horde 池（领袖+成员）可产出的物种数 ≥ 40**（当前 9）。这是本任务的核心指标。
- 新增 `src/data/hordes.test.ts`：对 D1/D3/D5/D8/D12/D17/D22/D26 各断言"可用 horde 数 ≥ 8"且"领袖种类中陆生怪占比 > 50%"。
- 加权正确性测试：固定 seed 抽 10000 次 D5 horde，统计频次与各 horde 的 frequency 比例偏差 < 5%。
- 用 P0-2 的 harness：D1-D26 逐层生成，打印每层怪物种类与数量表，**贴进报告**。这张表是人工验收的主要依据。

## P1-3 开局装备（**最小改动、最大体感**）

**背景**：`Game.ts:272-318` `startNewGame()` 里**没有任何 `inventory.addItem`**，玩家赤手空拳、无甲、无口粮开局。CE（`RogueMain.c:420-443`）给：口粮 ×1、匕首（已鉴定+已装备）、飞镖 ×15、皮甲（已鉴定+已装备）。

**改什么**
- `startNewGame()` 末尾（`new Player(...)` 之后、`generateDepth` 之前）按 CE 顺序发放：口粮 → 匕首（`enchantment=0`、清除 cursed/runic、`identify`、`equip`）→ 飞镖 ×15（同样清干净并 identify）→ 皮甲（同上，equip）。**发放顺序必须与 CE 一致**，因为它影响 RNG 消耗顺序。
- 飞镖需要 `weapons.json` 新增 `dart` 条目（CE：`{5, 3, 10, ...}` 系，具体数值查 `GlobalsBrogue.c` 的 `weaponTable`）。若当前 `Item` 模型不支持 `quantity` 堆叠，**本任务只做到"背包里有 15 支飞镖"**，投掷命中公式留给 P3，并在报告中显式说明这一边界。
- easy/wizard 模式的属性覆盖逻辑保持不变。

**验收**
- 新增测试：新开局后 `player.inventory` 含 4 类物品；`equippedWeapon.id === 'dagger'`、`equippedArmor.id === 'leather_armor'`；两者 `isCursed === false`、`enchantment === 0`、已 identified。
- 手动：起新局，背包面板能看到 4 项，匕首与皮甲标为已装备。

## P1-5 武器表全面对齐 CE（**P1-3 验收时新发现，优先级高**）

**背景**：`parity_gap_analysis.md` §3.1 只数了武器条数（15 vs 12），从未核对数值。P1-3 验收时实测
`weapons.json` 与 CE `Globals.c:1582` 的 `weaponTable` **逐条不符**：

| 武器 | web力量 | CE力量 | web伤害 | CE伤害 | 均值倍差 |
|---|---|---|---|---|---|
| dagger | 10 | 12 | 1d4 | 3-4 | 1.4x |
| whip | 10 | 14 | 1d4 | 3-5 | 1.6x |
| rapier | 11 | 15 | 1d6 | 3-5 | 1.1x |
| sword | 12 | 14 | 2d4 | 7-9 | 1.6x |
| mace | 13 | 16 | 2d5 | 16-20 | **3.0x** |
| broadsword | 17 | 19 | 3d5 | 14-22 | 2.0x |
| war hammer | 19 | 20 | 4d5 | 25-35 | **2.5x** |

**全部 strengthRequired 偏低 1-4 点，全部伤害偏低 1.1-3.0 倍**（只有 dart 与 war pike 的力量值正确）。

**连带影响（这是它优先级高的原因）**：
- CE 匕首需求力量 12 = 玩家初始力量，是刻意的"恰好匹配"；web 的 10 白送玩家 +2 富余 → +0.5 netEnchant → 约 3% 命中加成。
- CE 好符文触发率的修正项是 `1 − min(0.99, 平均基础伤害/18)`。基础伤害错 2-3 倍，**P3 的符文公式即使照搬 CE 也算不对**。所以本任务必须排在 P3 之前。

**改什么**：按 `Globals.c:1582` 起的 weaponTable 逐条修正 12 件武器的 `strengthRequired` 与伤害范围；
注意 CE 的 `randomRange{min,max,clumpFactor}` 第三项是集中系数，web 的 `"XdY"` 记法需同时表达 min/max/clumping
（`Combat.parseDamageString` 的 clumping 目前被 `Combat.ts` 硬编码为 1 忽略——见 P0-1 报告不符项 #3，一并处理）。
护甲表（`armors.json`）同样需要对照 `armorTable` 核一遍。

**验收**：新增 `src/data/weapons.test.ts`，对全部 12 件武器断言 str 与伤害 min/max 与 CE 一致（注释注明 Globals.c 行号）。

## P1-6 两处小回归修复（P1-3 与 P1-5 各引入一处）

**① 存档快照丢 quantity**：`GameSnapshotItem`（`Game.ts:37`）不序列化 `quantity`，
导致**读档后 15 支飞镖回落为 1 支**。改 `toSnapshot`/`loadSnapshot` 两处各加一行，
补一条存读档往返测试。

**② 详情面板伤害显示错**：`DetailGenerator.ts` 的本地 `parseDamage` 正则是 `(\d+)d(\d+)`，
不识别 P1-5 引入的 `+Z` 后缀，导致物品详情面板每件武器都显示错伤害——
mace `1d5+15` 显示 `1~5`（应 `16~20`）、war hammer `1d11+24` 显示 `1~11`（应 `25~35`）。
战斗结算不受影响（走 `Combat.parseDamageString`，解析正确），是纯展示层缺陷。
**正确修法不是补正则，而是直接复用 `Combat.parseDamageString`**，消除这个重复实现——
DetailGenerator 里维护第二套伤害解析本身就是缺陷根源。补一条断言 `1dN+M` 显示正确的测试。

## P1-4 饥饿与回血对齐 CE

**背景**（见 `parity_gap_review.md` B1）：网页版 10 回合/HP 在 maxHp=30 时恰好等于 CE 的 300 回合回满，**并非快 30 倍**；真正的偏差是不随 maxHp 缩放、阈值语义错、无中毒禁回血。

**改什么**
- `Player.ts:20-21`：`nutrition / maxNutrition` 12000 → **2150**（CE `STOMACH_SIZE`）。
- 饥饿阈值改为 CE 语义：`HUNGER_THRESHOLD = 350`（Hungry 提示）、`WEAK_THRESHOLD = 150`（Weak，附带 CE 的力量惩罚）、`FAINT_THRESHOLD = 50`（Faint，随机失去回合）、`<= 0` 饿死。**这些阈值不再影响回血速度。**
- 回血改为 CE 模型：目标是"`TURNS_FOR_FULL_REGEN = 300` 回合回满当前 `maxHp`"，即每回合回 `maxHp / 300` 并用累加器处理小数，而非固定 10 回合/HP。
- 中毒（`poisoned`）期间回血归零。
- 口粮 nutrition 恢复量对齐 CE（ration 1800 / mango 1550，见 `parity_gap_analysis` 附录）。
- `Sidebar.vue` 的饥饿状态展示同步新阈值。

**验收**
- 新增测试：`maxHp=30` 从 1 HP 起静止 300 回合后回满；把 `maxHp` 设为 100，同样 300 回合回满（证明已随上限缩放）。
- 新增测试：`poisoned` 状态下 300 回合 HP 不增长。
- 新增测试：不进食时 2150 回合后进入饿死判定；期间在 350/150/50 三点各触发一次状态变更日志。
- 手动：跑一局到 D3，确认口粮压力明显存在但不至于开局即饿。

---

# 给执行 AI 的提示词

下面每段可直接整段投给执行方。**每段一个任务，不要合并**。

---

## 提示词 · P0-1

```
项目：/Users/coolking70/Documents/同步空间/brogue/brogue-web
参考基线（只读）：/Users/coolking70/Documents/同步空间/brogue/BrogueCE-master/src

任务：为这个项目引入 vitest，并为战斗公式与 RNG 建立黄金值回归测试。这是后续所有引擎改动的验收网，本次不要改动任何游戏逻辑。

必做：
1. package.json 添加 devDependency vitest，添加 scripts: "test": "vitest run", "test:watch": "vitest"。
2. 新建 src/engine/Combat/CombatFormulas.test.ts，覆盖 strengthModifier / netEnchant /
   accuracyFraction / damageFraction / defenseFraction / hitProbability / armorProtection /
   clumpedRoll。黄金值必须从 BrogueCE-master/src/brogue/Combat.c 与 PowerTables.c 推导，
   每条断言上方注释写明 CE 的源文件与行号。clumpedRoll 用固定 seed 跑 10000 次断言分布
   的均值与极值边界，不要断言单次结果。
3. 新建 src/engine/Random.test.ts：同一 seed 连续取 1000 个数做快照，锁死 RNG 序列。

约束：
- 不修改 src/ 下任何现有实现文件的逻辑。若发现公式与 CE 不符，**不要修正**，改为写一条
  it.todo 或 it.fails 并在报告里列出，由我判断。
- npm run build 必须保持全绿。

交付报告需包含：
- npm test 与 npm run build 的完整输出尾部；
- 反向验证：把 accuracyFraction 里的 1.065 临时改成 1.06，贴出测试失败的输出，然后改回；
- 发现的任何与 CE 不符之处的清单（不修）。
```

---

## 提示词 · P0-2

```
项目：/Users/coolking70/Documents/同步空间/brogue/brogue-web
前置：P0-1 已合入（vitest 可用）。

任务：建立 headless 测试 harness 与冒烟测试。Game.ts 除第 4320 行一处 window 守卫外不依赖
DOM，可直接在 node 环境运行。本次不要改动游戏逻辑。

必做：
1. 新建 src/test/harness.ts：
   - createHeadlessGame(seed: number, mode?: GameMode)：内部完成 i18next 的最小 init
     （lng 任意，资源为空，全部文案走各调用点已有的 defaultValue），返回 Game 实例。
   - runTurns(game, n, policy?)：默认 policy 为"有相邻敌人则攻击，否则随机选一个合法方向移动"。
   - terrainFingerprint(grid)：把整层 terrain 逐格拼成字符串后做稳定哈希，用于确定性比对。
2. 新建 src/test/smoke.test.ts：
   - 固定 seed 跑 2000 回合，全程不抛异常、无 unhandled rejection；
   - 同一 seed 生成两次，D1..D5 的 terrainFingerprint 必须两两相等；
   - 断言 D1..D26 每层生成后 monsters.length > 0。
3. 第 3 条断言**预期当前会失败**（已知 horde 数据缺陷）。请用 it.fails 或 it.skip 标注，
   并在测试文件里写明 "红灯：待 P1-2 修复后转为正式断言"。不要为了让它变绿去改生成逻辑。

交付报告需包含：
- npm test 输出；
- 2000 回合的耗时、期间 logger 产生的消息条数；
- 第 3 条断言实际失败在哪些深度（列出 D1-D26 逐层的怪物数量）。
```

---

## 提示词 · P1-1

```
项目：/Users/coolking70/Documents/同步空间/brogue/brogue-web
参考基线（只读）：/Users/coolking70/Documents/同步空间/brogue/BrogueCE-master/src/variants/GlobalsBrogue.c 的 monsterCatalog
前置：P0 已合入。

背景：运行时加载的 src/data/monsters.json（67 条）缺少 accuracy / defense / regen /
moveSpeed / attackSpeed 五个字段，Monster.ts:104-109 全部落到默认值 accuracy=100 /
defense=0 / regen=0 / speed=100。后果是 CombatFormulas 里忠实移植的 0.987^defense 恒等于 1，
troll 不回血、豺狼不加速。带真实数值的 src/data/monsters_ce2.json（同样 67 条）是死文件，
全仓库无 import。

任务：把真实数值合并进运行时数据表。

必做：
1. 新建可提交的脚本 scripts/merge_monster_stats.cjs，以 id 为键，把 monsters_ce2.json 的
   accuracy / defense / regen / moveSpeed / attackSpeed 合并进 monsters.json。
2. 冲突规则（严格遵守）：monsters.json 已有的 minDepth / maxDepth / behaviorFlags /
   abilityFlags / statusImmunities / statusResistTurns / onHit* / goldDropChance /
   itemDropChance / description / color 一律保留，绝不被 ce2 覆盖。只新增那 5 个字段。
3. 合并完成后，逐条对照 GlobalsBrogue.c 的 monsterCatalog 复核这 5 个字段，发现不一致以
   CE 为准修正，并把修正清单写进报告。
4. 删除 src/data/monsters_ce.json 与 src/data/monsters_ce2.json（前者已知含损坏数据，
   后者合并后即为死文件）。注意 DetailGenerator.ts 可能引用过 ce2 的 description，
   删除前先确认引用情况。
5. 新建 src/data/monsters.test.ts：断言 67 条全部具备这 5 个字段且取值在合理区间；
   抽查 rat / jackal / ogre / troll 的具体数值（以 CE 为准，断言注释写明 GlobalsBrogue.c 行号）。

约束：
- 不改动战斗公式、不改动 AI。本任务只动数据与数据加载。
- npm test 与 npm run build 必须全绿。

交付报告需包含：
- 复核 CE 后修正了哪些怪物的哪些字段（完整清单）；
- 合并前后，用 P0 的 harness 固定 seed 各跑 500 回合，对比玩家的命中率与受伤总量
  （证明 defense 真的开始生效了）。
```

---

## 提示词 · P1-2

```
项目：/Users/coolking70/Documents/同步空间/brogue/brogue-web
参考基线（只读）：/Users/coolking70/Documents/同步空间/brogue/BrogueCE-master/src/variants/GlobalsBrogue.c
  —— hordeCatalog_Brogue[] 从第 744 行开始，到其后第一个 "};" 结束，共 175 条。
前置：P0 已合入。

背景（这是当前最严重的单点缺陷）：src/data/hordes.json 只有 132 条，经 Game.ts:711-723 的
flag 过滤后常规可刷仅 15 条，构成为 RAT×2 KOBOLD×2 JACKAL×2 EEL×2 VAMPIRE_BAT
BOG_MONSTER×2 NAGA SALAMANDER KRAKEN×2 —— 深度 5 和 10 各只有 4 条可用且以水生怪为主，
而深水在地图上只有 0-2 团 blob。结果是 goblin / ogre / troll / wraith 等陆生主力从不自然
刷出，中深层地牢事实上接近空场。CE 里常规可刷的 horde 有 58 条。

注意：Game.ts:711-723 的 flag 过滤本身是**忠于 CE 的**（CE 同样把 CAPTIVE / SUMMONED /
MACHINE_* 排除在常规刷怪之外），不要放宽它。问题出在数据提取漏了 43 条常规 horde。

任务：
1. 新建可提交的脚本 scripts/extract_hordes.cjs，从 GlobalsBrogue.c 完整提取 175 条 horde，
   字段：leader / members[{type,minCount,maxCount}] / minLevel / maxLevel / frequency /
   spawnsIn / machine / flags。CE 的结构体是位置参数且尾部字段可省略，**省略即默认值**
   （spawnsIn=0、machine=0、flags=0），不要把省略当成 null 丢掉整条。生成新的 hordes.json。
2. Game.ts:730 的均匀随机改为 frequency 加权抽取，对齐 CE 的 pickHordeType
   （候选集内按 frequency 累加权重抽样）。删除那条 "Should be weighted random" 注释。
3. 补 out-of-depth：10% 概率用 depth + rand(1,3) 的档位抽 horde，带 HORDE_NEVER_OOD 的
   候选排除。
4. 补周期刷怪：每层生成时设 monsterSpawnFuse = rand(125,175)，每回合递减，归零时刷一个
   horde 并重置。参考 CE Time.c 的 monsterSpawnFuse / spawnPeriodicHorde。

验收（必须全部通过）：
- hordes.json 条数 = 175；经现有 flag 过滤后常规池 >= 55。
- 新建 src/data/hordes.test.ts：对 D1/D3/D5/D8/D12/D17/D22/D26 各断言"可用 horde 数 >= 8"
  且"领袖种类中陆生怪占比 > 50%"。
- 加权正确性：固定 seed 在 D5 抽 10000 次，统计频次与各 horde frequency 的比例偏差 < 5%。
- **常规 horde 池（领袖+成员合计）可产出的物种数 >= 40**（当前仅 9 种：BOG_MONSTER /
  EEL / JACKAL / KOBOLD / KRAKEN / NAGA / RAT / SALAMANDER / VAMPIRE_BAT）。这是核心指标。
- 把 P0-2 smoke.test.ts 里的 it.todo('c-placeholder') 落地为上面这条物种覆盖断言。
  注意："每层 monsters.length > 0" 当前已恒真（每层固定刷 3-5 个 horde），不是有效指标。
- npm run build 全绿。

交付报告需包含：
- 用 harness 固定 seed 生成 D1-D26，输出每层的怪物种类与数量表（贴全表，这是人工验收依据）；
- 修复前后的这张表对比。
```

---

## 提示词 · P1-3

```
项目：/Users/coolking70/Documents/同步空间/brogue/brogue-web
参考基线（只读）：/Users/coolking70/Documents/同步空间/brogue/BrogueCE-master/src/brogue/RogueMain.c:420-443
前置：P0 已合入。

背景：Game.ts:272-318 的 startNewGame() 里没有任何 inventory.addItem 调用，玩家赤手空拳、
无甲、无口粮开局。CE 给的是：口粮 ×1、匕首（已鉴定+已装备）、飞镖 ×15、皮甲（已鉴定+已装备）。

任务：对齐开局装备。

必做：
1. 在 startNewGame() 中 new Player(...) 之后、generateDepth(...) 之前，按 CE 的顺序发放：
   口粮 → 匕首 → 飞镖×15 → 皮甲。顺序必须与 CE 一致，因为它影响 RNG 消耗顺序（后续回放
   系统依赖这一点）。
2. 匕首与皮甲：enchantment = 0，清除 cursed 与 runic 标记，标记为已鉴定，并直接 equip。
   飞镖：enchantment = 0，清除 cursed/runic，标记为已鉴定，不装备。
3. weapons.json 目前没有 dart，需要新增，数值查 GlobalsBrogue.c 的 weaponTable 中的 DART 条目。
4. 若当前 Item 模型不支持 quantity 堆叠：本任务只做到"背包里有 15 支飞镖"这一步（可以是
   quantity 字段也可以是 15 个实例，选改动小的），**投掷命中公式不在本任务范围内**，请在
   报告中显式说明这个边界，不要顺手去改投掷逻辑。
5. easy / wizard 模式的 maxHp / strength 覆盖逻辑保持不变。

验收：
- 新增测试：新开局后 inventory 含这 4 类物品；equippedWeapon 是 dagger、equippedArmor 是
  leather armor；两者 isCursed === false、enchantment === 0、已 identified。
- npm test 与 npm run build 全绿。
- 手动：起新局打开背包面板，截图贴进报告。
```

---

## 提示词 · P1-4

```
项目：/Users/coolking70/Documents/同步空间/brogue/brogue-web
参考基线（只读）：BrogueCE-master/src/brogue/Rogue.h:1123-1127、Items.c、Time.c
前置：P0 已合入。

背景与一处常见误判：Player.ts:83-84 当前是"nutrition > 6000 时每 10 回合回 1 HP"。在
maxHp=30 下满血耗时恰好 300 回合，与 CE 的 TURNS_FOR_FULL_REGEN=300 一致，**所以回血速度
本身并没有快 30 倍**。真正的偏差是另外三条，请只修这三条加食量：

1. 回血不随 maxHp 缩放。CE 的语义是"无论上限多少，300 回合回满"，网页版固定 10 回合/HP，
   maxHp 一旦成长反而比 CE 慢。改为每回合回 maxHp/300，用累加器处理小数。
2. 饥饿阈值语义错。CE 的 350/150/50 是 Hungry / Weak / Faint 的提示与惩罚阈值，
   **不改变回血速度**；网页版把 6000/2000 当成了回血档位。请移除回血与饥饿档位的耦合。
3. 中毒期间 CE 回血归零，网页版无此判定。

必做：
- Player.ts:20-21 的 nutrition / maxNutrition 从 12000 改为 2150（CE STOMACH_SIZE）。
- 阈值改为 HUNGER_THRESHOLD=350 / WEAK_THRESHOLD=150 / FAINT_THRESHOLD=50 / <=0 饿死，
  各自的提示与惩罚对齐 CE（Weak 的力量惩罚、Faint 的随机失去回合）。
- 回血改为上面第 1 条的模型；poisoned 时归零。
- 口粮的 nutrition 恢复量对齐 CE：ration 1800、mango 1550。
- Sidebar.vue 的饥饿状态显示同步新阈值。

验收：
- 新增测试：maxHp=30 从 1 HP 起静止 300 回合回满；maxHp 改为 100 后同样 300 回合回满。
- 新增测试：poisoned 状态下 300 回合 HP 不增长。
- 新增测试：不进食 2150 回合后进入饿死判定，期间在 350/150/50 三点各触发一次状态变更。
- 手动：跑一局到 D3，报告食物压力的主观体感（是否开局即饿）。
- npm test 与 npm run build 全绿。
```

---

# 验收流程

每个任务回来后按这四步走，任何一步不过就打回：

1. **门禁**：`npm test` 与 `npm run build` 全绿（要求执行方贴输出尾部，不接受"我验证过了"）。
2. **取证**：逐条比对该任务"验收"小节的条目，缺一条即打回。数据类任务必须贴出对照表。
3. **越界检查**：`git diff --stat` 看改动范围是否越出任务边界。P1 各任务**不应**触碰 `Architect.ts` / `BlueprintEngine.ts` / `Gas.ts` / `Bolt.ts`。
4. **回归**：跑 P0-2 的 2000 回合冒烟 + 人工起一局玩到 D3。

P1 全部合入后，再更新 `parity_gap_analysis.md` 的对应条目状态，然后展开 P2（tick 制时间系统）的细化方案。
