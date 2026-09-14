# P4-6 报告：矛 / 斧 / 鞭——三种攻击几何（怪物侧）

## 0. 与任务书事实陈述的核对结论

逐条核实了任务书给出的 CE 行号、代码片段与事实陈述，结论：**任务书的事实陈述全部与 CE 源码相符，没有发现需要反驳的错误**。核对过的点：

- `Rogue.h:2120-2122` 三条注释中**前两条确实写反**（PENETRATE 标着 "like an axe"、ALL_ADJACENT 标着 "like a spear"、EXTEND 的 "like a whip" 正确），原文逐字符核对一致。
- `handleSpearAttacks` 门控 `MA_ATTACKS_PENETRATE`（`Movement.c:934`）、`handleWhipAttacks` 门控 `MA_ATTACKS_EXTEND`（`Movement.c:873`）——名字与行为一致，注释才是错的。
- `buildHitList(..., sweep=true)` 的 sweep 参数来自 `MA_ATTACKS_ALL_ADJACENT`（`Monsters.c:3878-3879`）。
- 五只怪的旗标与行号全部核实：goblin=矛（`Globals.c:1042`）、goblin warlord=矛（`Globals.c:1128`）、naga=斧（`Globals.c:1081`）、dragon=斧（`Globals.c:1124`）、salamander=鞭（`Globals.c:1083`）。web 侧 `monsters.json` 的旗标与 CE 完全一致。
- 矛射程 2（`Movement.c:923`）、倒序攻击（`Movement.c:1005-1009`，注释原文 "Artificially reverse the order of the attacks, so that spears of force can send both monsters flying."）、遇 `T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION` 即 break（`Movement.c:976-979`）——均逐行核实。
- 鞭射程 5、取沿途第一个受阻点（`Movement.c:888` `getImpactLoc(..., 5, false, &boltCatalog[BOLT_WHIP])` + `Items.c:4300-4332`）——核实。
- `buildHitList` 的 nbDirs/cDirs 表混用（`Combat.c:2060-2074`，`GlobalsBase.c:38-39`）：dir 用 nbDirs 求得却索引 cDirs。净效果确认为"8 邻格全覆盖、只有命中顺序受影响"，与任务书判断一致。

### 任务书没有展开、但核实后对实现有决定性影响的三个细节（单独列出）

1. **远程几何的真正触发路径在 `moveMonster` 内部（`Monsters.c:3817-3822`），且在"目标格是否有怪"的判定之前**——即怪物朝目标方向移动的每一步都会先尝试鞭/矛。这是鞭 5 格射程得以生效的机制：salamander 追击途中、玩家还在 3~5 格外时就沿方向甩鞭，而不是等贴脸。web 据此设了两个挂钩点：`tryMoveTo`（对应 moveMonster 的移动分支）与追击分支里的"直指目标射线"尝试（见下一条）。
2. **CE 追击方向来自 `scentDirection`（`Monsters.c:3473/3488`），直指目标、不绕开友军**。若 web 只挂 `tryMoveTo`（寻路方向），当直线被友军挡住时寻路会绕路、几何就永远打不中挡路的敌人——与 CE 不符（CE 会甩鞭抽挡路的敌人）。因此追击分支在寻路之前先按"目标是否恰在 8 向射线上"做一次 CE 口径的几何尝试（`tryGeometryRayTo`）。
3. **CE 的矛攻击循环（`Movement.c:1007-1009`）没有 `MB_IS_DYING` 复查**——与 sweep 的攻击循环（`Monsters.c:3881-3888`，有复查）不同。web 照字面实现，并有专门断言：远处目标死后贴脸的照样挨打。

另一处 CE 注释与代码不符（任务书未提及，按"以 CE 为准"照代码实现）：`Rogue.h:2122` 说鞭是 "attacks from a distance in a **cardinal** direction"，但代码里 dir 来自 8 向 `nbDirs`（`Monsters.c:3809-3815`）——**斜方向也能鞭**。web 支持全部 8 向。

