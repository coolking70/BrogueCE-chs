# P4-1b：怪物真正施放远程法术

## 边界回顾

- 允许修改：`src/entities/Monster.ts`、`src/engine/Core/Game.ts`、`src/engine/Combat/Bolt.ts` —— 三个都改了。
- 允许新增：测试文件、报告文件 —— 新增 `src/test/p4_1b_monster_casting.test.ts` 与本报告。
- 未触碰：`src/data/` 下任何 json、`src/test/fixtures/` 下任何 json、Architect.ts、BlueprintEngine.ts、CombatFormulas.ts、Combat.ts、Player.ts、Creature.ts、ItemLoader.ts、Item.ts、DetailGenerator.ts、Random.ts、任何 `.vue`。
- 未修改任何已有 `.test.ts`。
- 未执行 git commit/add/push/reset/checkout。诊断用的临时脚本（`zz_scratch_*.test.ts`、`zz_depth_probe*.test.ts`、`zz_synthetic_balance.test.ts`）已在收尾前全部删除，工作区只留 `p4_1b_monster_casting.test.ts` 与本报告为新增文件（`git status` 已核实）。

---

## 一、施放逻辑与 CE 的逐段对照

### 1.1 `monstUseBolt`（Monsters.c:2786）→ `Monster.tryUseBolt`（Monster.ts）

```
if (!bolts[0]) return false;                        → this.bolts.length === 0 早退
for target in [player, ...monsters]:                 → candidates = [game.player, ...game.monsters]（player 优先，同 CE）
  if generallyValidBoltTarget(caster, target):
    for bolt in caster.bolts:                         → 按 monsters.json 原始顺序（P4-1a 已核实顺序正确）
      if bolt.effect == BE_BLINKING: continue;         → specificallyValidBoltTarget 内部直接判 false（见下）
      if specificallyValidBoltTarget(caster, target, bolt):
        if ALWAYS_USE_ABILITY || rand_percent(30):
          cast; return true;
        // 否则不 break，继续试同一目标的下一个 bolt（CE 原样：if 块内无 else）
```

`tryUseBolt` 的循环结构与 CE 逐行对应，包括"某个 bolt 的 30% 判定没中，不代表整个目标作废，接着试同一目标的下一个 bolt"这条容易被写错的细节（用普通 `for` 循环 + 无 `break`，天然满足）。

### 1.2 `generallyValidBoltTarget`（Monsters.c:2543）→ `generallyValidBoltTarget`（Monster.ts，导出函数）

| CE 分支 | web 实现 | 处置 |
|---|---|---|
| `caster == target` 排除 | `caster === target` | 原样 |
| discordant && WANDERING && target==player 排除 | `caster.hasStatus('discordant') && caster.state === WANDERING && target === game.player` | 原样 |
| `MB_MARKED_FOR_SACRIFICE` 排除 | 未实现 | web 无献祭机制，无对应字段可判——**故意省略**，不是漏做 |
| `monsterIsHidden \|\| MB_SUBMERGED` 排除 | `target.hasStatus('invisible')` 近似 | web 没有"潜水"簿记（bog monster/naga 的潜水在 web 侧另有实现但没有统一状态位可查），只用 invisible 状态近似"隐匿"，**记为简化，不是缺陷**：本轮涉及的 25 只施法怪没有一只依赖 submerged 判定 |
| `openPathBetween` | `game.hasLineOfSight(caster.loc, target.loc)` | 纯几何 Bresenham + `isOpaque`，与 CE 的"直线通路"语义等价 |

### 1.3 `specificallyValidBoltTarget`（Monsters.c:2596）→ `specificallyValidBoltTarget`（Monster.ts，导出函数）

