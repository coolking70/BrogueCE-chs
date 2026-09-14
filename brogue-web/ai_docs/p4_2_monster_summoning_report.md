# P4-2：怪物召唤（MA_CAST_SUMMON）

## 边界回顾

- 允许修改：`src/entities/Monster.ts`、`src/engine/Core/Game.ts` —— 两个都改了。
- 允许新增：测试文件、报告文件 —— 新增 `src/test/p4_2_monster_summoning.test.ts` 与本报告。
- 未触碰：`src/data/` 下任何 json（含 `monsters.json`/`hordes.json`）、`src/test/fixtures/` 下任何 json、Bolt.ts、Combat.ts、CombatFormulas.ts、Architect.ts、BlueprintEngine.ts、Player.ts、Creature.ts、ItemLoader.ts、Item.ts、DetailGenerator.ts、Random.ts、任何 `.vue`。
- 未修改任何已有 `.test.ts`。
- 未执行 git commit/add/push/reset/checkout。
- 平衡观测用的临时探针 `src/test/zz_balance_probe.test.ts` 已在采集完数据后删除；`git status` 已核实工作区只剩 `Game.ts`/`Monster.ts` 两处修改与新增的 `p4_2_monster_summoning.test.ts`/本报告。

---

## 一、web 现状核查（任务要求"需要你查明"的三项）

### 1.1 `abilityFlags` 里 `MA_CAST_SUMMON`/`MA_ENTER_SUMMONS` 是否齐全

**齐全，无需改 `monsters.json`。** 核对结果：

| 怪物 | abilityFlags | bolts |
|---|---|---|
| goblin conjurer | `MA_CAST_SUMMON`, `MA_AVOID_CORRIDORS` | `[]` |
| ogre shaman | `MA_CAST_SUMMON`, `MA_AVOID_CORRIDORS` | `['HASTE','SPARK']` |
| lich | `MA_CAST_SUMMON` | `['FIRE']` |
| phylactery | `MA_CAST_SUMMON`, `MA_ENTER_SUMMONS` | `[]` |
| goblin warlord | `MA_CAST_SUMMON`, `MA_ATTACKS_PENETRATE`, `MA_AVOID_CORRIDORS` | `[]` |
| vampire | `MA_TRANSFERENCE`, `MA_DF_ON_DEATH`, `MA_CAST_SUMMON`, `MA_ENTER_SUMMONS` | `['BLINKING','DISCORD']` |
| eldritch totem | `MA_CAST_SUMMON` | `[]` |
| phoenix egg | `MA_CAST_SUMMON`, `MA_ENTER_SUMMONS` | `[]` |

8 只召唤者、3 只 `MA_ENTER_SUMMONS`（phylactery/vampire/phoenix egg），与任务提示词描述完全一致。`hordes.json` 的 10 条 `HORDE_IS_SUMMONED` 条目也与提示词列出的一一对应（用 Python 脚本核对过，逐条见下文对照表）。

### 1.2 "随从/领袖"关系字段

**P1-2b 之前没有**：`Monster.ts` 在本轮之前没有任何 `leader`/`follower` 字段，`spawnHordeAt`（Game.ts，常规 horde 落地）也没有给 horde 成员设置任何"属于哪个领袖"的关系——本轮之前，horde 领袖和成员在数据结构上是互不相识的两个独立 `Monster` 实例。

本轮新增：
- `Monster.leader: Monster | null`（`src/entities/Monster.ts`）——CE `creature->leader` + `bookkeepingFlags & MB_FOLLOWER` 的合并等价，非 null 即视为"是某召唤者/horde 领袖的直接随从"。
- `Monster.typeId: string`（`src/entities/Monster.ts`）——存 `monsters.json` 的 `id` 字段（如 `'goblin_conjurer'`），用于在 `summonMinionsFor` 里按 `hordes.json` 的 `leader` 字段做召唤者类型匹配（CE `summoner->info.monsterID`）。与 `Creature.id`（每个实例独一无二的存档实体 id，`number` 类型）是两个完全不同的东西，命名上刻意区分避免混淆。

### 1.3 `pickHordeType` 签名是否需要扩展

