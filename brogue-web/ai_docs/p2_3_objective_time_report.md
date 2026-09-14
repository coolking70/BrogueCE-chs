# P2-3 报告：客观时间块（每 100 tick）+ 完整回合修正

日期：2026-09-14
范围：`src/engine/Core/Game.ts`、`src/entities/Player.ts`、`src/engine/Systems/Time.ts`（均在允许清单内）；
新增 `src/test/p2_3_objective_time.test.ts`、`src/test/fixtures/p2_3_baseline.json`。

---

## 一、迁移清单逐条落地情况（含对提示词第三节的复核）

提示词第三节要求"自行核对上述判断是否准确"。逐条复核结论：

| CE 客观块成员（Time.c 位置） | 提示词判断 | 复核结论 | 落地 |
|---|---|---|---|
| `rechargeItemsIncrementally(1)`（2662） | 客观，对应 `tickArcanaResources` | ✔ 准确 | `objectiveTimeBlock()` 首位调用 |
| `processIncrementalAutoID()`（2663） | web 无此系统，跳过 | ✔ 准确（全仓无渐进鉴定实现） | 跳过 |
| `rogue.monsterSpawnFuse--`（2666） | 客观，每 100 tick 递减 | ✔ 准确，且补充：**触发** `spawnPeriodicHorde` 的检查在 `decrementPlayerStatus` 尾部（Time.c:2322-2325），同属客观块；web 原来递减与触发都在 epilogue，现一并迁入 | 客观块内递减+触发+重置 |
| 逐怪 `applyInstantTileEffectsToCreature`（2670-2673） | 客观 | ✔ 准确 | 由 `applyEnvironmentalEffects` 覆盖（深渊/岩浆即死、燃烧伤害） |
| 逐怪 `decrementMonsterStatus`（2678-2683） | 客观，`tickCreatureStatuses` | ✔ 准确 | `tickCreatureStatuses()`（含玩家侧，见下） |
| DFChance 地形特征（2686-2695） | web 若无对应则跳过并报告 | ✔ web 无 per-monster DF 生成系统 | 跳过 |
| `updateEnvironment()`（2697） | 客观 | ✔ 准确 | `updateFires()` + `updateGases()` |
| `decrementPlayerStatus()`（2699） | 客观，`tickTemporaryImmunities` | ⚠ **部分不准确**：web 的 `tickTemporaryImmunities` 只是护符免疫计时（web 自创系统），而 CE 该函数的主体是玩家全部状态递减——**其中包含营养递减与 checkNutrition（Time.c:2213-2220）**，即 CE 的"饥饿"也在客观块内（详见第二节）。落地：`tickTemporaryImmunities()` + `tickNutrition()` 都放入客观块 | 客观块内 |
| 逐怪行动后 `applyInstantTileEffectsToCreature(&player)`（2701） | 客观 | ✔ 准确 | 同 `applyEnvironmentalEffects`（玩家分支） |
| `monstersApproachStairs()`（2719） | （提示词未列） | web 无对应系统 | 跳过 |

主观侧（每玩家动作一次，保留在 `finishTurnEpilogue`）：

| web 原有项 | 提示词判断 | 复核结论 | 落地 |
|---|---|---|---|
| `player.updateNutrition()` | 主观，保持不动 | ⚠ **错误**（见第二节）：CE 中该函数的三件事归属不同——营养递减/档位 = 客观；饥饿伤害/回血 = 主观（Time.c:2523-2541 在 `playerTurnEnded` 的 do 循环段）。已把 `updateNutrition` **拆分**为 `tickNutrition()`（客观）+ `recoverPerTurn()`（主观）；`updateNutrition` 本体保留并标 `@deprecated`（hunger_regen.test.ts 直接调用它，测试禁改） | 拆分落地 |
| 饥饿状态变更日志 | 主观 | ⚠ 归属跟营养走：跨档记录由客观的 `tickNutrition` 产生，日志在客观块内即时打印（`consumeHungerTransition` 在 `objectiveTimeBlock` 内消费） | 客观块内 |
| `applyEnvironmentalEffects` | 客观 | ✔ 准确 | 客观块内 |
| `tickArcanaResources` | 客观 | ✔ 准确 | 客观块内 |
| `tickTemporaryImmunities` | 客观 | ✔ 准确 | 客观块内 |
| `tickCreatureStatuses` | 客观 | ✔ 准确 | 客观块内 |
| `stats.turns++` / wizard 回血 / 死亡结算 | （提示词未逐条列） | CE 的 `playerTurnNumber++` 在 do 循环（主观，Time.c:2500） | 留在 epilogue |

