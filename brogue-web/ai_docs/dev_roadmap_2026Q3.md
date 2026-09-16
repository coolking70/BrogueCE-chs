# brogue-web 还原度攻坚路线图（2026-09-13 制定）

## P1-43（2026-09-16 C-3 验收时由执行方在范围外发现，验收方已做消费点兜底）

**蓝图特征落点会选中岩浆格，物品掉进护城河。** 实测 seed777/D7 的
`scroll_of_enchantment @ (26,12) terrain=LAVA`。根因：`canMoveTo` 对岩浆放行
（P1-25 的决定），而机器/祭坛/蓝图特征的落格池都以它为准。
CE 的物品落位一律回避 `T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER`，
岩浆的 `T_LAVA_INSTA_DEATH` 正在后者里（`Rogue.h:1948`）。

**已做（验收方，随 C-3 提交）**：`Game.ts` 三个消费点加岩浆守卫——
蓝图 `itemSpawns`、祭坛 `altarRoom.positions`、机器 `machine.center`。

**待做（根治）**：守卫在消费点意味着机器会**静默少一件宝物**。
正确做法是 `BlueprintEngine` 的特征选址就不选有害地形，
让它换一格而不是放弃。同时应复核怪物落点是否有同样的暴露面。

这个 bug 潜伏已久，此前没暴露只是因为 RNG 流恰好没把物品送到那里；
C-3 移动 RNG 流后 `p1_20_item_placement` 立刻翻红。**它不是 C-3 的回归。**

## P1-44 / P1-45（2026-09-17 F-0 测绘时发现，验收方已逐条复核）

- **P1-44 抗火药水什么也没做。** `Game.ts:2876` 的 `resist_fire` 分支写的是
  `grantTemporaryImmunity('burning' as any, 50)`——那个 `as any` 是自认：
  **`'burning'` 在 `StatusId` 联合类型里根本不存在**（`Creature.ts:9`，实查 0 处）。
  而且 `temporaryImmunities` **全库唯一读者**是 `applyMonsterOnHitStatus`
  （`Game.ts:4199`，只拦怪物命中施加的状态）；火焰伤害查的是
  `hasStatus('immune_fire')`（`Game.ts:2749/6089/6117`）。
  三重错位：键名不存在、存的通道没人在火伤路径上读、查的是另一个键。
  同一毛病还在 `Game.ts:4546` 重复了一次（4547 的 `'confused'` 倒是合法键）。
  **归 F-2a**（火机制轮）一并修。

- **P1-45 "幽灵气"：`creeping_death` 药水往气网写 `GasType.FIRE`。**
  `Game.ts:2872` 是 `addGas(x, y, 1, 100)`，字面量 `1` 就是 `GasType.FIRE`，
  旁边的注释 `// Will add actual caustic gas later` 是自认的占位。
  后果：喷出一团**不渲染、无效果、却占格且扩散**的气，还会挡住后到的真气体。
  交接文档原先记的"`GasType.FIRE` 是死枚举"**需要修正**——零读者成立，
  但**有一个写者**。`creeping_death` 本身是 web 自创内容（D2：退出实际游戏），
  **归 G-1**（气体轮）连同 volume 量纲折算一起处理。

## P1-42（2026-09-16 C-3 验收时登记，**优先级高**）

**web 的密门发现机制远弱于 CE，而 C-3 之后关卡连通性开始依赖它。**

CE 有两套发现机制（都在 `Movement.c:2459 search(searchStrength)`，
半径 = strength/10，命中率 = strength − 距离×10，对墙面再乘 2/3）：
1. **每走一步自动搜索**（`Time.c:2544-2549`，每格只触发一次，
   `search(awarenessBonus + 30)`）——即**半径 3 格的圆盘**自动搜；
2. **主动 search 命令**（`s` 键，`Time.c:2395-2423`），连续 5 回合"充能"
   （`STATUS_SEARCHING` 累加到 5）后做一次强力搜索。

web 只有一条：玩家移动后，对**四正邻接**的 SECRET_DOOR 以 30% 概率揭示
（`Game.ts` 的 `Cell.isDiscovered`）。**没有半径、没有斜向、没有主动命令、
没有充能。** 一扇离走廊两格的密门在 CE 里能搜出来，在 web 里等于不存在。

**为什么现在要紧**：C-3 让密门按 CE 概率如实生成（D26 封顶 67%，
实测 5 种子 × D1-D26 共 327 扇），同时 p1_26/p1_29/p1_33 的连通性判据
已按 CE 口径改为**放行密门**（`harness.analysisAllowsMove`，依据
`Architect.c:202-203`）。**那个口径是生成器层面正确的，但它对玩家实际
可玩性是乐观的**——若唯一通路在密门之后，CE 的玩家搜得到，web 的玩家
可能永远撞不开。

