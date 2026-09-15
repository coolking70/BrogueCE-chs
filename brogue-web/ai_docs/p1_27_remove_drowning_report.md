# P1-27 报告：按决策 D2 移除自创的"深水淹死"

日期：2026-09-15
改动文件：`src/engine/Core/Game.ts`（+39/−9）、新增 `src/test/p1_27_remove_drowning.test.ts`（9 条）
未触碰：`src/test/scroll_effects.test.ts`、`src/engine/UI/DetailGenerator.ts`、全部 `src/data/*.json`、全部 `src/test/fixtures/*`、`src/engine/Random.ts`、`src/engine/Environment/Gas.ts`、`src/entities/Creature.ts`、`src/test/p1_24_death_sink.test.ts`

---

## 〇、与任务书预设不符之处（开头单列，按授权反驳条款）

### 1. ★ 门禁"npm test 必须全绿"在文件边界内不可达成——p1_24 有 7 条测试锁定的正是本轮移除的机制

`src/test/p1_24_death_sink.test.ts`（上一轮我按当时任务书写的 14 条）里有 **7 条**
以"深水淹死会发生"为前提：对抗性①（3 条：淹死后 hp=0/被清扫/不苏醒）、
对抗性② 水分支（drowns 消息只播 1 次）、对抗性④ 水（2 条：水淹死的 bloat
放毒气/爆燃）、玩家深水 game over。**移除淹死后它们必然变红——这与本轮 9 条
新测试（"深水里必须活着"）逻辑上不可同时成立。**

处置：任务书的允许修改清单只有 `Game.ts` + 新增测试文件，5.2 约定"已有测试
一律不得修改，除非提示词明确许可"，且提示词只对 scroll_effects 说过
"不许改那条测试来迁就"。**我没有动 p1_24 文件**，按 p2_3_baseline 同款待遇
如实报告（§七）：

- 这 7 条红是**本轮的预期后果**，不是回归；其"die() 是真死透"的核心意图
  仍被同文件的熔岩/火焰/蒸汽/战斗 7 条锁住（全部继续绿）。
- 需要验收方裁决：a) 授权后续轮把这 7 条改为断言"深水不致死"（其场景
  已是 CE 不存在的自创内容）；或 b) 认定不可接受并回退本轮。
- 除此之外**其余 453 条全绿**，基线（p2_3 / generation）无一变红。

### 2. 任务书的熔岩豁免表述不完整——CE 是三条豁免，不是两条

任务书说"CE 的豁免条件是'悬浮 或 火焰免疫'"。CE 源码
（`applyInstantTileEffectsToCreature`，Time.c:183-190）实际是：

```c
if (!(monst->status[STATUS_LEVITATING]) &&        // 悬浮
    !(monst->status[STATUS_IMMUNE_TO_FIRE]) &&    // 火焰免疫
    !(monst->info.flags & MONST_INVULNERABLE) &&  // 无敌（第三条）
    !cellHasTerrainFlag(..., T_ENTANGLES | T_OBSTRUCTS_PASSABILITY) &&
    !cellHasTMFlag(..., TM_EXTINGUISHES_FIRE) &&
    cellHasTerrainFlag(..., T_LAVA_INSTA_DEATH))
```

按"提示词与 CE 冲突时以 CE 为准"，**已把第三条豁免一并对齐**（这正是任务书
说的 P1-24 报告"第 3 项"，§八.3 早有申报：web 的 Warden of Yendor 此前会被
岩浆烧死）。任务书要求的第 4 条测试（悬浮/火免不死）照做，另加无敌豁免的
对抗性测试（RV3 证明它真能咬住"漏掉第三条豁免"的实现）。

其余事实核对**全部属实**：`Rogue.h:1932/1937` 两行注释逐字一致；全 CE 源码
drown 零匹配；深水 tile（Globals.c:413 DEEP_WATER）只有
`T_IS_FLAMMABLE | T_IS_DEEP_WATER` + `TM_EXTINGUISHES_FIRE` 等，**无任何伤害旗标**。

### 3. CE 熔岩条款的另外两个地形条件对纯岩浆格恒空，无需对齐

