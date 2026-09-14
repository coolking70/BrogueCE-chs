# P2-2 报告：放开真实速度 + 逐次动画 + 输入锁

日期：2026-09-14
基线父提交：77700d1（改动全部留在工作区，未提交）
本轮改动文件：`Creature.ts`、`Monster.ts`、`Game.ts`、`GameCanvas.vue`
新增文件：`src/test/p2_2_real_speed.test.ts`、`src/test/fixtures/p2_2_baseline.json`、本报告

---

## 一、速度接入：逐条 CE 对照

### 1.1 玩家

| CE 出处 | 语义 | web 实现 |
|---|---|---|
| Time.c:2604-2609 `playerTurnEnded` | `ticksUntilTurn == 0` 时 `+= player.movementSpeed`；`< 0`（免费回合残留）时归 0 | `Game.playerTurnEnded` 同构：`=== 0` 时 `+= this.player.movementSpeed`（Player 无状态时为 100，haste 50 / slowed 200）；`< 0` 分支保留 |
| Time.c:2438-2450 `playerRecoversFromAttacking` | 攻击耗时在结算处 `+= attackSpeed`（命中与否无关；STAGGER/QUICKLY 武器分支见下） | `Game.playerRecoversFromAttacking()`：`ticksUntilTurn += this.player.attackSpeed`，在 `handlePlayerAction` 的移动=攻击分支调用。因攻击后 `ticksUntilTurn ≠ 0`，playerTurnEnded 的 `== 0` 分支自然跳过，不会叠加 movementSpeed（A6 测试断言 slowed 玩家攻击总耗时恰为 200） |

**玩家速度来源**：CE 玩家 info 恒 100/100。web 的 `Creature` 基类新增 `movementSpeed` / `attackSpeed`（当前行动耗时，**tick 花费，值越小越快**），由 `refreshSpeeds()` 从 info 基准 + haste/slowed 状态推导（见 1.3）。

### 1.2 怪物

| CE 出处 | 语义 | web 实现 |
|---|---|---|
| Monsters.c:116 `initializeMonster` | 初始 `ticksUntilTurn = info.movementSpeed` | `Monster` 构造器：`this.ticksUntilTurn = this.moveSpeed`（真实值，如豺狼 50）——P2-1 时恒为 100 |
| Monsters.c:3352/3370 等 移动出口 | 移动后 `= movementSpeed` | `Monster.takeTurn` 的移动出口不赋值（保持 ≤0），由 `Game.advancementLoop` 统一 `m.ticksUntilTurn = m.movementSpeed` |
| Monsters.c:2125/2364/3075/… 攻击/施法出口 | `= attackSpeed`，`MONST_CAST_SPELLS_SLOWLY` 则 ×2 | `Monster.endTurnWithAttack()` 在 5 个攻击出口（盟友远程/盟友近战/discord 撕咬/猎杀远程/猎杀近战）赋值 `attackSpeed * (hasBehavior('MONST_CAST_SPELLS_SLOWLY') ? 2 : 1)`。数据中带该标志的 4 种：goblin_conjurer、spider、ogre_shaman、sentinel |
| Time.c:2727-2732 | 麻痹/入迷/俘虏/GETS_TURN_ON_ACTIVATION 不行动，`= movementSpeed` | web 的跳过判定在 `takeTurn` 早退（paralyzed/isCaged），同样由 advancementLoop 统一落 `movementSpeed`，两条路收敛（与 P2-1 相同的处理方式，只是值从恒 100 换成真实 movementSpeed） |

**速度数值来源**：`monsters.json` 的 `moveSpeed`/`attackSpeed`（P1-1 已按 CE monsterCatalog 接线，`src/data/monsters.test.ts` 有黄金值守卫）。分布：14 种 moveSpeed=50（豺狼、蝠、水鬼等）、ogre/spider/ogre_shaman attackSpeed=200、dragon/phantom (50,200)、bog_monster moveSpeed=200 等。