**不需要改签名。** 现有 `pickHordeType(candidates: HordeEntry[]): HordeEntry | null`（Game.ts:965）已经是"纯粹按 frequency 加权抽取一个候选"的职责，深度窗口/禁用 flag 的过滤全部在调用方通过 `hordeCandidates(depth, forbiddenFlags)` 构造候选集后再传入——这正是 CE `pickHordeType(depth, summonerType, forbiddenFlags, requiredFlags)` 内部两段逻辑（先按条件筛出 `possCount`，再按 `index` 落点）在 web 侧被拆成"筛选"与"加权抽取"两个函数的既有设计。

CE 召唤分支的筛选条件是：

```c
(summonerType && (hordeCatalog[i].flags & HORDE_IS_SUMMONED) && hordeCatalog[i].leaderType == summonerType)
```

——**不看深度窗口，也不看 `forbiddenFlags`**（`summonMinions` 调用 `pickHordeType(0, summonerType, 0, 0)`，`forbiddenFlags=0` 意味着这张过滤表本身是空的，天然不排除任何 horde）。这与现有 `hordeCandidates(depth, forbiddenFlags)` 的"按深度窗口 + 禁用集过滤"完全是两套不同的筛选语义，硬塞进同一个函数反而会让两条路径的参数意义混淆。

处置：新增一个不与 `hordeCandidates`共用代码路径的筛选（`summonMinionsFor` 内联的 `filter`），复用**未改动**的 `pickHordeType(candidates)` 做加权抽取：

```ts
const candidates = (hordeData as HordeEntry[]).filter(h =>
    h.flags.includes('HORDE_IS_SUMMONED') && h.leader.toLowerCase() === summoner.typeId.toLowerCase()
);
const horde = this.pickHordeType(candidates);
```

`pickHordeType` 函数体一行未改，`hordeCandidates`/`rollSpawnDepth`/`spawnHordeAt`（除下文 1.4 的一处新增）/`spawnPeriodicHorde`/`summonMonstersAroundPlayer` 均未改动。

### 1.4 顺带修的一处既有缺口：常规 horde 成员从未设置 `leader`

核对 CE `spawnHorde`（Monsters.c 附近）发现：**常规（非召唤）horde 同样经 `spawnMinions` 落地成员**，`spawnMinions` 内部无条件设置 `monst->leader = leader` 与 `MB_FOLLOWER`（Monsters.c:742-744），不是召唤专属逻辑。这意味着诸如 goblin warlord 麾下的常规哥布林战队，其成员在 CE 里本来就有 `leader` 指向 warlord。

web 的 `spawnHordeAt`（Game.ts，P1-2b 落地，常规 horde 生成用）在本轮之前**没有**设置这个关系。若不补上，`countMinions` 对"本身就是某个常规 horde 领袖、后来又召唤"的怪物（goblin warlord 是唯一同时具备两种身份的召唤者）算出的既有随从数会失真（漏算常规战队成员）。

处置：在 `spawnHordeAt` 现有的成员生成循环里补一行 `mon.leader = leaderMon;`（Game.ts，成员 `Monster` 构造之后、`push` 之前）。这是**该函数本轮唯一改动的一行**，不改变任何已有的落格搜索/RNG 消耗顺序/怪物数量逻辑，`horde_selection.test.ts`/`horde_terrain_spawn.test.ts` 等既有测试原样通过（见第五节）。

---

## 二、与 CE `monsterSummons` / `summonMinions` / `pickHordeType` 召唤分支的逐段对照

### 2.1 `monsterSummons`（Monsters.c:2418）→ `Monster.trySummon`（Monster.ts）

```
if (!(abilityFlags & MA_CAST_SUMMON)) return false;          → hasAbility('MA_CAST_SUMMON') 早退
minionCount = countMinions(...)                               → countMinions(this, game.monsters)（导出的模块级函数）
if (alwaysUse && minionCount < 50)                             → attempt = true（确定性）
else if (MA_ENTER_SUMMONS): if (!rand_range(0,7))              → attempt = rng.randRange(0,7)===0（1/8）
else if ((非盟友||minionCount<5) && !rand_range(0,n²*3+1))      → attempt = rng.randRange(0,n²*3+1)===0
if (attempt) { summonMinions(monst); return true; }            → game.summonMinionsFor(this); endTurnWithAttack(); return true
```

