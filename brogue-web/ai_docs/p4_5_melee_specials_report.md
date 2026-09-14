# P4-5 报告：抓取（MA_SEIZES）/ 吸血（MA_TRANSFERENCE）/ 击退（MA_ATTACKS_STAGGER）

## 0. 与任务书事实陈述的分歧

逐条核实了任务书给出的 CE 行号/代码片段，结论：**任务书的事实陈述与 CE 源码一致，没有发现错误**。核对过的点：

- `MA_SEIZES` 检查确认在 `Combat.c:1212-1237`，位于 `attack()` 内、`attackHit()` 命中掷骰（`Combat.c:1240`）**之前**，条件、`return false`、双标记置位均与任务书描述一致。
- `MB_SEIZED`/`MB_SEIZING` 全部引用点已 grep 核对（`Combat.c`/`Movement.c`/`Time.c`/`Items.c`/`Monsters.c`/`Globals.c`），确认解除途径是"搜索循环找不到存活且相邻的 seizing 怪物即 failsafe 清除"（`Movement.c:1296`），CE **没有**另开一条"怪物死亡时主动清 MB_SEIZED"的分支——是隐式依赖 `killCreature`/怪物列表移除后搜索失败来解除，任务书虽未明说这个机制细节，但没有误导性描述。
- `Movement.c:1267-1297` 的两段式行为（committed=false 取消按键不耗回合 / committed=true 或看不见抓取者耗回合但不移动）核实属实。web 侧因为 `handlePlayerAction` 每次调用即对应一次已提交的单步输入、没有"排队按键可取消"的上层缓冲，本轮**统一按 committed 分支实现**（耗回合、原地不动）——这是本轮的已知简化，不是对任务书的反驳，已在代码注释与下方"未实现/简化事项"里登记。
- `MA_TRANSFERENCE` 确认在 `Combat.c:1849-1871`（`inflictDamage()` 内），`transferenceAmount = min(damage, defender->currentHP)`、盟友 40%/敌人 90%、`attacker->currentHP += transferenceAmount` 均与任务书描述一致。
- `MA_ATTACKS_STAGGER` 的 `processStaggerHit` 确认在 `Combat.c:1118-1136`，逻辑（含 `MONST_INVULNERABLE|MONST_IMMOBILE|MONST_INANIMATE`、`MB_CAPTIVE`、`T_OBSTRUCTS_PASSABILITY` 排除，clamp(-1,1) 方向推挤）与任务书给出的代码片段逐字符核对一致。调用点确认在 `specialHit()`（`Combat.c:534`），任务书给出的行号准确。

一个任务书**没有明说、但核实后对实现有直接影响**的细节，单独列出：`specialHit()`（含 `processStaggerHit` 调用）只在 `attack()` 的 **"defender 存活"分支**（`Combat.c:1385` 起的 `} else { // if the defender survived`）里被调用；`inflictDamage()` 判定"击杀"的分支（`Combat.c:1301-1384`）**不会**走到 `specialHit()`。也就是说 **MA_ATTACKS_STAGGER 在把目标打死的那一下不会触发**（不是"先推再死"也不是"死后再推"，是压根不触发）。本轮已经落实（见 §2.3 与验收测试"目标被打死的那一下不触发击退"），任务书虽未提及这一层，但按"以 CE 为准"的授权反驳条款照实现。

另一个任务书**完全没有提到、但对 MA_SEIZES 的实际战斗结果有决定性影响**的细节：CE `hitProbability()`（`Combat.c:114-141`，任务书没有引用这个函数）里，在算命中率公式之前，有一条专门的早退：

```c
if ((defender->bookkeepingFlags & MB_SEIZED) &&
    (attacker->bookkeepingFlags & MB_SEIZING)) {
    return 100;
}
```

也就是说：**被抓住的目标，面对正抓着自己的那个攻击者，后续每一下攻击都 100% 必中**，不再经过 `accuracy`/`defense` 的命中率公式。这是 MA_SEIZES 真正的威胁所在（抓住之后稳定连续命中），任务书给出的 `attack()` 片段（`Combat.c:1212-1237`）只覆盖了"抓取那一下"，没有提到"抓住之后必中"这条规则在另一个函数里。已在 `Combat.ts` 的命中率计算前补上这一条件分支，并用两条对抗性测试（⑥抓取本身不经过命中掷骰、⑦抓住后必中）覆盖，§5.3 有反向验证的真实失败输出。