**衍生速度架构的一个关键约束**：公有字段 `Monster.moveSpeed`/`Monster.attackSpeed` 的语义从"info 基准"改为"**当前行动耗时**"（= CE `creature->movementSpeed`/`->attackSpeed`），`moveSpeed` 以存取器别名到 `Creature.movementSpeed`。原因有二：
1. `monster_stats_effect.test.ts` 的 legacy 模式每回合直接写 `m.moveSpeed = 100; m.attackSpeed = 100` 并要求立即生效（该测试不可修改）；
2. `Creature` 的当前值字段 `attackSpeed` 与 Monster 原"基准"字段同名，若基准留在公有字段会形成同一属性槽、refreshSpeeds 会覆盖掉数据基准。
   故 info 基准移入私有 `baseMoveSpeed`/`baseAttackSpeed`，`refreshSpeeds()` 从基准+状态推导当前值；`mutate()`（CE 是 mutateMonster → initializeMonster 的顺序，即突变后基准才初始化 ticks/速度）改写基准后调 `refreshSpeeds()` 并重置初始 ticks。`DetailGenerator` 读到的 `moveSpeed` 因此变成"当前值"——对展示面板而言这反而更正确（显示的是此刻的真实耗时）。

### 1.3 haste / slowed

| CE 出处 | 语义 | web 实现 |
|---|---|---|
| Items.c:4637-4460 `slow()` / `haste()` | slow：`movementSpeed = info*2, attackSpeed = info*2`（并清 hasted 状态）；haste：`= info/2`（并清 slowed 状态）；玩家与怪物同一套 | `Creature.refreshSpeeds()`：有 `haste` 或 `hasted`（web 两个 id 分别来自 speed 药水与 haste 闪电）→ `floor(info/2)`；否则有 `slowed` → `×2`。在 `applyStatus` 成功、`tickStatuses` 有到期、`mutate()`、存档还原（Game 的三处 `statusDurations` 直写点）、negation 闪电清状态后调用。A4a/A4b 验证：haste 下 100 速怪物每两个玩家动作行动一次；slowed 下一次玩家动作内行动两次 |
| Time.c:2261-2273 | 状态到期恢复 info 原值 | 同上，`refreshSpeeds()` 幂等推导即"恢复"（A5 验证到期后 50→100） |

---

## 二、移除自创耗时口径（决策 D1）

| 口径 | 原值 | 现值 | 影响面 |
|---|---|---|---|
| 泥泞移动 | `currentTick += 200`（且仅簿记，P2-1 的 tick 调度本就未读它） | `+= player.movementSpeed` | 无调度影响（簿记归一）；B1 测试锁定 |
| 拾取 | `+= 50` | `+= player.movementSpeed` | 同上；B2 测试锁定 |
| 祭坛取物 | `+= 50`（簿记） | `+= player.movementSpeed` | 同上 |
| 解锁门/蛛网挣扎/空祭坛通行/原地等待/麻痹挣扎 | `+= 100` | `+= player.movementSpeed` | 同上 |
| 玩家攻击 | `+= 100` | `+= player.attackSpeed`，且新增 `playerRecoversFromAttacking` 进调度 | **有调度影响**：攻击耗时正式进入 tick 口径（haste 玩家攻击只花 50 tick） |

注意区分：`timeSystem.currentTick` 的增量是**簿记**（输入录制用），真正的调度由 `ticksUntilTurn` 承担。上表中前四行在 P2-1 里就不影响调度（恒 100），本轮是"簿记与调度口径对齐"；最后一行是真实行为变化。

**顺带修复的双重推进 bug（超出速度本身，需验收方知悉）**：`stepAutoPath` 的两处分支（mouse-travel 被怪挡路、auto-explore 相邻攻击）先调 `handlePlayerAction('move', …, 'system')`——移动分支内部已经完成一次回合推进——随后又无条件 `timeSystem.currentTick += 100; this.playerTurnEnded()`，造成**每步自动寻路怪物行动两次、玩家被扣两拍**。本轮删除了这两处冗余调用。修复后自动寻路与手动移动的耗时一致（每步一个玩家行动日）；旧行为下自动寻路相当于双倍速过时间。此修复已体现在新基线中。

