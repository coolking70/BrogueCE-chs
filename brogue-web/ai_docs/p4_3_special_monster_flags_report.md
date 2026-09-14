# P4-3：让特殊怪物旗标真正生效 — 报告

## 结论摘要

实现了 4 项，跳过 1 项（有前提缺口，已实现但确认无法自然触发，跳过），
显式未实现 1 项（`MONST_GETS_TURN_ON_ACTIVATION`，无前置子系统）。

| 旗标 | CE 语义确认 | web 实现状态 |
|---|---|---|
| `MONST_INVULNERABLE` | Combat.c:1806 `inflictDamage`：一切伤害源归零 | ✅ 已实现 |
| `MONST_IMMUNE_TO_WEAPONS` | Combat.c:1243-1245 `attack()`：只归零"武器伤害" | ✅ 已实现 |
| `MA_REFLECT_100` / `MONST_REFLECT_50` | Items.c:4978-4983 `projectileReflects` + Items.c:5677 `reflectBolt` | ✅ 已实现（简化版，见下） |
| `MONST_INVISIBLE` | Monsters.c:200-203 `monsterIsHidden` | ✅ 已实现 |
| `MONST_DIES_IF_NEGATED` | Items.c:4483-4491 `negate()` | ✅ 已实现（两个可达出口） |
| `MONST_GETS_TURN_ON_ACTIVATION` | Rogue.h:2087 "怪物从不获得回合，除非其机关被激活" | ❌ 未实现，见 §6 |

`npm test`：348 passed（原 336 + 本轮新增 12），0 failed，7 skipped/5 todo（既有）。
`npm run build`：通过。`generation_baseline.test.ts` 未失配，本轮改动不影响生成期。

---

## 1. MONST_INVULNERABLE

**CE 语义**（Combat.c:1806 `inflictDamage`）：

```c
if (damage == 0 || (defender->info.flags & MONST_INVULNERABLE)) {
    return false;
}
```

`inflictDamage` 是 CE 所有伤害结算的唯一汇聚点（近战 `attack()`、投掷武器
`hitMonsterWithProjectileWeapon()`、bolt 命中 `updateBolt()`、环境伤害等全部
调用它）。命中 `MONST_INVULNERABLE` 直接 `return false`，**不掉血、不触发
死亡消息**，函数在扣血/流血/连击判定之前就退出。全 CE 怪物表检索（`Globals.c`）
确认唯一持有该旗标的怪物是 **Warden of Yendor**。

**web 实现**：`src/entities/Monster.ts` 新增 `Monster.isInvulnerable()`；
`src/engine/Combat/Combat.ts` 的 `CombatSystem.attack()` 在伤害骰算出之后、
"最低 1 点伤害"下限生效之前插入判定，命中则强制 `damage = 0`
（`hit` 仍为 `true`，与 CE"命中但不造成伤害"的语义一致）。

web 目前所有会造成伤害的路径（近战、怪物远程法术 `castMonsterBolt`）最终
都经过 `CombatSystem.attack()`，因此这一处判定天然覆盖了 CE `inflictDamage`
汇聚点的效果；玩家直接施放的伤害类 bolt（FIRE/LIGHTNING，走
`applyDirectBoltDamage`）另行判定（见 §3，同一个 `isInvulnerable()`）。

**验收**：`P4-3 验收 1` — Warden 挨打 50 次，`res.damage` 恒为 0，HP 不变、未死亡。

---

## 2. MONST_IMMUNE_TO_WEAPONS

**CE 语义**（Combat.c:1243-1245，`attack()` 内计算原始伤害的那一行）：

```c
damage = (defender->info.flags & (MONST_IMMUNE_TO_WEAPONS | MONST_INVULNERABLE)
             ? 0
             : randClump(attacker->info.damage) * monsterDamageAdjustmentAmount(attacker) / FP_FACTOR);
```

以及投掷武器命中（Items.c:6812-6813 `hitMonsterWithProjectileWeapon`）：

