# P2-1 轮次报告：引入 CE tick 制调度架构（恒速 100，零行为变化）

日期：2026-09-14　|　基线 HEAD：dc614be　|　改动：全部留在工作区，未提交

## 一、做了什么

把 `runMonsterTurns()`（每个玩家动作后每只怪物无条件下场行动一次）替换为 CE
`Time.c:2468 playerTurnEnded` 的"最近事件推进"结构，同时**所有速度一律写死
`TICKS_PER_TURN = 100`**，使行为与改动前逐格一致。架构替换与速度生效两类风险
就此分离，P2-2 放开真实速度时出问题可立即归因。

改动文件（均在许可边界内）：

| 文件 | 改动 |
|---|---|
| `src/entities/Creature.ts` | 新增 `TICKS_PER_TURN = 100` 常量与 `ticksUntilTurn` 字段（基类，Player/Monster 共用） |
| `src/entities/Monster.ts` | 构造器按 Monsters.c:116 口径初始化 `ticksUntilTurn = TICKS_PER_TURN`（不读 `data.moveSpeed`） |
| `src/entities/Player.ts` | 未改（继承基类字段，初始 0 = CE 玩家口径） |
| `src/engine/Core/Game.ts` | `runMonsterTurns()` 重写为 `playerTurnEnded()`（CE 推进循环），12 处调用点更名替换 |
| `src/engine/Systems/Time.ts` | 删除事件队列（`EventType`/`ScheduledEvent`/入队/出队/按实体清队），保留 `timeSystem.currentTick` 纯簿记 |
| `src/test/p2_1_tick_architecture.test.ts` | 新增（允许）：基线逐项比对 + tick 门控对抗断言 + 事件队列删除守卫 |

## 二、推进循环与 CE `Time.c:2642-2752` 逐段对照

| CE（Time.c） | web（`Game.playerTurnEnded`） | 说明 |
|---|---|---|
| 2602-2606：`if (player.ticksUntilTurn == 0) += player.movementSpeed; else if (< 0) = 0;` | 同构三行，`movementSpeed` → 恒 `TICKS_PER_TURN` | `< 0` 分支对应 CE 免费回合残留（Combat.c:707 置 -1），web 本轮无产生负值的路径，保留分支仅为结构对齐 |
| 2643：`while (player.ticksUntilTurn > 0)` | `while (this.player.ticksUntilTurn > 0)` | 一致 |
| 2644-2652：`soonestTurn = 10000` 起遍历全部怪物取 min | `soonestTurn = this.player.ticksUntilTurn` 起遍历全部怪物取 min | 初值取玩家剩余 tick，与 CE"再 min 玩家"（2653）等价 |
| 2653：`min(soonestTurn, player.ticksUntilTurn)` | 同上（初值即玩家） | 等价 |
| 2654：`min(soonestTurn, rogue.ticksTillUpdateEnvironment)` | **未迁移**（见"特殊处理"第 3 条） | 客观时间门留给 P2-3 |
| 2655-2658：全部怪物 `ticksUntilTurn -= soonestTurn` | 相同（仅 `hp > 0` 者；对应旧实现循环前的死亡过滤） | 等价 |
| 2659-2717：`ticksTillUpdateEnvironment <= 0` 时的客观时间挂钩（法杖充能、渐进鉴定、刷怪 fuse、`applyInstantTileEffects`/`decrementMonsterStatus`/DF 生成/`updateEnvironment`/`decrementPlayerStatus` 等） | **未迁移**；这些挂钩维持原有挂载点（方法尾部的每动作一次结算） | 任务明确本轮不做（P2-3） |
| 2719-2745：遍历怪物，`ticksUntilTurn <= 0` 者行动；麻痹/入迷/俘虏/激活即行动者在 2727-2732 直接 `= movementSpeed` 跳过；`monstersTurn(monst)` 内部各出口赋 `movementSpeed`/`attackSpeed`（Monsters.c 2125/3075/3140/3352/3370/3379/3388…） | 遍历怪物，`ticksUntilTurn <= 0` 者调用 `takeTurn`（跳过判定在 takeTurn 内部早退：paralyzed/caged/hp≤0），返回后统一 `= TICKS_PER_TURN` | 恒 100 口径下 CE 全部分支出口（movementSpeed、attackSpeed、skip 路径）收敛为同一值 100，故统一赋值与逐出口移植**逐分支等价** |
| 2748：`player.ticksUntilTurn -= soonestTurn` | 循环体末行相同 | 一致 |
| 2750-2752：`gameHasEnded` 即 return | web 的死亡/终局判定保留在方法尾部原位置 | 零行为变化优先，见"特殊处理"第 5 条 |
| 2468 外层 `do {…} while (玩家仍不可行动)` | **未迁移外层重入** | 本轮恒速下玩家循环后必可行动，外层只会跑一轮；麻痹玩家的"跳过玩家回合、怪物行动"由既有 paralyzed 分支调用本方法承载（行为与改前一致） |

