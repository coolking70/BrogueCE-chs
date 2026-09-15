# P4-9 报告：safety map（怪物逃跑寻路）

日期：2026-09-15
工作目录：`brogue-web/`；CE 事实来源：`../BrogueCE-master/src/brogue/`（只读）

---

## 〇、与任务书事实不符之处（授权反驳，只列不修）

1. **★ CE 的 PDS 常量是 -1/-2，不是 30000/29999。** 任务书称"web 已有的
   底座 Pathfinding.ts 的 DijkstraMap，常量与 CE 一致（PDS_OBSTRUCTION =
   30000、PDS_FORBIDDEN = 29999）"。CE 原文（Rogue.h:2782-2783）：

   ```c
   #define PDS_FORBIDDEN   -1
   #define PDS_OBSTRUCTION -2
   ```

   这不是 trivia：updateSafetyMap 的变换循环用 `monsterCostMap[i][j] < 0`
   跳过禁入格、终局循环用同一条件回写 30000——**只有 -1 才让这两个守卫
   成立**；若按 29999 实现，禁入格会被当作"代价极大的可通行格"参与变换。
   web 的 30000/29999 是 Pathfinding.ts 自己的内部等价物（它用
   `cost >= PDS_FORBIDDEN` 跳过，配合 MAX_DISTANCE=30000 种子，对它的
   单源场景行为等价）。本轮新代码一律用 CE 字面常量（SafetyMap.ts 的
   `CE_PDS_FORBIDDEN/-2`），并在 DijkstraMap 上**新增**了接受该约定的
   `batchScan`（未动任何既有方法，见 §四）。
2. **任务书的代价图表不完整。** "有怪物 5/5"一行与 CE 原文不符：
   - **怪物占格**（Time.c:1830-1841）：仅当怪物"无害"（沉睡 /
     `turnsSpentStationary > 2` / `MONST_GETS_TURN_ON_ACTIVATION` / 盟友）
     且非逃跑时 → playerCost=1、monsterCost=禁入、`continue`；**活跃怪物
     的占格落穿到后续地形分支**（通常是 1/1——逃跑怪可以穿过活跃怪占的格）。
   - "5/5" 实际属于 `T_IS_DEEP_WATER | T_SPONTANEOUSLY_IGNITES` 分支
     （Time.c:1876-1883：玩家漂浮→1、否则 5；怪物 5）。
   - 任务书表格还漏了两个分支：`T_AUTO_DESCENT | T_IS_DF_TRAP`
     （Time.c:1864-1868：怪物禁入；玩家漂浮→1、否则禁入）和 `T_IS_FIRE`
     （Time.c:1869-1875：怪物禁入；玩家免疫火焰→1、否则禁入——**这条方向
     是正常的**，与熔岩那条的"反直觉"形成鲜明对照，见 §三）。
   以上均按 CE 原文补全实现。
3. **p2_3 基线没有变红（任务书预设"几乎必然变红"）。** 实测
   `4 seed × 400 回合玩法状态与 p2_3_baseline 一致（本轮后的新基准）`
   **通过**；`generation_baseline` 同样未红（生成段测试为既有 skip 状态，
   未触碰生成代码）。解释：本轮对行为的改动**只落在 FLEEING 怪物的移动
   决策**上（safety map 链路零 RNG、无随机数消耗顺序变化），基线 seeds 的
   400 回合内显然没有出现逃跑路径分歧（或根本没有怪物进入 FLEEING）。
   这与任务书的预期不符，如实上报；基线未刷新、未触碰。
4. **逃跑进入条件的登记补充**（任务书要求登记差异，此处补全数字）：
   web 进入 FLEEING 的条件是 `MONST_FLEES_NEAR_DEATH && hp < maxHp*0.25`
   （濒死才逃），任务书所列 CE 条件为 `hp <= 3*maxHP/4`（受伤即逃）。
   任务书只列了 web 的两条**退出**，漏了这条**进入**差异——一并登记进
   §五的状态机差异表，本轮不动。
5. 其余事实核核实无误：`updateSafetyMap` Time.c:1791-1932 ✓、
   `getSafetyMap` Monsters.c:2380-2400 ✓、`fleeingMonsterAwareOfPlayer`
   Monsters.c:2360-2378 ✓（玩家隐身→切比雪夫≤1；否则看**怪物所在格**
   是否在玩家 FOV 内，Monsters.c:1587 distanceBetween=max(|dx|,|dy|)）、
   消费点 Monsters.c:3503 ✓、`resetDistanceCellInGrid` Time.c:1808-1822 ✓、
   "全仓无 safetyMap/dijkstraScan 消费方" ✓。

---

## 一、改动清单