## 1. 改动清单

| 文件 | 改动 |
|---|---|
| `src/entities/Creature.ts` | 新增 `public seized: boolean` / `public seizing: boolean`（对应 CE `MB_SEIZED`/`MB_SEIZING`） |
| `src/engine/Combat/Combat.ts` | `AttackResult` 新增 `seized?: boolean`；`attack()` 在 `MA_KAMIKAZE` 检查之后、命中率计算之前插入 `MA_SEIZES` 分支（对照 `Combat.c:1212-1237`）；命中率计算里插入"被抓住者面对抓取者必中"分支（对照 `hitProbability()`，`Combat.c:114-141`，见上一节）；在应用伤害前插入 `MA_TRANSFERENCE` 分支（对照 `Combat.c:1849-1871`） |
| `src/engine/Core/Game.ts` | 新增 `private findLiveSeizer()`（对照 `Movement.c:1267-1297` 的搜索循环）；新增 `public processStaggerHit()`（对照 `Combat.c:1118-1136`，public 是因为只被 Monster.ts 跨模块调用，见 §3 说明）；`handlePlayerAction` 的 `'move'` 分支新增：进入攻击/移动判定前的 `player.seized` failsafe 清除、`blockingMonster` 分支之后新增 `player.seized` 阻塞分支（对照 `Movement.c` 的 `MB_SEIZED` 检查） |
| `src/entities/Monster.ts` | ally-vs-monster、discordant-vs-monster、HUNTING（怪物打玩家）三处近战出口：各自新增 `result.seized` 消息分支与 `MA_ATTACKS_STAGGER` 触发调用（`result.hit && !kamikaze && !seized && 目标存活 && hasAbility('MA_ATTACKS_STAGGER')`） |
| `src/test/p4_5_melee_specials.test.ts`（新增） | 24 个测试，见 §4 |

## 2. CE 行号对照与关键设计决策

### 2.1 MA_SEIZES（`Combat.c:1212-1237`）

```
if ((attacker->info.abilityFlags & MA_SEIZES)
    && (!(attacker->bookkeepingFlags & MB_SEIZING) || !(defender->bookkeepingFlags & MB_SEIZED))
    && (distanceBetween(...) == 1 && !diagonalBlocked(...))) {
    attacker->bookkeepingFlags |= MB_SEIZING;
    defender->bookkeepingFlags |= MB_SEIZED;
    ...
    return false;   // 零伤害，不参与命中掷骰
}
```

web 侧 `CombatSystem.attack()` 里对应实现在 `MA_KAMIKAZE` 早退之后：

```ts
if (attacker instanceof Monster && attacker.hasAbility('MA_SEIZES') &&
    (!attacker.seizing || !defender.seized)) {
    attacker.seizing = true;
    defender.seized = true;
    return { damage: 0, weaponName, hit: false, backstab: false, seized: true };
}
```

距离判定省略了显式检查：web 的三个近战调用点（`Game.ts` 玩家移动攻击、`Monster.ts` 三处怪物近战出口）都只在 `distToPlayer<=1`/相邻格才调用 `CombatSystem.attack`，等价于 CE 的 `distanceBetween==1` 前置条件天然成立，未额外检查 `diagonalBlocked`（web 没有这个函数的移植，且本项目现有近战调用点均未做对角墙角判定，同口径未新增）。

### 2.2 玩家挣脱 / 移动阻塞（`Movement.c:1267-1297`）与 `MB_SEIZED`/`MB_SEIZING` 解除途径

CE 的解除机制**不是**"怪物死亡时主动清标记"，而是：玩家每次尝试移动到空地时，在 `monsters` 链表里搜索"仍然 `MB_SEIZING`、与玩家为敌、相邻、能看见"的怪物；找不到就 `player.bookkeepingFlags &= ~MB_SEIZED; // failsafe`，然后照常移动。怪物死亡后从 `monsters` 链表移除，下次搜索自然找不到——这就是"杀死抓取者解除抓取"的全部机制，没有额外代码。

web 对应实现：

```ts
private findLiveSeizer(): Monster | undefined {
    return this.monsters.find(m =>
        m.hp > 0 && m.seizing &&
        monstersAreEnemies(m, this.player) &&
        Math.max(Math.abs(m.loc.x - this.player.loc.x), Math.abs(m.loc.y - this.player.loc.y)) === 1
    );
}
```