| CE 分支 | web 实现 | 处置 |
|---|---|---|
| `BF_TARGET_ALLIES` && !teammates → false | `meta.targetAllies && !monstersAreTeammates(...)` | 原样（见 1.4 阵营模型） |
| `BF_TARGET_ENEMIES` && !enemies → false | `meta.targetEnemies && !monstersAreEnemies(...)` | 原样 |
| `BF_TARGET_ENEMIES` && `MONST_INVULNERABLE` → false | `target instanceof Monster && target.hasBehavior('MONST_INVULNERABLE')` | 原样（web 没有怪物实际带这个 flag，但判定逻辑到位） |
| 反射目标不发可反射 bolt（除非是自己盟友） | **未实现** | web 没有"怪物受护甲反射效果影响"的既有管线（反射相关代码只在玩家装备侧），本轮涉及的 13 个已映射 bolt 里也没有一个用得上——**记为已知简化** |
| `forbiddenMonsterFlags & target.info.flags` | 仅对 BECKONING 实现（目标 `MONST_IMMOBILE`/`MONST_TURRET` 时不拉拽） | CE 里这张表只有两条非空项（arrow/spiderweb 的 `MONST_IMMUNE_TO_WEAPONS`，与我们无关；growing vines 的 `MONST_IMMUNE_TO_WEBS`，SPIDERWEB/VINES 本轮是已知缺口不实现），**BECKONING 这条是唯一对本轮 13 个已映射 bolt 有意义的**，已实现 |
| `BF_FIERY` && `STATUS_IMMUNE_TO_FIRE` → false | `meta.fiery && target.hasStatus('immune_fire')` | 原样 |
| `BF_FIERY` && 站在易燃地块上不放火 → false | **未实现** | web 环境系统的"这块地会不会烧起来伤到自己"判定没有对应查询接口，且 25 只施法怪没有一只常驻易燃地块——**已知简化** |
| `BE_BECKONING`：距离 ≤1 不放 | 原样实现 | — |
| `BE_ATTACK`：目标嵌在墙里不放箭 | **未实现** | web 没有"生物嵌在墙体里"的状态（那是 CE 专属的"埋伏怪"机制，本项目怪物模型没有对应字段） |
| `BE_DAMAGE`：目标 entranced 时敌方不打断 | **未实现** | web 的 StatusId 没有 entranced，无对应机制 |
| `BE_DISCORD`：已 discordant 或 target==player → false | 原样实现 | — |
| `BE_NEGATION`：九路复杂判断 | **简化为**："目标是敌人 且 (hasted 或 telepathy 或 已护盾)" | CE 原版还包含"给自己解除随从的 discordant/magical fear""把免疫火焰/悬浮的敌人踢进岩浆或深渊""不对已知反射护甲的玩家放"等边缘分支，这些依赖 web 没有的状态（entranced、magical_fear）或没有意义（web 没有"把人踢进岩浆"的地形交互）。简化版保留了最常触发、最可观测的核心用途（驱散敌方的加速/护盾），已用测试覆盖（见"目标选择正确"用例的间接验证） |
| `BE_SLOW`/`BE_HASTE`/`BE_SHIELDING`：已有同类状态则不重复放 | 原样实现（`slowed`/`hasted`/`isShielded`） | — |
| `BE_HASTE`/`BE_SHIELDING` 的 `targetEligibleForCombatBuff`（Monsters.c:2571）| **未实现，简化为"目标不是自己"+ 上面的阵营过滤** | CE 这个子函数依赖 `MONSTER_TRACKING_SCENT`（web 用 HUNTING 近似都嫌牵强）和"caster 能直接看到某个正被围攻的敌人"这类多层状态，实现成本高、且不影响"该不该打玩家/该不该打友军"这条主验收线——**已知简化，记录在案，不影响本轮验收条款 1-7** |
| `BE_HEALING`：满血不打 | 原样实现 | — |
| `BE_TUNNELING`/`BE_OBSTRUCTION`：怪物永远不放 | 不适用（monsters.json 没有怪物带这两种 bolt） | — |

