# P1-24 报告：淹死 / 熔岩烧死的怪物根本没死

日期：2026-09-15
改动文件：`src/entities/Creature.ts`（+8/−1）、新增 `src/test/p1_24_death_sink.test.ts`（14 条）
未触碰：`src/engine/Core/Game.ts`、`src/engine/Environment/Gas.ts`、全部 `src/data/*.json`、全部 fixtures、`src/engine/Random.ts`

---

## 一、与任务书预设不符之处（开头单列，按授权反驳条款）

### 1. ★ CE 根本没有"深水淹死"机制——任务书的前提本身是 web 自创内容

任务书把"怪物在深水里淹死"当作既定机制去修死亡收口。核对 CE 全源码
（`grep -rn T_IS_DEEP_WIDTH…` 精确说：`grep -rn "T_IS_DEEP_WATER" src/brogue/*.c`）后确认：
**CE 的 `T_IS_DEEP_WATER` 从不造成任何伤害，无论玩家还是怪物**：

| CE 位置 | 用途 |
|---|---|
| `Monsters.c:1489-1494`（monsterAvoids） | 怪物**避免走进**深水；"已在水里的不规避"（`!cellHasTerrainFlag(monst->loc, T_IS_DEEP_WATER)`）——所以怪物可以**站在**深水里 |
| `Time.c:1146-1150`（坠落） | 坠入深水零伤害："You fall into deep water, unharmed." |
| `Time.c:556-590`（applyGradualTileEffects…） | 唯一的"伤害"是把**物品**冲走（怪物有携带物时掉落），不扣 hp |
| `RogueMain.c:886` / `Time.c:86-97` | 玩家在水下的视觉表现 / 悬浮到期警告 |

CE 真正的即时致死地形只有**岩浆**（`T_LAVA_INSTA_DEATH`，`applyInstantTileEffectsToCreature`，Time.c:180-224）。
CE 玩家也不会淹死（Time.c:2884 的"point of no return"只是悬浮/火焰免疫到期的预警）。

**含义**：web 的"深水淹死怪物/玩家"是自创机制（历史上进入游戏的 D2 类内容）。
本轮**没有移除它**——任务书以"淹死会发生"为前提，只要求把死亡收口修真；
移除淹死机制是更大的口径决策，留给验收方（见 §七.1）。

### 2. p2_3_baseline 的 play 段**没有**变红

任务书预测"本轮几乎必然让 play 段变红"。实测：`p2_3_objective_time.test.ts`
单独跑 **18 passed | 1 skipped**（skip 的是 levels 段 `it.skip`），全量跑也绿。
解释：该基线录制的 play 路径里**从未有怪物实际站在深水/岩浆格上被环境结算**——
验收方当初的探针是手工放置的合成场景，不在基线轨迹里。无需重新捕获，
未动任何 fixture。

### 3. 变红的是另一条：`scroll_effects.test.ts` 召唤卷轴测试（非基线、非预报告知项）

全量唯一红项：`读卷轴后玩家周围新增 1-3 只怪物，均为 HUNTING`（断言
`newcomers` 的 `m.hp > 0` 失败，实际 hp=0）。已做**受控因果实验**定性为
"修复暴露既有分歧"而非回归，细节见 §六.3。

### 4. 任务书小勘误

- 任务书引 `Creature.die()` 在 `src/entities/Creature.ts:157`——实际定义在
  第 167 行（157 行附近是 `takeDamage`）。病灶描述本身完全准确。
- 任务书说"其余分支如蒸汽、蔓延死亡都是先 `hp -= N` 再判 `hp <= 0`"——属实，
  补充：**火焰分支**（-2）同样是先扣后判，同样不受本轮影响。

---

## 二、CE 依据（本轮结论的事实链）

### 2.1 CE 的死亡收口本来就归零 HP

`killCreature`（Combat.c:1934）最后一行：

```c
decedent->currentHP = 0;            // Combat.c:2042
```

且入口有幂等守卫（Combat.c:1938-1941）：

```c
if (decedent->bookkeepingFlags & (MB_IS_DYING | MB_HAS_DIED)) {
    // monster has already been killed; let's avoid overkill
    return;
}
```

web 的 `die()` 缺的正是"归零"这一步；幂等性在 web 里由 `hp<=0` 这个
唯一死判据承担（web 没有 bookkeeping 位）。