```c
damage = monst->info.flags & (MONST_IMMUNE_TO_WEAPONS | MONST_INVULNERABLE) ? 0 :
          (randClump(theItem->damage) * damageFraction(netEnchant(theItem)) / FP_FACTOR);
```

**关键点**：这个豁免只在"计算武器伤害"这一步生效，`inflictDamage()`
本身完全不检查 `MONST_IMMUNE_TO_WEAPONS`（只检查 `MONST_INVULNERABLE`，
见 §1）。也就是说法术 bolt、火焰蔓延、陷阱等经由 `inflictDamage` 但不经过
`attack()`/`hitMonsterWithProjectileWeapon()` 算伤害那一步的伤害源，**完全
不受这个旗标影响**——不是"免疫一切"，只是"免疫武器（近战 + 投掷）"。

**web 实现**：`CombatSystem.attack()` 新增 `opts.isWeaponAttack`
（默认 `true`，对既有 4 个近战调用点零改动）。判定：
`isWeaponAttack && defender.isImmuneToWeapons()` 时强制伤害为 0。
`castMonsterBolt`（怪物施放的 SPARK/FIRE/DRAGONFIRE/DISTANCE_ATTACK/
POISON_DART）显式传 `isWeaponAttack: false`，与 CE 语义一致——这些是法术/
远程武器伤害，`attack()` 里那条豁免本来就不检查它们（web 的这几个效果统一
走 `CombatSystem.attack` 是 P4-1a/P4-1b 既有简化，不是本轮引入）。

**验收**：`P4-3 验收 2` ——
- revenant 挨打 50 次近战，`res.damage` 恒为 0，HP 不变；
- revenant 被 `castMonsterBolt(dragon, revenant, 'FIRE')`（`isWeaponAttack:false`
  出口）命中后确实掉血，证明"不是免疫一切"。

---

## 3. MA_REFLECT_100 / MONST_REFLECT_50

**CE 语义**：

- `Items.c:4960-4990 projectileReflects(attacker, defender)`：
  `MA_REFLECT_100` → 直接 `return true`（100% 反射，不看武器/护甲附魔）；
  `MONST_REFLECT_50` → `netReflectionLevel += 4 * FP_FACTOR`（等价 +4 附魔的
  反射护甲），再查 `PowerTables.c:109-123 reflectionChance()` 表转成百分比。
- `Items.c:5677-5702`：bolt 路径遍历到该怪物所在格时，若
  `!(theBolt->flags & BF_NEVER_REFLECTS) && projectileReflects(...)`，调用
  `reflectBolt(originLoc.x, originLoc.y, ...)` 把弹道折返给原施法者
  （`shootingMonst`，可以是玩家也可以是任意怪物）。
- `BF_NEVER_REFLECTS` 覆盖 `GlobalsBrogue.c` 里的 `arrow`（DISTANCE_ATTACK）、
  `poisoned dart`（POISON_DART）、`spiderweb`、`whip`；`spark`/`flame`/
  `dragonfire`/`lightning`（SPARK/FIRE/DRAGONFIRE/LIGHTNING）**没有**这个标志，
  可以被反射。

**提示词的"授权反驳"**：提示词声称
"`specificallyValidBoltTarget` 里已有'不对反射目标发射可反射 bolt'的判定"——
经全仓 `grep` 核实，**web 代码库里根本不存在 `specificallyValidBoltTarget`
这个函数**（既不在 `Monster.ts`/`Game.ts`，也不在任何 `.ts` 文件）。这是提示词
事实性错误，本轮按 CE 源码重新设计了反射机制，未依赖这个不存在的判定。

**web 实现**：
- `Monster.reflectChance()`：`MA_REFLECT_100` → 100；`MONST_REFLECT_50` →
  `reflectionChance(4)`（复用既有的 `CombatFormulas.reflectionChance`，与护甲
  反射符文同一张查表，口径一致）；否则 0。
- `CombatSystem.attack()` 新增 `opts.damageTarget`：命中判定仍按 `defender`
  计算（偷袭/命中率不变），但伤害落点可被调用方改写为另一个 Creature——
  对应 CE"弹道折返给原施法者"。