### 1.4 阵营模型（`monstersAreTeammates`/`monstersAreEnemies` 简化）

CE 的 `monstersAreTeammates`/`monstersAreEnemies`（Monsters.c 别处）built 在完整的 `creatureState`（`MONSTER_ALLY`/`MONSTER_TRACKING_SCENT`/`MONSTER_FLEEING` 等）与 `bookkeepingFlags`（俘虏、驯服中等）谱系上。web 的 `MonsterState` 只有 `ASLEEP/WANDERING/HUNTING/FLEEING` 四态，没有独立的"是否是玩家的友军"状态机，只有 `Monster.isAlly: boolean`。本轮用最小充分模型实现：

```ts
faction(c) = c instanceof Player ? 'player' : (c.isAlly ? 'player' : 'hostile');
teammates(a,b) = !discordant(a) && !discordant(b) && faction(a) === faction(b);
enemies(a,b)   = discordant(a) || discordant(b) || faction(a) !== faction(b);
```

这精确覆盖了本轮 25 只施法怪的全部场景（清一色敌对怪物之间互为队友、玩家/召唤盟友是另一阵营），且天然复用了已有的 `discordant` 状态（P2 起已实现的"六亲不认"机制）。**没有实现**的是 CE 里"驯服中的怪物半友半敌""俘虏怪物"等中间态——web 没有这些机制，不是本轮该修的范围。

### 1.5 施法出口耗时（Monsters.c:3139）

```c
monst->ticksUntilTurn = monst->attackSpeed * (MONST_CAST_SPELLS_SLOWLY ? 2 : 1);
```

`tryUseBolt` 施法成功后直接调用 `this.endTurnWithAttack()`——这是 P2-2 已经为普通近战/远程攻击写好的**同一个私有方法**，口径完全复用，没有重新发明一份耗时公式。测试见验收条款 5。

### 1.6 施法消息（`monsterCastSpell`，Monsters.c:2764）

CE 在可见时打印 "`<怪物名> <bolt.description>`"（如 "the spark turret shoots a spark"）。web 侧 `castMonsterBolt` 用 i18next + `defaultValue` 的既有写法打印中文措辞（自拟，非翻译 CE 原文，不构成版权复制问题），键名前缀 `bolt.monster_cast_*`。**未做**的是 CE 的"仅在 `canDirectlySeeMonster(caster)` 时才打印"这层可见性门——web 沿用项目里其它怪物战斗消息（如 `combat.monster_hits_you`）目前也没有做这层门控的既有惯例，不属于本轮范围内的新问题。

---

## 二、`applyBoltEffect` 的泛化做法

任务要求"泛化到怪物施法者情形，但不破坏玩家现有路径"。**没有**直接改造 `Game.ts` 里原有的 `applyBoltEffect(result, item)`——那是一个近 300 行的大 switch，每个分支的措辞、目标选取逻辑都硬编码了"施法者一定是玩家、`item.name` 一定存在"的假设（例如 HASTE/SHIELDING 分支直接 `this.applyTimedStatus(this.player, ...)`，完全不看 bolt 实际打中了谁）。逐分支拆开重构风险远大于收益：一旦哪个分支的措辞/目标选取被改动，`zapBoltFromPlayer` 的既有回归测试可能连带失手。

改用的做法：新增一个**平行的、面向"施法者可以是怪物、目标可以是玩家或任意怪物"**的出口 `Game.castMonsterBolt(caster: Monster, target: Creature, ceBoltName: string)`，两条路径**共享底层原语、不共享分支体**：

- 路径与动画：复用 `boltPath`/`buildBoltFrames`（Bolt.ts 本来就是纯函数，天然可复用）。
- 状态施加：复用 `this.applyStatusToMonster` / `this.applyTimedStatus`（私有方法，同一个 Game 类内部直接调用，不需要改可见性）。
- 伤害类 bolt：复用 `CombatSystem.attack(caster, target)` ——理由见下一节。
- 点火：复用 `this.environment.ignite`。
- 护盾：新增的 `isShielded`/`applyShieldStatus`（Monster.ts 导出的模块级函数，不依赖 Combat.ts）。