`T_ENTANGLES | T_OBSTRUCTS_PASSABILITY` 与 `TM_EXTINGUISHES_FIRE` 两个
条件在 CE 的 4 个带 `T_LAVA_INSTA_DEATH` 的 tile（Globals.c:420-422 LAVA 系、
:545 SACRIFICE_LAVA）上**一个都不成立**（熔岩不带这些旗标），故 web 按
`terrain === LAVA` 分支与 CE 逐条判据等价。已在代码注释中说明。

---

## 一、改动清单

### 1.1 `src/engine/Core/Game.ts` —— 唯一改动文件（+39/−9）

**(a) 新增模块级 D2 标志（跟在 `DISCORD_DURATION` 常量块后）**

```ts
const WEB_ONLY_DEEP_WATER_DROWNING: boolean = false;
```

附完整注释：CE 无淹死机制（全源码 grep drown 零匹配）、两行 Rogue.h 旗标
依据、深水 tile 无伤害旗标、坠落零伤害（Time.c:1146-1150）。二次开发改回
`true` 即可恢复自创机制——与 P1-21 的 D2 手法（保留代码、退出生效路径、
标志可再启用）一致。

**(b) `applyEnvironmentalEffects()` 深水分支**：致死代码（玩家的
triggerGameOver / 怪物的 die() 与两条消息）**原样保留**在
`if (WEB_ONLY_DEEP_WATER_DROWNING)` 内，实际游戏中不再可达。分支外壳
`WATER_DEEP && !isFlying` 保留；标志为 false 时分支为空，落到后续火焰/毒气
结算（与 CE 一致：气体、火焰对水中生物照常生效，深水本身不提供任何豁免）。

**(c) 熔岩分支豁免补第三条**：

```diff
-  } else if (cell.terrain === TerrainType.LAVA && !isFlying && !entity.hasStatus('immune_fire') && !(entity.abilities && entity.abilities.has('immune_fire'))) {
+  } else if (cell.terrain === TerrainType.LAVA && !isFlying
+      && !entity.hasStatus('immune_fire')
+      && !(entity.abilities && entity.abilities.has('immune_fire'))
+      && !(entity.isInvulnerable && entity.isInvulnerable())) {
```

`isInvulnerable()` = `hasBehavior('MONST_INVULNERABLE')`（Monster.ts:398-400，
P4-3 已建立）；`entity.isInvulnerable &&` 守卫兼容无此方法的 Player（CE 玩家
不可能有无敌旗标，语义无损）。

### 1.2 `src/test/p1_27_remove_drowning.test.ts` —— 新增 9 条（全绿）

---

## 二、CE 依据（事实链）

| 依据 | 位置 | 内容 |
|---|---|---|
| 深水无伤害 | Rogue.h:1937 | `T_IS_DEEP_WATER = Fl(13)` 注释：只偷物品（50%）并随机移位 |
| 唯一即死地形 | Rogue.h:1932 | `T_LAVA_INSTA_DEATH = Fl(8)`：杀非悬浮、非火免生物（注释原文未提无敌，条款体 Time.c:185 有第三豁免） |
| 全源码无淹死 | `grep -rn drown BrogueCE-master/src` | 零匹配（P1-24 §一.1 首证，本轮复核） |
| 坠入深水零伤害 | Time.c:1146-1150 | "You fall into deep water, unharmed." |
| 深水 tile 无伤害旗标 | Globals.c:413 | DEEP_WATER 仅有 T_IS_FLAMMABLE / T_IS_DEEP_WATER 等，无 T_CAUSES_DAMAGE |
| 熔岩即死的豁免 | Time.c:183-190 | 悬浮、火免、MONST_INVULNERABLE 三条 + 两个对熔岩恒空的地形条件 |
| 熔岩 tile 旗标 | Globals.c:420-422, :545 | LAVA 系只有 T_LAVA_INSTA_DEATH，无 ENTANGLES/EXTINGUISHES_FIRE |
| MONST_INVULNERABLE 全表唯一使用者 | Globals.c monsterCatalog | Warden of Yendor（web `monsters.json` behaviorFlags 同样带此标志，测试前置已断言） |

