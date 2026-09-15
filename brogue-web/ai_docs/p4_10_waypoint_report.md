# P4-10 报告：waypoint 游荡导航

日期：2026-09-15
工作目录：`brogue-web/`；CE 事实来源：`../BrogueCE-master/src/brogue/`（只读）

---

## 〇、与任务书事实不符之处（授权反驳，只列不修）

1. **★ 任务书★节对 shuffleList 流影响的描述不准确，首轮实现因此打红了
   generation_baseline。** 任务书称"`shuffleList` 在所有生成决策都已做完
   （之后执行）……它只移动后续玩法期的随机序列"，并据此断言基线应当
   保持绿。CE 原文（RogueMain.c）显示 CE 做了**流隔离**：

   ```c
   // RogueMain.c:691-696（进层、生成前）
   do { oldSeed = rand_64bits(); } while (oldSeed == 0);
   seedRandomGenerator(levels[rogue.depthLevel - 1].levelSeed);
   // …… digDungeon / placeStairs / initializeLevel / setUpWaypoints /
   //    shuffleTerrainColors 全部跑在 levelSeed 这条专属流上 ……
   // RogueMain.c:733-735（生成完毕）
   seedRandomGenerator(oldSeed);   // 主流切回玩法状态
   ```

   每层的 `levelSeed` 在游戏初始化期从主流一次性抽取（RogueMain.c:259-269）。
   因此 `setUpWaypoints` 的 shuffleList 抽取**落在被丢弃的 levelSeed 流上，
   对后续层的生成流和玩法流都是零扰动**——"只移动玩法期序列"的说法两头
   都不成立。首轮实现把 shuffle 直接落在 web 的单条主流上，`generation_
   baseline.test.ts` 立即全红（D1 的 2290 次抽取把 D2-D26 的生成流全部移位：
   玩家出生点、怪物数、物种全漂移）。按任务书"修位置、不许刷基线"的指引，
   改为复刻 CE 的隔离语义：`WaypointMap.setUpWaypoints` 内对 rng 状态做
   快照/恢复（`isolateRngDuring`，见 §一），基线复绿。web 没有 levelSeed
   基础设施且 Random.ts 禁改，快照/恢复是达到同一可观察性质的最小手段；
   CE 的 oldSeed 抽取/重播种全程（那两步本身会移动主流）不在本轮复刻范围。

2. **任务书漏了 `initializeMonster` 的 40 次 `rand_range(0,1)`。** CE
   Monsters.c:127-129 在**怪物创建时**（生成期内！）初始化
   `targetWaypointIndex = -1` 和 `waypointAlreadyVisited[i] = rand_range(0,1)`
   （i 遍历 40 个）。任务书的 RNG 影响分析只覆盖了 setUpWaypoints 的
   shuffle，没有这一处。若在 web 的 Monster 构造器照搬，每只怪 +40 次
   主流抽取，generation_baseline 必红。web 改为**玩法期惰性初始化**
   （`WaypointSystem.ensureVisitedInitialized`：首次触碰 waypoint 系统时
   一次性消费同分布的 40 次种子掷骰）——分布语义等价（≈50% 已访问均衡），
   仅 RNG 流位置不同（登记取舍，§八-6）。

3. **任务书给的两处消费点行号与函数名对应关系需要勘误。**
   "Monsters.c:1200-1230 挑目标 waypoint"实际是三个函数：
   `isValidWanderDestination`（1206-1212）、`closestWaypointIndex`
   （1214-1227）、`chooseNewWanderDestination`（1230-1251）——已完整读取并
   逐条实现。"Monsters.c:1695-1705 另有一处按 waypoint 距离选点"是
   `closestWaypointIndexTo`（1694-1703）与其唯一调用方 `wanderToward`
   （1705-1711）——后者是 `lastSeenPlayerAt` 机制的一部分，按任务书
   "明确不做"未实现（§八-1）。

4. **`WAYPOINT_SIGHT_RADIUS` / `MAX_WAYPOINT_COUNT` 已查**：Rogue.h:1151-1152，
   分别为 **10 / 40**。

5. **Time.c:2710 所处时间块已确认**：在客观时间块内（`ticksTillUpdateEnvironment
   <= 0` 门的 "stuff that happens periodically according to an objective time
   measurement" 段），位于 updateEnvironment → decrementPlayerStatus →
   applyInstantTileEffects → monstersApproachStairs 之后、怪物推进循环之前
   ——是客观块的最后一步。web 挂在 `objectiveTimeBlock()` 尾部，同位。

