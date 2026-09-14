# P2-0 报告：把未播种的 Math.random() 收编进项目 RNG

日期：2026-09-14
状态：完成，全部验收条款自测通过
本轮性质：P2（tick 制时间系统）的前置轮次，独立移动 RNG 流以便归因

---

## 0. 结论概览

- **A（Monster.ts 4 处游走/混乱移动）** → 改走 `RNG_SUBSTANTIVE`（`rng.randPercent(70/20)` + `rng.randRange(0, dirs.length-1)`）。
- **B（GameCanvas.vue 幻觉渲染 9 处取数）** → 改走 `RNG_COSMETIC`，以导出的 `cosmeticPercent` / `cosmeticPick` 封装，try/finally 保证用完必切回。
- **C（Creature.ts 实体 id、Item.ts 物品 id）** → 改为**模块级单调递增计数器**（两者共用一个序列），`Game.loadSnapshot` 开头把计数器推到存档最大 id 之上。
- 生产代码（`src/` 下非测试 .ts/.vue）已**零** `Math.random(` 调用，并由新增的源码扫描守卫测试永久看护。
- `npm test`：25 个测试文件 **214 passed | 5 todo**，全绿（含既有全部测试，无一修改）。
- `npm run build`：全绿。
- **RNG 流确认移动**：5 个测试 seed 的 D1 地形指纹**全部改变**，怪物/物品分布重排，此前基线表失效（详见 §5）。

---

## 1. 三类位置的处理方式与理由

### A. Monster.ts（4 处 → SUBSTANTIVE）

`takeTurn` 内两处游走分支（confused 70% 判定 + 随机方向；WANDERING 20% 判定 + 随机方向）：

- `Math.random() < 0.7` → `rng.randPercent(70)`；`Math.random() < 0.2` → `rng.randPercent(20)`
- `dirs[Math.floor(Math.random() * dirs.length)]` → `dirs[rng.randRange(0, dirs.length - 1)]`

理由：这些决策直接决定怪物走到哪、什么时候撞见玩家，属于玩法后果，必须落在可复现的
SUBSTANTIVE 流上（对应 CE 中 `rand_range` 全部走 `rogue.RNG` 当前流的做法）。
判定与方向两次抽取的先后顺序保持与原实现一致。

### B. GameCanvas.vue（9 处 → COSMETIC）

提示词写"8 处"，实际列出的 9 个行号对应 **9 处 `Math.random()` 调用**（3 组幻觉判定各带 1~2 次挑选）：

| 位置 | 原调用 | 改后 |
|---|---|---|
| 地块幻觉（render 内） | `< 0.15` + 挑颜色 + 挑字符 ×2 | `cosmeticPercent(15)` + `cosmeticPick` ×2 |
| 物品幻觉 | `< 0.30` ×2 + 挑颜色 | `cosmeticPercent(30)` ×2 + `cosmeticPick` |
| 怪物幻觉 | `< 0.35` + 挑颜色 + 挑字符 ×2 | `cosmeticPercent(35)` + `cosmeticPick` ×2 |

理由：渲染取数次数取决于帧率/窗口大小/玩家是否在看，放进 SUBSTANTIVE 会让玩法随渲染
漂移（比现状更糟），留在 `Math.random()` 则玩法不确定（现状）。CE 对幻觉/闪烁类视觉
效果正是切到 COSMETIC 流处理（`IO.c` 的 `shuffleTerrainColors` 等 20 余处
`assureCosmeticRNG; ... restoreRNG;`），故对齐之。

实现形态：两个辅助函数放在 GameCanvas.vue 的普通 `<script lang="ts">` 块中导出，
`<script setup>` 的 render 闭包直接调用；导出是为了让测试直接断言"渲染不污染玩法流"。
幻觉未激活时因 `hallucinating &&` 短路不消耗任何随机数（与原行为一致）。

### C. Creature.ts / Item.ts（id → 计数器）