---

## 三、逐次动画与输入锁设计（决策 E1）

### 3.1 架构

`playerTurnEnded` 的推进主循环改写为生成器 `advancementLoop(stealthRange)`：**每个怪物行动后 `yield` 一次**。同步路径（`animationEnabled === false`，headless 与默认）一次性跑完生成器 + 收尾，语义与 P2-1 完全同构（唯一差别是真实速度）；动画路径由 `beginAdvancement` 建立生成器、`GameCanvas` 的 ticker 以 `tickAdvancement(ticker.deltaMS)` 驱动、`stepAdvancement()` 逐步消费。**两条路径共用同一个生成器，调度语义不可能漂移**（C3 测试：同 seed 40 回合，动画模式与同步模式的全部怪物位置/HP/ticks/玩家状态逐位一致）。

### 3.2 表现参数（提示词授权自定）

- **帧间隔**：`animationStepIntervalMs = 80`（约 12.5 怪物行动/秒）。单步移动可辨认、成群怪不拖沓；比 CE 的 25ms/帧慢进（Time.c fastForward 分支）更利于逐次阅读，属于保守选择。
- **解锁时机**：生成器耗尽（所有怪物行动完毕、玩家 ticks 归零）后 `finishAdvancement()` 收尾解锁。收尾（环境更新、饥饿、状态递减、刷怪 fuse、死亡判定）恰好执行一次。
- **帧内容**：每步 `needsRender = true; this.update()`——走既有的 FOV/光照/发现逻辑，怪物移动、飘字、战斗反馈逐帧呈现。
- **不做动画跳过键**：提示词要求"锁定期玩家输入被忽略"且测试需断言之，故锁定期一律忽略输入（包括 Escape），未实现"按键快进"（CE 的表现是按键跳过动画）。若验收方希望加跳过键，需放宽该验收条款，建议后续轮次单独做。
- **UI 挂载点**：`GameCanvas.vue` onMounted 置 `game.animationEnabled = true`、ticker 驱动；onUnmounted 关闭并丢弃在途推进。headless（harness）从不挂载该组件，`animationEnabled` 默认 false，**零动画开销、不阻塞**（E1 测试：400 回合同步推进 <10s 上限，实测同 P2-1 量级）。

### 3.3 输入锁与双重保底（硬性要求）

**锁的覆盖面**：
- `handlePlayerAction`：`source === 'player' && isInputLocked()` → 直接 return（在 `recordInputEvent` 之前，锁定期输入连录制都不进）。`system` 源不受锁约束——harness/脚本驱动必须始终可用。
- `stepAutoPath`：锁定即 return（GameCanvas ticker 稍后重试，解锁自然继续）。
- `handleMouseTravel`：锁定即 return（不接受新寻路）。
- `replayStep`：锁定即 return（回放步不得插进怪物行动的半途）。

**保底一（收尾汇聚）**：正常完成、锁超时、循环抛异常三条路径全部汇入 `finishAdvancement()`——关闭生成器、`isAdvancing = false`、跑一次回合收尾、`update()` 刷新画面。中途异常还会记录到 `lastAdvancementError`（测试/诊断观测点）。中止时把 `player.ticksUntilTurn` 归零，行动权立即交还玩家（未行动的怪物保留剩余 tick，随后续回合自然结算）。

**保底二（自过期）**：`isInputLocked() = isAdvancing && Date.now() < deadline`，deadline = 开始推进 + 5000ms。即便收尾代码因任何原因没有执行（例如某个未预见的调用链在锁定期内把推进状态弄丢），锁也会在 5 秒后自动失效——**结构上不存在"永久卡死"的状态**。

**场景重建防继承**：`startNewGame` / `loadSnapshot` 调用 `discardInFlightAdvancement()`，新场景绝不继承可能卡死的锁。

