# C-4a 报告：地形属性表 + 统一通行判据（结构先行，行为逐位不变）

日期：2026-09-16。分支 `round/c-4a`。
新增 `src/engine/Map/TerrainCatalog.ts`（属性表 + 派生判据）、
`src/test/c_4a_terrain_catalog.test.ts`（15 用例）。
修改 `src/engine/Map/Connectivity.ts`（terrainAllowsMove → 查表）、
`src/engine/Core/Game.ts`（canMoveTo → 查表；另加 1 行 import，见 §5.4）。
**未动** Grid.ts / Pathfinding.ts（原因见 §6：两者都是"答案会变"的调用点）。
未执行任何 git 写操作。

---

## 一、T_PATHING_BLOCKER 的实际成员（从 Rogue.h 读到的原文）

`BrogueCE-master/src/brogue/Rogue.h:1948`：

```c
T_PATHING_BLOCKER = (T_OBSTRUCTS_PASSABILITY | T_AUTO_DESCENT | T_IS_DF_TRAP |
                     T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER | T_IS_FIRE |
                     T_SPONTANEOUSLY_IGNITES),
```

七个成员，各自位值（`Fl(N) = 1<<N`，Rogue.h:97）：

| 成员 | 位 | 定义行 |
|---|---|---|
| T_OBSTRUCTS_PASSABILITY | Fl(0) | Rogue.h:1924 |
| T_AUTO_DESCENT | Fl(7) | Rogue.h:1931 |
| T_IS_DF_TRAP | Fl(19) | Rogue.h:1943 |
| T_LAVA_INSTA_DEATH | Fl(8) | Rogue.h:1932 |
| T_IS_DEEP_WATER | Fl(13) | Rogue.h:1937 |
| T_IS_FIRE | Fl(11) | Rogue.h:1935 |
| T_SPONTANEOUSLY_IGNITES | Fl(6) | Rogue.h:1930 |

同时抄录的其余复合旗标（Rogue.h:1947-1956）：`T_OBSTRUCTS_SCENT`、`T_DIVIDES_LEVEL`、
`T_LAKE_PATHING_BLOCKER`、`T_WAYPOINT_BLOCKER`、`T_MOVES_ITEMS`、`T_CAN_BE_BRIDGED`、
`T_OBSTRUCTS_EVERYTHING`、`T_HARMFUL_TERRAIN`、`T_RESPIRATION_IMMUNITIES`。
其中 T_PATHING_BLOCKER 与 T_DIVIDES_LEVEL 的精确差 = `T_IS_FIRE | T_SPONTANEOUSLY_IGNITES`
（测试 A1/A2 位级钉死，见 §7）。

## 二、属性表

**形态**：TS 常量（`src/engine/Map/TerrainCatalog.ts`），不放 JSON——
`src/data/*.json` 是禁改目录，且表需要与 `TerrainType` 枚举类型互锁。
不放 Grid.ts——既有测试 `c_4a_0_layer_model.test.ts` 留痕"Grid.ts 未引入
地形属性表"，本轮兑现该留痕的方式就是建独立文件。

**结构**：`TERRAIN_FLAGS: Record<TerrainType, TerrainFlagsEntry>`，字段序即
CE `struct floorTileType`（Rogue.h:1905-1921）的可观测子集：
`flags` / `mechFlags` / `chanceToIgnite` / `fireType` / `discoverType` /
`promoteType` / `promoteChance` / `webOnly`。
- drawPriority / 归属层**复用 C-4a-0** 的 `DRAW_PRIORITY` / `TERRAIN_HOME_LAYER`
  （Grid.ts），未改动；
- fireType / discoverType / promoteType 本轮以 CE DF 名字符串存档（C-4b 建
  DF 数值目录后替换）；
- promoteChance 按 CE 原始单位（×1/10000 每回合，负值 = CE 倒计时式概率）；
- chanceToIgnite 按百分数。

