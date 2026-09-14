# P2-4 报告：动画节奏改按 CE 口径（E1-修订）+ 右侧面板遮挡修复

日期：2026-09-14
改动文件：`src/engine/Core/Game.ts`、`src/components/GameCanvas.vue`
新增文件：`src/test/p2_4_animation_cadence.test.ts`、本报告

---

## 一、新动画模型与 CE `Time.c:2704` 的对照

### CE 原文（BrogueCE-master/src/brogue/Time.c:2704-2707，位于推进循环 `ticksTillUpdateEnvironment <= 0` 的客观块内）

```c
if (player.ticksUntilTurn > 100 && !fastForward) {
  fastForward = rogue.playbackFastForward ||
                pauseAnimation(25, PAUSE_BEHAVIOR_DEFAULT);
}
```

要点核实（均已在 CE 源码逐条验证）：

| CE 事实 | 核实位置 |
|---|---|
| 判断挂在 100-tick 客观块内，且在玩家 `ticksUntilTurn` 递减**之前**（递减在循环尾部） | Time.c:2655-2707 与 2745 的语句顺序 |
| `pauseAnimation(short milliseconds, ...)` 参数是**毫秒** | Rogue.h:3057 签名；IO.c:2385 实现（`pauseBrogue(milliseconds)`） |
| 暂停期间先渲染当前画面再延迟（`commitDraws()` → 延迟） | IO.c:2371-2383 `pauseBrogue` |
| `fastForward` 是 `playerTurnEnded` 的局部变量 | Time.c:2471（定义）、2704、2842 三处使用 |
| `rogue.playbackFastForward` 为真时短路，不调用 pauseAnimation | 2705 行 `||` 短路项；Rogue.h:2523 注释 "disables drawing and prevents pauses" |
| `pauseAnimation` 的返回值 = 暂停期间是否被用户事件打断 | sdl2-platform.c:300-313 `_pauseForMilliseconds`（有打断事件返回 true） |

### web 实现（本轮落地）

| CE | web | 位置 |
|---|---|---|
| 客观块内的 `>100 && !fastForward` 判断 | 生成器内同位置同条件判断（玩家 tick 同样在循环尾部才递减，口径一致） | `Game.ts` advancementLoop：3976-3982（判断 + `yield Game.ANIMATION_PAUSE_MS`） |
| `fastForward` 局部锁存 | 生成器内局部 `let fastForward`（E1-修订：暂停一次即置位） | Game.ts:3951（定义）、3978（置位） |
| `pauseAnimation(25, ...)` | `ANIMATION_PAUSE_MS = 25`（Game.ts:4131）；消费侧 `tickAdvancement` 按 `pendingPauseMs` 节流；暂停点先渲染再等待（对应 `commitDraws` → 延迟） | Game.ts:4195-4204（stepAdvancement 暂停分支）、4185-4192（tickAdvancement） |
| `rogue.playbackFastForward` 短路 | `isAutoTraveling()`（Game.ts:4171）：playerTurnEnded 入口直接走同步路径（Game.ts:3930），生成器暂停点同样跳过（双保险） | 见"三、自动寻路" |
| 常规动作不插帧 | 生成器**只在暂停点 yield**，怪物行动不再 yield：常规动作（≤100 tick）生成器零 yield，一次 `stepAdvancement` 跑完，仅收尾 1 帧渲染 | advancementLoop 全文 |

节奏效果对照：一层 6-10 只怪时，单个玩家动作的演出耗时从 P2-2 的 480-800ms（80ms × 怪物行动数）变为——常规动作约 1 帧（≤16ms，仅分步调度延迟），slowed（200 tick）约 25ms + 1 帧。

与 CE 的差异（锁存口径，详见"六、与预设不符之处"第 1 条）：CE 原码在"暂停未被用户打断"时 `fastForward` 保持 false，下一个满足 `>100` 的客观块会再次暂停；本轮按 E1-修订决议实现**暂停一次即锁存**。两者仅在 >200-tick 回合上行为不同，200-tick（slowed 常规回合）行为完全一致（第 2 个客观块时玩家剩余恰 100，不满足 `>100`）。

---

## 二、`animationStepIntervalMs` 的去留

