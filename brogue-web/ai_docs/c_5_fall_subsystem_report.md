# C-5 坠落子系统报告 —— 解禁 CHASM 与桥梁（吸收 P1-22）

日期：2026-09-17　分支：round/c-5　执行方：ZCode/GLM

---

## 〇、TL;DR

1. **坠落本体按 CE 全链落地**：玩家/怪物两套伤害表、回合末结算时序、悬浮豁免、跳渊确认、
   旧渊格坐标落位（含围湖检查）、幸存怪物跨层转生、最深层"奇怪的力量"。
2. **P1-22 下坠药水接通**：`fall_down` 从一行日志变成 `DF_HOLE_POTION → DF_HOLE_2` 真实
   DF 链（悬浮时洞照开、人不坠，CE 原味）；**pit_bloat 的死亡 DF 同轮接线**。
3. **§六 逐字重核抓到一个真雷**：C-2 留形的 `pathingDistance` 不可达返回 `-1`，而 CE 距离图
   不可达是 `pdsClear(30000)`（`PDS_FORBIDDEN=-1` 是 calculateDistances 的**代价标记**不是
   距离值）。`-1` 让比值判据恒假 → **"干地被深渊切断必须架桥"这一桥的主场景永不生成**。
   已修正并附反向验证（任务书预告 buildABridge 不需要改——实际情况见 §五.1）。
4. **桥梁实测从 0 → 非零**：5 种子 × D1-D26 = 130 层中 BRIDGE+BRIDGE_EDGE 共 14 格、2 层含桥。
5. **§三 结论**：CE 的生成期连通性保障是 `lakeDisruptsPassability`（干地 = 非
   T_PATHING_BLOCKER 全连通，**深渊属于阻断集**）——"跳深渊"在 CE 里从来不是可达性通道，
   而是玩家可选捷径。web 现有闸门字面口径继续有效，实测 p1_26/p1_29/p1_33 全绿（§三）。
6. **预期内红灯**：`generation_baseline` 全线变红（未刷新，待验收方授权重捕获）；
   g_2/g_3 共 4 条 FIRE-NAT 哨兵翻红，**证据链证明纯系地图迁徙、引擎无责**（§六）。
   除上述外全量其余 848+ 测试全绿。

---

## 一、坠落本体：CE 行号与复核要点

### 1.1 数值（自行抠取，均实测验证）

| 项 | CE 出处 | 值 |
|---|---|---|
| 玩家坠落伤害 | `variants/GlobalsBrogue.c:1044-1045` `fallDamageMin/Max` + `Time.c:1144` `randClumpedRange(…, 2)` | **8-10，clump 2** |
| 怪物坠落伤害 | `Time.c:1558` `randClumpedRange(6, 12, 2)` | **6-12，clump 2**（与玩家是两张表） |
| 深水落地 | `Time.c:1146-1150` | **零伤害**（"You fall into deep water, unharmed."） |
| 浅水/沼落地 | `Time.c:1156-1158`（`TM_ALLOWS_SUBMERGING` → `damage /= 2` CE 整除） | **减半**（4-5） |
| 经 `inflictDamage` | `Combat.c:1800-1855` | **不吃护甲减免**；`MONST_INVULNERABLE` 免伤；STATUS_SHIELDED 吸收（web 护盾全库本就不挡伤害，同口径登记） |

实测分布（20000 抽，seed 20260928）：玩家 8:25.0% / 9:50.2% / 10:24.8%；
怪物 6:6.5% / 7:12.7% / 8:19.2% / 9:25.0% / 10:18.3% / 11:12.3% / 12:6.1% —— 标准 clump2 钟形。

### 1.2 时序（任务书点名的"回合末结算"，逐处复核）

- **置位 ≠ 坠落**：`Time.c:168-176`（`applyInstantTileEffectsToCreature`）——渊上生物置
  `MB_IS_FALLING`；**玩家置位后立即 return（跳过本格其余地形效果），怪物只置位不返回**。
  另一个置位点 `Movement.c:1474-1476`：玩家移动完成后 `monsterShouldFall(&player)` 置位。
- **结算门 1（每回合）**：`Time.c:2480-2486` `playerTurnEnded` 顶部——`handleXPXP` 之后、
  **tick 记账（:2604-2609）与气味推进（:2506）之前**：`playerFalls(); return;`——坠落回合
  **整段 return，没有怪物推进**。其后 `Time.c:2492` 每回合 `monstersFall()`（注释原文：走得
  比环境更新快的怪物不能悬在渊上行动）。
- **结算门 2（循环内）**：`Time.c:2866-2871`——do-while 每圈在 `applyInstantTileEffects(&player)`
  之后检查旗标 → `playerFalls(); return;`。