**每条出处**（全部实测自 `BrogueCE-master/src/brogue/Globals.c` 的
`tileCatalog[]`，起于 :315；完整注释在 TerrainCatalog.ts 表体内，此处给索引）：

| web 成员 | CE 条目 | Globals.c | flags（T_* 并集） | mechFlags 摘要 |
|---|---|---|---|---|
| NOTHING | NOTHING | :321 | 0 | 0 |
| GRANITE | GRANITE | :322 | T_OBSTRUCTS_EVERYTHING | STAND_IN_TILE |
| FLOOR | FLOOR | :323 | 0 | 0 |
| WALL | WALL | :327 | T_OBSTRUCTS_EVERYTHING | STAND_IN_TILE |
| DOOR | DOOR | :328 | VISION\|GAS\|FLAMMABLE | STAND_IN_TILE\|VANISHES\|PROMOTES_ON_STEP\|VISUALLY_DISTINCT |
| OPEN_DOOR | OPEN_DOOR | :329 | FLAMMABLE | STAND_IN_TILE\|VANISHES\|VISUALLY_DISTINCT（promote→CLOSED_DOOR 10000） |
| WATER_SHALLOW | SHALLOW_WATER | :414 | 0 | STAND_IN_TILE\|EXTINGUISHES_FIRE\|ALLOWS_SUBMERGING |
| WATER_DEEP | DEEP_WATER | :413 | FLAMMABLE\|IS_DEEP_WATER | ALLOWS_SUBMERGING\|STAND_IN_TILE\|EXTINGUISHES_FIRE（ign 100） |
| CHASM | CHASM | :416 | AUTO_DESCENT | STAND_IN_TILE |
| LAVA | LAVA | :420 | LAVA_INSTA_DEATH | STAND_IN_TILE\|ALLOWS_SUBMERGING（fire→DF_OBSIDIAN） |
| GRASS | GRASS | :447 | FLAMMABLE | STAND_IN_TILE\|VANISHES（ign 15） |
| FOLIAGE | FOLIAGE | :472 | VISION\|FLAMMABLE | STAND_IN_TILE\|VANISHES\|PROMOTES_ON_STEP（ign 15） |
| STAIRS_UP | UP_STAIRS | :334 | ITEMS\|SURFACE_EFFECTS | PROMOTES_ON_STEP\|LIST_IN_SIDEBAR\|BRIGHT_MEMORY 等 |
| STAIRS_DOWN | DOWN_STAIRS | :333 | 同上 | 同上 |
| TRAP | GAS_TRAP_POISON（可见态） | :378 | IS_DF_TRAP | LIST_IN_SIDEBAR\|VISUALLY_DISTINCT（fire→DF_POISON_GAS_CLOUD） |
| SECRET_DOOR | SECRET_DOOR | :330 | OBSTRUCTS_EVERYTHING\|FLAMMABLE | STAND_IN_TILE\|VANISHES\|IS_SECRET（discover→DF_SHOW_DOOR） |
| PRESSURE_PLATE | MACHINE_PRESSURE_PLATE | :402 | IS_DF_TRAP | VANISHES\|PROMOTES_ON_STEP\|IS_WIRED\|LIST_IN_SIDEBAR\|VISUALLY_DISTINCT |
| LOCKED_DOOR | LOCKED_DOOR | :331 | OBSTRUCTS_EVERYTHING | STAND_IN_TILE\|VANISHES\|PROMOTES_WITH_KEY\|LIST_IN_SIDEBAR\|VISUALLY_DISTINCT\|BRIGHT_MEMORY\|INTERRUPT_EXPLORATION\|INVERT_WHEN_HIGHLIGHTED |
| ALTAR | ALTAR_INERT | :362 | SURFACE_EFFECTS | LIST_IN_SIDEBAR\|VISUALLY_DISTINCT |
| WEB | SPIDERWEB | :470 | ENTANGLES\|FLAMMABLE | STAND_IN_TILE\|VANISHES\|VISUALLY_DISTINCT（ign 100） |
| BLOOD | RED_BLOOD | :453 | 0 | STAND_IN_TILE |
| MUD | MUD | :415 | 0 | STAND_IN_TILE\|ALLOWS_SUBMERGING（promote→DF_METHANE_GAS_PUFF 100） |
| CHASM_EDGE | CHASM_EDGE | :417 | 0 | 0 |
| OBSIDIAN | OBSIDIAN | :427 | 0 | 0 |
| BRIDGE | BRIDGE | :428 | FLAMMABLE | VANISHES_UPON_PROMOTION（ign 50，fire→DF_BRIDGE_FIRE） |
| BRIDGE_EDGE | BRIDGE_EDGE | :430 | FLAMMABLE | VANISHES_UPON_PROMOTION（ign 50） |
| INERT_BRIMSTONE | INERT_BRIMSTONE | :426 | SPONTANEOUSLY_IGNITES | 0（promote→DF_ACTIVE_BRIMSTONE 800） |
| BOG | **webOnly** | — | FLAMMABLE | 0 |
| CHARRED_FLOOR | **webOnly** | — | 0 | 0 |
| SIGN | **webOnly** | — | 0 | 0 |
| RESET_PLATE | **webOnly** | — | 0 | 0 |