- `Game.castMonsterBolt`（怪物施法出口）：仅对 `SPARK`/`FIRE`/`DRAGONFIRE`
  做反射判定（`DISTANCE_ATTACK`/`POISON_DART` 对应 CE 的 `BF_NEVER_REFLECTS`，
  跳过），反射命中则 `damageTarget: caster`。
- `Game.applyBoltEffect`（玩家施法出口，FIRE/LIGHTNING 直接 `takeDamage`，
  不经过 `CombatSystem.attack`）：新增私有方法 `applyDirectBoltDamage`，
  同时处理 `MONST_INVULNERABLE`（伤害吞掉）与反射（伤害记到 `this.player`
  身上）。

**已知简化**（如实说明，不隐瞒）：CE 的反射是**真实弹道折返**——反射后的
bolt 会沿新路径继续飞行，可能命中路径上的其它生物，并可能被二次反射。
web 版把"反射"简化为"伤害记账切换目标"（目标不掉血，施法者掉等量伤害），
不模拟折返路径与连锁反射。这与 §Combat.ts 里已有的护甲反射符文
（`tryTriggerArmorRunic`，本轮之前的实现）采用同一简化程度，是本项目对
"反射"这一机制的既定简化基线，本轮延续而非另立标准。

**验收**：`P4-3 验收 3` ——
- 怪物侧：`spark_turret` 对 `stone_guardian` 施放 SPARK，`stone_guardian`
  HP 不变，`spark_turret` 自己掉血；
- 玩家侧：玩家对 `stone_guardian` 施放 FIRE，`stone_guardian` HP 不变，
  玩家自己掉 20 点血（等于 bolt magnitude）；
- `golem`（`MONST_REFLECT_50`）的 `reflectChance()` 与
  `reflectionChance(4)` 数值相等，且落在 (0,100] 区间。

---

## 4. MONST_INVISIBLE

**CE 语义**（Monsters.c:200-203 `monsterIsHidden`，被 `canSeeMonster`/
`canDirectlySeeMonster` 调用）：

```c
if ((monst->status[STATUS_INVISIBLE] && !pmapAt(monst->loc)->layers[GAS])) {
    return true; // 隐藏
}
```

`STATUS_INVISIBLE` 由 `initializeStatus`（Monsters.c:3920）对
`MONST_INVISIBLE` 的怪物恒设为 1000（不衰减）。`monsterIsHidden` **忽略视野、
光照、相邻、是否修了 telepathy**——非队友观察者对隐形怪物恒定"看不见"。
唯一的例外路径是 `monsterRevealed()`（IO.c:1264 附近，配合 telepathy 等
"已知悉但不可直接见"机制）：这种情况下渲染的不是怪物本身的字符，而是一个
通用的幽灵符号 `x`/`X`（IO.c:1264-1272）。

**web 实现**：`Monster.isTrulyInvisible()` = `hasBehavior('MONST_INVISIBLE')`。
`Game.update()` 里计算 `visibleMonsters` 集合的地方（原先只看
`cell.isVisible || telepathyRevealed`）新增
`trulyInvisible = m.isTrulyInvisible() && !this.player.hasStatus('telepathy')`，
命中则排除出 `visibleMonsters`。

**已知简化**：CE 用不同字符（`x`/`X` 幽灵符号）区分"telepathy 感知到但看不清"
与"完全可见"；web 目前 `visibleMonsters` 是一个布尔集合，没有"部分感知"这一
中间态，本轮把"玩家有 telepathy"处理成"和正常怪物一样进入 `visibleMonsters`"，
不额外做符号替换（渲染层是 `.vue`，本轮边界禁止触碰）。这是比 CE 更粗的近似，
如实说明。

**验收**：`P4-3 验收 4` ——
- `phantom` 站在玩家 FOV 内、无 telepathy 时不在 `visibleMonsters` 里；
- 玩家有 telepathy 时 `phantom` 出现在 `visibleMonsters` 里；
- 对照组 `goblin`（无该旗标）在同样条件下正常出现，证明改动没有误伤普通怪物。

---

## 5. MONST_DIES_IF_NEGATED

