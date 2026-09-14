# P4-4 报告：分裂（MA_CLONE_SELF_ON_DEFEND）与自爆（MA_KAMIKAZE）+ 死亡地形（MA_DF_ON_DEATH）

## 0. 与任务书事实陈述的分歧（先列）

逐条核实了任务书给出的 CE 行号/结构体字段，结论：**任务书的事实陈述均与 CE 源码一致，没有发现错误**。具体核对过的点：

- `monsterCatalog` 中 bloat/pit_bloat/explosive_bloat/vampire/pink_jelly/acidic_jelly/black_jelly 的旗标组合，逐一在 `Globals.c` 对应行号核实无误。
- `distanceBetween`（`Monsters.c:1587`）确认是 Chebyshev 距离（`max(|dx|,|dy|)`），任务书虽未明说但隐含此假设，核实成立。
- `MA_KAMIKAZE` 检查（`Combat.c:1159-1162`）确认在 `attackHit()` 命中掷骰（`Combat.c:1240`）**之前**，即自爆攻击不参与命中率判定，任务书描述准确。
- `monsterFleesFrom`（`Monsters.c:2956-2991`）里 `MA_KAMIKAZE` 那一条（`Monsters.c:2979-2982`）确认存在，且与 `MONST_MAINTAINS_DISTANCE`、免疫怪物、献祭目标共用同一个"不冲锋"函数——任务书只单独提了 kamikaze 这一条，没有提另外几条，这不算错误（任务书本就没声称这是唯一条件），但值得指出：该函数管的范围比任务书暗示的更广，本轮只移植了 kamikaze 这一条（见 §3）。
- `dungeonFeatureCatalog` 四个条目（`DF_BLOAT_DEATH`/`DF_BLOAT_EXPLOSION`/`DF_BLOOD_EXPLOSION`/`DF_HOLE_POTION`）核对内容与 `Globals.c:654/659/651-652`（前后条目）一致；`GAS_EXPLOSION` 的具体机制（`T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE`，`Globals.c:496`）任务书未展开，本报告 §2.3 补充了这部分的推导。

## 1. 改动清单

| 文件 | 改动 |
|---|---|
| `src/engine/Combat/Combat.ts` | `AttackResult` 新增 `kamikazeSelfDestruct?: boolean`；`attack()` 在命中掷骰之前插入 `MA_KAMIKAZE` 检查（对照 `Combat.c:1159-1162`） |
| `src/engine/Core/Game.ts` | 新增私有方法 `alliedCloneCount`、`trySplitMonster`、`triggerDeathFeatures`；在玩家近战（`handlePlayerAction 'move'` 分支）、FIRE/LIGHTNING 直接伤害 bolt、`castMonsterBolt` 三处调用 `trySplitMonster`；在 `playerTurnEnded` 顶部与 `finishTurnEpilogue` 开头调用 `triggerDeathFeatures` |
| `src/entities/Monster.ts` | `Monster` 新增 `deathEffectTriggered` 字段；ally 目标选择循环里跳过未贴脸的 kamikaze 目标；ally-vs-monster / discordant-vs-monster / monster-vs-player 三处 `CombatSystem.attack` 调用点补上 `kamikazeSelfDestruct` 消息分支，前两处命中分支补上 `trySplitMonster` 调用 |
| `src/test/p4_4_split_kamikaze.test.ts`（新增） | 18 个测试，见 §4 |

## 2. CE 行号对照与关键设计决策

### 2.1 分裂（`splitMonster`，`Combat.c:222-310`）