## 1. 改动清单

| 文件 | 改动 |
|---|---|
| `src/entities/Monster.ts` | 新增模块级 `creatureAtLoc()`（CE monsterAtLoc 等价，含玩家）；新增私有方法 `willAttackTarget()`（monsterWillAttackTarget 简化口径）、`performWhipAttack()`、`performSpearAttack()`、`performSweepAttack()`、`tryGeometryMeleeAdjacent()`（相邻出口的分发）、`resolveGeometryAttackOn()`（单目标结算+出口同款后置处理，带 ally/discordant/hostile 三个 voice）、`rayStepsTo()` + `tryGeometryRayTo()`（追击射线尝试）；挂四个钩子：三个相邻近战出口（ally / discordant / HUNTING-玩家）、两个追击分支（ally / HUNTING）、`tryMoveTo` 的移动方向钩子（蛛网挣扎之后、真正移动之前，与 CE 检查顺序一致） |
| `src/test/p4_6_attack_geometry.test.ts`（新增，374 行） | 14 个测试，见 §4 |

**文件边界**：未触碰 `DetailGenerator.ts`、任何 `src/data/*.json`、任何 `src/test/fixtures/*`（`generation_baseline.json` 未刷新——本轮不涉及生成与 RNG 种子流的地形部分）、`Random.ts`、`Gas.ts`。未执行任何 git 写操作。

## 2. 对"矛=PENETRATE、斧=ALL_ADJACENT"的独立确认（含所读代码行）

| 所读位置 | 看到了什么 | 结论 |
|---|---|---|
| `Rogue.h:2106-2134`（monsterAbilityFlags 枚举） | `MA_ATTACKS_PENETRATE = Fl(13)` 注释 "like an axe"；`MA_ATTACKS_ALL_ADJACENT = Fl(14)` 注释 "like a spear"；`MA_ATTACKS_EXTEND = Fl(15)` 注释 "like a whip" | 注释前两条反了（任务书所述属实） |
| `Movement.c:919-936`（handleSpearAttacks 头部） | `else if (!(attacker->info.abilityFlags & MA_ATTACKS_PENETRATE)) return false;` | **矛=PENETRATE**（以代码为准） |
| `Movement.c:859-875`（handleWhipAttacks 头部） | `else if (!(attacker->info.abilityFlags & MA_ATTACKS_EXTEND)) return false;` | **鞭=EXTEND** |
| `Monsters.c:3877-3889`（moveMonster 的攻击分支） | `buildHitList(hitList, monst, defender, (monst->info.abilityFlags & MA_ATTACKS_ALL_ADJACENT) ? true : false);` 后接攻击循环 | **斧=ALL_ADJACENT（sweep）** |
| `Combat.c:2049-2090`（buildHitList） | sweep 分支 8 向旋转收集，else 分支 `hitList[0] = defender` | sweep=true 即横扫全部相邻 |
| `Globals.c:1042/1081/1083/1124/1128` | 五只怪的 abilityFlags | goblin/warlord=矛、naga/dragon=斧、salamander=鞭 |

## 3. CE 行号对照与关键实现决策

### 3.1 矛（`Movement.c:917-1023` 怪物分支）

- `range = 2`（:923）；逐格 `attacker->loc + (1+i)*nbDirs[dir]`（:948）。
- 起步的 `diagonalBlocked` 检查（:942）**未移植**——web 全局无对角墙角判定（P4-5 起同口径，见 §7）。
- 收集条件（:958-961）：有怪、（该格不阻挡通行**或**目标带 `MONST_ATTACKABLE_THRU_WALLS`）、`monsterWillAttackTarget` → 进 hitList。web 用 `cell.isPassable` 近似 `!T_OBSTRUCTS_PASSABILITY`（**用 Grid 的 isPassable/isOpaque 而不是 P4-5 用过的 `canMoveTo()`**：canMoveTo 会把深水误判为阻挡，而 CE 的深水不阻挡矛/鞭；isPassable 对 WALL/GRANITE/CHASM/SECRET_DOOR 判 false，更贴 CE。此为对 P4-5 口径的有意微调，非沿用）。
- `proceed` 条件（:969-973）：`i == 0` 或目标未隐藏（对怪物攻击者无 canSee 要求；web 用 `invisible` 状态近似 monsterIsHidden，P4-1b 起同口径）。
- break 条件（:976-979）：`T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION` → web 用 `!cell.isPassable || cell.isOpaque`。
- **攻击倒序（:1007-1009）**：先打远的、后打近的；循环内无 dying 复查（与 sweep 不同），web 照字面实现。

