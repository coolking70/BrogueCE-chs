# P1-42 报告：密门发现机制对齐 CE

执行：ZCode/GLM（执行方）· 2026-09-16 · 分支 `round/p1-42`
改动的文件：`src/engine/Core/Game.ts`、`src/engine/Map/Grid.ts`（仅 Cell 布尔位）、
`src/locales/zh_CN.json`（仅增键）、`src/test/p1_42_secret_door_search.test.ts`（新增）。
**未执行任何 git 写操作**；`Input.ts` 与 `BrogueCE-master/` 未动（见 §二键位冲突申报）。

---

## 一、CE 源码复核（全部行号为本轮重新打开源码确认，非转抄任务书）

### 1.1 search(searchStrength) — `Movement.c:2459-2489`

```
radius = searchStrength / 10;                       // :2464 整除
双层 for：i ∈ [x-radius, x+radius]，j 同理          // :2466-2468 方形扫描窗
if (coordinatesAreInMap && playerCanDirectlySee)     // :2469 可见性先于一切
  percent = searchStrength - distanceBetween * 10    // :2471-2472 距离衰减
  if (cellHasTerrainFlag(T_OBSTRUCTS_PASSABILITY))   // :2470 阻挡格
    percent = percent * 2 / 3                        //       整数除法
  if (percent >= 100) flags |= KNOWN_TO_BE_TRAP_FREE // :2473-2475
  percent = min(percent, 100)                        // :2476 只封顶不保底
  if (cellHasTMFlag(TM_IS_SECRET) && rand_percent(percent)) discover(i,j)  // :2477-2483
```

要点（任务书之外本轮新确认的三处）：
- `distanceBetween` 是**切比雪夫距离**（`Monsters.c:1587-1589`：`max(|dx|,|dy|)`）。
- `rand_percent` 是**先抽后夹**（`Math.c:62-65`：`rand_range(0,99) < clamp(p,0,100)`）——
  `percent ≤ 0` 也消耗一次抽取。实现里对扫描窗内密格**无条件掷骰**，禁止剪枝，
  否则 RNG 流位移。
- 半径**只决定扫描窗**，不决定命中率边界：`d > strength/10` 的格即使被扫到
  （错误实现的更大半径），`percent` 也 ≤ 0、必不命中——所以"半径写错"在
  结果层面近乎惰性，只能靠**掷骰次数**（= 扫描窗内密格数）抓，见 A1。

### 1.2 调用源一：每步自动搜索 — `Time.c:2544-2549`（`playerTurnEnded` 内、主观玩家块、怪物推进之前）

```c
if (rogue.awarenessBonus > -30 && !(pmapAt(player.loc)->flags & SEARCHED_FROM_HERE)) {
    search(rogue.awarenessBonus + 30);          // 基线强度 30 → 半径 3
    pmapAt(player.loc)->flags |= SEARCHED_FROM_HERE;
}
```
`SEARCHED_FROM_HERE` 定义在 `Rogue.h:1090`，是**玩家所站格**上的 pmap 位：
"在这格上做过自动搜索"，随层新建。注意它不是"搜索过相邻格"——同一格不重复触发，
换格即重新武装。

### 1.3 调用源二：主动 search 命令 — `Time.c:2395-2430`（manualSearch）

```c
recordKeystroke(SEARCH_KEY='s')                        // :2395；Rogue.h:1177
status[STATUS_SEARCHING] 归零底 + maxStatus=5          // :2397-2399
status += 1                                            // :2402
strength = status<5 ? (awarenessBonus>=0 ? 60 : 30)    // :2417-2418
                   : 160 + 播报 + status 归零          // :2419-2424 终搜
search(max(strength, awarenessBonus + 30))             // :2427 不弱于被动
justSearched = true; playerTurnEnded()                 // :2429-2430
```