`this.monsters` 在 `playerTurnEnded()` 顶部已经 `filter(m => m.hp > 0)` 过滤死怪（P4-4 就有的既有逻辑），所以杀死抓取者后，其下一次 `playerTurnEnded` 就会把它从列表移除，`findLiveSeizer` 自然找不到——与 CE 同一套"隐式解除"机制，没有另开死亡回调。

`handlePlayerAction('move', …)` 里的改动：

```ts
if (this.player.seized && !this.findLiveSeizer()) {
    this.player.seized = false;   // Movement.c:1296 failsafe
}
if (blockingMonster) {
    // 攻击分支——不受 seized 影响，撞向抓着自己的怪物仍是正常攻击
} else if (this.player.seized) {
    // 阻塞：耗回合、不移动
} else if (locked door) { ... } else if (altar) { ... } else if (canMoveTo) { ... }
```

**已知简化**（写入下方"未实现/简化"清单）：CE 区分 `committed=false`（首次按键，取消不耗回合）与 `committed=true`（已提交/看不见抓取者，耗回合不移动）。web 的 `handlePlayerAction` 每次调用对应一次已提交的单步输入，没有"排队按键、可取消"的上层缓冲，因此统一按 committed 分支处理。

### 2.3 MA_TRANSFERENCE（`Combat.c:1849-1871`）

```c
transferenceAmount = min(damage, defender->currentHP);
if (attacker == &player) { ... rogue.transference，不在本轮范围 ... }
else if (attacker->creatureState == MONSTER_ALLY) transferenceAmount = amount * 4 / 10;
else                                              transferenceAmount = amount * 9 / 10;
attacker->currentHP += transferenceAmount;
if (attacker == &player && player.currentHP <= 0) { gameOver(...); return false; }
```

web 实现（`Combat.ts`，damage>0 分支内、`applyTo.takeDamage(damage)` 之前）：

```ts
if (attacker instanceof Monster && attacker.hasAbility('MA_TRANSFERENCE') &&
    !(applyTo instanceof Monster && (applyTo.hasBehavior('MONST_INANIMATE') || applyTo.isInvulnerable()))) {
    const cappedAmount = Math.min(damage, applyTo.hp);
    const transferAmount = attacker.isAlly
        ? Math.trunc(cappedAmount * 4 / 10)
        : Math.trunc(cappedAmount * 9 / 10);
    attacker.hp += transferAmount;
}
applyTo.takeDamage(damage);
```

**独立复核结论（吸血无 maxHP 上限）**：亲自读了 `Combat.c:1849-1877`（`inflictDamage()` 全函数），`attacker->currentHP += transferenceAmount;` 这一行下面紧接着只有 `if (attacker == &player && player.currentHP <= 0) { gameOver(...); }`（玩家血量归零判断），再往下直接进入 `defender->currentHP <= damage` 的击杀判定分支，**全函数没有任何把 `attacker->currentHP` clamp 回 `attacker->info.maxHP` 的代码**。结论：**CE 的吸血确实没有 maxHP 上限**，本轮照实现，`attacker.hp += transferAmount` 不做 clamp。已用测试"对抗性②：吸血没有 maxHP 上限"验证（满血攻击者吸血后 hp > maxHp）。

`attacker.creatureState == MONSTER_ALLY` 换成了 web 的 `attacker.isAlly` 布尔字段（web 没有 CE 完整的 `creatureState` 谱系，`isAlly` 是本项目既有的等价简化，P4-2/P4-4 已沿用同一口径）。

整数除法用 `Math.trunc`（不是 `Math.floor`）：`transferenceAmount` 恒为非负数（`min(damage, currentHP)` 两者都 ≥0），`trunc` 与 `floor` 在非负区间等价，选 `trunc` 是为了更贴近 C 的 `short` 整数除法语义（向零截断），避免未来如果引入负值场景（本轮不涉及）出现符号错误。

`rogue.transference`（玩家嗜血戒指）明确不在本轮范围，代码里只判定 `attacker instanceof Monster`，玩家永远不触发这条分支——不会误吞任务书排除的范围。

### 2.4 MA_ATTACKS_STAGGER（`Combat.c:1118-1136`，调用点 `Combat.c:534`）

