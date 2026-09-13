# 饥饿与回血机制对齐 CE — 交付报告

日期：2026-09-14
范围：`src/entities/Player.ts`、`src/data/consumables.json`、`src/components/Sidebar.vue`、`src/engine/Core/Game.ts`（仅饥饿状态处理与回血调用点）
参照源码：`BrogueCE-master/src/brogue/`（本地 CE 源码，行号均出自该目录）

## 一、结论

四条偏差全部修复，验收 1–7 全部通过。测试 **130 passed**（原有 112 + 新增 18，原有数量未减），构建全绿。3 seed × 2000 回合实测：**正常游走节奏下玩家不会在 2000 回合内饿死**——恰好在第 2000 回合进入 Weak；若完全不进食，则在第 2150 回合 nutrition 归零、第 2179 回合饿死（30 HP 池逐回合扣完），整条链路按 CE 语义运行。

## 二、npm test / npm run build 输出尾部

```
$ npm test
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  16 passed (16)
      Tests  130 passed | 1 expected fail | 7 todo (138)
   Start at  03:40:02
   Duration  2.69s (transform 1.11s, setup 0ms, import 1.93s, tests 6.81s, environment 3ms)
```

（130 = 原有 112 + 新增 hunger_regen.test.ts 15 例 + hunger_curve_sim.test.ts 3 例；原有的 1 expected fail 与 7 todo 均为既有用例，未触碰。）

```
$ npm run build
> vue-tsc -b && vite build

dist/assets/index-DUkEY7sD.js   872.17 kB │ gzip: 275.34 kB
(!) Some chunks are larger than 500 kB after minification. ...（既有警告，非本次引入）
✓ built in 1.38s
```

## 三、git diff --stat

```
 brogue-web/src/components/Sidebar.vue | 13 +++--
 brogue-web/src/data/consumables.json  |  2 +
 brogue-web/src/engine/Core/Game.ts    | 40 +++++++++++----
 brogue-web/src/entities/Player.ts     | 93 +++++++++++++++++++++++++----------
 4 files changed, 106 insertions(+), 42 deletions(-)
```

新增文件：`src/test/hunger_regen.test.ts`（验收 1–4 断言）、`src/test/hunger_curve_sim.test.ts`（验收 7 实测，可复跑）。

## 四、CE 常量出处（本地 BrogueCE-master 实测行号）

| 常量 | 值 | 出处 |
|---|---|---|
| `TURNS_FOR_FULL_REGEN` | 300 | `Rogue.h:1123` |
| `STOMACH_SIZE` | 2150 | `Rogue.h:1124` |
| `HUNGER_THRESHOLD` | `STOMACH_SIZE - 1800` = 350 | `Rogue.h:1125` |
| `WEAK_THRESHOLD` | 150 | `Rogue.h:1126` |
| `FAINT_THRESHOLD` | 50 | `Rogue.h:1127` |
| ration of food 恢复量 | 1800 | `Globals.c:1578`（`foodTable[].power` 字段） |
| mango 恢复量 | 1550 | `Globals.c:1579`（`foodTable[].power` 字段） |
| 进食上限语义 | `min(power + nutrition, STOMACH_SIZE)` | `Items.c:7491` |
| 回血速率推导 | `updatePlayerRegenerationDelay()`：300 回合回满整个 HP 池 | `Items.c:8735-8750` |
| 回血/饿死每回合应用 | nutrition ≤ 0 扣 1 HP/回合；否则 hp<maxHp 且未中毒才回血 | `Time.c:2524-2541` |
| 阈值提示（一次性） | 350/150/50 三档各触发一条消息 | `Time.c:927-968`（`checkNutrition`） |
| 状态栏文案分档 | 无/Hungry/Weak/Faint | `IO.c:4785-4793` |
| 开局满胃 | `STATUS_NUTRITION = STOMACH_SIZE` | `Monsters.c:3923`、`RogueMain.c:1132` |

## 五、四条偏差修改前后对照

### 偏差 1：回血不随 maxHp 缩放 → 改为 maxHp/300 带累加器

**修改前**（`Player.ts`）——固定 10 回合/HP（饥饿档位 25 回合/HP）：