6. **p2_3 play 段红了（任务书预设"会红"成立）**，构成 = 游荡行为改变 +
   游荡期新增的玩法流抽取（惰性 visited 40 次/怪、choose 每次 2 次、
   flitting 兜底），见 §七。未刷新，交验收方裁决。

7. 其余事实逐条核实无误：`setUpWaypoints` Architect.c:3033-3070 ✓、
   `refreshWaypoint` Architect.c:3014-3031 ✓、覆盖遮挡标志
   `T_OBSTRUCTS_SCENT` ✓、`dijkstraScan` 第三参 true ✓（专题见 §三）、
   游荡消费 Monsters.c:3602-3615 ✓、调用时机 RogueMain.c:707/771 与
   Items.c:5558（BE_TUNNELING）✓、全仓 `waypoint`/`wpDistance` 无匹配 ✓。

---

## 一、改动清单

| 文件 | 改动 |
|---|---|
| `src/engine/Map/WaypointMap.ts`（新增，428 行） | 常量（WAYPOINT_SIGHT_RADIUS=10 / MAX_WAYPOINT_COUNT=40 / WP_PDS_FORBIDDEN=-1 / WP_PDS_OBSTRUCTION=-2）；`WaypointSystem`：`setUpWaypoints`（含 `isolateRngDuring` 流隔离 + 贪心集合覆盖 + 全量刷新）、`refreshWaypoint`（populateGenericCostMap web 近似 + 沉睡/不可移动/囚禁怪格禁入 + fill 30000 + 种子 0 + `batchScan(,,true)`）、`rollingRefresh`（Time.c:2710-2714 滚动刷新）、`ensureVisitedInitialized`（惰性 visited）、`isValidWanderDestination` / `closestWaypointIndex` / `chooseNewWanderDestination` / `nextStep`（Monsters.c:1206-1251 + Movement.c:1767 的 preferDiagonals=false 路径）；结构化上下文 `WaypointContext`（同 SafetyMap 先例，避免 Game 循环依赖） |
| `src/entities/Monster.ts` | 新字段 `targetWaypointIndex`（CE Monsters.c:127）、`waypointAlreadyVisited`（CE 128-129，惰性）；WANDERING 移动分支整体替换：旧"20% 概率随机走"占位 → 朝目标 waypoint 距离图下坡 + 失效换点 + flitting 随机兜底（CE Monsters.c:3602-3619）；新增 `randFlittingDirection`（Movement.c:674 `randValidDirectionFrom` 的 web 近似） |
| `src/engine/Core/Game.ts` | `waypoints` 字段；`wpContext()`（宿主结构面：FOV 绑定 `obstructsScent` + 半径 10、活怪占格查询、玩家坐标）；`rebuildWaypoints()`（CE 三个调用时机的 web 接入点）；`generateDepth` 新层/重访两分支汇合处 + test 层分支各挂一次构建；`objectiveTimeBlock()` 尾部挂滚动刷新 |
| `src/test/p4_10_waypoint.test.ts`（新增，352 行） | 7 条测试（§五） |

**边界遵守情况**：`Pathfinding.ts` 既有行为零改动（只调用 P4-9 已有的
`batchScan`）；`DetailGenerator.ts`、`data/*.json`、`fixtures/*`、`Random.ts`、
`Gas.ts` 零触碰；**`Architect.ts` 最终未动**——接入点在 Game 层
（`generateDepth`），因为 `Architect.generateLevel` 只覆盖地形段，物品/怪物
决策在 `Game.populateLevel`，挂在 Architect 内反而放错位置。调试探针文件
已删除，`git status` 复核仅 4 个目标文件（+ 仓库原有的 `../output/`）。
未执行任何 git 写操作。

## 二、CE 行号对照