```c
void processStaggerHit(creature *attacker, creature *defender) {
  if ((defender->info.flags & (MONST_INVULNERABLE|MONST_IMMOBILE|MONST_INANIMATE))
      || (defender->bookkeepingFlags & MB_CAPTIVE)
      || cellHasTerrainFlag(defender->loc, T_OBSTRUCTS_PASSABILITY)) return;
  newX = clamp(defender->loc.x - attacker->loc.x, -1, 1) + defender->loc.x;
  newY = clamp(defender->loc.y - attacker->loc.y, -1, 1) + defender->loc.y;
  if (coordinatesAreInMap(newX,newY) && !cellHasTerrainFlag(...) && !(pmap[...].flags & (HAS_MONSTER|HAS_PLAYER)))
    setMonsterLocation(defender, (pos){newX,newY});
}
```

web 实现（`Game.ts`）：

```ts
public processStaggerHit(attacker: Creature, defender: Creature): void {
    if (defender instanceof Monster &&
        (defender.isInvulnerable() || defender.hasBehavior('MONST_IMMOBILE') ||
            defender.hasBehavior('MONST_INANIMATE') || defender.isCaged)) {
        return;
    }
    const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
    const newX = clamp1(defender.loc.x - attacker.loc.x) + defender.loc.x;
    const newY = clamp1(defender.loc.y - attacker.loc.y) + defender.loc.y;
    if (!this.canMoveTo(newX, newY)) return;
    if (this.getMonsterAt(newX, newY)) return;
    if (this.player.loc.x === newX && this.player.loc.y === newY) return;
    defender.loc.x = newX;
    defender.loc.y = newY;
}
```

`MB_CAPTIVE` 用 web 既有的 `Monster.isCaged`（被关押、待钥匙解救的怪物，Game.ts 里锁门解锁逻辑用它判定"是否可以被放出成为盟友"）近似——语义上与 CE 的"被囚禁的 NPC"等价，本项目没有第二套囚禁标记。`T_OBSTRUCTS_PASSABILITY` 用既有的 `canMoveTo()`（墙/花岗岩/密门/锁门/深水判 false）近似，与既有移动/寻路代码同口径，未做 `diagonalBlocked` 式的对角墙角判定（web 全局都没有这个机制）。

**独立复核结论（stagger 无 damage>0 条件）**：读了 `Combat.c:519-537`（`specialHit()` 里紧邻的三条 `SPECIAL_HIT` 分支）：

```c
if ((attacker->info.abilityFlags & MA_POISONS) && damage > 0 && !(...)) { addPoison(...); }
if ((attacker->info.abilityFlags & MA_CAUSES_WEAKNESS) && damage > 0 && !(...)) { weaken(...); }
if (attacker->info.abilityFlags & MA_ATTACKS_STAGGER) { processStaggerHit(attacker, defender); }
```

`MA_POISONS`/`MA_CAUSES_WEAKNESS` 都带 `&& damage > 0`，紧挨着的 `MA_ATTACKS_STAGGER` **单独一行、没有这个条件**。结论：**CE 的击退确实不检查 damage>0**，本轮照实现——调用点用 `result.hit`（命中）而非 `result.damage > 0` 做门槛。已用"对抗性①"测试验证：`MONST_IMMUNE_TO_WEAPONS` 目标（伤害强制归零但 `hit` 仍为 `true`）依然被推开。

同时确认：`specialHit()` 只在 `attack()` 的"defender 存活"分支被调用（`Combat.c:1385` 起），"defender 被打死"分支（`Combat.c:1301-1384`）走不到 `specialHit()`——因此调用点额外加了 `目标.hp > 0` 门槛（这条门槛不是"照抄 MA_POISONS 抄错"，是必要的、对应 CE 分支结构本身）。

## 3. `processStaggerHit` 可见性说明

`processStaggerHit` 只被 `Monster.ts`（另一个模块，通过 `(game as any).processStaggerHit(...)` 调用，与本项目既有的 `trySplitMonster`/`applyStatusToMonster` 跨模块调用惯例一致）使用，`Game.ts` 内部没有自身调用点。保持 `private` 会被 `vue-tsc` 的 `noUnusedLocals` 判定为"声明但未使用"（`TS6133`，跨模块的 `as any` 调用对类型检查器不可见），因此把可见性改成 `public`，调用方仍按项目约定用 `(game as any)` 转接。`findLiveSeizer` 在 `Game.ts` 内部有两处调用（failsafe 清除 + 阻塞分支判断），保持 `private` 没有编译问题。

