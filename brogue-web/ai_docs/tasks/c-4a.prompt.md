# C-4a：地形属性表 + 统一通行判据（结构先行，行为逐位不变）

> 只改"允许修改"清单里的文件；**不要执行任何 git 写操作**（`status`/`diff`/`log` 只读允许）。

**授权反驳条款有效**：本任务书的事实陈述可能有错，CE 源码优先。你在前几轮连续纠正过
验收方（PDS 常量、湖泊重试次数、种子隔离、C-1 的累计测量 bug、web 本就有 ×3 偷袭基线、
`WATER_DEEP` 拼写、密门的 T_PATHING_BLOCKER 措辞、**C-4a-0 的 CHASM_EDGE/OBSIDIAN 归属层**）。
请继续。

**本轮我刻意不给你任何 CE 数据表。** C-4a-0 那轮我手抠归属层表，把 CHASM_EDGE 和
OBSIDIAN 按 drawPriority 同档猜成了 SURFACE，实际是 LIQUID（`Globals.c:627` 的 DF 条目
白纸黑字）。**我在"照抄 CE 表格"这件事上的错误率高于你**，所以这轮的表由你从
`Globals.c` / `Rogue.h` 抽取，我只定结构与门禁。

---

## 一、病灶

C-4a-0 把四层地形模型搬进来了，但地形的**属性**仍然没有表：
`Grid.setTerrain` 里两行写死的布尔启发式就是 web 的全部"地形属性"。
没有 flags、没有 mechFlags、没有 promoteType/fireType/promoteChance——
C-4b（DF 目录）与 C-4c（promoteTile）全都卡在这里。

**而且通行判据分裂成了互相矛盾的两派**（路线图 P1-38）：

| | `Grid.setTerrain` 的 `isPassable` | `Game.canMoveTo` / `Connectivity.terrainAllowsMove` |
|---|---|---|
| WALL / GRANITE / SECRET_DOOR | 不可通行 | 不可通行 |
| **LOCKED_DOOR** | **可通行** | **不可通行** |
| **WATER_DEEP** | **可通行** | **不可通行** |
| **CHASM** | **不可通行** | **可通行** |

`Pathfinding.calculateMap` 读 `cell.isPassable`，所以**气味图、安全图、
路径点距离图全都认为深水和上锁的门可以走**，玩家却走不过去。
`canMoveTo` 反过来不排除 CHASM——C-5 让深渊真的生成后玩家会走进去，
这碰巧是 CE 的正确行为（T_AUTO_DESCENT 坠层），但属"碰巧对"而非"照 CE 写对"。

**验收方自己两次量错连通性就是栽在这上面**（用 `cell.isPassable` 做判据，
让 8.5% 的坏层完全隐形）。

---

## 二、要做什么

### 1. 地形属性表（数据，由你从 CE 抽取）

给 web 现有的全部 TerrainType 建一张表，每条至少含：
`flags`（T_*）、`mechFlags`（TM_*）、`drawPriority`（C-4a-0 已有，复用勿改）、
`fireType` / `promoteType` / `promoteChance` / `chanceToIgnite` 的**占位字段**
（本轮只填数据、不接行为，见"明确不做"）。

- **每条都要在注释里写明 CE 出处行号。**
- web 独有的地形（TRAP / SIGN / RESET_PLATE / BOG / BLOOD / CHARRED_FLOOR /
  STAIRS_DOWN 等）CE 没有同名条目：**逐个选最接近的 CE 对应物并说明理由**，
  找不到就自拟并标注 `webOnly: true`。
- 表的形态（TS 常量 / JSON / 两者）由你定，但 `src/data/*.json` **是禁改目录**，
  所以新数据放 `src/engine/Map/` 下的新文件。

### 2. 用 CE 的名字暴露派生判据

至少这两个（名字照 CE，便于后续对照）：
- `blocksPassability(t)` —— `T_OBSTRUCTS_PASSABILITY`
- `isPathingBlocker(t)` —— `T_PATHING_BLOCKER`（CE `Rogue.h:1948` 是若干旗标的并集，
  **自己打开确认成员，不要照我复述**）

以及 `blocksVision` / `obstructsItems` / `obstructsDiagonalMovement` 等
现有代码已经在用其语义的那些。

### 3. ★ 迁移，但**只迁答案不变的调用点**

把现有判据改为查表实现，**逐个核对答案**：

- **答案不变的**：直接迁移（例如 `terrainAllowsMove` 与 `canMoveTo` 本就一致，
  它们大概率能原样落到某个派生判据上）。
- **答案会变的**：**不要改，留在原地**，并在报告里给出
  **精确清单 + 实测影响**（哪个调用点、哪个地形、改了会怎样、多少处受影响）。
  为每条写一个**显式留痕测试**，记录"当前答案是什么"，供后续轮次翻转。