### 3.2 斧（`Combat.c:2049-2090` sweep 分支 + `Monsters.c:3877-3889`）

- 以主目标方向为起点旋转 8 向覆盖全部邻格。**CE 的 nbDirs/cDirs 表混用未逐格复刻**（如实取舍）：两张表顺序不同（`GlobalsBase.c:38-39`），混用的净效果只是命中顺序错位、覆盖集合不变；web 用单张 8 向表从主目标方向起旋转，**覆盖集合与 CE 完全一致，仅命中顺序不同**。没有把这个混用"修正"成声称对齐 CE 的行为。
- 只打 `monsterWillAttackTarget` 为真的目标（`Combat.c:2079` 复查 + `Monsters.c:3883` 攻击循环复查）→ web 的 `willAttackTarget()`：敌对（`monstersAreEnemies`，含 discordant 六亲不认）且存活、非 `isCaged`（MB_CAPTIVE）。**不误伤同阵营**。
- 墙里的目标除非 `MONST_ATTACKABLE_THRU_WALLS` 否则不打（`Combat.c:2080-2081`）。
- 横扫恒耗回合（CE `Monsters.c:3871` 在攻击循环之前就置 `ticksUntilTurn = attackSpeed`）。

### 3.3 鞭（`Movement.c:855-912` 怪物分支 + `Items.c:4300-4332` getImpactLoc）

- 射程 5（:888 `getImpactLoc(..., 5, false, &boltCatalog[BOLT_WHIP])`）；打击点 = 沿方向第一个"未隐藏的活物"或"阻挡通行/视线的格子"（`getImpactLoc` 的 monster 分支会**穿过**隐藏/潜水目标，terrain 分支截停）。
- 只打打击点上那**一个**目标，条件（:892-894）：存在、（玩家攻击者才查 canSee）、未隐藏、`monsterWillAttackTarget`。
- **未走 bolt 系统的简化说明（任务书授权）**：CE 用 `zap(originLoc, targetLoc, &theBolt, ...)` 走 BOLT_WHIP 完成表现（'~' 弹道动画）与结算；web 没有 boltCatalog/zap 的完整移植，**不为此新建 bolt 子系统**，直接用既有近战结算 `CombatSystem.attack()` 打打击点上的目标。已核实 `boltCatalog[BOLT_WHIP]`（`variants/GlobalsBrogue.c:89`）是 `BE_ATTACK` 类 bolt（效果即"按武器攻击结算"，`MONST_IMMUNE_TO_WEAPONS` 豁免、`BF_NEVER_REFLECTS` 等），其**结算语义与近战 attack 等价**，损失的只有飞行字符的表现层。已知差异：CE 的 bolt 结算路径不含近战偷袭（backstab）判定，web 的简化实现保留了 CombatSystem.attack 的完整语义（对沉睡目标的鞭击会算偷袭）——影响面为边缘场景，如实登记。
- `diagonalBlocked`（:882）未移植，同 §3.1。

### 3.4 触发路径（`Monsters.c:3809-3822`）