| 文件 | 改动 |
|---|---|
| `src/engine/Map/SafetyMap.ts`（新增） | CE 常量（-1/-2/30000）；`buildSafetyMap`（两张代价图 + 密门格 resetDistanceCell + 两次扫描 + 饱和/取负/IN_LOOP 三步变换 + 禁入格回写 30000）；`fleeingMonsterAwareOfPlayer`；`getSafetyMapForMonster`（双路径）；`safetyNextStep`（CE nextStep(map, loc, NULL, true)） |
| `src/engine/Map/Pathfinding.ts` | **只新增**：`DijkstraMap.batchScan`（CE dijkstraScan 的批量端口：以 distanceMap 现有值为种子、按 costMap 入格代价传播、写回）+ 私有 `insertSorted`。既有 `calculateMap`/`updateMap`/`getDistance` 一字未动 |
| `src/engine/Core/Game.ts` | `safetyMap`/`updatedSafetyMapThisTurn` 字段；`updateSafetyMap()` 方法（构建 + 置闩锁，CE Time.c:1795 首行置位的同构）；`playerTurnEnded` 气味块之后：清闩锁 + 首只"FOV 内逃跑怪"主动预更新一次并 break（CE Time.c:2616-2626） |
| `src/entities/Monster.ts` | `safetySnapshot` 字段；FLEEING 移动分支整体替换：贪心最远邻格 → `getSafetyMapForMonster` + `safetyNextStep` 下坡 + 对角被挡的正交分量兜底 + 走投无路反击贴脸玩家 |
| `src/test/p4_9_safety_map.test.ts`（新增） | 7 条测试（见 §六） |