| CE | web |
|---|---|
| `WAYPOINT_SIGHT_RADIUS=10` / `MAX_WAYPOINT_COUNT=40` Rogue.h:1151-1152 | `WaypointMap.ts` 顶部常量 |
| `setUpWaypoints` Architect.c:3033-3070 | `WaypointSystem.setUpWaypoints`：scent 遮挡格预标（3035-3042，web `obstructsScent` 同 P4-8 口径）→ fillSequentialList+shuffleList（3043-3044）→ 贪心覆盖（3045-3056，`computeWaypointFOV` = `fov.computeFOVMask(x,y,10,obstructsScent)`）→ 全量 refresh（3059-3061） |
| `refreshWaypoint` Architect.c:3014-3031 | `WaypointSystem.refreshWaypoint`：`populateGenericCostMap`（Movement.c:2017-2036）web 近似 → 怪物叠加层（3019-3026，`cost >= 0` 守卫照抄）→ fill 30000 + 源点 0 → `batchScan(distance, cost, true)` |
| populateGenericCostMap 各分支 Movement.c:2017-2036 | `!isPassable && 非SECRET_DOOR` → WALL/GRANITE ? -2 : -1（对角阻挡 web 无标志集，沿 Pathfinding/SafetyMap 启发）；`T_PATHING_BLOCKER` 非通行部分（LAVA/CHASM(AUTO_DESCENT)/TRAP(DF_TRAP)/WATER_DEEP/isBurning(FIRE)，Rogue.h:1948）→ -1；其余 → 1。注意与 updateSafetyMap 不同：populateGenericCostMap 深水/岩浆/火一律禁入，没有 5 格档位 |
| 滚动刷新 Time.c:2710-2714 | `WaypointSystem.rollingRefresh`：ticker 先 ++ 再取模（首刷 1 号非 0 号）；挂在 `objectiveTimeBlock()` 尾部（CE 客观块最后一步，§〇-5） |
| `isValidWanderDestination` Monsters.c:1206-1212 | `WaypointSystem.isValidWanderDestination`：索引有效 + `!visited[wp]` + `wpDistance >= 0`（30000 亦过——CE 原文如此，靠 nextStep 兜底）+ 存在下坡步 |
| `closestWaypointIndex` Monsters.c:1214-1227 | `WaypointSystem.closestWaypointIndex`：初始上限 `DCOLS/2`——web DCOLS=79（CE=100）故为 39，"半张地图宽"的结构等价，登记 |
| `chooseNewWanderDestination` Monsters.c:1230-1251 | `WaypointSystem.chooseNewWanderDestination`：随机清 2 个 visited → 标记当前目标 → closest → 全灭清空重试。wpCount==0 时 CE 是 brogueAssert（关闭后 `rand_range(0,-1)` 为未定义行为），web 显式守卫 |
| 游荡消费 Monsters.c:3602-3615 | `Monster.ts` WANDERING 分支：isValid → nextStep → 失效/无下坡则 chooseNew → 再 nextStep → 仍无则 flitting → `tryMoveTo` |
| `nextStep(map, loc, monst, false)` Movement.c:1767-1810 | `WaypointSystem.nextStep`：preferDiagonals=false → dir 0..7 **升序**扫描、严格更陡才换向（并列取先、正交优先）——与 safety map 的 `(,,NULL,true)` 逆序扫描相反 |
| `randValidDirectionFrom(monst,x,y,true)` Movement.c:674-696 | `Monster.randFlittingDirection`：8 邻域合法方向均匀抽一个；count==0 先于掷骰返回（CE 防 OOS 注释同款） |
| `initializeMonster` Monsters.c:127-129 | `targetWaypointIndex` 构造器初值 -1；`waypointAlreadyVisited` 惰性 40 抽（§〇-2） |
| 调用时机 RogueMain.c:707 / 771 / Items.c:5558 | `generateDepth` 两分支汇合处 / 同处（缓存恢复后）/ `rebuildWaypoints()` 预留（§八-3） |

## 三、`dijkstraScan` 第三参 `true` 的含义确认

`Dijkstra.c:202`：

```c
void dijkstraScan(short **distanceMap, short **costMap, boolean useDiagonals)
```

第三参是 **`useDiagonals`**——传给 `pdsUpdate(map, useDiagonals)`
（Dijkstra.c:43 `short dirs = useDiagonals ? 8 : 4;`），控制松弛时的邻域数：
`true` = 8 向（含对角，带 `PDS_OBSTRUCTION` 对角豁口检查），`false` = 4 向。
`refreshWaypoint` 传 `true`（8 向），与 safety map 的两次 `false`（4 向）
不同——CE 原文如此，非笔误。web 的 `DijkstraMap.batchScan(distance, cost,
useDiagonals)` 直接沿用该参数，未改动 Pathfinding.ts 任何既有语义。