- 触发前置：`MA_CLONE_SELF_ON_DEFEND && alliedCloneCount<100 && currentHP>0 && !MB_IS_DYING`（web 没有 `MB_IS_DYING` 概念，等价地用"调用时 `defender.hp<=0` 则不分裂"覆盖，因为在本项目的死亡流程里 `hp<=0` 已足以表达"正在死亡/已死"）。
- `alliedCloneCount`（`Combat.c:180-208`）：CE 同时统计本层 + 相邻两层。web 单个 `Game` 实例只在内存里保留当前层的 `this.monsters`（相邻楼层的怪物不常驻），因此 `alliedCloneCount` 只统计当前层——**简化点**，上限 100 在实践中几乎不可能触及（一局游戏很难在单层堆出 100 只同种同阵营果冻），不影响可观察行为。
- 连通群 flood fill（`addMonsterToContiguousMonsterGrid`，`Combat.c:160-178`）：四方向，webbed 版本用 BFS + `Set<string>` 复刻，`monstersAreTeammates` 直接复用 `src/entities/Monster.ts` 里 P4-2 就有的既有实现。
- 攻击者格并入连通群（`Combat.c:236-238` 附近 `if distanceBetween<=1 { loc = attacker->loc }`）：完整移植，见对抗性测试②。
- 合格边缘格子扫描：CE 用两个独立的 `for(i) for(j)` 双重循环（先填 `monsterGrid`+`eligibleGrid`，再单独扫一遍 `eligibleGrid` 取第 `randIndex` 个 true 格），**顺序敏感**——本轮严格复刻了"先建 Set，再按 x-major/y-minor 顺序扫描成有序数组"的两阶段写法，保证同种子下选点可复现（`RNG_SUBSTANTIVE` 默认流，未做特殊指定，符合项目约定 §4）。
- 合格性判定：CE 用 `monsterAvoids(monst, pos)`，web 没有这个函数的完整移植（它在 CE 里还要查怪物类型对地形的具体规避规则，比如飞行怪不避水）。这里用 `cell.isPassable && terrain !== LAVA && terrain !== WATER_DEEP` 近似——**简化点**，对果冻这种纯地面怪物结果应该一致，但对未来若要给会飞的怪物复用这个函数会不精确，已在代码注释登记。
- 血量对半与克隆顺序：CE 先 `currentHP=(currentHP+1)/2` 再 `cloneMonster`（母体与克隆体拿到同一个已减半的值）。web 严格复刻：先改 `defender.hp = Math.ceil(defender.hp/2)`（对正整数 `Math.ceil(hp/2) === Math.floor((hp+1)/2)`，等价），再用 `monsters.json` 里同 `typeId` 的数据重新 `new Monster(...)` 构造克隆体，之后覆盖 `hp`/`maxHp`/`isAlly`/`leader`/`state`。
- "分裂体不继承父代已学行为"：CE 用 `clone->info.abilityFlags &= (catalog | mutationCatalog[...])` 显式清掉运行期学到的东西。web 因为克隆体是从 `monsters.json` **全新构造**的（不是内存拷贝），天然满足这条约束——不需要额外的清理逻辑。变异（`mutation`）字段单独 `clone.mutate(defender.mutation)` 复刻，对齐 CE 注释"mutation effects are inherited, they're not learned abilities"。
- 未移植的边角：CE 结尾"非飞行怪清除 1000 tick 悬浮状态"的特判（分裂体刚出生不可能带这个状态，等价于不需要处理）。

**调用点核对（任务书列出 5 个，web 现状）**：

| CE 位置 | web 是否存在这条路径 | 处理 |
|---|---|---|
| `Combat.c:1424` attack() 主路径（近战） | 存在（玩家近战 `handlePlayerAction 'move'`；ally-vs-monster；discordant-vs-monster） | 已接 |
| `Items.c:5213` bolt 命中 | 存在，但仅 FIRE/LIGHTNING（玩家直接伤害 bolt）与 `castMonsterBolt`（怪物对怪物/玩家的伤害类 bolt）两条子路径真正造成伤害 | 已接（三处调用点） |
| `Combat.c:614/637` 玩家投掷**怪物**砸中 | **不存在**：web 的"投掷"（`throwItemAt`）只能扔物品，非潜物机制没有实现；`data.effect==='fire_burst'/'poison_burst'` 等是药水溅射，没有"投掷怪物"这个动作 | 不接（web 无此机制，非本轮范围） |
| `Items.c:6851` 投掷**武器**命中 | **不存在**：`throwItemAt` 对非药水物品只是"扔到地上"（`item.loc = {tx,ty}; this.items.push(item)`），完全没有对目标格怪物造成伤害的逻辑——这是 web 一个更大的既有缺口（投掷武器根本不伤人），与本轮无关，不在此修 | 不接（已知缺口，登记） |

### 2.2 自爆（`MA_KAMIKAZE`）