**这条补完之前，不要用"连通性闸门全绿"论证"关卡可玩"。**

## P1-41（2026-09-16 P1-37 验收时登记）

**怪群成员铺开用环形扫描而非路径距离。** `Game.ts` 的成员落位是按切比雪夫半径
r=1..5 的环形扫描、不看连通性；CE `spawnMinions`（`Monsters.c:703-733`）走
`getQualifyingPathLocNear`，**按路径距离**落位。差别的后果是：CE 靠"锁门封住的
密库在路径上走不进去"结构性地把成员挡在机器外（它的禁忌旗标里并没有
`IS_IN_MACHINE`），而 web 的环形扫描会把怪物直接塞进封死的宝库。

P1-37 因此加了一条 `cell.machineNumber === 0` 排除——**属"web 侧必要、CE 无对应"
一类**（先例：P1-33 的 `gateSealsOnlyInterior`）。改成路径距离落位后，
**那条排除应当随之取消**。

## P1-38 / P1-39 / P1-40（2026-09-16 C-4 勘察登记，详见 `c_4_scoping_note.md`）

- **P1-38 通行判据分裂**（**2026-09-17 由 C-4a 执行方纠正机制，验收方复核确认**）：
  我原先写的因果链是"`Pathfinding.calculateMap` 读 `cell.isPassable`，所以各 Dijkstra
  图认为深水与上锁的门可走"。**这条是错的**：`calculateMap` 在生产代码中**零调用点**
  （P4-9 之后四个消费方各自造 cost 图走 `batchScan`）。

  **真实情况比我写的更碎**：四个消费方**各自直接读 `cell.isPassable`，再各打各的补丁**——
  `Scent.ts:37/48` 额外加上 CHASM/LAVA/WATER_DEEP；`SafetyMap.ts:118/347` 反过来
  **减去** SECRET_DOOR 与 CHASM；`WaypointMap.ts:235/352` 只减去 SECRET_DOOR。
  即同一个"能不能走"，全库有**五套**答案（`isPassable` 本体 + 四套补丁），
  且没有任何一处以 CE 的旗标为准。

  `Grid.setTerrain` 的 `isPassable` 启发式与 `canMoveTo` / `terrainAllowsMove` 的分歧
  （LOCKED_DOOR / WATER_DEEP / CHASM 三者裁决相反）依然成立，
  **真正的翻转点是 `setTerrain` 的启发式，不是 `Pathfinding.ts`。**

  C-4a 已建成 `TerrainCatalog.ts` 并把 `canMoveTo` / `terrainAllowsMove` 迁为查表
  （`!blocksPassability && !isDeepWater`，逐位等价）。**剩余部分归 C-4a-1**：
  把 `setTerrain` 的启发式与四处消费方补丁一并收敛到属性表。
  C-4a 已量出翻转的代价：改用 `isPathingBlocker` 会产生**语义分歧 10657 格**
  （LAVA 3262 / WATER_DEEP 3141 / TRAP 1986 / LOCKED_DOOR 1022 /
  INERT_BRIMSTONE 833 / PRESSURE_PLATE 413），另有 SECRET_DOOR 数值分歧 1585 格
  （距离图不变）。

- **P1-39 web 禁止游深水，偏离 CE**：CE `Globals.c:413` DEEP_WATER 不含
  `T_OBSTRUCTS_PASSABILITY`，带 `TM_ALLOWS_SUBMERGING | TM_STAND_IN_TILE`，
  `T_IS_DEEP_WATER`（`Rogue.h:1937`）的语义是"50% 偷走物品"而非"不可进入"。
  玩家现在只能绕湖走。归 C-4a 之后单独一轮（连着潜水与丢物品判定）。
- **P1-40 `setTerrain` 启发式未随 C-2 五个新枚举更新**：它们落进默认分支，
  恰好都正确纯属侥幸。归 C-4a 根治。

**C-4 已判定不可作为单轮投出**——web 没有分层、没有地形属性表、没有 DF 目录。
拆为 C-4a（地形属性表 + 统一口径）/ C-4b（DF 目录）/ C-4c（promoteTile 两趟驱动），
另有一个待用户裁决的前置问题：**要不要迁移 CE 的四层地形模型**。见勘察笔记。


## 项目边界决策（2026-09-16 拍板）

**D4：brogue-web 是独立项目，不与其他项目共用文件。**
如有引用需要，复制进本项目目录内再修改，不得跨目录引用。
已核实当前代码层面零跨目录耦合（无外部符号链接、无 `../../..` 源码引用、
构建配置无外部路径）；`src/locales/zh_CN.json` 是 C 版
`BrogueCE-master/bin/assets/zh_CN.json` 的**副本**而非共享文件
（后者 2289 键全部被 web 副本包含，web 另有 516 条独有键），故清理 web 副本
不影响 C 版——此结论解除了 P1-30 原先"清理需先确认"的限制。