## 四、waypoint 构建在 web 生成流程中的落点 + 基线红绿

**落点**：`Game.generateDepth` 的两条路径**汇合处**——

- 新层：`Architect.generateLevel`（地形）→ `populateLevel`（楼梯/物品/怪物，
  全部生成决策）→ **`rebuildWaypoints()`** → 玩家 FOV 刷新。对应 CE
  RogueMain.c:707（`initializeLevel` 之后、`shuffleTerrainColors` 位置附近）。
- 重访缓存层：恢复 grid/monsters/items 后走到同一汇合点重建。对应 CE
  RogueMain.c:771。
- test 模式分支：`generateTestDepth` 之后同样挂一次（该层的全部生成决策
  完成之后），供 headless 测试使用。
- `setUpWaypoints` 内部做流隔离（§〇-1），对生成基线与玩法序列零扰动。

**基线红绿**：

| 基线 | 结果 |
|---|---|
| `generation_baseline.json`（地形指纹 + 怪物数 + 物种 + 物品数，4 seed × D1-D26） | **绿**（流隔离后与改动前逐位一致） |
| `p2_3_baseline.json` play 段（4 seed × 400 回合） | **红**（预期内，见 §七） |

首轮（shuffle 落主流）generation_baseline 确实红过：任务书"若变红说明插错
位置"的排查指引找到了真凶——不是插的位置错（汇合点就是 CE 的 707 位置），
而是任务书★节漏了 CE 的流隔离（§〇-1）。修正的是隔离，不是位置、不是基线。

## 五、对抗性测试与各自捕获的错误实现

文件：`src/test/p4_10_waypoint.test.ts`，7 条全绿。每条先写明要抓的实现错误：

| # | 断言 | 捕获的错误实现 |
|---|---|---|
| T1 | 覆盖性（真实关卡零改造，5 seed）：扫描结束后**不存在未覆盖格**（`uncovered===0`、`coveredTransparent===transparent`），wpCount ∈ [1,40] | 只撒点不做 FOV 覆盖标记、覆盖时漏 OR 掩码、扫描提前退出的实现——CE 贪心集合覆盖的不变量是"每个扫到的未覆盖格本身就会成为 waypoint"，破坏即留洞。实测（探针，已删）：seed 42/777/1234/20260915/314159 的 wpCount = 13/12/11/13/11，uncoveredTotal 全 0 |
| T2 | 增量刷新：`wait` 一回合 `refreshWaypoint` 恰好 +1；连续 wpCount 回合恰好遍历全部索引 | "每回合全算"（+wpCount）、"挂在主观块/从不刷新"（0 或 2）、ticker 顺序错误（遍历集不全） |
| T3 | 游荡怪走向 waypoint：热身选点后，同目标下每回合距离**恰好 -1**（cost=1 地形 + 严格下坡 nextStep 的解析推论），同目标段 ≥ 4 | 旧"20% 随机走"（原地不动 → 非 -1；随机方向 → +1/换向）、"调用了 waypoint 但没真走"、"每步走两格" |
| T4 | 到达后换点：把怪放在其目标 waypoint 上（0 距离无下坡步），一回合内目标必换、旧目标 visited 置位、新目标距离 > 0 且此后严格递减 | "到达后死锁原目标"、"换点但忘了标 visited"、"换点后仍指向脚下点" |
| T5 | 沉睡/不可移动/囚禁禁入：一格峡谷中的惰性怪挡住距离场（对岸 30000），解除后放行（<30000）。三条谓词各自独立验证（ASLEEP / MONST_IMMOBILE=goblin_totem / isCaged），测试态均设为"醒着"以隔离单一谓词 | 漏掉怪物叠加层、漏三条谓词之一、漏 `cost >= 0` 守卫（会把已禁入格错误改写） |
| T6 | 决定性：同种子 → 同一套 wpCoordinates + 同一游荡轨迹 + 同一刷新计数（=6） | 未播种随机源（Math.random）、shuffle 不确定、刷新次数漂移 |
| T7 | 对照组：HUNTING 怪追击照旧，且 waypoint 消费面（isValid/choose/nextStep 间谍计数）**零调用**、targetWaypointIndex 保持 -1 | 把 waypoint 步骤挂进所有状态、误伤追击路径 |

## 六、反向验证（真实失败输出，改坏 → 跑红 → 还原）