- **结算门 3（每 100 tick）**：`Time.c:1597`——`updateEnvironment` 的第一条语句
  `monstersFall()`（先于暴露位重置/气体/晋升/火各段）。
- **`monsterShouldFall`（`Time.c:110-116`）**：非悬浮 && 格带 `T_AUTO_DESCENT` &&
  格不带 `T_ENTANGLES|T_OBSTRUCTS_PASSABILITY` && 非 `MB_PREPLACED`。
- **`playerFalls`（`Time.c:1122-1180`）次序**：flavor 文案（:1133-1141）→ `monstersFall()`
  （:1124，**怪物先于换层随落**）→ 清 `MB_IS_FALLING|MB_SEIZED|MB_SEIZING`（:1137）→
  `rogue.disturbed = true`（:1138，web 同义 = 中断自动寻路）→ 非 40 层：`depthLevel++` →
  `startLevel(depthLevel-1, 0)` → 落位 → 伤害；**40 层**：`Time.c:1164-1167`
  "A strange force seizes you as you fall." + `teleport(&player, INVALID_POS, true)`（随机传送）。
- **`monstersFall`（`Time.c:1530-1583`）**：可见怪播 "plunges out of sight"（:1548-1560，
  CE 自带中文串）→ `MONST_GETS_TURN_ON_ACTIVATION` 必死（:1553-1556，注释原文：绝不能活到
  下一层挡路）→ 其余 6-12 clump2 → 幸存者清坠落位、**置 `MB_PREPLACED`**、
  `prependCreature` 到下一层链（:1561-1577）→ 亡者 `killCreature`。
- **落位（`RogueMain.c:820-841`，stairDirection==0）**：以**旧渊格坐标**为心
  `getQualifyingLocNear`（`Grid.c:347-356` 环搜索；阻挡 = `T_PATHING_BLOCKER & ~T_IS_DEEP_WATER`
  ——**深水可落**；占用排除 = HAS_MONSTER|HAS_ITEM|HAS_STAIRS|IS_IN_MACHINE）；
  落进深水后查"能否游出"（:827-839，游泳口径 pathingDistance 到最近干地，不可达 = 围湖 →
  挪到干地）。`startLevel` 头部 `synchronizePlayerTimeState`（:562）与
  "Load up next level's monsters"（:673-676）均有对应。

### 1.3 web 移植对照（`src/engine/Core/Game.ts`）

| CE | web |
|---|---|
| `monsterShouldFall` | `creatureShouldFall(entity)`（玩家/怪物同式；怪物 MONST_FLIES 已折进 `hasStatus('levitating')`） |
| `MB_IS_FALLING`（玩家） | `Game.playerFalling` 私有位（Player.ts 禁改，位挂 Game） |
| `MB_IS_FALLING` / `MB_PREPLACED`（怪物） | `Monster.falling` / `Monster.preplaced`（本轮唯一 entities 侧改动，任务书授权的 bookkeeping 位） |
| 结算门 1/2/3 | `playerTurnEnded` 顶部 / `advancementLoop` 客观块后 / `objectiveTimeBlock` 晋升驱动前 |
| `playerFalls` | 同名私有方法，逐段对照见代码注释 |
| `monstersFall` | 同名私有方法；幸存者 → `pendingFallenByDepth`（目标层未生成）或直接并入缓存层怪物表（已生成）；`generateDepth` 新层分支排空 + `findQualifyingPathLocNear` 重定位 + 清 `preplaced`（CE `restoreMonster` Architect.c:3537-3550 的 MB_PREPLACED 分支） |
| 跳渊确认 | `diveConfirmationNeeded`（Movement.c:1303-1322 前置条件串逐条）+ `onConfirmRequest` 钩子（仿 `onRenderRequested` 模式） |

### 1.4 下坠药水（P1-22）与 pit_bloat

- CE `Items.c:8095-8100`（POTION_DESCENT）：`spawnDungeonFeature(DF_HOLE_POTION, refreshCell=true,
  abortIfBlocking=false)` → **非悬浮才置 `MB_IS_FALLING`**（悬浮时洞照开、人不坠）。
  web `quaffItem 'fall_down'` 分支照抄；`abortIfBlocking=false` 与 CE 第四参一致
  （洞允许切断关卡——CE 靠 promoteChance 负值让洞自行合拢）。