- `Creature.ts:24` 的 `Math.floor(Math.random() * 1000000)` 与 `Item.ts:58` 的
  `rng.randRange(1, 100000000)` 都改为模块级单调递增计数器 `allocateEntityId()`
  （Creature.ts 定义并导出，Item.ts 引用同一序列，怪物/物品 id 在同一命名空间内唯一，
  与快照结构一致——存档里装备引用就是物品 id）。
- 理由：id 只需唯一。用 RNG 生成 id 意味着**每创建一个实体就消耗一次玩法随机数**
  （Item 原实现正是这样，每件物品烧掉一次 SUBSTANTIVE 抽取），一层几十只怪 + 几十件
  物品的创建会显著挪动玩法流。
- 注意：Creature 原先用 `Math.random()`，本来就不占 seed 流，改计数器对玩法流是
  **中性**的（只消灭了未播种源）；Item 原先用 `rng.randRange`，改计数器会**减少**
  流消耗，是本轮流移动的成因之一（见 §5）。

---

## 2. `setRNG` 的正确成对用法（含是否需要恢复）

CE 的宏（`Rogue.h:1282-1283`）：

```c
#define assureCosmeticRNG   short oldRNG = rogue.RNG; rogue.RNG = RNG_COSMETIC;
#define restoreRNG          rogue.RNG = oldRNG;
```

即**保存旧流类型 → 切 COSMETIC → 用完必须恢复**，二者成对出现
（实证：`IO.c:974` 的 `shuffleTerrainColors` 在函数开头 `assureCosmeticRNG;`、
结尾 `restoreRNG;`，IO.c 全文件 20+ 处成对使用；也有少量被注释掉的未成对调用点，
说明 CE 作者同样把它当作"必须成对"的纪律）。

web 侧对应实现：

```ts
export function cosmeticPercent(percent: number): boolean {
    rng.setRNG(RNGType.RNG_COSMETIC);
    try {
        return rng.randPercent(percent);
    } finally {
        rng.setRNG(RNGType.RNG_SUBSTANTIVE);   // 必须切回，try/finally 保证异常路径也恢复
    }
}
```

**必须切回**。一个实现细节：`Random.ts`（本轮禁改）的 `currentRNG` 是 private 且无
读取接口，因此无法照抄 CE 的"存 oldRNG 再恢复"，只能显式恢复到 `RNG_SUBSTANTIVE`。
语义等价性论证：当前代码中调用 `setRNG` 的位置只有这一对辅助函数，且渲染从不嵌套
在其它 COSMETIC 段内执行，故"恢复到 SUBSTANTIVE"与 CE 的"恢复到 oldRNG"在本项目
现状下严格等价。若未来出现嵌套 COSMETIC 段，需先给 Random.ts 补读取接口（超本轮边界）。

测试侧通过两条断言把"忘了切回/误用 SUBSTANTIVE"都堵死：
1. 大量调用辅助函数前后 `rng.randomNumbersGenerated`（SUBSTANTIVE 计数）不变；
2. 辅助函数调用后紧跟的 SUBSTANTIVE 抽取序列与干净 seed 流逐值一致
   （若忘了切回，后续"SUBSTANTIVE"抽取实际吃的是 COSMETIC 状态，序列必然偏离）。

---

## 3. 实体 ID 计数器与存档的衔接方案

```ts
// Creature.ts（模块级）
let nextEntityId = 1;
export function allocateEntityId(): number { return nextEntityId++; }
export function ensureEntityIdAbove(maxInUseId: number): void {
    if (nextEntityId <= maxInUseId) nextEntityId = maxInUseId + 1;
}
```

```ts
// Game.ts loadSnapshot() 开头（重建任何实体之前）
ensureEntityIdAbove(Math.max(
    0,
    ...snapshot.monsters.map((m) => m.id),
    ...snapshot.items.map((it) => it.id),
    ...snapshot.player.inventory.map((it) => it.id)
));
```