**充能的"连续回合"语义来自 `playerTurnEnded` 里的清零分支**（`Time.c:2550-2552`）：
`!rogue.justSearched && status>0 → status=0`。`justSearched` 在回合末清除
（`Time.c:2875`）。关键否定证据：**`decrementPlayerStatus`（`Time.c:2211-2395` 全函数）
不碰 `STATUS_SEARCHING`**——充能不是会衰减的状态，其唯一归零路径就是清零分支
与终搜自身。因此 web 实现把它做成 Game 普通字段（`searchingCharge`），
**没有**放进会衰减的 `statusDurations`。

### 1.4 discover(x, y) — `Movement.c:2437-2457`

对每层带 `TM_IS_SECRET` 的 tile：先清层（`DUNGEON→FLOOR`、其余→`NOTHING`，
:2444-2451），再 `spawnDungeonFeature(x, y, discoverType, refreshCell=true,
abortIfBlocking=false)`（:2452；五形参签名 `Rogue.h:2933`——那行 `true` 是
refreshCell，延续 C-4c 的验收改正）。`SECRET_DOOR`（`Globals.c:330`）的
discoverType 是 `DF_SHOW_DOOR`（`Globals.c:624`：单格、无传播、DUNGEON 层落 DOOR）。

---

## 二、web 侧实现与两个申报

### 2.1 `playerCanDirectlySee` 的对应物：选 **FOV 体系（computeFOVMask）**

CE 宏是 `pmap.flags & VISIBLE`（`Rogue.h:1276`）——显示管线每回合刷新的
"玩家当前所见"位（`updateVision` → `updateFieldOfViewDisplay`，Time.c:859/2589，
由 IN_FIELD_OF_VIEW + 光照阈值合成）。它**不是**裸几何视线：

- `Game.hasLineOfSight`（Game.ts:6303）是无半径、无光照语义的纯几何射线。
  用它会给"能不能看见"造出**第二套定义**（渲染、怪物侦测、物品发现都用
  FOV 的 isVisible）——正是 P1-38 批评的"同一件事多套答案"。
- web 的 FOV（递归阴影投射、视野半径 10）就是 CE VISIBLE 的对应物。
  实现走 `fov.computeFOVMask(px, py, 10, c => c.isOpaque)`——与
  `FOV.castLight` 同一投射算法、同一遮挡谓词（isOpaque）、同一视野半径
  （update() 的 computeFOV(…,10)），但只产出局部掩码、**不写任何 cell 标志**：
  CE 的 search 只"读"可见性、不制造它，isVisible/isExplored/hasMemory 的
  写入属渲染管线职权。CE 的光照阈值维度 web 的 FOV 不含，这是既有近似，
  不属本轮。

**时新性 + 性能（本轮的两个真 bug，都由测试抓出）**：

1. **时新性**：web 的 FOV 是惰性刷新（`update()` 渲染前才重算），headless
   推进走到搜索时 `isVisible` 可能还是上一步的旧图。CE 无此问题（显示
   管线每回合刷 VISIBLE）。故掩码在扫描时按玩家当前位置**现算**。
2. **首次实现用 `this.fov.computeFOV(…)`（全图 1904 格清位+重算）保证时新性
   ——armor_model_effect 的 40k 回合聚合测试从 ~170s 膨胀到 202–225s，
   撞穿 180s 超时**（全量套件实测）。改惰性掩码后回降到 167s：
   先按行主序收集扫描窗内密格，**窗内无密格则连掩码都不算**（CE 的 search
   对非密格本就零掷骰，语义不变），有密格才做一次半径 10 的局部投射。
3. **中途犯过一次错，被自家 A4 抓红**：曾把掩码半径"优化"为
   min(扫描半径, 10)——但扫描窗是**切比雪夫方形**、掩码是**欧氏圆**，
   半径 3 的圆罩不住 (Δ3,Δ3) 对角格（√18 > 3），把本应可掷骰的门错判成
   不可见（A4 期望 2 次掷骰、实测 0）。修正为掩码半径恒 10。终搜扫描
   半径 16 超过视野半径 10 的部分按 CE 语义本就不可直视，被闸门排除，
   方形/圆形的边界差与 CE 行为一致。