- DF 链（枚举 id 经锚点校准的脚本核对，锚点 = web 已钉死的 DF_SHOW_DOOR=13 /
  DF_PLAIN_FIRE=100 / DF_EMBERS=107 / DF_POISON_GAS_CLOUD=125 / DF_MACHINE_PRESSURE_PLATE_USED=154 /
  DF_BLOAT_EXPLOSION=35 全中）：
  - `DF_HOLE_POTION` = **135**（Rogue.h:1632），目录行 `Globals.c:782`
    `{HOLE_EDGE, SURFACE, 300, 100, 0, "", 0, &darkBlue, 3, 0, DF_HOLE_2}`；
  - `DF_HOLE_2` = **115**（Rogue.h:1608），`Globals.c:756` `{HOLE, SURFACE, 200, 100, 0}`；
  - `DF_HOLE_DRAIN` = **116**（Rogue.h:1609），`Globals.c:757` `{HOLE_EDGE, SURFACE, 0, 0, 0}`——
    HOLE 的 promoteType（`promoteChance -1000` 负值扩散型： Promotion.ts 首趟对每个 4 向开敞
    邻居 +1000，`Time.c:1627-1642`），洞在开放处约数回合自行合拢。
- 新地形 `HOLE`（Globals.c:442，T_AUTO_DESCENT + STAND_IN_TILE|VANISHES，prio 9）与
  `HOLE_EDGE`（Globals.c:444，零旗标 + VANISHES，prio 50），均落 SURFACE 层
  （:756/:782 DF 目录 layer 列同证）。
- **pit_bloat**（`Globals.c:1039` monsterCatalog 死亡 DFType = DF_HOLE_POTION）：
  `Game.triggerDeathFeatures` 新增分支，与 bloat/explosive_bloat 同链路
  （`Combat.c:1965-1967`，abortIfBlocking=false）。原 :5355 登记的缺口随之销账。

---

## 二、§三 分析：深渊存在时坏层闸门的正确语义（裁决权在验收方）

### 2.1 CE 自己怎么看

- **生成期保障**：`Architect.c:2588-2636` `lakeDisruptsPassability`——候选湖**假想放置**后，
  从任一干地格泛洪，所有"干地"必须全部连通，否则该湖位置被拒绝（调用点 `:2664`，
  `buildLakes` 每个湖 20 次尝试位）。**干地的定义是"不带 T_PATHING_BLOCKER"**
  （:2597-2601 的取种与 :2624-2630 的校验都用它），而 `T_AUTO_DESCENT ⊂ T_PATHING_BLOCKER`
  （Rogue.h:1948）——**深渊在 CE 的生成期连通性判据里属于阻断物**。
- 即：CE 保证的是"**干地（非渊/非深水/非岩浆/非墙）全连通**"，楼梯都落在干地上
  （`placeStairs` Architect.c:3690 的 `validStairLoc` + 兜底排除
  `T_AUTO_DESCENT|T_IS_DEEP_WATER|T_LAVA_INSTA_DEATH`），因此"上楼梯走到下楼梯"**不依赖
  跳深渊**。跳深渊在 CE 里是玩家可选的捷径/逃生通道，不是连通性必需品。
- 生成后的其他铺地形路径（机器 `levelIsDisconnectedWithBlockingMap`（:724/:1197/:1451/:1831）、
  游戏期 DF 的 abortIfBlocking）同样以连通性为否决项；**例外**恰是本轮接的两个载体——
  下坠药水与 pit bloat 的 `DF_HOLE_POTION`（调用面 abortIfBlocking=false）：CE 允许洞切断
  关卡，因为洞会被 promoteChance 负值机制自行合拢。
- **任务书线索 mapToShore（Architect.c:2990-3008）的定性**：它把 `T_AUTO_DESCENT` 与深水、
  岩浆并列（:3002-3004）——但它是**运行期**设施（每回合惰性重算，`Time.c:2889` 的
  "point of no return" 悬浮警告、`Monsters.c:1455/1484` 的 AI 决策消费），不是生成期保障。
  它的语义与 §2.1 一致：深渊是"需要算撤离距离的危险地形"，不是通道。

### 2.2 对 web 闸门的结论与建议

- web 生成期的湖放置闸门（`Connectivity.lakeDisruptsPassability`，P1-29）在判据上与 CE 对齐：
  候选湖格（含 CHASM）视为阻断，干地（`terrainAllowsMove` = !(OBSTRUCTS|DEEP_WATER)）必须
  全连通。CHASM 解禁后该闸门**自动把深渊湖纳入同一否决**，无需修改。
- e2e 闸门（"从上楼梯能走到下楼梯"，`Game.canMoveTo` 口径）中 CHASM 是可走的
  （CE 亦然——踩上不等于穿过，悬在渊上一格本来就不禁止），这使 e2e 判据比 CE 的
  干地判据**更宽松**而非更严：凡是 CE 会放行的层 e2e 必放行。**建议维持现字面口径**；
  若验收方希望严格对齐 CE 的生成期干地判据，可在 e2e 里改用
  `terrainAllowsMove && !isAutoDescent` 口径——属口径收紧，非本轮擅自改动。