**D5：`brogueweb/`（emscripten 的 C→wasm 移植路线）封存。**
只读存档，不再开发，不得被 brogue-web 引用。见 `brogueweb/SEALED.md`。

**D6：`BrogueCE-master/` 保留为只读参考，不在封存之列。**
它是本项目唯一的事实来源，每轮任务书都引用其行号。可读不可改。
所有任务书的"禁止修改"清单应包含它。

**暂不拆分 git 仓库**——三个目录继续共用一个仓库与提交历史。


## 项目级决策（2026-09-14，用户拍板）

**D1. 平衡取舍一律按 CE 实施。** 复刻期间不因手感调参。已知的手感变化
（如 P1-11 后皮甲+0 反而变差：死亡 4→7、每击伤害 0.77→1.38）只做记录，
留待整个复刻工作完成后的**二次开发**阶段统一评估改良。
→ 所有提示词中"不要调参凑手感"的约束继续保留。

**D2. web 自创内容保留代码，但不得出现在实际游戏中。** 即保留实现与数据定义，
从生成/掉落池中移除，使玩家永远遇不到。涉及：
- `scroll_of_amnesia`（CE 无此卷轴）
- 护甲符文 `vitality`（CE 无 A_VITALITY）
- 武器符文 `vampirism` / `venom`（CE 无对应）
- 其余见 parity_gap_analysis.md §10 清单，需逐条复核后一并处理
→ 待办：P1-21（见下）

**D3. P2（tick 制时间系统）的实现方式需谨慎论证后再动。**
不在未经方案评审的情况下开工。

---


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

## P1-17 展示层护甲口径对齐（P1-11 排查发现，玩家可见的错误数值）

P1-11 把护甲改为 CE 的加法防御模型后，展示层仍是旧口径：

1. **`DetailGenerator.ts:310-321`**：物品详情的"实际护甲值"仍按旧乘法
   `round(item.armor * damageFraction(ne))` 展示，应为 `armor + netEnchant`（显示值口径）。
2. **`Game.ts:1136-1146` 与 `1186-1197`**（更严重，且是**既有**错误）：
   调用 `generateMonsterDetail` 时把 `player.equippedArmor?.armor ?? 0`——
   即**原始显示值**（皮甲 3）——当作 `playerDefense` 参数传入，
   `DetailGenerator.ts:170` 据此算 `hitProbability`。于是怪物详情里
   "该怪物有 X% 概率命中你"**长期低估被命中概率**；P1-11 后实战已用 ×10+附魔标度，
   偏差进一步放大。函数签名里 `_playerArmorBase/_playerArmorEnchant/_playerArmorStrReq`
   三个下划线占位参数正是为此预留，可直接复用。

## P1-19 蓝图宝藏落点可能在墙里（P1-12 验收发现，玩家可见）

`BlueprintEngine.ts:185-189` 把 machine/vault 房的宝藏直接放在 `findSuitableRoom`
返回房间的**质心**。非凸房间的质心可能是不可通行格——实例：seed=424242 的 D22，
Wand of Fire 落在墙里，**玩家拿不到**。

该路径不经 `floorTiles`，与 P1-12 的落点修复无关，是既有缺陷。
修法：宝藏落点应从房间内的可通行格中选，而非几何质心。

## P1-21 自创内容退出生成池（按决策 D2）

保留实现与数据定义，但从生成/掉落池移除，使其不出现在实际游戏中。
**不是删除代码**——二次开发阶段可能重新启用。

已确认的自创项：
- `scroll_of_amnesia`：`consumables.json` 保留条目，从卷轴生成池排除
- 护甲符文 `vitality`：`ItemLoader` 的 armor runic 池中移除
- 武器符文 `vampirism` / `venom`：weapon runic 池中移除
- 需先按 parity_gap_analysis.md §10 逐条复核，可能还有其他项

注意：移除后 runic 池大小变化会**移动 RNG 流**，同 seed 的地图/掉落将改变。
需同步确认既有确定性测试仍成立（它们只比对同一次运行内的两次生成，应不受影响）。

## P2-1 验收发现（留待 P2-2 / P2-3 处理）

1. **部分玩家动作"花时间但怪物不行动"**：equip / unequip / drop / quaff / read
   只递增 `currentTick`，不触发回合结束；**CE 中这些都是完整回合**。
   即玩家可以免费喝药水、免费换装备——实打实的玩法偏差。
2. **差异化动作耗时接入即改变行为**：pickup 50 / 泥泞 200 / 祭坛 50 一旦进入推进
   循环，必然改变怪物行动频次。P2-2 引入真实 `movementDuration` 时基线必变，
   届时需重采。
