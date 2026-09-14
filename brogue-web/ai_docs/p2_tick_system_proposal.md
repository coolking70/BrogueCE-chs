# P2：tick 制时间系统 —— 实现方案（待评审，未开工）

> 状态：**方案阶段**。按项目决策 D3，未经评审不开工。
> 目的：让评审者能判断"要不要做、怎么做、分几步做、风险在哪"。

---

## 一、为什么必须做

`parity_gap_analysis.md` 把它列为继"数据断层"之后的**第二大结构性欠账**。
数据断层已在 P1-1/P1-5/P1-7 修完，tick 系统成为当前最大的单点阻塞：

- `moveSpeed` / `attackSpeed` 已经是真实 CE 数值（P1-1 接入），但**唯一消费方是
  `DetailGenerator` 的展示**——豺狼 `moveSpeed=50`（双倍速）走得和老鼠一样快，
  食人魔 `attackSpeed=200`（半速攻击）打得和哥布林一样快。
- `haste` / `slowed` 状态**纯装饰**，不影响任何行动经济。
- 一批 CE 机制无处落地：迅捷剑的双速突刺、重武器的迟滞（P1-10 的
  `ITEM_ATTACKS_STAGGER` / `QUICKLY` 分支目前无对应标志可用）、
  法杖充能与护甲/戒指的渐进式自动鉴定（按客观时间而非玩家回合）。

**即：不做 tick，速度类机制永远无法正确落地，且 P3 的一批任务会悬空。**

---

## 二、CE 的实际结构（`Time.c:2468` `playerTurnEnded`）

核心是一个**最近事件推进**循环，不是事件队列：

```
playerTurnEnded():
  do {
    ... 玩家侧每回合结算（回血、饥饿、状态递减）...

    while (player.ticksUntilTurn > 0) {
        soonestTurn = min(所有怪物的 ticksUntilTurn,
                          player.ticksUntilTurn,
                          rogue.ticksTillUpdateEnvironment)

        所有怪物 ticksUntilTurn -= soonestTurn
        ticksTillUpdateEnvironment -= soonestTurn

        if (ticksTillUpdateEnvironment <= 0) {
            ticksTillUpdateEnvironment += 100
            // —— 按"客观时间"推进的东西都挂在这里 ——
            rechargeItemsIncrementally(1)     // 法杖充能
            processIncrementalAutoID()        // 护甲/戒指渐进鉴定
            rogue.monsterSpawnFuse--          // 周期刷怪
            applyInstantTileEffectsToCreature(每只怪)
            decrementMonsterStatus(每只怪)    // 怪物状态时长
            refreshWaypoint(...)              // 滚动刷新路径锚点
        }

        for (每只 ticksUntilTurn <= 0 的怪物) {
            monstersTurn(monst)   // 内部会重设它的 ticksUntilTurn
        }

        player.ticksUntilTurn -= soonestTurn
    }
  } while (玩家仍处于麻痹等不可行动状态)
```

### tick 的赋值口径

| 主体 | 赋值 | 出处 |
|---|---|---|
| 玩家移动 | `+= movementDuration`（地形相关，泥沼 ×2） | Movement.c |
| 玩家攻击 | `+= attackSpeed`；慢武器 `+= 2×attackSpeed`；快武器 `+= attackSpeed/2` | Time.c:2444-2448、Movement.c:1209 |
| 怪物初始 | `= info.movementSpeed` | Monsters.c:116 |
| 怪物行动后 | 移动 `= movementSpeed`；攻击/施法 `= attackSpeed`，`MONST_CAST_SPELLS_SLOWLY` 则 ×2 | Monsters.c:2125/3075/3140 |
| 怪物被跳过回合 | 麻痹/入迷/俘虏 → `= movementSpeed`，不行动 | Time.c:2727-2732 |

**基准 100 tick = 一个标准回合**，环境每 100 tick 更新一次。

---

## 三、web 的现状

- `timeSystem.currentTick += 100` 散布在 `Game.ts` 约 27 处，**纯计数器**，
  没有任何逻辑读它做调度（半时动作如拾取写 `+= 50`，但不产生行为差异）。
- `src/engine/Systems/Time.ts` 的事件队列 `scheduleEvent`/`eventQueue`
  **完全无调用**，是死代码。
- `runMonsterTurns()` 让每只怪物在每个玩家动作后**恰好行动一次**。
- 环境更新（`Gas.ts`）每个玩家动作一次，而非每 100 tick 一次。

---

## 四、风险分析（评审重点）

这是全项目风险最高的一轮改动，不是因为算法难，而是因为**它改变了"一回合"的定义**，
而现有代码里很多地方隐含依赖旧定义。