**逐字节对照 `rand_range` 语义**：CE `!rand_range(0,7)` 意为"结果恰好是 0"，`rand_range(0,7)` 在 CE 里是闭区间 `[0,7]`（8 个等可能取值），命中 0 的概率是 1/8。web 的 `rng.randRange(lowerBound, upperBound)` 同样是闭区间（`Random.ts:97-108`，`interval = upperBound - lowerBound + 1`），`rng.randRange(0,7) === 0` 概率同样是 1/8，口径一致。第三分支同理：`rand_range(0, n²*3+1)` 是 `n²*3+2` 个等可能取值，命中 0 的概率 `1/(3n²+2)`——与任务描述"0 个随从 1/2、1 个 1/5、2 个 1/14、3 个 1/29"完全吻合（`3*0+2=2`、`3*1+2=5`、`3*4+2=14`、`3*9+2=29`）。

**CE 的一个容易漏掉的细节，本轮照搬**：三个分支只要 RNG 判定通过就 `return true`，**不管 `summonMinions` 内部是否真的召到了任何随从**（`hordeID < 0` 时 `summonMinions` 会直接 `return false`，但 `monsterSummons` 的 `return true` 不受影响）。`trySummon` 严格复刻了这个语义——`attempt` 变量只记录"RNG 判定是否通过"，`game.summonMinionsFor(this)` 的返回值**不参与** `trySummon` 的返回值决策：

```ts
if (!attempt) return false;
game.summonMinionsFor(this);
this.endTurnWithAttack();
return true;
```

当前 `hordes.json` 给每个 `MA_CAST_SUMMON` 怪物都配了至少一条匹配的 `HORDE_IS_SUMMONED` 条目（见第一节表格），所以"判定通过但没召到"这个分支在当前数据下**不可达**——但实现没有因为"反正不会发生"而抄近路简化判定本身，一旦以后数据变化（比如新增一只召唤者但忘了配 horde 条目），行为依然与 CE 一致（消耗一次施法机会但不落地任何怪物），不会静默表现成"这只怪物完全不召唤"。

### 2.2 `countMinions`（对应 CE `monsterSummons` 内联的计数段）

```c
if (monst->creatureState == MONSTER_ALLY) {
    if (target->creatureState == MONSTER_ALLY) minionCount++;   // 含 summoner 自己
} else if ((target->bookkeepingFlags & MB_FOLLOWER) && target->leader == monst) {
    minionCount++;
}
```

web：

```ts
export function countMinions(caster: Monster, allMonsters: readonly Monster[]): number {
    if (caster.isAlly) {
        return allMonsters.filter(m => m.isAlly).length;
    }
    return allMonsters.filter(m => m.leader === caster).length;
}
```

`caster.isAlly` 对应 `creatureState == MONSTER_ALLY`；`m.leader === caster` 对应 `MB_FOLLOWER && leader==monst`（web 把这两个 CE 字段合并成一个：只要 `leader` 非 null，就等价于设置了 `MB_FOLLOWER`，因为本项目里这两者只在 `summonMinionsFor`/`spawnHordeAt` 两处联合赋值，从未出现"有 leader 但没有 follower 标记"或反过来的情况）。

**盟友召唤者统计自身这个 CE 怪癖，照搬未"修正"**：CE 的 for 循环遍历包含 summoner 自己在内的所有 creature，`summoner->creatureState==ALLY` 时它自己也满足 `target->creatureState==ALLY`，会把自己算进 `minionCount`。这看起来像是个巧合/怪癖而不是有意设计，但项目规范§5.4 要求"以 CE 为准"，没有理由认为这是 CE 的 bug（游戏里能达成"玩家有召唤能力的盟友"的场景本来就罕见，这个 +1 偏移对平衡影响可忽略），故原样照搬，未做"看起来更合理"的修正。

### 2.3 `summonMinions`（Monsters.c:985）→ `Game.summonMinionsFor`