### 2.2 水中/岩浆中死亡，死亡地形照常触发（本轮结论：不抑制）

- **触发门**：`killCreature` 里 `MA_DF_ON_DEATH` 只被两个条件抑制——
  `administrativeDeath`（web 无此概念，战斗/环境致死全传 `false`）与
  `MB_IS_FALLING`（Combat.c:1963-1965）。**没有任何水/岩浆条件**。
- **岩浆致死**本身就是 `killCreature(monst, false)` + 追加 `DF_CREATURE_FIRE`
  （Time.c:203-222）——`administrativeDeath=false`，DF 照常触发。
- **DF_BLOAT_DEATH 的落地**：DF 表 34 号 = `{POISON_GAS, GAS, 2000, 0}`
  （Globals.c，`dungeonFeatureCatalog`，枚举序号 34 已逐一核对）。
  `spawnDungeonFeature` 对 GAS 层是**无条件加体积**（Architect.c:3359 起）：
  `pmap[x][y].volume += feat->startProbability; pmap[x][y].layers[GAS] = feat->tile;`
  ——不看脚下地形。毒气在水面上照常存在。
- **DF_BLOAT_EXPLOSION 的落地**：DF 表 35 号 = `{GAS_EXPLOSION, SURFACE,
  350, 100, 0, "", EXPLOSION_FLARE_LIGHT}`。GAS_EXPLOSION tile =
  `T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE`（Globals.c:496）。非 GAS 层 DF 走
  `fillSpawnMap`，唯一可能的否决是 `abortIfBlocking`（要求 tile 是
  T_PATHING_BLOCKER），而 `killCreature` 调用时传的正是
  **`abortIfBlocking = false`**（Combat.c:1965-1967）——无从否决。
- **爆炸伤害对站在水里的生物没有豁免**：`T_CAUSES_EXPLOSIVE_DAMAGE`
  结算（Time.c:343-345）只豁免 `STATUS_EXPLOSION_IMMUNITY` 与
  `MB_SUBMERGED`（潜水是 MONST_SUBMERGES 生物的隐身簿记，普通落水怪物
  不是 SUBMERGED）。对比：`exposeCreatureToFire`（Time.c:28-37）确实会因
  `TM_EXTINGUISHES_FIRE`（深水带此位，Globals.c:413）拒绝点燃**燃烧状态**，
  但那条管的是"着火 buff"，不是"爆炸伤害"。
- web 的 `igniteForced`/`addGas` 与此对齐：置 `isBurning`/加气体都不看地形；
  `updateFires` 也只按 `isBurning`/`burnDuration` 演算，不会因"底下是水"熄灭
  （Gas.ts 内注释已论证，本轮未改动该文件）。

**结论**：水里死的 bloat 放毒气、水里/岩浆里死的 explosive bloat 燃起大火，
都是 CE 行为；web 的 P4-4 `triggerDeathFeatures` 按 `hp<=0` 扫描在修复后
自动把淹死/烧死的膨胀怪纳入——无需也不应加地形抑制。已用三条测试锁死（§五.④）。

---

## 三、改动清单

### 3.1 `src/entities/Creature.ts` —— `die()` 成为真正的致死收口（唯一改动）

```diff
     protected die() {
-        // Handle death
+        // P1-24 死亡收口：CE killCreature 最后把 currentHP 归零（Combat.c:2042），…
+        this.hp = 0;
         this.char = '%';
         this.color = 0x880000;
     }
```

一行语义修复 + 说明注释。**Game.ts 零改动**：消息闸（`checkEntity` 顶部的
`if (entity.hp <= 0) return;`）、死亡地形扫描（`triggerDeathFeatures` 的
`if (m.hp > 0) continue;`）、回合清扫（`playerTurnEnded` 的
`filter(m => m.hp > 0)`）、死人不行动（`advancementLoop` 与 `takeTurn` 的
`hp > 0` 守卫）四条下游全部以 `hp<=0` 为准，归零后自动接管，
死亡消息天然只播一次。**Gas.ts 未改**（`addGas`/`igniteForced` 本就不挑地形）。

### 3.2 `src/test/p1_24_death_sink.test.ts` —— 新增 14 条测试（全绿）

---

## 四、全部 `die()` 调用点逐个复核

