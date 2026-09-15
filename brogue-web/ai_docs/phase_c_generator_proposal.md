# Phase C 评审稿：地牢生成器与环境重写

> **状态**：待评审。按决策 D3 的规矩（大改先出方案文档再动手），本文供拍板，不是施工令。
> 2026-09-16 起草。作者：验收方（Claude）。所有 CE 行号均已逐条打开核实，未凭函数名推断。

---

## 〇、为什么这一阶段必须单独立项

原始差距分析把 Phase C 标为"最大工程，建议独立里程碑"。实测数据支持这个判断：

| | CE | brogue-web |
|---|---|---|
| 生成器主体 | `Architect.c` **3,837 行** | `Architect.ts` **386 行** |
| 生成流水线步骤 | **14 步** | **6 步** |
| 房间类型 | 8 种，频率随深度连续变化 | 8 种，频率硬编码且 2 种恒为 0 |

十倍差距不是"补几个函数"，而是**整条流水线缺了一半**。

更要紧的是它的**爆炸半径**：动生成器就动地图，`generation_baseline.json` 全线变红，**所有种子的地牢都会变样**。这是项目迄今最有价值的回归探测器，一旦作废，此后"我改的这一处有没有波及生成"就再也无从判断。前面 P4-10 差点因为我任务书写错而白白牺牲它（详见该轮更正记录）。

---

## 一、逐段对照：CE 的 `digDungeon` 与 web 的 `generateLevel`

CE `digDungeon()`（Architect.c:2877-2980）的完整流水线：

| # | CE 步骤 | web 有无 | 说明 |
|---|---|---|---|
| 1 | `clearLevel()` | ✅ | 填花岗岩 |
| 2 | `carveDungeon(grid)` | ⚠️ 部分 | 见 §二 |
| 3 | **`addLoops(grid, 20)`** | ❌ **全无** | 环路。见 §三 |
| 4 | grid → FLOOR / DOOR（`rand_percent(60)` 且非最深层才成门） | ⚠️ | web 无这个 60% 判定 |
| 5 | `finishWalls(false)` | ❌ | 墙面收尾 |
| 6 | **`designLakes()` + `fillLakes()`** | ⚠️ 名同实异 | 见 §四 |
| 7 | `runAutogenerators(false)` | ❌ **全无** | 非机器自动生成物 |
| 8 | `removeDiagonalOpenings()` | ❌ | 消除对角穿缝 |
| 9 | `addMachines()` | ✅ | web 有 BlueprintEngine |
| 10 | `runAutogenerators(true)` | ❌ | 机器内自动生成物 |
| 11 | `cleanUpLakeBoundaries()` | ❌ | 打通相邻同类湖 |
| 12 | **`while (buildABridge())`** | ❌ **全无** | 建桥。见 §四 |
| 13 | `finishDoors()` | ❌ | 孤儿门移除 + 密门升级 |
| 14 | `finishWalls(true)` | ❌ | 最终墙面收尾 |

web `generateLevel()`（Architect.ts:26-81）实际只有：填花岗岩 → 固定入口房 → `attachRooms`（固定 profile）→ `designEnvironmentOvelays` → `placeTraps`（depth≥3）→ `BlueprintEngine.buildMachines()`。

**14 步里缺 8 步，且缺的多是"让地牢像地牢"的那几步。**

---

## 二、房间与深度剖面

CE `carveDungeon()`（Architect.c:2456-2478）：

```c
theDP = dungeonProfileCatalog[DP_BASIC];
adjustDungeonProfileForDepth(&theDP);
theFirstRoomDP = dungeonProfileCatalog[DP_BASIC_FIRST_ROOM];
adjustDungeonFirstRoomProfileForDepth(&theFirstRoomDP);
designRandomRoom(grid, false, NULL, theFirstRoomDP.roomFrequencies);
attachRooms(grid, &theDP, 35, 35);
```

深度剖面（Architect.c:2425-2434）——`descentPercent` 是「当前深度 / 护符层」的百分比：

```c
roomFrequencies[0] += 20 * (100 - descentPercent) / 100;   // 浅层偏好
roomFrequencies[1] += 10 * (100 - descentPercent) / 100;
roomFrequencies[3] +=  7 * (100 - descentPercent) / 100;
roomFrequencies[5] += 10 * descentPercent / 100;           // 深层偏好（洞穴）
corridorChance     += 80 * (100 - descentPercent) / 100;   // ★ 浅层走廊多，深层几乎没有
```

首房间（Architect.c:2436-2448）：**深度 1 恒为入口房**（其余频率清零），此后 `roomFrequencies[6] += 50 * descentPercent / 100`。