**CE 语义**（Items.c:4483-4491 `negate()`）：

```c
if (monst->info.flags & MONST_DIES_IF_NEGATED) {
    ...
    killCreature(monst, false);
    combatMessage(buf, messageColorFromVictim(monst));
    negated = true;
} else if (!(monst->info.flags & MONST_INVULNERABLE)) {
    // 正常 negate：清除能力/状态
    ...
}
```

**对提示词的授权反驳（部分）**：提示词说"注意 `scroll_of_negation` 目前是
占位（P1-16 未做），若无 negation 来源，请说明该旗标当前无从触发并跳过"。
核实结果：**卷轴那条路径确实是占位**（`Game.ts` 里 `case 'negate_burst'`
只打印一条氛围文案，不做任何实际效果），这部分提示词是对的。但提示词的
结论——"无 negation 来源，跳过"——是**错的**：`BoltEffect.NEGATION` 在
`Game.ts` 里有两条**真正生效**的独立出口：

1. `applyBoltEffect` 的 `case BoltEffect.NEGATION`（玩家施放的 negation
   法杖/法术命中时清空目标状态）——目前没有任何 `wand_of_negation` 类物品
   数据能触发它（`src/data/*.json` 检索确认不存在），是**可运行但目前不可达
   的代码路径**（数据缺口，不是逻辑缺口，且 `src/data/` 禁改）。
2. `castMonsterBolt` 的 `case BoltEffect.NEGATION`（`Monsters.json` 里
   `dar_priestess`/`naga` 等怪物的 `bolts` 数组含 `"NEGATION"`）——**这条是
   真实可达的**：这类怪物会对"敌人"（`BF_TARGET_ENEMIES`，从施法怪物视角，
   玩家及玩家的盟友都算敌人）施放 negation。若玩家的召唤物/驯服盟友里有
   `wisp`/`golem`/`spectral blade`/`spectral sword`/`phylactery`/`sentinel`
   这类 `MONST_DIES_IF_NEGATED` 的怪物，被这类敌对怪物 negation 命中就会
   触发。这是真实存在、当前就能被玩家在正常游戏中触发的路径。

**web 实现**：两处都加了判定——`target instanceof Monster && target.diesIfNegated()`
时改为 `target.takeDamage(target.hp)`（直接致死）而不是清状态。

**验收**：`P4-3 验收 5` ——
- `wisp`（`isAlly=true`）被敌对 `goblin` 的 `castMonsterBolt(..., 'NEGATION')`
  命中后 HP 归零（死亡）；
- 对照组：无此旗标的 `goblin` 盟友被同样命中，只清状态、HP 不变。

---

## 6. MONST_GETS_TURN_ON_ACTIVATION — 未实现

**CE 语义**（Rogue.h:2087）：`// monster never gets a turn, except when its
machine is activated`。这不是一条孤立的战斗判定，而是深度耦合 CE 的
"vault/机关"子系统的行为开关：

- `Time.c:1207/1556/1832/1959/2686/2725`：在推进怪物回合的调度里，凡带这个
  标志的怪物默认被跳过（不进入正常的"每回合行动"轮转），只有当它所在的
  "机关"（压力板/拉杆触发的房间机制，`rogue.machineNumber` 关联逻辑）被
  激活时才短暂获得行动机会。
- `Dijkstra.c:222-223`、`Monsters.c:2144/3342`：寻路/AI 判定里也把这个标志
  和 `MONST_IMMOBILE` 同等对待（不主动出手/不参与常规索敌）。

**为什么本轮不做**：这不是"加一个 if 判断"能解决的——它依赖 CE 的整套
vault 机关系统（房间蓝图里的压力板/雕像/开关联动），而：

- 该系统在 web 里**完全不存在**：`Architect.ts`/`BlueprintEngine.ts`
  （地牢/房间生成）是本轮明确禁止触碰的文件，且检索确认目前没有任何
  "机关触发怪物行动"的概念或数据结构。