```
hordeID = pickHordeType(0, summonerType, 0, 0)                  → 见第一节 1.3 的候选构造 + 复用 pickHordeType
if hordeID < 0 return false                                     → horde 为 null 早退
if MA_ENTER_SUMMONS: 从地图移除 summoner                          → this.monsters = this.monsters.filter(m => m !== summoner)
atLeastOneMinion = spawnMinions(hordeID, summoner, true, false)  → 按 horde.members 循环生成
  monst->leader = leader                                         → mon.leader = summoner
  monst->creatureState = leader->creatureState                   → mon.state = summoner.state（web 无独立 creatureState，
                                                                      直接复用四态 MonsterState）
  （ALLY 时 monst->bookkeepingFlags |= MB_DOES_NOT_RESURRECT）    → mon.isAlly = summoner.isAlly（web 无"不复活"机制，isAlly 已是
                                                                      minionCount/阵营判断唯一需要的位）
  monst->ticksUntilTurn = 101                                    → mon.ticksUntilTurn = 101（字面照抄，防止新召的随从本 tick 立即行动）
if HORDE_SUMMONED_AT_DISTANCE: 全图随机、玩家 FOV 外、路径可达的格点     → findSummonAtDistanceLocations + 逐个 teleport
if atLeastOneMinion: 消息 "<summoner> incants darkly!" 或专属文案    → 固定兜底消息（未做"仅可见时才提示"的门，与 P4-1b 的既有简化口径一致）
```

---

## 三、领袖-随从关系的实现方式

见第一节 1.2。`Monster.leader: Monster | null`，由两处赋值：

1. `Game.summonMinionsFor`（本轮新增）——召唤产生的随从。
2. `Game.spawnHordeAt`（本轮补一行）——常规 horde 生成产生的成员。

`countMinions` 是唯一读取方。测试文件的"验收 4：领袖归属"用例直接断言 `spectral_blade.leader === conjurerA`，并验证另一个同类型但不同实例的 `conjurerB` 的 `countMinions` 仍为 0（证明是按实例而不是按类型归属）。

---

## 四、`HORDE_SUMMONED_AT_DISTANCE`（goblin warlord）的落点处理

CE（Monsters.c:1005-1012）：用 `calculateDistances`（Dijkstra，含地形通行代价）从 summoner 位置洪水填充，取路径距离在 `[1, DCOLS/2]` 内、非 `T_PATHING_BLOCKER`、非 `T_HARMFUL_TERRAIN`、且不在玩家 `IN_FIELD_OF_VIEW`/`CLAIRVOYANT_VISIBLE` 内、当前无人无怪的格点池，逐个随从 `randomLocationInGrid` + `teleport`。

web `Game.findSummonAtDistanceLocations`：等权 8 邻域 BFS（每步代价恒为 1，从 summoner 位置出发），步数上限同样是 `Math.floor(DCOLS/2)`，用 `grid.isPassable` 代替 `T_PATHING_BLOCKER`、`TerrainType.LAVA/CHASM` 代替 `T_HARMFUL_TERRAIN`、`cell.isVisible` 代替 `IN_FIELD_OF_VIEW`（web 没有 `CLAIRVOYANT_VISIBLE`/透视这个概念，未模拟，只排除当前 FOV 内的格子）。找到候选池后，对每个待放置的随从各自 `randRange` 随机取一个格点并从池中移除（避免多个随从叠在同一格），与 CE 逐个 `randomLocationInGrid` 后清空该格再找下一个的效果等价。

**已知简化**（如实记录，未调参）：
- Dijkstra 的地形代价（门/水/其它减速地形的通行成本）被等权 BFS 抹平，这会让"路径距离"在含复杂地形的层比 CE 略微失真（BFS 步数≈几何最短路，CE 的路径距离会因地形代价升高）。当前测试没有针对这条做专门断言（任务验收条款里也没有把 AT_DISTANCE 精确落点列为必测项），如实登记为已知偏差。
- CE 失败时（`randomLocationInGrid` 找不到格点，`x=y=-1`）该随从保持在 `getQualifyingPathLocNear` 分配的近身位置不 teleport；web 同理——`findSummonAtDistanceLocations` 返回空池或池耗尽时，多出来的随从保留其"环形扫描"得到的近身出生点，不强行报错。

---

## 五、跨层统计等 CE 有而 web 无对应的简化点