`zapBoltFromPlayer → applyBoltEffect` 的调用链**逐字节未改动**（只在文件里新增了 `castMonsterBolt` 方法和两处 import，原方法体一行没动）；`npm test` 里所有玩家施法相关的既有用例（`smoke.test.ts`、各 `armor_*`/`scroll_effects` 里涉及卷轴/法杖的用例）全部原样通过，见第五节。

### 伤害类 bolt 为什么走 `CombatSystem.attack` 而不是 CE 的 `zap()` 伤害公式

CE 的 bolt 伤害由 `zap()`（Combat.c，不在本轮允许修改的文件里，且 web 侧没有对应移植）按 `boltCatalog.magnitude` 与目标属性算出，与武器/怪物近战伤害是两套独立公式。web 项目在 P4-1a 之前就已经有一个"怪物远程攻击"的占位实现——`abilities.has('ranged')` 桩（centaur 用）——它的做法是直接调用 `CombatSystem.attack(caster, target)`，即拿怪物自己的 `damageString` 走**和近战完全相同**的命中/防御/onHit 结算。这不是本轮发明的新简化，而是**项目既有的、P4-1a 之前就存在的既定简化**。本轮延续这个既定口径，理由：

1. `Combat.ts`/`CombatFormulas.ts` 是禁改文件，无法在其中新增一套"bolt 专属伤害公式"。
2. 重新发明一套独立公式会绕开项目已经跑通的命中率、防御减免、`onHit`（`MA_POISONS`/`MA_CAUSES_WEAKNESS`/`MA_HIT_HALLUCINATE`）、护甲符文反震等管线，等于把 P1-P3 好几轮的既有成果在 bolt 路径上重新实现一遍且大概率遗漏细节。
3. 与"游戏里唯一一处已经在用的怪物远程攻击"（原 `ranged` 桩）保持一致，不引入第二套并行、互相矛盾的远程伤害口径。

---

## 三、`abilities.has('ranged')` 旧桩的处置：**整段移除**，理由

核实结果：`monsters.json` 里同时带 `abilities:['ranged']` 与非空 `bolts` 的怪物**只有 centaur 一个**（`abilities` 只在 centaur 身上出现 `'ranged'`，其余 24 只施法怪都没有这个 ability 标记；`ranged` 也没有在任何"无 bolts"的怪物身上出现）。

若保留旧桩作为"施法判定 30% 没中之后的兜底"，会出现**双重远程**的 bug：centaur 先按 `tryUseBolt` 走一次 CE 式的 30% 判定，没中（70% 概率）之后又会落进旧的 `abilities.has('ranged') && distToPlayer in [2,8]` 分支，直接白嫖一次等价的 `CombatSystem.attack`——这在 CE 里是不存在的（`monstUseBolt` 判定失败后，`monsterCastSpell` 根本没被调用，`monstUseMagic` 返回 false，本回合转入移动/待机决策，不会退化成一次免费攻击）。

处置：**移除了 ally 分支与 hunting 分支两处 `abilities.has('ranged')` 桩的全部代码体**，改由 `tryUseBolt` 统一接管。为防止未来出现"有 `ranged` ability 但没有 `bolts` 数据"的怪物导致远程行为完全丢失，`tryUseBolt` 在 `this.bolts.length === 0` 时会立即返回 `false`，调用方（`takeTurn`）随后正常落入原有的近战/移动决策——不会静默吞掉这类怪物的行为，只是它们会表现成近战怪（与移除前"该桩从不触发"的效果一致，因为当前数据集里不存在这种怪）。