CE 侧另核实的锚点：`Monsters.c:116`（初始化满速）属实；`Time.c:2442-2456`
`playerRecoversFromAttacking`（攻击耗时：stagger ×2 / quickly ÷2 / 常 attackSpeed）
属实——本轮未接入（接入即行为变化）。

## 三、与基线比对的完整结果

fixture：`src/test/fixtures/p2_baseline.json`（head=dc614be，4 seed）。
采集口径已先用**改动前代码**逐一复核（临时探针，用后即删）：levels 段 26/26 逐格
吻合、play 段逐字吻合，确认逆向复刻的口径与采集时一致后，才动引擎代码。

最终结果（由 `p2_1_tick_architecture.test.ts` 断言，全绿）：

| 比对项 | seed=424242 | seed=777 | seed=20260913 | seed=31337 |
|---|---|---|---|---|
| D1-D26 地形指纹（26 层） | 26/26 一致 | 26/26 一致 | 26/26 一致 | 26/26 一致 |
| D1-D26 怪物数 | 26/26 一致 | 26/26 一致 | 26/26 一致 | 26/26 一致 |
| D1-D26 物种集合 | 26/26 一致 | 26/26 一致 | 26/26 一致 | 26/26 一致 |
| D1-D26 物品数 | 26/26 一致 | 26/26 一致 | 26/26 一致 | 26/26 一致 |
| 400 回合玩家坐标/HP | 一致 | 一致（44,12:30/30） | 一致 | 一致 |
| 400 回合所在层 / died | 一致 | 一致（D1 / false） | 一致 | 一致 |
| 400 回合全部怪物位置与 HP | 一致（逐只） | 一致（逐只，7 只） | 一致（逐只） | 一致（逐只） |

合计 4×26×4 项 levels 数据 + 4 组玩法状态，**零失配**。任何一项失配都意味着
行为变化，属验收不通过——本轮无。

## 四、为达成"零行为变化"所做的特殊处理

1. **玩家动作耗时恒 100，现网 50/100/200 簿记原样保留但未接入调度**。
   `timeSystem.currentTick += 50/100/200` 的全部赋值点一字未动（仍用于输入录制
   等簿记），但推进循环只认恒定的 `TICKS_PER_TURN`。原因：现网 pickup/祭坛取物
   记 50、泥泞移动记 200，若把它们接进 CE 循环，pickup 后怪物将不行动、泥泞移动
   后怪物将行动两次——都是行为变化。两本账的合并是 P2-2 的事。
2. **怪物行动后由 Game 循环统一赋满速，而非逐出口移植 Monsters.c 的赋值**。
   恒 100 口径下 CE 全部分支出口收敛为同一值，统一赋值与之逐分支等价
   （论证见上表 2719-2745 行）。web 的跳过判定（paralyzed/caged）留在
   `takeTurn` 早退，与 CE Time.c:2727-2732 的"跳过但时间照付"等价。
