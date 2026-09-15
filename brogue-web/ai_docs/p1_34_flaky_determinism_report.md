# P1-34 报告：`p4_9_safety_map` 间歇性翻红——定位与根治

日期：2026-09-15　分支：`round/p1-34`（独立 worktree）
改动：`src/engine/Core/Game.ts`（+8 行）、新增 `src/test/p1_34_loopmap_reset.test.ts`

---

## 0. 结论（TL;DR）

**真因**：`Game` 构造器会以**当前时间**（秒级精度）为种子先跑一次 **normal 模式**生成，
其末尾把 `analyzeLoopMap(grid)` 写进实例字段 `loopMap`。随后 harness / UI 调
`startNewGame({ mode: 'test' })`，走 `generateTestDepth` **提前 return**，从不重算
`loopMap`——于是 **test 局带着上一个 normal 局（构造器那次随机生成）的陈旧环路图**。
C-0 起 `buildSafetyMap` 的 `isInLoop` 已由 `loopMap` 供数（IN_LOOP −=10 分支激活），
safety map 因此吃到一套与当前网格毫无关系的、**逐进程随机**的环路集合。

**为什么"间歇"**：时间种子取 `Math.floor(Date.now()/1000)`——**同一秒内**构造的
Game 共享同一张陈旧 loopMap（测试全绿），**跨过秒边界**则不同（T7 两次 `run()`
分叉、T2 的 `m[43][15]` 从 −0 变成 −10）。翻红率 ≈ P(陈旧环路格落入断言关键区)
≈ 20–30%，与实测吻合。

**修法**：在 `generateTestDepth` 里补上 `this.loopMap = analyzeLoopMap(this.grid)`
（与 normal 路径的"loopMap = 当前层网格的重算结果"不变式对齐）。`analyzeLoopMap`
是纯函数、零 RNG 消耗，不移动随机流。**T2/T7 断言一字未动。**

---

## 1. 二分定位过程（按实际时间线）

### 1.1 理论排查全部落空

先读 T7/T2 源码与整条回合链路（`Game.handlePlayerAction → playerTurnEnded →
advancementLoop → Monster.takeTurn → getSafetyMapForMonster → buildSafetyMap`），
逐一检查模块级状态，全部干净：

| 嫌疑 | 实测 | 结论 |
|---|---|---|
| vitest 跨文件状态泄漏 | vite.config.ts 无 isolate 配置，vitest 4 默认按文件隔离 | 结构上不可能 |
| `Math.random()` 未播种随机 | 全引擎 grep 零命中（P2-0 已收编；常识文档 1.4 节的 Monster.ts/Creature.ts 行号已过期） | 排除 |
| 第二个 RNG 实例 | 全仓只有 `Random.ts` 的 `rng` 单例，每次 `startNewGame` 重播种 | 排除 |
| `EventBus` 单例残留 | 全项目**无任何** `on/emit` 调用点，纯死代码 | 排除 |
| `timeSystem` / `logger` | `startNewGame` 均重置 | 排除 |
| `Date.now()` 参与逻辑 | 仅录音/动画锁/快照 `savedAt`，headless 同步路径（`animationEnabled=false`）不触及 | 排除 |
| WaypointMap / Scent / SafetyMap 模块级缓冲 | 三者均为每局实例状态或纯函数；`isolateRngDuring` 快照/恢复对称 | 排除 |
| 模块级可变计数器 | 仅 `nextEntityId`（Creature.ts:33）与 `nextMachineNumber`（BlueprintEngine.ts:103），均不影响生成决策 | 排除 |

### 1.2 复现：推翻"仅全量才红"的前提

- 单文件循环 8 次：**红 1 次**。任务书"单独跑该文件则稳定全过"不成立——
  单跑只是概率更低。这直接把搜索空间从"跨文件/跨进程"缩小到"**进程内逐秒漂移**"。
