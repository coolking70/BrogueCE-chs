# P1-31 + P1-35 报告：玩家落位避开楼梯；读档重算 loopMap

分支 `round/p1-31`（worktree）。改动文件：
`src/engine/Core/Game.ts`、`src/engine/Map/SafetyMap.ts`（仅 P4-9 偏离回退）、
新增 `src/test/p1_31_35_placement_snapshot.test.ts`。
未执行任何 git 写操作；未触碰 `src/test/fixtures/*`、`src/data/*.json`、
`src/engine/Generator/`、`LoopMap.ts`、`BrogueCE-master/`。

---

## 一、P1-31：进层落位（CE RogueMain.c:817-869）

### 1.1 CE 行号对照

| CE 事实 | 位置 |
|---|---|
| `// Position the player.` 全流程在生成决策（布怪/布物）完成**之后** | RogueMain.c:817 |
| `stairDirection == 1 → player.loc = rogue.upLoc`；`== -1 → downLoc` | RogueMain.c:839-843 |
| 4 邻域搜索：`!cellHasTerrainFlag(loc, T_PATHING_BLOCKER) && !(flags & (HAS_MONSTER\|HAS_STAIRS\|IS_IN_MACHINE))` | RogueMain.c:845-851 |
| 兜底 `getQualifyingPathLocNear(player.loc, true, T_DIVIDES_LEVEL, 0, T_PATHING_BLOCKER, (HAS_MONSTER\|HAS_STAIRS\|IS_IN_MACHINE), false)` | RogueMain.c:853-858 |
| 方向枚举 UP/DOWN/LEFT/RIGHT = 0/1/2/3（北/南/西/东），4 邻域按此序 | Rogue.h:413-422 |
| `T_PATHING_BLOCKER` 旗标面 | Rogue.h:1948 |
| `T_DIVIDES_LEVEL` 旗标面 | Rogue.h:1949 |
| `getQualifyingPathLocNear`：目标格先试 → costMap 按 blocking 旗标置 PDS_FORBIDDEN → 源格 dist=1/cost=1 → `dijkstraScan(grid, costMap, true)` → 30000 归 0 → forbidden 旗标格归 0 → `randomLeastPositiveLocationInGrid`（deterministic=false → `rand_range`） | Grid.c:287-344 |
| 该函数末端还有一重路径无关的 `getQualifyingLocNear` 兜底 | Grid.c:347-356 |
| 楼梯 tile 旗标只有 `T_OBSTRUCTS_ITEMS\|T_OBSTRUCTS_SURFACE_EFFECTS`——**不含** T_PATHING_BLOCKER/T_DIVIDES_LEVEL，楼梯格是靠 HAS_STAIRS 地图旗标被排除的 | Globals.c:333-334 |

### 1.2 web 实现（Game.ts）

三件套，全部 private：

- **`placePlayerOnLevelEntry(target)`**：先把玩家置到目标格（楼梯），按
  北→南→西→东（CE 方向序）找第一个合格格；4 邻域全不合格 → 调
  `findQualifyingPathLocNear`。主路径零 RNG 消耗。
- **`entryQualifiesForPlacement(x, y)`**：CE 两面旗标的 web 近似——
  `!isPassable` 或 LAVA / WATER_DEEP / TRAP / 燃烧中 ⇒
  T_PATHING_BLOCKER；`getMonsterAt` ⇒ HAS_MONSTER；楼梯地形 ⇒ HAS_STAIRS；
  `machineCells` ⇒ IS_IN_MACHINE。
- **`findQualifyingPathLocNear(target)`**：`getQualifyingPathLocNear` 的
  web 端口，架在既有的 `DijkstraMap.batchScan`（P4-9 对 CE `dijkstraScan`
  的逐规则移植）上：cost 按 T_DIVIDES_LEVEL 置 −1（不可穿行），源格
  dist=1/cost=1（CE Grid.c:324-326），`batchScan(..., true)` 对应
  `dijkstraScan(..., true)`；取"路径距离最小的合格格"，**并列时按 CE
  deterministic=false 语义用 `rng.randRange` 随机取一**。仍无解时以
  切比雪夫环搜索近似 CE 末端的 `getQualifyingLocNear`（同旗标面、同随机）。

**调用点与 CE 时序对齐**：旧实现把落位放在 populateLevel 中段（布怪之前），
CE 是"布怪/布物全部完成后 Position the player"（RogueMain.c:817）。本轮把
落位**移到 populateLevel 末尾**（horde 怪、物品全部布设后），HAS_MONSTER
排除项才有数据可用。三个进层路径全部接上：

