# 修复报告：蓝图宝藏落点（machine center）可能落在墙里 / 被封死

- 日期：2026-09-14
- 对象：`src/engine/Generator/BlueprintEngine.ts`（本轮**唯一**修改的实现文件，+24/−4）
- 新增：`src/test/blueprint_center.test.ts`（回归测试，3 用例）、本报告
- 未触碰：`Architect.ts`、`Game.ts`、`Monster.ts`、`Combat*.ts`、`Player.ts`、`Item*.ts`、
  `Gas.ts`、`Bolt.ts`、`src/data/` 下所有 json、任何已有 `.test.ts`、`vite.config.ts`、`package.json`
- 未执行任何 git 写操作（仅 `git show` / `git diff` 只读）

---

## 1. 缺陷确认与真实机理（比题设更严重）

题设缺陷属实：`findSuitableRoom` 曾把 center 算成 flood-fill region 的**算术质心**，
质心不保证属于 region（L 形/环形/哑铃形房间会落到墙里）。但 52 seed × D1–D26 的实测
表明，center 落格不可通行共有**三条机理**，质心出 region 只是其中之一：

| 机理 | 机理说明 | 修复前出现次数（不可通行违例中） |
|---|---|---|
| A. 质心出 region | 算术质心落在房间外的 GRANITE/WALL 上（题设描述的缺陷） | GRANITE×133 |
| B. 门格与 center 重合 | `doorPos` 取"BFS 序第一个贴墙格"，可与 center 相同；`applyBlueprint` 随后把 `LOCKED_DOOR`/`DOOR` 地形**盖在 center 上**，宝藏被封进门里 | LOCKED_DOOR×157 |
| C. feature 覆盖 center | feature 地形（`key_flood_trap` 的 WATER_DEEP×2–4、`key_lava_moat` 的 LAVA×8–20 等）可落在 center 上；`_random_good_` 等物品 feature 也可落在 center 上 | WATER_DEEP×20（地形类）；宝藏被封锁实例中还有 `_random_good_` 物品与宝藏同格 |

三者同属"算出/使用坐标但未验证（或未保持）其可通行性"，一并修复。

### 题设反例 seed=424242 D22 的真实机理

题设描述"Wand of Fire 落在不可通行格"属实，但该实例的机理是 **B（门盖住 center）**
而非 A（质心出 region）：

```
seed=424242 D22 vestibule_locked center=(61,18) cells内=true 可通行=false terrain=21(LOCKED_DOOR)
seed=424242 D22 vestibule_locked door 与 center 重合（LOCKED_DOOR 会封死宝藏格）
```

## 2. 修复内容（center 选取策略与理由）

全部在 `BlueprintEngine.ts`，零新增随机调用：

1. **center = region 中距质心最近的格子**（平方欧氏距离，BFS 序先到者胜，全确定性）。
   理由：保持原实现"尽量居中"的意图——质心本身仍是目标点，只是落点强制吸附到
   region 内；相比"随便取一个 region 格"或"取 BFS 首格"，视觉/玩法上仍近似房心。
2. **doorPos 候选排除 center**。理由：门地形（尤其 LOCKED_DOOR）盖在 center 上会把
   宝藏封死（机理 B）。door 仍在 region 内、仍贴墙，只跳过 center 这一个格子。
3. **feature 让出 center**：`applyBlueprint` 里把 center 预先加入 `usedCells`，
   feature 地形 / 物品 / 怪物均不再占用 center（机理 C）。
   理由：Game.ts 在 `populateLevel` 阶段把宝藏放在 center，必须保证该格保持可通行。

```diff
 git diff --stat
 brogue-web/src/engine/Generator/BlueprintEngine.ts | 28 ++++++++++++++++++----
 1 file changed, 24 insertions(+), 4 deletions(-)
```

（完整 diff 见 `git diff`，只有三处：center 选取块、door 候选过滤、`usedCells.add` 一行。）

## 3. doorPos 及其他同类坐标的排查结果

- `doorPos`：取自 region（BFS 序第一个贴墙格），**属于 region**，选取本身无题设缺陷；
  但存在机理 B（可与 center 重合）→ 已修。另注：其语义是"房间内贴墙格"而非真正
  "门口"，LOCKED_DOOR 可能落在走廊格上把通路锁死——既有设计问题，与可通行性缺陷
  无关，本轮未动。