**派生判据**（TerrainCatalog.ts，名字照 CE，语义 = 旗标位测试）：
`blocksPassability`（T_OBSTRUCTS_PASSABILITY）、`isPathingBlocker`
（T_PATHING_BLOCKER）、`blocksVision`（T_OBSTRUCTS_VISION）、`obstructsItems`
（T_OBSTRUCTS_ITEMS）、`obstructsDiagonalMovement`（T_OBSTRUCTS_DIAGONAL_MOVEMENT）、
`isDeepWater`（T_IS_DEEP_WATER）、`isFlammable`（T_IS_FLAMMABLE）。

### web 独有地形的逐条取值理由

| 地形 | web 用途（实测） | 取值与理由 |
|---|---|---|
| BOG | 可燃沼泽：Gas.ts:59/142 把它与 GRASS/FOLIAGE 同列点火对象；BlueprintEngine 蓝图可放置 | 显示/语义近亲是 CE MUD（:415，CE 的 MUD 正用 G_BOG 字形），但 CE 无"可燃沼泽"条目。**flags=T_IS_FLAMMABLE 是对 web 现行行为的忠实记录**，不是 CE 抄录——若照抄 MUD 的 0 会丢失 web 的可燃事实。标 webOnly=true |
| SIGN | 告示牌：Game.ts:1824（D1 深度牌）/2036（手稿行），踩上显示文字（:6328） | CE 无 sign。显示近亲 SACRED_GLYPH（:479，drawPriority 同取 7 的原因），但其 **T_SACRED（敌对怪物回避）是圣徽行为，web SIGN 不具备**——只借显示位、不抄行为旗标，取零旗标。标 webOnly=true |
| RESET_PLATE | 测试用重置踏板：Game.ts:2039 放置、:6333 踩上 resetTestRoom | CE 无对应物。机制近亲 MACHINE_PRESSURE_PLATE_USED（:403，踩后惰性板，零旗标）——同为"踩板且无 DF 陷阱语义"。取零旗标。标 webOnly=true |
| CHARRED_FLOOR | 燃烧后的地面：Game.ts:6381 火熄写入、Gas.ts:128 复燃判定 | CE 无对应条目——CE 的表现是 FLOOR 地面上覆 ASH（:461，SURFACE 层）；web 做成 DUNGEON 层对 FLOOR 的就地替换。零旗标（复燃逻辑由 isBurning 承担）。标 webOnly=true |
| TRAP | 可见陷阱（'^'）：Architect.ts:427 放置，踩上按 trapType 触发（:6361）后变 FLOOR | CE 对应物 GAS_TRAP_POISON 可见态（:378）。web trapType 三种（poison_gas/teleport/fire），CE 无 teleport 陷阱（web 自创，D2 决策不入生成池），取毒气陷阱为基准 → T_IS_DF_TRAP |

