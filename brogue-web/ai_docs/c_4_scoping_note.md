# C-4 范围勘察：它不是一轮，是三轮（外加一个必须先答的架构问题）

> 验收方写于 2026-09-16 夜，P1-37 与 C-3 执行期间。
> 结论先行：**队列里"C-4 promoteTile 生命周期 + DF 目录"这一条不能照原样投出去。**
> 它预设了两个 web 根本不存在的底座，直接投会让执行方要么自己现造底座（无法验收），
> 要么把 promote 硬接在现有结构上（造出一个和 CE 形似神不似的东西，以后更难拆）。

---

## 一、勘察到的事实（逐条给出处）

### 1. web 没有分层，CE 有四层

CE `Rogue.h` `enum dungeonLayers`：`DUNGEON / LIQUID / GAS / SURFACE`，每格四个地形
同时存在。`promoteTile(x, y, layer, useFireDF)` 的第三个形参就是层——
**"提升"本质上是"把某一层的地形换成它的 promoteType"**，其他层不动。

web `Grid.ts:Cell` 只有 `terrain: TerrainType` 一个字段。
草长在地上是 `terrain = GRASS`（把地板盖掉了），不是"地板层是 FLOOR、表面层是 GRASS"。

**后果**：烧草之后要还原成什么？CE 里答案是显然的——表面层没了，露出下面的
DUNGEON 层地板。web 里地板信息已经被覆盖丢失，只能猜 `FLOOR`。
湖岸的草烧完会变成地板而不是浅水，桥上的草烧完会把桥烧没。

### 2. web 没有地形属性表，CE 有 215 条

CE `Globals.c` `tileCatalog[NUMBER_TILETYPES]` 215 条，每条带
`flags`（T_*）/`mechFlags`（TM_*）/`fireType` / `promoteType` / `promoteChance` /
`description` 等 14 个字段。**promote 机制的全部数据都在这张表里。**

web 的地形属性来自 `Grid.ts:135-155` `setTerrain()` 里两个写死的布尔启发式：
```ts
cell.isPassable = (terrain !== WALL && !== GRANITE && !== CHASM && !== SECRET_DOOR);
cell.isOpaque   = (terrain === WALL || === GRANITE || === DOOR || === SECRET_DOOR);
```
**没有 promoteType，没有 fireType，没有 promoteChance，没有 TM_* 旗标。**
DF 目录（CE 219 条 `dungeonFeatureCatalog`）在 web 里**完全不存在**。

### 3. ★ 通行判据有两个口径，而且它们互相矛盾

| | `Grid.setTerrain` 的 `isPassable` | `Game.canMoveTo` |
|---|---|---|
| WALL / GRANITE / SECRET_DOOR | 不可通行 | 不可通行 |
| **LOCKED_DOOR** | **可通行** | **不可通行** |
| **WATER_DEEP** | **可通行** | **不可通行** |
| CHASM | 不可通行 | **可通行**（未列入排除） |

`Pathfinding.calculateMap`（`Pathfinding.ts:78`）先看 `cell.isPassable`，
所以**所有 Dijkstra 图（含气味图、安全图、路径点距离图）都认为深水和上锁的门可以走**，
而玩家实际走不过去。C-5 让 CHASM 真的生成之后，第三行会变成活雷：
`canMoveTo` 会放玩家走进深渊——这其实**恰好是 CE 的正确行为**（T_AUTO_DESCENT 坠层），
但目前是"碰巧对"，不是"照 CE 写对"。

**这个口径分裂正是我自己两次量错连通性的根源**（`cell.isPassable` 让 8.5% 坏层完全隐形）。
它也是 P1-25（击退落点口径不一致）的同一个病根。

### 4. 顺带查证：web 禁止游深水是对 CE 的偏离

CE `Globals.c:413` DEEP_WATER 的 flags 是 `T_IS_FLAMMABLE | T_IS_DEEP_WATER`，
**不含 `T_OBSTRUCTS_PASSABILITY`**。`T_IS_DEEP_WATER`（`Rogue.h:1937`）的注释写明
语义是"50% 概率偷走物品并随机挪动"，不是"不可进入"。
配合 `TM_ALLOWS_SUBMERGING | TM_STAND_IN_TILE`——**CE 里深水是游过去的，不是墙。**

web 的 `canMoveTo` 把它当墙，这条偏离一直没被登记过。它不是小事：
湖泊是 P1-29/C-2 两轮的产物，而玩家现在只能绕着湖走。

---

## 二、因此 C-4 拆成三轮