1. **盟友召唤者跨深度统计**（Monsters.c:2432-2445）：CE 对 `MONSTER_ALLY` 召唤者，除了统计当前层还会数 `levels[depthLevel-2]`（上一层）与 `levels[depthLevel]`（下一层，注意 CE 数组下标偏移）里状态为 `MONSTER_ALLY` 且没有 `MONST_WILL_NOT_USE_STAIRS` 的怪物。web 是单层地图模型，其它深度的怪物压根没有被实例化/持久化在内存里，没有对应的数据结构可查——任务描述本身也已经预告"web 无对应可简化并说明"。`countMinions` 的实现只统计 `game.monsters`（当前层），已在函数头注释里说明这条简化，不静默省略。
2. **`MA_ENTER_SUMMONS` 的 `carriedMonster`/`demoteMonsterFromLeadership`**（Monsters.c:1058-1063）：CE 里召唤者被移除地图后并非彻底消失，而是变成新生怪物（host）身上的"乘客"（`host->carriedMonster = summoner`），host 死亡时召唤者会掉出来/以某种方式复活（这套机制服务于"phylactery 变成的 lich 被摧毁后，phylactery 本体仍可能存在"这类设计）。web 没有 `carriedMonster` 概念，也没有对应的死亡处理管线。任务验收条款 3 本身只要求"自身从场上消失、同时出现新怪物"，没有要求这层"日后复活"的机制，故本轮未实现，登记为已知缺口而非静默省略。
3. **`MB_DOES_NOT_RESURRECT`**：CE 给盟友随从打上"不会被复活法术复活"的标记；web 没有复活机制（无对应法术/机制），不需要对应字段，天然一致，不算简化。
4. **`buildAMachine`/`HORDE_MACHINE_ONLY` 相关**：召唤分支的 horde 候选（`HORDE_IS_SUMMONED`）在 `hordes.json` 里都不带 `machine` 字段（核对为 0），本轮召唤路径没有触发"生成配套机关"的需求，未涉及。

---

## 六、反向验证

把 `trySummon` 第三分支的自限概率公式：

```ts
rng.randRange(0, minionCount * minionCount * 3 + 1) === 0
```

改成：

```ts
rng.randPercent(50) /* REVERSE-VALIDATION: 故意改坏成恒定 50% */
```

重跑"验收 2：自限概率"这组用例（`goblin_conjurer`，minionCount=0/1/2/3），输出：

```
 ❯ src/test/p4_2_monster_summoning.test.ts (14 tests | 4 failed | 9 skipped)
     × minionCount=1 时命中率接近 1/5
     × minionCount=2 时命中率接近 1/14
     × minionCount=3 时命中率接近 1/29——随从越多越难再召，不会雪球
     × 命中率随 minionCount 单调递减（对抗恒定概率这类错误实现）

 FAIL  minionCount=1 时命中率接近 1/5
 AssertionError: expected 0.49225 to be less than 0.24
 FAIL  minionCount=2 时命中率接近 1/14
 AssertionError: expected 0.4965 to be less than 0.1
 FAIL  minionCount=3 时命中率接近 1/29——随从越多越难再召，不会雪球
 AssertionError: expected 0.4845 to be less than 0.055
 FAIL  命中率随 minionCount 单调递减（对抗恒定概率这类错误实现）
 AssertionError: expected 0.48433333333333334 to be greater than 0.5273333333333333
```

4/5 条用例应声失败（`minionCount=0` 那条巧合地没有失败——恒定 50% 与"应有的 1/2"数值上刚好重合，这正说明了为什么单独用 `minionCount=0` 一个点做断言不够，必须像本轮这样同时测多个 `minionCount` 点 + 单调性断言才能真正抓住"公式被换成恒定概率"这类错误）。确认测试确实在断言正确的规则后，已改回原公式，`npm test` 复跑回到 336 passed 全绿（见第七节）。

---

## 七、`npm test` 与 `npm run build` 完整输出尾部

### `npx vitest run`（全量）

```
 Test Files  35 passed (35)
      Tests  336 passed | 7 skipped | 5 todo (348)
   Start at  20:38:16
   Duration  14.10s (transform 1.68s, setup 0ms, import 3.97s, tests 44.96s, environment 9ms)
```

322 → 336（新增 14 条，原有 322 条一条未减、一条未改）。`generation_baseline.test.ts` 单独复核：