- **实测**：p1_26_invariants / p1_29_lake_connectivity / p1_29_adversarial_gate /
  p1_33_machine_chokepoint 在解禁后的本轮全量运行中**全部绿灯**（无一红），与上述
  "e2e 口径更宽松、生成闸门已覆盖深渊"的推断一致。**裁决前闸门按现有字面口径跑通，
  未改任何闸门判据。**

---

## 三、§七.2 实测数据

### 3.1 深渊出现率随深度（5 种子 × D1-D26 = 130 层，真实生成）

- 含深渊族（CHASM/CHASM_EDGE）的层：**29/130 = 22.3%**；CHASM 格总数 539。
- 分深度样本（5 层/档）：

| 深度 | CHASM 格 | CHASM_EDGE 格 | BRIDGE+EDGE 格 |
|---|---|---|---|
| D1 | 21 | 11 | 0 |
| D2 | 21 | 11 | 0 |
| D3 | 0 | 0 | 0 |
| D4 | 6 | 6 | 0 |
| D8 | 0 | 0 | 0 |
| D12 | 0 | 0 | 0 |
| D16 | 16 | 10 | 0 |
| D17 | 85 | 37 | 0 |
| D20 | 70 | 35 | 0 |
| D24 | 34 | 12 | 0 |
| D26 | 0 | 0 | 0 |

  （D17+ 密度最高：液体候选 {0,1,2,3} 中深渊占 1/4 且深层湖更多；单档全 0 是 5 层小样本
  的正常涨落——全深度域 400×40 抽的 liquidType 层面断言见 c_2_lakes 新用例。）

### 3.2 桥梁（C-2 起恒 0 → 本轮首次非零）

- 5 种子 × D1-D26：**BRIDGE+BRIDGE_EDGE 共 14 格，2 层含桥（1.5%）**。
- 稀有度与 CE 判据相符：`100 * pathingDistance / (k-i) > bridgeRatio`（ratio 随深度
  100+11·depth 上下）+ 两侧须为渊/墙 + 至少一处开敞——"值得架且架得起来"的场面本来就少。
- 构造场景下桥梁机器完全可用（对抗⑥：全高深渊带切断两岸 → 必架桥）。

### 3.3 玩家/怪物坠落发生率

- 玩家坠落入口三处已全部激活（踩渊/药水/pit_bloat 洞）。真实游玩率未做长程统计
  （本轮无长程自走轮次）；机制发生率由测试钉死：踩渊必坠（悬浮除外）、药水必洞必坠
  （悬浮除外）、pit_bloat 死亡必洞。
- 怪物坠落：渊上怪物在玩家回合末/客观块必坠（对抗②④），幸存者跨层出现。

---

## 四、§六 留形分支逐字重核声明

**已逐字符重核 `buildABridge`（CE Architect.c:2786-2876）与 CHASM 相关分支，
并发现且修正一处留形错误。**

重核结论：

1. `buildABridge` 本体的判据（比值整数算术 :2790-2791 / 列行洗牌 :2793-2796 / 起点
   非阻断非机器 / k 扫描条件（渊、非密、非墙、两侧渊或墙）/ foundExposure / 落点岸 +
   k-i>3 / `100*pd/(k-i) > ratio` / 盖 BRIDGE+两端 BRIDGE_EDGE、层归属）与 web 实现逐条
   一致——**本体无改动**。
2. **但它调用的 `pathingDistance`（LakeSystem 内部 BFS）错了**：C-2 留形版不可达返回
   `-1`，注释声称"CE 的 PDS_FORBIDDEN = -1（Rogue.h:2782）"。逐字核对
   `Dijkstra.c:236-260`：`PDS_FORBIDDEN(-1)/PDS_OBSTRUCTION(-2)` 是 `calculateDistances`
   的**代价图**标记；**距离图**以 `pdsClear(&map, 30000)` 清空（Dijkstra.c:247），
   `pathingDistance`（Dijkstra.c:252-258）返回的就是距离图原值 → **不可达 = 30000**。
   后果：比值判据 `100*pd/(k-i) > ratio` 对 30000 恒真（"绕不过去必须架桥"——桥存在的
   首要场景），对 -1 恒假（**桥永不生成**）。这正是任务书§六警告的"抄写错误躺过多轮"
   形态：C-2 时代 CHASM 不生成，该分支零真实输入，错误无法暴露。
   **处置**：改为返回 30000（附 CE 行号注释）；该错误在 c_2_lakes 里被一条留痕测试钉成了
   合同（"无绕行 → 不架桥"），按留痕规矩就地反转（§五.2）。