- 核心检查（`Combat.c:1159-1162`）：`attacker.hasAbility('MA_KAMIKAZE')` 时 `attacker.takeDamage(attacker.hp)` 直接把攻击者打到 ≤0（等价 `killCreature`），`return`，**不进入下面的命中判定**。放在 `CombatSystem.attack` 里，覆盖了所有经由这个统一入口的攻击路径（玩家近战对怪物时攻击者是玩家，不会命中这条；三只膨胀怪作为攻击者时会命中这条）。
- AI 侧"不冲锋"（`Monsters.c:2979-2982`，`monsterFleesFrom` 内一条判断）：web 完全没有 `monsterFleesFrom` 的通用移植（它同时还管 `MONST_MAINTAINS_DISTANCE`、免疫怪物且非 immobile、献沙盘目标三种情况，`Monsters.c:2967-2977`），只在 ally 目标选择循环（`Monster.ts` 约 538-550 行原有代码）里加了一条 "`dist>1 && other.hasAbility('MA_KAMIKAZE')` 则跳过" 的过滤，让盟友不会主动去追一个还没贴脸的膨胀怪。**限定范围**：
  - discordant 分支（`Monster.ts` 约 703-727 行）不改——它只处理"已经贴脸的相邻怪物"，CE 的 `monsterFleesFrom` 本来就只影响"要不要移动过去"的路径决策，不影响"已经贴脸了要不要打"，所以这里不需要改。
  - 敌对怪物之间没有互相锁定目标的 AI（web 只有 ally-vs-hostile 和 discordant-vs-any 两种"怪物打怪物"路径），所以 `monsterFleesFrom` 的另外两条分支（免疫怪物、献祭目标）在 web 里根本没有可挂载的地方，本轮不实现，登记为已知缺口。

### 2.3 死亡地形（`MA_DF_ON_DEATH`，`Combat.c:1963-1990`）

- 触发时机：`!administrativeDeath && MA_DF_ON_DEATH && !MB_IS_FALLING`。web 没有"administrative death"（脚本/调试强制移除）和坠落中间态的概念，本轮的 `triggerDeathFeatures` 只对"正常死亡"（`hp<=0`）生效，等价覆盖了 CE 的默认路径。
- 单点触发保证：新增 `Monster.deathEffectTriggered` 字段，`triggerDeathFeatures` 处理过的怪物立刻置位，之后的调用直接跳过。
- **调用时机**（架构决策，见任务书要求"新建统一死亡收口函数，还是挂在清扫处，由你判断"）：选择挂两处，而不是新建一个独立的"击杀"入口函数：
  1. `playerTurnEnded()` 顶部（原本就是 `this.monsters = this.monsters.filter(m => m.hp > 0)` 的清扫点）；
  2. `finishTurnEpilogue()`（每次 `advancementLoop` 跑完之后，两条路径——同步 headless 与动画路径——都会走到这里）。
  
  **理由**：web 没有 CE 那种单一 `killCreature()` 函数作为所有死亡的必经之路（任务书已指出这点），死亡判定分散在 `takeDamage`/`environment` 效果/怪物互殴等十几处 `hp<=0` 检查里，真正稳定的"收口"只有 `playerTurnEnded` 顶部的 filter。但如果只挂在这一处，"推进循环内部杀死的怪物"（怪物互殴、环境毒气/岩浆/深水）要等到**下一次** `playerTurnEnded` 才会触发死亡地形，观感上会晚一整回合。所以额外在 `finishTurnEpilogue`（当前回合收尾，`advancementLoop` 已经跑完）补一次，覆盖"推进循环内杀死目标"这种时序，让同一回合内产生的效果尽量同回合落地。两处都用 `deathEffectTriggered` 兜底，不会重复触发（见对抗性测试⑤与其反向验证）。

  **仍然残留的时序差**：玩家行动本身杀死一只 bloat（比如近战/bolt），是在 `handlePlayerAction` 里发生的，此时 `hp<=0` 但还没进 `playerTurnEnded`；下一步 `handlePlayerAction` 末尾调用 `playerTurnEnded()`，顶部的 `triggerDeathFeatures()` 会在**同一次调用栈**里捕获到它（因为 `playerTurnEnded` 是紧跟着调用的，不需要等下一次玩家输入）。所以"玩家杀死 bloat"这种最常见的情形，效果观感上是同回合生效的，报告测试用例已验证。

- **gas 量纲映射**：CE `DF_BLOAT_DEATH` 是 `{POISON_GAS, GAS, 2000, 0, 0}`——`GAS` 层用 `startprob` 字段当**体积**（单点喷发，`Globals.c:600` 注释），2000 是 CE 内部气体扩散算法的体积单位，与本项目 `EnvironmentManager.addGas(x,y,type,amount)` 的 `amount`（0-100 的密度上限）不是同一量纲，也没有可逆推的换算公式（CE 的体积会随扩散过程按邻格气压差重新分配，不是简单的"体积→密度"线性映射）。选择直接对齐项目里已有的"一次性毒气释放"场景的满值：
  - `Game.ts` 里 `poison_burst` 药水：`addGas(loc.x, loc.y, 2, 70)`
  - `creeping_death` 药水（临时，标注"will add actual caustic gas later"）：`addGas(loc.x, loc.y, 1, 100)`
  - 地板陷阱：`addGas(x, y, 2, 80)`
  
  取这几个里最强的 100（`addGas` 内部本来就 `Math.min(100, cell.density + amount)` 封顶），不新发明映射公式，理由：`DF_BLOAT_DEATH` 在 CE 里描述是"一大团毒气骤然喷出"，属于这几个道具里最强的那一档，用满值合理，且避免引入一个无法验证对错的自造系数。