- 相邻近战出口（ally / discordant / HUNTING-玩家）：`tryGeometryMeleeAdjacent()` 先于普通 `CombatSystem.attack`——鞭落空时照 CE 落回普通近战；矛在相邻场景必然 proceed（i==0 即成立）；斧横扫替换单体近战。**CE 同一条 moveMonster 路径不区分目标是谁**，故 discordant 分支同样挂了钩（这也正是 scroll_effects 测试当初翻车、后按出口词汇修正消息的原因，见 §0.2/§6）。
- 追击分支（ally / HUNTING，尚不相邻）：`tryGeometryRayTo()` 沿"直指目标"的 8 向射线先试鞭/矛（对应 CE scentDirection → moveMonster 的流程，见 §0.2）。置于 MAINTAINS_DISTANCE 判定之后——保持距离的怪（goblin warlord）先撤退，撤退方向上的几何尝试由 tryMoveTo 钩子承担，与 CE 一致。
- `tryMoveTo` 移动钩子：每次尝试朝某方向移动时先试鞭/矛（命中即耗回合不移动），位置在蛛网挣扎之后（CE 里被缠住的怪物先挣扎、不过几何检查，`Movement.c:3774` 早于 `:3817`）。斧不在此钩——CE 的横扫只挂在"目标格有怪"的近战分支。

### 3.5 结算与后置处理（`resolveGeometryAttackOn`）

单目标结算统一走 `CombatSystem.attack()`（复用 P4-3/P4-4/P4-5 的全部既有语义：命中掷骰、MA_SEIZES/KAMIKAZE/TRANSFERENCE、免疫豁免），后置处理按**调用出口的 voice** 沿用各出口既有消息键：ally 出口用 `combat.ally_hits/misses/kamikaze/seizes`，discordant 出口用 `combat.discordant_hits/...`，HUNTING 出口对玩家用 `combat.monster_hits_you/...`，hostile 对怪物的几何攻击用新键（仅 defaultValue，zh_CN 资源不在本轮文件边界内）。onHit 状态、MA_POISONS/CAUSES_WEAKNESS/HIT_HALLUCINATE/DEGRADE_ARMOR/HIT_STEAL_FLEE、trySplitMonster、processStaggerHit（P4-5 口径：命中且目标存活才推）、lastDamageSource、血迹与漂浮文字均与对应出口同款。

## 4. 测试清单（`src/test/p4_6_attack_geometry.test.ts`，14 个）与各自捕获的错误实现

**矛（4 个）**
1. 对抗性【头号风险·矛≠斧】：goblin 贴脸玩家 + 玩家身后线上盟友 + 斜角盟友——**照 Rogue.h:2120 反注释把 PENETRATE 实现成横扫的实现**必然扫到斜角探针（断言斜角一滴不掉）。反向验证①的真实失败输出见 §5。
2. 对抗性【射程只有相邻】：goblin 在 2 格直线外必须隔空刺中玩家且原地不出手——**把矛当普通近战**的实现会让 goblin 走进中间格、玩家不掉血。
3. 对抗性【攻击顺序写成正序】：远处 1 HP 探针先死、贴脸玩家照样掉 5 点（**锁 CE 矛循环无 dying 复查**），且日志里 "hits the <远>" 必须先于 "hits you"——**正序实现**顺序相反。
4. 对抗性【矛穿墙】：goblin 与玩家之间隔一格墙——**漏掉 :976-979 break 的实现**会把玩家隔墙刺穿。

**斧（3 个）**

5. 对抗性【头号风险·斧≠矛】：naga 贴脸玩家 + 斜角盟友 + 直线 2 格外盟友——**照 Rogue.h:2121 反注释把 ALL_ADJACENT 实现成直线穿透的实现**打不到斜角、反而会打到 2 格探针，两个探针**双向锁死**。
6. 横扫扫满 8 邻格：naga 被 5 个敌人围住时 5 个全部掉血——**只打主目标或漏斜角的实现**翻车。
7. 对抗性【误伤同阵营】：naga 的同类站旁边毫发无损——**漏 monsterWillAttackTarget 的实现**翻车。

**鞭（3 个）**