## 4. 测试清单（`src/test/p4_5_melee_specials.test.ts`，24 个）

**验收 1：MA_SEIZES（11 个）**
1. 对抗性①：抓取必须 0 伤害、`hit=false` —— 捕获"漏掉 `return false`，继续走正常攻击流程"
2. kraken 同样第一下抓取（覆盖第二只原生怪物）
3. 变异途径：goblin + grappling 变异同样触发抓取
4. 两个标记都置位后第二次 `attack()` 走正常流程（伤害真实生效，`accuracy=125` 保证命中不受随机干扰）
5. 对抗性⑥：抓取本身不参与命中掷骰 —— `accuracy=0` 的抓取者正常公式下恒 miss，第一次贴身仍必须抓住
6. 对抗性⑦：被抓住的目标面对抓着自己的攻击者必中（`Combat.c:114-141` `hitProbability()` 的 `MB_SEIZED && MB_SEIZING → 100`）—— `accuracy=0` 的抓取者抓住后第二击必须命中
7. 对照组：goblin（无 `MA_SEIZES`）不触发抓取
8. 对抗性②：被抓住后移动到空地必须被阻挡，且挣扎本身消耗回合（tick 断言）—— 捕获"完全不检查 `player.seized`"与"挣扎不耗回合"两类错误实现
9. 撞向抓着自己的怪物仍是正常攻击（`Movement.c` 的攻击分支先于 `MB_SEIZED` 检查）—— 捕获"把 seized 检查放在攻击判断之前"
10. failsafe 解除要检查相邻：抓取者存活但已不相邻时移动不再被阻拦 —— 捕获"只检查存活、不检查相邻"
11. **必做**：抓取者死亡后被抓者能正常移动（杀死 bog_monster 后玩家立刻能走开，含"先确认真的被挡住一次"的前置断言）

**验收 2：MA_TRANSFERENCE（7 个）**
12. 敌方 90%：vampire bat 攻击玩家，回血量 = `floor(min(damage,防御方HP)*9/10)`
13. 盟友 40%：`isAlly=true` 的 vampire bat 攻击敌方怪物，回血比例 4/10
14. 变异途径：goblin + vampiric 变异，敌方 90% 生效
15. 对抗性①：吸血量不能超过目标剩余血量 —— 捕获"漏掉 `min(damage, currentHP)`"（目标只剩 1 HP，正确实现应 0 回血，未 clamp 的实现必然 >0）
16. 对抗性②：吸血没有 maxHP 上限 —— 捕获"错误 clamp 到 maxHp 的实现"
17. 对照组：ogre（无 `MA_TRANSFERENCE`）命中后自身 HP 不变
18. `MONST_INANIMATE` 目标不触发吸血

**验收 3：MA_ATTACKS_STAGGER（6 个）**
19. ogre 命中玩家后沿方向推开一格
20. 变异途径：goblin + juggernaut 变异同样能推
21. 对抗性①：击退没有 `damage>0` 门槛 —— 用 `MONST_IMMUNE_TO_WEAPONS`（0 伤害但 `hit=true`）+ 真实的 ally-vs-monster 集成路径（`Monster.takeTurn`，不是直接调用私有方法）验证调用点本身没有加这个条件
22. 对抗性②：终点是墙/已被占用时不推挤（分两段分别验证墙与怪物占用）
23. 对抗性③：目标被打死的那一下不触发击退 —— 用真实集成路径验证，捕获"调用点忘记检查 `target.hp>0`"
24. 对照组：goblin（无 `MA_ATTACKS_STAGGER`）不推玩家

## 5. 反向验证（真实改坏、真实失败输出、已还原）

### 5.1 破坏 MA_SEIZES 的 `return false`

改动（`Combat.ts`）：把 `return { damage: 0, ... }` 注释掉，只保留标记置位，让代码继续往下走正常攻击流程。