---

## 四、验收条款逐条对照

| # | 条款 | 结果 | 证据 |
|---|---|---|---|
| 1 | 豺狼（moveSpeed=50）玩家一次移动内行动两次 | ✅ | A2（spy 恰 2 次，终值 ticks=50；恒速架构下只会 1 次） |
| 1 | 食人魔（attackSpeed=200）两个玩家回合攻击一次 | ✅ | A3（三次等待 spy = 1,1,2；攻击后 ticks=200） |
| 1 | haste 行动翻倍 / slowed 减半 | ✅ | A4a（haste：100 速怪物每两动作行动一次）、A4b（slowed：一动作内行动两次）、A5（到期恢复） |
| 2 | 锁定期玩家输入被忽略 | ✅ | C1（不录制、不推进、stats.turns 不变） |
| 2 | autoPath 不在锁定期推进 | ✅ | C1（autoPath 与玩家坐标不变） |
| 3 | 推进循环内抛异常，锁仍解除、游戏不卡死 | ✅ | D1（见下方输出） |
| 4 | headless 400 回合不阻塞、与 P2-1 同量级 | ✅ | E1（animationEnabled 默认 false；实测 ~1s，上限 10s） |
| 5 | npm test 全绿、224 passed 不减少 | ⚠️ 239 passed / 3 failed | 3 个失败全部位于 `p2_1_tick_architecture.test.ts`，均为行为改变的必然结果（见"与预设不符"第 1 条）；未修改、未删除该文件 |
| 6 | npm run build 全绿 | ✅ | 见下方输出 |

### 反向验证（三条，均先改坏→测试失败→还原→全绿）

1. **haste 失效**（refreshSpeeds 不再减半）→ A4a、A5 失败：
   `Tests  2 failed | 16 passed (18)`（×A4a haste：玩家速度减半…；×A5 haste 到期后速度恢复…）
2. **输入锁失效**（isInputLocked 恒 false）→ C1、D1、D2 失败：
   `Tests  3 failed | 15 passed (18)`
3. **异常保底移除**（stepAdvancement 的 catch 改为 rethrow）→ D1 失败：
   `Tests  1 failed | 17 passed (18)`

（操作过程失误一次：还原第 1 条时误用 `git checkout src/entities/Creature.ts`，把本轮对该文件的改动一并还原了；发现后立即按原设计重写恢复，并以 p2_2 全绿 + p2_1 恰 3 个预期失败复核确认无损。此后改用 cp 备份/还原。）

### 异常路径测试输出（验收 3 重点项）

```
$ npx vitest run src/test/p2_2_real_speed.test.ts -t "保底"
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  1 passed (1)
      Tests  2 passed | 16 skipped (18)
```

D1 断言链：注入 `takeTurn` 抛错 → `stepAdvancement` 消费到该步后内部捕获 → `lastAdvancementError` 为该 Error → `isAdvancing/isInputLocked` 均为 false → `stats.turns` 恰 +1（收尾恰好一次）→ 玩家输入恢复接受（录制 +1）。D2 断言链：mock `Date.now` 越过 deadline → 一步内强制快进收尾 → 解锁、`stats.turns` +1、玩家立即可操作。

---

## 五、npm test / npm run build 完整输出尾部

### npm test（全量，最终态；`npm test -- --no-file-parallelism`）

```
 Test Files  1 failed | 26 passed (27)
      Tests  3 failed | 239 passed | 5 todo (247)
   Start at  12:33:01
   Duration  50.82s (transform 333ms, setup 0ms, import 1.25s, tests 46.45s, environment 6ms)
```

3 个失败（全部在 `src/test/p2_1_tick_architecture.test.ts`，**未修改该文件**）：

```
 FAIL ... P2-1 A > 4 seed × 400 回合玩法状态：玩家坐标 HP / 所在层 / 全部怪物位置与 HP 一致
 FAIL ... P2-1 B > B1 字段存在且初始口径正确：怪物满 TICKS_PER_TURN、玩家 0
 FAIL ... P2-1 B > B3 恒速口径：一个玩家动作后每只存活怪物恰好行动一次、ticks 归满、玩家归零
```