3. **web 的耗时表与 CE 不同源**：泥泞 ×2 是 web 自创；CE 的 `movementDuration`
   按地形另有取值。按决策 D1，P2-2 应以 CE 为准重建。
4. **CE 已有但未接入的 tick 修正**：免费回合（Combat.c:707 `= -1`）、
   快/慢武器攻击耗时（Time.c:2442-2456）、克隆怪 `max(ticks,101)`（Combat.c:320）、
   骑乘怪 200（Combat.c:2026）、Items.c:4627/5504/7454 的行动锁、
   眩晕命中 `+=`（Combat.c:1252）。

## P1-20 仍有 16 件物品落在上锁门上（P1-19 后的残留）

P1-19 把"落在不可通行格"的物品从 44 件降到 16 件（4 seed × D1-D26，
共 1851 件地面物品）。剩余 16 件**全部落在 `LOCKED_DOOR`（terrain 21）上**，
而 `LOCKED_DOOR` 在 `isPassable` 中不可通行 → 玩家拿不到。

实例：seed=424242 D14/D17 的 Scroll of Enchanting、seed=20260913 D13 的
Potion of Life、seed=777 D22 的 Wand of Teleportation。

来自与 blueprint center 不同的放置路径（P1-19 已防住 center 与 doorPos 重合、
以及 feature 地形盖住 center 两种情况）。需定位该路径并加落格校验。

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

## P1-22 下坠药水完全没有实现（P4-4 勘察发现，玩家可见）

`Game.ts` 的 `case 'fall_down'` 只打印一行 `potion.descent`
（"The floor opens beneath you!"），**之后什么都不做**——玩家不会下潜，
深度不变，药水等于白喝。全仓没有任何换层/坠落代码路径。

连带影响（已在 P4-4 中明确排除出范围）：
- CE 的 pit bloat 死亡时铺 `DF_HOLE_POTION`（洞），把踩在上面的生物送到下一层。
  web 无坠落子系统，故 P4-4 只实现它的自爆，不产生洞。
- CE `killCreature` 里 `MA_DF_ON_DEATH` 的 `!(bookkeepingFlags & MB_IS_FALLING)`
  守卫在 web 无从对应。

必做：实现真正的坠落——玩家/怪物落到下一层、受坠落伤害、洞地形本身。
这是一个子系统，不是一行修复。做完后回头补 pit bloat 的洞。

## P1-23 web 没有 DF（地形特征）系统

CE 的 `spawnDungeonFeature` + `dungeonFeatureCatalog`（`Globals.c:603`，219 条）
是"在某格铺开一片地形/气体"的统一设施，被死亡掉落、药水、陷阱、蓝图、bolt
大量复用。web 完全没有它——`Bolt.ts:112` 已有一条注释承认这是已知缺口。

现状是每个需要铺地形的地方各自直接调 `environment.addGas` / `ignite`，
参数靠手写（例如下坠药水的 `addGas(x, y, 2, 70)` 中的 70 没有 CE 依据）。
P4-4 也沿用了这个权宜做法（只接 bloat 的毒气与 explosive bloat 的火）。

必做：建立 DF 目录与 `spawnDungeonFeature`，含 startProb/probDecr 的扩散算法、
`DFF_*` 旗标、`subsequentDF` 链式触发；再把现有各处硬编码调用改为查表。
注意 `Globals.c:600` 的注释：**gas 层的 DF 用 startprob 当体积、忽略 probdecr、
只在单点生成**，与 dungeon/surface 层的扩散语义不同。


## P1-24 淹死 / 熔岩烧死的怪物根本没死（P4-4 验收探针撞见，玩家可见）

`Creature.die()`（`src/entities/Creature.ts:157`）只做两件事：
把 `char` 改成 `'%'`、把 `color` 改成暗红。**它不把 hp 归零**，
而 `Monster` 没有覆盖它。

`Game.applyEnvironmentalEffects()` 里深水与熔岩两个分支把 `entity.die()`
当作唯一致死手段（其余分支如蒸汽/蔓延死亡都是先 `hp -= N` 再判 `hp <= 0`，
不受影响）。结果是怪物"淹死/被烧死"之后满血留在 `this.monsters` 里，
`playerTurnEnded` 的 `filter(m => m.hp > 0)` 永远清不掉它。

实测（验收方探针，种子 20260914，一只 6 HP 老鼠）：
```
[深水] 结算后 hp 6->6 char='%' 清扫前在列表=true 清扫后仍在列表=true
[熔岩] 结算后 hp 6->6 char='%' 清扫前在列表=true 清扫后仍在列表=true
```
即：显示成尸体 `%`、继续行动继续攻击，且死亡消息每回合重播一次。