## 三、熔岩豁免条件的核对结论（任务书必答项）

**web 原有豁免（悬浮/飞行、火免状态/火免能力）与任务书所述两条一致但比 CE
少一条；已对齐为 CE 的三条**：悬浮 或 火焰免疫 或 MONST_INVULNERABLE 的生物
在熔岩上不死。第三条由新测试用 Warden of Yendor 锁死（改动前的 web 该测试
必挂，见 RV3）。两个附加地形条件对熔岩 tile 恒空，无需也无法对齐（§〇.3）。

## 四、对 P1-25 的影响说明（任务书必答项，未动手）

`Game.canMoveTo` 排除 `WATER_DEEP` 的那条**原样未动**。但 P1-25 记录的
"击退不推进深水"理由——"web 深水即死，忠实实现会造出 CE 没有的秒杀"——
**自本轮起不再成立**：深水已不致死，把击退推进深水不再产生 CE 没有的秒杀，
只剩"CE 深水会偷物品/移位而 web 尚未实现"的旧分歧（属"明确不做"的独立轮次）。
该条是否放开、何时放开，留验收方重新裁决。

## 五、对抗性测试 → 各自捕获的错误实现（9 条全绿）

文件 `src/test/p1_27_remove_drowning.test.ts`：

| 测试 | 捕获的错误实现 | 失败方式（RV 实测） |
|---|---|---|
| 对抗性①：怪站深水 5 回合仍满血存活 | 旧自创淹死（或任何深水致死实现）：第一轮就 die() | RV1：`expected +0 to be 6` |
| 对抗性①续：存活怪经 playerTurnEnded 清扫仍在场 | "把致死挪进回合收尾"的变体 | RV1 连带失败 |
| 对抗性②：玩家站深水 5 回合无 game over | 旧玩家分支 triggerGameOver | RV1：`expected true to be false` |
| 对抗性②续：玩家+怪同泡深水谁也不死 | **部分移除**（只删玩家分支漏删怪物分支，或反之） | RV1：`expected +0 to be 7` |
| 对照组：普通怪站熔岩仍即死 | "水/岩浆即死分支整体退役" | RV2：`expected 6 to be +0` |
| 对照组：玩家站熔岩仍 game over | 同上 | RV2：`expected false to be true` |
| 豁免：悬浮生物站熔岩不死 | 豁免条件被删/写反 | （RV2 下平凡通过；牙齿由"熔岩仍即死"对照组反向保证） |
| 豁免：火免生物站熔岩不死 | 同上 | 同上 |
| 对抗性③：MONST_INVULNERABLE 生物站熔岩不死 | **改动前的 web**：缺 CE 第三豁免，Warden 被烧死（P1-24 §八.3 的缺口） | RV3：`expected +0 to be 1000` |

任务书要求的 4 类测试全部覆盖：深水怪物存活（①+续）、玩家深水无 game over
（②+续）、熔岩仍即死（对照组×2）、熔岩豁免（悬浮/火免 + 无敌共 3 条）。

## 六、反向验证（真实改坏 → 真实失败输出 → 还原；每组跑完立即还原）

### RV1：`WEB_ONLY_DEEP_WATER_DROWNING` 改回 `true`（恢复自创淹死）→ 捕获深水 4 条

```
 × 对抗性①：怪物站在深水里连续若干回合必须仍然满血存活。…
 × 对抗性①（续）：存活怪物经回合清扫（playerTurnEnded）后仍在场上。…
 × 对抗性②：玩家站在深水里连续若干回合不得 game over，hp 不得被扣。…
 × 对抗性②（续）：满血怪物与玩家同时泡在深水里，谁也不死、无任何 drowns 消息。…
AssertionError: expected +0 to be 6 // Object.is equality      ← 老鼠第一轮被淹死
AssertionError: expected +0 to be 6 // Object.is equality      ← 清扫后不在场
AssertionError: expected true to be false // Object.is equality ← 玩家 game over
AssertionError: expected +0 to be 7 // Object.is equality      ← kobold 被淹死
      Tests  4 failed | 5 passed (9)
```

恰好且仅深水 4 条失败，熔岩 5 条不受影响——判别方向正确。