```
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

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
dist/assets/index-BKEX-kz0.css               17.01 kB │ gzip:   4.10 kB
...
dist/assets/index-CIJwwqlP.js               902.57 kB │ gzip: 286.04 kB

(!) Some chunks are larger than 500 kB after minification. …
✓ built in 1.38s
```

（chunk 体积警告是既有警告，与本轮改动无关。）

### `git diff --stat`

```
 brogue-web/src/engine/Core/Game.ts | 163 +++++++++++++++++++++++++++++++++++++
 brogue-web/src/entities/Monster.ts |  73 +++++++++++++++++
 2 files changed, 236 insertions(+)
```

（`+ src/test/p4_2_monster_summoning.test.ts`、`+ 本报告` 为未跟踪新增文件，不计入上面的 diff --stat；`output/` 目录是会话开始前就存在的未跟踪目录，与本轮无关。）

---

## 八、平衡观测（不作通过条件，如实报告，未调参）

### 方法

`goblin conjurer` 单独一只（`bolts=[]`，只能靠召唤造成压力）放在距玩家 2 格的开阔房间，`abilityFlags` 里手动摘掉/保留 `MA_CAST_SUMMON` 做开关对照，其余（地图、种子、玩家初始状态）完全一致，跑 200 回合，对比玩家承受的伤害与死亡率。这个怪物是最能干净隔离"召唤本身的影响"的样本——它没有 bolts、没有近战突进手段（`MONST_MAINTAINS_DISTANCE`），移除召唤能力后按当前 `takeTurn` 逻辑就是一个完全不会攻击玩家的"摆件"。

### 结果（6 个种子）

```
seed=1 withoutSummon(dmg=0,died=false,count=1) withSummon(dmg=30,died=true,count=6)
seed=2 withoutSummon(dmg=0,died=false,count=1) withSummon(dmg=32,died=true,count=6)
seed=3 withoutSummon(dmg=0,died=false,count=1) withSummon(dmg=30,died=true,count=6)
seed=4 withoutSummon(dmg=0,died=false,count=1) withSummon(dmg=32,died=true,count=4)
seed=5 withoutSummon(dmg=0,died=false,count=1) withSummon(dmg=32,died=true,count=6)
seed=6 withoutSummon(dmg=0,died=false,count=1) withSummon(dmg=33,died=true,count=6)
```

### 如实解读

- **不夸大**：这是一个刻意搭建的隔离场景（单个 goblin conjurer、玩家无法逃跑的开阔房间、200 回合远超正常遭遇时长），不代表玩家在真实地牢遭遇 goblin conjurer 时必死——真实场景里玩家有近战反击、闪避、走廊卡位（conjurer 带 `MA_AVOID_CORRIDORS`，会主动避开走廊）、以及先手攻击等手段，本探针里玩家全程被动挨打不还手。
- **不淡化**：`withoutSummon` 恒为 0 伤害 0 死亡，`withSummon` 6/6 种子全部致死——这清楚地说明"召唤能力"是 goblin conjurer 唯一的伤害来源，也印证了 P4-1b 报告已经指出的方向："这一轮会实质改变深层战斗难度"，本轮（P4-2）延续了同样的结论：对于纯召唤型怪物（goblin conjurer/eldritch totem/phylactery/phoenix egg 均无 bolts、部分甚至无近战威慑），召唤逻辑接入前它们近乎摆件，接入后能独立构成杀死玩家的压力。
- **未调参**：`rand_range(0,7)`/`rand_range(0,n²*3+1)` 的判定概率、`ticksUntilTurn=101`、horde 成员数量范围都是照抄 CE 常量或 `hordes.json` 既有数据，没有为了让数字好看而手动调低召唤概率或随从强度。按项目决策 D1，记录留待二次开发，本轮不因此收窄实现。

---

## 九、验收条款逐条对照