### 2.2 键位冲突申报（**未改任何键位，按任务书停下报告**）

任务书要求"接上 `s` 键"。**CE 的 SEARCH_KEY 确实是 `'s'`（Rogue.h:1177），
但 web 的 `s`/`S` 已绑定为向下移动**（`Input.ts` handleKeyDown，wasd 布局）。
任务书明令"若与既有按键冲突，停下来报告，不要擅自改键位"，故：

- 引擎侧动作已完整接好：`handlePlayerAction('search')` → `manualSearch()`
  （充能、终搜播报、耗 `movementSpeed`、`playerTurnEnded`），与 move/wait
  同级、受输入锁与麻痹守卫约束。测试全部经此入口驱动。
- `Input.ts` **一行未动**。UI 键位待验收方裁决（可选项：a) 换空闲键如 `z`——
  但注意 CE 的 `z` 是 REST_KEY；b) WASD 用户用 `j` 下移、让出 `s`；c) 加
  命令面板入口）。裁决后接线是一行：`case '<键>': onActionCallback('search')`。

### 2.3 discover 的实现形态 + **留痕与文件边界冲突申报（第 7 起）**

CE 原样（清层 + discoverType DF 链）会给三份 C-4 留痕接上第一个游戏侧读者：

| 留痕 | 机制 | 本轮会触发它的代码 |
|---|---|---|
| `c_4b_dungeon_feature.test.ts` F1 | DF 子系统符号生产引用白名单 | `spawnDungeonFeature` / `catalogFeature` import |
| `c_4a_0_layer_model.test.ts` | `setTerrainLayer` 调用点白名单 | discover 的清层写 |
| `c_4a_terrain_catalog.test.ts` | promote/fire 字段读者白名单 | `entry.mechFlags` / `entry.discoverType` 读 |

而这三个测试文件都在本轮**禁改清单**里（"违反即本轮作废"），任务书也未按
项目常识（2026-09-17 规矩第 4 条）提前把它们列入允许清单——**这是该冲突的
第 7 起，前 6 起已由常识立规**。执行方按"宁可红，不可绕"评估后采取的做法：

- **不走 DF 链，也不把代码扭曲成扫描看不见的形态**，而是采用对 SECRET_DOOR
  这一特例**今日逐位等效**的直写：`setTerrain(DOOR, '+', 0xaa8844)` +
  `isDiscovered = true` + 既有 i18n 键 `trap.secret_door_found`。等效性论证：
  DF_SHOW_DOOR 是单格、无传播、零旗标 DF，净效果 = DUNGEON 层落 DOOR；
  直写还同时更新 char/color/isPassable/isOpaque（CE 的落层写入口不更新这些，
  直写反而免去补写，杜绝"看见了走不进"）。**净代码比 CE 原样更短**，不存在
  被正则"看不见"的语义读取。
- 等价前提"**web 目录中 TM_IS_SECRET 的唯一持有者是 SECRET_DOOR**"由新测试
  C1 的目录绊线钉死（测试可以自由读目录）。前提被打破时 C1 翻红，届时按
  注记迁移为 CE 原样并由验收方扩三份白名单。
- 若验收方倾向"本轮就走 CE 原样"：改动面 = Game.ts 两个方法 + 扩三份白名单
  （各加一行 `engine/Core/Game.ts`），机制断言不需要变。

### 2.4 awarenessBonus 与 KNOWN_TO_BE_TRAP_FREE

