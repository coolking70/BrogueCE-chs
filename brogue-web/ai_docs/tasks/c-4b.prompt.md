# C-4b：DF 目录 + spawnDungeonFeature（纯库，生产零调用点）

> 只改"允许修改"清单里的文件；**不要执行任何 git 写操作**（`status`/`diff`/`log` 只读允许）。

**授权反驳条款有效**：CE 源码优先。你在前几轮连续纠正过验收方——PDS 常量、
湖泊重试次数、种子隔离、C-1 的累计测量 bug、`WATER_DEEP` 拼写、密门的
T_PATHING_BLOCKER 措辞、C-4a-0 的 CHASM_EDGE/OBSIDIAN 归属层、
**C-4a 的 P1-38 因果链（`calculateMap` 生产零调用点）**。请继续。

**本轮我同样不给你任何 CE 数据表。** 理由见 C-4a 任务书：我在照抄 CE 表格上的
错误率高于你。下面凡是提到 CE 函数的地方，我只给函数名与文件，行号与实现细节
请你自己打开确认——**我给的行号历轮已被你纠正过多次**。

---

## 一、这一轮的位置

C-4a-0 搬来四层结构、C-4a 建成属性表（`TerrainCatalog.ts`，含 `fireType` /
`promoteType` / `promoteChance` 等**有数据、无读者**的字段）。
本轮补 CE 的**地形特征（dungeon feature）子系统**——它是 `promoteTile`（C-4c）
唯一的执行手段：CE 的"提升"本质上就是"spawn 一个 DF"。

**本轮是纯库：生产代码零调用点。** 调用方全部在 C-4c。
这样做的理由与 C-4a-0 / C-4a 一致——结构先行、行为逐位不变、
`generation_baseline` 不重采而绿当门禁。

---

## 二、要做什么

### 1. DF 目录（数据，由你从 CE 抽取）

CE `Globals.c` 的 `dungeonFeatureCatalog[NUMBER_DUNGEON_FEATURES]` 共 219 条。
结构见 `Rogue.h` 的 `typedef struct dungeonFeature`（tile / layer /
startProbability / probabilityDecrement / flags / description / lightFlare /
flashColor / effectRadius / propagationTerrain / subsequentDF / messageDisplayed）。

**不要求 219 条全抄。** 抄 web 现有 31 个 TerrainType 够得着的那些
（`TerrainCatalog.ts` 里已引用的 `fireType` / `promoteType` 字符串就是清单起点：
DF_EMBERS / DF_PLAIN_FIRE / DF_OBSIDIAN / DF_STEAM_ACCUMULATION / DF_OPEN_DOOR 等），
外加它们经 `subsequentDF` 链到的条目（**要闭包，别留悬空引用**）。
- 每条注明 CE 行号；
- 引用了 web 没有的 tileType 的条目：**登记但不实现**，别为它现造地形
  （新增地形是后续轮次的事），并在报告里列清单。

### 2. 三个算法（照 CE，自己打开读）

- `spawnMapDF`（`Architect.c`）——扩散波前。注意三件事，**都请自己核对**：
  代际计数器 `t` 的推进方式、**4 向**扩散、每波 `startProb -= probDec`；
  以及 `propagationTerrain` 与 `T_OBSTRUCTS_SURFACE_EFFECTS` 的交互
  （后者在"该格正是 propagationTerrain"时被豁免）；还有 `t > 100` 那个收敛分支。
- `fillSpawnMap`（`Architect.c`）——按 **drawPriority** 决定能否覆盖。
  **这是 C-4a-0 那张 `DRAW_PRIORITY` 表第一次有真正的读者**，
  请确认你的实现真的用了它，且比较方向与 CE 一致（含 `superpriority`、
  `blockedByOtherLayers`、`layer == SURFACE` 的额外禁止）。
- `spawnDungeonFeature`（`Architect.c`）——外壳。GAS 层是特例
  （不走扩散，直接累加 volume）；非 GAS 层走 spawnMapDF → 连通性检查 → fillSpawnMap。

### 3. ★ 连通性检查怎么办（本轮唯一需要你做判断的地方）

CE 在 `abortIfBlocking` 时用 `levelIsDisconnectedWithBlockingMap` 否决会切断关卡的 DF。
web 侧已有两个同类设施：`Connectivity.lakeDisruptsPassability`（C-2/P1-29）
与 `BlueprintEngine` 的锁门验证泛洪（P1-33）。

**请查明三者的判据是否可统一**，然后二选一并在报告里论证：
- 复用现有设施（若语义确实一致）；
- 或新写一个，并说明为什么不能复用、与既有两个的差异在哪。

⚠️ `Connectivity.ts` 在**禁改**清单里（C-4a 刚动过）。若你的结论是"应当复用但
需要小改它"，**停下来在报告里论证**，不要改。

### 4. ★ 必须翻转一条既有留痕（这次任务书提前安排好了）

`src/test/c_4a_0_layer_model.test.ts:343` 有一条留痕断言
"生产代码中 `setTerrainLayer` 调用点数为 0"，它自己的注释写明
"C-4a 接管后本断言要翻转为'调用点只出现在清单许可的文件'"。