- 存档的 id 命名空间 = 怪物 + 地面物品 + 背包物品（装备引用 `equippedWeaponId/
  equippedArmorId/equippedRingId` 都指向背包物品 id，被后两者覆盖），取三处并集的
  最大值即可。
- 放在重建实体**之前**：`loadSnapshot` 内部 `new Player/new Monster/new Item` 会先
  分配到高于存档最大 id 的"脚手架 id"，随后被快照 id 覆盖，最终计数器仍停在存档
  最大 id 之上，读档后新建实体（含 `spawnPeriodicHorde` 刷出的怪）必然全新。
- 对"旧存档（id 来自更早进程、可能远超当前计数器）"与新存档两种情形都成立；
  测试用"敌意存档"（把存档 id 重编号到恰好覆盖计数器即将发出的号段）验证了没有
  同步时必撞号、有同步时全避开（见 §4 测试清单第 4 条）。

---

## 4. 新增测试（`src/test/p2_0_seeded_rng.test.ts`，6 条）

| # | 测试 | 对抗的错误实现 |
|---|---|---|
| 1 | 同 seed 同操作序列连跑两次，**逐回合**怪物位置/HP/状态轨迹 + 数量 + 回合数完全一致 | 游走留在 `Math.random()`（反向验证见 §4.1） |
| 2 | 两次运行分别插入每回合 7 个 / 23 个 COSMETIC 消耗（模拟帧率差异），玩法轨迹仍一致 | 游走误用 COSMETIC 流 |
| 3 | 1000 组渲染取数后 SUBSTANTIVE 计数不变；穿插渲染取数后的玩法抽取与干净 seed 流逐值一致 | 渲染误用 SUBSTANTIVE / 忘了切回 |
| 4a | 2000×2 个实体连续创建，id 无重复 | id 生成有碰撞 |
| 4b | 敌意存档（id 恰好覆盖计数器号段）读档后，新建实体 id 全新、存档实体 id 保真 | 读档未同步计数器 |
| 5 | 源码扫描：`src/` 下（测试除外）不得出现 `Math.random(` | 任何回退到未播种源 |

测试基建说明（不改 src 的前提下的两个变通）：
- vitest(node) 无法静态导入 GameCanvas.vue（其依赖 `Input.ts` 的模块级单例在构造时
  访问 `window`），测试先 `vi.stubGlobal('window', ...)` 再动态导入，只为取到
  `cosmeticPercent/cosmeticPick`；
- 测试文件需 `/// <reference types="node" />`（`vue-tsc -b` 会类型检查测试文件，
  而项目 tsconfig 未含 node types；tsconfig 不在允许修改清单内）。

### 4.1 反向验证（改动前测试确实失败）

把 Monster.ts 两处游走临时改回 `Math.random()`（其余改动保持），只跑 A 组：

```
 ❯ src/test/p2_0_seeded_rng.test.ts (6 tests | 2 failed | 4 skipped) 233ms
     × 同 seed 同操作序列连跑两次，逐回合怪物位置/HP/数量完全一致 43ms
     × 两次运行插入不同量的 COSMETIC 消耗，玩法结果仍一致（游走不得用 COSMETIC 流） 34ms
AssertionError: expected [ …(60) ] to deeply equal [ …(60) ]
AssertionError: expected [ …(60) ] to deeply equal [ …(60) ]
 Test Files  1 failed (1)
      Tests  2 failed | 4 skipped (6)
```

恢复修复版后同组 2 条通过。临时回退已完全移除（diff 复核无 `REVERT-FOR-VERIFICATION`
残留）。

**测试设计修正记录**：第一版只比"终局快照"，反向验证时未分歧行（60 回合后游走怪
恰好收敛到同一格，端点比对漏报）；改为逐回合轨迹录制后稳定失败。教训：确定性断言
要比轨迹，不能只比终点。另一处修正：比对快照里不能含实体 id——id 来自进程级计数器，
同进程两次建局必然不同，比对它会把"计数器前进"误判为"玩法分歧"（修复后实测：
两次运行位置/HP 完全一致，仅 id 不同，证明引擎行为与 id 值无关）。