- 修复前全量连跑 6 次：**红 3 次**（RUN 2/4/6），三次全是 T2 同一断言
  `expect(m[43]![15] === 0).toBe(true)`（p4_9_safety_map.test.ts:195）。
  `−0 === 0` 恒真，说明该格实际值是**非零的其它值**（后证实为 −10，即环路惩罚）。

### 1.3 探针实验：锁定 loopMap

写临时探针测试跨进程转储 T2 舞台的全部输入（30 进程 + 10 进程×6 局两轮）：

- 雕刻后地形指纹 30/30 完全一致（`39b2b39f:4599`）；**雕刻前**指纹跨 10 进程 60 局
  也完全一致（`6aa09fbe:4614`）；
- `rng.randomNumbersGenerated` 恒 41；Math.random 调用数恒 0；
- **`game.loopMap` 在雕刻区内的 true 格数逐进程剧烈波动：14～48 个**；
  9/30 进程的走廊 y=15 上出现环路格，`m[43][15]` 恰在含 (43,15) 的 6 次中变 −10；
- 同一进程内连建 6 局完全一致，但 10 进程中有 2 个进程出现"局间不一致"；
- 对同一 grid **当下重算** `analyzeLoopMap`：与 `game.loopMap`（创建时存储）在
  10/12 进程中**不一致**——存储值根本不是当前网格的分析结果；
- terrain+isBurning 复合指纹全图唯一 → 排除 grid 本身差异与火格干扰。

### 1.4 收敛到根因

`game.loopMap` 与当前网格脱钩，唯一可能：它是在**另一份网格**上算的。
查调用点：`analyzeLoopMap` 只在 `generateDepth` 的 **normal 分支末尾**
（Game.ts:674）执行；而 **test 分支在 Game.ts:591-599 提前 return**，
`generateTestDepth` 从头到尾不碰 `loopMap`。

链路还原：

1. `createHeadlessGame` → `new Game()` → 构造器 `startNewGame()`（无参 →
   **normal + 时间种子**，Random.ts:72 `seed = Math.floor(Date.now()/1000)-1352700000`）
   → 生成随机地牢 → `loopMap = analyzeLoopMap(随机地牢)`（Game.ts:674）；
2. harness 随后 `game.startNewGame({ seed, mode: 'test' })` →
   `generateTestDepth` 换了全新 grid，但 **`loopMap` 原封不动**；
3. `buildSafetyMap` 的 `isInLoop` 读到这套陈旧环路 → T2 的解析解、T7 的
   决定性 hash 全部被逐秒漂移的随机量污染。

同机制完美解释所有历史观察：

| 历史观察 | 解释 |
|---|---|
| 验收方"连跑 6 次同场景 hash 完全稳定" | 6 次在同一秒内跑完 → 六个 Game 的构造器拿到**同一个**时间种子 → 陈旧图相同 |
| 验收方"T7 探针测不到" | 探针不跑回合、且耗时极短，几乎不跨秒；跨秒才分叉 |
| 单跑"稳定"绿、全量约 30% 红 | 单跑整个文件 ~0.5s，常落在同一秒内；全量机器热身后文件更分散。实测单跑也有 1/8 红（1.2 节） |
| 任务书里的 T7 失败 `expected 967921860 to be 16587880` | 两次 `run()` 的 Game 构造跨了秒边界 → 两张不同的陈旧 loopMap → 两个 hash |
| T2 红时 `m[43][15]` ≠ ±0 | (43,15) 被陈旧环路格命中：f(1)=0 → 0×(−3)=−0 → **−0−10 = −10** |

---

## 2. 修法与理由

`src/engine/Core/Game.ts` `generateTestDepth`（+8 行）：

```ts
this.scent = new ScentMap(DCOLS, DROWS);
// P1-34：loopMap 必须随层重算。……（注释见 diff）
this.loopMap = analyzeLoopMap(this.grid);
```