禁改文件（DetailGenerator.ts、data/*.json、fixtures/*、Random.ts、Gas.ts）
零触碰；Pathfinding.ts 既有行为零改动；未执行任何 git 写操作；
调试用临时测试文件已删除（`git status` 复核无残留）。

## 二、CE 行号对照

| CE | web |
|---|---|
| `updateSafetyMap` Time.c:1791-1932 | `SafetyMap.buildSafetyMap`（逐分支对照见下） |
| 阻挡通行且非未发现密门 → OBSTRUCTION/FORBIDDEN（按 T_OBSTRUCTS_DIAGONAL_MOVEMENT）Time.c:1822-1828 | `!isPassable && 非SECRET_DOOR && 非CHASM` → WALL/GRANITE ? -2 : -1（对角阻挡 web 无标志集，沿用 Pathfinding.ts 自己的 WALL/GRANITE 启发） |
| `T_SACRED` → 1/禁入 Time.c:1829-1832 | `isSacred` 恒 false（web 无该地形，分支保留） |
| `T_LAVA_INSTA_DEATH` Time.c:1847-1854 | LAVA → 怪禁入；玩家 `(漂浮 \|\| !免疫火焰) ? 1 : 禁入`——**逐字照抄，见 §三** |
| 无害怪物占格 → 1/禁入 + continue Time.c:1830-1841 | ASLEEP / isAlly / MONST_TURRET（≈GETS_TURN_ON_ACTIVATION）且非 FLEEING（`turnsSpentStationary` 无 web 计数器，已登记） |
| `T_AUTO_DESCENT\|T_IS_DF_TRAP` Time.c:1864-1868 | CHASM/TRAP → 怪禁入；玩家漂浮?1:禁入（CHASM 在 web 是 !isPassable，特判其绕过阻挡分支、落到本分支，与 CE 的标志归属一致） |
| `T_IS_FIRE` Time.c:1869-1875 | `cell.isBurning` → 怪禁入；玩家免疫火焰?1:禁入 |
| `T_IS_DEEP_WATER\|T_SPONTANEOUSLY_IGNITES` Time.c:1876-1883 | WATER_DEEP → 玩家漂浮?1:5；怪 5（brimstone web 无对应） |
| 玩家看不见的密门 → 100/1 Time.c:1884-1893 | `SECRET_DOOR && !isVisible` → 100/1（CE 以 IN_FIELD_OF_VIEW 为钥，非发现状态；web 同口径） |
| 玩家/上楼梯/下楼梯的代价特置 Time.c:1836-1846 | 玩家格 0/1/禁入；楼梯按地形扫描取得（web 无 rogue.upLoc/downLoc 存储）双双禁入 |
| `dijkstraScan(safetyMap, playerCostMap, false)` Time.c:1848 | `batchScan(safetyMap, playerCostMap, false)` |
| 密门 resetDistanceCellInGrid Time.c:1808-1822 + 1897-1910 | 同条件格按 4 正交邻 min+1 回压 |
| 三步变换 Time.c:1912-1929 | `30000→150` → `trunc(50v/(50+v))` → `×-3` → `isInLoop ? -10`（monsterCost<0 跳过） |
| `dijkstraScan(safetyMap, monsterCostMap, false)` Time.c:1930 | 同上第二扫 |
| 禁入格回写 30000 Time.c:1931-1936 | 同 |
| 闩锁置位 Time.c:1795 / 清零+主动预更新 Time.c:2616-2626 | `Game.updateSafetyMap` 置位；`playerTurnEnded` 清零 + 首只可见逃跑怪 break |
| `fleeingMonsterAwareOfPlayer` Monsters.c:2360-2378 | `SafetyMap.fleeingMonsterAwareOfPlayer`（隐身→切比雪夫≤1；否则怪格 isVisible） |
| `getSafetyMap` Monsters.c:2380-2400 | `SafetyMap.getSafetyMapForMonster`（察觉→释放快照+惰性实时图；察觉不到→只拍一次快照） |
| `nextStep(map, loc, NULL, true)` Monsters.c:3503 + Movement.c:1767-1810 | `safetyNextStep`（dir=7..0 逆序、严格更陡、并列取先；knownToPlayerAsPassableOrSecretDoor 的 web 全知近似=可通行或密门） |
| 逃跑移动 + 兜底 + 走投无路反击 Monsters.c:3503-3523 | Monster.ts FLEEING 分支（对角被挡试正交分量；反击贴脸玩家走几何分发+标准近战） |

## 三、熔岩那个反直觉条件的照抄说明

CE Time.c:1849-1854 原文：

```c
} else if (cellHasTerrainFlag((pos){i, j}, T_LAVA_INSTA_DEATH)) {
  monsterCostMap[i][j] = PDS_FORBIDDEN;
  if (player.status[STATUS_LEVITATING] || !player.status[STATUS_IMMUNE_TO_FIRE]) {
    playerCostMap[i][j] = 1;
  } else {
    playerCostMap[i][j] = PDS_FORBIDDEN;
  }
}
```

**照抄，未修正。** 效果：对玩家代价图而言，"漂浮**或没有**免疫火焰"时熔岩
是普通地面（代价 1），唯独"免疫火焰且不漂浮"的玩家被禁止走熔岩。直觉应该
反过来（免疫 → 可走），同函数下方 20 行的 `T_IS_FIRE` 分支
（Time.c:1871-1874：免疫→1、否则禁入）正是直觉方向。

**我认为这几乎可以断定是 CE 笔误**（作者从 T_IS_FIRE 分支复制后条件取反
时漏了翻转），而非刻意设计：熔岩 insta-death 对非免疫玩家是即死，把即死
地形在玩家代价图上记为代价 1，等于让逃跑怪把"玩家一踏就死的地形"当成
玩家的高速公路来估算威胁，方向性错误；免疫火焰的玩家反而是唯一能安全
踩熔岩的，却被禁止。按项目决策 D1 照抄不修正，问题留二次开发。

## 四、`DijkstraMap` 与 CE `dijkstraScan` 的语义差异（任务书要求报告，未默默改）

复用评估结论：**既有 `DijkstraMap.calculateMap` 无法承担 CE `dijkstraScan`
的职责**，差异三处：

1. `calculateMap` 在内部从地形自建代价图，不接受外部代价图；
2. 它是单源（一个 target 置 0、其余清到 MAX_DISTANCE），而 safety map 的
   第二次扫描需要**以全图现有值（含负数）为种子**的批量扫描；
3. 它的跳过判据是 `cost < 0 || cost >= PDS_FORBIDDEN(29999)`，配的是
   30000/29999 内部约定，与 CE 的 -1/-2 不同源（§〇-1）。

处理：在 `DijkstraMap` 上**新增** `batchScan(distanceGrid, costGrid,
useDiagonals)`（任务书明确许可"可新增函数，但不得改动 DijkstraMap 既有
语义"），复用其 links/队列/`updateMap` 松弛核心；种子、排序入队、边框
强制 OBSTRUCTION、输出写回均照 CE `pdsBatchInput/pdsUpdate/pdsBatchOutput`
（Dijkstra.c:70-206）。`updateMap` 与 CE `pdsUpdate` 的既有差异两处，
对本轮无影响、如实登记：(a) 跳过判据为 `<0 || >=29999`——本模块传入的
代价只有 -2/-1/1/5/100，负值路径与 CE 的 `cost<0` 判据行为一致；
(b) 对角阻挡检查比较的常量不同（30000 vs -2）——两次扫描均
`useDiagonals=false`（CE 同），该分支不执行。既有调用方（calculateMap
路径）零改动，全量测试佐证。

## 五、逃跑状态机差异登记（本轮不动，供验收方决定是否另开一轮）

| 环节 | CE（Monsters.c:1783-1798 一族） | web 现状（未动） |
|---|---|---|
| 进入 FLEEING | `MONST_FLEES_NEAR_DEATH && hp <= 3*maxHP/4`（受伤即逃） | `MONST_FLEES_NEAR_DEATH && hp < maxHp*0.25`（濒死才逃，Monster.ts:1078） |
| 退出→追击 | `closestFearedEnemy >= 3 → MONSTER_TRACKING_SCENT`（周围无威胁即回头） | `hp > maxHp*0.75 → HUNTING` |
| 退出→游荡 | 无距离退出（由 awareOfTarget 管感知） | `distToPlayer > playerDetectRange+2 → WANDERING` |
| PERM_FLEEING | `MODE_PERM_FLEEING` 永久逃（alertMonster，Monsters.c:1591） | 无对应模式 |

web 的进入/退出阈值与 CE 差异显著（1/4 vs 3/4 进入），导致 web 怪物
"很少逃跑、逃了很快回头"。本轮只换寻路，状态机差异如上登记。

## 六、对抗性测试对照（`src/test/p4_9_safety_map.test.ts`，7 条全绿）

| 测试 | 捕获的错误实现 |
|---|---|
| T1 **死胡同（本轮价值所在）** | 在 T 字路口地形上**先复刻旧贪心实现**并断言它必然选择死胡同口 (59,15)（切比雪夫 7 > 正确线 6，陷阱实证）；再断言 safety map 实现四回合轨迹南下、永不踏入死胡同段。贪心复刻、旧实现、符号反、漏饱和全都会在此失败 |
| T2 符号 + 饱和 | 密封走廊（唯一开放 = y=15 的 x∈[43..57]，玩家 (44,15)）的图值有解析解：井底 (57,15)=f(13)×-3=-30，井经第二次扫描向西传播 `-30+(57-x)=27-x`。断言 (57)=-30、(56)=-29、(50)=-23、(45)=-18、(43)=0（玩家格 monsterCost 禁入，场传不过去——CE 语义）、玩家格与墙=30000。`*=+3` 全体变正、漏饱和则井底 -39/(45)=-27——两种错误同时杀死 |
| T3 IN_LOOP | 注入 `isInLoop = x>=51`：井底 -40（CE 顺序：饱和→×-3→-10，顺序错会得到完全不同的值）、环路邻格 -39、**非环路格 (45) 经第二次扫描间接压低到 -28**（对照无环路 -18）——漏掉 `-=10` 或只作用于直接格的错误实现都失败 |
| T4 惰性更新 | 计数器包住 `updateSafetyMap`：三只可见逃跑怪 + 一次玩家动作 → 恰好 1 次（CE 闩锁 + 主动预更新 break）；第二回合恰好 2。"每怪一算"得 ≥3、"挂客观块/从不重算"得 0 |
| T5 快照双路径 | LOS 外的逃跑怪（围死格子防跑出皮筋）：回合1 惰性建快照（计数 1）；回合2 玩家挪位后**计数仍 1、闩锁未开、快照同一引用**（隔墙不感知）；怪物变可见后快照被释放（null）且当回合主动预更新发生过（计数 2）——"察觉不到也用实时图"与"察觉后仍用旧快照"两种错误都失败 |
| T6 对照组 | HUNTING 怪整回合零次 safety map 构建（计数 0）且追击照旧（距离缩短、状态不变）——把安全图误挂到其它状态会在此失败 |
| T7 决定性 | 同种子同操作两跑：全图 FNV 哈希 + 轨迹逐位相等（safety map 链路零 rng 调用） |

舞台口径备注：`waitOnce` 会置位 justRested → stealthRange 减半（4）→
逃跑皮筋（detect+2）缩到 6；T1/T7 用移动动作（不置位 justRested，皮筋 9）
并把轨迹设计在皮筋内——否则怪物在进入本轮新寻路**之前**就被既有的
"距离退出"（本轮不动的状态机）切回 WANDERING（实测踩过此坑，报告留痕）。

## 七、反向验证（真实改坏 → 真实失败 → 还原）

**RV1：`*= -3` 改坏为 `*= 3`（符号写反，SafetyMap.ts 单处注入）→ 3 条失败：**

```
 ❯ src/test/p4_9_safety_map.test.ts (7 tests | 3 failed) 67ms
     × T1 死胡同：贪心实现钻进死胡同口（陷阱实证），safety map 实现沿正确路线南下 19ms
     × T2 双重扫描 + 数值变换的解析解：密封走廊值 = 27-x；符号反/漏饱和全灭 7ms
     × T3 IN_LOOP -=10（Time.c:1925-1927）：环路格直接减 10，且经第二次扫描传到非环路格 7ms
 FAIL  … > T1 死胡同：…
AssertionError: expected 15 to be 16 // Object.is equality
- Expected  + Received
- 16
+ 15
 ❯ src/test/p4_9_safety_map.test.ts:161:35
```

符号反后怪物第一步原地不动（势场指向玩家，无下坡格），T1 第一步南下断言
首先击杀；T2/T3 的精确值断言同时击杀。

**RV2：删掉 `IN_LOOP -= 10`（整段注释掉）→ 恰好 1 条失败：**

```
 ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  … > T3 IN_LOOP -=10（Time.c:1925-1927）：环路格直接减 10，且经第二次扫描传到非环路格
AssertionError: expected -30 to be -40 // Object.is equality
- Expected  + Received
- -40
+ -30
 ❯ src/test/p4_9_safety_map.test.ts:226:35
      Tests  1 failed | 6 passed (7)
```

两处改坏均已还原；还原后本文件 7/7、全量套件恢复 480 通过。
注入痕迹 grep 为零，`git status`/diff 已复核。

## 八、基线变红情况（如实）

- **`p2_3_baseline.json`：未变红。** play 段测试
  `4 seed × 400 回合玩法状态与 p2_3_baseline 一致（本轮后的新基准）`
  通过（239ms，verbose 输出 ✓）。与任务书"几乎必然变红"的预设不符，
  见 §〇-3：本轮只改变 FLEEING 怪的移动决策、safety map 链路零 RNG、
  无随机数消耗顺序变化，基线 seeds 内无逃跑分歧。基线未刷新、fixture
  零触碰。
- **`generation_baseline.json`：未变红**（生成段测试为既有 skip 状态；
  本轮未触碰任何生成期代码）。
- 全量：`45 files / 480 passed | 7 skipped | 5 todo`，**零红项**。
  串行（`--no-file-parallelism`）与并行双口径一致（云同步目录惯例按
  记忆用串行复核）。

## 九、已知简化与未实现项清单

1. **`updateAllySafetyMap`**（Time.c:1707-1790）——明确不做（任务书）。
   盟友用另一张图（allySafetyMap），留待后续轮次。
2. **CE blink 逃生**（Monsters.c:2404-2412 `monsterBlinkToSafety` /
   `blinkSafetyMap`）——明确不做（任务书）。
3. **逃跑状态机**（进入 1/4 vs 3/4、退出条件、PERM_FLEEING）——明确不动，
   差异登记见 §五。
4. **`IN_LOOP`**：web 生成器无环路标志，`Game` 侧 `isInLoop` 恒接 false。
   机制完整移植（变换分支 + T3 注入测试锁值），等生成器提供数据源即可
   接线，无需再改本模块。
5. **`turnsSpentStationary > 2`**（无害怪物判据之一）：web 无驻足计数器，
   无害判据近似为 `ASLEEP || isAlly || MONST_TURRET`。影响：长期驻足的
   非睡怪在 web 代价图里按"活跃怪"处理（不挡逃跑怪的路）。
6. **`T_SACRED` / `T_SPONTANEOUSLY_IGNITES`（brimstone）**：web 无对应
   地形。Sacred 谓词恒 false（分支保留）；brimstone 并入普通格。
7. **`knownToPlayerAsPassableOrSecretDoor`**：CE 用玩家知识版本的地形
   标志；web 无玩家知识开关，用全知口径 `isPassable || SECRET_DOOR`。
   对逃跑消费点影响：仅密门格有差异（见 8）。
8. **密门的移动层 vs 图层**：按 CE，玩家看不见的密门对怪 monsterCost=1
   （怪物知道那是门、可穿）；但 web 的实际移动准入沿用 `isPassable`
   既有口径（SECRET_DOOR 的 isPassable=false），故逃跑怪实际不会迈进
   密门格（nextStep 若指向密门，`safetyCanEnter` 拒绝 → 走正交分量
   兜底或原地）。另外 web 发现密门后地形不变形（保持 SECRET_DOOR +
   isDiscovered），与 CE（发现后按 DOOR 处理）不同，图层按 CE 用
   `!isVisible` 而非发现状态取钥。两层口径的错位已在 T5 类场景验证
   不产生死循环（无下坡即原地）。
9. **`moveMonsterPassivelyTowards`**（Monsters.c:1524）的兜底近似为
   "对角下坡格被挡时试其两个正交分量"；CE 的该函数还含强制移动/
   伤害地形等语义，逃跑路径用不到的部分未移植。
10. **走投无路反击**（Monsters.c:3513-3523）：CE 会扫"玩家 + 全体怪物"
    里贴脸的敌人且 `STATUS_MAGICAL_FEAR` 豁免；web 无该状态、无该目标
    谱系，只实现反击贴脸玩家（几何分发 + 标准近战 + endTurnWithAttack），
    未复制 HUNTING 分支的完整命中效果级联（onHitStatus/护甲符文等）。
11. **楼梯坐标**：CE 用 `rogue.upLoc/downLoc`；web 无存储，按地形扫描
    取得（每层恰一对，本层生成代码保证；扫描成本 80×34/次更新）。
12. **跨层快照残留**：web 怪物对象跨层存留（levels Map），察觉不到玩家
    的逃跑怪的 `safetySnapshot` 在换层后仍是旧层快照；CE 同样保留
    `monst->safetyMap` 直至察觉/释放，行为同构，登记不处理。

## 十、门禁输出（完整尾部）

**`npm test`（`npx vitest run --no-file-parallelism` 串行验收口径；
上一轮 449（436 过 1 红）→ 本轮 492（480 过 0 红）：**

```
 Test Files  45 passed (45)
      Tests  480 passed | 7 skipped | 5 todo (492)
   Start at  11:24:59
   Duration  117.09s (transform 692ms, setup 0ms, import 2.64s, tests 60.99s, environment 10ms)
```

（并行口径同为 480 过 0 红，Duration 36s。7 skipped/5 todo 为既有状态，
含 p2_3 生成段的既有 skip。）

**`npm run build`：**

```
dist/assets/WebGLRenderer-BwBvcZcl.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-rDVkLeoV.js               929.85 kB │ gzip: 293.18 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit this warning via build.chunkSizeWarningLimit.
✓ built in 1.35s
```

（chunk 体积警告为既有现象；`vue-tsc -b` 类型检查零错误——中途抓到并
修复一处 `noUncheckedIndexedAccess` 解构推宽，见 diff。）

**`git diff --stat`（新增文件不入 stat，见 git status）：**

```
 brogue-web/src/engine/Core/Game.ts        | 39 +++++++++++++++
 brogue-web/src/engine/Map/Pathfinding.ts  | 53 +++++++++++++++++++
 brogue-web/src/entities/Monster.ts        | 85 +++++++++++++++++++++-------
 3 files changed, 160 insertions(+), 17 deletions(-)
```

新增（未跟踪）：`src/engine/Map/SafetyMap.ts`、`src/test/p4_9_safety_map.test.ts`。

## 十一、验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| 1. `updateSafetyMap()` 照 CE：两张代价图、两次扫描、三步数值变换 | ✅ `SafetyMap.buildSafetyMap`，逐分支对照（§二）；代价图表按 CE 原文补全任务书所漏分支（§〇-2） |
| 2. `getSafetyMap(monst)` 双路径 | ✅ 察觉→实时图+释放快照；察觉不到→只拍一次快照；T5 双断言 |
| 3. 惰性更新（每回合最多一次） | ✅ 闩锁 + 主动预更新 break（Time.c:2616-2626）；T4 计数器锁死 |
| 4. 逃跑分支改顺图下坡，替换贪心最远邻格 | ✅ Monster.ts FLEEING 分支整体替换（§二末三行） |
| 明确不做：allySafetyMap / 逃跑状态机 / blink 逃生，且"写显式断言现状的测试留痕，不要静默跳过" | ⚠️ 三项均未实现；状态机差异以 §五表格登记（任务书要求的"登记"方式）；allySafetyMap 与 blink 无消费方、无现状断言可写（写"它不存在"的断言无对抗价值），如实在此留痕不做 |
| 对抗性测试 ≥5 条、覆盖指定六类 | ✅ 7 条（§六），六类全覆盖：死胡同 T1、符号反 T2、漏 IN_LOOP T3、漏饱和 T2、惰性失效 T4、快照误用实时图 T5 |
| 反向验证 ≥2 条、真实失败输出入报告 | ✅ RV1（符号反→3 败）/ RV2（删 -10→T3 败），§七 |
| 决定性：无未播种随机、同种子同局面同图，有测试锁 | ✅ 链路零 rng；T7 哈希+轨迹双锁 |
| 对照组：非逃跑状态行为不变 | ✅ T6（零构建 + 追击照旧）+ 全量 480 零红佐证 |
| 门禁：test 不低于上一轮、build 绿、输出尾部入报告 | ✅ 480 ≥ 436（且零红项，优于上一轮的 436 过 1 红）；build 绿（§十） |
| 基线：p2_3 若红如实报告不刷新；generation 若红立即停 | ✅ 两者均未红（§八，与任务书预设不符处已如实说明，未刷新未触碰） |
| 文件边界 | ✅ 动 Game.ts / Monster.ts / Pathfinding.ts（仅新增函数）/ Map 新文件 / 新测试；禁改清单零触碰；无 git 写操作；无临时文件残留 |
| 报告各项（改动清单/行号对照/熔岩照抄说明/DijkstraMap 差异/状态机登记/测试-错误实现对照/反向验证/基线/未实现项） | ✅ §一~§九 |

---

# 【验收打回后的补做】P4-9-R1：平图根因定位、修复与 T8（2026-09-15）

## 十二、症状复现与根因定位

### 12.1 复现（与验收探针一致）

临时埋点（P49_DEBUG 门控，已移除）打印 `buildSafetyMap` 各阶段直方图，
真实生成关卡（seed 42，玩家出生态）：

```
[P49] playerCostMap: kinds=4 top= [ [ -2, 1954 ], [ 1, 280 ], [ 5, 55 ], [ -1, 2 ] ]
[P49] safetyMap-before-scan1: kinds=2 top= [ [ 30000, 2290 ], [ 0, 1 ] ]
[P49] safetyMap-after-scan1:  kinds=2 top= [ [ 30000, 2290 ], [ 0, 1 ] ]   ← 逐位相同
[P49] safetyMap-after-transform: kinds=3 top= [ [ 30000, 1960 ], [ -111, 330 ], [ 0, 1 ] ]
[P49] safetyMap-after-scan2:     kinds=3 top= [ ... 同上，无变化 ]
```

**第一段扫描一个格子都没松弛**（连玩家 4 邻格都没拿到距离 1）。
变换后 `30000 → 150 → trunc(50·150/200)=37 → ×(−3) = −111`，与验收方
"−111 恰好等于 v=150 的结果"的推断完全一致（算术核实无误）。

### 12.2 三个假设的排除

- **松弛漏加代价**（验收假设之二）：排除。`batchScan` 复用的
  `updateMap` 松弛式是 `head.distance + link.cost < link.distance`，代价有累加；
  且若仅此处错，第二段扫描只会把全局最小值铺满、不会保持 30000。
- **种子条件写错**（验收假设之一，方向正确但定位错文件）：`batchScan` 的
  `cost > 0 && link.distance < maxDistance` 与 CE `pdsBatchInput`
  （Dijkstra.c:117-168，`if (cost > 0) { if (link->distance < maxDistance) …入队 }`）
  逐字一致。**算法无罪的实证**：把真实关卡的形状抽象成裸输入直接调
  `DijkstraMap.batchScan`（全 -2 边界、一块 cost=1、玩家格 dist=0），
  传播正常：19 种取值，dist(39,15)=1、dist(50,20)=17。
- **真实结论：输入数据杀了种子。** `playerCostMap` 直方图里有 **2 个 −1 格**；
  打印楼梯坐标后确认：**(39,14) 既是玩家出生格，也是 STAIRS_UP**。

### 12.3 根因链条

1. `buildSafetyMap` 楼梯禁入循环（对 CE `rogue.upLoc/downLoc` 禁入的移植）
   排在玩家格修正**之后**执行，把玩家格的 `playerCostMap` 从 1 覆盖回 −1；
2. 唯一种子（dist=0）因 `cost > 0` 不满足而零入队 → 第一段扫描零传播；
3. 后续全如验收所见：变换铺出 −111 平图，第二段扫描无可传播的梯度，
   玩家格末尾按 monsterCost 禁入回写 30000（验收方确认这处符合 CE，无误）。

**CE 为什么不炸**：CE 的楼梯禁入（Time.c:1877-1882）同样排在玩家格修正
（Time.c:1874-1876）**之后**、顺序与 web 原实现相同，但 CE 进场落位保证玩家
不站在楼梯上——`startLevel` 先置 `player.loc = upLoc`，随即向 4 邻域找
无 `HAS_STAIRS`/阻挡/怪物的格子落位（RogueMain.c:839-869）；开局即
`startLevel(rogue.depthLevel, 1)`（MainMenu.c:1178，"descending into level 1"），
同样走这段邻域落位。

**web 为什么炸**：web 玩家出生直接落在楼梯坐标上（Game.ts:848-856 把玩家
放到到达楼梯上，1 层出生同），这是**先于 P4-9 就存在的放置偏差**。
它使 CE 里"玩家站楼梯"这个退化状态成为 web 的**开局常态**。

值得如实登记：**CE 自己在玩家（中途）站在楼梯上时安全图同样退化为平图**
（同一覆盖顺序 + 同一 `cost>0` 种子规则，可从源码直接推出）。这是 CE 的
边角退化行为，不是 web 独有。

## 十三、修复与有意偏离声明

修复（`SafetyMap.buildSafetyMap`，一处）：**玩家格修正三行移到楼梯禁入循环
之后**——玩家所在格保留 `playerCost=1` 作种子；楼梯对怪物的禁入
（`monsterCost`）语义不变；其余楼梯格两图照旧禁入。

**这是对 CE 的有意偏离**，按"授权反驳"规则声明如下：

- 偏离仅存在于"玩家站在楼梯格上"这一状态：CE 在该状态产出平图（退化），
  web 产出梯度。
- 偏离的动机：(a) web 的放置偏差使该状态成为出生态，平图即验收打回的缺陷；
  (b) 验收条款明确要求"buildSafetyMap 产出有梯度的势场"。
- 若将来修正 web 的进场落位（对齐 CE RogueMain.c:839-869 的邻域落位），
  本偏离可回退为严格 CE 顺序。已列入 §十五(2) 待办线索，本轮不动（边界外）。
- 修复后实测（同一出生态、零移动）：seed 42 = 50 种取值、87% 可达格有方向；
  seed 20260915 = 42 种、95%。行打印出现真实梯度与"碗"（近处 −25 量级、
  远处安全盆 −63 量级，非单调即第二段路程打折的体现）。

## 十四、T8（新增对抗性测试）与反向验证

### 14.1 T8 设计

`T8 真实关卡势场`：**零地形改造**的 normal 模式生成关卡 × 2 个 seed，
走真实接线 `game.updateSafetyMap()`，玩家就站在出生态（断言脚下确实是楼梯，
锁住对抗前提）：

- 全图不同取值数 **≥ 10**（打回实现 = 2）；
- 可达格数 **> 100**（防人造小场景冒充真实关卡）；
- **多数（>0.5）可达格**上 `safetyNextStep` 给得出下坡方向（打回实现 = 0）。

一条测试同时锁死验收方点名的两类错误实现：种子死亡（全图塌缩为
{30000, −111}）与第二段扫描漏加松弛代价（全局最小值铺满、取值数同样塌缩）。

### 14.2 反向验证（RV3）：人为改坏 → 真实失败输出 → 还原

把顺序临时改回坏实现（玩家修正在前、楼梯覆盖在后），跑全套：

```
 ❯ src/test/p4_9_safety_map.test.ts (8 tests | 1 failed) 98ms
     × T8 真实关卡势场：玩家站在开局楼梯上（打回原场景）也必须有梯度与逃跑方向 14ms
AssertionError: expected 2 to be greater than or equal to 10
 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
```

**T8 红（expected 2 ≥ 10，正是验收观察到的 2 值平图），T1/T2/T3 等 7 条
依旧全绿**——这一条输出同时完成了两件事：证明 T8 能捕获打回的实现；
实证回答了"为什么原测试没发现"（见下节）。随后还原，8/8 复绿。

## 十五、为什么原测试没发现（验收第 2、3 点的逐条回答）

**共同根因：T1/T2 的舞台都会把玩家脚下的地形一并刻掉，再把玩家传送到
人造地板格上。** 楼梯地形在 CARVE 区域内被覆盖，玩家落点永远不是楼梯——
种子天然存活，两段扫描天然有梯度。它们测试的是"算术与机制"，
而平图是"真实输入数据"（玩家出生格的地形）才触发的状态：

- **验收第 2 点（密封走廊解析解 27−x 为何漏掉）**：T2 的舞台是整房刻墙 +
  刻走廊 + 传送玩家到 (44,15) 人造地板。它锁的是数值变换与两段扫描的
  **解析解算术**（f(13)=10→−30、27−x 逐格精确），这些机制本身是对的、
  在它的舞台里也确实成立。种子是否活着是**上游数据问题**，解析解测试
  构造不到。教训：解析解测试锁算法，锁不了"wiring 喂进来的数据"。
- **验收第 3 点（死胡同测试为何在平图缺陷下仍通过）**：T1 与 T2 同舞台，
  玩家被传送到 (52,15) 人造地板格——该状态下梯度存在，所以它通过；
  它断言的是移动轨迹（比贪心聪明、不钻死胡同），价值在状态机与寻路的
  **行为层**，同样构造不到出生数据状态。它当初通过不是侥幸，
  而是它的世界里根本没有这个状态。

**结构性教训（比修复本身更值钱的部分）**：wiring 级功能（生成 → 代价图 →
两次扫描 → 消费）必须有至少一条**零改造生成关卡**上的测试。人造舞台在
覆盖地形的同时会静默移除真实数据里的关键状态（本例：玩家脚下的楼梯），
"合成场景全绿"与"真实链路存活"是两件事。T8 就是这条教训的固化。

## 十六、门禁输出尾部（本轮真实输出）

**`npm test`：**

```
> brogue-web@0.0.0 test
> vitest run

 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  45 passed (45)
      Tests  481 passed | 7 skipped | 5 todo (493)
   Start at  12:06:28
   Duration  36.70s (transform 2.17s, setup 0ms, import 6.78s, tests 197.68s, environment 17ms)
```

（481 ≥ 480 ✅；p2_3 基线与 generation 指纹未红，本轮未触碰任何既有测试与 fixture。）

**`npm run build`：**

```
dist/assets/WebGLRenderer-COMnvGvi.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-wdKdo0av.js               929.85 kB │ gzip: 293.18 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit this warning via build.chunkSizeWarningLimit.
✓ built in 2.57s
```

（chunk 体积警告为既有现象。）

**`git diff --stat`（新增文件不入 stat，见 git status）：**

```
 brogue-web/src/engine/Core/Game.ts        | 39 ++++++++++++++
 brogue-web/src/engine/Map/Pathfinding.ts  | 53 +++++++++++++++++++
 brogue-web/src/entities/Monster.ts        | 87 +++++++++++++++++++++-------
 3 files changed, 162 insertions(+), 17 deletions(-)
```

新增（未跟踪）：`src/engine/Map/SafetyMap.ts`（356 行，本轮净变化：楼梯
循环与玩家修正对调 + 注释 + 头部取舍登记）、`src/test/p4_9_safety_map.test.ts`
（392 行，本轮新增 T8 与头注一行、import 扩一个符号；T1-T7 一字未动）。

## 十七、与预设不符之处（只列不修）

1. **验收书"我倾向第 1 段没传播"——结论正确，但根因不在 `batchScan`。**
   种子条件与松弛代价均与 CE 逐字一致（Dijkstra.c `pdsBatchInput`）。
   真正杀死种子的是楼梯禁入循环覆盖了玩家格（§十二）。
2. **web 玩家出生站在楼梯上，是先于本轮的放置偏差**（CE 落位到无
   HAS_STAIRS 的邻格，RogueMain.c:839-869；web Game.ts:848-856 直接放楼梯
   坐标）。属生成/落位子系统，边界外未修。修它才是"回退 §十三偏离"的前提。
3. **CE 在玩家站楼梯时安全图同样退化为平图**（源码可证，§十二末）。
   本轮按验收条款有意偏离该退化状态（§十三）；如认为应对齐 CE 退化行为，
   需先裁决 2，请明示。
4. **`batchScan` 复用的 `updateMap` 对角阻挡检查与 CE 存在行为分歧**：
   CE 检查 `way->cost == PDS_OBSTRUCTION`（CE 语义 = −2），web 既有代码
   检查 `cost === 30000 / |cost| === 30000`（web 语义），对 CE 负常量永不触发
   ——即 CE 禁止的对角切角在 `batchScan` 路径被允许。不影响本轮平坦化
   （梯度与方向率不依赖切角），但因边界禁止改动既有 `updateMap` 语义，
   只登记不修。
5. 验收书其余事实核查全部属实：常量锚点（−1/−2）、`-111 = f(150)` 算术、
   玩家格末尾回写 30000 符合 CE、两种口径探针一致。无其他分歧。

## 十八、P4-9-R1 验收条款逐条对照

| 打回条款 | 状态 |
|---|---|
| 必做 1：定位并修复，产出有梯度的势场 | ✅ 根因 §十二；修复 §十三；出生态实测 50/42 种取值（修复前 2 种） |
| 必做 2：真实关卡上的测试（取值数下限 + 多数可达格有方向）；密封走廊测试保留；说明为何漏掉 | ✅ T8（两 seed，≥10 种取值 + >0.5 方向率 + >100 可达格）；T2 未动；漏掉原因 §十五 |
| 必做 3：死胡同测试保留且复核通过；解释它当初为何通过 | ✅ T1 未动、修复后通过（全套 8/8）；当初通过的原因 §十五 |
| 边界：不动 Pathfinding.ts 既有 calculateMap/updateMap 语义 | ✅ 本轮该文件零改动（本轮唯一改动在 SafetyMap.ts 与测试文件） |
| 门禁：npm test 全绿 ≥480、build 绿、输出尾部入报告 | ✅ 481 过零红（§十六）；build 绿 |
| 报告：追加到本文件末尾、标明打回补做、回答第 2/3 点 | ✅ §十二~§十八 |
| 临时文件/埋点清理 | ✅ 探针测试文件已删除；P49_DEBUG 埋点已移除并 grep 复核零残留 |
| 无 git 写操作 | ✅ 改动全部留在工作区 |