3. `liquidType` 解禁：候选域剔除逻辑删除，恢复 CE 原文 `rand_range(randMin, randMax)`
   （抽取次数不变，仍一次 rand_range；D40 特例的"抽后覆盖"次序保持）。
4. `cleanUpLakeBoundaries`/`fillLake`/`createWreath` 的 CHASM 分支：C-2 版按 CE 写就，
   本轮重核无发现改动点；web 守卫（"删可走格则跳过"）对 CHASM 湖的边界清理不触发
   （CHASM 可走，`terrainAllowsMove(CHASM)=true`），行为与 CE 一致。

---

## 五、既有测试断言的改动清单（逐条说明"为什么到期"；守卫未放宽）

### 5.1 `src/test/c_2_lakes.test.ts`

| 用例 | 改动 | 到期原因 | 守卫论证 |
|---|---|---|---|
| AD-A1 深度门槛 | D1 断言 `恒深水` → `∈{深水,深渊}` 且两者都出现；删除 D20 `无 CHASM` 行，改为 D20 四类液体齐现 | D1 候选域 {1} → {1,2}（解禁的直接后果） | 深度门槛守卫原样保留（D1-3 无岩浆/硫矿、D4-16 无硫矿、D17+ 硫矿齐现），阈值全未松 |
| AD-A3 镶边契约 | 新增 CHASM 分支 `{CHASM_EDGE, 1}`（CE case 2） | 原断言链没有深渊分支（不可达故无需） | 纯收紧 |
| 留痕"liquidType 全深度域永不产生深渊族" | **按其自带指示反转**：改为"深渊族在全深度域出现 + 镶边形态恒为 CHASM_EDGE×1" | 留痕自述"C-5 落地时应删除本断言并把候选域中的 2 加回" | 越界守卫保留：只认 CE 的深渊族形态、D40 恒深水特例仍在 AD-A2 钉死 |
| scanWidth=4 合并 | `18 格 WATER_DEEP` → `深水/深渊二选一且不混液，合计 18 格` | D1 种子 908 现抽中深渊 | 合并守卫（一组件、单一液体、18 格、lakeMap 清空）原样 |
| "深渊带完全切断→不架桥" | **反转**为"必须架桥"，名称改"C-5 已反转"，注释存档原断言 | 该留痕钉的是 §四.2 的留形错误（不可达=-1） | 反转依据是 CE Dijkstra.c:247 原文，非放宽 |

### 5.2 `src/test/c_2_lakes_e2e.test.ts`

- 留痕"深渊族地形恒 0"→ **按其自带指示反转**：真实生成中深渊族总数 > 0 + 输出层数统计；
  注释保留原断言全文。干地连通合同与清理幂等合同（相邻用例）**一字未动**且继续绿灯。

### 5.3 `src/test/c_4a_0_layer_model.test.ts`（结构性穷尽表）

- `TERRAIN_HOME_LAYER`/`DRAW_PRIORITY` 的穷尽 `toEqual` 各加 `HOLE`/`HOLE_EDGE` 两行
  （SURFACE / 9 / 50，CE Globals.c:442/444 原值）。穷尽性未破坏——仍是全表比对。

### 5.4 `src/test/c_4a_terrain_catalog.test.ts`

- TerrainType 键数 `41 → 43`（HOLE/HOLE_EDGE 入列，注释续写演化史）；webOnly 四条清单、
  零旗标清单、迁移安全性（legacyAllowsMove 全枚举比对）等其余断言一字未动。

### 5.5 `src/test/c_4b_dungeon_feature.test.ts`

- E1 目录条目数 `23 → 26`（注释续写），新增三条 id 锚点断言（115/116/135）；
- E2 闭包：`DF_HOLE_POTION` 以"第二起点"入闭包（**沿用 F-2c 为 DF_BLOAT_EXPLOSION 立的
  先例**：起点是 Items.c:8097 与 Globals.c:1039 的调用面），`DF_HOLE_2`/`DF_HOLE_DRAIN`
  经 subsequentDF / HOLE.promoteType 自动入闭包。"目录键集 == 闭包"的守卫原样。
- E3 字段抽查未动（本就通过）。

### 5.6 `src/test/c_4c_promotion.test.ts`

- E1 的 `depth===20` 硫矿断言：**采样前提失效**（CHASM 入候选后 D20 候选 {0,1,2,3}，
  固定 7 种子本轮恰好全不抽中硫矿——抽样涨落，非候选丢失）。不变量（≥17 层有硫矿）
  原样保留，采样面扩为 **40 种子 × D20 生成期盘点**（不钉规模，阈值 >0 未松）。
- E3 负值留痕"CE 11 种负值地形全不在 web 内"→ **反转**：负值载体改为恰为
  `['HOLE:-1000','HOLE_EDGE:-500']`（CE 原值），负值扩散分支从死数据变活数据。