1. **新层下潜**（populateLevel 末尾）：`isGoingUp ? stairsDownPos : stairsUpPos`；
2. **缓存层重访**（generateDepth cached 分支）：同规则，此时怪物已随缓存恢复；
3. **首层出生态**：web 在地图中心强制放一格 vestibule STAIRS_UP（web 自创，
   CE 首层无上楼梯、走 stairDirection=0 的"fell into the level"路径），该格
   恰好压着出生点——按同一 4 邻域规则挪离楼梯。

### 1.3 与 CE 的口径差异（登记，不隐瞒）

| # | 差异 | 说明 |
|---|---|---|
| 1 | 首层落位走 4 邻域规则，不是 CE 的 stairDirection=0 路径 | CE 首层从随机点"坠入"、禁入集含 HAS_ITEM，且 CE 首层根本没有楼梯；web 的 vestibule 是自创物，用同一 stair 规则是最接近的合理映射。可观察保证一致：不站楼梯、站在可通行格 |
| 2 | IS_IN_MACHINE 数据源仅生成期可得 | web 快照 schema 无机器格字段：读档后 `machineCells` 为空集，该层落位检查退化为"不查机器"；重访缓存层经 `LevelState.machineCells` 随层走（本轮新增字段） |
| 3 | CE 楼梯"可作路径起点但结果禁入" | 任务书引用的 CE 代码本身无误；补充一个任务书未提的事实：楼梯不含 T_DIVIDES_LEVEL/T_PATHING_BLOCKER（Globals.c:333-334），排除靠 HAS_STAIRS 地图旗标。web 端口按此复刻（源格 cost 强制 1 + 结果过滤单列楼梯） |
| 4 | web 无 upLoc/downLoc 存储 | safety map 的楼梯禁入仍按地形扫描（P4-9 原状），落位目标由调用方显式传入 |

### 1.4 P4-9 有意偏离的回退（SafetyMap.ts）

CE Time.c:1833-1843 的字面顺序是**先玩家格修正、后楼梯禁入**：

```c
safetyMap[player.loc.x][player.loc.y] = 0;
playerCostMap[player.loc.x][player.loc.y] = 1;
monsterCostMap[player.loc.x][player.loc.y] = PDS_FORBIDDEN;

playerCostMap[rogue.upLoc.x][rogue.upLoc.y] = PDS_FORBIDDEN;   // 随后
monsterCostMap[rogue.upLoc.x][rogue.upLoc.y] = PDS_FORBIDDEN;
playerCostMap[rogue.downLoc.x][rogue.downLoc.y] = PDS_FORBIDDEN;
monsterCostMap[rogue.downLoc.x][rogue.downLoc.y] = PDS_FORBIDDEN;
```

玩家若站在楼梯上，后行的楼梯禁入会把唯一种子的代价打回 −1 → 全图平图。
这正是 P4-9 当时面对的困局：web 玩家出生态就站在楼梯上（P1-31 的病灶），
照抄 CE 顺序必然退化，于是把两段对调——项目里唯一登记在案的有意偏离。

**本轮已按回退条件恢复 CE 严格顺序**（SafetyMap.ts，含头注与内注更新）。
"玩家站楼梯 ⇒ 平图"现在是 CE 原样语义，由新测试 T5 锁死（见 §三）；
该状态在真实流程中被 P1-31 的落位保证不可达。

---

## 二、P1-35：读档后的生成期派生态

### 2.1 loopMap（本轮修复主体）

`loadSnapshot` 在网格/玩家/怪/物全部重建之后补：

```ts
this.loopMap = analyzeLoopMap(this.grid);
```

与 P1-34 是同一不变式（`loopMap ≡ analyzeLoopMap(当前网格)`）的读档面。
`analyzeLoopMap` 纯函数、零 RNG 消耗，不影响读档随机流。

### 2.2 存档往返派生态核查清单（必做第 2 条）