对照 web（Architect.ts:39-44）：

```ts
const dpBasic: DungeonProfile = {
    roomFrequencies: [2, 1, 1, 1, 7, 1, 0, 0],   // 硬编码；[6] 与 [7] 恒为 0
    corridorChance: 10                            // 恒定
};
this.attachRooms(dpBasic, 40, 15);                // CE 是 35, 35
```

**三处偏差**：
1. 频率表不随深度变化 —— 深层不会变成洞穴，浅层走廊不够多，**全 26 层长得一个样**。
2. `roomFrequencies[6]`/`[7]` 恒为 0 —— 两种房型（含入口房）**永不生成**。
3. `maxRoomCount` 是 15，CE 是 35 —— 房间数只有 CE 的 43%。

---

## 三、环路（`addLoops`）——我认为这是优先级最高的单项

CE `digDungeon` 第 3 步 `addLoops(grid, 20)`（Architect.c:340-398）。语义是：找出那些「绕远路才能到达的相邻区域」，在它们之间凿开连接，使地牢**从树状变成带环的图**。参数 20 是"最短绕行距离阈值"。

**为什么它优先级最高**：

- 它是 **safety map 的前提**。P4-9 正在实现的 `updateSafetyMap` 里有一句 `if (IN_LOOP) safetyMap[i][j] -= 10;`——**"有环路可绕的地方更安全"**。web 若没有环路，这一项恒不触发，怪物的逃跑智能就少了一条腿。
- 它也是 waypoint 巡逻（P4-10）质量的前提：树状地牢里巡逻等于来回折返。
- 它直接决定玩家体感：**没有环路的地牢，遇怪就只能原路后退**，没有绕行与包抄。

**建议：把 `addLoops` 从 Phase C 里摘出来先做**，它相对独立（只在已凿好的 grid 上开洞），且能立刻让刚做完的 Phase D AI 发挥出设计意图。

---

## 四、湖泊、连通性与桥

CE 的做法（Architect.c:2638-2732 + 2786-2876）：

1. `designLakes()` —— 画布从 30×15 递减到 20×10，每次 −2×−1，最小生成尺寸 4×4；逐个提议位置。
2. **每提议一个湖，用 flood-fill 验证「放下之后关卡是否仍然连通」**（`lakeDisruptsPassability`）。不通过就再试 9 次，仍不行就放弃这个湖、改生成下一个更小的。
3. `fillLakes()` 按 `liquidType()` 决定液体种类：**岩浆 / 深水 / 深渊 / 硫矿**四类。
4. `createWreath()` 给深水镶浅水边。
5. 后续 `cleanUpLakeBoundaries()` 打通相邻同类湖。
6. **`while (buildABridge())`** —— 在湖上反复架桥直到无处可架。

web 的 `designEnvironmentOvelays`（Architect.ts:333）只是铺地形叠加，**没有连通性验证、没有四类液体、没有镶边、没有桥**。

### ★ 实测：这不是还原度问题，是当前就存在的严重 bug

我写了连通性探针扫 5 个种子 × D1-D26（共 130 层），按**实际移动规则**（`Game.canMoveTo`：深水与熔岩不可进入）从**上楼梯**泛洪，判断**下楼梯是否可达**：

```
[连通性] 汇总：16/130 层的下楼梯从上楼梯走不到
```

其中 5 层是 D26（本身不生成下楼梯，属正常），**真正坏掉的是 11/130 ≈ 8.5%**——**大约每 12 层就有一层，玩家根本下不去**。

最坏的几例：

| 种子 | 层 | 可走格 | 从上楼梯可达 | 孤岛 |
|---|---|---|---|---|
| 20260913 | D1 | 346 | **1** | 345 |
| 20260916 | D14 | 350 | **20** | 330 |
| 20260916 | D8 | 337 | 31 | 306 |
| 31337 | D13 | 323 | 25 | 298 |

D1 那例意味着**这个种子开局即卡死**。

根因就是本节开头列的第 2 步：CE 每提议一个湖都用 flood-fill 验证"放下之后关卡是否仍然连通"，不通过就换位置重试 9 次、仍不行就放弃这个湖改生成更小的。**web 完全没有这道验证**，直接把湖铺上去。

> **探针的一次自我纠错，记在此以免后人重蹈**：我第一版探针用 `cell.isPassable` 判断可走，跑出"0/130 层有孤岛"的漂亮结论。但深水的 `isPassable` 恰恰是 `true`，真正拦住移动的是 `canMoveTo` 里那条单独的 `WATER_DEEP` 排除。按错误判据量，这个 bug 完全隐形。第二版起点用 `player.loc`，而 `generateDepth` 之后玩家位置未必更新，又会得出假结果。最终判据定为"上楼梯 → 下楼梯"，既是真正的可玩性问题，也不依赖玩家位置。