8. 射程边界：距 5 格甩到且原地不动；距 6 格甩不到、走近一格——**射程写成无限/6 格**的实现翻车。
9. 对抗性【射程写成 2】：距 4 格必须甩到——**把 5 写成 2** 的实现翻车。
10. 对抗性【不打第一个受阻点/多目标】：前方 2 格盟友挡弹、玩家在 4 格——被抽的是盟友、玩家不掉血——**跳过挡弹者直取玩家**或**多目标齐打**的实现翻车。

**对照与分发（4 个）**

11. 对照组：三旗标皆无的 rat 在矛的标志性站位下只打贴脸一个目标（身后线上、斜角探针均无损）——**几何"传染"到普通怪**的实现翻车。
12. 对照组：rat 在 2 格直线外只走近不攻击——**把几何检查挂到所有怪物身上**的实现翻车。
13. 旗标分发：注入 `MA_ATTACKS_EXTEND` 的 rat 4 格外甩鞭、注入 `MA_ATTACKS_ALL_ADJACENT` 的 rat 贴脸扫斜角——**按种类白名单而非 abilityFlags 分发**的实现翻车。（mutations.json 现无携带这三个旗标的变异，按 P4-5 变异测试的意图改为直接注入 abilityFlags，验证同一条 hasAbility 分发路径。）
14. 留痕（本轮明确不做·玩家侧）：断言 `weapons.json` 里 whip/spear/axe/war_pike 的 flags 仍全空——P4-7 实现玩家侧武器几何时此断言应反转。

## 5. 反向验证（真实改坏、真实失败输出、已还原）

### 5.1 反向验证①：把矛和斧做反（照 Rogue.h 反了的注释实现——本轮头号风险）

改动（`Monster.ts` `tryGeometryMeleeAdjacent`）：门控对调——`MA_ATTACKS_ALL_ADJACENT` → `performSpearAttack`、`MA_ATTACKS_PENETRATE` → `performSweepAttack`。

真实失败输出（14 个测试中 5 个失败，含两条头号风险测试）：

```
 ❯ src/test/p4_6_attack_geometry.test.ts (14 tests | 5 failed) 175ms
     × 对抗性【头号风险·矛≠斧】：照 Rogue.h:2120 反了的注释实现成横扫会翻车 —— ...
     × 对抗性【攻击顺序写成正序】：CE Movement.c:1005-1009 人为倒序攻击 ...
     × 对抗性【头号风险·斧≠矛】：照 Rogue.h:2121 反了的注释实现成直线穿透会翻车 —— ...
     × 横扫要扫满 8 个邻格里的多个敌人 ...
     × 旗标分发走 abilityFlags 而非种类白名单：...

 FAIL  ... > 对抗性【头号风险·矛≠斧】 ...
AssertionError: expected 6 to be 1 // Object.is equality
- Expected
+ Received
- 1
+ 6
 ❯ src/test/p4_6_attack_geometry.test.ts:100:27
     99|         expect(game.player.hp).toBe(pBefore - 5);

 FAIL  ... > 对抗性【头号风险·斧≠矛】 ...
AssertionError: expected 6 to be less than 6
 ❯ src/test/p4_6_attack_geometry.test.ts:183:29
    182|         expect(game.player.hp).toBeLessThan(500);
    183|         expect(diagonal.hp).toBeLessThan(dBefore);  // 关键断言①：斜角被扫到

 FAIL  ... > 横扫要扫满 8 个邻格里的多个敌人 ...
AssertionError: 盟友#0 必须被扫到: expected 6 to be less than 6
 ❯ src/test/p4_6_attack_geometry.test.ts:206:64

 Test Files  1 failed (1)
      Tests  5 failed | 9 passed (14)
```

 斧≠矛的断言 `expected 6 to be less than 6`（斜角探针没掉血）与矛≠斧的 `expected 6 to be 1`（斧化实现扫到的斜角探针掉血量 6≠矛的 5，说明扫的是斧伤害）双向印证：做反必翻车。已确认还原（门控换回），重跑 14/14 通过。