| 派生态 | 结论 | 处置 |
|---|---|---|
| **waypoint**（`WaypointSystem.coordinates/distanceMaps/count`） | **漏洞实锤**：读档后残留上一局的 waypoint，漫游怪按错误的 `distanceMaps` 选游走目标 | **本轮顺手补**：`loadSnapshot` 里 `rebuildWaypoints()`。CE 在重访层恢复后同样重建（RogueMain.c:771）；构建内部流隔离，不动 RNG |
| **气味图**（`scent`，P4-8） | **漏洞实锤**：`turnNumber` 与气味轨迹整体残留上一局，嗅觉追踪（`awareOfTarget`/`stepDirection`）吃到陈局数据 | **本轮顺手补**：`loadSnapshot` 里 `new ScentMap(...)` 重置为空图。CE 语义是恢复 `levels[d].scentMap`（跨层留存），web 快照 schema 无气味字段——重置为空是缺数据源下唯一诚实的选择；**schema 扩展登记为待办**（见下） |
| **machineCells**（本轮新增的 IS_IN_MACHINE 数据源） | 快照 schema 无此字段 | `loadSnapshot` 清空防残留；该层落位检查退化为不查机器（§1.3 差异 2） |
| **safetyMap / updatedSafetyMapThisTurn**（P4-9） | **核实无恙**：每玩家回合开始闩锁无条件复位（playerTurnEnded 前置块），`getSafetyMapForMonster` 首次访问必然触发全量重建（`buildSafetyMap` 纯函数）；读档与首回合之间不存在查询点 | 不动 |
| **monsterSpawnFuse**（RogueMain.c:403） | 读档不恢复也不重置，残留上一局计数值（0..175 有界） | **只登记不做**：需扩快照 schema |
| **ticksTillUpdateEnvironment**（RogueMain.c:404） | 同上，残留值使客观时间块相位偏移（有界、不崩溃） | **只登记不做**：需扩快照 schema |
| **levels 缓存 / everSeen* / autoPath / signTexts / testRooms** | `loadSnapshot` 已逐一清空（既有代码核实） | 不动 |
| **rng 流本身** | `loadSnapshot` 用 `snapshot.seed` 重播——读档后从种子头部重放，不接续存档时的流位置。这是 web 的既有设计（存档即种子+状态），非本轮病灶 | 登记，不动 |

**需大改、本轮只登记的**：把 `scentTurnNumber+气味图`、`monsterSpawnFuse`、
`ticksTillUpdateEnvironment`、机器格 塞进 `GameSnapshot`（schema v1 → v2
的版本化迁移 + 旧档兼容）属于独立轮次的活。

---

## 三、对抗性测试（`src/test/p1_31_35_placement_snapshot.test.ts`，10 条）

| # | 断言 | 捕获的错误实现 |
|---|---|---|
| T1 | 5 种子出生态：地形码非楼梯、格可通行、无怪、与楼梯切比雪夫 ≤1 | 旧实现"直接 `player.loc = 楼梯坐标`"（失败签名即验收探针的原始观察：`出生格 39,14 地形码 13`） |
| T2 | 十字舞台（4 邻全合格）必落**北**格 | 邻域方向序写错（8 邻域序/东优先等） |
| T3 | 密封舞台（5×5 全墙、唯一合格格外环距离 2）必落该格 | 4 邻域失败后不兜底（留在楼梯/落墙/放弃） |
| T4 | 真实下潜（新层路径）+ 爬回（缓存层路径）：不站楼梯、与目标楼梯正交邻接 | 两条进层路径任一仍直落楼梯坐标 |
| T5 | 玩家被摆上楼梯（CE 不可达态）：全图无任何格高于环境值 −111 | **P4-9 偏离复发**（玩家格修正挪回楼梯禁入之后）——种子复活、近场长出 0/−3/−6 梯度即翻红 |
| T6 | T8 等价：零改造真实关 + 玩家不站楼梯 ⇒ 取值 ≥10、可达域 >100、方向率 >0.5 | 回退把正常态 safety map 弄坏（种子死亡/漏松弛代价两类平化） |
| T7 | 跨局读档（42 局存档读入 777 局）：loopMap 与读入网格重算逐格相等，前提锚锁死"读档前不等"且"42 局确有环路" | 读档不重算 loopMap（本轮病灶本体） |
| T8 | 存档往返：自往返 + 跨局，逐格相等 | 同上（往返口径） |
| T9 | 读档后 waypoint 与显式重建逐坐标一致且非空 | 读档不重建 waypoint |
| T10 | 读档后 `scent.turnNumber` 复位、双方预埋的同坐标气味清零 | 读档不重置气味图 |

### 反向验证（强制条款，真实失败输出）

**验证一：把落位改坏成旧实现（直接赋楼梯坐标）** → 5 条翻红：