`MonsterAbility` 类型定义里的 `'ranged'` 字面量本身**没有删除**（`abilities?: MonsterAbility[]` 字段、`DetailGenerator.ts` 等展示逻辑可能仍引用），只是移除了 `takeTurn` 里对它的行为绑定，这不在禁改文件清单内被视为越界（`Monster.ts` 允许修改）。

---

## 四、`MONST_TURRET` 的移动处理

**核实前的现状（P4-1a 遗留，P4-1b 发现的既有问题）**：`monsters.json` 里炮塔/图腾类怪物已经带有 `"MONST_TURRET"`（arrow/spark/dart/flame turret、sentinel）或 `"MONST_IMMOBILE"`（ogre_totem/goblin_totem/mirrored_totem 等，`grep` 命中 6 处）字符串标记，但**在本轮之前，`Monster.ts`/`Game.ts` 里没有任何代码读取这两个 flag**（除 `DetailGenerator.ts` 用于展示文案）。也就是说，炮塔/图腾在本轮之前会正常执行 `takeTurn` 里的寻路/移动/近战逻辑，**会随意走动、会近战**——这与 CE 的 `MONST_IMMOBILE`（"monster won't move or perform melee attacks"，Rogue.h:2061）完全不符，是一个先于本轮就存在、但恰好落在"炮塔到底该不该动"这个问题正中央的 bug。

处置：`takeTurn` 里新增判定 `const isImmobile = this.hasBehavior('MONST_IMMOBILE') || this.hasBehavior('MONST_TURRET')`（`MONST_TURRET` 在 CE 里本来就是复合 flag、隐含 `MONST_IMMOBILE`，Rogue.h:2093；web 的 behaviorFlags 只存了未展开的复合标记字符串，这里按语义直接归并判断）。在 `tryUseBolt` 尝试施法之后、进入 ally/hunting 的移动与近战分支之前，`if (isImmobile) return;`——immobile 怪物本回合要么已经施法（`tryUseBolt` 内部已 `return`），要么什么都不做，**不会移动，也不会进入下面的近战判定**。已用测试直接验证（见"MONST_TURRET 不移动、不近战"用例：玩家远离到视野外后，炮塔在 20 回合 `takeTurn` 后坐标分毫未变）。

---

## 五、两处已知缺口（SPIDERWEB / ANCIENT_SPIRIT_VINES）的处置

**处置：本轮不实现，登记为显式已知缺口，不静默跳过。**

理由与 P4-1a 报告一致且已核实：两者在 CE 里 `boltEffect` 都是 `BE_NONE`，效果落在 `targetDF`（`DF_WEB_SMALL`/`DF_WEB_LARGE`、`DF_ANCIENT_SPIRIT_GRASS`/`DF_ANCIENT_SPIRIT_VINES`）指向的地形铺设逻辑（`spawnDungeonFeature`），而不是"命中生物本身产生效果"——这与 `BoltEffect`/`applyBoltEffect`/`castMonsterBolt` 统一遵循的"命中目标产生效果"模型是两种不同的机制形状。虽然 web 确实已有 `TerrainType.WEB`（`Monster.tryMoveTo` 里怪物路过蛛网会挣扎/破网），但那段代码处理的是"怪物自己踩到已存在的蛛网"，不是"施放 SPIDERWEB 在目标周围铺网"——复用它意味着还要另外实现"以 bolt 落点为中心铺一片新网"的生成逻辑，这本质上是新功能而不是"顺手接一下"，与本轮"施放逻辑"的范围边界不符，仓促拼凑容易做出一个半吊子、之后还要返工的实现。

具体机制：`MONSTER_BOLT_TABLE['SPIDERWEB'].effect = null`、`MONSTER_BOLT_TABLE['ANCIENT_SPIRIT_VINES'].effect = null`；`specificallyValidBoltTarget` 对 `effect === null` 直接判 false，`tryUseBolt` 因此永远不会为这两个 bolt 触发施法。`KNOWN_GAP_MONSTER_BOLT_NAMES` 常量显式登记这两个名字，测试里用两条断言防止"未来悄悄新增一个既不在 `BoltEffect` 也不在缺口清单里的 CE bolt 名却没人发现"：