## 二、提示词第二节的一处错误（饥饿的主/客观归属）

提示词原文："**即：饥饿与回血是主观的，玩家状态递减是客观的。**"

**CE 源码证据表明饥饿（营养递减）是客观的：**

1. `Time.c:2213-2220`（`decrementPlayerStatus` 开头）：
   ```c
   if (!player.status[STATUS_PARALYZED]) {
     if (player.status[STATUS_NUTRITION] > 0) {
       if (!numberOfMatchingPackItems(AMULET, 0, 0, false) || rand_percent(20)) {
         player.status[STATUS_NUTRITION]--;
       }
     }
     checkNutrition();
   }
   ```
2. `decrementPlayerStatus` 全仓只有一个调用点：`Time.c:2699`，在客观时间块内。
3. `Time.c:2848` 的注释直接佐证：`// checkNutrition(); // Now handled within decrementPlayerStatus().`
4. 主观的 do 循环段（Time.c:2523-2541）只有**回血与饥饿伤害**（营养 ≤0 时每动作 -1 HP），没有营养递减。

按项目常识 §5.4，**以 CE 为准实现**：营养递减+档位挂进客观块；饥饿伤害+回血留主观（`recoverPerTurn`）。顺带照搬了两个 CE 守卫（web 此前缺失）：
- **麻痹时不耗营养**（Time.c:2214）；
- **携带任意护符时营养仅 20% 概率消耗**（Time.c:2218，无护符短路不掷骰——web 用 `hasAmulet || rng.randPercent(20)` 复刻同款短路）。

因此**验收条款 2 的前半句原文（"断言饥饿在 haste 下按玩家动作数递减（不随 tick 加倍）"）与 CE 冲突，未按原文实现**。CE 口径下 haste（50 tick/动作）是**每两次动作营养 -1**（客观时间恒定流逝，动作越快单位动作消耗越少）。测试 B1 断言的是 CE 口径（haste 两动作：回血 +20 主观、营养 -1 客观），它对"营养仍按动作递减"的错误实现会失败——对抗方向与原条款意图一致，只是断言值按 CE 取反。

## 三、soonestTurn 第三候选的实现与 CE 对照

CE（Time.c:2643-2655）：

```c
while (player.ticksUntilTurn > 0) {
  soonestTurn = 10000;
  for (逐怪) soonestTurn = min(soonestTurn, monst->ticksUntilTurn);
  soonestTurn = min(soonestTurn, player.ticksUntilTurn);
  soonestTurn = min(soonestTurn, rogue.ticksTillUpdateEnvironment);
  for (逐怪) monst->ticksUntilTurn -= soonestTurn;
  rogue.ticksTillUpdateEnvironment -= soonestTurn;
  if (rogue.ticksTillUpdateEnvironment <= 0) {
    rogue.ticksTillUpdateEnvironment += 100;
    /* 客观块 …… */
    if (rogue.gameHasEnded) return;
  }
  /* 归零怪物行动 …… */
  player.ticksUntilTurn -= soonestTurn;
  if (rogue.gameHasEnded) return;
}
```

web（`Game.advancementLoop`，P2-3 后）与上**逐行同构**：第三候选 → 全体扣减 → 门递减 → `<= 0` 时 `+100` 并执行 `objectiveTimeBlock()` → 客观块致死（`isGameOver`）即退出 → 归零怪物行动（带 `isGameOver` 守卫）→ 玩家扣减 → 致死退出。顺序差异仅一处：CE 的怪物行动循环以 `gameHasEnded == false` 为迭代守卫，web 用循环体内 `break` 等价实现。

**`synchronizePlayerTimeState`（Time.c:2435）**：CE 的三个调用点全部复刻——
- haste/slow 到期（Time.c:2264/2271 → web `tickCreatureStatuses` 检测玩家 `haste/hasted/slowed` 过期后调用）；
- 换层（RogueMain.c:562 → web `stairs_up`/`stairs_down` 的 `generateDepth` 之后调用）；
- 初值 100（RogueMain.c:404 → `startNewGame`）。

同步的语义效果（测试 E1 验证）：haste 在客观块内到期时，门被覆写为玩家剩余 tick（50），而非机械 +100 后的 100——与 CE 行为一致。

## 四、完整回合修正清单与 CE 依据