（B2a/B2b 通过，属真实速度下恰好兼容：seed 777 的首个非笼怪物是 Kobold（moveSpeed=100）。B2a 注入 150：豺狼的 50 相位使循环多迭代一轮，该怪余量恰好 50 且未行动——与断言同值。B2b 注入 50：第一迭代行动一次、按自身 movementSpeed=100 补满，第二迭代被 50 相位扣到 50——"恰好行动一次、余 50"在真实速度下依旧成立。两例都是特定物种组合下的巧合通过，不代表恒速断言仍有效。）

#### ⚠ 负载敏感的既有测试抖动（与本轮改动无关，已实验证明）

仓库位于云同步目录，全量并行（`npm test` 默认 file-parallelism）时，三个**未显式设置超时（vitest 默认 5s）的重负载测试**——`horde_terrain_spawn`（多 seed×D1-D26 统计）、`monster_damage_balance`（3 seed×2000 回合）——会在 worker 争抢 CPU 时越过 5s 上限而抖动失败。实验证据：

- 本轮代码隔离运行：balance 2.69s / 5s、stats_effect 7.43s / 60s，裕度充足；
- **stash 本轮全部改动、在纯 P2-1 代码上跑全量**：同样的 `horde_terrain_spawn` 超时失败同样出现、套件 tests 时间同样膨胀到 ~124s——排除本轮引入；
- 引擎本身未变慢：默认策略 2 seed×400 回合，P2-1 代码 129ms vs P2-2 代码 115ms；两个重测试在两版代码下隔离耗时 6.57s vs 7.16s（+9%，噪声级）；
- 关闭文件并行后（本节首的输出）连续稳定 239/3。

结论与建议：抖动是既有的"默认超时过紧 × 并行争抢"问题，机器负载低谷期 `npm test` 亦全绿（本轮 12:04 的全量运行即 239 passed/3 failed）。验收建议统一用 `npm test -- --no-file-parallelism`，或后续轮次给这三个测试补显式超时（超时参数在本轮禁改的既有测试文件内，故不动）。

### npm run build

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- ...（既有 chunk 体积提示，与 P2-1 相同）
✓ built in 1.39s
```

### git diff --stat

```
 brogue-web/src/components/GameCanvas.vue |  14 +-
 brogue-web/src/engine/Core/Game.ts       | 258 ++++++++++++++++++++++++++-----
 brogue-web/src/entities/Creature.ts      |  48 +++++-
 brogue-web/src/entities/Monster.ts       |  60 +++++--
 4 files changed, 325 insertions(+), 55 deletions(-)