**RV1 滚动刷新改坏为"每回合全算"**（`rollingRefresh` 内循环全量刷新）：

```
× T2 增量刷新（Time.c:2710-2714）：每个玩家回合恰好重算一个 waypoint
AssertionError: expected 26 to be 1 // Object.is equality
× T6 决定性：同种子 → 同一套 waypoint 坐标 + 同一游荡轨迹 + 同一刷新计数
AssertionError: expected 156 to be 6 // Object.is equality
Tests  2 failed | 5 passed (7)
```

**RV2 删掉 refreshWaypoint 的沉睡/不可移动/囚禁叠加层**：

```
× T5 沉睡/不可移动/被囚禁怪格禁入（Architect.c:3019-3026）：一格峡谷挡住距离场，苏醒后放行
AssertionError: expected 15 to be 30000 // Object.is equality
Tests  1 failed | 6 passed (7)
```

**RV3 覆盖标记改坏为"只标记 waypoint 自身格"**（删 FOV OR 掩码）：

```
× T1 覆盖性（真实关卡，零改造）：扫描结束后不存在未覆盖格，且 wpCount 在 [1..40]
AssertionError: expected 238 to be +0 // Object.is equality
× T4 到达后换点（Monsters.c:3608-3615）：无下坡步 ⇒ 当前目标标记已访问并换点
AssertionError: expected 7 to be less than 0
Tests  2 failed | 5 passed (7)
```

**RV4 游荡分支回退为旧"20% 随机走"占位**：

```
× T3 游荡怪确实在走向 waypoint：同目标下每步距离恰好 -1（严格下坡的解析推论）
AssertionError: expected -1 to be greater than or equal to 0
× T4 到达后换点（Monsters.c:3608-3615）：无下坡步 ⇒ 当前目标标记已访问并换点
AssertionError: expected +0 not to be +0 // Object.is equality
Tests  2 failed | 5 passed (7)
```

四次改坏全部抓到真实失败；还原后 7/7 复绿。RV3 顺带证明 T4 的舞台依赖
waypoint 排布——已把选点改为"离玩家最远者"，不再对排布做矩形假设。

## 七、基线变红情况（逐条，未刷新任何 fixture）

**红了什么**：`src/test/p2_3_objective_time.test.ts` 的 **F 组 play 段**
（`4 seed × 400 回合玩法状态与 p2_3_baseline 一致`）——4 个 seed 全部分歧。
失败输出节选（完整输出见 §九门禁命令的可复现运行）：

```
+ "seed=424242 player got=28,19:30/30 want=48,22:30/30",
+ "seed=424242 monsters got 1 只 want 4 只",
+ "seed=777 player got=38,13:30/30 want=50,15:27/30",
+ "seed=777 monsters got 5 只 want 5 只",
+ "seed=20260913 monsters got 8 只 want 10 只",
+ "seed=31337 player got=27,18:30/30 want=49,15:28/30",
```

**其余全绿**：46 个测试文件中 45 个通过，包括 `generation_baseline`、
p2_0/p2_1/p2_2、P4-1~P4-9 全部既有测试（含 safety map 的 8 条、气味图的
全部断言）。

**红的归因**（两层，均预期内）：

1. **行为**：WANDERING 怪从"20% 随机走"改为朝 waypoint 巡逻——早到/
   晚到玩家视野、碰撞与战斗序列改变，400 回合后状态必然分叉；
2. **玩法流**：游荡期新增抽取——visited 惰性初始化 40 次/怪（CE 在生成期
   消耗，web 为护基线移到玩法期，§〇-2）、choose 每次 2 次（CE 同样在玩法期）、
   flitting 兜底（替换旧实现固定 1 次 randPercent+randRange）。

按任务书要求**未刷新** `p2_3_baseline.json`，交验收方裁决。

**门禁数字对照**：本轮 487 通过 / 1 红（仅 p2_3 play 段）/ 7 skip / 5 todo。
上一轮（P4-9 后）为 480 通过 / 0 红（= 本轮 487 减去本轮新增的 7 条；
P4-9 报告记载其轮内 p2_3 play 全绿）。**通过数 487 ≥ 480，不低于上一轮**；
唯一红项即上文逐条呈报的预期内基线，非静默掩盖。

## 八、未实现项清单与已知取舍