## 三、行为逐位不变的证明

`generation_baseline` **未重采而绿**（`src/test/fixtures/` 零改动，git status
只含 2 修改 + 2 新增文件）；全量 662 测试全绿（含地形指纹、确定性、
p1_31_35 放置快照等全部行为钉）。

## 四、迁移了哪些调用点（答案不变）

CE 没有任何单一旗标（或预定义复合旗标）恰好等于旧 canMoveTo 口径
（见 §8 预设不符 #1），迁移采用**两个查表判据的合取**：

```
旧：terrain ∉ {GRANITE, WALL, SECRET_DOOR, LOCKED_DOOR, WATER_DEEP}
新：!blocksPassability(terrain) && !isDeepWater(terrain)
    = !(flags & (T_OBSTRUCTS_PASSABILITY | T_IS_DEEP_WATER))
```

**答案不变的机理**：CE 目录中带 T_OBSTRUCTS_PASSABILITY 的 web 地形恰好
= {GRANITE, WALL, SECRET_DOOR, LOCKED_DOOR}（前四个经 T_OBSTRUCTS_EVERYTHING，
DOOR 在 CE **不设** PASSABILITY——Globals.c:328）；带 T_IS_DEEP_WATER 的
恰好 = {WATER_DEEP}。两个集合的并恰为旧排除清单。全 31 枚举逐位比对由
测试 D1/D2 钉死（含合成格上实测 `Game.canMoveTo`，覆盖生成中出现不了的
地形）。

| 调用点 | 文件 | 迁移 |
|---|---|---|
| `terrainAllowsMove` | Connectivity.ts:29 | ✅ 查表（消费方：Architect.ts:757、BlueprintEngine.ts:194、LoopMap.ts:480、LakeSystem.ts:334、lakeDisruptsPassability） |
| `Game.canMoveTo` | Game.ts:6239 | ✅ 查表（消费方：移动、寻路 Pathfind.findPath、自动探索） |

p1_29_lake_connectivity 的既有钉死用例（两者全枚举一致）不改动而自然绿。

## 五、"答案会变"的调用点：精确清单 + 实测影响（下一轮 C-4b/C-4c 的输入）

### 5.1 `Grid.setTerrain` 的 isPassable（Grid.ts:413-418）【源头，未迁】

旧：`!(WALL | GRANITE | CHASM | SECRET_DOOR)`。若改 `!blocksPassability`：

- **LOCKED_DOOR：true → false**。生成中每层锁门机器一扇门（p1_33 实测
  15 种子 × D1-D26 共 **1022 扇**），翻转后全库几十处 `cell.isPassable`
  读取点（Game.ts 24 处、Monster.ts 13 处、SafetyMap/WaypointMap/Scent/
  FOV/LightMap 等）立刻视锁门为墙——怪物 AI、寻路、连通性分析全变。
  CE 本来就是这么算的（:331 T_OBSTRUCTS_EVERYTHING）；web 玩家移动走
  canMoveTo 不受影响，但**怪物不能穿锁门**才是 CE 行为。
- **CHASM：false → true**。本轮生成中 CHASM=0 格（C-4a-0 起 CHASM 不
  生成），**当前影响 0 格**；C-5 引入深渊后爆发。

留痕：测试 E2（全 31 地形钉死现状，点名 LOCKED_DOOR/CHASM 病灶行）。

### 5.2 `Grid.setTerrain` 的 isOpaque（Grid.ts:419-424）【源头，未迁】

旧：`WALL | GRANITE | DOOR | SECRET_DOOR`。若改 `blocksVision`：

- **LOCKED_DOOR：false → true**：1022 扇锁门开始挡视线（FOV/LightMap/
  hasLineOfSight 立即受影响）。CE：true（:331 EVERYTHING ⊃ VISION）。
- **FOLIAGE：false → true**：植被格开始挡视线。CE：true（:472 显式
  T_OBSTRUCTS_VISION）。web 现行 FOV 对植被全透——这是可见的显示差异。