| 动作 | web 旧行为 | 新行为 | CE 依据 |
|---|---|---|---|
| quaff | `currentTick += 100`，怪物不动 | 完整回合（movementSpeed） | Items.c:7633 `apply()` 的 POTION 分支汇入末尾 `playerTurnEnded()` |
| read | 同上 | 完整回合 | 同上（SCROLL 分支） |
| eat | 同上 | 完整回合 | 同上（FOOD 分支） |
| equip | 同上（仅成功分支计费） | 完整回合（仅成功分支） | Items.c:4024 `equip()` 末尾 `playerTurnEnded()`；失败/已装备提前 return 不计费，web 同构 |
| unequip | 同上 | 完整回合 | Items.c:8349 `unequipItem` 成功路径末尾 `playerTurnEnded()` |
| drop | `currentTick += 50`（自创半回合），怪物不动 | 完整回合 | Items.c:8390 `drop()` 末尾 `playerTurnEnded()`（自创 50 已移除，与 P2-2 移除拾取 50 同口径） |
| **throw**（提示词"等动作"未点名，本轮补充发现） | 同上，怪物不动 | 完整回合 | Items.c:7173 `throwItem()` 末尾 `playerTurnEnded()` |

**核实后确认不需改的**：楼梯（stairs_up/stairs_down）。CE `useStairs`（Movement.c:2508 起）内部与两条进入路径（IO.c:2502/2511、Movement.c:1435-1438）都不调用 `playerTurnEnded`——CE 下楼梯不消耗回合，web 现状（不计回合）与 CE 一致，仅按 RogueMain.c:562 补了换层同步。

`rechargeArcanaItem`/`uncurseItem`/`useArcanaItem`/拾取/移动/攻击在 P2-1/P2-2 已是完整回合，未动。

## 五、新旧基线逐项差异成因

fixture：`p2_3_baseline.json`（结构与 `p2_2_baseline.json` 同构，生成逻辑逐行复制自 p2_2 测试 F 节）。
对比脚本核对结论：**`levels` 段与 p2_2/p2_1 基线逐字节相同**（本轮不触碰生成期，地形指纹/怪物数/物种/物品数零变化）。
`play` 段差异（4 seed × 400 回合，移动策略不变）：

| seed | 差异 | 成因（具体到挂钩迁移的哪一条） |
|---|---|---|
| 424242 | **无差异**（turnsRun/died/player/monsters 全同） | 该局两个刷怪点（实测 turn 171、308）之后，刷新的 WANDERING 怪群恰好始终未与玩家/环境发生消耗 rng 的交互，窗口顺序翻转与 rng 重排未波及任何被快照的状态——作为"语义零漂移"的对照样本保留 |
| 777 | 玩家位置 (47,17)→(43,9)；怪物 3→4 只 | ① 客观块从"窗口末尾"（旧 epilogue）移到"窗口开头"（CE 同序：块→该窗口到点的怪物行动），周期刷怪的 rng 消耗（fuse 检查 + `rand_range(125,175)` 重置 + 落点/horde 抽取）从怪物行动**之后**移到**之前**；② turn 139 首次刷怪后，全体后续 rng 抽取被重新指派 → 玩家移动策略（`rng.randRange` 选方向）走出不同路径 → 级联放大 |
| 20260913 | 玩家相同；怪物名册 [1] 旧 Kobold@22,9 → 新 **Jackal**@37,5，[2][3] 平移 | 同上机制的最直接证据：turn 174 的刷怪在新实现中先于怪物行动抽取 horde，`pickHordeType` 拿到的流位置不同 → **抽中了不同种类的 horde**；[7] Rat@26,0→26,4 是其后路径分叉的下游结果 |
| 31337 | 玩家位置 (28,17)→(34,17)；怪物 [2][3][4] 变动 | 同 777：turn 169 首次刷怪的 rng 重排级联 |

辅助实测（临时插桩，已删除）：4 个 seed 在 400 回合内各有 2 次周期刷怪（139/174/169/308…），即"刷怪 rng 移位"机制在每个 seed 都已触发，只是 424242 的下游未产生可观测差异。

另有一个**不改变频率但改变时点**的项：营养递减/状态递减/环境结算从"窗口末尾"提前到"窗口开头"。对同窗口内处在火/毒气/深水中的怪，旧实现"先行动后受害"，新实现（CE 同序）"先受害后行动"，死亡时点差一个事件点——本 4 局快照中未被击中，但属本轮引入的语义，如实记录。

## 六、因本轮而失配的既有测试（未修改，保留失败，共 5 个）