### R1. 所有"每回合一次"的调用点语义会变（高风险）

P1-4 刚落地的饥饿/回血就是典型：`updateNutrition()` 现在每个玩家动作调一次。
tick 化之后，"玩家动作"与"100 tick"不再等价——快速移动时一个动作只推进 50 tick，
慢武器攻击推进 200 tick。**必须逐个判定每个现有的"每回合"逻辑该挂在哪一侧**：

- 挂玩家主观回合（`playerTurnNumber`）：饥饿、玩家状态递减、玩家回血
- 挂客观时间（每 100 tick）：法杖充能、渐进鉴定、刷怪 fuse、怪物状态递减、地形效果

CE 已经把这两类分清楚了，照抄即可，**但 web 现有代码没有这个区分，需要逐处审计**。

### R2. RNG 流整体改变（确定性基线全部失效）

怪物行动次数与顺序变了，随机数消耗顺序随之改变。后果：

- 既有的地形指纹测试**仍会通过**（它只比对同一次运行内两次生成是否一致）
- 但所有已记录的基线表（D1-D26 怪物分布、平衡对照数据）**全部失效**，需重采
- P6 回放系统的前置条件更复杂了

### R3. 与"未播种 Math.random"的既有缺陷叠加（见项目常识 §四）

`Monster.ts` 的游走分支用 `Math.random()`。tick 化后怪物行动次数增加，
这个不确定性的影响被放大，统计类测试的方差会变大。
**建议把"收编 Math.random 进 seeded rng"作为 P2 的前置任务**，而不是并行做。

### R4. 渲染与交互节奏（中风险，web 特有）

CE 是终端程序，可以在一个玩家回合内跑完多次怪物行动再重绘，并用
`pauseAnimation` 做节奏控制（Time.c:2704-2707）。
web 版每个玩家动作后重绘一次。tick 化后，**一个玩家动作可能对应 0 次或多次怪物行动**——
玩家按一次方向键，可能看到豺狼动两步。需要决定：

- 是否在快速怪物行动之间插入动画帧？
- 自动探索/鼠标寻路的连续推进如何与 tick 循环配合？

**这一条 CE 没有现成答案可抄，需要产品决策。**

### R5. 性能

内层 `while` 每次迭代要遍历全部怪物两遍（求 min、减 tick）。
深层地牢怪物可达 40+，玩家一个慢动作（200 tick）可能迭代多轮。
当前 headless 测试已有 32 seed × 500 回合的用例，需关注耗时是否失控。

---

## 五、建议的分步实施

**不要一轮做完。** 建议拆成四轮，每轮独立可验收、可回滚：

### P2-0（前置）：收编 `Math.random` 进 seeded rng

`Monster.ts` 约 291/293/482/484、`Creature.ts:24`。
单独一轮，因为它会独立地移动 RNG 流，与 tick 改动混在一起会无法归因。
验收：同 seed 同操作序列下，怪物行动完全可复现。

### P2-1：引入 `ticksUntilTurn` 但不改变行为

- 给 `Player` 与 `Monster` 加 `ticksUntilTurn` 字段并正确赋值
- 实现 `soonestTurn` 推进循环
- **但令所有 speed 一律为 100**，使行为与现状完全一致

验收：全部既有测试不变通过；地形指纹与怪物分布与改动前**逐格一致**。
这一轮的价值是把架构换掉而不引入任何行为变化，风险最低、最容易验收。

### P2-2：接入真实 speed

放开 `moveSpeed` / `attackSpeed` 使用真实数值，`haste` / `slowed` 改为 ×0.5 / ×2。

验收：豺狼在玩家走一步内移动两次；食人魔两个玩家回合才攻击一次；
haste 状态下玩家行动次数翻倍。需重采全部基线表。

### P2-3：客观时间挂钩

把法杖充能、渐进鉴定、刷怪 fuse、怪物状态递减、地形效果迁到每 100 tick，
并逐处审计 R1 列出的"每回合"调用点。

---

## 六、评审结论（2026-09-14 用户拍板）

**方案通过，按 P2-0 → P2-1 → P2-2 → P2-3 顺序实施；tick 系统优先于 P1 剩余项。**

### E1-修订（2026-09-14，实机试玩后按 CE 口径重定）

**原 E1**（逐次动画：每次怪物行动单独成帧）已在 P2-2 落地，
实机试玩反馈**明显卡顿、自动寻路每步停顿**。查证 CE 后确认原决议与 CE 实际做法不符：