- 加一个简化版（例如"这些怪物永远不主动行动，直到玩家做了某个约定动作"）
  会是**凭空发明 CE 不存在的简化机制**，而不是"实现 CE 机制"——按项目
  规范 §5.4"提示词要求实现 CE 中不存在的机制时，拒绝实现"的同一原则，
  反过来这里是"CE 机制存在，但其前置子系统在 web 不存在"，同样不该现场
  拍一个简化版凑数。

**当前实际行为**（如实记录，不静默跳过）：`stone_guardian`/`winged_guardian`/
`eldritch_totem`/`mirrored_totem` 这些带 `MONST_GETS_TURN_ON_ACTIVATION` 的
怪物，在 web 里目前和普通怪物一样，会按自己的 `state`（通常
`MONST_ALWAYS_HUNTING` 让它们构造时就不是 `ASLEEP`）每回合自主寻路/攻击/
施法——这与 CE"平时一动不动，直到机关触发"的设计不符。`P4-3 验收 6` 用一个
显式测试记录了这个现状（断言旗标确实存在、`MONST_ALWAYS_HUNTING` 确实让它
非睡眠，但不对"它应该不主动行动"做任何断言），避免这个缺口被静默略过。

---

## 7. DetailGenerator 措辞 vs 实际行为对照（只列不改）

`src/engine/UI/DetailGenerator.ts`（本轮禁改）里的标签，与本轮实现后的
实际行为对照：

| 标签 | 文案 | 本轮后是否属实 |
|---|---|---|
| `MONST_INVULNERABLE` | "无敌" | ✅ 属实（近战/投掷/怪物法术/玩家 FIRE·LIGHTNING 均豁免） |
| `MONST_IMMUNE_TO_WEAPONS` | "免疫武器伤害" | ✅ 属实，且措辞本身已经准确区分"武器"（没有说"免疫一切"） |
| `MA_REFLECT_100` | "反射所有远程法术" | ⚠️ 基本属实，但 web 简化成"伤害记账切换目标"而非真实弹道折返（见 §3），面板没有体现这个简化 |
| `MONST_REFLECT_50` | "有概率反射法术" | ✅ 属实 |
| `MONST_INVISIBLE` | "隐形" | ⚠️ 基本属实，但 CE 有"telepathy 下显示幽灵符号"的中间态，web 目前是"telepathy 下等同完全可见"，面板没有体现这个差异 |
| `MONST_DIES_IF_NEGATED` | "被消除时死亡" | ⚠️ 措辞准确，但该效果目前只能通过"怪物对玩家盟友施放 NEGATION"触发（§5），面板没有说明这一点；对没有可驯服/召唤该类怪物玩法的普通玩家，这条标签在实战里几乎不会被观察到 |
| （无标签）`MONST_GETS_TURN_ON_ACTIVATION` | 不在 `SPECIAL_FLAG_LABELS` 里 | 核实无对应面板文案，符合提示词"web 代码中零引用"的描述 |

---

## 8. 反向验证（项目规范 §5.2）

把 `Combat.ts` 里的

```ts
const defenderIsInvulnerable = defender instanceof Monster && defender.isInvulnerable();
```

临时改成

```ts
const defenderIsInvulnerable = false; // TEMP BREAK FOR REVERSE VERIFICATION
```

运行 `npx vitest run src/test/p4_3_special_monster_flags.test.ts -t "MONST_INVULNERABLE"`，失败输出：

```
FAIL  src/test/p4_3_special_monster_flags.test.ts > P4-3 验收 1：MONST_INVULNERABLE — Warden of Yendor 打不死 > 玩家近战攻击 50 次，Warden 血量不变，也不会死亡
AssertionError: expected 4 to be +0 // Object.is equality
- Expected
+ Received
- 0
+ 4
 ❯ src/test/p4_3_special_monster_flags.test.ts:64:32
     62|         for (let i = 0; i < 50; i++) {
     63|             const res = CombatSystem.attack(game.player, warden);
     64|             expect(res.damage).toBe(0);
        |                                ^
     65|         }
Tests  1 failed | 11 skipped (12)
```

已还原改动，还原后重跑 `npx vitest run`：348 passed（与还原前一致）。