`die()` 的直接调用点共 6 处（grep 全源码核实，test 除外），另有唯一入口
`Creature.takeDamage`（`hp -= amount` 后 `hp<=0` 才调 `die()`）：

| # | 调用点 | 调用时 hp | 复核结论 |
|---|---|---|---|
| 1 | `Creature.takeDamage`（Creature.ts:163） | `hp -= amount` 后 ≤0 | die() 归零是对负值的**钳制**，无重复结算。上游 15 处 `takeDamage` 调用（Combat.ts:129 自爆；Game.ts:2947/2953 inflictDamage 移植、3210/3426 斩杀、3948/3991/4046 毒/灼附加、3963/4053/4058 斩杀、4069、4134 反射、4168 分摊、4259 报复）全部先扣血后触发，同此。 |
| 2 | Game.ts 深水分支（5531） | **满血**（唯一致死手段） | **病灶本体**：修复后 hp 归零→被清扫、消息只播一次。 |
| 3 | Game.ts 熔岩分支（5541） | **满血**（同上） | 同上。 |
| 4 | Game.ts 火焰分支（5559） | `hp -= 2` 后 ≤0 | 先扣后判，归零是钳制，消息在 `hp<=0` 守卫内本就只播一次。未改坏。 |
| 5 | Game.ts 蒸汽分支（5589） | `hp -= 1` 后 ≤0 | 同上。 |
| 6 | Game.ts 蔓延死亡分支（5596） | `hp -= 10` 后 ≤0 | 同上。 |

- **Player 路径**：`Player` 未覆盖 `die()`/`takeDamage`（grep 证实），
  环境致死走 `triggerGameOver`（Game.ts:5528/5538），不经过 `die()`；
  玩家经 `takeDamage` 死亡时 hp 已 ≤0，die() 归零为无感钳制。
  测试 §五.玩家路径 两条锁定（isGameOver=true、hp 不动、char 仍 '@'）。
- **复活/回血风险排查**：死怪（hp=0，等清扫）不可能回血——`takeTurn`
  首行 `if (this.hp <= 0) return;`（先于 regen 块）；bolt 候选过滤
  `m.hp > 0`（Monster.ts:498/500）。无"尸体回血复活"通道。

---

## 五、对抗性测试 → 各自捕获的错误实现

文件 `src/test/p1_24_death_sink.test.ts`，14 条全绿。前缀"对抗性"者共 8 条
（任务书要求 ≥4），每条注明被捕实现：

| 测试 | 捕获的错误实现 | 失败方式（已实测，见 §六） |
|---|---|---|
| 对抗性①（3 条） | die() 仍是外观式（不归零）：hp 停留 6 / 怪物赖在 `this.monsters` / 尸体照常惊醒扑人 | `expected 6 to be +0`；`expected Monster{…} to be undefined` |
| 对抗性②（2 条） | 死亡消息重播：旧版不归零每轮重播，或任何把消息挪到 hp 闸之前的重排 | `expected 2 to be 1`（water 与 lava 各一条） |
| 对抗性③（2 条） | `hp -= N` 后调 die() 的既有路径被改成重复结算（die 里"补一刀"）：尸体 hp 落负而非 0 | `expected -6 to be +0`（火）、`expected -6 to be +0`（蒸汽，RV2 实测 -6；对照组合 combat 路径 -14） |
| 对抗性④（3 条） | "水中/岩浆中死亡地形被写反成抑制"：bloat 水中不放毒气 / explosive 岩浆水中不点火 | `expected +0 to be 2`（毒气类型）、`expected false to be true`（isBurning） |

对照组（2 条）：玩家近战击杀 bloat——仍清扫、仍掉落（goldDropChance/
itemDropChance 置 100 后必掉 2 件）、死亡地形照常、hp 精确 0；
以及"砍死在浅水里的 bloat 一样放毒气"。玩家路径（2 条）：深水/熔岩
`triggerGameOver`，hp=30 不动、char 仍 '@'。

---

## 六、反向验证（真实改坏 → 真实失败输出 → 还原）

三次改坏均**只改被测语义**，每次跑完立即还原，最终 `git diff` 仅剩 §三.1 的修复。

### RV1：die() 改回原始病灶（外观式，不归零）——捕获对抗性①②④