- **为什么重算而不是 `emptyLoopMap()`**：与 normal 路径（Game.ts:674）保持同一
  不变式——"loopMap 恒等于当前层网格的 `analyzeLoopMap` 结果"（C-0 B4 已把该
  契约写成测试）。若未来 test 舞台长出环形地形，仍然自洽。
- **为什么安全**：`analyzeLoopMap` 纯函数、不消费 RNG（LoopMap.ts 头注及 C-0
  报告），**不移动随机流**，地形指纹/生成基线不受影响（10.3 节 10 连跑佐证）。
- **为什么不改 `Random.ts` / Generator / 测试断言**：真因是单例残留式状态泄漏
  （本次是实例字段跨模式泄漏），按任务书"若真因是某个单例未重置，就重置它"执行；
  T2/T7 断言**零改动**。

### 2.1 回归守卫（新增 `src/test/p1_34_loopmap_reset.test.ts`）

- **T1（决定性锚点）**：normal 局 seed 42 → 前提断言"该局确有环路"
  （实测 44 格；特意选了非空种子——seed 777 的 normal 局恰好 **0** 格，用它会让
  错误实现下"残留全 false"巧合蒙混过关）→ `startNewGame({mode:'test'})` →
  全图逐格对比 `game.loopMap` 与 `analyzeLoopMap(game.grid)`。
  错误实现下必红（残留 44 格 ≠ 空竞技场）。
- **T2（harness 出生态）**：`createHeadlessGame(seed,'test')` 直接复现构造器
  残留路径（seed 1 / 20260915），同一契约全图对比。
- 两类断言都只加强：修复后契约是"loopMap 与网格自洽"，不硬编码"全 false"。

### 2.2 反向验证（按 5.2 约定）

把修复行临时注释（错误实现）后重跑新回归测试（真实输出节选）：

```
FAIL  T1 模式切换：normal 局（seed 42，该局确有环路）切 test 后 loopMap 必须与新层网格自洽
AssertionError: expected [ '37,15', '37,16', '37,17', …(41) ] to deeply equal []
```

44 个陈旧环路格被抓现形。还原修复后同一测试绿。随后删除临时禁用标记复核 diff。

---

## 3. 为什么"单跑不红、全量红"——任务书前提的修正

该前提**不成立**：单文件循环 8 次红 1 次（1.2 节）。真实机制与"单跑/全量"无关，
只与**秒边界**有关：文件内 9 次 `createHeadlessGame`（T1–T8）若全部落在同一秒，
九个 Game 共享同一张陈旧 loopMap → 自洽 → 绿；一旦跨秒，T7 的两次 `run()` /
T2 与此前测试就拿到不同的随机环路集合 → 红。单跑更快（~0.5s）、跨秒窗口更小，
所以"看起来稳定"；全量跑时机器已热、耗时更分散，翻红率更高（实测 3/6）。
这也解释了为什么验收方此前连跑 6 次同场景完全稳定——短探针几乎总在同一秒内完成。

---

## 4. 验收条款逐条对照

| 条款 | 状态 | 证据 |
|---|---|---|
| 定位真因（二分：只建场景→加回合→4 回合） | ✅（改走更快的跨进程探针路线） | 第 1 节；逐秒漂移机制有全链路证据 |
| 根治，不靠重跑/放宽断言 | ✅ | 引擎侧补重置；T2/T7 断言零改动 |
| T7 与 T2 保持原有断言强度 | ✅ | `git diff` 不含 p4_9_safety_map.test.ts |
| 连跑 10 次全量 `npm test` 全绿 | ✅ | 第 10.3 节，10/10 绿（532 passed） |
| `npm run build` 绿 | ✅ | 第 10.4 节 |
| 报告含二分过程/真因/修法/10 次结果/单跑 vs 全量解释 | ✅ | 本文件 |
| 边界：未动 Generator、fixtures、data、Random.ts、既有测试 | ✅ | `git diff --stat` 仅 Game.ts +8；新增 1 个测试文件 |
| 未执行 git 写操作 | ✅ | 仅 `diff/status` 只读探查 |

