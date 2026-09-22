# V-2b-9d dungeonProfile 轮：13 号哥布林巢穴 / 14 号哨兵圣所

> **本地执行（`codex exec --worktree`）。你有 10 核和可用的 `npx vitest`——请务必自己验证。**

## 0. 三条教训（上轮 9c 已验证有效，继续照做）

### 0.1 填活一条 DF 的 tile，就把整条闭包一次走完
沿 `promoteType` / `fireType` / `propagationTerrain` / `subsequentDF` 四条边递归，
对闭包内每个地形实跑普通晋升与 fire 晋升，要求 `deferred === null`。
9b 漏一个门导致 `catalogFeature()` 运行时抛错、污染 90 条无关测试；
9c 照此法一次找齐 7 个门，首提门禁全绿。

### 0.2 退池留形 = **加引擎过滤**，不是改数据
数据永远保持 CE 逐字；退池在 `blueprintQualifies` 里做
（那里已有 `vestibule_secret_lever` / CE52 / `key_worm_tunnels` 三个先例可照抄）。
**判别法：改数据能让守卫变绿，往往说明你在改被守卫的那个事实本身。**

### 0.3 覆盖门没有观测对象时，**换样本**不是改期望
"必须 ≥1"这类门翻红时先问"是不是样本里恰好没有观测对象"。
换样本后也**不要钉精确台数**——该值随同文件前序用例的模块态而动。

## 1. 范围：两条蓝图 + 一族机制

```
CE 13  :264-274  Goblin warren
       {5,15}  {100,200}  freq 15  featureCt 9   DP_GOBLIN_WARREN
       (BP_ROOM | BP_REWARD | BP_MAXIMIZE_INTERIOR | BP_REDESIGN_INTERIOR)

CE 14  :275-288  Sentinel sanctuary
       {10,23} {100,200}  freq 15  featureCt 10  DP_SENTINEL_SANCTUARY
       (BP_ROOM | BP_REWARD | BP_MAXIMIZE_INTERIOR | BP_REDESIGN_INTERIOR)
```

⚠️ 两条都是 **`BP_REWARD`**（奖励房，不是钥匙机器）——
`category` 应为 **`reward`**，不是 `key_guard`、更不是 `thematic`。
9b 曾把九条一律填 `thematic` 撞红 `v_1c` Q1b（`LEGAL = {reward, vestibule, key_guard}`）。

## 2. ⚠️ 工作量分布与你可能的直觉相反——先读这节

验收方已自查过 web 现状。**四件事里三件几乎是白送的，真活只有一件**：

| 事项 | 实际状态 |
|---|---|
| `dungeonProfileCatalog` 两条新 profile | **纯数据，4 行**。`Architect.ts:39-41` 已有 `DP_BASIC` / `DP_BASIC_FIRST_ROOM` 与 `DungeonProfile` 类型，照加即可 |
| `BP_MAXIMIZE_INTERIOR` | **一行开关**。`BlueprintEngine.ts:1185` 已在调 `expandMachineInterior(interior, 4)`，注释写着"MAXIMIZE=1 本轮不做"——CE `:862-865` 就是 `MAXIMIZE ? 1 : 4` |
| `attachRooms` | **已有且签名正好**：`Architect.ts:344` 的 `this.attachRooms(work, theDP, attempts, maxRooms)` |
| **`BP_REDESIGN_INTERIOR` → `redesignInterior`** | **本轮唯一的真活**，CE `Architect.c:734-854`，121 行 |

CE 两条 profile 数据（`Globals.c:934-951`，自行复核）：
```
//                      0   1   2   3   4   5   6   7     corridorChance
DP_GOBLIN_WARREN       {0,  0,  1,  0,  0,  0,  0,  0},   0
DP_SENTINEL_SANCTUARY  {0,  5,  0,  1,  0,  0,  0,  0},   0
```
下标即 RoomType（0 十字 / 1 小对称十字 / 2 小房 / 3 圆房 / 4 厚房 / 5 洞 / 6 洞窟 / 7 入口房）。

⚠️ **这两条 profile 不过 `adjustDungeonProfileForDepth`**——
CE 的深度调整只作用于 `DP_BASIC` / `DP_BASIC_FIRST_ROOM`（`carveDungeon` 里），
`redesignInterior` 直接取 `dungeonProfileCatalog[theProfileIndex]`。
**不要顺手给它们套深度调整**，那会改掉 CE 的房型分布。