```
 ❯ src/test/p1_24_death_sink.test.ts (14 tests | 10 failed) 168ms
AssertionError: expected 6 to be +0 // Object.is equality        ← 对抗性①（hp 不归零）
AssertionError: expected Monster{ id: 85, …(40) } to be undefined ← 对抗性①（清扫不掉）
AssertionError: expected 6 to be +0 // Object.is equality        ← 对抗性①（尸体苏醒扑人）
AssertionError: expected 2 to be 1 // Object.is equality         ← 对抗性②（drowns 重播）
AssertionError: expected 2 to be 1 // Object.is equality         ← 对抗性②（incinerated 重播）
AssertionError: expected 4 to be +0 // Object.is equality        ← 对抗性④（bloat 没死，毒气 0）
AssertionError: expected 10 to be +0                             ← 对抗性④（岩浆 explosive 没死）
AssertionError: expected 10 to be +0                             ← 对抗性④（水中 explosive 没死）
（另 2 条对照组因 hp≠0/未清扫连带失败）
```

10/14 失败，症状与验收方探针完全一致（满血尸体、消息重播）。

### RV2：die() 改成"补一刀"（`this.hp -= this.maxHp`）——捕获对抗性③

```
 ❯ src/test/p1_24_death_sink.test.ts (14 tests | 4 failed) 142ms
     × 对抗性③：…火焰致死的尸体 hp 必须精确停在 0… 12ms
     × 对抗性③（续）：蒸汽致死同样精确归零… 9ms
     × 对照组：战斗致死与水淹致死走同一条收口… 11ms
AssertionError: expected -6 to be +0   ← 火：2 HP 扣 2 归零后再被补刀 -6
AssertionError: expected -6 to be +0   ← 蒸汽：1 HP 扣 1 归零后再被补刀 -6
AssertionError: expected -14 to be +0  ← 战斗击杀路径同被重复结算
```

`=== 0` 精确断言（CE 口径 currentHP=0，非"≤0 即可"）兑现了判别力。

### RV3：把"水中死亡地形抑制"这一错误结论真的实现（triggerDeathFeatures 加深水跳过）——捕获对抗性④

```
 ❯ src/test/p1_24_death_sink.test.ts (14 tests | 2 failed) 162ms
     × 对抗性④：深水里的 bloat 淹死后照样放毒气。…
     × 对抗性④（续）：深水里的 explosive bloat 淹死后照样爆燃…
AssertionError: expected +0 to be 2       ← 毒气类型恒 NONE
AssertionError: expected false to be true ← 水中点火被抑制
```

恰好只有两条"水中 DF"用例失败，**岩浆用例照常通过**——判别方向正确。

### 还原确认

```
 brogue-web/src/entities/Creature.ts | 9 ++++++++-
 1 file changed, 8 insertions(+), 1 deletion(-)
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

---

## 七、基线变红情况（如实，分项写清）

### 7.1 p2_3_baseline：**未变红**（与任务书预测不符，见 §一.2）

```
 npx vitest run src/test/p2_3_objective_time.test.ts --no-file-parallelism
 Test Files  1 passed (1)
      Tests  18 passed | 1 skipped (19)
```

generation_baseline 亦绿（生成路径不调用 die()，未动）。未重捕任何 fixture。

### 7.2 唯一红项：scroll_effects 召唤卷轴（非基线）

```
 FAIL  src/test/scroll_effects.test.ts > summon_monsters 卷轴（Items.c:7977-7990） >
       读卷轴后玩家周围新增 1-3 只怪物，均为 HUNTING
AssertionError: expected 0 to be greater than 0
 ❯ src/test/scroll_effects.test.ts:172:26
```

**受控因果实验**（临时探针，跑完已删，diff 复核无残留）：
同一 seed 20260914 复现召唤，3 只新怪中 1 只 Kobold 落在玩家邻格
**(38,15)，terrain=7 = WATER_DEEP，hp 7→0、char='%'**——
它在 readItem 收尾的 playerTurnEnded 客观块里被环境结算**真实淹死**。
把 die() 临时还原成外观式（RV1 版本），该测试**转绿**——
因为淹死的 Kobold 满血"活着"，`m.hp > 0` 恰好通过。
即：**该测试过去一直在无意中为 P1-24 病灶背书。**

CE 对照定性：CE 召唤落点（Items.c:7977-7990）只筛"可通行 + 无怪 + 10%"，
深水可通行、不在排除之列；而 CE 深水不淹死（§一.1），所以 CE 里
"召唤进深水的怪物活着"成立。web 的召唤落点与 CE 逐字对齐；
分歧只在 web 自创的淹死机制。**处置留验收方裁决**（§七.4），本轮不动。

### 7.3 门禁数字

```
 npx vitest run --no-file-parallelism
 Test Files  1 failed | 41 passed (42)
      Tests  1 failed | 450 passed | 7 skipped | 5 todo (463)
 Duration  85.79s