---

## 5. 与预设不符之处（只列不修）

1. **任务书"单独跑该文件则稳定全过"不成立**：单文件循环 8 次红 1 次。
   该前提若继续被采信，会把排查方向错误地钉死在"跨文件/跨进程"上。
2. **常识文档 §四 的行号过期**：`Monster.ts`（291/293/482/484）与 `Creature.ts:24`
   现已无 `Math.random()`（应系 P2-0 收编后文档未更新）。建议下轮维护常识文档。
3. **验收方排除表第 2 行的措辞有漏洞**："id 49→229 递增，safety map hash 完全稳定"
   的结论成立，但其探针未跑回合、且（按本轮机制）大概率整段落在同一秒内——
   "稳定"是机制下的必然而非"该状态无关"的证据。本轮结论与其不冲突，但复现实验
   设计应注明"必须跨秒/长时程对比"。
4. **同族隐患（发现但未动手，边界外）**：`Game.loadSnapshot`（约 5520-5545 行）
   重建 grid 后**既不恢复也不重算 `loopMap`**——读档后 normal 局的 IN_LOOP 信息
   丢失（snapshot 不含该字段），safety map 的环路偏好将静默失效；且残留上一局
   的 loopMap 若恰存在，还会带上错误环路。CE 侧 IN_LOOP 是 pmap flags 随存档
   持久化（或等价地在读档后随层重算）。修法建议：`loadSnapshot` 网格重建完成后
   `this.loopMap = analyzeLoopMap(this.grid)`（一行，同款不变式）——留待授权。
5. **`EventBus` 是死代码**：全项目零调用点。与本案无关，登记备查。
6. **`Game.ts:343` 的 `emptyLoopMap()` 字段初始化**在修复后仅剩"实例构造瞬间"
   一个读点（test/normal 路径都会立即覆盖），保留不动（属另一轮正在动的
   LoopMap 邻接面之外的最小改动原则）。

---

## 10. 门禁输出

### 10.3 `npm test` 连续 10 次全量（修复后）

```
=== RUN 1 ===      Tests  532 passed | 8 skipped | 5 todo (545)
   Duration  37.91s
=== RUN 2 ===      Tests  532 passed | 8 skipped | 5 todo (545)
=== RUN 3 ===      Tests  532 passed | 8 skipped | 5 todo (545)
=== RUN 4 ===      Tests  532 passed | 8 skipped | 5 todo (545)
=== RUN 5 ===      Tests  532 passed | 8 skipped | 5 todo (545)
=== RUN 6 ===      Tests  532 passed | 8 skipped | 5 todo (545)
=== RUN 7 ===      Tests  532 passed | 8 skipped | 5 todo (545)
=== RUN 8 ===      Tests  532 passed | 8 skipped | 5 todo (545)
=== RUN 9 ===      Tests  532 passed | 8 skipped | 5 todo (545)
=== RUN 10 ===     Tests  532 passed | 8 skipped | 5 todo (545)
ALL_DONE
```

10/10 全绿（532 = 原 530 + 本轮新增回归测试 2 条；skipped/todo 与修复前一致）。
修复前同口径对照：全量 6 连跑红 3（RUN 2/4/6，均为 T2 :195），单文件 8 连跑红 1。

### 10.4 `npm run build`

```
dist/assets/WebGLRenderer-DT3pIH10.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-EJKWLkya.js               745.81 kB │ gzip: 226.92 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit via build.chunkSizeWarningLimit.
✓ built in 3.92s
```

（chunk 体积提示为既有信息性警告，与本次改动无关；vue-tsc 类型检查通过。）

### 10.5 `git diff --stat`

```
 brogue-web/src/engine/Core/Game.ts | 8 ++++++++
 1 file changed, 8 insertions(+)
未跟踪：brogue-web/src/test/p1_34_loopmap_reset.test.ts（新增回归测试）
```