---

## 5. RNG 流变动的量化影响

### 5.1 地形指纹（`harness.terrainFingerprint`，生成后立即取）

| seed | 改动前 | 改动后 | 变化 |
|---|---|---|---|
| 20260914（D1 主测） | `332de099:4633` | `e7d88213:4694` | **变** |
| 1 | `0bdbadb4:4620` | `757b5338:4684` | **变** |
| 42 | `912b13f0:4683` | `72ff785c:4670` | **变** |
| 2026 | `f0d19429:4701` | `69bdbfee:4683` | **变** |
| 999999 | `10b83aff:4612` | `ac0f623f:4767` | **变** |

5/5 全变（且串长后缀也变，说明是内容不同而非哈希碰撞）。**此前记录的基线表全部失效。**
成因：开局道具包物品创建发生在层生成早期，每件物品省掉的 1 次 id 抽取使后续全部
抽取错位，整层（含怪物/物品/机器地形）重排。

### 5.2 D1（seed 20260914）怪物/物品分布

- 改动前：8 只怪（Rat×5、Kobold×2、含 1 只变异；id 为 6 位随机数）；地面物品 2 件
  （Leather Armor、Wand of Teleportation）+ 背包 4 件。
- 改动后：6 只怪（Rat、Jackal×2、Kobold×3；id 38~43）；地面物品 4 件
  （Potion of Strength、Scroll of Teleportation、Potion of Invisibility、Dagger）
  + 背包 4 件。
- 60 回合后：改动前存活 1 只；改动后存活 5 只（玩家行为流同步移动，战斗过程不同）。

### 5.3 SUBSTANTIVE 抽取计数

- 生成期：3053 → 3677（层内容本身不同，不可逐项归因；结构性变化 = 每件物品创建 −1 次、
  每只实体创建 id 不再耗流、游走/混乱判定每怪每回合 +1~2 次）。
- 60 回合游玩期：177 → 142 次（同理，构成已变）。

### 5.4 既有测试的影响

"同一次运行内两次生成一致"类的地形指纹测试**全部通过**（全量 214 passed 佐证），
未修改任何既有测试。

---

## 6. 验收条款逐条对照

| 条款 | 结果 | 证据 |
|---|---|---|
| 1. 同 seed 同操作序列两跑，怪物位置/HP/数量完全一致；改动前应失败（反向验证） | ✅ | §4.1：改动前 2 条失败输出；改动后通过 |
| 2. 幻觉渲染前后 `rng.randomNumbersGenerated`（SUBSTANTIVE）不变 | ✅ | 测试 #3（另加干净流逐值比对，堵"忘切回"） |
| 3. 大量实体 id 无重复；读档后新建 id 不与存档冲突 | ✅ | 测试 #4a/#4b |
| 4. `npm test` 全绿，原 207 passed 不得减少 | ✅ | 214 passed \| 5 todo；存量 = 214 − 6（本轮新增）= **208 ≥ 207**，既有测试零修改（见 §8.3 的 +1 说明） |
| 5. `npm run build` 全绿 | ✅ | §8.2 |
| 报告含三类处理、setRNG 用法、id 衔接、反向验证、流变动量化 | ✅ | §1~§5 |

---

## 8. 固定要求输出

### 8.1 `npm test` 输出尾部（最终版）

```
> brogue-web@0.0.0 test
> vitest run

 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  25 passed (25)
      Tests  214 passed | 5 todo (219)
   Start at  10:30:20
   Duration  13.82s (transform 1.42s, setup 0ms, import 2.96s, tests 38.01s, environment 5ms)
```

### 8.2 `npm run build` 输出尾部

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