**移除。** 理由：该常量的语义是"每次怪物行动帧的展示时长"，属于逐次动画模型的核心参数；新模型没有"每行动帧"概念，整个推进里唯一的时间常量是暂停时长 `ANIMATION_PAUSE_MS = 25`（对应 CE `pauseAnimation(25, ...)`），不再需要一个独立的节拍间隔。原 `animationAccumulatorMs` 累加器保留，但节拍目标从固定 80ms 改为 `pendingPauseMs`（停在暂停点时 >0，否则 0 = 每帧直接消费）。全仓库仅 `Game.ts` 自身引用过该常量，移除无外部破坏。

---

## 三、自动寻路跳过暂停的实现位置

两处，对应 CE 的两个位置：

1. **`playerTurnEnded` 入口**（Game.ts:3930）：`if (this.animationEnabled && !this.isAutoTraveling())` 才进入分步推进；行进回合直接走同步路径（与 headless 同一条代码），零插帧、零输入锁。
2. **`advancementLoop` 暂停点**（Game.ts:3976-3982）：`isAutoTraveling()` 时锁存但 `yield` 被跳过——对应 CE `rogue.playbackFastForward ||` 的短路项位置。

`isAutoTraveling()`（Game.ts:4171）= `inAutoTravelStep || autoPath.length > 0 || isMouseTraveling`。其中 `inAutoTravelStep` 是本轮新增的显式标志（Game.ts:5097 置位，try/finally 复位）：开发过程中发现**仅靠 `autoPath.length` 会漏掉两类步**——路径最后一步先 `shift()` 清空路径再结算回合、到达终点触发拾取时路径也已空，这两处的回合若按普通回合处理会重新引入"每走一步卡一下"。stepAutoPath 的函数体拆为 `stepAutoPathInner`（Game.ts:5105），外层统一置位/复位，使**步内所有**回合结算（移动、途中攻击 `handlePlayerAction('move')`、终点拾取 `handlePlayerAction('pickup')`、尾部直接 `playerTurnEnded`）全部按行进口径同步推进。

附带收益：终点拾取的"pickup 内 playerTurnEnded + stepAutoPath 尾部 playerTurnEnded"连续两次调用，在 P2-2 动画模式下会 beginAdvancement 互相覆盖；现在两次都走同步路径，动画模式与 headless 模式在该路径上语义一致（双重调用本身是既有问题，见"六"第 4 条）。

---

## 四、居中/命中区修复的前后对照（含 resize 路径）

| | 修复前 | 修复后 |
|---|---|---|
| 居中偏移 | 挂载时一次性 `Math.max(0, (window.innerWidth - DCOLS*TILE_SIZE)/2)`（含 340px 侧栏 → 地图右移约 170px 被侧栏压住） | `computeMapOffset(el.clientWidth, el.clientHeight)`（GameCanvas.vue:42，模块级导出供测试锁定口径），基于画布容器实际尺寸 |
| 鼠标命中区 | 挂载时一次性 `new PIXI.Rectangle(0, 0, window.innerWidth, window.innerHeight)`（侧栏区域的点击映射到错误格子） | `applyLayout()` 内 `new PIXI.Rectangle(0, 0, el.clientWidth, el.clientHeight)`（GameCanvas.vue:237-251） |
| resize 路径 | **无任何重算**（offset 与 hitArea 挂载后终身不变；仅 Pixi `resizeTo` 跟随容器改渲染器尺寸） | `ResizeObserver` 观察 `canvasContainer`（GameCanvas.vue:258），窗口缩放与任何布局变化（如侧栏增减）都会触发 `applyLayout()`，四个图层 position 与 hitArea 同步更新；卸载时 `disconnect()`（GameCanvas.vue:665） |
| 尺寸来源选择 | — | 用 `clientWidth/clientHeight` 而非 `pixiApp.screen`：`resizeTo` 的渲染器尺寸要等 Pixi 下一个渲染帧才跟上（queueResize），clientWidth 是布局完成后的即时真值，且覆盖非 window 引起的布局变化 |

"窗口宽 = 容器宽 + 340"场景的数值断言（p2_4 测试 E1）：容器 2000px / 窗口 2340px 时，`offsetX = (2000-1264)/2 = 368`；若误用窗口宽则为 538，恰好多出 340/2 = 170px——断言两者之差为 170，把"那 340px"显式钉进测试。另有源码守卫（E4）：`GameCanvas.vue` 不得再出现窗口视口尺寸字面量。

---

## 五、验收条款逐条对照