1. **召唤确实发生**：goblin conjurer 反复行动，300 次尝试内场上出现 `spectral_blade`——通过。
2. **自限概率**：goblin conjurer 在 minionCount=0/1/2/3 下，4000 样本命中率分别落在 `(0.45,0.55)`/`(0.16,0.24)`/`(0.045,0.10)`/`(0.015,0.055)`（对应理论值 0.5/0.2/0.0714/0.0345，容差覆盖约 5-10 个标准差）；另加一条"命中率随 minionCount 严格单调递减"的对抗性断言——通过；反向验证见第六节，4/5 条应声失败，确认测试确实在防"恒定概率"这类错误实现。
3. **MA_ENTER_SUMMONS**：phoenix egg → 自身消失 + phoenix 出现；phylactery → 自身消失 + lich 出现；对照组 goblin conjurer（无 `MA_ENTER_SUMMONS`）召唤后自身仍在场——三条全部通过。
4. **领袖归属**：被召唤 spectral blade 的 `leader` 全部指向对应 conjurer 实例；`countMinions` 只统计到该 conjurer 名下，另一个同类型但不同实例的 conjurer 计数仍为 0——通过。
5. **召唤在 bolt 之前**：用 `MONST_ALWAYS_USE_ABILITY` 让判定脱离 RNG，直接验证 lich（有 FIRE bolt）/vampire（有 BLINKING+DISCORD bolt）/ogre shaman（有 HASTE+SPARK bolt）在 `takeTurn` 里优先召唤、`castMonsterBolt` 全程未被调用——三条全部通过。goblin warlord 一并测了（召唤本身正常触发），但其"与 bolt 的优先级"这层断言在 CE 源码层面是空判断——见下方"与预设不符"第 1 条。
6. **反向验证**：见第六节。
7. `npm test` 全绿，322 → **336 passed**（新增 14 条，原有 322 条一条未减）；`npm run build` 全绿——见第七节。
8. **平衡观测**：见第八节，如实报告，未调参。

---

## 十、与预设不符之处（只列不修）

1. **任务描述"同时具备 bolts 与 MA_CAST_SUMMON 的怪物（lich、vampire、ogre shaman、goblin warlord）"这一条，goblin warlord 部分与 CE 源码不符**——核对 `BrogueCE-master/src/brogue/Globals.c:1127-1128`：

   ```c
   {0, "goblin warlord", ..., {0},
       (MONST_MAINTAINS_DISTANCE | MONST_CARRY_ITEM_25), (MA_CAST_SUMMON | MA_ATTACKS_PENETRATE | MA_AVOID_CORRIDORS)},
   ```

   第 8 个字段（bolts 数组）是 `{0}`，即**没有任何 bolt**。真正同时具备 bolts 与 `MA_CAST_SUMMON` 的只有 lich（FIRE）、vampire（BLINKING/DISCORD）、ogre shaman（HASTE/SPARK）三只，`monsters.json` 里 `goblin_warlord.bolts=[]` 是**正确**反映 CE 源码的结果，不是数据缺失。本轮测试文件里为 goblin warlord 保留了一条"召唤本身仍正常触发"的用例，但没有按"优先于 bolt"的口径断言（它本来就没有 bolt 可比较优先级），并在用例里直接断言 `warlordData.bolts` 为空数组，把这条源码依据固化进测试，防止未来有人"顺手"给它加数据时没人发现这与 CE 不符。
2. **任务描述"CE Monsters.c:2418" `monsterSummons` 的伪代码与实际源码逐行核对，除变量名规范化外无实质出入**——提示词给出的伪代码本身相当准确，唯一需要补充的细节是"三个分支命中后统一 `return true`，不管 `summonMinions` 内部是否真的找到了 horde"，提示词的伪代码骨架里省略了这个 `return true` 独立于 `summonMinions` 返回值的细节，本报告第 2.1 节已补充说明并在实现里照做。
3. **`pickHordeType` 是否需要扩展签名**——提示词原话是"需要你查明...需要怎么扩展才能支持召唤分支"，隐含"大概率需要改"的预期；核实后结论是**不需要改**，现有"调用方筛候选 + `pickHordeType` 纯加权抽取"的既有设计天然支持在调用方（`summonMinionsFor`）另起一套筛选逻辑而不触碰 `pickHordeType` 本体，见第一节 1.3。
4. **`spawnHordeAt` 此前从未设置 `leader`，是 P1-2b 遗留、本轮排查 `countMinions` 正确性时顺带发现的既有缺口**——不是提示词描述的问题，但与"随从计数是否准确"这条验收线直接相关，已在本轮一并补上（第一节 1.4），改动范围严格限定在成员生成循环内新增一行赋值，不影响任何既有测试。