## 3. `redesignInterior` 的结构（CE `:734-854`）

五步，逐段直译：

1. **建 scratch grid**（CE `:742-770`）：
   - interior 格 → `0`（可放房间），**但 origin → `1`**（"All rooms must grow from this space"）
   - interior 外、`cellIsPassableOrDoor` → `1`（当作已建成）；
     同时若其 4 邻中有 interior 格（且不是 origin），把**那个 interior 邻格**记入
     `orphanList` 并置 `-1`（孤儿门，禁止放房）
   - 其余外部 → `-1`
2. **`attachRooms(grid, &dungeonProfileCatalog[idx], 40, 40)`**（CE `:771`）
   ⚠️ **是 `40, 40`，不是 carveDungeon 的 `35, 35`**（`Architect.ts:48-49` 那两个常量）。
   别复用那两个常量，按 CE 传 40。
3. **重连孤儿**（CE `:773-834`）：对每个 orphan 做 Dijkstra——
   interior 内 `grid>0` 的格 `pathing=0/cost=1`，interior 内其余 `pathing=30000/cost=1`，
   interior 外 `pathing=30000/cost=PDS_OBSTRUCTION`；
   然后从 orphan 沿**严格下降**方向走，一路把 `grid[i][j] = 1`。
4. **`addLoops(grid, 10)`**（CE `:836`）
   ⚠️ **注意签名**：web 的 `LoopMap.addLoops(grid: Grid, minimumPathingDistance)` 第一参是
   **dungeon `Grid`**，而 CE 这里传的是**房间布局 scratch grid**（`short**`）。
   **两者不是一回事**——先查清 web 侧该怎么在 scratch grid 上做等价操作，
   若需要新写一个 scratch 版，**在报告里说明为什么不能直接复用**。
5. **写回**（CE `:837-853`）：对 interior 内的格——
   - `grid >= 0` → 清 `SURFACE` 与 `GAS` 层为 `NOTHING`
   - `grid == 0` → `DUNGEON = GRANITE`，**且 `interior[i][j] = false`**
   - `grid >= 1` → `DUNGEON = FLOOR`

⚠️ **第 5 步会让 interior 缩小**（`interior[i][j] = false`）。
这在下游有连带：machineNumber 标记、feature 落位、`machineCells` 往返合同
（`p1_37` AD3a 刚在审计轮改成 5 seed × 26 层全扫）。**留意这些会不会红。**

📌 CE 的 `pos orphanList[20]` 是**定长 20 且循环里没有越界检查**。
web 侧要么照长度留形并在超出时给出明确行为，要么用动态数组——
**任选其一，但在报告里说明你选了哪个、CE 溢出时会怎样**。

📌 `D_INSPECT_MACHINES` 包住的都是调试绘图，跳过。

## 4. 本轮**不做**：9e 的区域机器 interior 生长

验收方已查清两者**可以拆开**，依据：

- CE `prepareInteriorWithMachineFlags` **只有一个调用点**（`Architect.c:1225`），
  位于 `do{…}while(tryAgain)` 循环**之后**、point of no return **之后**；
- 区域机器的 interior 生长在 `:1140-1205`，在那个循环**里面**，严格上游；
- **13/14 都是 `BP_ROOM`**，interior 来自 `findSuitableRoom`，**永远不走区域路径**。

⇒ 本轮**不要**碰区域机器路径，也**不要**把 65/66 放回池
（那是 9e 的事，且 9b 已因嫁接错位置造成过 Kennel 饿死的回归）。

## 5. 可解性

13/14 是**奖励房**（`BP_REWARD`），不是钥匙机器，没有"取钥匙"链。但 `redesignInterior`
是 **nuke-and-pave**——它会把 interior 重新铲平重建。**必须回答**：

- 重建后奖励物品的落点还可达吗？（第 5 步把 `grid==0` 的格变成 GRANITE）
- 孤儿重连（第 3 步）是否保证了原有连通性不被切断？
- `c_8_connectivity` 的坏层发生率有没有变化？

## 6. 生成流会动——基线重捕获是最后一步

13/14 入池 + `BP_MAXIMIZE_INTERIOR` 开关都会动生成流。
**重捕获放在所有改动之后**，之后 `npm run test:drift` 必须绿。
成因分离：①13/14 入池；②MAXIMIZE 开关对**既有**带该旗标蓝图的影响
（先查还有没有别的蓝图带它）；③redesignInterior 本身的房间重建。