### 5.2 反向验证②：矛的攻击顺序写成正序

改动（`Monster.ts` `performSpearAttack`）：`for (let i = hitList.length - 1; i >= 0; i--)` 改为 `for (let i = 0; i < hitList.length; i++)`。

真实失败输出（恰好只有顺序测试失败——其余 13 个对顺序不敏感，符合预期）：

```
     × 对抗性【攻击顺序写成正序】：CE Movement.c:1005-1009 人为倒序攻击（"so that spears of force can send both monsters flying"，先远后近）—— ... 11ms

⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯

 FAIL  src/test/p4_6_attack_geometry.test.ts > P4-6 矛（MA_ATTACKS_PENETRATE） > 对抗性【攻击顺序写成正序】 ...
AssertionError: expected 0 to be greater than 1
 ❯ src/test/p4_6_attack_geometry.test.ts:143:24
    141|         const youIdx = msgs.findIndex(m => m.text.includes('hits you')…
    142|         expect(farIdx).toBeGreaterThanOrEqual(0);
    143|         expect(youIdx).toBeGreaterThan(farIdx);      // 关键断言：远端消息在前

Test Files  1 failed (1)
      Tests  1 failed | 13 passed (14)
```

`expected 0 to be greater than 1`：正序实现下 "hits you" 落在日志第 0 条、远端目标落在第 1 条——顺序反了，测试精确捕获。已确认还原（改回倒序），重跑 14/14 通过。

## 6. 实现过程中发现并修复的一个真实回归（既有测试不修改）

全量回归时 `scroll_effects.test.ts` 的 2 个 discordant 测试翻车：测试里的 discordant 攻击者是 **goblin（矛怪）**，我的几何钩子让它的攻击从旧出口消息（"turns on the X"）变成了几何消息（"hits the X"），而该测试断言绑定旧消息词汇。行为本身是 CE 正确的（CE 的 discordant 攻击同样走 moveMonster 的矛路径），且**既有测试一律不得修改**，故修正方式为：`resolveGeometryAttackOn` 增加 voice 参数，几何攻击发生在哪个出口就沿用哪个出口的既有消息键（discordant 出口的几何命中也走 `combat.discordant_hits` = "turns on ..."）。修正后 39 个文件全绿。这不是为凑测试改行为——行为未变，改的是消息词汇归属，且与"每个出口有自己的消息词汇"的既有结构一致。

## 7. 本轮明确不做 / 已知简化（不静默跳过）

1. **玩家侧武器几何**：`weapons.json` 的 Whip/Spear/Axe/War Pike flags 全空（CE 给的是 `ITEM_ATTACKS_EXTEND/PENETRATE/ALL_ADJACENT`），玩家攻击路径未动——留 P4-7。测试 14 留痕。
2. **CE `abortAttack`**（玩家误伤盟友/酸怪的确认 UI）：非本轮范围。
3. **`diagonalBlocked` 未移植**：矛/鞭的起步对角墙角检查、横扫无此判定——web 全局没有对角穿墙机制（P4-5 起同口径，非本轮新增缺口）。
4. **鞭的 zap/BOLT_WHIP 表现层未移植**（§3.3 的授权简化）；已核实的结算语义差异：bolt 路径无 backstab 判定，web 简化实现保留了完整近战语义。
5. **横扫命中顺序**：单表旋转近似，不复刻 CE 的 nbDirs/cDirs 混用（覆盖集合一致，仅顺序不同，§3.2）。
6. **面向墙的移动尝试不触发几何**：web 的 `tryMoveTo` 只会被合法目标格调用，而 CE 朝墙的 moveMonster 也会先过矛/鞭检查——影响面是"向墙里的 turret 竖矛"这类边缘场景。
7. **monsterWillAttackTarget 简化口径**：敌对 + 存活 + 非囚禁；无 entranced/ally 细分（web 无该状态谱系）。
8. **CE 玩家攻击者的 canSee/abortAttack 分支**：怪物侧无此语义，本轮只实现怪物侧，未涉及。
9. **RNG 流移动说明（项目常识 §四 的强制披露）**：几何攻击把部分原本"移动"的回合变成"攻击"，这些回合消耗的随机数次数改变——**同 seed 的玩法过程与旧版本不再逐位一致**；地图生成不受影响（startNewGame 不跑怪物回合），地形指纹基线无需刷新、本轮未刷新。