```ts
let healThreshold = 0;
if (this.nutrition > 6000) { healThreshold = 10; }
else if (this.nutrition > 2000) { healThreshold = 25; }
...
if (healThreshold > 0 && this.turnsSinceLastHeal >= healThreshold) {
    if (this.hp < this.maxHp) { this.hp += 1; }
    this.turnsSinceLastHeal = 0;
}
```

**修改后**——`regenCarry` 累加器逐回合累积 `maxHp/300`，满 1 整数化入 HP，余量保留（无整数除法丢精度）：

```ts
if (this.hp < this.maxHp && !this.hasStatus('poisoned')) {
    this.regenCarry += this.regenRatePerTurn();      // maxHp / TURNS_FOR_FULL_REGEN
    if (this.regenCarry >= 1) {
        const wholeHp = Math.floor(this.regenCarry);
        this.hp = Math.min(this.maxHp, this.hp + wholeHp);
        this.regenCarry -= wholeHp;
        if (this.hp >= this.maxHp) { this.regenCarry = 0; }
    }
}
```

实测回满回合（从 1 HP 起，即验收 1）：

| maxHp | 修改前 | 修改后（实测） |
|---|---|---|
| 30 | 290 回合（满血耗时恰好 300 的说法只对此档成立） | **291 回合 ≤ 300** |
| 60 | 590 回合 | **295 回合 ≤ 300** |
| 100 | 990 回合 | **297 回合 ≤ 300** |

从 1 HP 起的净恢复量是缺口而非整池，故略快于 300（CE 同样如此：300 回合回满的是整个 maxHP 池）；关键对比是 maxHp=100 时旧实现 990 回合 vs 新实现 ≤300，已随上限缩放。浮点对齐导致首跳在第 11 回合（0.1×10 = 0.999…），故 291 而非 290，偏差 1 回合、方向偏慢，可忽略。

### 偏差 2：饥饿阈值语义错 → 2150/350/150/50，解除回血耦合

**修改前**：`nutrition = maxNutrition = 12000`；6000/2000 是回血档位（10/25 回合每 HP）；`<= 0` 每 10 回合扣 1 HP。

**修改后**（`Player.ts`，常量与 `Rogue.h:1124-1127` 一一对应）：

```ts
export const TURNS_FOR_FULL_REGEN = 300;              // Rogue.h:1123
export const STOMACH_SIZE = 2150;                     // Rogue.h:1124
export const HUNGER_THRESHOLD = STOMACH_SIZE - 1800;  // 350, Rogue.h:1125
export const WEAK_THRESHOLD = 150;                    // Rogue.h:1126
export const FAINT_THRESHOLD = 50;                    // Rogue.h:1127
```

- `nutrition`/`maxNutrition` 起始值 12000 → **2150**（CE 开局满胃，`Monsters.c:3923`）。
- 阈值只产生 `hungerState`（normal/hungry/weak/faint/starving）与一次性提示，**不再影响回血速度**（`computeHungerState` 仅做状态归类，测试断言 weak 档与饱食档同速回满）。
- nutrition ≤ 0：每回合扣 1 HP（旧实现每 10 回合扣 1），扣至 0 由既有死亡管线以 `lastDamageSource='starvation'` 判定饿死——与 CE `Time.c:2525-2530` 一致。
- 状态转移由 `Game.ts` 在 `updateNutrition()` 调用点旁逐条记日志（对应 CE `checkNutrition` 的一次性消息）：hungry/weak/faint/starving 各一条，不重复刷屏。
- **Weak 力量惩罚**：CE 的饥饿 weak **不设置任何力量惩罚**——`player.weaknessAmount` 仅由 `weaken()`（削弱毒素，`Items.c:4557-4568`）设置，饥饿侧在 `Time.c:941-944` 只发消息。因此本实现同样只做提示，未触碰 web 的 `weakened` 状态（那是毒素机制，与饥饿弱是两回事，复用反而引入 CE 没有的联动）。详见第七节第 1 条。
- **Faint**：CE 无「随机失去回合」逻辑，同样只做提示与显示文案（见第七节第 2 条）。

### 偏差 3：中毒期间回血归零