**这条实测把 §6.2 的结论从"建议"变成了"必须"**：不变量断言里的「上下楼梯互相可达」这一条，今天就能抓出 8.5% 的坏关卡。

---

## 五、`promoteTile` 与地形生命周期

全仓 grep：`promoteTile` **0 引用**，`lightSource` **0 引用**，`methane` 仅 1 处注释。

CE 的地形是**活的**：`promoteTile` 驱动地形按 `promoteChance` 演化（草长/火烧/水漫/藻类明灭/机关晋升），`DFType` + `subsequentDF` 形成链式反应。web 的地形基本是静态贴图，只有火和气体两条特例，而且是硬编码的（见路线图 P1-23）。

这块与 **P1-23（缺 DF 系统）**、**P1-22（缺坠落子系统）** 完全重叠——那两项其实就是 Phase C 的碎片，不该单独排期。**建议把 P1-22 / P1-23 并入 Phase C 一起做**，否则会出现"先做个临时 DF 再被 Phase C 推翻"的返工。

---

## 六、建议的施工顺序与基线策略

### 6.1 顺序

| 阶段 | 内容 | 基线影响 |
|---|---|---|
| **C-0** | **`addLoops`** 单独先做（见 §三） | 生成基线必红 |
| C-1 | 深度剖面 + 房间频率表 + `maxRoomCount` 对齐 | 生成基线必红 |
| C-2 | 湖泊四类 + 连通性 flood-fill 验证 + 镶边 + `buildABridge` | 生成基线必红 |
| C-3 | `finishWalls` / `finishDoors` / `removeDiagonalOpenings` / `cleanUpLakeBoundaries` | 生成基线必红 |
| C-4 | `promoteTile` 生命周期 + DF 目录（吸收 P1-23） | 视实现而定 |
| C-5 | 坠落子系统（吸收 P1-22） | 视实现而定 |
| C-6 | `runAutogenerators` | 生成基线必红 |
| C-7 | 光照目录 + 动态视野 + 矿灯深度衰减 | 不影响生成 |

### 6.2 基线策略（**本文最需要拍板的一条**）

C-0 到 C-3 每一步都会让 `generation_baseline.json` 全线变红，"基线保持绿"这个判据在 Phase C 内部**失效**。需要换一套办法，我建议：

1. **每个 C-x 结束时由验收方重捕获一次**，并在 fixture 的 `note` 里记录"因哪一步、改了什么而重捕获"。这样基线退化为"上一步之后的快照"，仍能抓出**下一步的意外波及**。
2. **同时引入不变量断言**（这正是 P1-26 要做的事，且应当**在 Phase C 开工前完成**）：
   - 每层所有地板格连通（无不可达区域）——**这条能抓出 §四 的真 bug**
   - 上下楼梯存在且互相可达
   - 房间数、地板占比在合理区间
   - D1-D26 全部生成不抛异常

   这类断言**不依赖具体坐标**，所以 Phase C 的每一步都不会让它们无谓变红，反而能真正兜住回归。

**结论：P1-26 不是可选的收尾杂务，它是 Phase C 的前置条件。** 没有不变量断言，Phase C 全程都在"基线反正要红"的状态下裸奔。

---

## 七、待补（评审前我会补上）

- [x] §四 的连通性探针实测结果 —— 已补，结论：11/130 层（8.5%）下楼梯不可达
- [ ] `runAutogenerators` 与 `autoGeneratorCatalog` 的规模统计
- [ ] C-0（`addLoops`）的独立任务书草稿

---

## 八、需要拍板的四个问题

1. **C-0（`addLoops`）是否提前到 Phase B 之前做？** 我倾向是——它是 P4-9/P4-10 两轮 AI 工作发挥效果的前提，晚做等于让刚做好的功能空转。
2. **P1-22 / P1-23 是否并入 Phase C？** 我倾向是——否则必然返工。
3. **基线策略**是否按 §6.2 走（P1-26 提前为 Phase C 前置条件 + 每步重捕获 + 引入不变量断言）？
4. **§四 实测的 8.5% 不可达关卡要不要插队立刻修？** 我倾向是——它不是"还原度不足"而是当前就存在的严重 bug，玩家每玩十来层就会遇到一次下不去的死关。最小修法（湖泊放置后做一次连通性验证，不通过就撤销该湖）远小于整个 C-2，可以单独摘出来先做。