- DOOR 两口径一致（旧 true，CE VISION 显式 true）。

留痕：测试 E2 同条覆盖。

### 5.3 `Pathfinding.calculateMap`（Pathfinding.ts:68-101）【未迁 + 干跑测量】

旧口径：边界 → PDS_OBSTRUCTION；`!isPassable` 且地形 ∈ {WALL,GRANITE} →
PDS_OBSTRUCTION，否则 → PDS_FORBIDDEN；其余 → 1。
新口径（假想）：`isPathingBlocker(terrain)` → PDS_OBSTRUCTION；其余 → 1。

**干跑实测**（15 种子 × D1-D26，每层内部格全扫；测试 F 输出原文）：

```
[C-4a 干跑测量] 15 种子 × D1-D26（每层内部格全扫）
  语义分歧（cost 1 → OBSTRUCTION，距离图将改变）：10657 格
    按地形：LAVA=3262，WATER_DEEP=3141，TRAP=1986，LOCKED_DOOR=1022，
            INERT_BRIMSTONE=833，PRESSURE_PLATE=413
  数值分歧（FORBIDDEN → OBSTRUCTION，均不可走，仅 cost 数值变）：1585 格
    按地形：SECRET_DOOR=1585
```

- LAVA/WATER_DEEP/INERT_BRIMSTONE = 三种液体湖（CE 怪物不趟岩浆/深水/
  硫矿，web 现在全都 cost=1 认为可走）；
- TRAP/PRESSURE_PLATE = T_IS_DF_TRAP（CE 怪物绕开陷阱与压力板）；
- LOCKED_DOOR = 1022 格，与 p1_33 的"锁门机器 1022 台"精确一致
  （每台一扇），交叉验证成立；
- SECRET_DOOR 1585 格纯属 cost 数值档位差（FORBIDDEN→OBSTRUCTION），
  两者都不进入传播（`cost >= PDS_FORBIDDEN` 被跳过），距离图不变；
- CHASM 零出现（本轮不生成深渊）；C-5 引入后进"数值分歧"档。

**重要修正（P1-38 因果链已过时）**：`calculateMap` 在生产代码中已**零调用**
——P4-9 引入 `batchScan` 后，全部四个消费方（Game.ts:1168 落位、
SafetyMap.ts:220/259、WaypointMap.ts:285、LoopMap.ts:129）各自自算 cost
后走 batchScan。所以"气味图/安全图/路径点全都认为深水可走"的现代因果链
不是 calculateMap，而是各消费方**直接读 `cell.isPassable` 字段**：
Scent.ts:37/48、SafetyMap.ts:118/347、WaypointMap.ts:235/352（三家都在
禁改清单）。这些点的翻转都随 5.1 的 setTerrain 启发式翻转而自动发生，
无需各自修改。

### 5.4 其它"已在用其语义但不属于本轮迁移面"的点（只列不修）

- `Game.entryQualifiesForPlacement`（Game.ts:1121-1133，P1-31）：手写近似
  T_PATHING_BLOCKER（!isPassable ∥ LAVA ∥ WATER_DEEP ∥ TRAP ∥ isBurning），
  与查表口径的差：缺 SPONTANEOUSLY_IGNITES（INERT_BRIMSTONE）、
  SECRET_DOOR 经 isPassable 已挡（CE 同）、CHASM 经 isPassable 挡（CE 不挡
  ——dividesLevel 处 :1156 同样手写，注释已声明是近似）。本轮不动。
- `Game.findQualifyingPathLocNear`（Game.ts:1147-1160，P1-31）：手写近似
  T_DIVIDES_LEVEL。同上不动。
- Monster.ts 13 处 `isPassable/isOpaque`：怪物移动/视觉，随 5.1/5.2 翻转。
- `analysisAllowsMove`（src/test/harness.ts）：任务书明确不碰，未碰。

## 六、留痕测试（"明确不做"清单的落点）