1. `monsters.json` 里出现过的所有 CE bolt 名都能在 `MONSTER_BOLT_TABLE` 查到（覆盖率断言）。
2. `spider` 本体确认：`MONST_ALWAYS_USE_ABILITY` 标记在、`bolts` 数据在、`MONSTER_BOLT_TABLE['SPIDERWEB'].effect` 确实是 `null`——三者合起来证明"spider 不放网"是**设计决定**的结果，不是巧合或遗漏。

**连带影响**：spider 是本轮唯一带 `MONST_ALWAYS_USE_ABILITY` 的怪物，但它唯一的 bolt 恰好是已知缺口，所以 spider 实际观测行为是"永远不施法"（`tryUseBolt` 每次都因为 `effect === null` 被过滤掉）——验收条款 4 要求的"ALWAYS_USE_ABILITY 100% 施放"改用一份复刻 spider 行为标记、但换成已实现 bolt（SPARK）的合成测试数据来验证判定逻辑本身，spider 本体则单独用上面第 2 条断言确认"不施法是缺口导致，不是判定逻辑错了"。

---

## 六、生成基线是否受影响

**未受影响。** `npx vitest run src/test/generation_baseline.test.ts` 全绿：

```
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

原因分析：本轮所有改动（`tryUseBolt`/`castMonsterBolt`/turret 移动门控）都挂在 `Monster.takeTurn` 与 `Game.castMonsterBolt` 上，只在**怪物回合推进**时才会被调用。地图/怪物/物品生成阶段（`Architect.ts`、`BlueprintEngine.ts` 等，均未改动）不跑任何 `takeTurn`，自然不会消耗额外的 RNG 抽取，不会移动生成期的 RNG 流。

**Play 期 RNG 流确实会移动**（预期内，任务已说明）：`rng.randPercent(30)` 的判定本身、`tryUseBolt` 遍历 `[player, ...monsters]` 时对每个候选目标的视线/合法性检查虽然不消耗 RNG，但一旦真正施法，会通过 `CombatSystem.attack`（伤害类 bolt）或状态施加消耗与此前"该怪物本回合做什么"完全不同的 RNG 序列——这是任务描述里明确预期且授权的改动，不需要重采任何 fixture（`src/test/fixtures/` 下的 json 本轮也确实一次没碰）。

---

## 七、平衡观测（第 9 条，不作为通过条件，如实报告）

### 7.1 方法说明与一次绕路

最初按任务建议直接用 `src/test/harness.ts` + 一个"下楼策略"（复刻自 `monster_damage_balance.test.ts` 的 `makeDescendingPolicy`）跑 5-8 个固定 seed × 2000 回合，`git stash` 切换本轮改动前后对比。**实测发现该策略在这批 seed 上 2000 回合内最深只能摸到 D1-D3**（曾用的种子 seed=20260913 更极端：玩家出生在被 `WATER_DEEP` 四面合围的孤岛上，`canMoveTo` 判定深水不可通行，整条策略永远只能 `wait`——这是一个**先于本轮存在、与本轮改动无关**的地图生成边角案例，未纳入禁改范围，只是如实记录，不在本轮修）。换了一批种子（1-8）后能正常移动，但 300-2000 回合内仍只摸到 D1-D3——这个深度区间里 monsters.json 的 25 只施法怪没有一只会出现（`goblin_mystic`/`goblin_totem` 等最浅的施法怪 `minDepth` 都明显更深）。于是这批 seed 下，改动前后的死亡数/总伤害**逐位完全相同**（如实记录，不是没测出来，是这批采样确实覆盖不到任何施法怪）：

```
seed=1 died=false damageTaken=18  maxDepth=1
seed=2 died=true  damageTaken=66  maxDepth=2
seed=3 died=false damageTaken=109 maxDepth=3
seed=4 died=false damageTaken=46  maxDepth=1
seed=5 died=false damageTaken=41  maxDepth=1
seed=6 died=true  damageTaken=49  maxDepth=2
seed=7 died=false damageTaken=24  maxDepth=1
seed=8 died=true  damageTaken=58  maxDepth=3
deaths=3/8  totalDamage=411   ← 本轮改动前后完全一致
```

这个空结果本身是诚实的信号："这批 seed 的采样范围碰不到本轮改动的东西"，而不是"本轮改动没有影响"，据此换了第二种更直接的方法。

### 7.2 合成场景对比（主要证据）

在同一个 `Game` 实例里手搭一个"玩家被 5 只施法怪（goblin_mystic / ogre_totem / spark_turret / dar_battlemage / centaur）围住"的贴身场景，除 `monster.bolts` 是否清空外其余完全一致（同一批种子、同一张地图、同样的怪物列表与站位），跑 300 回合，直接对比"施法开关"两侧的结果——这样把"turret 不再乱走的修复""bolt 判定本身"这两个变量都保留在同一份代码里，只隔离"施法是否发生"这一个变量：

```
seed  withoutBolts(damage/died)   withBolts(damage/died)
1     0 / false                   32 / true
2     0 / false                   33 / true
3     0 / false                   33 / true
4     0 / false                   31 / true
5     0 / false                   35 / true
TOTAL 0 / 0 死亡                  164 / 5 死亡（5/5 全灭）
```

**如实解读，不夸大也不淡化**：这是一个刻意堆高密度的压力场景（5 只施法怪同时包围玩家），不代表正常游玩会经常遇到的局面——真实地牢里这几种怪物分散在不同层、不同地点。它证明的是"施法逻辑确实在起作用、确实会造成实质伤害"（验收条款 1 已经单独测过），以及**在这类局面下影响是数量级的**：`withoutBolts` 时这些怪物大多是 `MONST_MAINTAINS_DISTANCE`/免疫近战的图腾/炮塔，在没有真正的远程手段时几乎打不到玩家（0 伤害）；有了施法后，SPARK/HEALING/HASTE/SLOW 等组合迅速形成火力与减益压制，5 个种子全部导致玩家死亡。

**结论**：正如任务描述所说，"这一轮会实质改变深层战斗难度"——本次量化验证了这个预期方向是对的，且量级不小。没有为了让数字好看而调参（`rand_percent(30)`、伤害走既有 `CombatSystem.attack`、状态时长都是照抄 CE 或复用既有常量，没有额外手动调低命中率或伤害）。按项目决策 D1，这类平衡问题记录留待二次开发，本轮不因此收窄实现。

---

## 八、验收条款逐条对照

1. **施放确实发生**：`spark turret 与玩家之间有直线视野时…` 用例，500 次尝试内必定命中并造成伤害——通过。另加 `dragon DRAGONFIRE` 命中后点燃地块的用例。
2. **目标选择正确**：4 个用例覆盖 `BF_TARGET_ALLIES`（SHIELDING/HEALING 不打玩家；SHIELDING 会正确护盾友军）与 `BF_TARGET_ENEMIES`（SPARK 不打同阵营友军）——通过。
3. **视线约束**：炮塔与玩家之间砌墙后 300 次尝试均不施放——通过。
4. **30% 概率**：spark turret 4000 次采样，频率落在 [0.25, 0.35]（±0.05，约 7 个标准差的宽容差，足以抓出"漏做判定"或"方向反了"这类错误实现）——通过；`MONST_ALWAYS_USE_ABILITY` 合成用例 50/50 次 100% 施放——通过；spider 本体因 SPIDERWEB 是已知缺口而永不施放，单独断言确认是缺口而非判定逻辑错误——通过。
5. **施法 tick**：无 `CAST_SPELLS_SLOWLY` 的 spark turret 施法后 `ticksUntilTurn === attackSpeed`；带 `CAST_SPELLS_SLOWLY` 的 sentinel 施法后 `ticksUntilTurn === attackSpeed × 2`——通过。
6. **玩家路径未破坏**：`applyBoltEffect`/`zapBoltFromPlayer` 一行未改，`npm test` 里全部既有玩家施法相关用例（含 `smoke.test.ts`、涉及法杖/卷轴的用例）原样通过——见下方完整输出。
7. **BLINKING 被跳过**：imp 只有 `BLINKING` 一个 bolt，500 次尝试从不施放——通过。
8. `npm test` 全绿，306 → **322 passed**（新增 16 条，原有 306 条一条未减）；`npm run build` 全绿——见下方完整输出。
9. **平衡观测**：见第七节，如实报告，未调参。

反向验证（§5.2）：故意把 `specificallyValidBoltTarget` 里 `BF_TARGET_ALLIES` 的判定短路成恒 false 判定（`if (false && meta.targetAllies …)`），"SHIELDING 不打玩家"与"HEALING 不打玩家"两条用例应声失败（goblin mystic 的 SHIELDING 打中了玩家、ogre totem 的 HEALING 把玩家治到了 30 血），确认测试确实在断言正确的东西后已还原，`npm test` 复跑回到 322 passed 全绿。

### `npm test` 完整输出尾部

```
 Test Files  34 passed (34)
      Tests  322 passed | 7 skipped | 5 todo (334)
   Duration  17.49s (transform 1.76s, setup 0ms, import 4.46s, tests 57.21s, environment 10ms)