**修改前**：`updateNutrition` 无任何 `poisoned` 判定，中毒照常回血。
**修改后**：回血分支前置条件 `this.hp < this.maxHp && !this.hasStatus('poisoned')`，对应 CE `Time.c:2531-2534` 的 `else if (player.currentHP < player.info.maxHP && !player.status[STATUS_POISONED])`。测试断言：poisoned 400 回合内 300 回合 HP 纹丝不动，毒素到期后回血恢复。

### 偏差 4：食物恢复量 → ration 1800 / mango 1550

**修改前**（`consumables.json`）：无恢复量字段；`Game.eatItem` 一律 `this.player.nutrition = this.player.maxNutrition`（直接回满，ration 与 mango 无差别）。

**修改后**：
- `consumables.json` 为两份食物新增 `"nutrition"` 字段：ration_of_food **1800**、mango **1550**（CE `Globals.c:1578-1579` 的 `foodTable[].power`）。
- `Game.eatItem`（`Game.ts`，nourish 分支）：

```ts
// CE Items.c:7491: nutrition = min(food.power + nutrition, STOMACH_SIZE)
const restore = (data as ConsumableConfig & { nutrition?: number }).nutrition ?? 0;
this.player.nutrition = Math.min(this.player.maxNutrition, this.player.nutrition + restore);
```

测试断言：nutrition=100 吃 ration → 1900；吃 mango → 1650；nutrition=2100 吃 ration → 2150 封顶（不超过 `maxNutrition`）。

## 六、连带影响：Sidebar.vue 显示同步

原逻辑 `>6000 饱食 / >2000 饥饿 / >0 极度饥饿 / ≤0 虚脱`——阈值改小后玩家将永远看到「饱食」（nutrition 最高只有 2150）。已改为直接 import `Player.ts` 导出的 CE 常量，与 `computeHungerState` 严格同档：

| nutrition 区间 | CE 状态栏（IO.c:4785-4793） | 新显示 | 颜色 |
|---|---|---|---|
| > 350 | （无标签） | 饱食 | 绿 |
| 151–350 | Hungry | 饥饿 | 黄 |
| 51–150 | Weak | 虚弱 | 橙红 |
| 1–50 | Faint | 昏厥 | 红 |
| ≤ 0 | （饿死中） | 饿死 | 深红 |

初始 ref 同步 12000 → `STOMACH_SIZE`。

## 七、与预设不符之处（只列不修，含提示词本身的偏差）

1. **「Weak 附带力量惩罚（CE 的 `player.weaknessAmount` 语义）」——CE 实际没有饥饿力量惩罚。** 全源码检索确认 `weaknessAmount = N`（非零赋值）只出现在 `weaken()`（`Items.c:4557-4568`，削弱毒素/沼泽），饥饿路径唯一的联动是 `Time.c:941-944` 的提示消息。CE 的 weak-from-hunger 只是消息 + 状态栏文案。故按「对齐 CE」的总目标只做提示，未给 web 附加力量惩罚；web 的 `weakened` 状态属于毒素机制，未复用（复用会制造 CE 不存在的饥饿→力量联动）。提示词本身也预留了「没有就只做提示并在报告中说明」，此处补充：不是 web 缺等价物，而是 CE 根本不做此惩罚。
2. **「Faint 会随机失去回合」——CE 无此逻辑。** `FAINT_THRESHOLD` 在 CE 中仅两处使用：`Time.c:945-948`（一次性提示消息）与 `IO.c:4792`（状态栏文案 "Nutrition (Faint)"）。没有任何失去回合的实现。故未实现，只做提示与显示。
3. **「maxHp=30 下满血耗时恰好 300 回合，与 CE 一致」——只在 maxHp=30 且从空池起算时数值巧合。** CE 语义是 300 回合回满整个 HP 池（随 maxHp 缩放），web 旧实现固定 10 回合/HP，maxHp=30 从 1 HP 起需 290 回合、maxHp=100 需 990 回合。回血速度「不偏快」的结论正确，但机制本身已按偏差 1 重做。
4. **验收 3 的触发时点。** 「不进食时 2150 回合后进入饿死判定；期间在 350/150/50 三点各触发一次」实测为：hungry@**1800**、weak@**2000**、faint@**2100**、starving@**2150**（从满胃 2150 起、每回合扣 1）。阈值是绝对 nutrition 值而非「剩余回合数」，触发回合 = 2150 − 阈值，与 CE 行为一致。