3. **soonestTurn 暂不含 `ticksTillUpdateEnvironment`**，客观时间挂钩（法杖充能、
   渐进鉴定、刷怪 fuse、怪物状态递减、环境更新）维持方法尾部"每动作一次"的
   原挂载点——任务明确本轮不迁移（P2-3）。
4. **结算顺序保持 web 现状**（怪物先动 → 环境/饥饿/状态结算），未改成 CE 的
   "结算 → 推进"顺序。改动顺序即行为变化。
5. **死亡怪物（hp ≤ 0）不参与 soonestTurn 与行动阶段**，对应旧实现循环前的
   `filter` 语义。
6. **未迁移 CE 外层 do-while 重入**（玩家循环后仍不可行动则再跑一轮）：恒速下
   该重入不可达；麻痹玩家的既有处理路径不变。
7. **存档/读档不序列化 `ticksUntilTurn`**：读档即满速开局，与改前（无此字段）
   行为一致；P2-2 接真实速度时再决定是否入库。

## 五、发现的"必须改变行为才能实现架构"之处（只列不改）

1. **差异化动作耗时与 CE 循环结构性冲突**：pickup 50 / 泥泞 200 / 祭坛 50 一旦
   接入推进循环必然改变怪物行动频次。P2-2 引入真实 `movementDuration` 时，
   基线玩法状态必变，届时需新基线。
2. **部分玩家动作"花时间但怪物不行动"**：equip/unequip/drop/quaff/read 等只加
   `currentTick` 不调用回合结束；CE 里这些全是完整回合（怪物行动）。本轮保持
   原状，仅记录。
3. **CE 已存在但本轮未接入的 tick 修正**（接入即行为变化）：免费回合
   （Combat.c:707 `= -1`）、快/慢武器攻击耗时（Time.c:2442-2456）、克隆怪
   `max(ticks,101)`（Combat.c:320）、骑乘怪 200（Combat.c:2026）、
   Items.c:4627/5504/7454 的行动锁、眩晕命中 `+=`（Combat.c:1252）。
4. **web 现有耗时表与 CE 不同源**：泥泞 ×2 是 web 自创口径；CE 的
   `movementDuration` 按地形另有取值。P2-2 需以 CE 为准重建（决策 D1）。

## 六、验收条款逐条对照

| # | 条款 | 结果 |
|---|---|---|
| 1 | 与 `p2_baseline.json` 逐项一致 | ✅ 见第三节，零失配 |
| 2 | `ticksUntilTurn` 存在且被推进循环使用（不是摆设） | ✅ B1 断言字段与初始口径；B2a/B2b 注入非 100 tick 值证明调度真实读它、门控行动、保留余量；B3 断言恒速下"每动作每怪恰一次、归满、玩家归零" |
| 3 | 事件队列已删除且全仓无引用 | ✅ C 组：Time.ts 无事件队列符号；全仓生产代码守卫扫描零命中；`runMonsterTurns` 不复存在；`currentTick` 簿记仍可用 |
| 4 | `npm test` 全绿，原 214 passed 不减 | ✅ 26 文件，**224 passed \| 5 todo**（214 原有 + 10 新增） |
| 5 | `npm run build` 全绿 | ✅ `✓ built in 1.38s`（chunk >500kB 警告为既有现象，非本轮引入） |
| 6 | 性能对比 | ✅ 见第七节，无显著变慢 |

反向验证（常识 §5.2）：把行动门 `m.ticksUntilTurn <= 0` 故意改成无条件行动
（模拟"字段是摆设"的合理错误实现），测试精确失败：

```
× B2a 剩余 tick 多于玩家耗时的怪物本动作不行动，且保留差值余量
  AssertionError: expected "takeTurn" to not be called at all, but actually been called 1 times
× B2b 剩余 tick 更少的怪物先行动；推进循环多轮迭代后其带走非零余量
  AssertionError: expected "takeTurn" to be called 1 times, but got 2 times
  Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
```