| # | 验收条款 | 结果 | 证据 |
|---|---|---|---|
| 1 | 三份 fixture 比对测试全部通过（硬门槛） | ✅ | p2_1 / p2_2 / p2_3 三个文件单独跑：`Test Files 3 passed (3)，Tests 43 passed \| 4 skipped (47)`（4 skipped 为既有设计，非本轮引入） |
| 2 | 常规动作（100 tick）不分帧 | ✅ | p2_4 A：放一只 100 速老鼠的常规回合 `steps=1`（生成器零 yield）、`pauses=0`、`renders=1`（仅收尾帧）；对抗逐次动画旧行为（旧模型 ≥2 步 ≥2 帧） |
| 3 | 慢动作暂停且本回合只暂停一次（锁存） | ✅ | p2_4 B1：slowed 200 tick → 恰好 1 次暂停、`pendingPauseMs === 25`、渲染 2 帧（暂停点+收尾）。B2：白盒 400-tick 回合（跨 3 个满足 >100 的客观块）→ 仍只暂停 1 次；反向验证（移除锁存）该测试失败 `expected 3 to be 1` |
| 4 | 自动寻路 / isMouseTraveling 不暂停 | ✅ | p2_4 C1/C2：slowed + 行进时 `stepAutoPath` 同步完成——`isAdvancing` 恒 false、无输入锁、回合同步收尾（turns 递增）；反向验证（移除行进旁路）C1/C2 失败 `expected true to be false` |
| 5 | 输入锁保底仍有效（D1/D2） | ✅ | p2_2 D1（异常解锁）、D2（超时自解）原样通过；p2_4 D 补充锁定慢回合锁定期内玩家输入被忽略、autoPath 不推进、消费完毕解锁 |
| 6 | 居中用容器宽度 | ✅ | p2_4 E1-E4（见"四"） |
| 7 | `npm test` 全绿、257 passed 不减 | ✅ | `267 passed \| 4 skipped \| 5 todo`（257 → 267，新增 10 个全通过，原有用例零丢失） |
| 8 | `npm run build` 全绿 | ✅ | `vue-tsc -b && vite build` 通过，`✓ built in 1.73s`（chunk >500kB 警告为既有现象） |

### 反向验证记录（§5.2，三处改坏 → 失败 → 还原）

1. **移除锁存**（`fastForward = true` 改为仅在行进时置位）：B2 失败，`AssertionError: expected 3 to be 1`——无锁存实现暂停 3 次。已还原。
2. **移除行进同步旁路**（playerTurnEnded 入口不再检查 `isAutoTraveling`）：C1/C2 失败，`AssertionError: expected true to be false`（寻路步后仍在推进中）。已还原。
3. **居中回归**（重新引入窗口尺寸 hitArea）：E4 源码守卫失败 `expected '...' not to match /window\.innerWidth|window\.innerHeight/`。已还原。

还原后已确认 `src/` 下无"反向验证"标记残留。

---

## 六、与预设不符之处（只列不修）