---

## 9. 边界与约束核对

- 只修改了允许清单内的三个文件：`src/entities/Monster.ts`、
  `src/engine/Core/Game.ts`、`src/engine/Combat/Combat.ts`。
  `src/engine/Lighting/FOV.ts` 未改动——FOV.ts 只算"格子是否在视野内"，
  和具体怪物无关；`MONST_INVISIBLE` 的判定点在 `Game.update()` 里过滤
  `visibleMonsters` 集合，不需要改 FOV 的可见性算法本身，故未触碰。
- 未触碰 `src/data/`、`src/test/fixtures/`、`CombatFormulas.ts`、`Bolt.ts`、
  `Architect.ts`、`BlueprintEngine.ts`、`Player.ts`、`Creature.ts`、
  `ItemLoader.ts`、`Item.ts`、`DetailGenerator.ts`、`Random.ts`、任何 `.vue`
  （`CombatFormulas.ts`/`Bolt.ts`/`Items/Item.ts` 只是被 `import` 读用现成的
  导出函数/类，没有修改这些文件本身）。
- 未修改任何已有的 `.test.ts`；新增测试文件
  `src/test/p4_3_special_monster_flags.test.ts`。
- 未执行 `git commit`/`add`/`push`/`reset`/`checkout`。
- 未在仓库里创建临时文件；反向验证的临时改动已在提交前还原并复核 diff。

---

## 10. `npm test` / `npm run build` 完整输出尾部

### npm test（`npx vitest run`）

```
 Test Files  36 passed (36)
      Tests  348 passed | 7 skipped | 5 todo (360)
   Start at  21:12:54
   Duration  14.20s (transform 1.92s, setup 0ms, import 4.47s, tests 47.37s, environment 9ms)
```

### npm run build

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

vite v7.3.1 building client environment for production...
transforming...
✓ 785 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                               0.76 kB │ gzip:   0.43 kB
dist/assets/index-BKEX-kz0.css               17.01 kB │ gzip:   4.10 kB
...
dist/assets/index-DAOLOLwl.js               904.51 kB │ gzip: 286.61 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.68s
```

（chunk 体积警告是既有状况，与本轮改动无关，未处理。）

---

## 11. `git diff --stat`

```
 src/engine/Combat/Combat.ts |  40 ++++++++++--
 src/engine/Core/Game.ts     | 110 ++++++++++++++++++++++++++++-----
 src/entities/Monster.ts     |  53 ++++++++++++++++
 3 files changed, 182 insertions(+), 21 deletions(-)
```

（另有新增未跟踪文件 `src/test/p4_3_special_monster_flags.test.ts`，不计入
`git diff --stat`。）

---

## 12. 验收条款逐条对照

1. **Warden 打不死**：✅ `P4-3 验收 1`。
2. **免疫武器**：✅ `P4-3 验收 2`（revenant 近战不掉血 + FIRE bolt 仍掉血）。
3. **反射**：✅ `P4-3 验收 3`（怪物侧 spark_turret→stone_guardian，玩家侧
   玩家→stone_guardian，各一例）。
4. **隐形**：✅ `P4-3 验收 4`（phantom 不进 `visibleMonsters`；telepathy 例外；
   对照组 goblin 正常可见）。
5. **反向验证**：✅ 见 §8。
6. **未实现项显式测试**：✅ `MONST_GETS_TURN_ON_ACTIVATION` 有 `P4-3 验收 6`
   显式记录现状，不静默跳过；`MONST_DIES_IF_NEGATED` 虽然实现了，但对
   "卷轴占位"这条提示词提到的缺口也在 §5 里如实说明（未强行凑一个卷轴
   实现，因为卷轴逻辑在 `src/data/`/占位分支之外还涉及消耗品系统，超出
   本轮"旗标生效"范围，且 negation bolt 本身已经通过怪物施法路径可达，
   足以验证旗标生效）。
7. **`npm test`/`npm run build` 全绿，原 336 不减少**：✅ 348 passed
   （336 + 12 新增），0 failed；`npm run build` 通过。