- **explosive_bloat 的 `GAS_EXPLOSION`**：核实 `Globals.c:496` 该地形条目带 `T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE`——是"点燃 + 瞬时爆炸伤害"的复合效果，不是单纯的地形铺设。web 完全没有"瞬时范围爆炸伤害"的现成机制（`Bolt.ts:112` 注释已承认 `spawnDungeonFeature` 整体缺失），本轮**不新造爆炸伤害公式**，只复用既有的 `environment.ignite(x,y)`（与 `fire_burst` 药水同一个函数），覆盖死亡格 + 四方向相邻格。伤害完全交给已有的"燃烧地块每回合掉血"结算（`applyEnvironmentalEffects` 里 `cell.isBurning` 分支）。**这是一个有意的简化**：CE 的爆炸是瞬时的（那一刻就有伤害），web 版本变成了"点燃后逐回合烧"，杀伤力被拉长/削弱了，报告在此登记，未在 `npm test` 门禁里对"瞬时伤害数值"做断言（因为这个数值本来就不存在）。

## 3. 未实现项清单（已知缺口，非本轮范围）

1. **pit_bloat 的洞（`DF_HOLE_POTION`）**：需要洞/坠落地形，web 的 `fall_down` 药水效果只打印一行日志（`Game.ts` `case 'fall_down'`），坠落子系统完全不存在（与既有 `ai_docs` 里登记的 P1-22/P1-23 缺口一致）。pit bloat 本轮只自爆，不生成洞。
2. **vampire 的血迹（`DF_BLOOD_EXPLOSION`）**：纯装饰性地形铺设，web 没有血迹层，不接。vampire 仍然正常死亡、`deathEffectTriggered` 会被置位（因为它确实带 `MA_DF_ON_DEATH`），只是没有可见效果——对照组测试已覆盖这个"标记但不落地"的边界情况。
3. **投掷武器命中怪物完全不造成伤害**：`throwItemAt` 对非药水物品只是把物品扔到地上，这是比"没接 splitMonster"更大的既有缺口，不在本轮修复范围，只在此登记。
4. **"投掷怪物"机制（`Combat.c:614/637`）**：web 没有这个 CE 特有玩法（拿起并投掷怪物尸体/活物），无对应路径可接。
5. **`monsterFleesFrom` 的另外两条分支**（免疫怪物且非 immobile、献祭目标）：web 没有可挂载的怪物互殴 AI 入口，未移植。
6. **`MA_NEVER_VORPAL_ENEMY` / `MA_NEVER_MUTATED`**（`Rogue.h:2132-2133`，与 `MA_KAMIKAZE` 共用同一位）：web 没有"致命一击/易怒符文"（vorpal enemy）系统，也没有"怪物变异生成时排除某些怪"的筛选逻辑对应这两个语义位，未接，纯粹因为下游系统不存在。

## 4. 测试与对抗性设计

新增 `src/test/p4_4_split_kamikaze.test.ts`，18 个用例：

| 测试 | 能捕获的具体错误实现 |
|---|---|
| 对抗性①：1 HP 果冻分裂后母体应存活于 1 HP | 把 `(hp+1)/2` 写成 `floor(hp/2)`：母体会被自己的分裂打死（0 HP），断言失败。**已做反向验证**，见下。 |
| 对抗性②：走廊场景，多种子重复分裂应能在玩家身后（(4,5)）选中克隆点 | 漏掉"攻击者格并入连通群"：克隆体永远只会出现在果冻另一侧（x=7），(4,5) 永远选不中。**已做反向验证**，见下。 |
| 对抗性③：唯一对角开放格 (7,4) 在四方向实现下永远不会被选中 | 把连通群/合格格判定从四方向换成八方向：会偶尔选中对角格。（未做真实反向验证跑失败输出，因为要引入一份"八方向版本"的代码分支改动量较大，超出"改一行验证"的量级；但测试本身的断言逻辑——多种子扫描 + 显式排除已知的错误落点——足以在八方向实现下必然失败，属于"合理可信的对抗性设计"而非"调用了就算过"。） |
| 对抗性④：kamikaze 检查必须在命中掷骰之前 | 防御力拉到 999（正常命中率≈0%），仍断言 20 次全部 `kamikazeSelfDestruct===true` 且伤害恒为 0；如果实现把 kamikaze 检查挪到 `hitProb` 判定之后，这批用例会因为几乎全 miss 而大量失败。 |
| 对抗性⑤：死亡地形只触发一次 | 连续调用两次 `triggerDeathFeatures()`，断言毒气密度不变；没有 `deathEffectTriggered` 兜底的实现会在第二次调用时把密度再加一次（虽然会被 `Math.min(100,...)` 封顶，所以本用例配合"用一次刚好不到 100 的量"更严格——当前实现用满值 100，封顶后二次调用确实测不出"叠加"；因此额外强调：这条测试真正防住的是"deathEffectTriggered 完全没有/没生效"这种更粗暴的错误，比如把判断条件写反导致每次都重新处理并反复打印日志/重复扣血——如果未来改成非封顶的伤害类效果，这条测试能立刻捕获叠加 bug）。见下方"已知局限"说明。 |
| 端到端（`handlePlayerAction`） | 验证 `trySplitMonster` 真的被生产路径调用到，不是只有单元测试里手调——防止"写了函数但忘记接线"这类最常见的集成疏漏。 |
| AI 不冲锋测试 | 验证 ally 目标选择过滤逻辑；用"bloat 未掉血"间接验证盟友选择了更近的 rat 而不是绕路冲向 bloat。 |
| 对照组（vampire / goblin，各 2-3 处） | 确认"有 DF 无 kamikaze"和"什么都没有"两类怪物的既有行为不受本轮改动影响，防止旗标判断条件写宽（比如漏了 `&&` 变成 `||`，导致 vampire 也会自爆）。 |