| 留痕 | 测试 | 反转条件 |
|---|---|---|
| promote/fire 类字段生产零读者 | E1（静态扫描 src/engine+entities+components 非注释代码，模式 `.(fireType|discoverType|promoteType|promoteChance|chanceToIgnite|mechFlags)`） | C-4b/C-4c 接读者后，改为"读者只出现在清单许可文件" |
| setTerrain 启发式现状 = P1-38 分歧表 | E2（31 地形全钉 + 病灶行点名） | 接 CE 判据的轮次（预计 C-4b），先更新测量报告再翻转 |
| calculateMap cost 现状 | E3（WALL/GRANITE→30000；CHASM/SECRET_DOOR→29999；WATER_DEEP/LOCKED_DOOR/LAVA/TRAP/PRESSURE_PLATE/INERT_BRIMSTONE→1） | C-4b 接 isPathingBlocker 后翻转为 blocker 全系 → PDS_OBSTRUCTION |
| 每格一层非空（C-4a-0 遗留） | c_4a_0_layer_model.test.ts 既有留痕，未触碰 | 下一轮（任务书 §三第 2 条） |

## 七、对抗性测试与反向验证

**对抗性测试**（测试文件内全部 15 用例中，能被具体错误实现打红的 ≥6 条）：

1. A1：T_PATHING_BLOCKER 漏一员（popcount=6）或混入外员（≥8）→ 红；
2. C1：blocksPassability / isPathingBlocker 互相别名化 → CHASM/TRAP 或
   DOOR/GRASS 断言红；
3. C2：blocksVision 别名化为 blocksPassability → FOLIAGE/DOOR 红；
4. C3：flags 抄错（DEEP_WATER 漏 T_IS_DEEP_WATER、楼梯漏 ITEMS、
   GRASS 沾 ENTANGLES）→ 红；
5. B3：webOnly 兜底值写错（BOG 丢 FLAMMABLE / SIGN 抄 T_SACRED /
   RESET_PLATE 抄 T_IS_DF_TRAP）→ 红；
6. B1：表缺键 / 枚举拼写错 → 运行时 undefined → 红；
7. D1/D2：迁移判据或表任一方改坏 → 查表 ≡ 旧清单逐位比对红；
8. E1：promote 字段被接上生产读者 → 静态扫描红。

**反向验证**（真实改坏 → 真实失败输出 → 还原；工作区已复核还原干净）：

BV1 — T_PATHING_BLOCKER 临时删去 `| T_IS_FIRE`：

```
FAIL  C-4a A：旗标常量位级正确性 > T_PATHING_BLOCKER 恰为七旗标并集
AssertionError: expected 532929 to be 534977
```

BV2 — WATER_DEEP 的 flags 临时漏 `T_IS_DEEP_WATER`：

```
FAIL  C-4a D：迁移安全性 > Game.canMoveTo（查表）≡ 旧清单
AssertionError: WATER_DEEP: expected true to be false
```

BV3 — canMoveTo 临时退化为只用 `blocksPassability`（模拟混用）：

```
FAIL  C-4a D：迁移安全性 > Game.canMoveTo（查表）≡ 旧清单
AssertionError: WATER_DEEP: expected true to be false
```

BV4 — BOG 兜底值临时丢 `T_IS_FLAMMABLE`：

```
FAIL  C-4a B：表完整性 > webOnly 地形的兜底旗标
AssertionError: expected +0 to be 1024
```

## 八、与预设不符之处（只列不修）

1. **任务书 §二.3 猜测"terrainAllowsMove 与 canMoveTo 本就一致，它们大概率
   能原样落到某个派生判据上"——前半对，后半错。**两者确实逐位一致，但
   旧口径 {GRANITE,WALL,SECRET_DOOR,LOCKED_DOOR,WATER_DEEP} **不等于任何
   单一 CE 旗标或预定义复合旗标**：T_DIVIDES_LEVEL 多出 AUTO_DESCENT/IS_DF_TRAP/
   LAVA_INSTA_DEATH（会把 CHASM/TRAP/LAVA 也挡掉）；T_OBSTRUCTS_SCENT /
   T_WAYPOINT_BLOCKER 还要多 VISION/SPONTANEOUSLY_IGNITES。实际迁移用
   `!blocksPassability && !isDeepWater` 合取。两者合取恰好逐位等价旧口径，
   已全枚举钉死（测试 D1/D2）。