必做：让 `die()` 成为真正的致死收口（至少把 hp 归零），并复核全部
`entity.die()` 调用点的语义。注意 P4-4 新增的 `triggerDeathFeatures`
是按 `hp <= 0` 扫描的——修好 `die()` 后，淹死/烧死的膨胀怪会开始正常触发
死亡地形，这是对齐 CE 的正确行为（CE 只在 `MB_IS_FALLING` 时抑制），
但要补一条测试确认不会因此在水里生成火。


## P1-25 击退的落点判定用了 canMoveTo，深水/熔岩口径不一致（P4-5 验收探针发现）

CE `processStaggerHit`（Combat.c:1118-1136）只检查 `T_OBSTRUCTS_PASSABILITY`，
深水与熔岩**都不阻挡通行**，所以 CE 会把被击退者推进水里或岩浆里。

web 的实现改用 `Game.canMoveTo`（`Game.ts:5459`），该函数排除
GRANITE/WALL/SECRET_DOOR/LOCKED_DOOR **和 WATER_DEEP**，但**不排除 LAVA**。
验收探针实测（种子 20260914）：
```
[E] 普通地板：22,1 -> 23,1      （正常推开）
[E] 落点被占：22,1 -> 22,1      （正确不动）
[E] 落点是深水：22,1 -> 22,1    ← CE 会推进去
[E] 落点是熔岩：22,1 -> 23,1    ← 与 CE 一致
```
即熔岩忠实、深水不忠实，两者口径不一致。

**本轮有意不改正**，理由记录在此：web 的深水是**即死**
（`applyEnvironmentalEffects` 直接判定淹死），而 CE 的深水是游泳 + 掉落物品、
不致死。照 CE 忠实推进去，在 web 里会造出一个 CE 根本没有的"击退即秒杀"
机制——忠实实现反而更不像 CE。根因是 web 的水体模型偏差，不是击退本身。

必做（依赖水体模型先修好）：把深水改为 CE 的游泳/掉物语义，再把击退的落点
判定回归 CE 的"只看是否阻挡通行"，让深水与熔岩口径一致。
在那之前，`processStaggerHit` 的代码注释里"终点是墙"这句措辞也需订正——
`canMoveTo` 排除的不止是墙。


## P1-26 p2_3_baseline 的 play 段是伪装成回归闸门的相位快照

`p2_3_objective_time.test.ts` 的 F 段有两条断言：
- **levels 段**（4 seed × D1-D26 生成期指标）——已 `it.skip`，且有
  `generation_baseline.json` 这个滚动基线接手，没问题。
- **play 段**（4 seed × 400 回合后的玩家/怪物状态）——**仍然是活的**，
  而它记录的是"某一时刻的玩法状态"，任何有意的行为改动都会让它变红。

P4-8 已经撞上一次：气味追踪 + stealthRange 对齐 CE + 3% 掷骰三项有意变更，
把它打红了，只能由验收方授权重捕获。P4-9（safety map）、P4-10（waypoint）
必然再次撞上，此后每一轮行为改动都会。

这正是先前 `p2_baseline` / `p2_2_baseline` / `p2_3_baseline` 的 levels 段
被退役为 `skip` 的同一个毛病：**相位快照当回归闸门用**。它抓不出真回归
（因为每次都"预期会变"），只会制造噪音和"顺手刷新基线"的压力。

必做，三选一：
1. 退役为 `skip`，理由写清（与 levels 段同处理）；
2. 改成真正的滚动基线：明确它只在行为**有意**变更时由验收方重捕获，
   并在 fixture 的 note 里记录每次重捕获的原因（目前已开始这么做）；
3. 换成**不依赖具体坐标**的不变量断言（例如"400 回合不崩溃、玩家未死、
   怪物数在合理区间、深度未异常变化"），这样才真正能抓回归。

倾向 3 —— 前两种都只是在管理噪音，第三种才恢复了闸门的本意。
在此之前，每次因它变红都必须由验收方判断"是有意变更还是真回归"后再授权，
**不得由开发方自行刷新**（这条已写进 night_plan 的铁律与各轮任务书）。


## P1-31 玩家出生/换乘落位在楼梯格上（P4-9 返工定位，已波及 safety map）

CE 进场落位明确**避开楼梯**（RogueMain.c:839-869）：先把 `player.loc` 置为
`upLoc`/`downLoc`，随后在 4 邻域找一个满足
`!T_PATHING_BLOCKER && !(HAS_MONSTER | HAS_STAIRS | IS_IN_MACHINE)` 的格子落位；
4 邻域都不合格则退到 `getQualifyingPathLocNear` 继续找。**玩家从不站在楼梯上。**