1. **提示词/决议把"本回合锁存只暂停一次"当作 CE 的完整事实，实际 CE 原码更微妙**。CE 的 `fastForward = rogue.playbackFastForward || pauseAnimation(25, ...)` 中，`pauseAnimation` 只在暂停期间**被用户输入打断**时返回 true（sdl2-platform.c:300 `_pauseForMilliseconds`：有打断事件才返回 true）；用户不打断时 `fastForward` 保持 false，下一个满足 `>100` 的客观块会**再次暂停**。即 CE 原生行为是"每个满足 >100 的客观块都停 25ms，用户可打断跳过剩余"，例如 slowed×重武器的 400-tick 回合原生最多停 3 次。本轮按 E1-修订决议实现"暂停一次即锁存"（与提示词及验收 3 一致），两者仅在 >200-tick 回合上有差异；若日后想完全对齐 CE，只需把 Game.ts:3978 的无条件置位改为"仅被打断时置位"。测试 B2 已把该差异点钉住。
2. **提示词验收 3 提到的"STAGGER 武器攻击"场景在 web 无法自然产生 >100 tick 的攻击回合**：web 玩家 info 速度恒为 100/100（`Creature.ts` 默认基准，武器不改玩家 attackSpeed；slowed 攻击 = 200 tick，已被 p2_2 A6 锁定），没有 CE 的 per-weapon 攻击延迟。因此 B2 用白盒 `defineProperty` 把玩家移动耗时构造为 400 tick 来验证锁存（对应 CE slowed×重武器的真实回合形态）。
3. **CE 客观块之外还有第二处同款 25ms 暂停**（Time.c:2842-2847：回合末玩家 paralyzed 时）。提示词与 E1-修订均未提及，本轮未实现（不在验收范围），列出备查。
4. **既有疑似 bug（边界外，未动）**：`stepAutoPath` 到达终点且脚下有可拾取物时，`handlePlayerAction('pickup')` 成功路径内部调用一次 `playerTurnEnded`（Game.ts:2261），随后 stepAutoPath 尾部又无条件调用一次——headless 同步路径下一次步进疑似结算两个回合。p2_1/p2_2/p2_3 的基线生成与 play 均不经过 stepAutoPath，故未被基线发现。本轮未改其行为（改动后两处调用都走同步路径，动画模式与 headless 语义在该路径上反而一致了），建议后续轮次核实处理。
5. **`isMouseTraveling` 在路径走完后不复位**（全仓库仅新游戏/读档/自动探索路径置 false）：旧行为。`isAutoTraveling()` 按提示词口径沿用了该信号，后果是鼠标行进结束后的玩家**手动**慢回合也不会暂停，直到场景重建。只列不修。
6. 行号核对：提示词给出的 `GameCanvas.vue:128/129/517` 与修复前实际代码一致，无误差。

---

## 七、固定附件

### `npm test` 输出尾部（验收轮，`--no-file-parallelism`）

```
> brogue-web@0.0.0 test
> vitest run --no-file-parallelism

 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  29 passed (29)
      Tests  267 passed | 4 skipped | 5 todo (276)
   Start at  14:47:05
   Duration  47.05s (transform 404ms, setup 0ms, import 1.52s, tests 41.81s, environment 7ms)
```

（默认并行模式同样全绿：`29 passed (29)，267 passed | 4 skipped | 5 todo (276)，Duration 19.78s`。）

### 三份 fixture 比对（玩法零影响证据）

```
npx vitest run src/test/p2_1_tick_architecture.test.ts src/test/p2_2_real_speed.test.ts src/test/p2_3_objective_time.test.ts --no-file-parallelism

 Test Files  3 passed (3)
      Tests  43 passed | 4 skipped (47)
   Start at  14:48:15
   Duration  6.94s (transform 212ms, setup 0ms, import 729ms, tests 5.61s, environment 2ms)
```

- `p2_baseline.json`（P2-1）：4 seed × D1-D26 地形指纹/怪物/物品全一致 ✅
- `p2_2_baseline.json`（P2-2）：同上，且与 P2-1 旧基线 levels 段相同 ✅
- `p2_3_baseline.json`（P2-3）：同上 + 4 seed × 400 回合玩法状态一致 ✅

本轮全部改动均在表现层（生成器 yield 点、消费侧节拍、行进旁路、Vue 布局），headless 同步路径的语句序列未变，fixture 逐项通过印证玩法零影响。

### `npm run build` 输出尾部

```
dist/assets/CanvasRenderer-XrAtWodg.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-DCwzvQFL.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-BWDrrKLq.js           41.30 kB │ gzip:  10.82 kB
dist/assets/RenderTargetSystem-D2pOQmom.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-bG5AORgr.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-DFjcVGvC.js               892.39 kB │ gzip: 282.77 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.73s
```

（chunk 体积警告为既有现象，与本轮无关。）

### `git diff --stat`

```
 brogue-web/src/components/GameCanvas.vue |  77 +++++++++++++++++---
 brogue-web/src/engine/Core/Game.ts       | 120 +++++++++++++++++++++++++------
 2 files changed, 167 insertions(+), 30 deletions(-)
Untracked:
 brogue-web/src/test/p2_4_animation_cadence.test.ts   （新增，10 用例）
 brogue-web/ai_docs/p2_4_animation_cadence_report.md  （本报告）
```

改动严格限于允许清单：`GameCanvas.vue`（居中/命中区/动画注释）与 `Game.ts`（仅动画节奏与输入锁相关段 + stepAutoPath 行进标志包装）；`src/data/`、三份 fixture、既有 `.test.ts`、其余禁碰文件零改动；未执行任何 git 写操作，改动全部留在工作区。