### RV2：熔岩分支整体短路（`else if (false && …)`，模拟"顺手把熔岩也关掉"）→ 捕获对照组 2 条

```
 × 对照组：普通怪物站在熔岩上必须即死——防止"顺手把熔岩也关掉"。…
 × 对照组（玩家）：玩家站熔岩仍然 game over。…
AssertionError: expected 6 to be +0 // Object.is equality
AssertionError: expected false to be true // Object.is equality
      Tests  2 failed | 7 passed (9)
```

### RV3：删掉无敌豁免（还原改动前的熔岩条件）→ 捕获对抗性③

```
 × 对抗性③（本轮对齐项）：MONST_INVULNERABLE 的生物站熔岩不死。…
AssertionError: expected +0 to be 1000 // Object.is equality   ← Warden 被烧死
      Tests  1 failed | 8 passed (9)
```

### 还原确认

```
 brogue-web/src/engine/Core/Game.ts | 48 +++++++++++++++++++++++++++++++-------
 1 file changed, 39 insertions(+), 9 deletions(-)
 ❯ src/test/p1_27_remove_drowning.test.ts (9 tests) 373ms
      Tests  9 passed (9)
```

最终 `git status`：仅 `M src/engine/Core/Game.ts` + 新增测试文件与报告，无调试残留。

## 七、门禁与基线变红情况（如实，分项写清）

### 7.1 改动前基线（复核 P1-24 报告数字）

```
 npx vitest run --no-file-parallelism
 Test Files  1 failed | 41 passed (42)
      Tests  1 failed | 450 passed | 7 skipped | 5 todo (463)
```

唯一红：scroll_effects 召唤卷轴（P1-24 遗留）。与 P1-24 报告 §7.3 一致。

### 7.2 改动后全量：**453 绿 + 7 红 + 7 skip + 5 todo**

```
 npx vitest run --no-file-parallelism
 Test Files  1 failed | 42 passed (43)
      Tests  7 failed | 453 passed | 7 skipped | 5 todo (472)
   Start at  08:49:06
   Duration  55.33s
```

- **scroll_effects 转绿**（本轮目的之一，未碰该文件）：

```
 npx vitest run src/test/scroll_effects.test.ts --no-file-parallelism
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

  其中"读卷轴后玩家周围新增 1-3 只怪物，均为 HUNTING"（原 :172 处
  `expected 0 to be greater than 0` 红）——Kobold 召唤进深水后不再被淹死，
  `m.hp > 0` 自然成立。
- **p2_3_baseline play 段未变红**：

```
 npx vitest run src/test/p2_3_objective_time.test.ts --no-file-parallelism
 Test Files  1 passed (1)
      Tests  18 passed | 1 skipped (19)
```

- **generation_baseline 未变红**（全量 42 个绿文件含之）。RNG 流无移动：
  标志只移除致死路径，不新增/挪动任何随机数消耗。
- **7 红全部在 `p1_24_death_sink.test.ts`**（§〇.1 逐条列出）：对抗性①×3、
  ②水×1、④水×2、玩家深水×1。同文件其余 7 条（熔岩/火焰/蒸汽/战斗对照组、
  玩家熔岩）继续绿，die() 收口语义未被本轮削弱。**按边界未修、未刷新、
  未改任何既有测试**，处置留验收方（§〇.1）。

### 7.3 `npm run build` 尾部（绿）

```
 > vue-tsc -b && vite build
 dist/assets/WebGLRenderer-7kwEgZEE.js        68.42 kB │ gzip:  18.71 kB
 dist/assets/index-CbHs7hzF.js               922.88 kB │ gzip: 291.21 kB
(!) Some chunks are larger than 500 kB after minification. …（既有体积提示，非错误）
✓ built in 2.62s
```

### 7.4 git diff --stat

```
 brogue-web/src/engine/Core/Game.ts | 48 +++++++++++++++++++++++++++++++-------
 1 file changed, 39 insertions(+), 9 deletions(-)