### 已知局限：对抗性⑤的强度

`addGas` 内部有 `Math.min(100, ...)` 封顶，而本轮选择用满值 100 触发毒气，导致"重复触发会叠加"这个角度的断言在数值上测不出差异（100+100 封顶后还是 100）。测试改为验证 `deathEffectTriggered` 语义本身（见测试文件里另有一条 `expect(bloat.deathEffectTriggered).toBe(true)` 附带断言），并在源码里补充了一个更直接的注释说明。**如果要更严格地测出"叠加"**，需要让第一次触发后 density 低于 100（比如先人为调低 `addGas` 的调用量到 30），但这样会偏离"campo 复用既有满值道具口径"的设计决策，权衡后保留当前写法，在此如实说明局限，不打包成"看起来更强但其实没测出东西"的断言。

## 5. 反向验证（真实失败输出）

### 5.1 把血量对半从 `Math.ceil(hp/2)` 改成 `Math.floor(hp/2)`

```
AssertionError: expected +0 to be 1 // Object.is equality

- Expected
+ Received

- 1
+ 0

 ❯ src/test/p4_4_split_kamikaze.test.ts:77:26
     75|         priv(game).trySplitMonster(jelly, player);
     76|
     77|         expect(jelly.hp).toBe(1); // ceil(1/2) = 1，母体应仍存活
       |                          ^
     78|         expect(game.monsters.length).toBe(2);
     79|         const clone = game.monsters.find(m => m !== jelly)!;

 Test Files  1 failed (1)
      Tests  1 failed | 17 passed (18)
```

改回 `Math.ceil` 后重跑，18/18 通过。

### 5.2 禁用"攻击者格并入连通群"（把 `if (dist<=1 && ...)` 改成 `if (false && dist<=1 && ...)`）

```
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ src/test/p4_4_split_kamikaze.test.ts:125:41
    123|
    124|         expect(seenRightOfJelly.has(7)).toBe(true); // (7,5)：果冻自身连通群的边…
    125|         expect(seenLeftOfPlayer.has(4)).toBe(true); // (4,5)：只有并入攻击者格才…
       |                                         ^
    126|     });

 Test Files  1 failed (1)
      Tests  1 failed | 17 passed (18)
```

还原后重跑，18/18 通过；`diff` 确认改动已完全还原（无残留）。

## 6. 门禁输出

### `npm test`（完整输出尾部）

```
> brogue-web@0.0.0 test
> vitest run --run


 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web


 Test Files  37 passed (37)
      Tests  366 passed | 7 skipped | 5 todo (378)
   Start at  21:55:15
   Duration  13.73s (transform 1.81s, setup 0ms, import 4.22s, tests 45.50s, environment 10ms)
```

基线 348 passed → 366 passed（+18，全部新增，0 减少）。

### `npm run build`（完整输出尾部）

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
dist/assets/Filter-BdKtdFh6.js                0.90 kB │ gzip:   0.48 kB
dist/assets/BufferResource-Dx7qwT-z.js       10.60 kB │ gzip:   2.79 kB
dist/assets/webworkerAll-CICe5Nuj.js         11.88 kB │ gzip:   3.94 kB
dist/assets/CanvasRenderer-P0JwyRl6.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-CeQATxfd.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-CTQa0mTo.js           41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-3O4M6eKR.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-o8Cny8ZQ.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-D_LQrX9A.js               907.97 kB │ gzip: 287.58 kB