随后还原，复跑 10/10 全绿。既有 .test.ts 一律未动。

## 七、性能对比

同场景探针（临时文件，用后即删），改动前后各跑一次：

| 场景 | 改动前 | 改动后 |
|---|---|---|
| 4 seed × 400 回合（基线 play 同口径） | 175.7 ms | 176.3 ms（+0.3%） |
| D26 生成 ×4 seed | 6.9/8.9/5.4/7.5 ms | 7.2/8.8/5.3/7.2 ms |
| D26 跑 300 回合 ×4 seed（怪 18/10/18/12 只） | 0.8/0.3/0.9/8.7 ms | 0.9/0.3/0.8/8.9 ms |
| 4 seed × D1-26 生成 + 指纹 | 626.5 ms | 609.7 ms |

`npm test` 总耗时：改动前 **13.54s**（214 passed）→ 改动后 **14.07s**
（224 passed）。增量约 0.5s 来自新增测试文件本身（其内部含 4 seed × 26 层生成
+ 4×400 回合玩法，约 1s 引擎时间，多线程摊薄后计入总账）；引擎同场景跑分持平。
"深层 40+ 怪放大耗时"的担忧未出现：本轮恒速下循环体恰迭代一次，每次推进多做的
只是两遍 O(n) 数组扫描（n=场上怪数），实测在噪声内。P2-2 放开真实速度后
soonsetTurn 会变小、迭代数变多，届时需重新评估。

## 八、与预设不符之处（只列不修）

1. **"深层 40+ 怪"的预估与实测不符**：4 个 seed 的 D26 怪物数为 10-18 只，未见
   40+；性能条款按实测口径给出。
2. **任务表格"玩家攻击 += attackSpeed；慢武器 ×2；快武器 ÷2 出处 Time.c:2444-2448"**：
   实际函数 `playerRecoversFromAttacking` 在 Time.c:2442-2456（行号略有出入，
   语义与表格一致，非实质错误）。
3. **"维持现有挂载点"的客观时间挂钩里，web 与 CE 并不同构**：web 是
   `runMonsterTurns` 尾部每动作一次（tickArcanaResources/刷怪 fuse 等），CE 是
   ticksTillUpdateEnvironment 每 100 客观 tick 一次。恒速下两者每动作恰好各触发
   一次，行为暂时一致；P2-3 迁移时这不是"平移"而是"改语义"，需按 CE 重建。
4. **无**其他与 CE 源码冲突之处；本轮未出现需行使授权反驳拒绝指令的情形。

## 九、固定附件

### `npm test` 输出尾部

```
> brogue-web@0.0.0 test
> vitest run

 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  26 passed (26)
      Tests  224 passed | 5 todo (229)
   Start at  11:10:17
   Duration  13.75s (transform 1.52s, setup 0ms, import 3.08s, tests 40.13s, environment 5ms)

real 14.07
user 44.87
sys 1.35
```

### `npm run build` 输出尾部

```
dist/assets/CanvasRenderer-Cb6WObgS.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-Cqxrg9MP.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-5LhZz3Bh.js           41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-B6HYYaZl.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-DkD23Y70.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-BXRuE1UA.js               886.74 kB │ gzip: 281.47 kB

(!) Some chunks are larger than 500 kB after minification. Consider: …（既有警告）
✓ built in 1.38s
```

### `git diff --stat`

```
 brogue-web/src/engine/Core/Game.ts    | 81 +++++++++++++++++++++++++++--------
 brogue-web/src/engine/Systems/Time.ts | 66 ++++------------------------
 brogue-web/src/entities/Creature.ts   | 14 ++++++
 brogue-web/src/entities/Monster.ts    |  5 ++-
 4 files changed, 91 insertions(+), 75 deletions(-)
```

新增（未跟踪）：`src/test/p2_1_tick_architecture.test.ts`。
工作区无其他改动；调试/探针临时文件均已删除并复核（`git status` 仅余
`../output/` 与本报告、测试文件三项未跟踪）。