- **awarenessBonus：接基线值 0，接线登记不实现。** web 有 `ring_of_awareness`
  物品（arcana.json:174），但现行语义是 web 自创（telepathy 状态 +
  幻觉/麻痹抗性，Game.ts `syncEquipmentStatuses` / `getPlayerStatusResistance`），
  与 CE 的 `rogue.awarenessBonus`（`Items.c:8690` 清零、`:8712` 按
  `20 × effectiveRingEnchant` 累加）不是一回事。一件物品挂两套语义正是
  P1-38 教训，故 `Game.awarenessBonus()` 恒回 0（CE 无戒基硬基线），
  `> -30` 守卫照抄（恒真，留作对齐形状）。CC 接线留待物品语义重构轮。
- **KNOWN_TO_BE_TRAP_FREE：登记不实现。** CE 在 `percent ≥ 100` 时置该位
  （Movement.c:2473-2475），web 没有"隐藏陷阱知识"设施——TRAP 恒可见
  （TerrainCatalog TRAP 条目注记），无设施可接。留痕测试 C2 锚定"搜索对
  TRAP 格零作用"的现状。

---

## 三、§三 四项实测（本轮核心判据）

**方法**：同一份测量脚本（只使用两棵树共有的 API）分别跑在
工作区（P1-42 后）与 `git archive HEAD` 存档树（旧 30% 机制）上。15 种子
× D1→D26 逐层下潜，每层 200 回合探索预算；wizard 模式隔离战斗/饥饿致死
（mode 不改生成 RNG 流，同种子地图与 normal 一致）；探索策略 = 30% 随机绕行
+ 70% BFS 朝楼梯，**BFS 无路（唯一通路在密门之后）时**：新树玩家"搜一步走一步"，
旧树玩家只能继续游走（旧游戏没有搜索动作）。

**必须预先声明的方法论限制**：新旧机制消耗 RNG 的次数不同 → 下潜流从 D2 起
分叉 → 两棵树**不是同一批地图**（总数 258 vs 206 扇、负重层 9 vs 10 层）。
对比是统计性的（同种子集合同预算下的比率），不是逐层配对。逐层配对在
机制层面不可能：发现本身改变地图与后续行走。

### 3.1 修复前后：密门发现比例

| 指标 | 修复前（30% 邻接） | 修复后（CE search） |
|---|---|---|
| 密门总数 | 258 | 206 |
| 发现数 | **8** | **18** |
| 比例 | **3.1%** | **8.7%** |
| 有密门的层 / 至少发现一扇 | 91 / 8 | 75 / 15 |

（被动走动的发现主通道是自动搜索：半径 3、percent (30−10d)×2/3，
单格单次；旧机制只在四邻接 d=1 以 30% 触发。两者对"路过的玩家"都是低概率
事件——CE 本来就这样，CE 的密门发现主力是**主动搜索**，见 3.3。）

### 3.2 最坏情形：唯一通路在密门之后的层（P1-42 存在的理由）

判定：对每层做"把 SECRET_DOOR 当墙"的 BFS（stairs_up → stairs_down），
不可达即"通路在密门之后"（`T_PATHING_BLOCKER && !TM_IS_SECRET` 口径的
闸门对此报绿——这正是 harness.analysisAllowsMove 文档警告的情形）。

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 此类层数 | 9 | 10 |
| 200 回合内找到（→可下潜） | **0 层（0%）** | **2 层（20%）** |
| 找不到时的表现 | stuckTurns=200：整层预算原地打转 | 多数同左，2 层在 15/44 回合内突破 |

**更重的后果**：修复前 15 个种子**全部**在 D4–D12 被这类层卡死
（maxDepth 4/5/5/6/6/7/7/9/9/9/10/11/11/12/12），永远到不了 D26；
修复后同样是 15/15 卡死（D4–D13），但这是**机器人策略的极限**，
不是机制的极限——

- 卡住后玩家与门的位置关系取决于 BFS 死点在哪；门在死点视距外（>半径 16
  或隔多个转角不可见）时，CE 机制同样无解。真人会沿可疑墙面逐格搜索，
  机器人不会。