CE（`Time.c:2704`，位于 `ticksTillUpdateEnvironment <= 0` 的客观块内）：

```c
if (player.ticksUntilTurn > 100 && !fastForward) {
    fastForward = rogue.playbackFastForward || pauseAnimation(25, PAUSE_BEHAVIOR_DEFAULT);
}
```

即：**只在玩家动作慢于一个标准回合（>100 tick）时才暂停 25ms**，
且 `fastForward` 锁存——本回合只暂停一次。常规动作**完全不插帧**，
怪物行动完一次性渲染。连"豺狼一回合走两步"也不单独成帧
（玩家恰好 100 tick，不满足 `> 100`）。

**修订后的决议**：按 CE 口径。理由与原意图并不冲突——
只有当玩家比正常慢、怪物因此多行动几次时才需要看清先后；一比一的常规回合无先后可看。

- 常规动作（玩家 ≤100 tick）：不插帧，一次性渲染
- 玩家动作 >100 tick：每 100-tick 客观块暂停 25ms，本回合锁存一次
- 自动寻路 / 自动探索全程不暂停（对应 CE 的 `playbackFastForward`）
- 输入锁保留（含异常与超时的保底解除），但常规回合近乎瞬时解除

web 现状 `animationStepIntervalMs = 80` × 每次怪物行动，一层 6-10 只怪时
单个玩家动作耗时 480-800ms，约为 CE 的 20-30 倍。

### E1-原（已被上文修订取代，存档）

**逐次动画。** 每次怪物行动单独渲染，让玩家能看清怪物做了什么；
**怪物行动全部结束前，玩家不能操作**（输入锁定）。

工程含义：
- 需要一个"动画队列 + 输入锁"机制，tick 循环内每次 `monstersTurn` 产生一帧
- `runMonsterTurns` 当前是同步跑完再重绘，需改为可分帧推进
- 自动探索/鼠标寻路的连续推进要与输入锁配合，不能在锁定期继续下一步
- **输入锁必须有保底解除**，否则一次异常会让游戏永久卡死

### E2. P2-0 前置 —— 同意

先单独一轮收编 `Math.random` 进 seeded rng，再动 tick。

### E3. P2-1 的"行为零变化"验收 —— 保留该约束

用户指出：项目尚未正式发布，**开发期的玩家体验不作为验收标准**。

据此修正我原先的提问框架——我把 Q3 错误地表述成了"玩家感知不到变化值不值一轮成本"，
但该约束的真正价值**不是照顾玩家体验，而是验证隔离**：
令所有 speed 恒为 100 时，行为应与改动前逐格一致，
从而把"架构替换"与"速度生效"两类风险分开，任一轮出问题都能立即归因。
这个工程理由不受"是否发布"影响，**故保留该约束**。

（若评审者认为不必隔离、愿意接受 P2-1/P2-2 合并后的归因难度，请明确告知。）

### E4. 与 P1 剩余项的顺序 —— tick 优先

先做 tick，再做 P1-16（3 个占位卷轴）、P1-20（物品落在锁门上）、
§3.4 鉴定系统、§5 地牢生成器等。
理由：那些项的实现都要考虑 tick 语义，先做 tick 可避免二次返工。

---

## 七、原评审问题（已答，存档）

1. **R4 的渲染节奏**：一个玩家动作内多次怪物行动，要不要逐次动画？
   （影响手感，CE 的做法不能直接搬到网页）
2. **P2-0 是否作为前置**：收编 `Math.random` 会独立移动 RNG 流，
   同意先做吗？还是接受混在一起、放弃归因能力？
3. **P2-1 的"行为零变化"验收标准**是否可接受为一轮的全部产出？
   （投入一轮的成本，换取架构替换但玩家感知不到任何变化）
4. **是否现在做**：P1 尚有 P1-16（3 个占位卷轴需新系统）、P1-20、
   以及 §3.4 鉴定系统、§5 地牢生成器等未完成项。
   tick 系统解锁的是速度类机制，**但它也会让上述未完成项的实现复杂化**
   （都要考虑 tick 语义）。先做 tick 再做其余，还是反过来？

---

## 七、参考位置速查

- CE 主循环：`Time.c:2468` `playerTurnEnded`，内层循环 `Time.c:2642-2752`
- CE 怪物回合：`Monsters.c:3328` `monstersTurn`
- CE 玩家移动/攻击 tick：`Movement.c:1069` `playerMoves`、`Movement.c:1209`
- web 待改造：`Game.ts` 的 27 处 `timeSystem.currentTick += N`、
  `runMonsterTurns()`、`src/engine/Systems/Time.ts`（现为死代码）
