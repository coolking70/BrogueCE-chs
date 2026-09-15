# C-4c：promoteTile + 每回合两趟驱动（**本链第一个真会改行为的轮次**）

> 只改"允许修改"清单里的文件；**不要执行任何 git 写操作**（`status`/`diff`/`log` 只读允许）。

**授权反驳条款有效**：CE 源码优先。你在前几轮连续纠正过验收方——PDS 常量、
湖泊重试次数、种子隔离、C-1 的累计测量 bug、`WATER_DEEP` 拼写、密门的
T_PATHING_BLOCKER 措辞、C-4a-0 的 CHASM_EDGE/OBSIDIAN 归属层、C-4a 的 P1-38
因果链、C-4b 的连通性裁决。请继续。

**本轮我同样不给 CE 数据表，行号也请自行确认**——我给的行号历轮被你纠正过多次。

---

## 一、与前三轮不同：这一轮的门禁不是"逐位不变"

C-4a-0 / C-4a / C-4b 都能拿"`generation_baseline` 不重采而绿"当门禁，
因为它们只搬结构。**C-4c 会真的改变游戏行为**——门开、火烧、冰融、硫矿点燃。

`generation_baseline` 只测量**生成**，而 promote 是**回合期**的事，
所以它大概率仍然绿。**别把它当作"没改坏"的证据。**
本轮真正的判据是下面 §五的实测影响报告 + 既有玩法测试。

---

## 二、要做什么

### 1. `promoteTile` 本体（CE `Time.c`，自己定位）

四件事按 CE 的顺序：`TM_VANISHES_UPON_PROMOTION` 的清层
（注意 DUNGEON 层清成 FLOOR、其余层清成 NOTHING，且清 T_PATHING_BLOCKER 时
要标脏环路图）、选 `fireType` 还是 `promoteType`、spawn 该 DF、
以及**接线机器分支**（见"明确不做"，本轮**不做**这一支）。

**C-4b 已查明的两条前提，请复核后据此实现**：
- CE 的 `promoteTile` **先清层再 spawn**，且 spawn 时 `abortIfBlocking = false`；
  这正是 DOOR（drawPriority 8）能晋升 OPEN_DOOR（25）而不被 `fillSpawnMap`
  的优先级判据挡住的原因。
- `spawnMapDF` 不检查"已标记"，`probDec = 0` 的非 GAS 输入会**无限震荡**。
  CE 目录所有走扩散的条目都满足 `probDec > 0`——这是隐含输入约定。
  **本轮若要合成任何 DF 条目，必须守住 `probDec > 0`，并写断言钉死。**

### 2. ★ 每回合驱动必须是**两趟**（这一条不许走样）

CE 在 `updateEnvironment`（`Time.c`）里：
**第一趟只往 `promotions[i][j]` 记位、第二趟才真的改地形。**
源码里那行被注释掉的 `// promoteTile(i, j, layer, false);` 就是作者当年
从一趟改成两趟留下的痕迹。

**一趟写法会让同回合内先改的格子影响后判的格子，破坏同种子决定性**——
那是本项目所有生成期与回合期断言的地基。**写测试钉死两趟语义**
（构造一个"一趟会连锁、两趟不会"的场景）。

同时照抄 `promoteChance` 的两种算法：普通地形直接用 `tile->promoteChance`，
而**扩散型地形按四邻中"同层地形不同且不阻挡"的邻居数做负向累加**——
这段我描述得可能不准，**以源码为准**。
还有 `CAUGHT_FIRE_THIS_TURN` 的守卫与回合末清理、
`TM_PROMOTES_WITHOUT_KEY` 的记账趟。

### 3. 触发源（只接 web 今天支撑得住的）

CE 的触发点（自己核对，我只给线索）：
`TM_PROMOTES_ON_ITEM_PICKUP`（`Items.c` 附近 826）、
`TM_PROMOTES_ON_ITEM`（1279）、`TM_PROMOTES_WITHOUT_KEY`（5067）、
`TM_PROMOTES_ON_PLAYER_ENTRY`（6932，注意它还要求该层带
`T_OBSTRUCTS_PASSABILITY`——那是"拉杆"）、`TM_PROMOTES_WITH_KEY`（`Movement.c` 625）、
`TM_PROMOTES_ON_ELECTRICITY`（`exposeTileToElectricity`）。

**逐个判断 web 今天有没有对应的事件点。**有的接上；没有的**登记不实现**，
并在报告里说明缺什么。不要为了接触发源去改 `Game.ts` 的事件结构。

### 4. 硫矿点火链（C-2 登记的欠账）

`INERT_BRIMSTONE` 的 `T_SPONTANEOUSLY_IGNITES` 与它的 promote/fire 链，
本轮应当随驱动自然生效。**实测它在真实关卡里会不会烧起来、烧多大**，报出来。

---

## 三、明确不做（写显式留痕测试）

- **接线机器整支**：`TM_IS_WIRED` / `TM_IS_CIRCUIT_BREAKER` / `IS_POWERED` /
  `activateMachine` / `circuitBreakersPreventActivation`——归 **C-4d**。
  `promoteTile` 里那一支写成显式的"未实现"分支并留痕。