```

未跟踪新增：`src/test/p2_2_real_speed.test.ts`、`src/test/fixtures/p2_2_baseline.json`、本报告。

---

## 六、新旧基线逐项差异成因

`p2_2_baseline.json` 格式与旧 fixture 一致（note/head/seeds/levels/play；head 记为 "p2-2 working tree (parent 77700d1, uncommitted)"，因改动不允许提交、无法钉 commit hash，新测试只断言 seeds 元数据）。

**levels 段（4 seed × D1-26）：与旧基线逐项相同**（新测试 F 显式断言新旧一致）。原因：生成期不消耗任何与速度相关的逻辑——Monster 构造器只是把初始 ticks 从恒 100 换成 `moveSpeed`，不消耗 RNG，也不改变生成顺序；D1 指纹逐层一致即为"速度未泄漏进生成"的证据。

**play 段（4 seed × 400 回合）**：

| seed | turnsRun | died | depth | 玩家 | 怪物列表 | 差异成因 |
|---|---|---|---|---|---|---|
| 424242 | 400→400 | F→F | 1→1 | (44,19)→(26,12) | 4→1 只：Rat×1、Kobold×1 消失；Jackal 2→1 | D1 有 2 只 Jackal（moveSpeed=50）。豺狼每个玩家行动日行动两次：睡醒/游荡推进快一倍、接触玩家的时点大幅提前；harness 默认策略"相邻即攻击"更早转入接敌，玩家随机游走的 rng 消耗序列从首次豺狼提前行动处开始分岔 → 400 回合后玩家走到完全不同的位置，沿途接敌击杀数不同（旧基线多 3 只存活怪）。**第一推动力是豺狼双速，之后的一切分岔都是 rng 流位移的级联** |
| 777 | 400→400 | F→F | 1→1 | (44,12)→(47,17) | 7→3 只：Jackal 5→2、Kobold 2→1 | 同上。D1 五只 Jackal（50）双速行动，玩家更早被围咬并反击；旧基线里豺狼按 100 速游荡、远未接敌，故终局存活怪多 4 只、玩家位置完全不同 |
| 20260913 | 400→400 | F→F | 1→1 | (39,14)→(39,14) 完全一致 | 10→10 只，**逐只逐位一致** | D1 虽有 Jackal，但它们整局保持沉睡且从未进入唤醒范围（沉睡怪的 takeTurn 唤醒判定是纯几何检查，不消耗 rng，也不产生差异化行动）。全场行动物种（Rat/Kobold/Monkey）速度均 100/100，玩家的泥泞/拾取口径在 P2-1 的 tick 调度下本就不生效——**没有任何一次速度差异化的行动进入 400 回合，故整局逐位复现**。这从反面验证了速度只在"速度≠100 的怪物实际行动"时改变行为 |
| 31337 | 400→400 | F→F | 1→1 | (35,14)→(28,17) | 6→5 只：Jackal 1→0 | D1 单只 Jackal（50）双速：它更早苏醒/游荡至玩家侦测圈，接敌时点改变 → rng 流位移 → 玩家路径改变，该豺狼在新基线中被提前接敌击杀（这也是终局少 1 只怪的直接原因） |

通用说明：四条 seed 的 turnsRun 均 400、无人死亡、均在 D1——与旧基线一致（harness 策略下 400 回合不足以死亡/下楼到改变 depth 的程度）；玩家 HP 均 30/30 满值（300 回合回满机制覆盖了两局中的全部战斗损耗，两边相同）。

---

## 七、与预设不符之处（只列不修，含提示词本身的错误）

1. **"原有 224 passed 不得减少"与"仅旧 fixture 比对测试会失败"的预设不完整**。实际 224→221（总量 247 中 239 passed / 3 failed），3 个失败全部是 P2-1 轮次的**恒速契约测试**，它们断言的正是本轮要推翻的行为：
   - `A 4 seed × 400 回合玩法状态…`：与 p2_baseline 的玩法对照——提示词已预期（行为必然改变）；
   - `B1 初始口径：怪物满 TICKS_PER_TURN`：真实速度下怪物初始 ticks = moveSpeed（Monsters.c:116），豺狼为 50，断言 `=== 100` 必然失败——提示词未预期，但这是验收条款 1"速度生效"的直接推论；
   - `B3 恒速口径：每只怪物恰好行动一次…`：豺狼双速后一个玩家动作内行动两次，断言 `≤1` 必然失败——同上。
   另一个反向偏差：A 段的 levels 对照测试**通过了**（生成期不受速度影响），比提示词预期的"旧 fixture 比对测试会失败"范围更小。以上均按约定不改不删，交验收方裁定（建议方向：下轮把 B1/B3 的恒速断言迁移为"按 moveSpeed 断言"，A 段玩法对照退役并以 p2_2_baseline 接替）。
2. **ITEM_ATTACKS_STAGGER / ITEM_ATTACKS_QUICKLY 无法实现**：提示词 §1.1 引用的 `playerRecoversFromAttacking` 含这两个武器修正分支，但 web 的武器数据模型没有 flags 字段（`weapons.json` 的键集仅 damage/description/excludeFromGeneration/id/name/source/strengthRequired/weight，已核实），而 `Item.ts`、`src/data/*` 均在禁改清单。已只实现主路径 `ticksUntilTurn += attackSpeed`，两个分支留待武器标志接线轮次。
3. **提示词行号小偏差**：haste/slow 的速度改写在 `Items.c:4637-4660`（slow 在 4637，haste 在 4650），提示词写 4644-4659；语义无出入，以 CE 为准。
4. **发现并修复了 stepAutoPath 双重推进 bug**（见第二节末）：提示词未提及。这是既有缺陷而非本轮引入，但它直接决定自动寻路的时间流速，修复本身也是一次行为变化（已包含在新基线与差异解释中）。
5. **"祭坛 50" 的实际影响面比提示词描述的小**：祭坛取物的 `+= 50` 只是簿记，其调度在 P2-1 就走统一的 playerTurnEnded（恒 100），本轮只是把簿记归一，无调度行为变化。真正有调度影响的新增耗时只有玩家攻击进入 attackSpeed 口径。
6. **CE 细则未复刻（提示词 §1.2 的简化口径照做，列此备查）**：
   - Monsters.c:3363 的默认 `ticksUntilTurn = movementSpeed/3`（怪物一回合内既未移动也未攻击时的记账）未实现——web 的 takeTurn 没有对应的"空转"出口分类，本轮按提示词四条规则落账；
   - Monsters.c:3367-3373 沉睡怪物醒来整回合只花 movementSpeed（web 的苏醒当回合即行动）；
   - MONST_GETS_TURN_ON_ACTIVATION（数据中 stone_guardian 等 4 种）每客观周期获得行动的机制 web 本就没有实现，其速度无从接入；
   - CE 的 slow()/haste() 互相清除对方状态（互斥），web 未复刻——当前不存在同时施加的路径（玩家只能吃到 haste/hasted，怪物只能吃到 slowed），不可达；
   - 状态时长仍按"每玩家回合 -1"递减而非客观 100 tick（P2-3 范围，提示词 §三已豁免）。
7. **测试房间怪物的速度口径**：快照/测试房间的怪物反序列化数据不含 moveSpeed/attackSpeed，重建后为 100/100。仅影响 test 模式展示层，不影响普通玩法。
8. **`window.advanceTime` 自动化钩子不驱动动画推进**：它只推进 replay/autoPath/update；逐次动画由 PixiJS 真实 ticker 驱动。若自动化验收需要在无头浏览器里快进动画，需要单独约定（例如给 advanceTime 增加 tickAdvancement 调用），本轮未动它。
9. **既有测试的负载敏感抖动**（详见第五节"⚠"块）：`horde_terrain_spawn`、`monster_damage_balance` 未设显式超时（vitest 默认 5s），并行争抢下可抖动失败；已用 stash 对照实验证明与本轮改动无关（纯 P2-1 代码同样复现），引擎隔离耗时两版持平。建议验收采用 `npm test -- --no-file-parallelism`，显式超时的补充属后续轮次（既有测试文件禁改）。
10. **本轮操作事故一次**：反向验证①还原时误用 `git checkout src/entities/Creature.ts`，将本轮对该文件的未提交改动一并还原；当即发现并按原设计重写恢复，经 p2_2 全绿 + p2_1 恰 3 预期失败复核确认无损。工作区最终状态以 `git diff`/`git status` 为准（4 个修改文件 + 3 个新增文件，无多余改动）。

---

## 八、遗留与建议

- p2_1 测试文件的去留与改写（见第七节第 1 条）需验收方裁定。
- `window.advanceTime` 与动画的联动、动画跳过键、`MONST_CAST_SPELLS_SLOWLY` 的实际施法分流（web 目前 ranged 攻击即视为施法出口）建议随 P2-3 一并处理。
- 客观时间门（法杖充能、渐进鉴定、刷怪 fuse、怪物状态递减、updateEnvironment）按计划留 P2-3。