✓ built in 1.39s
```

（chunk 体积警告是既有的、与本轮改动无关的性能提示，非错误。）

## 7. `git diff --stat`

```
 brogue-web/src/engine/Combat/Combat.ts |  16 +++
 brogue-web/src/engine/Core/Game.ts     | 194 ++++++++++++++++++++++++++++++++-
 brogue-web/src/entities/Monster.ts     |  47 +++++++-
 3 files changed, 253 insertions(+), 4 deletions(-)
```

（另有新增未跟踪文件 `brogue-web/src/test/p4_4_split_kamikaze.test.ts`，未被 `git diff --stat` 计入。）

## 8. 验收条款逐条对照

| 条款 | 状态 |
|---|---|
| 分裂：3 只果冻，CE 选址算法与减半逻辑，接上 web 中实际存在的全部触发路径 | 完成；5 条 CE 调用点中 3 条 web 有对应实现（近战/bolt 两类），已全部接上；另 2 条（投掷怪物、投掷武器）web 无此机制，登记 |
| 自爆：3 只膨胀怪，攻击即死；其它怪物不冲锋 kamikaze 目标 | 完成；AI 不冲锋限定在 ally 目标选择这一处（web 仅有的"怪物主动选怪物目标"逻辑） |
| 死亡地形：bloat→毒气，explosive bloat→火焰爆炸 | 完成，量纲映射与简化已在 §2.3 说明 |
| pit bloat 洞 / vampire 血迹：显式断言现状，不静默跳过 | 完成，测试文件对照组已覆盖 |
| 文件边界 | 仅改动 `Combat.ts`/`Game.ts`/`Monster.ts` + 新测试文件，未碰 `DetailGenerator.ts`/`data/*.json`/`fixtures`/`Random.ts` |
| 测试：对抗性、可失败 | 完成，18 个用例，5 条对抗性设计 + 对照组 |
| 反向验证 ≥2 条，真实失败输出 | 完成，见 §5，两条均为真实运行输出并已还原 |
| `npm test` 全绿，只许增不许减 | 348→366，0 减少 |
| `npm run build` 绿 | 通过 |

---

# 补做：验收打回修正（explosive bloat 在石地板上无效）

协调者独立探针发现：`explosive_bloat` 的死亡爆炸复用了旧的 `environment.ignite()`，而 `ignite()` 只对 `GRASS/FOLIAGE/BOG/DOOR` 白名单地形生效——地牢里绝大多数格子是石地板（`TerrainType.FLOOR`），导致这只怪物"死亡时触发特殊效果"的承诺在最常见的场景下完全不发生。这条没有被我此前的测试捕获，原因是我原来那条测试特意铺了一圈 `GRASS` 才能让断言可观察，而这个"仅对可燃地形生效"的限制本身没有进"已知缺口"清单——这是我的疏漏，不是设计取舍，予以纠正。

## 根因确认

核实 CE `DF_BLOAT_EXPLOSION` 铺的地形是 `GAS_EXPLOSION`（`Globals.c:496`：`{G_FIRE, &yellow, 0, 10, 0,0,0, 10000, EXPLOSION_LIGHT, (T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE), (TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT), ...}`）——这是一个**覆盖在原有地形之上**的临时地形层（`TM_STAND_IN_TILE`：不替换底层地形，只是"叠加站立"），`T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE` 直接赋予火焰与爆炸伤害两个地形标志，**不检查底层地形能不能烧**。web 的 `ignite()` 语义完全不同：它是"点燃这块地形本身"，只对预先认定"能烧"的几种地形生效，这是符合直觉的（判断"这堆草能不能点着"），但拿来复用给"一种自带火焰属性的临时覆盖层"就用错了函数。

## 改动

### 1. `src/engine/Environment/Gas.ts`：新增 `igniteForced(x, y, duration?)`

```ts
public igniteForced(x: number, y: number, duration: number = rng.randRange(4, 7)) {
    const cell = this.grid.getCell(x, y);
    if (!cell) return;
    if (!cell.isBurning) {
        cell.isBurning = true;
        cell.burnDuration = duration;
    } else {
        cell.burnDuration = Math.max(cell.burnDuration, duration);
    }
}
```

- **不改动 `ignite()`**：它原封不动，`fire_burst` 药水等既有调用方行为不变（已用 368 个测试全绿确认，含改动前就存在的 fire_burst 相关用例）。
- 已在 `case cell.isBurning` 分支重复的格子上加了"取更长剩余时长而不是打断"的处理（`Math.max`），避免爆炸命中一个已经在烧的格子时把剩余时长缩短——虽然这个边界情况在当前调用方式下很少触发（death cell 与四方向邻格通常没有预先在烧），但作为一个通用的"强制点火"入口，做对这个细节更稳妥，且不影响任何现有测试。

### 2. `updateFires()` 安全性核查（任务书要求"写进报告"）

逐行读了 `updateFires()`（`Gas.ts:111-200` 附近，见上面新增函数注释里内嵌的完整分析，此处摘要结论）：

- 循环体在 `if (!cell.isBurning) continue;`（原第 88 行）之后，**只用 `cell.isBurning` 这个布尔值决定要不要继续处理**，从未检查地形是否在可燃白名单里。
- 地形白名单只在两处出现，且都不会把"正在烧的格子"提前熄灭：
  1. `burnDuration<=0` 烧尽时的"变成焦土"分支——非白名单地形（如石地板）**不会**进入 if/else-if 链的任何一支，效果是单纯把 `isBurning` 置回 `false`，地形保持原样。这不是"提前熄灭"，是"烧满了 `duration` 回合、正常烧完之后"的收尾，语义上完全正确（石地板烧完不会变成焦土地板，这本身就该是对的）。
  2. 向外扩散点火的 `isFlammable` 判断——只影响"要不要把火蔓延到邻居格"，跟"这一格自己会不会被打断"无关。
- 结论：强制点燃的格子会稳定燃烧满 `duration` 回合，每回合都会被 `applyEnvironmentalEffects` 的 `cell.isBurning` 分支检测到并造成固定 2 点伤害（该分支同样不检查地形），不会因为地形不可燃被中途掐掉。这一点已经被新增的"完整回合结算掉血"测试直接验证（见下）。

### 3. 燃烧时长取值依据

选择复用 `ignite()` 里 `GRASS/FOLIAGE/BOG` 分支已经在用的 `rng.randRange(4, 7)`，而不是 CE `GAS_EXPLOSION` 条目里的 `350`/`100`。理由：CE 那两个数字是 `dungeonFeatureCatalog` 里的 `startprob`/`probdecr`，驱动的是 CE 自己的"这一格是否继续向外蔓延"的扩散概率模型（每回合按 `probdecr` 衰减 `startprob`，决定火焰云覆盖多大范围），跟"某一格火焰本身烧几回合"是两个不同维度的参数；web 的 `updateFires()` 根本没有复刻这套扩散概率模型（它的扩散是"每回合 40% 概率点燃可燃邻格"的简化版，不认 `startprob/probdecr`），没有能对应放 350/100 的位置。`4-7` 回合是项目里唯一已经校验、玩家能实际感知到"这团火烧了几回合"的既有口径，直接复用，不凭空发明新数字。

### 4. `triggerDeathFeatures` 改动

`explosive_bloat` 分支的 `this.environment.ignite(...)` 全部替换为 `this.environment.igniteForced(...)`，覆盖死亡格 + 四方向邻格，逻辑结构不变。

### 5. 新增/调整测试

`src/test/p4_4_split_kamikaze.test.ts`：

- 原"铺草"测试保留，标题改为"用作与下一条'默认石地板'对照"。
- 新增**对抗性⑥**：在 `clearToOpenRoom` 的默认地形（`TerrainType.FLOOR`，非白名单）上放一只 hp=0 的 `explosive_bloat`，断言死亡格与四方向邻格 `isBurning===true`，并额外断言对角格 (8,5) **不**被点燃（复核"只四方向"没有被这次改动破坏）。这条能捕获"强制点火被误实现成调用老 `ignite()`"这一类错误——见下方反向验证。
- 新增：站在爆炸格上的生物走**完整回合结算**（直接调用 `applyEnvironmentalEffects()`，与生产代码里 `advancementLoop` 调用的是同一个函数）后真的掉血，而不是只读 `isBurning` 字段。
- 对照组不变：`bloat` 仍只产生毒气不点火；`vampire`/`pit_bloat` 仍不产生任何地形效果（沿用原有测试，未改动）。

## 反向验证（真实失败输出，覆盖"强制点火写成调用老 ignite()"）

把 `igniteForced` 临时改成：

```ts
public igniteForced(x: number, y: number, duration: number = rng.randRange(4, 7)) {
    // BUG（反向验证用）：错误地委托给老的 ignite()，重新引入地形白名单检查。
    this.ignite(x, y);
}
```

运行 `npx vitest run src/test/p4_4_split_kamikaze.test.ts`，真实输出：

```
 ❯ src/test/p4_4_split_kamikaze.test.ts (20 tests | 2 failed) 229ms
     × 验收打回修正：explosive bloat 死亡在默认（不可燃）石地板上也必须点燃死亡格与四方向邻格。… 11ms
     × 验收打回修正：站在爆炸格上的生物走完整回合结算后真的掉血（不是只读 isBurning） 9ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/test/p4_4_split_kamikaze.test.ts > P4-4 验收 3：死亡地形 — bloat 毒气 / explosive bloat 爆燃 > 验收打回修正：explosive bloat 死亡在默认（不可燃）石地板上也必须点燃死亡格与四方向邻格。…
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ src/test/p4_4_split_kamikaze.test.ts:373:52
    371|         priv(game).triggerDeathFeatures();
    372|
    373|         expect(game.grid.getCell(7, 6)?.isBurning).toBe(true);
       |                                                    ^

 FAIL  src/test/p4_4_split_kamikaze.test.ts > P4-4 验收 3：死亡地形 — bloat 毒气 / explosive bloat 爆燃 > 验收打回修正：站在爆炸格上的生物走完整回合结算后真的掉血（不是只读 isBurning）
AssertionError: expected 6 to be less than 6
 ❯ src/test/p4_4_split_kamikaze.test.ts:401:27
    399|         priv(game).applyEnvironmentalEffects();
    400|
    401|         expect(victim.hp).toBeLessThan(hpBefore);
       |                           ^

 Test Files  1 failed (1)
      Tests  2 failed | 18 passed (20)
```

改回正确实现后重跑，20/20 通过；`diff` 确认 `Gas.ts` 已完全还原到补丁前状态（已在本地核对，无残留）。

## 门禁（补做后，完整输出尾部）

### `npm test`

```
> brogue-web@0.0.0 test
> vitest run --run


 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web


 Test Files  37 passed (37)
      Tests  368 passed | 7 skipped | 5 todo (380)
   Start at  22:04:39
   Duration  13.76s (transform 1.57s, setup 0ms, import 4.05s, tests 45.20s, environment 7ms)
```

348（初始基线）→ 366（首次交付）→ **368**（补做后，+2 条新用例），零回退。

### `npm run build`

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

vite v7.3.1 building client environment for production...
transforming...
✓ 785 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                               0.76 kB │ gzip:   0.43 kB
...
dist/assets/index-8ztcwyFP.js               908.14 kB │ gzip: 287.63 kB

✓ built in 1.39s
```

## `git diff --stat`（补做后）

```
 brogue-web/src/engine/Combat/Combat.ts   |  16 +++
 brogue-web/src/engine/Core/Game.ts       | 198 ++++++++++++++++++++++++++++++-
 brogue-web/src/engine/Environment/Gas.ts |  46 +++++++
 brogue-web/src/entities/Monster.ts       |  47 +++++++-
 4 files changed, 303 insertions(+), 4 deletions(-)
```

`Gas.ts` 是本次补做新增的改动面（仅新增 `igniteForced`，`ignite()`/`updateFires()` 原样未动）；其余三个文件相对首次交付只有 `Game.ts` 里的方法调用与注释更新。生产代码没有任何地方用 `setTerrain` 去伪造可燃地形——搜索确认 `Game.ts` 里不存在把 `explosive_bloat` 相关逻辑接到 `setTerrain(...GRASS...)` 的写法（那种写法只出现在测试文件的对照用例里，用于铺草地做"可燃地形"分支的对照，不影响生产地图状态）。

## 验收条款逐条对照（补做部分）

| 条款 | 状态 |
|---|---|
| 新增 `igniteForced` 强制点燃入口，不改动 `ignite()` 默认路径 | 完成 |
| 读 `updateFires()` 确认强制点燃不会被"地形不可燃"提前熄灭，写进报告 | 完成，见上 |
| 燃烧时长取值有依据并写明 | 完成，采用既有 `randRange(4,7)`，理由见上 |
| 默认（不可燃）地形下新增断言测试，原铺草测试保留 | 完成，两条并存 |
| 补一条"完整回合结算后真的掉血"的测试 | 完成 |
| 对照组保留（bloat 不点火、vampire/pit_bloat 不产生地形） | 完成，未改动原有对照组用例 |
| 不建通用 DF 系统，不碰 pit bloat 的洞 | 未碰 |
| 生产代码不用 `setTerrain` 绕过可燃性检查 | 确认未使用 |
| 反向验证覆盖"强制点火写成调用老 ignite()" | 完成，见上，真实输出 |
| `npm test` ≥366、`npm run build` 绿 | 368 通过，build 绿 |