```

## 八、明确不做（按任务书，留独立轮次）

- CE 深水的**真实行为**未实现：50% 偷走携带物并随机移位（Time.c:556-590）、
  `TM_ALLOWS_SUBMERGING` 潜水、`T_IS_FLAMMABLE` 等。本轮只做"不再致死"。
- `Game.canMoveTo` 的深水排除未动（P1-25，影响分析见 §四）。
- CE 熔岩致死的 `DF_CREATURE_FIRE` 火焰装饰（Time.c:219-220）仍未实现
  （P1-24 §八.3 申报过，本轮不在范围）。

## 九、验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| 玩家侧 WATER_DEEP 分支不再 triggerGameOver | ✅ 致死代码退入 `WEB_ONLY_DEEP_WATER_DROWNING=false`，注释附 Rogue.h:1932/1937 依据 |
| 怪物侧同分支不再致死 | ✅ 同上；die() 与消息原样保留在标志内（D2：代码保留、退出路径） |
| 熔岩不动 + 豁免条件核对、不一致则对齐 | ✅ 即死路径未动；核对结论=CE 三豁免（悬浮/火免/**无敌**），第三条已补齐（§三、§〇.2）；恒空地形条件说明（§〇.3） |
| 对抗性测试 ≥4 条、注明被捕错误实现 | ✅ 9 条，映射表见 §五 |
| 反向验证 ≥2 条真实改坏、贴输出、还原 | ✅ RV1/RV2/RV3 三组（§六），最终 diff 仅剩修复本体 |
| scroll_effects 召唤用例自然转绿且未碰 | ✅ 10/10 绿（§7.2），该文件零改动 |
| p2_3_baseline / generation_baseline 不刷新 | ✅ 两者均未变红，未动任何 fixture |
| P1-25 影响说明、不自行改动 | ✅ §四 |
| 门禁 npm test 全绿 / build 绿、尾部贴报告 | ⚠️ **build 绿；npm test 为 453 绿 + 7 红**——7 红全在 p1_24_death_sink.test.ts，是本轮移除动作的逻辑必然（该文件锁定被移除机制），边界禁止我修改它，§〇.1 单列申报，其余全绿 |
| 与 CE 不符之处报告开头单列 | ✅ §〇（任务书熔岩豁免表述不完整；其余事实全部属实） |

---
---

# 【补做】P1-27 续：把 7 条以"淹死"为载体的测试改挂到熔岩/新事实上

日期：2026-09-15（**验收打回后的补做**）
本轮唯一改动文件：`src/test/p1_24_death_sink.test.ts`（14 条 → 13 条，全部绿）
未触碰：`src/engine/`（Game.ts 的 diff 全部属于上一轮，本轮零改动）、其它任何既有测试、`src/data/*.json`、`src/test/fixtures/*`、`src/entities/`

任务书开宗明义的两点先收下：①上轮"门禁全绿与文件边界互斥"的矛盾确系任务书疏漏，本轮已授权改 `p1_24_death_sink.test.ts`；②熔岩第三条豁免（MONST_INVULNERABLE）的更正成立。

## 补〇、逐条映射：原断言考什么机制 → 新断言如何继续考同一机制

任务书硬要求项。原 7 条红 → 6 条改写 + 1 条按授权合并，**无一条机制覆盖凭空消失**：

### 映射 1-3：对抗性① 三条（深水 → 熔岩）

| 原断言（载体：淹死） | 新断言（载体：熔岩） | 机制如何保住 |
|---|---|---|
| 淹死后 hp 精确为 0、char='%' | 熔岩烧死后 hp 精确为 0、char='%' | 同一 `die()` 收口（Combat.c:2042）。熔岩是 CE 唯一即死地形（Rogue.h:1932），受害者 rat 无悬浮/火免/MONST_INVULNERABLE，三条豁免均不适用（Time.c:183-190） |
| 淹死后被 `playerTurnEnded` 清扫出列表 | 熔岩烧死后被清扫 | 清扫 `filter(m => m.hp > 0)` 与致死地形无关，路径同一 |
| 淹死尸体不苏醒/不行动（无 '!' 漂浮字、不攻击） | 熔烧尸体不苏醒/不行动 | 考的是"死透的怪不走 takeTurn 活人分支"，与致死地形无关；玩家邻格、ASLEEP 前置均原样保留 |

失败方式（RV2 实测，见补三）：`expected 6 to be +0` / `Monster{…} to be undefined` / `expected 6 to be +0`——与原深水版在"die() 不归零"坏实现下的失败方式逐一相同。

### 映射 4：对抗性② 深水条（改为断言新事实）

- **原断言**：淹死后 "drowns" 消息恰好播 1 次（含 Logger 合并条目 count===1）。考的机制：**消息闸在 hp 判定之后，死亡不重播**。
- **新断言**：深水里的怪物连续两轮环境结算，`drown` 零出现、Logger 合并条目**根本不存在**。考的机制：**移除本身**——任何深水致死复活（标志改回 true）或"只删致死、漏删消息"的半吊子移除即红。
- 原机制（消息不重播）**没有失去载体**：同文件"熔岩 incinerated 只播一次"一条继续绿，锁的还是那条 hp-先于-消息的闸序（RV2 中它在 die() 不归零下以 `expected 2 to be 1` 红，证明牙没钝）。
- 与 p1_27 文件对抗性①（seed 71）的分工：那条从 hp/在场通道断言"活着"；本条专门盯**消息通道**（Logger 合并条目本身必须不存在），且保留原条"连续两轮结算"的重播框架。测试描述里已写明这一区分。

### 映射 5：对抗性④ 深水毒气条（按授权合并，合并论证如下）

- **原断言**：深水里的 bloat 淹死后 `triggerDeathFeatures` 照常放毒气。考的机制拆成两半：(i) **die() 真死透**，`triggerDeathFeatures` 按 hp<=0 才扫得到；(ii) **水不抑制死亡地形**。
- 机制 (i)：由熔岩①三条（环境致死路径）+ 既有"被砍死在浅水里的 bloat 一样放毒气"对照组（战斗致死路径，继续绿、未动一个字节）继续锁死。
- 机制 (ii)：由上述浅水对照组继续锁死；**深水特异角**由改写后的深水爆燃条接管（映射 6）。
- **合并理由**：改写成"深水里的 bloat 被玩家砍死后放毒气"后，它与既有浅水对照组在引擎里走**同一条代码路径**——`triggerDeathFeatures`（Game.ts:4816）只看 `hp<=0` 与 `deathEffectTriggered`，不读地形；两测试唯一差异是地形标签，不存在"浅水过、深水红"的具体合理错误实现（CE 深水的 `TM_EXTINGUISHES_FIRE` 语义指向火，而毒气不受任何水机制影响；火的那半恰由爆燃条锁着）。按任务书"若确与既有对照组重复，合并并在报告说明，不要留两条一样的"执行：不新写深水毒气条，文件 14→13。

### 映射 6：对抗性④ 深水爆燃条（载体改为"玩家砍死在深水里"）

- **原断言**：深水里的 explosive bloat 淹死后照样爆燃（深水格本体与东邻格 isBurning）。考的机制：**"水里燃起大火"是 CE 行为**——死亡 DF 分支只认 MB_IS_FALLING（Combat.c:1963-1965），爆炸伤害只豁免爆炸免疫与 MB_SUBMERGED（Time.c:343-345）。
- **新断言**：**同一结论**，前提从"淹死"换成"被玩家砍死"（hp=1 + defense=-999，必中必死，不依赖伤害掷骰）——`handlePlayerAction` 的攻击分支先查 `getMonsterAt` 后查地形（Game.ts:2252/2275），站深水格的怪照常被砍；`igniteForced` 不看地形可燃性（Gas.ts:106），全引擎无"水熄火"逻辑（updateFires 只会傍水生成蒸汽）。新增 `stats.kills===1`（前置确认死于玩家这刀）与"同回合已被清扫"两条断言，**比原条更强**。
- 独立价值保留：这是全文件唯一断言"火在深水格上烧"的条目；岩浆爆燃孪生条（原绿）未动。
- 捕获的错误实现（描述内已写明）：①"水中死亡抑制死亡地形"实现成水中跳过 DF；②给深水补 CE `TM_EXTINGUISHES_FIRE` 语义时把死亡点燃一并掐掉。

### 映射 7：验收 4 玩家深水条（改为断言新事实）

- **原断言**：玩家深水 game over、hp 不被扣、char 不变——考"玩家的事件死不走 die()"。
- **新断言**：玩家泡深水（两轮结算）**不 game over**、hp=30 不动、char='@' 不变。原机制（玩家死不走 die()）**没有失去载体**：同 describe 的熔岩条继续绿锁着它。新条锁移除本身：标志复活 → isGameOver 翻 true；半吊子移除（不 game over 但误走 die()）→ hp/char 断言红。

## 补一、实现核对（新载体可行性，动手前逐条验证过）

- `handlePlayerAction('move')` 攻击分支：`getMonsterAt(newX,newY)` 先于 `canMoveTo`（Game.ts:2252 vs 5761-5763），深水排除不挡攻击。
- `triggerDeathFeatures`（Game.ts:4816-4845）：只看 `hp<=0` + `deathEffectTriggered` + `MA_DF_ON_DEATH`，不读地形。
- `igniteForced`（Gas.ts:106-116）：跳过可燃白名单，任何地形直接置 isBurning；`updateFires`（Gas.ts:118-206）无任何"水灭火"分支，只傍水生成蒸汽；burnDuration 初始 4-7，回合内一次扣减烧不完。
- 玩家近战最小伤害与 seed 的关系不信任——④条用 `hp=1` 而非原对照版的 `hp=2`，必死性与伤害掷骰解耦。

## 补二、对抗性声明（本轮改写后每条仍能捕获的具体错误实现）

见各 it() 描述文字（已全部同步更新，与实际断言一致；文中残留的"淹死"字样均为历史背景说明，不再有任何断言依赖淹死发生）。汇总：熔岩①×3 与既有熔岩条锁 die() 收口；②新事实条 + 验收4新条锁"淹死移除"本身（复活即红）；深水爆燃条锁"深水不抑制死亡地形/点火"；浅水对照组与岩浆爆燃条原样未动。

## 补三、反向验证（真实改坏 → 真实失败输出 → 还原）

### RV1：`WEB_ONLY_DEEP_WATER_DROWNING` 改回 `true`（复活自创淹死）→ 恰好捕获 2 条新事实测试

```
 FAIL … > 对抗性②（P1-27 重写为断言新事实）：移除自创淹死后，深水里的怪物不产生任何死亡消息…
 AssertionError: expected +0 to be 6 // Object.is equality   ← 老鼠第一轮被淹死，hp 前置断言红
 FAIL … > 玩家泡在深水里（P1-27 重写为断言新事实）：不 game over…
 AssertionError: expected true to be false // Object.is equality ← isGameOver 翻 true
       Tests  2 failed | 11 passed (13)
```

恰好且仅 2 条新事实测试红；11 条绿里含全部熔岩转化条——证明载体换到熔岩后**不依赖**淹死机制，判别方向正确。备注：②条先在 hp 前置断言（`toBe(6)`）失败，其后的消息断言未执行到；失败原因即淹死复活，牙齿已验证。

### RV2：删掉 `Creature.die()` 的 `this.hp = 0`（还原 P1-24 原始病灶）→ 熔岩转化条以预言的失败方式全红

```
 FAIL … 对抗性①：熔岩烧死后 hp 必须精确为 0…          AssertionError: expected 6 to be +0
 FAIL … 对抗性①（续）：熔岩烧死的怪物必须…被移出…      AssertionError: expected Monster{ id: 85, …(40) } to be undefined
 FAIL … 对抗性①（续）：熔岩烧死的尸体不再苏醒…        AssertionError: expected 6 to be +0
 FAIL … 对抗性②（续）：熔岩烧死同理，"incinerated" 只播一次。 AssertionError: expected 2 to be 1
 FAIL … 对抗性④（续）：岩浆里的 explosive bloat…      AssertionError: expected 10 to be +0
 FAIL … 对抗性④（续，P1-27 载体重写）：深水里的…      AssertionError: expected -8 to be +0
 FAIL … P1-24 验收 3：对照组（×2）                    AssertionError: expected -10 to be +0
       Tests  8 failed | 5 passed (13)
```

三条熔岩转化条的失败方式与原深水版完全同型（hp 停在满血、赖在列表、尸体死不透）——载体替换没有钝化对原始病灶的杀伤力。

### 还原确认

RV1/RV2 均以精确字符串替换还原。最终 `git status`：仅 `M src/engine/Core/Game.ts`（**上一轮的改动，本轮零触碰**）、`M src/test/p1_24_death_sink.test.ts`（本轮唯一改动）；`src/entities/Creature.ts` 不在 diff 中。

```
 brogue-web/src/engine/Core/Game.ts           |  48 ++++++++--
 brogue-web/src/test/p1_24_death_sink.test.ts | 137 +++++++++++++++------------
 2 files changed, 114 insertions(+), 71 deletions(-)
```

## 补四、门禁（真实输出尾部）

### npm test（`npm test -- --no-file-parallelism`，按项目常识规避负载抖动）——**全绿，零红**

```
 Test Files  43 passed (43)
      Tests  459 passed | 7 skipped | 5 todo (471)
   Start at  09:11:57
   Duration  52.01s
```

上轮 453 绿 + 7 红 = 460 活跃；本轮 459 = 460 − 1（毒气条按授权合并），数目吻合。p1_24 单文件：

```
 npx vitest run src/test/p1_24_death_sink.test.ts --no-file-parallelism
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### npm run build——绿

```
 dist/assets/WebGLRenderer-7kwEgZEE.js        68.42 kB │ gzip:  18.71 kB
 dist/assets/index-CbHs7hzF.js               922.88 kB │ gzip: 291.21 kB
(!) Some chunks are larger than 500 kB after minification. …（既有体积提示，非错误）
✓ built in 2.73s
```

## 补五、本轮验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| 对抗性①三条：深水→熔岩，注意熔岩受害者不得带悬浮/火免/INVULNERABLE | ✅ 受害者 rat 三豁免均不适用；三条映射见补〇 |
| 对抗性②深水条：改断言"深水怪物不产生任何死亡消息"，不复制熔岩孪生 | ✅ 消息通道 + Logger 合并条目不存在；与 p1_27 seed 71 的 hp 通道分工已在描述写明 |
| 对抗性④：载体改"深水里被玩家杀死"，结论不变 | ✅ 爆燃条照做且加强（kills/清扫断言）；与既有对照组不重复 |
| ④毒气条若与既有对照组重复则合并并说明 | ✅ 已合并（文件 14→13），重复论证见补〇映射 5 |
| 验收4玩家深水条：改断言不 game over、hp 与外观不受影响 | ✅ 补〇映射 7 |
| 不许降低覆盖；逐条列出映射，缺一条即削弱 | ✅ 7 条全有去向（补〇）；合并条的两半机制各有接盘者，论证在案 |
| 描述文字同步更新，不得再写"淹死"当断言 | ✅ 残留"淹死"字样均为历史背景注释 |
| 无法保住的条目停下来说明、不自行删 | ✅ 无此类条目——7 条全部保住（6 改写 + 1 授权合并） |
| 门禁 npm test 全绿 | ✅ 459 passed / 0 failed（+7 skipped +5 todo，既有） |
| npm run build 绿、两条输出尾部贴报告 | ✅ 补四 |
| 报告追加到本文末尾、标明补做 | ✅ 即本节 |

## 补六、与预设不符之处（本轮无新发现，两条执行备注）

1. **④条 hp 取 1 而非任务书语境里的"原样保留结论"下的 hp=2**：原深水版用 `hp` 自然值（淹死必死），对照版用 hp=2 并注明"命中即 ≥1 伤害"——该注释对 seed 32 成立，但玩家伤害是掷骰，换 seed 不保证 ≥2。新条改用 hp=1 使必死性与掷骰解耦，属测试加固而非结论变更。
2. **RV1 中②条先在 hp 前置断言失败**（老鼠被淹死、hp=0≠6），消息断言在其后未执行到——失败原因即被测的坏实现，判别方向正确，仅记录失败点位。

除此之外任务书与本轮实施无分歧；上轮 §〇 的两条（熔岩三豁免、7 红矛盾）已分别以"补齐第三豁免"和"本轮授权改写"结案。