web 直接把玩家放到楼梯坐标（`Game.ts:851-855`）：
```ts
this.player.loc.x = stairsUpPos.x;
this.player.loc.y = stairsUpPos.y;
```
验收探针实测 5 个种子，开局玩家格地形码全部是 `13`（STAIRS_UP）。

### 已造成的后果

P4-9 的 safety map 因此**整张图退化成平面**：`buildSafetyMap` 里楼梯禁入循环把
玩家格的 `playerCostMap` 从 1 覆盖回 −1，唯一种子零入队、第一段 Dijkstra 零传播，
全图只剩 30000 与 −111 两个值，`safetyNextStep` 在 60 个抽查格上给出方向 **0 个**
（逃跑怪全部原地不动）。

P4-9 采取的是**局部规避**：把玩家格修正移到楼梯禁入循环之后。这是对 CE 的
**有意偏离**，仅存在于"玩家站在楼梯格"这一 CE 进场不可达的状态。
开发方如实指出：**CE 自己在玩家站楼梯时安全图同样会退化成平图**——那是 CE 的
边角行为，不是 CE 的 bug；web 的问题在于把这个边角状态变成了常态。

### 必做

按 CE 的 4 邻域搜索实现落位，玩家不再站在楼梯格上。完成后：
- 回退 P4-9 §十三 记录的那处有意偏离，恢复严格的 CE 顺序；
- 复核 P4-9 的 T8（零改造关卡上的梯度断言）仍然通过。

### 注意

这会改变玩家出生坐标，**`p2_3_baseline` 的 play 段与 `generation_baseline` 都可能
变红**。按 Phase C 的基线策略处理：如实报告，由验收方判断后授权重捕获。


## P1-32 web 没有按层种子隔离——每层长什么样取决于你在上一层打了多少怪

P4-10 实测发现，验收方逐条核实。

### CE 的做法

**开局就把全部层的种子定好**（RogueMain.c:257-268）：
```c
for (i = 0; i < gameConst->deepestLevel + 1; i++) {
    levels[i].levelSeed = rand_64bits();        // 或 backward-compatible 的双段式
    if (levels[i].levelSeed == 0) levels[i].levelSeed = i + 1;
}
```

**每层生成时整段隔离**（RogueMain.c:676-738）：
```c
do { oldSeed = rand_64bits(); } while (oldSeed == 0);   // 存主流状态
seedRandomGenerator(levels[depth-1].levelSeed);          // 切到该层专属种子
    digDungeon(); placeStairs(); initializeLevel(); setUpWaypoints(); ...
seedRandomGenerator(oldSeed);                            // 切回主流
```

结论：**整个地牢在开局就确定了**。生成消耗多少随机数，对主流零扰动；
反过来，玩法期消耗多少随机数，也不影响任何一层长什么样。

### web 的现状

`grep -rn "levelSeed|oldSeed|seedRandomGenerator" src/` 只有两处播种：
`Game.ts:383`（开局）与 `Game.ts:5515`（读档）。**`levelSeed` 概念不存在，
没有任何隔离。**

### 两个具体后果

1. **下楼前多打几只怪，第二层就不一样了。** 玩法期的每一次随机消耗都会推移
   后续所有层的生成。这与 CE 的"地牢开局即确定"是本质区别，也影响
   种子分享与复现（同种子不同打法 = 不同地牢）。
2. **`generation_baseline.json` 极度脆弱。** 改动 D1 生成的任何一步，都会把
   D2-D26 全线推红——P4-10 首轮就撞上了（D1 多出 2290 次抽取导致全红）。
   Phase C 每一步都会遇到同样的放大效应。

### 与 Phase C 的关系

**建议在 Phase C 正式开工前做掉。** 补上按层种子隔离后：
- 改动某一层的生成不再波及其它层，基线从"全线红"变成"只有被改的那层红"，
  回归探测的信噪比大幅提升；
- P4-10 为 waypoint 构建单独加的快照/恢复（局部规避）可以回退，改用统一机制。

注意：这会**一次性改变所有种子的地牢**（此后每层由 levelSeed 决定而非累积流），
故 `generation_baseline` 需在本条落地时重捕获一次，且应当是 Phase C 开工前的
最后一次"全线重捕获"。


## P1-33 机器阶段会把关卡切断（P1-29 发现，绕过了湖泊连通性闸门）

P1-29 给湖泊放置加上连通性验证后，湖泊致不可达已清零，但**端到端仍有 2/260 层
下楼梯不可达**——根因在机器阶段，不在湖泊。

### 铁证

验收方独立探针（严格按 `Game.canMoveTo` 口径）：
```
seed777/D15: 下楼梯可达=false  可达 366/479  深水=0  上锁门=3
seed999/D12: 下楼梯可达=false  可达 118/180  深水=38 上锁门=1
```
**seed777/D15 该层深水为 0**——根本没有湖，是 3 个 `LOCKED_DOOR` 恰好卡在
树状走廊的割点上。seed999/D12 则是机器特征水（key_flood_trap）切断走廊。