## 7. 授权改动清单

**引擎与数据**：`src/engine/Generator/BlueprintEngine.ts`、
`src/engine/Generator/Architect.ts`、`src/engine/Generator/RoomBuilder.ts`、
`src/engine/Map/LoopMap.ts`、`src/engine/Map/Grid.ts`、
`src/engine/Map/TerrainCatalog.ts`、`src/engine/Map/DungeonFeatureCatalog.ts`、
`src/data/blueprints.json`、`src/types.ts`（若 `DungeonProfile` 需扩字段）

**固件**：`src/test/fixtures/generation_baseline.json`（**仅最后一步**）

**测试**：新建 `src/test/v_2b_9d_dungeon_profile.test.ts`、
`c_1_room_profile`（本轮主场之一）、`c_0_add_loops`、`c_8_connectivity`、
`c_4a_terrain_catalog`、`c_4a_0_layer_model`、`c_4b_dungeon_feature`、
`c_7_lighting`、`r_1_appearance`、`g_2_gas_df_wiring`、`invented_content_pool`、
`p1_30_i18n_gate`、`p1_26_invariants`、`blueprint_center`、
`p1_33_machine_chokepoint`、`p1_37_machine_flag_i18n`、`p1_20_item_placement`、
`p1_31_35_placement_snapshot`、`b_4b_item_placement`、`v_1a_blueprint_items`、
`v_1b_alternative`、`v_1c_machine_structure`、`v_2a_vestibule_return`、
`v_2b_2a_placement_flags`、`v_2b_2b_blueprints`、`v_2b_3_wired`、
`v_2b_4_altars`、`v_2b_5_dormant`、`v_2b_6_keys`、`v_2b_7_features`、
`v_2b_9a_carriers`、`v_2b_9b_environment`、`v_2b_9c_effects`、`c_6_autogenerators`

清单外改动必须申报。`BrogueCE-master/` **只读**。**守卫顺延不放宽**；
**行为断言**撞断 > 5 个停下来说明（穷举表连带不计入）。

## 8. 门禁跑法（本地）

- **跑 §7 授权清单的全部文件**（不只是你改动过的）
- ⚠️ **不要跑不带参数的全量 `npx vitest run`**——那是 13 分钟墙钟，
  且验收方会在你交付后自己跑全量，你跑等于和它抢核
- `npm run build` 要跑；基线重捕获后 `npm run test:drift`

**最终复跑（硬要求）**：在**所有编辑完成之后**重跑授权清单，报告里给逐文件结果，
并**明确声明「这是最终状态下的运行结果，不是中途快照」**。
（上轮你用最终复跑前后各算一次全部 src 的 SHA-256 来自证无中途编辑——**那个做法很好，继续**。）

## 9. 授权反驳

事实判断若与 CE 不符，**驳回并纠正**并给行号。你上轮纠正了验收方两处
（闪电触发源在 `Items.c:5455` 而非 Combat.c、52 号自带炮塔不能凭"没闪电物品"判死局）
并揪出一处既存抄录错误（`DF_ECTOPLASM_DROPLET` 抄了 `:670` 的 `UNICORN_POOP` 参数，
正确是 `:673` 的 `0/0`）——**继续这样做**。
**§2 的"三件白送、一件真活"和 §3 的五步拆解都是验收方读 CE 后写的，可能有错。**

**对抗性要求**：每条新断言回答「这条用例在什么实现缺陷下会翻红？」
——尤其 `redesignInterior`：它必须能区分"真的重建了房间布局"与
"只是把 interior 抹平成一片地板"。

## 10. 报告

写到 `ai_docs/reports/v-2b-9d.report.md`，含：

1. §2 工作量判断的复核结果（哪几件确实白送、有没有验收方看漏的）
2. **§3 五步逐段的落地**，特别是第 4 步 `addLoops` 的签名问题怎么解的、
   第 5 步 interior 缩小的下游连带撞了哪些守卫
3. `orphanList` 定长 20 的处置与理由
4. 两条蓝图逐 feature 的 CE 对照（含 `category` 填了什么）
5. **§5 可解性三问**
6. §6 基线重捕获与三股成因分离
7. 撞断的守卫清单与处置（覆盖门按 §0.3）
8. §9 对抗性要求的回答
9. **§8 的最终复跑声明**
10. 清单外改动申报