### 5.7 未动（授权清单内但无到期断言）

`c_2_lakes_determinism`（run-internal 一致性，绿）、`p1_29×2`、`p1_24`、`f_1`、`f_2a`、
`p1_42`、`p2_6`、`c_3`、`c_4a_0` 其余用例——全部绿灯，一字未动。
**火与气体的既有断言（g_1/g_2/g_3/f_2a/f_2c）一字未动**（含翻红的四条，见 §六）。

---

## 六、火与气体哨兵（§七.1）＋ 预期内红灯的处置

### 6.1 现状

| 哨兵 | 状态 |
|---|---|
| `g_3` 对抗⑨ FIRE-NAT seed2026/seed777（真实 D1 地图） | **红**（取景点坐标断言失败——地图变了） |
| `g_2` 对抗⑤ FIRE-NAT seed2026/seed777（真实 D1 地图） | **红**（同因） |
| `f_2c` 对抗⑩ FIRE-NAT seed42 | 绿（该种子 D1 湖泊未抽中深渊，地图未变） |
| `g_1` 对抗⑧ + 9000 整除守恒（合成/种子无关） | 绿 |
| `f_2a` 全部 | 绿 |
| 我方新增合成火哨兵（c_5 对抗⑧：场景自建 + 流复位，逐位曲线 `[1,1,1,3,6,6,6,7,8,8,8,11,11,11]`） | 绿 |

### 6.2 证据链：翻红纯系地图迁徙，引擎无责

**实验**：临时把 `liquidType` 恢复为 C-2 原抽取（单次 `randRange(0, len-1)`、候选域剔除 2，
保证 RNG 流逐位复原），**引擎其余全部保持 C-5 新代码**，复跑：

```
npx vitest run src/test/g_2_gas_df_wiring.test.ts src/test/g_3_gas_effects.test.ts
→ Tests  43 passed (43)        （含四条翻红哨兵全部逐位回绿）
```

随后立即还原为 CE 原文抽取（`diff` 校验字节一致）。结论：C-5 的全部引擎改动
（坠落/DF/地形/怪物簿记）**没有移动火侧任何一次 RNG 抽取**；四条哨兵翻红的唯一成因是
CHASM 解禁改变了 seed2026/777 的 D1 地图（湖泊抽中深渊 → 取景点位移），与
`generation_baseline` 全红**同因同源**。按任务书"火与气体的断言一字不许动"，
这四条断言本轮**未做任何改动**，留红待验收方授权重捕获（建议口径：与新地图重捕曲线，
或把探针改为合成场景/流复位形态——c_5 对抗⑧ 可作范本）。

### 6.3 `generation_baseline.json`

预期内全线变红（任务书§五预告），**未刷新**。4 seed × D1-D26 的地形指纹/怪物数/物种/物品数
全部偏离，成因 = 深渊湖改写地图与后续 RNG 流分配。待授权重捕获。

### 6.4 坏层闸门（§七.5）

`p1_26_invariants` / `p1_29_lake_connectivity` / `p1_29_adversarial_gate` /
`p1_33_machine_chokepoint` **全部绿灯**（按现有字面口径，未改判据）——印证 §三 的推断。
全量运行中所有失败均逐一复核为断言失败，**无 `Test timed out` 型假红**
（本轮机器上无并行轮次争抢；单跑复核亦一致）。

---

## 七、对抗性测试与反向验证（真实失败输出）

### 7.1 新增 `src/test/c_5_fall_subsystem.test.ts`（13 条，全绿）

覆盖任务书§八要求的七类对抗断言，每条 it() 注释写明"能捕获的具体错误实现"：

1. **回合末结算**（对抗①）：踩渊动作的 RNG 消耗增量 pin 为 7550（= 换层生成固定消耗）；
   断言 rat 不动、坠落必发生。
2. **悬浮豁免**（对抗②）：悬浮玩家站渊多回合不坠、已发现渊不弹确认；飞行怪（bloat）
   不坠 vs 睡着的落地怪（kobold）必坠。
3. **clump 参数**（对抗③）：40 种子干地落点伤害全部 ∈[8,10] 且样本方差 <0.5
   （clump=1 的期望方差 ≈0.67）；深水零伤；浅水减半 ∈[4,5]。
4. **怪物会掉**（对抗④）：渊上 200 血怪在回合末离层且幸存，玩家坠落同层重聚，
   `preplaced` 清位。
5. **确认提示**（对抗⑤）：已知渊弹确认（文案走 i18n）+ 拒绝则不动不耗回合
   （`timeSystem.currentTick` 增量为 0）；接受则坠；**未知渊不弹确认直接坠**。