- `findFeaturePosition`：只从 `availableCells`（= region 拷贝）取格，无越界坐标；已由
  修复 3 保证不会再取到 center。
- `markPersonalSpace`：只往 `usedCells` 写 key（含出界坐标），不产出任何落点坐标，
  无害。
- `floodFillRoom`：只返回 region 内格子，无问题。
- `BlueprintEngine.ts` 内**没有其他**"算出坐标但未验证可通行性"的落点。
- 附带发现（不在本轮范围，仅记录）：feature 可以覆盖 `doorPos`（doorPos 未从 feature
  候选排除），例如 GRASS 盖掉 LOCKED_DOOR 会使锁室无声解锁——不影响玩家可达性，
  未修；`Game.canMoveTo`（Game.ts:4384-4391）把 CHASM 判为可通行，与
  `Grid.setTerrain` 的 `isPassable` 口径不一致——Game.ts 侧问题，未修。

## 4. Game.ts 消费 center 的现状：没有任何可达性校验

- `Game.ts:684/686`（legacy `machines` 的 scroll_of_enchanting / wand_of_fire）、
  `Game.ts:740/743/746`（trapVaults 的戒指/护符/potion_of_life）：物品直接
  `spawn*({center.x}, {center.y})` 后 `this.items.push`，**放置前后均无连通性/
  可达性校验**（无 flood-fill、无"从楼梯可达"检查）。
- `trapVaults` 现状：`Architect.generateLevel` **从不向 `trapVaults` 填充任何元素**
  （只填 `machines`/`altars`/`machineResults`），因此 Game.ts:727-749 的
  vault 宝藏循环目前是**死代码**，740/743/746 行的戒指/护符/potion_of_life 当前
  实际不可达。本轮按约未新增连通性校验；若未来启用 trapVaults 或新增连通性校验，
  建议与本次"center 必须 ∈ region 且不被后续地形覆盖"的不变量一起纳入。
- `Game.ts:1459` 另有一处 `spawnBlueprintItem`（detail 生成器的 payload 路径），
  不消费 center，与本缺陷无关。

## 5. 新增测试与验收证据

`src/test/blueprint_center.test.ts`，3 用例：

- **a) L 形 region 单元测试**：手造 15 格 L 形房间（质心 (11,12) 确定落在墙格上，
  fixture 自检断言质心 ∉ region），断言返回的 center ∈ region，且 door ∈ region、
  door ≠ center。
- **b) 全局扫描**：多 seed × D1..D26 走真实生成链路（`createHeadlessGame` +
  `generateDepth`，测试侧包装 `BlueprintEngine.prototype.buildMachines` 记录每层
  MachineResult），断言所有 machine 的 center ∈ 自身 cells 且格可通行
  （`Game.canMoveTo` 同源判据），door ∈ cells 且不与 center 重合。
- **c) 宝藏扫描**：同一生成遍历上，断言所有落在 center 上的物品（= 由 center 放置的
  宝藏）落格可通行；并有 `treasuresAtCenter > 0` 非空转护栏。
- 默认 3 个 seed（控制全量套件并行负载）；`BP_CENTER_SCAN_SEEDS` 环境变量可追加
  seed 做大样本统计（本报告数据即用 52 seeds 采集）。用例内还输出每 seed
  D1..D26 的 substantive RNG 抽取总数，作为"生成逻辑是否悄悄改变 RNG 消耗"的常驻哨兵。

### 5.1 反向验证（修复前该测试确实失败）

命令（修复前代码）：

```
BP_CENTER_SCAN_SEEDS=$(seq -s, 100 139) npx vitest run src/test/blueprint_center.test.ts
```

输出尾部（关键行）：

```
× a) L 形 region：返回的 center 必须属于 region（质心落墙的反例）
AssertionError: expected false to be true // Object.is equality
- Expected: true
+ Received: false
 FAIL  … > a) L 形 region：返回的 center 必须属于 region（质心落墙的反例）
× b) 全局扫描（52 seeds × D1..D26）：所有 machine 的 center 都是自身 cells 内的可通行格
AssertionError: expected [ …(812) ] to deeply equal []
× c) 所有落在 machine center 上的宝藏物品，其落格必须可通行
AssertionError: expected [ …(131) ] to deeply equal []
Test Files  1 failed (1)
Tests  3 failed (3)
```