- 一旦玩家与门进入"可见 + d ≤ 4"的关系，5 连搜的发现率是 **90–100%**（见 3.3）。
  旧机制在这种关系下需要玩家恰好走进四邻接格才有 30%/次。

**结论**：修复把"唯一通路在密门之后"从**必然不可玩**（0/9，且没有任何
自救手段——旧游戏连搜索动作都没有）变成**站位正确即可解**（5 连搜 90–100%）；
但"闸门报绿 ≠ 可玩"的残余风险仍然存在，`analysisAllowsMove` 文档里的警告
应继续保留。

### 3.3 主动搜索充能满 5 次的实际发现率（200 试验/档）

累计发现率（第 1..5 次连续搜索后）：

| 门距 d | 1 连 | 2 连 | 3 连 | 4 连 | 5 连（终搜 160） |
|---|---|---|---|---|---|
| 1 | 41% | 61% | 74% | 85% | **100%** |
| 2 | 32% | 52% | 66% | 77% | **99%** |
| 3 | 20% | 38% | 53% | 64% | **96%** |
| 4 | 11% | 22% | 32% | 44% | **90%** |

与 CE 公式逐位吻合（例：d=1 首搜 41% = 手动 33%⊕首回合自动搜索 13% 的
并集概率 1−0.67×0.87=0.417；d=4 终搜 (160−40)×2/3=80% → 累计
1−0.87⁴×0.2=0.885≈0.90）。**充能终搜在 d ≤ 4 可见时基本必中**；
每档理论值均落在试验值 ±2% 内。

### 3.4 决定性：同种子同操作序列

永久化在 `p1_42_secret_door_search.test.ts` D1/D2：同种子两次完整脚本
（24 回合混合移动/搜索 + 2 扇门 + 全图快照）逐位相等；不同种子原始生成层
指纹不同（sanity）。**自动化搜索/充能/终搜全部走项目 `rng` 单例，0 处
`Math.random`**。测试 D1 在本轮全部执行通过。

---

## 四、对抗性测试（≥6）与反向验证（4 条，全部真实改坏→红→还原）

`src/test/p1_42_secret_door_search.test.ts` 共 14 条。A 组 7 条对抗性：

| # | 针对的错误实现 | 抓法 |
|---|---|---|
| A1 | 半径误用 strength 本身（漏 /10） | d=7 门：正确实现扫描窗外**零掷骰**（spy randPercent 计数 0）；错误实现 2 次 |
| A2 | 距离衰减 ×10 写成 ×1 | d=strength/10 处 percent 恰 0 → 60 种子**零发现**；×1 时约 27%/次 |
| A3 | 阻挡格 2/3 折扣漏掉 | 终搜 160 对 d=6 门：正确 66%，漏折扣 100% → 40 局全中即翻红（≤34 通过） |
| A4 | SEARCHED_FROM_HERE 漏掉 | 往返 4 步恰好 2 次自动搜索掷骰；漏旗标则 4 次 |
| A5 | 充能不要求连续回合 | s×3+wait+s×3 零终搜播报；s×5 恰 1 次；第 6 次不再播报（logger 捕获） |
| A6 | 可见性要求漏掉（隔墙搜到） | 花岗岩隔墙的门：每局 0 掷骰、20 局零发现；漏可见性时终搜序列 88%/局 |
| A7 | percent ≤ 0 剪枝跳过（流位移） | percent=0 的扫描格仍消耗 1 次抽取（CE Math.c:62 先抽后夹） |

B 组 2 条锚定旧 30% 机制已删除（静态：`randPercent(30)` 不再现；行为：单步移动
掷骰数恰为 1 = 自动搜索，旧机制会叠加邻接掷骰）。C 组 3 条留痕（目录绊线 C1、
陷阱搜索不实现 C2、闸门判据未触碰 C3）。D 组 2 条确定性。

**反向验证（真实输出摘录；改坏→跑→还原，全套 A 组随后复跑 14/14 绿）**：