真实失败输出（本次反向验证在 §5.3 的新测试加入之前跑出，当时文件共 20 个测试；不影响结论有效性，条目本身在后续版本里保持不变）：
```
❯ src/test/p4_5_melee_specials.test.ts (20 tests | 3 failed) 251ms
     × 对抗性①：抓取那一下必须是 0 伤害、hit=false ...
     × kraken（另一只原生 MA_SEIZES 怪物）同样在第一下抓住而不是造成伤害
     × 变异途径：goblin 携带 grappling 变异（注入 MA_SEIZES）同样触发抓取 ...

FAIL  ... 对抗性①：抓取那一下必须是 0 伤害、hit=false ...
AssertionError: expected undefined to be true // Object.is equality
- Expected: true
+ Received: undefined
 ❯ src/test/p4_5_melee_specials.test.ts:89:28
     89|         expect(res.seized).toBe(true);

FAIL  ... kraken（另一只原生 MA_SEIZES 怪物）...
AssertionError: expected undefined to be true
 ❯ src/test/p4_5_melee_specials.test.ts:108:28

FAIL  ... 变异途径：goblin 携带 grappling 变异 ...
AssertionError: expected undefined to be true
 ❯ src/test/p4_5_melee_specials.test.ts:125:28

Test Files  1 failed (1)
     Tests  3 failed | 17 passed (20)
```
已确认还原（`git diff` 校验，`res.seized` 分支恢复），全量 388 测试重新跑通过。

### 5.2 破坏 MA_ATTACKS_STAGGER 的 damage>0 门槛

改动（`Monster.ts` ally-vs-monster 调用点）：在触发条件里加上 `result.damage > 0`（照抄相邻 `MA_POISONS`/`MA_CAUSES_WEAKNESS` 的写法）。

真实失败输出（同样跑在 20 个测试的版本上，后续新增测试不影响此结论）：
```
❯ src/test/p4_5_melee_specials.test.ts (20 tests | 1 failed) 221ms
     × 对抗性①：击退不能有 damage>0 的门槛 ...

FAIL  ... 对抗性①：击退不能有 damage>0 的门槛 ...
AssertionError: expected 5 to be 4 // Object.is equality
- Expected: 4
+ Received: 5
 ❯ src/test/p4_5_melee_specials.test.ts:416:30
    414|         ogre.takeTurn(game, 10);
    415|
    416|         expect(target.loc.x).toBe(4); // 依然被推开——证明调用点没有 damage>0 门槛

Test Files  1 failed (1)
     Tests  1 failed | 19 passed (20)
```
已确认还原（条件改回不含 `damage > 0`），全量测试重新跑通过，`npm run build` 重新验证为绿。

### 5.3 破坏"被抓住者面对抓取者必中"规则

改动（`Combat.ts`）：把 `else if (defender.seized && attacker.seizing)` 分支临时改成 `else if (false && ...)`，让必中规则失效、退回正常命中率公式。

真实失败输出：
```
❯ src/test/p4_5_melee_specials.test.ts (24 tests | 1 failed) 266ms
     × 对抗性⑦：被抓者面对抓着自己的攻击者必中（CE Combat.c:125-130：defender SEIZED && attacker SEIZING → hitProbability 直接返回 100）... 13ms

FAIL  ... 对抗性⑦：被抓者面对抓着自己的攻击者必中 ...
AssertionError: expected false to be true // Object.is equality
- Expected: true
+ Received: false
 ❯ src/test/p4_5_melee_specials.test.ts:187:26
    185|         const hpBefore = player.hp;
    186|         const res2 = CombatSystem.attack(bog, player); // 第二下：必中
    187|         expect(res2.hit).toBe(true); // 关键断言：0% 公式下依然命中（必中规则生效）

Test Files  1 failed (1)
     Tests  1 failed | 23 passed (24)
```
已确认还原（分支条件改回 `defender.seized && attacker.seizing`），全量测试重新跑通过，`npm run build` 重新验证为绿。

## 6. 本轮明确不做（按要求留痕，不静默跳过）

- **玩家嗽血戒指 `rogue.transference`**：`Combat.ts` 的 `MA_TRANSFERENCE` 分支用 `attacker instanceof Monster` 显式排除玩家攻击者，玩家永远不会触发这条吸血逻辑——`Combat.c:1849-1850` 里 `attacker == &player` 的戒指分支完全没有移植，物品系统改动不在本轮文件边界内。
- **MA_ATTACKS_PENETRATE / MA_ATTACKS_ALL_ADJACENT / MA_ATTACKS_EXTEND**（矛/斧/鞭几何攻击）：全仓未新增任何相关代码，goblin 数据里现有的 `MA_ATTACKS_PENETRATE` 标签继续保持"只有标签没有行为"的状态，留给 P4-6。