seed=424242 D22 反例在修复前输出中复现（见 §1）。

### 5.2 全局扫描统计（52 seeds × D1–D26 = 1352 层）

修复前（同一命令）：

```
[bp-center] 扫描 52 seeds × 26 层 = 1352 层，共 6337 台 machine，center 违例 593 台
（涉及 487 层；不属于自身 cells：423，落格不可通行：310）
；不可通行 terrain 分布：LOCKED_DOOR×157, GRANITE×133, WATER_DEEP×20
[bp-center] center 上共见到 2414 件宝藏（wand_of_fire×2255 …）；违例 131 件，涉及 120 层
```

即：**36% 的层（487/1352）至少有一台 machine 的 center 违例；310 台 machine 的
center 落在不可通行格；131 件 center 宝藏被封锁在 120 层里**（其中含题设的
seed=424242 D22）。

修复后（同一命令、同 seed 集）：

```
[bp-center] 扫描 52 seeds × 26 层 = 1352 层，共 6330 台 machine，center 违例 0 台
（涉及 0 层）；不可通行 terrain 分布：（无）
[bp-center] center 上共见到 2363 件宝藏：wand_of_fire×2311, ring_of_stealth×1, …；违例 0 件
```

machine 总数 6337→6330 属预期：feature 落点移动改变后续房间地形，级联影响后续
machine 房间的准入判定（见 §6）。

## 6. 实现是否改变 RNG 消耗

- **改动点零新增随机调用**：center 选取、door 过滤、`usedCells.add` 均为纯算术/集合
  操作（diff 可证）。`shuffleList`/`randRange` 的调用序列在改动点本身不变。
- **但同 seed 的抽取总数改变了**（52 seeds 实测 52/52 不同，约 ±0.04%–9%，例如
  seed=424242：154289 → 152430）。原因是级联效应：feature 落点移动 → 地图内容变化 →
  后续 `findSuitableRoom` 的 flood-fill 区域与准入判定变化 → machine 生成数变化 →
  后续所有随机决策（选蓝图、feature 数量、怪物/物品）整体移位。
- 结论与题设预告一致：**既有地形指纹类测试仍然通过**（smoke b 比较的是同一次运行内
  两次生成的一致性，两侧同步移位），**但此前记录的基线表（同 seed 地形指纹、怪物
  分布等）自本轮起失效**，需要重建。
- 新测试用例 b 已内置每 seed 的 RNG 抽取总数日志，后续任何改动若再改变消耗会被
  立即看到。

## 7. 验收运行

- `npm run build`：**通过**（exit 0，仅既有 chunk>500kB 警告），输出尾部见附录 B。
- `npm test`：**最终全绿** —— `Test Files 23 passed (23)，Tests 202 passed | 5 todo`
  （= 原有 199 全数保留 + 新增 3 用例），输出尾部见附录 A。
  过程说明：本轮采集数据期间（08:05–09:15）机器整体变慢约 50%（同一命令同一代码
  4.19s → 6.25s），使两条**既有**的 5s 默认超时悬崖用例
  （`monster_stats_effect`、`monster_damage_balance`）与 `horde_terrain_spawn`
  间歇性超时，且在**未修改的 HEAD 基线配置**上同样复现（对照实验 A/B 见 §7.2）；
  机器恢复后（09:17）全量套件一次通过。该 flake 为既有问题、与本次修复无关，
  但值得后续单独排期（给悬崖用例显式放宽超时，或按 P1-13 报告的根治方向收编
  `Math.random()`）。

### 7.1 npm test 最终输出尾部（全绿）

```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  23 passed (23)
      Tests  202 passed | 5 todo (207)
   Start at  09:17:09
   Duration  11.82s (transform 1.31s, setup 0ms, import 2.62s, tests 29.01s, environment 4ms)
```