```
× T1 出生态不站楼梯：多种子地形码实测，格可通行、无怪、与楼梯正交邻接
AssertionError: seed 42: 出生格 39,14 地形码 13: expected true to be false
× T2 方向序 = CE Rogue.h:413-422（北>南>西>东）：十字舞台必落北格
× T3 4 邻域全不合格 → 兜底搜索：密封舞台唯一合格格在外环，必被找到
× T4 真实下潜/爬回两条进层路径：落位不站楼梯且正交邻接目标楼梯
AssertionError: 下潜后站楼梯上: expected true to be false
× T6 T8 等价（P4-9 零改造关卡梯度断言）
AssertionError: seed 42: 前提——修复后玩家不应站在楼梯上: expected true to be false
Tests  5 failed | 5 passed (10)
```
（T5 在坏实现下仍绿是符合设计的：它锁的是 CE 顺序语义，与落位实现无关。）
已还原，复跑 10/10 绿。

**验证二：注释掉 `loadSnapshot` 的 loopMap 重算** → 2 条翻红：

```
× T7 跨局读档：loopMap 必须与读入网格的 analyzeLoopMap 逐格相等
AssertionError: expected [ '4,6', '4,7', '4,8', '4,9', …(241) ] to deeply equal []
× T8 存档往返：自往返 + 跨局，loopMap 与重算结果逐格相等
AssertionError: expected [ '4,6', '4,7', '4,8', '4,9', …(164) ] to deeply equal []
Tests  2 failed | 8 passed (10)
```
（241/164 个陈旧环路格——错误环路图的实锤尺寸。）已还原，复跑 10/10 绿。

---

## 四、门禁结果

### `npm run build`：**绿**

```
✓ 791 modules transformed.
dist/assets/index-SKbFN-SE.js   751.40 kB │ gzip: 228.82 kB
✓ built in 1.38s
```

### `npm test`：**552 过 / 4 红**（红因逐条分列如下）

```
Test Files  4 failed | 50 passed (54)
     Tests  4 failed | 552 passed | 8 skipped | 5 todo (569)
```

| 红的测试 | 预期内？ | 红因 |
|---|---|---|
| `generation_baseline.test.ts`（383 处偏离，自 seed424242/D2 起） | **是（预告内）** | 落位改变 ⇒ 上一层最终站位改变 ⇒ 下一层 populateLevel 的"陈旧位置排除框"（floorTiles 收集时排除玩家旧位切比雪夫 5 邻域）移位 ⇒ 楼梯/物品/怪物落点与后续全部抽取移位。D1 指纹不动、偏离自 D2 起，与该机理精确吻合。**未刷新基线**，等验收方授权重捕获 |
| `p1_26_invariants.test.ts`（"上楼梯能走到下楼梯"） | 否（预告未点名，同族） | 同一 RNG 流移动 ⇒ 5 种子 × D1-D26 的地图整体换血 ⇒ 机器阶段坏层从已知 2 层变为 3 层（777/D19、20260916/D9、20260916/D20）。该测试文案自述"合并了会移动 RNG 流的轮次请复跑实测并更新"，属已知缺陷（P1-33 待修）在新地图上的重新计数，**非本轮引入的逻辑回归**（本轮未触碰生成器） |
| `p1_29_lake_connectivity.test.ts`（端到端坏层集） | 否（预告未点名，同族） | 同上：已知集 {20260916/D16, 424242/D19, 999/D18} → 实测 {777/D19, 20260916/D9, 20260916/D20, 42/D3, 55555/D23}。文件同样自述"合并了会移动 RNG 流的轮次，请复跑实测并更新 KNOWN_MACHINE_STAGE_BAD_LEVELS" |
| `p4_9_safety_map.test.ts` T8 | **半预期（结构性不可两全）** | T8 的舞台自洽断言（368-369 行）要求"出生态站在楼梯上"——这正是 P1-31 要消灭的病灶状态，修复后必然为假。梯度断言本体（取值 ≥10 / 可达 >100 / 方向率 >0.5）在新状态下依然成立，已由本文件 T6 等价重建并保持绿色（`p4_9` 其余 7 条 T1-T7 全绿，含 P1-34 修过的 T2/T7）。T8 文件属既有测试（禁止修改），**需要验收方裁决**：授权把 368-369 行的舞台断言从"站楼梯"改为"不站楼梯"，或接受该条让位 |

`p2_3_objective_time.test.ts` 单独复跑确认 **17 过 / 2 跳过，全绿**——任务书
预告它必红，实际未红（见 §五）。