### 为什么闸门拦不住

执行顺序是 `designLakes`（带闸门）→ `addMachines`（无闸门）。机器在湖泊闸门
**之后**才动地形，自然绕过验证。CE 的顺序相同（Architect.c:2928 / 2944），
但 CE 先有 `addLoops`（2897）造出环路，**割点远比树状地牢稀少**，
所以同样的顺序在 CE 里很少出事。

开发方定位的病灶在 `BlueprintEngine.ts` 的 `findSuitableRoom`：
任意 BFS 块当房间、边界贴墙格当门，于是"门"可能落在唯一通路上。

### 必做

给机器阶段也加连通性验证（或让 `findSuitableRoom` 排除割点）。
**建议在 C-0（`addLoops`）之后再评估**——环路落地后割点会大幅减少，
这 2 层可能自然消失，届时再看是否仍需专门的闸门。

### 追踪

`src/test/p1_26_invariants.test.ts` 的 `KNOWN_UNREACHABLE_STAIRS_LEVELS = 1`
就是本条的主追踪器（5 种子集合内命中 seed777/D15）。修复后改回 0
并删掉该文件里对应的说明段落。


## ~~P1-34~~ 已修复（见提交 fix(P1-34)）：test 局带着上一个随机地牢的陈旧环路图

C-0 合入后观察到：`src/test/p4_9_safety_map.test.ts` 的
「T2 双重扫描 + 数值变换的解析解：密封走廊值 = 27-x」在**全量** `npm test` 中
时红时绿；**单独跑该文件则 8 条稳定全过**。

实测三次全量：红 / 绿 / 红（约 50%）。

### 已排除的可能

- **不是 C-0 的确定性回归**——单文件跑全绿。
- **不是种子漂移**——`createSafetyGame(seed = 20260915)` 种子固定。
- **不是 loopMap 相对机器阶段过时**——`analyzeLoopMap` 在 `Game.ts:674`，
  位于 `architect.generateLevel`（`Game.ts:646`，内含 `BlueprintEngine.buildMachines`）
  **之后**，确实反映了机器放置的锁门。这条我一度怀疑，已排除。

### 尚未定位

T2 事后把房间挖成密封走廊，而 `updateSafetyMap` 里的 `isInLoop` 读的是
**进层时算好的 `loopMap`**——相对挖出来的走廊它是过时的。这本身是确定性的
（原图确定 → loopMap 确定），但**说明 T2 的解析解依赖了一个它没有控制的输入**。
真正的随机来源尚未查明，可能在 vitest 并行 worker 的跨文件模块状态。

### 必做

1. 定位随机来源（建议先试 `--no-file-parallelism` 或 `--sequence.shuffle=false`
   看是否稳定复现，以区分"跨文件状态"与"文件内顺序"）。
2. 让 T2 自洽：碰过地形之后应当重算或显式清空 `loopMap`，而不是依赖进层时的
   残留值。这同时会让该测试的前提变得显式。

### 为什么要优先处理

flaky 测试比失败更有害——它训练所有人"红了就重跑"，而这正是 P1-26 退役相位
快照要治的同一个病：**红灯一旦变成背景音，真回归就再也拦不住了。**


## P1-35 读档后环路偏好静默失效（P1-34 的同族隐患）

P1-34 定位 flaky 时开发方主动申报，验收方已核实成立。

`Game.loadSnapshot` 从存档重建网格后，**既不恢复也不重算 `loopMap`**
（快照 schema 里也没有这个字段）。于是读档后 `isInLoop` 返回的是
**读档前那一局**的环路图——与当前地图无关。

后果：P4-9 safety map 的 `IN_LOOP -= 10` 偏好在读档后按一张错误的环路图生效，
怪物逃跑路线会偏离。不会崩溃、不会报错，**静默失效**。

这与 P1-34 是同一个不变式的两处漏洞：**`loopMap` 必须始终等于当前网格的
`analyzeLoopMap` 结果**。P1-34 补上了 `generateTestDepth` 那处，`loadSnapshot`
这处未动（不在该轮文件边界内）。

### 必做

在 `loadSnapshot` 重建网格之后补 `this.loopMap = analyzeLoopMap(this.grid)`。
`analyzeLoopMap` 是纯函数、零 RNG 消耗，不影响读档的随机流。

### 顺带复核

存档往返还有没有别的"生成期派生态"没被恢复也没被重算？
已知候选：waypoint 系统（`WaypointSystem` 的 `coordinates`/`distanceMaps`）、
气味图 `scentTurnNumber`。请一并核查并各自登记。