新增用例在大样本下的独立运行（`BP_CENTER_SCAN_SEEDS=$(seq -s, 100 139)`，52 seeds）：

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
[bp-center] 扫描 52 seeds × 26 层 = 1352 层，共 6330 台 machine，center 违例 0 台
（涉及 0 层）；不可通行 terrain 分布：（无）
[bp-center] center 上共见到 2363 件宝藏：wand_of_fire×2311, …；违例 0 件，涉及 0 层
```

### 7.2 机器劣化期的对照实验（证明间歇超时与本次修复无关）

- **对照 A**：`git show HEAD:…BlueprintEngine.ts` 覆回原文件 + 移走本报告新增测试
  文件（= 本轮开工前基线配置）→ 全量套件同样超时失败：
  `Tests 2 failed | 197 passed`（monster_stats_effect 10499ms、
  horde_terrain_spawn 5000ms 超时）。随后已恢复修复版文件与新测试文件。
- **对照 B**：HEAD 引擎下 `npx vitest run src/test/monster_stats_effect.test.ts`
  隔离运行 = 6275ms 超时；修复引擎同刻隔离运行 = 6250ms —— 两者相等，
  证明劣化来自机器状态（该用例当日 08:05 曾以 4.19s 通过）。

## 8. 与预设不符之处 / 环境事项（只列不修）

1. **题设机理归因不完整**：seed=424242 D22 的 Wand of Fire 确实不可达，但机理是
   "门地形盖住 center"（B），不是"质心出 region"（A）。A 机制真实存在
   （GRANITE×133），但只占不可通行违例的 43%。
2. **缺陷面远大于"个别 seed"**：52 seed 扫描显示 593/6337 台 machine center 违例、
   487/1352 层受影响、131 件宝藏被封锁——这是高概率事件，不是边角案例。
3. **trapVaults 是死代码**：Architect 从不填充，Game.ts:740/743/746 的
   戒指/护符/potion_of_life 落 center 路径当前不可达（题设把这 5 类宝藏并列，
   实际只有 scroll_of_enchanting / wand_of_fire 在真实路径上）。
4. **machine center 宝藏的实际主力是 wand_of_fire**：修复前 2414 件 center 宝藏中
   2255 件是 wand_of_fire（含 `_random_good_` 物品 feature 落在 center 的部分），
   scroll_of_enchanting 极少（`rng.randPercent(50)` 之外的走 wand 分支且命中
   同一批 machine）。
5. **既有 5s 超时悬崖 flake（环境性，非本修复引入）**：`monster_stats_effect.test.ts`
   在 P1-13 中样本翻倍后单测耗时 ~4.4s，贴着 vitest 默认 5000ms 超时线，且其模拟含
   未播种 `Math.random()`（P1-13 报告已记录），运行时长本身是随机变量。本报告
   采集当日，该用例在本机**隔离运行**也多次超过 5s（4.2s → 6.2s 随时间恶化），
   且在**未修改的 HEAD 基线配置**上同样复现超时（对照实验 A/B，见 §7.2）。属机器
   状态（18 天未重启、桌面负载）导致的环境性 flake，同类的还有
   `monster_damage_balance` 与 `horde_terrain_spawn`（后者已自带 180s 超时，偶发）。
6. `Game.canMoveTo` 把 CHASM 判为可通行、`Grid.setTerrain` 却把 CHASM 标为不可
   通行，两套口径不一致（Game.ts/Grid.ts 侧，未修）。
7. feature 可覆盖 `doorPos`（可能无声解锁 LOCKED_DOOR 房间），语义问题非可通行性
   问题，未修（见 §3）。

---
## 附录 A：npm test 各次全量运行记录（当日，机器状态先劣化后恢复）

| 时刻 | 结果 | failed 明细 |
|---|---|---|
| 07:41（本轮开工前基线） | 199 passed 全绿 | —（机器空闲） |
| 08:04（修复后，新测试默认 12 seed） | 201 passed / 1 failed | monster_stats_effect 超时（5585ms） |
| 08:26（对照 A：HEAD 引擎 + 无新测试文件） | 197 passed / 2 failed | monster_stats_effect 10499ms、horde_terrain_spawn 超时 |
| 08:47–08:59（对照 B 后多次重试） | 199–200 passed / 2–3 failed | monster_damage_balance（5204–7142ms）、monster_stats_effect（13921–16102ms）、horde_terrain_spawn（6260ms）等既有用例轮换超时 |
| **09:17（机器恢复后最终运行）** | **202 passed | 5 todo 全绿** | — |

超时 failed 全部是"既有重型用例 × vitest 默认 5000ms 超时"的环境性悬崖
（对照 A/B 证明与本次 diff 无关），无任何断言失败；机器恢复后一次通过。

## 附录 B：npm run build 输出尾部

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

（transform/chunk 日志省略）
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.37s
```

（构建 exit 0；chunk 大小警告为本轮开工前即存在的既有提示。）