`fillSpawnMap` 必然要按层写入，**所以本轮必然触发它**。
**该测试文件已列入下面的允许修改清单**（仅限这一条断言），
请按它自带的指示把清单改为许可你的新文件。**不要改动该文件的其它任何断言。**

> 这条在本项目历史上已连续踩坑五次（见 `project_conventions.md`
> 「留痕测试与文件边界」一节）。本轮由验收方提前处理。

---

## 三、明确不做（写显式留痕测试）

- **生产代码零调用点**——本轮交付的是库，`spawnDungeonFeature` 不接进任何
  生成或游戏流程。写留痕断言钉死这一点（仿 C-4a-0 那条的写法），C-4c 翻转它。
- **不实现 `promoteTile` 本体、不接 promote 触发源**——C-4c。
- **不放开 C-4a-0 的"每格只有一层非空"**：`setTerrain` 仍清其余三层。
  （你的库在测试里可以造多层格，但生产路径上这条不变式不许破。）
- **不统一通行判据**（P1-38 / C-4a-1）、**不改深水可否进入**（P1-39）。
- 不实现 `DFF_RESURRECT_ALLY` / `evacuateCreatures` / 光效（lightFlare /
  flashColor / effectRadius）——登记即可。

---

## 四、文件边界（硬约束）

**允许修改**：
- `src/engine/Map/` 下新增文件（DF 目录与三个算法放这里）
- `src/engine/Map/TerrainCatalog.ts`（**仅**在 DF 引用暴露出属性表缺字段时补字段；
  已有取值不许改，改了就是承认 C-4a 抄错——那要单独报告）
- `src/test/c_4a_0_layer_model.test.ts`（**仅** 343 行那一条留痕断言，见 §二.4）
- 新增测试文件

**禁止修改**（违反即本轮作废）：
- `src/engine/Map/Grid.ts` / `Connectivity.ts` / `LakeSystem.ts` / `LoopMap.ts` /
  `SafetyMap.ts` / `WaypointMap.ts` / `Scent.ts` / `Pathfinding.ts` / `Pathfind.ts`
- `src/engine/Core/Game.ts`、`src/engine/Generator/` 下任何文件、
  `src/engine/Environment/Gas.ts`
- `src/entities/`、`src/components/`
- **`BrogueCE-master/` 下任何文件**
- 任何 `src/data/*.json`、`src/engine/Random.ts`、`vite.config.ts`
- **`src/test/fixtures/*`** —— baseline **必须保持绿**，不许刷新
- `src/test/harness.ts`、其它既有测试文件

**禁改清单本身就是判据**：本轮是纯库，生产侧一行都不该动。

---

## 五、测试要求

1. 每条断言必须能在某个具体的错误实现下失败。
2. **对抗性测试至少七条**：
   - `spawnMapDF` 用 8 向而非 4 向扩散
   - `startProb -= probDec` 漏掉（扩散不衰减）
   - `propagationTerrain` 的豁免条件写反
   - `fillSpawnMap` 的 drawPriority 比较方向写反
   - `superpriority` 被忽略
   - `layer == SURFACE` 的 `T_OBSTRUCTS_SURFACE_EFFECTS` 禁止被漏掉
   - GAS 层走了扩散路径（而非 volume 累加特例）
3. **反向验证（强制）**：至少三条真的改坏、贴真实失败输出、还原。
4. **决定性**：同种子同输入，spawnMap 逐格一致。
5. **留痕**：生产零调用点、promote 本体未实现、"每格只有一层非空"在生产路径未破。

---

## 六、门禁

- `generation_baseline` **不重采而绿**（纯库不该动生成，红了说明漏进了生产路径）。
- 坏层闸门 `p1_26` / `p1_29` / `p1_33` 仍为 0。
- `npm test` 全绿、`npm run build` 绿。
- 全局超时 300s；重型测试最慢 `c_0_add_loops` 148s，翻红先单跑复核。

**两个已知陷阱**：
1. 深水枚举成员是 **`WATER_DEEP`**，不是 `DEEP_WATER`。写错**不报错**——
   vitest 走 esbuild 只剥类型不检查，运行时得 `undefined`。
   **任何让人困惑的失败，先跑 `npm run build`。**
2. 同 seed 的可复现单元是**完整生成链**，不是任意中间层。

---

## 七、交付

报告写入 `ai_docs/c_4b_dungeon_feature_report.md`，必须含：
- 抄录了哪些 DF 条目、各自 CE 行号、`subsequentDF` 闭包是否完整；
- **引用了 web 没有的 tileType 的条目清单**（后续新增地形的输入）；
- 三个算法的 CE 行号与你复核出的实现要点（尤其 `t > 100` 分支与
  `T_OBSTRUCTS_SURFACE_EFFECTS` 的豁免）；
- **§二.3 连通性检查的裁决与论证**；
- 对抗性测试与反向验证的真实失败输出；
- `generation_baseline` 绿色读数的实际输出行。