```

**450 passed ≥ 437 ✓**（通过数口径达标）。全量状态分项：450 绿 +
1 红（仅 scroll_effects 召唤用例，§7.2）+ 7 skip（levels 段既有 it.skip）
+ 5 todo（既有）。除该条外其余全绿，**基线未红**。

### 7.4 `npm run build` 尾部（绿）

```
 > vue-tsc -b && vite build
 ✓ built in 3.68s
 dist/assets/WebGLRenderer-BXWpIHgA.js        68.42 kB │ gzip:  18.71 kB
 dist/assets/index-BTCcEVwR.js               923.17 kB │ gzip: 291.26 kB
```

---

## 八、与预设不符/发现但只列不修的清单

1. **web 深水淹死（怪物与玩家）是 CE 不存在的自创机制**（§一.1）。
   按 D2 精神它属于"不得出现在实际游戏中"的候选；移除它可同时让
   scroll_effects 转绿且更贴 CE。本轮按任务书前提只修收口，未移除。
2. **scroll_effects 召唤用例红**（§7.2）。可选处置：a) 接受为有意变更
   并修订该用例（需授权）；b) 授权移除 web 淹死后自然转绿；
   c) 给召唤落点加深水排除——**CE 无此逻辑，违背 D1，不建议**。
3. **CE 熔岩致死还有两条 web 缺的细节**：`MONST_INVULNERABLE` 豁免
   （Time.c:183，web 熔岩分支不查无敌，Warden of Yendor 在 web 里会被
   岩浆烧死）；致死格追加 `DF_CREATURE_FIRE` 火焰装饰（Time.c:219-220，
   web 无）。只列不修。
4. **环境致死者不掉落**：web 只在玩家近战击杀路径（resolvePlayerMeleeAttackOn）
   掉落；CE killCreature 对任何非管理死都 `makeMonsterDropItem`。既有缺口，
   与本轮无关，对照测试锁的是 web 既有行为。
5. **RNG 流提示**：修复本身不消耗 RNG；但"水中/岩浆中死的 explosive bloat
   现在会真的点火"，`igniteForced` 的燃烧时长 `rng.randRange(4,7)` 会在该
   场景首次发生时消耗玩法随机数。实测基线 play 段未触发该场景（故绿）；
   未来的种子基线若覆盖到，将按既有约定记录。
6. 任务书行号小误：`die()` 实际在 Creature.ts:167（§一.4）。

---

## 九、验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| die() 成为真正致死收口（至少归零 hp） | ✅ `this.hp = 0`，CE Combat.c:2042 口径 |
| 复核全部 die() 调用点、不造成重复结算 | ✅ 6 处直接调用 + takeDamage 全上游逐一复核（§四），对抗性③+RV2 锁死 |
| 死亡消息不重播 | ✅ hp 闸治愈；对抗性② 两条（含 Logger count==1 探针口径） |
| Player 走 triggerGameOver 不受影响 | ✅ 两条测试（深水/熔岩：isGameOver、hp=30 不动、char '@'） |
| P4-4 交互：水中 bloat 毒气 / 水中·岩浆 explosive 点火，CE 依据 + 测试锁结论 | ✅ §二.2 依据链 + 对抗性④ 三条；结论=照常触发（不抑制） |
| 对抗性测试 ≥4 条、各自注明被捕错误实现 | ✅ 8 条，映射表见 §五 |
| 反向验证 ≥2 条真实改坏、贴真实失败输出、还原 | ✅ RV1/RV2/RV3 三组（§六），最终 diff 仅剩修复本体 |
| 对照组：正常战斗致死不变 | ✅ §五对照组两条 |
| 门禁 ≥437 通过、build 绿、尾部贴报告、红项分开如实写 | ✅ 450/1红/7skip/5todo（§七），build 绿 |
| 基线变红不重捕、报告说明 | ✅ 基线实际未红（§7.1）；未动任何 fixture |