```

### `npm run build` 完整输出尾部

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
dist/assets/index-CHzz0cNS.js               900.15 kB │ gzip: 285.19 kB

(!) Some chunks are larger than 500 kB after minification. …
✓ built in 1.61s
```

（chunk 体积警告是既有警告，与本轮改动无关。）

### `git diff --stat`

```
 brogue-web/src/engine/Combat/Bolt.ts |  63 ++++++++++
 brogue-web/src/engine/Core/Game.ts   | 171 ++++++++++++++++++++++++-
 brogue-web/src/entities/Monster.ts   | 236 +++++++++++++++++++++++++++--------
 3 files changed, 418 insertions(+), 52 deletions(-)
```

（`+ src/test/p4_1b_monster_casting.test.ts`、`+ 本报告` 为未跟踪新增文件，不计入上面的 diff --stat。）

---

## 九、与预设不符之处（只列不修）

1. **`MONST_TURRET`/`MONST_IMMOBILE` 在本轮之前从未被 `Monster.ts`/`Game.ts` 读取**——炮塔/图腾此前会随意走动、能近战，这不是提示词描述的问题，是本轮排查移动逻辑时额外发现的既有 bug（详见第四节）。已在本轮一并修复，因为它与"炮塔该不该动"这条验收线直接相关，不修就没法让炮塔的行为看起来像 CE。
2. **提示词给出的"炮塔用 `abilities.has('ranged')` 占位"描述准确**，但提示词没有提到"这个桩目前只有 centaur 一个怪物真正满足触发条件"这个事实——独立核对 `monsters.json` 后确认，据此才能判断"直接删除旧桩"是安全的（第三节）。
3. **`src/test/monster_damage_balance.test.ts` 的注释提到 `ai_docs/monster_damage_notation_report.md`**，但该文件在当前工作区不存在（可能在早期轮次生成后未提交，或路径变了）——与本轮无关，只是核实平衡观测方法时顺带发现，如实记录。
4. 提示词第 9 条建议直接用"harness + 多 seed × 2000 回合"做平衡对比，实测这批默认种子在 2000 回合内够不到任何施法怪出现的深度（见第七节 7.1），**据此换用了合成贴身场景做主要证据**，harness 版结果也如实保留作为"空对照"记录，不隐瞒方法上的绕路。