1. **`wanderToward(lastSeenPlayerAt)`（Monsters.c:1701-1711）未实现**——
   web 无 lastSeen 记账（P4-8 已登记），任务书"明确不做"。追踪态丢目标
   仍按 P4-8 口径退化为普通 WANDERING。
2. **盟友/追随者的 waypoint 区分未实现**——CE 里 `MB_FOLLOWER` 不走
   waypoint 而是 `monsterMillAbout`（Monsters.c:3592-3601，含频率 100/30/10
   三档）；web 无 millAbout，所有 WANDERING 怪（含 follower/ally）统一走
   waypoint。CE 盟友（MONSTER_ALLY）走 `moveAlly`，web 盟友走既有 ally
   分支、不进 WANDERING 移动路径（T7 同源口径）。
3. **地形剧变后重算未挂触发点**——web 无挖掘弹/洪水类地形剧变
   （BE_TUNNELING，Items.c:5558）；`Game.rebuildWaypoints()` 为预留接入点，
   有剧变系统时一处调用即可。
4. **CE 进层的 oldSeed 抽取 + 主流重播种全程未复刻**（RogueMain.c:691-696/
   733-735 的那两步本身会移动 web 主流、打红基线）——只复刻了"waypoint
   构建对主流零扰动"这一可观察性质（快照/恢复）。
5. **CE 游荡分支的前置子行为未实现**（Monsters.c:3547-3599）：逃险地形
   （mapToSafeTerrain）、囚徒领袖接近、邻敌攻击——web 无对应子系统，
   本轮范围仅 waypoint 导航层。
6. **取舍（行为等价、流位置不同）**：
   - visited 惰性初始化（§〇-2）；
   - `closestWaypointIndex` 上限 = web DCOLS/2 = 39（CE=50，"半张地图宽"
     的结构等价）；
   - nextStep 阻挡近似：液体限定怪只进浅/深水、活怪占格阻挡、玩家格阻挡
     ——比 CE 保守（CE 的 canPass/teammates/enemies 细分 web 无对应；
     web 的 tryMoveTo 不处理穿过/交换，不挡会叠怪）；`diagonalBlocked`
     web 无对应判定，省略（P4-5 以来同口径）；密门按"可通行"放行
     （knownToPlayerAsPassableOrSecretDoor 的 web 口径，同 P4-9）；
   - flitting 兜底排除玩家格与怪占格（CE 靠 moveMonster 的攻击/交换分支
     处理，web 无）；
   - `rollingRefresh` 加了 wpCount==0 守卫（CE 恒有 waypoint 无此分支；
     web 的 test 层可能为 0）。

## 九、门禁输出尾部

`npx vitest run --no-file-parallelism`（项目记忆：全量并行会因 5s 默认超时
抖动，验收同口径）：

```
 Test Files  1 failed | 45 passed (46)
      Tests  1 failed | 487 passed | 7 skipped | 5 todo (500)
   Start at  13:08:10
   Duration  47.50s (transform 383ms, setup 0ms, import 1.89s, tests 42.11s, environment 7ms)
```

唯一失败 = `p2_3_objective_time.test.ts > P2-3 F: p2_3_baseline 一致性 >
4 seed × 400 回合玩法状态与 p2_3_baseline 一致（本轮后的新基准）`（§七）。

`npm run build`：

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

dist/assets/CanvasRenderer-CX5tNzp9.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-1i6rsLwZ.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-VDhc1py6.js           41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-mhXLy8yO.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-CGBqV13j.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-cFr-0vfc.js               934.80 kB │ gzip: 294.85 kB
✓ built in 1.38s
```

（chunk 体积警告为既有状态，与本轮无关。）

## 十、git diff --stat / git status

```
 brogue-web/src/engine/Core/Game.ts | 51 ++++++++++++++++++++++++
 brogue-web/src/entities/Monster.ts | 82 +++++++++++++++++++++++++++++++++-----
 2 files changed, 122 insertions(+), 11 deletions(-)

 M  src/engine/Core/Game.ts
 M  src/entities/Monster.ts
??  src/engine/Map/WaypointMap.ts        （新增 428 行）
??  src/test/p4_10_waypoint.test.ts     （新增 352 行）
??  ../output/                          （仓库原有，非本轮产物）
```

fixtures/、data/*.json、Random.ts、Gas.ts、DetailGenerator.ts、
Pathfinding.ts 零触碰；未执行任何 git 写操作。