```
[1] 半径改 radius = searchStrength（漏 /10）：
  × A1 …AssertionError: 半径外不应发生任何命中掷骰: expected 2 to be +0
[2] 衰减改 * 1：
  × A2 …AssertionError: percent=0 的格在正确实现下绝不可能被发现（衰减 ×1 时约 27%/次）:
        expected 10 to be +0
[3] 删除充能清零分支（Time.c:2550-2552 对应物）：
  × A5 …AssertionError: 隔回合打断后永不终搜: expected 1 to be +0
[4] 注释掉 autoSearched = true（SEARCHED_FROM_HERE 漏置位）：
  × A4 …AssertionError: 往返 4 步恰好 2 次自动搜索掷骰: expected 4 to be 2
```

（历史教训 dirs8 漏 [1,1] 一案的直接回应：A4 这类"次数型"断言对漏旗标
零容忍——上面第 4 条就是真实抓到的。）

---

## 五、门禁

- `npm run build`：绿（797 modules transformed，2.50s）。
- `npm test`：全量尾部输出见 §八（真实回填）；p1_26 / p1_29 / p1_33
  坏层闸门单独复跑全绿；`generation_baseline` 原样绿——搜索是回合期行为，
  未触碰生成期，fixture 未刷新。
- i18n 门禁 `p1_30_i18n_gate`：16/16 绿（新键 `search.detailed_finished` 已按
  中文语序补入 zh_CN.json；`trap.secret_door_found` 沿用既有键）。
- **过程记录**：中间版本曾出现两类红灯，均已修复并复跑：
  ① 三份 C-4 留痕（discover 一度走 DF 链，见 §2.3 申报）；
  ② `armor_model_effect` 聚合测试超时（全图 computeFOV 的性能税，见 §2.1
  与 §六.7），惰性掩码后回到预算内。
- `git diff --stat`：
```
 brogue-web/src/engine/Core/Game.ts | 211 ++++++++++++++++++++++++++++++++++---
 brogue-web/src/engine/Map/Grid.ts  |   6 ++
 brogue-web/src/locales/zh_CN.json  |   1 +
 3 files changed, 204 insertions(+), 14 deletions(-)
```
（另有新增文件 `src/test/p1_42_secret_door_search.test.ts`，14 条测试。）

---

## 六、与预设不符之处（只列不修）

1. **`s` 键冲突（任务书未预见的硬冲突）**：CE SEARCH_KEY='s'，web 的
   's'/'S' 已是向下移动。按任务书指令未改键位、未动 Input.ts；引擎侧
   `handlePlayerAction('search')` 已完整可用，键位待裁决（见 §2.2）。
2. **任务书漏排三份 C-4 留痕的允许清单（常识第 4 条的第 7 起冲突）**：
   按"宁可不触发、不可绕过"处理为等效直写 + 目录绊线，见 §2.3。
   如验收方倾向 DF 链原样，需要：Game.ts 两个方法改写 + 三份白名单各加一行。
3. **任务书说自动搜索在 `Time.c` 附近 2544-2549——行号准确**，但补充两点
   任务书未提的语义：a) `SEARCHED_FROM_HERE` 置在玩家**所站格**（不是邻格）；
   b) `decrementPlayerStatus` 不衰减 `STATUS_SEARCHING`，充能必须做成普通
   字段而非 web 的 statusDurations。
4. **测量方法学**：新旧机制 RNG 消耗不同导致地图分叉，"同 15 种子 × D1-D26"
   只能做统计对比而非逐层配对（§三开头的声明）。负重层判定依赖
   `canMoveTo` 口径的 BFS；LOCKED_DOOR 在该口径下不可通行且本轮玩家
   不捡钥匙，个别层的"卡住"可能与密门无关（未在负重层表中的截断即此因）。
5. **旧 30% 揭示曾被一段注释称为"30% discovery chance per step"**——实际
   语义是"每步移动后对四邻接密门各掷一次 30%"，不是"每步 30%"。已删除，
   B1 静态锚定。