---

## 五、与预设不符之处（只列不修）

1. **"P4-9 的 T8 仍然通过"与"玩家不落楼梯"在 T8 现有文本下不可两全。**
   T8 除了梯度断言，还有一条舞台自洽断言（`p4_9_safety_map.test.ts:369`）：
   `expect(startTerrain === STAIRS_UP || startTerrain === STAIRS_DOWN).toBe(true)`，
   它锁死的就是本轮要修的病灶状态。文件属"既有测试禁止修改"范围，故 T8
   必红、由本文件 T6 承接其梯度核心。需要验收方明确处置（改一行舞台断言，
   或接受红）。
2. **`p2_3_baseline` 没有变红**（预告两条基线必红，实际只有 generation_baseline）。
   单独复跑 17 过/2 跳过。推测原因：p2_3 的场景自建舞台、不做多层下潜，
   不吃"陈旧位置排除框"的流移动。这是好消息，但意味着任务书对红集合的
   预告与实测不符。
3. **`p1_26_invariants` 与 `p1_29_lake_connectivity` 额外变红**（两条预告未
   点名）。两者都是跨 D1-D26 的全生成链测试，是 RNG 流移动的必然后果，
   且两个文件的失败文案都自述了"合并会移动 RNG 流的轮次后应复跑并更新
   已知集"。已知集的具体更新值已在 §四 表中给出，**未动手改**（既有测试
   文件冻结 + 基线刷新需验收方授权）。
4. **任务书对病灶机理的一处表述需要修正**：任务书引用的 CE 落位代码无误，
   但"楼梯格因含 T_DIVIDES_LEVEL 而被排除"若作此理解则是错的——CE 楼梯
   tile（Globals.c:333-334）不含 T_DIVIDES_LEVEL/T_PATHING_BLOCKER，楼梯格
   在 4 邻域与 getQualifyingPathLocNear 中都是靠 **HAS_STAIRS 地图旗标**被
   排除的（getQualifyingPathLocNear 的目标格预检同样被该旗标挡下）。web
   端口按此复刻。
5. **兜底搜索的随机取一**：CE `getQualifyingPathLocNear(..., deterministic=false)`
   在并列合格格中用 `rand_range` 随机取一。web 端口同样走 `rng`——意味着
   该兜底一旦触发会消耗主流随机数。正常生成的地图楼梯四邻必为地板，兜底
   几乎不可能触发；但严格说这是"触发才移动 RNG 流"的路径，按 §四（确定性
   约定）如实登记。
6. **落位时序从"布怪前"挪到"布怪后"**（对齐 CE RogueMain.c:817）带来一个
   二阶后果：horde 成员的环形落格搜索（spawnHordeAt 内避开玩家当前位置）
   现在面对的是玩家旧位（CE 同样如此——布怪时 HAS_PLAYER 尚未置位），
   楼梯格因此可能被 horde 成员占据。这是 CE 行为，但与 web 旧行为不同，
   归入本轮有意变更。

## 六、验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| P1-31 必做 1：按 CE 实现落位（4 邻域 + 兜底） | ✅ §1.2；兜底架在 web 既有的 `DijkstraMap.batchScan`（CE dijkstraScan 移植）上，非"无等价函数" |
| P1-31 必做 2：回退 P4-9 有意偏离，恢复 CE 严格顺序 | ✅ §1.4 |
| P1-31 必做 3：复核 T8 仍通过 | ⚠️ 梯度核心绿（T6 等价重建 + p4_9 其余 7 条绿），T8 本体因舞台断言必红，待验收方裁决（§五.1） |
| P1-35 必做 1：loadSnapshot 补 `loopMap = analyzeLoopMap(grid)` | ✅ §2.1 |
| P1-35 必做 2：复核其余派生态，能补则补 | ✅ §2.2：waypoint/气味/机器格顺手补，fuse/环境门/schema 扩展登记 |
| 对抗性测试 ≥4 条 | ✅ 10 条（§三），每条指认具体错误实现 |
| 反向验证 ≥2 条（真实改坏→失败输出→还原） | ✅ §三：两条，输出为真实捕获 |
| 存档往返测试：loopMap 逐格相等 | ✅ T7/T8 |
| 基线不刷新、如实报告 | ✅ 未动 fixtures；§四 |
| 文件边界 | ✅ 仅 Game.ts + SafetyMap.ts（仅回退处）+ 新测试；无 git 写操作 |