- **不放开 C-4a-0 的"每格只有一层非空"**（`setTerrain` 仍清其余三层）；
  但 `promoteTile` / `fillSpawnMap` 按层写入是本轮的正当职责——
  **两者的边界请在报告里讲清楚**，并说明生产路径上不变式是否仍成立、
  若不再成立则 C-4a-0 的那条留痕需要怎么改（它已在允许清单）。
- **不统一通行判据**（C-4a-1）、**不改深水可否进入**（P1-39）、
  **不实现坠落**（C-5）、不实现光效。

---

## 四、文件边界（硬约束）

**允许修改**：
- `src/engine/Map/DungeonFeature.ts` / `DungeonFeatureCatalog.ts` / `TerrainCatalog.ts`
  （后者仅在补 DF 链缺的字段时；已有取值改动要单独报告）
- `src/engine/Map/` 下新增文件
- `src/engine/Core/Game.ts`（**仅**：回合驱动的挂接点、以及 §二.3 里
  web 已有对应事件的那几处触发；**不要重构事件结构**）
- `src/engine/Environment/Gas.ts`（**仅**在火焰/点火与本轮驱动冲突时，
  且必须在报告里论证为什么非改不可）
- `src/test/c_4a_0_layer_model.test.ts`、`src/test/c_4a_terrain_catalog.test.ts`
  （**仅**本轮必然翻转的留痕条目：单层不变式、promote 字段读者白名单；
  其它断言不许动）
- 新增测试文件

**禁止修改**（违反即本轮作废）：
- `src/engine/Map/Grid.ts` / `Connectivity.ts` / `LakeSystem.ts` / `LoopMap.ts` /
  `SafetyMap.ts` / `WaypointMap.ts` / `Scent.ts` / `Pathfinding.ts` / `Pathfind.ts`
- `src/engine/Generator/` 下任何文件
- `src/entities/`、`src/components/`
- **`BrogueCE-master/` 下任何文件**
- 任何 `src/data/*.json`、`src/engine/Random.ts`、`vite.config.ts`
- **`src/test/fixtures/*`** —— baseline **不许刷新**。它若变红，
  说明 promote 漏进了**生成期**（promote 是回合期的事）——**停下来报告**。
- `src/test/harness.ts`、其它既有测试文件

---

## 五、★ 实测影响报告（本轮真正的判据，请写详细）

既有玩法测试可能因行为变化翻红。**红了不许"调整断言让它绿"**——
每一条都要：说清是**回归**还是**CE 正确行为的首次生效**，给 CE 出处，
然后**停下来交给验收方裁决**。

必须报出的测量（真实关卡、多种子）：
1. 每回合平均发生多少次 promote、按地形分类；
2. 硫矿点火的实际发生率与蔓延规模；
3. 哪些地形的 `promoteChance` 在 web 当前内容下**永远不会触发**（死数据）；
4. 接上的触发源各自的实际触发次数；未接的清单与缺失原因；
5. **决定性复验**：同种子同操作序列跑两遍，逐回合状态一致。

---

## 六、测试要求

1. 每条断言必须能在某个具体的错误实现下失败。
2. **对抗性测试至少八条**，必须含：
   - 驱动写成一趟（同回合连锁）
   - `TM_VANISHES_UPON_PROMOTION` 的清层目标写反（DUNGEON 清成 NOTHING）
   - `fireType` / `promoteType` 选错
   - `abortIfBlocking` 传了 true（DOOR→OPEN_DOOR 被优先级挡住）
   - `CAUGHT_FIRE_THIS_TURN` 守卫漏掉
   - 扩散型 promoteChance 的邻居累加写反
   - 合成 DF 条目 `probDec = 0`（应被断言拦住，而不是死循环）
   - 接线分支被误实现（本轮应为显式未实现）
3. **反向验证（强制）**：至少四条真的改坏、贴真实失败输出、还原。
4. 坏层闸门 `p1_26` / `p1_29` / `p1_33` 仍为 0。

---

## 七、门禁

- `npm run build` 绿；`npm test` **除下面这类外全绿**：
  因 CE 正确行为首次生效而翻红的既有玩法测试——**如实保留、逐条申报，不要改绿**。
- `generation_baseline` 应当仍绿；变红即报告。
- 全局超时 300s；重型测试翻红先单跑复核。

**两个已知陷阱**：
1. 深水枚举成员是 **`WATER_DEEP`**，不是 `DEEP_WATER`。写错**不报错**——
   vitest 走 esbuild 只剥类型不检查。**任何让人困惑的失败，先跑 `npm run build`。**
2. 同 seed 的可复现单元是**完整生成链**，不是任意中间层。

**留痕测试的新规矩（`project_conventions.md` 刚立）**：遇到留痕与边界冲突，
**停下来申报，不要把代码扭曲成扫描正则看不见的形态**——那是自造假绿。
本轮允许清单已包含两个必然要翻转的留痕文件。

---

## 八、交付

报告写入 `ai_docs/c_4c_promote_tile_report.md`，必须含：
- `promoteTile` 与两趟驱动的 CE 行号与复核要点；
- **§五 的五项实测**（请写详细，这是本轮的核心交付）；
- 接上/未接的触发源清单与理由；
- 硫矿点火链的实测结论；
- 单层不变式在生产路径上是否仍成立、C-4a-0 那条留痕如何处理；
- 因行为变化而翻红的既有测试**逐条申报**（回归 or CE 首次生效 + CE 出处）；
- 对抗性测试与反向验证的真实失败输出。