| 轮次 | 内容 | 前置 | 规模 |
|---|---|---|---|
| **C-4a** | **地形属性表**：把 215 条 CE tileCatalog 中 web 实际用到的那些，落成一张数据表（flags / mechFlags / promoteType / fireType / promoteChance）。**统一通行判据到唯一口径**，`isPassable`、`canMoveTo`、`Pathfinding` 全部改查表。**不引入分层、不引入 promote 行为。** | 无 | 中 |
| **C-4b** | **DF 目录 + `spawnDungeonFeature`**：CE 219 条 DF 的数据结构与扩散算法（startProbability / probabilityDecrement / propagationTerrain / subsequentDF）。 | C-4a | 中 |
| **C-4c** | **`promoteTile` + 两趟驱动**：CE `Time.c:1244-1286` 本体、`Time.c:1600-1665` 的**先算后改两趟**结构、`TM_PROMOTES_ON_*` 各触发源、硫矿点火链（C-2 登记）、接线机器（`TM_IS_WIRED` / `activateMachine`）。 | C-4a + C-4b | 大 |

**C-4c 的两趟结构不能省**：CE 第一趟只往 `promotions[i][j]` 记位、第二趟才真的改地形
（`Time.c:1644-1662`，注意源码里那行被注释掉的 `// promoteTile(i, j, layer, false);`
就是作者当年把一趟改成两趟留下的痕迹）。一趟写法会让同一回合内先改的格子影响后判的格子，
**破坏同种子决定性**——这是我们所有生成期断言的地基。

---

## 三、必须先由项目决策回答的一个问题

**要不要把四层地形模型搬过来？**

- **搬**：C-4a 的工作量大幅上升（`Cell` 结构、存档 schema、渲染、所有读 `cell.terrain`
  的地方全要动，全库 `cell.terrain` 引用以百计），但烧草/结冰/桥上着火/洪水退去
  这些 CE 机制才有正确落点，C-4c 和 C-5、C-7 才站得住。
- **不搬**：C-4a 便宜，但 C-4c 必须为"提升后还原成什么"发明一套 web 独有的规则——
  **这正是 D1（行为一律照 CE）要防的那类东西**，而且每多一轮就更难回头。

**验收方倾向"搬"，但作为独立一轮 C-4a-0 先做**，只做结构迁移、行为逐位不变、
由 `generation_baseline` 与全部坏层闸门钉死。理由：它是纯机械变换，
可以用"行为零变化"这个极强的验收判据兜底；而混在 C-4a 里做就没有这个兜底了。

**用户已裁决（2026-09-16）：搬。** 作为独立一轮 **C-4a-0** 先做，
任务书见 `tasks/c-4a-0.prompt.md`。

**C-4a-0 的设计要点**（写任务书时才想清楚的一条）：分层落地后，
`setTerrain` **本轮刻意保持"每格只有一层非空"**（写归属层 + 清空其余三层），
于是 `terrain` getter 恒等于写入值，**与今天的覆盖式赋值逐位等价**，
`generation_baseline` 必须保持绿——这就是"行为逐位不变"这个极强判据的落点。

分层看起来因此像个空架子，但那是有意的：本轮的产物是**结构**
（Cell 形状、存档 schema、层感知读写入口、drawPriority 表、归属层表），
全部在完美门禁下落地；C-4a 再把"清空其余三层"换成"只清 CE 会清的"，
那时属性表已在手，每一处分歧都能讲清楚。

**并要求本轮做一次干跑测量**：在 `setTerrain` 里记录"被清掉的非空层"的
(层, 旧地形 → 新地形) 组合与次数，跑 15 种子 × D1-D26 出表。
**那张表就是"C-4a 放开清空后会冒出多少处分歧"的实测答案**，只测量、不修。

**排期**：C-4a-0 要动 `Cell` 结构，与正在跑的 P1-37（允许改 `Grid.ts`）冲突，
**不可并行**，须等 P1-37 与 C-3 两轮落地后串行投。

---

## 四、这次勘察额外登记的条目（待并入路线图）

- **P1-38**：通行判据三处口径不一（`isPassable` / `canMoveTo` / Dijkstra 成本图），
  深水与上锁的门在图算法眼里可走、在玩家脚下不可走。**由 C-4a 统一。**
- **P1-39**：web 禁止玩家进入深水，偏离 CE（CE 深水可游，代价是 50% 丢物品）。
  正确做法连着 `TM_ALLOWS_SUBMERGING`（潜水）与丢物品判定，**归 C-4a 之后的单独一轮**。
- **P1-40**：`Grid.setTerrain` 的启发式没有随 C-2 新增的五个枚举更新——
  它们目前全部落进"可通行、不透明=false"的默认分支。对 OBSIDIAN / BRIDGE /
  BRIDGE_EDGE / CHASM_EDGE 恰好正确，对 INERT_BRIMSTONE 也正确，
  **纯属侥幸**，下一个新增地形就未必。**由 C-4a 根治。**