## P1-36 `blueprint_center` 的护栏长期近乎空转（C-1 验收发现）

C-1 让该用例翻红后查出来的。`isCenterTreasure` 的五条判据里有两条**恒为 false**：

```ts
id === 'scroll_of_enchanting' ||   // consumables.json 里没有这个键（真实 id 是 scroll_of_enchantment）
id === 'wand_of_fire' ||           // 已按 D2 退出生成池
id === 'potion_of_life' ||
id.startsWith('ring_') ||
id.startsWith('charm_')
```

验收方实测确认：`scroll_of_enchanting` 不存在（**拼写错误**，真实 id 少了 `ment`）、
`wand_of_fire` 在 consumables 里完全不存在。该用例此前能通过，靠的是
`ring_*` / `charm_*` 与 machine center 的坐标巧合。

**已做的两处修正**（C-1 验收时顺手）：
1. 拼写改为 `scroll_of_enchantment`，并在注释里写明原委。
2. 默认扫描种子从 3 个扩到 12 个——C-1 让地牢开阔约 3 倍，宝藏落在 center 上的
   概率随之降低，3 个种子扫不到任何样本，用例 c) 的前置断言（样本数 > 0）因此
   翻红。**这不是回归，是样本量不足**；实测 40 种子稳定有样本。

**仍待处理**：
- `wand_of_fire` 那条判据现已删除，但**如果将来 D2 的自创内容重新入池**，
  需要有人记得把它加回来。
- 更根本的问题是：**这类"点名 id 列表"的护栏天然会腐烂**——数据表改名、物品
  退池、id 拼错，都不会有任何信号。建议改为按**物品类别/稀有度**判定，
  而不是硬编码 id 列表；或者至少加一条元断言："列表里的每个 id 都必须在数据表中存在"。
  后者成本极低，能把这类拼写错误变成红灯。


## P1-37 宝库地板用 `CHARRED_FLOOR` 冒充 `IS_IN_MACHINE` 旗标（P1-33 的权宜做法）

P1-33 修机器割点时，需要让**楼梯不要落在宝库内部**（否则封住宝库门就把上楼梯
关了进去）。CE 的做法是旗标：楼梯/物品/怪群落点一律回避 `IS_IN_MACHINE`
（Architect.c:3543/3597/3712/3738）。

web 的 `populateLevel` 从 `terrain === FLOOR` 的牌堆里抽楼梯，而 `Game.ts`
在 P1-33 的文件边界内被禁改，于是开发方把**宝库地板改判为 `CHARRED_FLOOR`**
让它退出牌堆。目的达到了（坏层 5→0，验收方独立复核 390 层全连通），
但这是**用地形类型冒充标志位**。

### 已确认的副作用（均为验收方实测）

规模：15 种子 × D1-D26 = 390 层里 **21745 格**被改判（约每层 56 格）。

1. **玩家可见**：`Game.ts:6261` 把 `CHARRED_FLOOR` 描述为**"烧焦的地面"**，
   颜色 `0x554433`。玩家走进宝库看到一片焦土——CE 的宝库地板是正常地面。
2. **卷进火焰系统**：`Gas.ts:128` 的"焦土偶尔长草"机制会作用在宝库地板上，
   且**每格每回合消耗 RNG**（`randPercent(1) && randPercent(5)`）。
   这既是行为偏差，也是无谓的随机流消耗。

### 必做

按 CE 引入 `IS_IN_MACHINE` 等价旗标（cell 上的布尔位或独立的机器掩码图），
让楼梯/物品/怪群落点回避它，然后把宝库地板恢复为普通 `FLOOR`。

需要改 `Game.ts` 的 `populateLevel`（楼梯抽取）与 `Grid`/`Cell` 的字段，
故未在 P1-33 轮内完成。

### 注意

做这条时 `generation_baseline` 会再次变红（落点分布改变），属预期。
另外 P1-33 建立的"坏层为 0"断言必须继续保持——那是本修复不得退化的底线。


---

# 验收流程

每个任务回来后按这四步走，任何一步不过就打回：

1. **门禁**：`npm test` 与 `npm run build` 全绿（要求执行方贴输出尾部，不接受"我验证过了"）。
2. **取证**：逐条比对该任务"验收"小节的条目，缺一条即打回。数据类任务必须贴出对照表。
3. **越界检查**：`git diff --stat` 看改动范围是否越出任务边界。P1 各任务**不应**触碰 `Architect.ts` / `BlueprintEngine.ts` / `Gas.ts` / `Bolt.ts`。
4. **回归**：跑 P0-2 的 2000 回合冒烟 + 人工起一局玩到 D3。

P1 全部合入后，再更新 `parity_gap_analysis.md` 的对应条目状态，然后展开 P2（tick 制时间系统）的细化方案。