| 测试 | 失败内容 | 原因 |
|---|---|---|
| `hunger_regen.test.ts` × 3（ration 1800 / 上限 / mango 1550） | `expect(p.nutrition).toBe(1900)` 得 1899；`toBe(2150)` 得 2149；`toBe(1650)` 得 1649 | `eatItem` 现为完整回合：吃下 +N 后，**同一动作**的客观块随即营养 -1（CE 同构：`eat()` → `playerTurnEnded()` → 客观块递减）。差恒为 1，即迁移的直接结果 |
| `scroll_effects.test.ts` discord | `getStatusDuration('discordant')` 得 29，期望 30 | `readItem` 现为完整回合：卷轴施加 discordant(30) 后，同一动作的客观块把怪物状态递减为 29（CE 同构：读卷轴是一个回合，回合结束时 CE 怪物同样显示 29） |
| `p2_2_real_speed.test.ts` F 节 play | 3 个 seed 的 400 回合快照与 p2_2 基线不符（详见第五节成因） | 预期失配：p2_2 基线是"客观块迁移前"的快照。新基准已固化到 `p2_3_baseline.json`，由本轮新增的 F 节测试守护；levels 段两代基线完全一致 |

p2_2 测试的 A–E 节（速度/动画/输入锁）与 p2_0/p2_1 全部通过：真实速度、动画同源、生成期指纹均不受本轮影响。

## 七、验收条款逐条对照

1. **客观时间生效** ✔ — `p2_3_objective_time.test.ts` A1：haste 连续两次动作，门 100→50→100、营养恰 -1；A2：slowed 一次动作营养 -2、门回 100。反向验证①（把门从 soonestTurn 候选中移除）后 **A2 失败**：slowed 窗口越冲导致门终值 0 ≠ 100、节奏失相位——对抗力由 A2 承载（A1 在无怪场景下两实现恰好同轨迹，这是用例设计时的实测发现，不是漏报）。
2. **主观/客观分离** ✔（按 CE 修正后的口径，见第二节）— B1 回血主观（haste 两动作 +20 HP，若错误挂客观只 +10）、营养客观（同条件 -1）；B2 饥饿伤害主观（每动作 -1 HP，不随客观块减半）；B3 怪物状态按 tick（haste 两动作 -1、slowed 一动作 -2）。
3. **spawnFuse** ✔ — C1 haste 两动作 fuse 5→4（旧实现 5→3）；C2 slowed 一动作 fuse 2→0 并触发恰好一次 `spawnPeriodicHorde`（spy 断言），重置值落在 [125,175]。
4. **完整回合修正** ✔ — D1a–g：quaff/read/eat/equip/unequip/drop/throw 每个动作后，spy 证实怪物 `takeTurn` 恰好被调用一次、玩家 ticksUntilTurn 归零、currentTick 增量 = movementSpeed。反向验证②（quaff 退回"只加簿记"）后 **D1a 失败**。D2：楼梯不计回合（CE 同）但换层同步门。
5. **`npm run build` 全绿** ✔ — `vue-tsc -b && vite build` 通过，仅既有的 chunk 体积警告。
6. **`npm test`** — 253 通过 / 5 失败（第六节清单，全部为预期内失配，未修改）/ 3 skipped / 5 todo。

## 八、RNG 流说明（项目常识 §四）

本轮有三处影响"同 seed 玩法轨迹"的流移位（均不影响地图生成——levels 指纹实测零变化）：

1. **周期刷怪的 rng 消耗时点**从窗口末尾移到窗口开头（同一动作内先于怪物行动），后续所有抽取重新指派——p2_2 play 基线失配与第五节差异的直接原因；
2. **新增护符营养掷骰**：携带任意 AMULET 时每个客观块多消耗一次 `randPercent(20)`（CE Time.c:2218 对齐；无护符短路不消耗）；
3. **完整回合动作**（quaff/read/eat/equip/unequip/drop/throw）此后会真实推进怪物回合，怪物行动的 rng 消耗紧随其后。

## 九、与预设不符之处 / 已知残留（只列不修）