## 8. 门禁验证

### `npm test -- --no-file-parallelism`（cwd = `brogue-web/`）

```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  39 passed (39)
      Tests  406 passed | 7 skipped | 5 todo (418)
   Start at  00:38:11
   Duration  33.53s (transform 337ms, setup 0ms, import 1.41s, environment 6ms)
```

392（门槛）→ 406（本轮新增 14 个测试，只增不减）。按项目记忆用 `--no-file-parallelism` 规避云同步目录的负载抖动。

### `npm run build`（cwd = `brogue-web/`）

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

vite v7.3.1 building client environment for production...
transforming...
✓ 785 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/WebGLRenderer-BN22_dWx.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-cgbVP-Dt.js               916.21 kB │ gzip: 289.16 kB

(!) Some chunks are larger than 500 kB after minification. ...
✓ built in 1.40s
```

绿（chunk 体积警告为既有历史遗留，P4-5 报告已登记，与本轮无关）。

## 9. `git diff --stat`

```
 brogue-web/src/entities/Monster.ts | 361 +++++++++++++++++++++++++++++++++++++
 1 file changed, 361 insertions(+)
```

（未纳入统计的新增文件：`brogue-web/src/test/p4_6_attack_geometry.test.ts`，374 行 / 14 个测试）

## 10. 验收条款逐条对照

| 条款 | 状态 |
|---|---|
| 独立确认"矛=PENETRATE、斧=ALL_ADJACENT、鞭=EXTEND"（含所读行号） | 完成，§2（Rogue.h 注释前两条确认写反，以代码为准） |
| goblin / goblin warlord 矛、naga / dragon 斧、salamander 鞭（怪物侧） | 完成（web 数据旗标与 CE 一致，行为按旗标分发，测试覆盖 goblin/naga/salamander 及旗标注入路径） |
| 矛：射程 2、倒序攻击、穿墙 break、MONST_ATTACKABLE_THRU_WALLS 豁免 | 完成，§3.1 |
| 斧：8 邻格全覆盖、只打 willAttackTarget、墙内目标豁免、不误伤同阵营 | 完成，§3.2 |
| 鞭：射程 5、第一个受阻点、单目标、不走 bolt 系统的简化说明 | 完成，§3.3 |
| 对抗性测试 ≥5 条，覆盖五种指定错误实现 | 完成，14 个中 9 个标注对抗性；五种指定错误实现全部有专门测试（§4 的 1/5、3、4、7、8+9） |
| 对照组：普通怪同站位只打一个目标、只打相邻格 | 完成（测试 11、12） |
| 横扫验证"8 邻格多个敌人都挨打" | 完成（测试 6：5 个敌人全部掉血） |
| 反向验证 ≥2 条真实失败输出 | 完成，2 条（矛斧对调 → 5 failed；顺序正序 → 1 failed），§5 |
| 明确不做项留痕（不静默跳过） | 完成（测试 14 断言 weapons.json 现状；§7 全清单） |
| 文件边界 | 未触碰任何禁止文件；`generation_baseline.json` 未刷新且未变红（39 文件全绿） |
| `npm test` ≥392、`npm run build` 绿 | 完成（406 / 绿） |
| 任务书事实与 CE 不符之处单列 | §0：任务书事实全部核实相符；另单列三处任务书未展开的 CE 细节与一处新的注释失实处（Rogue.h:2122 "cardinal" 与 8 向代码不符） |