dist/assets/WebGLRenderer-DSRKOsE-.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-BlVTZkwZ.js               886.67 kB │ gzip: 281.50 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit via build.chunkSizeWarningLimit.
✓ built in 1.39s
```

（chunk 体积告警为既有提示，非本轮引入。）

### 8.3 `git diff --stat`

本轮改动（5 个允许文件 + 1 个新增测试）：

```
 brogue-web/src/components/GameCanvas.vue | 48 ++++++++++++++++++++++++++------
 brogue-web/src/engine/Core/Game.ts       | 16 +++++++++--
 brogue-web/src/engine/Items/Item.ts      |  6 ++--
 brogue-web/src/entities/Creature.ts      | 18 +++++++++++-
 brogue-web/src/entities/Monster.ts       |  8 +++---
 5 files changed, 77 insertions(+), 19 deletions(-)
 新增：src/test/p2_0_seeded_rng.test.ts（未跟踪文件）
```

**注意**：工作区同时存在**不属于本轮**的未提交改动（本轮未触碰）：

```
 brogue-web/ai_docs/invented_content_pool_report.md | 162 ++++++++++-----------
 brogue-web/src/data/consumables.json               |   1 +
 brogue-web/src/test/invented_content_pool.test.ts  | 96 +++++++++++-
```

以及 `Game.ts` 中一处本轮之前已存在的 hunk（约 3056 行，runic 列表改为
`ItemLoader.GENERATED_*_RUNICS`，属自创内容轮次）。本轮在 Game.ts 的改动仅为
§3 所示的 import 行与 `loadSnapshot` 计数器同步块。

---

## 9. 与预设不符之处（只列不修）

1. **"GameCanvas.vue 8 处幻觉渲染"**：按提示词所列 9 个行号，实际是 **9 处**
   `Math.random()` 调用（3 组判定 + 6 次挑选），已全部收编。
2. **"原有 207 passed"**：本轮全量 214 passed，减去新增 6 条 = 存量 208。既有测试
   零修改，208 与 207 的 +1 差异无法由本轮解释，推测提示词基线数略旧。
3. **工作区预存他轮改动**：`consumables.json`、`invented_content_pool_report.md`、
   `invented_content_pool.test.ts` 与 Game.ts 的 runic 列表 hunk 在本轮开工前/外
   已处于修改状态（开场 git 快照即含 Game.ts 与 consumables.json），本轮严格未触碰。
4. **`Random.ts` 无法读取当前流类型**：`currentRNG` 为 private 且无 getter，而
   Random.ts 禁改，故 COSMETIC 段只能显式恢复到 SUBSTANTIVE 而非 CE 式"恢复到
   oldRNG"。现状下严格等价（论证见 §2），但若未来出现嵌套 COSMETIC 段则不再成立。
5. **测试基建事实**：vue-tsc 会类型检查测试文件但 tsconfig 不含 node types，测试文件
   需要 `/// <reference types="node" />`；vitest(node) 静态导入 GameCanvas.vue 会因
   Input.ts 的 window 依赖崩溃，需 stub + 动态导入（见 §4）。

### 边界外发现（只列不修）

- `Monster` 构造器以 `rng.randPercent(70)` 决定初始睡眠态，而 `loadSnapshot` 重建
  怪物时会走该构造器——即**读档本身消耗并移动 SUBSTANTIVE 流**。既有行为，本轮
  未改；P2 做 tick 系统时若要求"读档后流位置与存档时点一致"，需一并处理
  （例如快照保存流状态，或读档路径改用免抽取构造）。
- `tryMoveTo` 的网困 50%/破网 20% 等已走 `rng`，与本次改造方向一致，无需处理。

## 10. 临时产物清理

- 量化用临时测试 `zz_scratch_quant.test.ts`、vue 导入探测 `zz_scratch_vue.test.ts`
  已删除；反向验证的临时回退已还原并复核 diff。工作区本轮净新增仅
  `src/test/p2_0_seeded_rng.test.ts` 与本报告。