1. **提示词第二节错误**：饥饿是客观的不是主观的（证据见第二节），验收条款 2 前半句已按 CE 取反。
2. **提示词第三节表格**：`player.updateNutrition()` 标"主观"不准确——该函数混合了客观（营养递减/档位）与主观（伤害/回血）两半，已拆分而非整体保留。
3. **提示词未列 throw**：`throwItemAt` 同为免回合动作，已按 CE 补齐（Items.c:7173）。
4. **提示词引用的 CE 行号校对**：`Time.c:2657-2700` 客观块实际主体在 2657-2712（`decrementPlayerStatus` 在 2699）；`synchronizePlayerTimeState` 在 Time.c:2435（提示词写 2436，差一行，无实质影响）；换层调用点在 RogueMain.c:562。
5. **web 与 CE 的结构性残留差异**（非本轮引入，边界外不动）：
   - `tickCreatureStatuses` 把玩家状态递减与怪物合并、置于环境结算**之前**；CE 中玩家状态（`decrementPlayerStatus`）在 `updateEnvironment` **之后**、怪物状态在其**之前**。web 合并实现无法两全，取了与怪物一致的时点；
   - CE 的 `processIncrementalAutoID`（护甲/戒指渐进鉴定）、DFChance 怪物地形特征、`monstersApproachStairs`、`applyGradualTileEffects`（渐进地形效应）web 均无对应系统；
   - CE `checkNutrition` 的阈值即时消息与"营养 ≤1 强制吃粮"逻辑，web 用阈值档位近似（跨档消息已有，强制吃粮无）；
   - CE unequip 受诅咒装备会被拒绝且不计回合；web `Player.unequip` 无诅咒拦截，unequip 恒成功恒计费；
   - `ticksTillUpdateEnvironment` 未入 GameSnapshot 存档结构，读档后回到 100（CE 存于 rogue 结构会持久化）。
6. **`updateNutrition` 保留为 deprecated**：hunger_regen.test.ts 直接调用它，测试禁改，故旧的三合一方法原样保留仅供该测试；引擎侧已无调用（全仓 grep 确认仅测试引用）。
7. 临时文件清理：基线生成脚本与两轮插桩探针均为临时创建、用后即删；`git status` 中新增文件仅 `p2_3_objective_time.test.ts` 与 `p2_3_baseline.json`。

## 十、固定附件

### `npm test` 输出尾部（完整命令 `npm test`，即 `vitest run`）

```
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/5]⎯

 Test Files  3 failed | 25 passed (28)
      Tests  5 failed | 253 passed | 3 skipped | 5 todo (266)
   Start at  13:41:08
   Duration  29.92s (transform 2.12s, setup 0ms, import 4.49s, tests 126.69s, environment 9ms)
```

失败明细（名称）：

```
FAIL  src/test/hunger_regen.test.ts > 偏差4：食物恢复量 ration 1800 / mango 1550 > 吃一个 mango 恢复 1550 nutrition
FAIL  src/test/hunger_regen.test.ts > 偏差4：食物恢复量 ration 1800 / mango 1550 > 恢复量不超过 maxNutrition 上限（CE Items.c:7491 的 min）
FAIL  src/test/hunger_regen.test.ts > 偏差4：食物恢复量 ration 1800 / mango 1550 > 吃一份 ration 恢复 1800 nutrition
FAIL  src/test/p2_2_real_speed.test.ts > P2-2 F: p2_2_baseline 一致性 > 4 seed × 400 回合玩法状态与 p2_2_baseline 一致
FAIL  src/test/scroll_effects.test.ts > discord_burst 卷轴（Items.c:8011 → discordBlast） > 视野内怪物获得 discordant（30 回合）；无生命怪豁免
```

（按项目记忆，验收复跑请用 `npm test -- --no-file-parallelism` 规避云同步目录的并行负载抖动；本轮所有数据均为串行跑采集。）

### `npm run build` 输出尾部

```
dist/assets/CanvasRenderer-Dii6dGg_.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-_t-eyDwJ.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-Bvt8aKCl.js           41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-BLxA68xu.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-C8k-7ttG.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-t852BnT3.js               891.63 kB │ gzip: 282.52 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.37s
```

### `git diff --stat`

```
 brogue-web/src/engine/Core/Game.ts    | 149 +++++++++++++++++++++++++++-------
 brogue-web/src/engine/Systems/Time.ts |   6 +-
 brogue-web/src/entities/Player.ts     |  63 ++++++++++++++
 3 files changed, 188 insertions(+), 30 deletions(-)
```

未跟踪新增：`src/test/p2_3_objective_time.test.ts`、`src/test/fixtures/p2_3_baseline.json`。
既有两个 fixture（`p2_baseline.json`、`p2_2_baseline.json`）与 `src/data/` 全部 json 未触碰。

### 反向验证输出

① 移除 soonestTurn 第三候选后：

```
 × A2 slowed 下一次动作，客观块触发两次（营养 -2；门回到 100） 10ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 18 passed (19)
```

② quaff 退回"只加 currentTick 不触发回合结束"后：

```
 × D1a quaff 是完整回合（CE Items.c:7633 apply → playerTurnEnded） 8ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 18 passed (19)
```

两处破坏均已还原（还原后 diff --stat 恢复为上表数值），全量重跑失败集合与第六节完全一致。