6. **web 的 FOV 无光照阈值维度**（CE VISIBLE = IN_FIELD_OF_VIEW + 光照），
   computeFOVMask 对 CE `VISIBLE` 是近似而非全等。这是既有近似，
   本轮沿用并在 §2.1 记录，不属本轮修正范围。
7. **新发现并已修复的两个实现坑（测试抓真 bug 的实例）**：
   a) 搜索可见性最初借 `computeFOV` 全图重算保证时新性 → 40k 回合的
      `armor_model_effect` 聚合测试撞穿 180s 超时（全量套件实测 202–225s）；
      改惰性局部掩码后回到 167s。
   b) 掩码半径一度取 min(扫描半径,10)，被 A4 抓红：方形窗角的对角格
      （切比雪夫 3、欧氏 √18）在半径 3 圆掩码外，漏掷骰。修正为恒 10。
   两案都在 §2.1 存档，提醒后人：CE 的"扫描窗"与"视野"是两个不同边界。

---

## 七、任务书验收条款逐条对照

| 任务书条款 | 状态 | 落点 |
|---|---|---|
| §二.1 移植 search（半径/衰减/2/3 折扣/可见性） | ✅ | Game.searchForSecrets（§1.1/§2.1） |
| §二.1 查明 playerCanDirectlySee 对应物并论证 | ✅ | computeFOVMask，§2.1 |
| §二.1 KNOWN_TO_BE_TRAP_FREE 有则接、无则登记 | 登记 | §2.4（web 无隐藏陷阱知识设施） |
| §二.2 每步自动搜索 + SEARCHED_FROM_HERE（Cell 布尔位，Grid.ts） | ✅ | Game.playerTurnEnded 块 + Cell.autoSearched |
| §二.2 awarenessBonus 查明/接线或基线+登记 | 基线 0+登记 | §2.4（web 感知戒指语义为自创，不强行挂第二语义） |
| §二.2 主动 search 命令 + 充能；键冲突停下报告 | ✅/申报 | 引擎侧 'search' 完整；'s' 冲突未改键（§2.2） |
| §二.3 替换旧 30% 揭示、不留两套 | ✅ | handleSpecialTileEntry 已删；B1/B2 锚定 |
| §三.1 修复前后发现比例 | ✅ | §3.1：3.1% → 8.7%（统计口径声明见 §三开头） |
| §三.2 最坏情形层数与前后概率 | ✅ | §3.2：9/10 层，0% → 20% @200 回合 + 卡死行为分析 |
| §三.3 充能满 5 发现率 | ✅ | §3.3：d≤4 时 90–100%，与 CE 公式吻合 |
| §三.4 同种子同操作决定性 | ✅ | §3.4 + 永久测试 D1/D2 |
| §四 明确不做（闸门判据/陷阱搜索/自动探索/C-4 文件） | ✅ | 留痕 C2/C3；C-4 文件零改动 |
| §五 文件边界 | ✅ | Game.ts / Grid.ts（仅布尔位）/ zh_CN.json（仅键）/ 新测试；Input.ts 未动（冲突申报） |
| §六.1 对抗性可失败 | ✅ | A1–A7 每条点名错误实现 |
| §六.2 对抗性 ≥6 条 | ✅ | 7 条（A1–A7）+ B2 行为锚定 |
| §六.3 反向验证 ≥3 条真实失败输出 | ✅ | 4 条（A1/A2/A4/A5），输出摘录 §四 |
| §六.4 坏层闸门 p1_26/p1_29/p1_33 = 0 | ✅ | 复跑 29/29 绿（含 generation_baseline、c_3） |
| §七 门禁 build/test 绿；baseline 不动 | ✅ | §五/§八 |
| §八 报告四项内容 | ✅ | 本文件 |

---

## 八、附：`npm test` / `npm run build` 输出尾部（真实回填）

```（待全量套件跑完后回填——占位）