2. **P1-38 的因果链已过时（§5.3 详述）**："气味图、安全图、路径点距离图
   全都读 calculateMap"在 P4-9 之后不成立——生产零调用 calculateMap，
   四个消费方各自自算 cost 走 batchScan，深水/锁门误判的实际来源是它们
   直接读 `cell.isPassable` 字段（Scent.ts:37、SafetyMap.ts:118、
   WaypointMap.ts:235 等，均在禁改清单）。干跑测量仍按任务书要求对
   calculateMap 的口径做（数字本身就是 isPathingBlocker 口径的分歧规模），
   但"改 Pathfinding.ts"对生产行为的影响是 0——真正的翻转点在
   setTerrain 启发式与各消费方。
3. **任务书 §病灶表"`canMoveTo` 不排除 CHASM……碰巧是 CE 的正确行为"——
   确认属实但补充**：CE 的 canMoveTo 对应语义不止"放行 CHASM 碰巧对"，
   它对 LAVA、TRAP、PRESSURE_PLATE、INERT_BRIMSTONE 也全放行（§5.3 的
   10657 格语义分歧），这些同样"碰巧"是 CE 的 T_* 语义面，不止深渊一个。
4. 干跑测量中 LOCKED_DOOR=1022 格与 p1_33 报告的"锁门机器 1022 台"
   精确一致（每台一扇）——不是巧合，是交叉验证；列表于此供下一轮
   复用时不必重新对数。
5. 任务书给的锚点本轮全部核实无误：Rogue.h:1948（T_PATHING_BLOCKER 并集）
   ✓、Globals.c:627 DF 条目属 LIQUID 层的 C-4a-0 勘察（表沿用）✓。
6. Game.ts 新增了 1 行 import（TerrainCatalog 的两个判据）——"仅 canMoveTo
   一处"的必要配套，除 import 与 canMoveTo 函数体外 Game.ts 零改动
   （git diff 可复核：+16/-10 行中 import 2 行、canMoveTo 14 行）。

## 九、门禁读数

`npm test`（全量，未筛选）尾部：

```
 Test Files  63 passed (63)
      Tests  662 passed | 8 skipped | 5 todo (675)
   Start at  04:03:08
   Duration  235.90s (transform 2.23s, setup 0ms, import 16.12s, tests 1780.57s, environment 16ms)
```

`npm run build` 尾部：

```
- Use build.rollupOptions.output.manualChunks to improve chunking: ...
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.36s
```

`generation_baseline`（未重采）：

```
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  04:08:17
   Duration  10.19s (transform 177ms, setup 0ms, import 295ms, tests 9.82s, environment 0ms)
```

坏层闸门（verbose 输出摘录）：

```
✓ p1_26 > 上楼梯能走到下楼梯——严格 0（P1-29 清湖泊致、P1-33 清机器致）
✓ p1_29 对抗 AD1：闸门短路（总是接受候选位置）时不可达必须回升
[p1_33] 修复后 15 种子 × D1-D26 = 390 层：坏层=无；机器 1525 台（平均 3.91/层，
        零机器层 15），锁门机器 1022 台。修复前基线：1920 台（4.92/层）、坏层 5。
```

`git diff --stat`：

```
 brogue-web/src/engine/Core/Game.ts        | 16 ++++++----------
 brogue-web/src/engine/Map/Connectivity.ts | 16 ++++++++--------
 2 files changed, 14 insertions(+), 18 deletions(-)
```

（另有两个未跟踪新文件：`src/engine/Map/TerrainCatalog.ts`、
`src/test/c_4a_terrain_catalog.test.ts`；`git status` 无其他改动，
fixtures/ 与全部既有测试零改动。）