**本轮的成功判据与 C-4a-0 相同：行为逐位不变。**
`generation_baseline` **必须不重采而绿**；全量必须全绿。
这条判据就是你"迁移是否只动了答案不变的点"的自动证明。

### 4. 干跑测量（下一轮的输入）

为每个"答案会变"的调用点，实测量化影响。至少：
- `Pathfinding.calculateMap` 改用 `isPathingBlocker` 后，
  成本图上有多少格的 cost 会改变（15 种子 × D1-D26）；
- 深水/上锁的门/深渊各自贡献多少。

**只测量，不修改。** 报出表来。

---

## 三、明确不做（写显式留痕测试）

- **不接任何 promote/DF 行为**——`fireType` / `promoteType` / `promoteChance` /
  `chanceToIgnite` 本轮只是**有数据、无读者**的字段。写留痕断言："生产代码零读取点"。
- **不放开 C-4a-0 的"每格只有一层非空"**（`setTerrain` 仍清其余三层）——下一轮。
- **不改深水可否进入**（P1-39）、不改怪群成员铺开（P1-41）、
  不改蓝图特征选址（P1-43）。
- **不动 `analysisAllowsMove`**（`src/test/harness.ts`，连通性分析口径放行密门，
  依据 `Architect.c:202-203`）——它是测试侧判据，本轮不碰。

---

## 四、文件边界（硬约束）

**允许修改**：
- `src/engine/Map/Grid.ts`
- `src/engine/Map/Connectivity.ts`（仅为把 `terrainAllowsMove` 改为查表实现）
- `src/engine/Map/Pathfinding.ts`（**仅**在答案不变的前提下改为查表；
  若答案会变，**不要改**，留痕并报告）
- `src/engine/Core/Game.ts`（**仅** `canMoveTo` 一处改为查表）
- `src/engine/Map/` 下新增文件
- 新增测试文件

**禁止修改**（违反即本轮作废）：
- `src/engine/Generator/` 下任何文件、`src/engine/Environment/Gas.ts`
- `src/engine/Map/LakeSystem.ts` / `LoopMap.ts` / `SafetyMap.ts` /
  `WaypointMap.ts` / `Scent.ts` / `Pathfind.ts` / `Color.ts`
- `src/entities/`、`src/components/`
- **`BrogueCE-master/` 下任何文件**
- 任何 `src/data/*.json`、`src/engine/Random.ts`、`vite.config.ts`
- **`src/test/fixtures/*`** —— baseline **必须保持绿**，不许刷新
- `src/test/harness.ts`、其它既有测试文件

---

## 五、测试要求

1. 每条断言必须能在某个具体的错误实现下失败。
2. **对抗性测试至少六条**：
   - `T_PATHING_BLOCKER` 的并集成员漏掉一个
   - `blocksPassability` 与 `isPathingBlocker` 被混用
   - 某个地形的 flags 抄错（选一个有可观测后果的）
   - webOnly 地形的兜底值写错
   - 查表实现与旧硬编码在**某个具体地形上**答案不一致
   - 留痕：promote 字段被误接上读者
3. **反向验证（强制）**：至少三条真的改坏、贴真实失败输出、还原。
4. 坏层闸门 `p1_26` / `p1_29` / `p1_33` 仍为 0。

---

## 六、门禁

- `generation_baseline` **不重采而绿**（本轮全部价值所在，红了就停下报告）。
- `npm test` 全绿、`npm run build` 绿。
- 全局超时 300s。重型测试最慢 `c_0_add_loops` 148s、`p1_29` 71s、
  `invented_content_pool` 52s；翻红先单跑复核，报告里区分"真失败"与"超时"。

**两个已知陷阱**：
1. 深水枚举成员是 **`WATER_DEEP`**，不是 `DEEP_WATER`。写错**不报错**——
   vitest 走 esbuild 只剥类型不检查，运行时得 `undefined`。
   **任何让人困惑的失败，先跑 `npm run build`。**
2. 同 seed 的可复现单元是**完整生成链**，不是任意中间层
   （rng 全局单例、`generateDepth` 沿用当前流位置、web 无 CE 的 levelSeed 设施）。
   写确定性测试必须从 D1 逐层生成到目标层。

---

## 七、交付

报告写入 `ai_docs/c_4a_terrain_catalog_report.md`，必须含：
- 属性表全文或其生成方式，**每条的 CE 出处行号**；
- `T_PATHING_BLOCKER` 的实际成员（你从 `Rogue.h` 读到的）；
- web 独有地形的逐条取值与理由；
- **"答案会变"的调用点精确清单 + 实测影响表**（下一轮的输入，请写详细）；
- 迁移了哪些调用点、为什么它们答案不变；
- 对抗性测试与反向验证的真实失败输出；
- `generation_baseline` 绿色读数的实际输出行。