### 其他未覆盖的 CE 行为（同样只列不修）

- CE 瘫痪（paralyzed）期间不消耗 nutrition（`Time.c:2214-2215`）；web 未实现该豁免。
- CE 携带 Amulet of Yedor 时 nutrition 仅 20% 概率消耗（`Time.c:2216`）；web 未实现（web 亦无完整 amulet 机制）。
- CE 在 nutrition ≤ 1 且包内有食物时会强制进食（`Time.c:949-963`）；web 未实现，玩家必须手动吃。
- CE 饥饿提示在无食物时追加 "and have no food"（`Time.c:930-934`）；web 提示未附加。
- CE 在不够饿时进食会提示 "not yet hungry"（`Items.c:7482`）；web 照常进食。
- CE 回血速率受 `rogue.regenerationBonus`（再生附魔）修正（`Items.c:8742-8745`、`PowerTables.c:134`）；web 无该附魔体系。web 自创的 `regenerating` 状态（CE 无 `STATUS_REGENERATING`）保留，其加速幅度沿用旧实现的 0.6 倍回满时间（实测 maxHp=30 从 1 HP 起 174 回合），这是 web 扩展而非 CE 行为。
- 旧存档兼容：snapshot 本就保存 `nutrition`/`maxNutrition`，旧档（12000/12000）载入后按新阈值曲线运行（会维持「饱食」很久），未做数值迁移。

## 八、2000 回合饥饿曲线实测（harness，验收 7）

运行方式：`src/test/hunger_curve_sim.test.ts`，`createHeadlessGame(seed)` 逐回合 `handlePlayerAction`，曲线数据由测试 console 输出（可随时复跑）。

**roam 策略（攻击相邻敌人/随机移动，模拟真实节奏）× 2000 回合，3 seed 全部存活：**

| 回合 | 0 | 250 | 500 | 750 | 1000 | 1250 | 1500 | 1750 | 2000 |
|---|---|---|---|---|---|---|---|---|---|
| nutrition | 2150 | 1900 | 1650 | 1400 | 1150 | 900 | 650 | 400 | 150 |
| 状态 | 饱食 | 饱食 | 饱食 | 饱食 | 饱食 | 饱食 | 饥饿 | 饥饿 | 虚弱 |

三个 seed（1/7/42）曲线完全一致（nutrition 每回合恒定 −1，不受 rng 影响），转移点均为 hungry@1800、weak@2000，HP 满血（回血正常工作）。**2000 回合窗口内不会饿死**；但曲线说明不进食的玩家将在 2150 回合见底——新曲线比旧 12000 严峻 5.6 倍，食物从「几乎用不上」变为「战略资源」，符合预期。

**seed 1 延长至 2300 回合（完整饿死链路）：** hungry@1800 → weak@2000 → faint@2100 → **starving@2150 → 第 2179 回合饿死**（cause=starvation，30 HP 从 2150 起逐回合扣完）。

**wait 策略（原地站桩）× 3 seed：** 均在 49/78/205 回合被 Jackal/Kobold 击杀——纯站桩观察不到饥饿曲线，死亡原因是战斗而非饥饿，如实记录。

## 九、验收清单

| # | 验收项 | 结果 |
|---|---|---|
| 1 | maxHp=30 与 maxHp=100 从 1 HP 起 300 回合内回满 | ✅ 291 / 297 回合 |
| 2 | poisoned 状态 300 回合 HP 不增长 | ✅ |
| 3 | 2150 回合进入饿死判定；350/150/50 三点各触发一次状态变更 | ✅ 350/150/50/0 → hungry/weak/faint/starving 各一次（回合 1800/2000/2100/2150） |
| 4 | ration 恢复 1800 且不超过上限 | ✅ 100→1900；2100→2150 封顶；mango 100→1650 |
| 5 | `npm test` 全绿，原有 112 passed 不减 | ✅ 130 passed = 112 + 新增 18 |
| 6 | `npm run build` 全绿 | ✅（chunk 体积警告为既有现象） |
| 7 | harness 3 seed × 2000 回合饿死评估 | ✅ 2000 回合内不饿死（第 2000 回合恰入 Weak）；完全不吃 2150 归零、2179 饿死 |