6. **桥梁解禁**（对抗⑥）：全高深渊带切断两岸必架桥（桥面 >0、桥端 = 2×条数）；
   真实生成 2 种子 × D1-26 深渊族 > 0。
7. **火回归哨兵**（对抗⑧）：合成场景逐位曲线（§6.1）。
   另有药水/悬浮药水、pit_bloat 出洞（对抗⑦）与确认的未知渊半边。

### 7.2 反向验证（六条，均真实改坏 → 贴真实失败输出 → 还原 → diff 校验零残留）

1. **踩上瞬间坠落**（move 分支直接 `playerFalls()`）：
   `坠落回合的 RNG 消耗增量偏离…: expected 7719 to be 7550` → 红。
   （该用例初版用怪物 tick/气味做观测面，实测抓不住这一破坏，已换 RNG 计数器——
   迭代过程如实记录。）
2. **悬浮豁免失效**（注释掉 levitating 检查）：3 条齐红——
   `悬浮玩家站渊上不得坠落: expected 2 to be 1`、
   `飞行怪（MONST_FLIES）不得从渊上坠落/受伤: expected 0 to be greater than 0`、
   `悬浮时洞也必须照开: expected false to be true`。
3. **clump 参数写错**（2→1）：`样本方差 0.692——clump 参数或取值域写错（期望 ≈0.33）:
   expected 0.6916… to be less than 0.5`。
4. **怪物永不坠落**（`monstersFall` 首行 return）：
   `坠层幸存者必须离开本层怪物表: expected true to be false`。
5. **未知渊也弹确认**（注释掉 isDiscovered 前置）：
   `未知渊格不得弹确认: expected 1 to be +0`。
6. **pathingDistance 哨兵回退 -1**（LakeSystem）：
   `被深渊切断的两岸必须能架桥（比值判据对 30000 恒真）: expected 0 to be greater than 0`
   ——这条同时是 §四 留形错误的活体演示。

还原后 `diff` 对备份字节一致，13 条用例复跑全绿。

---

## 八、与预设不符之处（只列不修/已按条款处理）

1. **任务书§二.2："buildABridge 已由 6 个构造场景钉死，本轮应当不需要改它"**——
   实际需要改（§四.2）：buildABridge 本体判据逐字正确，**但它依赖的 pathingDistance
   不可达哨兵是错的**，不改则"桥只在不需要桥的场面出现"。已改 + 反转对应留痕 + 反向验证。
   属于任务书§六预告的"留形抄写错误"实例。
2. **任务书§七.1"火与气体逐位不变须与 F-2c 后的基线一致" 与 §五"火与气体的断言一字不许动"
   存在内部张力**：FIRE-NAT 探针跑在真实生成地图上，CHASM 解禁必然改图（与
   generation_baseline 全红同因）。已按"一字不动"执行并留下引擎无责的证据链（§6.2）；
   **请验收方裁决重捕获口径**。
3. **c_4c E1 的 D20 硫矿断言**：解禁后 D20 候选域扩大导致固定种子抽样落空（§5.6）——
   属采样前提到期而非候选丢失，已扩采样面、阈值未松。
4. **CE 无"坠落时物品散落"机制**；CE 真实存在的是 `updateFloorItems`（Items.c:1209-1240，
   **渊上的物品坠到下一层**，随 `playerFalls` 调用）——web 未实现，**登记**（§九）。
5. **`onConfirmRequest` 钩子为 null 时按"确认"处理**：CE `confirm(prompt, defaultAnswer=false)`
   的默认答案是拒绝；web 在无 UI 的 headless/未接线状态下若默认拒绝会使渊格永不可主动踏入。
   差异登记，UI 轮接线后以 UI 实答为准（engine 侧钩子已就位）。
6. **悬浮确认前置的 `STATUS_LEVITATING <= 1`**：CE 允许"还剩 1 tick 的悬浮"视为不悬浮；
   web `hasStatus` 是布尔（>0）。微差登记（影响仅"悬浮最后一 tick 踩渊是否弹窗"）。
7. **玩家坠落不吃护甲**：CE `inflictDamage` 本就不减护甲，web 直接扣血同口径；CE 的
   STATUS_SHIELDED 吸收未移植（web 护盾全库不挡伤害，P4-1b 同款登记）。
8. **目标深度 > 40 的坠层幸存者就地消失**：CE 的 `levels[]` 容器恒可写（玩家不可达的层），
   web 无该容器。登记。
9. 任务书§七.4 与§六对"generation_baseline 必然全红"的预告属实，已如实保留红灯。

---

## 九、给 C-6 / C-7 的登记清单