## 7. 已知简化 / 缺口清单

1. **玩家挣脱的两段式行为**：CE 区分"首次按键取消不耗回合"与"已提交/看不见抓取者耗回合不移动"；web 统一按后者处理（见 §2.2）。
2. **`diagonalBlocked`**：MA_SEIZES 的相邻判定、`processStaggerHit` 的推挤终点判定都没有移植 CE 的对角墙角检测，与本项目现有近战/移动代码同口径（均未做这项检测），非本轮新增缺口。
3. **怪物自身被抓住后的行动限制**：CE 的 `Monsters.c:2151/3144/3789` 等处会让怪物自己的 AI 决策感知自身 `MB_SEIZED`；本轮只实现了"玩家被抓住时的移动阻塞"（`Movement.c` 路径），没有给 `Monster.takeTurn` 加对称的"自己被抓住就不能动"的 AI 分支——这只会在"盟友/discordant 怪物互相 MA_SEIZES"这种边缘场景下出现行为缺口（bog_monster/kraken 只攻击玩家，goblin+grappling 变异理论上可以被友军/敌对怪物抓住，但当前怪物 AI 的移动逻辑不会检查 `this.seized`）。已在报告登记，不在本轮范围内修复。
4. **MB_CAPTIVE**：用 `Monster.isCaged` 近似，见 §2.4。

## 8. 门禁验证

### `npm test`（cwd = `brogue-web/`）
```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  38 passed (38)
      Tests  392 passed | 7 skipped | 5 todo (404)
   Start at  22:34:19
   Duration  14.00s (transform 1.78s, setup 0ms, import 4.51s, tests 47.01s, environment 10ms)
```
368（门槛）→ 392（本轮新增 24 个测试，只增不减）。

### `npm run build`（cwd = `brogue-web/`）
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
dist/assets/index-BdAyeN1p.js               910.18 kB │ gzip: 288.13 kB

(!) Some chunks are larger than 500 kB after minification. ...
✓ built in 1.38s
```
绿（chunk 体积警告是既有历史遗留问题，与本轮改动无关，本轮未新增任何外部依赖）。

## 9. `git diff --stat`

```
 brogue-web/src/engine/Combat/Combat.ts | 44 ++++++++++++++++++
 brogue-web/src/engine/Core/Game.ts     | 83 +++++++++++++++++++++++++++++++++-
 brogue-web/src/entities/Creature.ts    | 10 ++++
 brogue-web/src/entities/Monster.ts     | 38 ++++++++++++++++
 4 files changed, 174 insertions(+), 1 deletion(-)
```
（未纳入统计的新增文件：`brogue-web/src/test/p4_5_melee_specials.test.ts`，566 行 / 24 个测试）

## 10. 验收条款逐条对照

| 条款 | 状态 |
|---|---|
| MA_SEIZES：抓取零伤害、双标记置位、第二下正常攻击 | 完成 |
| MA_SEIZES：玩家移动阻塞 + 杀死抓取者后能正常移动 | 完成（必做测试见 §4.7） |
| MA_TRANSFERENCE：`min(damage,currentHP)`、盟友40%/敌人90%、无maxHP上限 | 完成，两条复核结论均已独立核实（§2.3） |
| MA_ATTACKS_STAGGER：方向推挤、越界/占用不发生、无damage>0门槛 | 完成，复核结论已独立核实（§2.4） |
| 怪物途径 + 变异途径均生效 | 完成（每个能力都有一条变异测试：grappling/vampiric/juggernaut） |
| 对抗性测试 ≥4 条，各自标注捕获的错误实现 | 完成，20 条中标注了 8 条明确的"对抗性①/②/③" |
| 反向验证 ≥2 条，真实失败输出 | 完成，共 3 条，见 §5（MA_SEIZES 的 return false、MA_ATTACKS_STAGGER 的 damage>0 门槛、被抓住后必中规则） |
| 对照组（goblin 三旗标全无 + 非吸血怪不回血） | 完成 |
| 文件边界 | 未触碰任何禁止文件（`DetailGenerator.ts`/`data/*.json`/`test/fixtures/*`/`Random.ts`/`Gas.ts`） |
| `npm test` ≥368、`npm run build` 绿 | 完成（388 / 绿） |