**坠落侧留给后续轮次（均已在代码注释登记）：**
1. `updateFloorItems`（Items.c:1209）：渊上物品随坠到下一层 + "plunges out of sight" 消息——
   建议 C-6 若接物品系统轮时一并做（web 物品无跨层容器，需随 levels 缓存走）。
2. 坠层幸存者的 `demoteMonsterFromLeadership` 与 `targetCorpseLoc` 清理（Time.c:1560-1563）
   ——web leader/follower 谱系简化，未做。
3. `rogue.mapToShore`（Architect.c:2990-3008）运行期"撤离距离"设施（悬浮警告/点 no return、
   AI 用）——未实现；生成期安全性已由 lakeDiscontinuity 闸门覆盖。
4. `Movement.c:371` 的 "suspended in mid-air" 描述文案（纯渲染列）——未迁移。
5. DF_HOLE_POTION 的 `&darkBlue` 光效（effectRadius 3）——数据已在目录登记，光效列不迁移。
6. `onConfirmRequest` 的 UI 接线（确认对话框）——components 轮一行挂接即可。
7. 怪物 `MB_SEIZED/MB_SEIZING` 清位：玩家侧已清（player.seized），怪物侧 web 无该簿记。
8. C-6 runAutogenerators / C-7 光照：本轮未触碰，无前置阻碍；CHASM 湖已进入生成池，
   两者照常读 grid 即可。

---

## 十、验证凭据

### 10.1 `npm run build`（尾部）

```
✓ 797 modules transformed.
dist/assets/index-BA3Sw60Z.js               801.84 kB │ gzip: 244.02 kB
✓ built in 1.58s
```

（无类型错误；唯一的 chunk 体积 warning 为既有状态。）

### 10.2 全量门禁 `npx vitest run --fileParallelism=false`（尾部）

```
 Test Files  3 failed | 72 passed (75)
      Tests  5 failed | 856 passed | 8 skipped | 5 todo (874)
 Duration  1185.09s
```

失败明细（全部为预期内/已裁定保留项，共 3 文件 5 条）：
- `generation_baseline.test.ts` ×1：基线全红（任务书预告；未刷新）。
- `g_2_gas_df_wiring.test.ts` ×2、`g_3_gas_effects.test.ts` ×2：FIRE-NAT 真实地图哨兵，
  地图迁徙所致，引擎无责（§6.2 证据链），按"火与气体的断言一字不许动"保留红。

（修复前全量：13 failed / 848 passed；11 条到期断言已按 §五 翻转/更新，仅剩上述 5 条
预期内红灯。两轮全量与全部单跑复核中**零 `Test timed out`**，所有失败均为真断言失败。）

### 10.3 `git diff --stat`

```
 brogue-web/src/engine/Core/Game.ts                 | 454 ++++++++++++++-
 brogue-web/src/engine/Map/DungeonFeatureCatalog.ts |  41 ++
 brogue-web/src/engine/Map/Grid.ts                  |  23 +-
 brogue-web/src/engine/Map/LakeSystem.ts            |  45 +-
 brogue-web/src/engine/Map/TerrainCatalog.ts        |  35 ++
 brogue-web/src/entities/Monster.ts                 |  15 +
 brogue-web/src/locales/zh_CN.json                  |   9 +
 brogue-web/src/test/c_2_lakes.test.ts              |  69 +++-
 brogue-web/src/test/c_2_lakes_e2e.test.ts          |  18 +-
 brogue-web/src/test/c_4a_0_layer_model.test.ts     |   2 +
 brogue-web/src/test/c_4a_terrain_catalog.test.ts   |   4 +-
 brogue-web/src/test/c_4b_dungeon_feature.test.ts   |  15 +-
 brogue-web/src/test/c_4c_promotion.test.ts         |  27 +-
 13 files changed, 701 insertions(+), 56 deletions(-)
 新增：src/test/c_5_fall_subsystem.test.ts（13 条对抗性测试）
```

### 10.4 i18n

`zh_CN.json` 新增 9 键（`fall.confirm / fall.flavor_chasm / fall.flavor_hole / fall.plunge /
fall.unharmed_deep_water / fall.injured / fall.strange_force / fall.monster_plunges /
death.fall`），全部按中文语序书写；既有键 `potion.descent` 继续使用（其文案"地板在你脚下
裂开！"与 CE 药水消息的意译关系沿用 C-2 前现状，未改值）。`p1_30_i18n_gate` 绿
（无死键、无缺键）。

### 10.5 边界自检

- `BrogueCE-master/`、`src/engine/Generator/`、`src/components/`、`src/data/*.json`、
  `Random.ts`、`vite.config.ts`、`harness.ts`、`p1_26/p1_33`、`generation_baseline.json`
  ——零改动（git status 仅含允许清单内文件 + 新测试）。
- 未执行任何 git 写操作。
