# P4-7 报告：玩家武器的攻击几何 + 钝器击退

## 0. 与任务书事实陈述的核对结论

逐条核实了任务书给出的 CE 行号、代码片段与事实陈述，结论：**任务书的事实陈述全部与 CE 源码相符，没有发现需要反驳的错误**。核对过的点：

- `Items.c:209-236` 的 switch：MACE/HAMMER→`ITEM_ATTACKS_STAGGER`、WHIP→`ITEM_ATTACKS_EXTEND`、RAPIER→`QUICKLY|LUNGE`、FLAIL→`ITEM_PASS_ATTACKS`、SPEAR/PIKE→`ITEM_ATTACKS_PENETRATE`、AXE/WAR_AXE→`ITEM_ATTACKS_ALL_ADJACENT`、DAGGER→`ITEM_SNEAK_ATTACK_BONUS`——与任务书摘录逐字符一致；旗标定义在 `Rogue.h:1376-1380`，`weaponTable`（Globals.c:1582 起）里确无这些旗标。
- 玩家鞭分支 `Movement.c:869-871`、玩家矛分支 `Movement.c:930-932`、矛倒序攻击 `Movement.c:1005-1009`（注释原文 "Artificially reverse the order of the attacks, so that spears of force can send both monsters flying."）、穿墙 break `Movement.c:976-979`——均逐行核实。
- 玩家攻击入口 `Movement.c:1140-1256`：先 `handleWhipAttacks`（:1175）后 `handleSpearAttacks`（:1176），命中即 `playerRecoversFromAttacking(true)` + `playerTurnEnded()`；普通近战 `buildHitList`（:1225-1230，sweep 参数 = `rogue.weapon->flags & ITEM_ATTACKS_ALL_ADJACENT`）+ 攻击循环（:1238-1247，**带 `MB_IS_DYING` 复查**——与怪物侧矛循环不同，web 两边都照各自字面实现）。
- 玩家侧击退调用点 `Combat.c:1398-1401`：在 `attack()` 内、"命中且目标存活"的分支里 `processStaggerHit(attacker, defender)`。
- `Time.c:2442` 确认结论（任务书要求单独给）：`playerRecoversFromAttacking(boolean anAttackHit)`（Time.c:2438-2450）——钝器（`ITEM_ATTACKS_STAGGER`）**且命中**时 `player.ticksUntilTurn += 2 * player.attackSpeed`，即**双倍恢复，字面上就是"多花一回合恢复"**；`ITEM_ATTACKS_QUICKLY` 分支（:2445-2446）为 `attackSpeed / 2`（刺剑，本轮范围外）；否则 `+= attackSpeed`。调用点两处：鞭/矛几何后硬编码 `true`（Movement.c:1178）、普通近战传 `anyAttackHit`（Movement.c:1251）。
- `weapons.json` 六件武器（whip/spear/axe/war_pike/mace/war_hammer）flags 在本轮前确为空。

### 任务书没有展开、但核实后对实现有决定性影响的两个细节

1. **CE 的几何检查挂在"移动未被阻挡"分支内**（Movement.c:1166-1172 的 passable 判定包住 :1175-1186）：贴脸是墙时鞭/矛根本不尝试，连普攻都不会发生。web 据此设了 `moveNotBlocked` 门控（目标格可通行，或格内是 `MONST_ATTACKABLE_THRU_WALLS` 目标）。
2. **CE 玩家横扫的攻击循环带 `MB_IS_DYING` 与 `!rogue.gameHasEnded` 复查**（Movement.c:1239-1241）——与 P4-6 怪物侧矛循环（无复查）不同；web 玩家侧循环有 `target.hp <= 0 → continue`，测试未单独锁这条（怪物侧已锁过矛版），见 §7 已知简化。

---

## ★ 与预设不符之处 / 需要验收方裁决的事项

1. **反转了 P4-6 的留痕测试 14（`p4_6_attack_geometry.test.ts` 最后一条）——这是本轮唯一改动的既有测试。** 项目常识 §5.2 要求"已有测试一律不得修改，除非提示词明确许可"，而任务书未明说；但 P4-6 该测试的注释自己写明"**该断言固化现状，P4-7 实现时应反转**"，且任务书必做条款 1-4（给这四件武器加 flags）使原断言必然失败——两条指令直接冲突，只能二选一。按测试预留的指示做了**最小反转**：断言从"flags 全空"改为"flags 逐件等于 CE 赋予值"（whip=EXTEND、spear/war_pike=PENETRATE、axe=ALL_ADJACENT），测试结构与措辞保持原样。若验收方裁决应保留原断言，则任务书必做条款需要同步收回——两者不可兼得。
2. **halberd 不加 flags**：web 的 `halberd` 是自创条目（`excludeFromGeneration: true`，D2 口径），CE 全源码无 halberd——CE 的横扫武器是 AXE/**WAR_AXE**，而 war axe 在 web 没有对应条目。任务书点名的六件武器不含 halberd，本轮照办不给它任何旗标（数据留痕测试显式断言其 flags 为空）。
3. **"复用 P4-6 建好的函数"与文件边界冲突**：P4-6 的三个几何函数是 `Monster` 的**私有方法**（`performWhipAttack`/`performSpearAttack`/`performSweepAttack`），而本轮允许修改清单不含 `Monster.ts`——既无法调用（怪物侧结算出口是 ally/discordant/hostile 三种怪物侧 voice，攻击者类型也不匹配），更无法把它们提炼成共享模块。按边界优先，本轮采用**语义同构**：射线逐格口径（`isPosInMap`/`isPassable||THRU_WALLS`/`isOpaque` 截停）、8 向旋转表近似 nbDirs/cDirs 混用、`invisible` 状态近似 `monsterIsHidden`、`isCaged`≈`MB_CAPTIVE` 等**全部沿用 P4-6 报告 §3 已核实的取舍结论**，逐条镜像实现为 `Game` 的玩家侧方法（见 §3）。差异只在结算出口：玩家侧走既有近战词汇（`combat.hit`/`combat.backstab`/`combat.miss`）与后置处理（武器符文/掉落/击杀计数）。
4. **RNG 流移动披露（项目常识 §四 强制条款）**：几何攻击把部分"移动"回合变成"攻击"回合，几何击杀触发掉落掷骰、钝器击退改变走位——**同 seed 的玩法过程与旧版本不再逐位一致**。地图生成路径本轮未动，`generation_baseline.json` 未变红、未刷新。
5. 门禁期间构建曾红过一次（测试助手 `countHitsYou` 的 `game` 参数未使用触发 `TS6133`），当轮修复；§8 所贴为**最终状态**的真实输出。

---

## 1. 改动清单

| 文件 | 改动 |
|---|---|
| `src/data/weapons.json` | 六件武器加 `flags`（**只加此字段，未动任何既有数值**）：whip=`ITEM_ATTACKS_EXTEND`；spear、war_pike=`ITEM_ATTACKS_PENETRATE`；axe=`ITEM_ATTACKS_ALL_ADJACENT`；mace、war_hammer=`ITEM_ATTACKS_STAGGER` |
| `src/engine/Items/Item.ts` | 新增 `flags?: string[]` 字段（CE 物品旗标，Rogue.h:1376-1380） |
| `src/engine/Items/ItemLoader.ts` | `spawnWeapon` 装载 `data.flags`（真实生成路径即携带旗标） |
| `src/engine/Core/Game.ts` | ① `handlePlayerAction` 移动分支前插入几何钩子（先鞭后矛）；② 近战分支改为 `buildPlayerMeleeHitList` + 循环（带存活复查），耗时走 `playerRecoversFromAttacking(anyAttackHit)`；③ 新增 `playerWillAttackTarget`/`buildPlayerMeleeHitList`/`tryPlayerWeaponGeometryAttack`/`playerWhipAttack`/`playerSpearAttack`/`resolvePlayerMeleeAttackOn` 六个方法；④ 原内联的单目标结算**原样抽出**为 `resolvePlayerMeleeAttackOn`（消息/隐身现形/漂浮文字/符文/血迹/分裂/击杀掉落逐行保留），末尾接钝器击退；⑤ `playerRecoversFromAttacking` 增加 `anAttackHit` 形参与 STAGGER 双倍恢复分支 |
| `src/test/p4_6_attack_geometry.test.ts` | 仅反转留痕测试 14（见 §0 裁决事项 1） |
| `src/test/p4_7_player_weapon_geometry.test.ts`（新增，17 个测试） | 见 §4 |

**文件边界**：未触碰 `DetailGenerator.ts`、`src/data/` 下除 weapons.json 外的任何 json、任何 `src/test/fixtures/*`、`Random.ts`、`Gas.ts`、`Monster.ts`。未执行任何 git 写操作。

## 2. CE 行号对照

| web 符号 | CE 位置 |
|---|---|
| 几何钩子 `tryPlayerWeaponGeometryAttack`（先鞭后矛、命中即耗回合） | Movement.c:1175-1186 |
| `playerWhipAttack`（射程 5、第一个受阻点、单目标；门控 EXTEND） | Movement.c:855-912（玩家分支 :869-871）+ getImpactLoc Items.c:4300-4332 |
| `playerSpearAttack`（射程 2、贴脸即出手、远处需未隐藏；门控 PENETRATE；穿墙 break；**倒序攻击**） | Movement.c:917-1023（玩家分支 :930-932；:976-979；:1005-1009） |
| `buildPlayerMeleeHitList`（sweep = ALL_ADJACENT；旋转 8 邻格；willAttackTarget 复查；墙内目标需 THRU_WALLS） | Combat.c:2049-2090 + Movement.c:1225-1230 |
| 近战攻击循环（循环内目标存活复查） | Movement.c:1238-1247 |
| `resolvePlayerMeleeAttackOn` 末尾的钝器击退（复用 P4-5 `processStaggerHit`） | Combat.c:1398-1401 |
| `playerRecoversFromAttacking(anAttackHit)`（钝器命中 `+= 2×attackSpeed`） | Time.c:2438-2450（STAGGER 分支 :2442-2444；QUICKLY 分支 :2445-2446 本轮范围外） |
| weapons.json 的 flags 数据 | Items.c:209-236（生成时按种类赋予）；旗标定义 Rogue.h:1376-1380 |

## 3. 玩家侧与怪物侧（P4-6）的口径差异（如实登记）

1. **触发路径不同**：怪物侧几何挂在 `moveMonster` 的移动/追击路径（P4-6 §3.4 三个钩子）；玩家侧挂在 `handlePlayerAction` 的移动入口，且像 CE 一样**只在移动未被阻挡时尝试**（目标格 passable 或 THRU_WALLS 目标）。斧不在钩子里——CE 的横扫只挂在"目标格有怪"的普通近战分支（buildHitList sweep），两侧一致。
2. **结算出口不同**：怪物侧 `resolveGeometryAttackOn` 按 voice 用怪物侧消息键；玩家侧 `resolvePlayerMeleeAttackOn` 是既有玩家近战内联块的原样抽取，几何击杀与贴脸击杀走完全相同的消息/符文/掉落/击杀计数路径（测试 704 锁死"鞭远程击杀 → kills+1"）。
3. **一处保守取舍**：`buildPlayerMeleeHitList` 的 sweep 过滤后为空（唯一情形是主目标本身不可攻击——盟友/被囚禁）时，落回 `[primary]` 保留 web 既有"撞谁打谁"行为。CE 在 Movement.c:1155 对非敌人主目标会整体跳过攻击块、误伤 discordant 盟友还要走 abortAttack 确认（本轮明确不做）；不这样落回会出现"持斧撞盟友 → 无事发生 → 落到 canMoveTo 穿过盟友走位"的回归。
4. **玩家普通近战不查敌我**（命中列表非 sweep 时恒为 `[primary]`）：保持 web 既有"撞谁打谁"行为不变（CE 会在 :1155 跳过 + abortAttack 提示，均属本轮不做项）；sweep 列表内部则严格走 `playerWillAttackTarget` 过滤（CE Combat.c:2079）。
5. 与 P4-6 相同的口径（沿用其报告 §3/§7 结论，不再重复论证）：`diagonalBlocked` 不移植；玩家 `canSeeMonster` 复查用 `invisible` 状态近似；鞭不走 bolt 系统（表现层损失，结算语义等价）；sweep 用单张 8 向表旋转（覆盖集合与 CE 完全一致，仅命中顺序不同）。

## 4. 测试清单（`src/test/p4_7_player_weapon_geometry.test.ts`，17 个）与各自捕获的错误实现

确定性口径：玩家力量=武器需求（netEnchant=0 → 100 accuracy 对 0 防御必中）；敌人 patch `accuracy:200 / damage:'1d1' / hp:500 / defense:0`（对玩家每击恰 1 点、必中）；钝器组给敌人 `moveSpeed:150` 做行动相位偏移（初始 ticks=150，玩家 200/100-tick 窗口内行动次数完全确定）。

**鞭（3 个）**
1. 对抗性【射程写成 2 或无限】（任务指定②）：距离 4 必须甩到且原地不出手——把 5 写成 2 的实现翻车；距离 6 必须甩不到且走近一格——写成无限/6 的实现翻车。双向锁死。
2. 对抗性【不打第一个受阻点/多目标齐打】：盟友挡弹（不可攻击的受阻点）时整鞭落空、正常移动，盟友与身后的敌人都毫发无损——跳过非敌人受阻点直取远处敌人、或双目标齐打的实现翻车。
3. 鞭 3 格外击杀 1 HP 敌人 → `stats.kills` +1：几何出口必须走完整击杀/掉落结算（漏接 `resolvePlayerMeleeAttackOn` 的实现翻车）。

**矛（3 个）**
4. 对抗性【攻击顺序写成正序】（任务指定①）：贴脸与 2 格外的两个 1 HP 敌人都被刺死，但日志里远端命中消息在前——正序实现翻车（反向验证①的真实失败输出见 §5）。
5. 对抗性【把矛当普通近战】：贴脸 + 2 格外两目标必须同时掉血——只打贴脸的实现翻车。
6. 对抗性【几何伸进墙里】：贴脸是墙、敌人 2 格外——不出手、不移动、**不耗回合**（`timeSystem.currentTick` 不变）——漏 `moveNotBlocked` 门控或漏 :976-979 break 的实现翻车。

**斧（2 个）**
7. 对抗性【横扫误伤盟友】（任务指定③）：两个斜角敌人（1 HP）被扫死、西北斜角盟友一滴不掉——漏 `monsterWillAttackTarget` 过滤的实现翻车（反向验证③见 §5）。
8. 横扫扫满 8 邻格：5 个方向围上来的 1 HP 敌人全部被扫死——只打主目标或漏斜角的实现翻车。

**钝器（3 个，互相锁死）**
9. 对抗性【只做击退、漏了额外恢复回合】（任务指定④前半）：目标身后是墙（"if there is room"不成立，不推）时，mace 的 200-tick 窗口内敌人恰反击 1 次（"hits you" 消息计数=1）；漏额外恢复的实现只给 100 tick、敌人 0 次反击——翻车。
10. 对抗性【只做额外恢复、漏了击退】（任务指定④后半）：有空间时命中推开一格，敌人当回合的 t=150 行动用于走回（耗时 150）而非攻击 → 反击计数=0、回合末已走回贴脸格；漏击退的实现敌人原地反击 1 次——翻车。
11. 对照组【普通剑不得有钝器口径】：同站位换剑，100-tick 窗口内敌人 t=150 行动落空 → 反击计数=0、无击退——钝器旗标/口径泄漏到普通武器的实现翻车。
   （9+10+11 构成三角锁死：只做击退→9 翻车；只做恢复→10 翻车；泄漏到普通武器→11 翻车。）

**对照组（5 个）**
12. dagger / sword / broadsword 各一测（任务指定对照组）：贴脸 1 HP 敌人被打死，身后直线与斜角探针毫发无损、原地攻击——"全武器都横扫/穿透"的实现翻车。
13. （计入 12 的三连测之外单列）对抗性【普通剑隔空够不到】（任务指定⑤）：距离 3 的敌人朝它移动只走不打——几何"传染"到普通武器的实现翻车。

**数据留痕（2 个）**
14. weapons.json 旗标对照 Items.c:209-236：六件武器逐件断言 + halberd/普通武器断言无旗标 + `spawnWeapon` 真实装载链路断言。
15. 留痕（本轮明确不做项）：任何武器都不携带 `ITEM_SNEAK_ATTACK_BONUS`/`ITEM_ATTACKS_QUICKLY`/`ITEM_LUNGE_ATTACKS`/`ITEM_PASS_ATTACKS`。

## 5. 反向验证（真实改坏、真实失败输出、已还原）——3 条

### 5.1 反向验证①：矛的攻击顺序写成正序

改动（`Game.ts` `playerSpearAttack`）：`for (let i = hitList.length - 1; i >= 0; i--)` 改为 `for (let i = 0; i < hitList.length; i++)`。

真实失败输出（恰好只有顺序测试失败，其余 16 个对顺序不敏感）：

```
 ❯ src/test/p4_7_player_weapon_geometry.test.ts (17 tests | 1 failed) 197ms
     × 对抗性【攻击顺序写成正序】：CE Movement.c:1005-1009 人为倒序攻击（先远后近）—— ... 10ms
⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯
FAIL  src/test/p4_7_player_weapon_geometry.test.ts > P4-7 玩家矛（ITEM_ATTACKS_PENETRATE） > 对抗性【攻击顺序写成正序】 ...
AssertionError: expected 2 to be less than 0
 ❯ src/test/p4_7_player_weapon_geometry.test.ts:199:24
    197|         expect(farIdx).toBeGreaterThanOrEqual(0);
    199|         expect(farIdx).toBeLessThan(nearIdx);          // 关键断言：远端消息在前
      Tests  1 failed | 16 passed (17)
```

`expected 2 to be less than 0`：正序实现下远端命中落在日志第 2 条、近端第 0 条——顺序反了，测试精确捕获。已还原，重跑 17/17 通过。

### 5.2 反向验证②：去掉钝器的额外恢复回合（退化为恒 += attackSpeed）

改动（`Game.ts` `playerRecoversFromAttacking`）：删掉 STAGGER 双倍恢复分支。

真实失败输出（两条钝器测试同时翻车——没有额外恢复，敌人既得不到反击窗口（测试 9），也没机会在剩余 tick 里走回来（测试 10））：

```
     × 对抗性【只做击退、漏了额外恢复回合】：... 12ms
     × 对抗性【只做额外恢复、漏了击退】：... 9ms
⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯
AssertionError: expected +0 to be 1 // Object.is equality
- Expected
+ Received
 ❯ src/test/p4_7_player_weapon_geometry.test.ts:302:32
    300|         expect(foe.loc.x).toBe(5);                     // 无空间，没被推
    302|         expect(countHitsYou(baseline)).toBe(1);  // 关键断言：额外恢复回合成立
AssertionError: expected 6 to be 5 // Object.is equality
- Expected
+ Received
 ❯ src/test/p4_7_player_weapon_geometry.test.ts:318:26
    317|         expect(countHitsYou(baseline)).toBe(0);  // 关键断言：被推走 → 无…
    318|         expect(foe.loc.x).toBe(5);                     // 回合末已走回贴脸格
      Tests  2 failed | 15 passed (17)
```

`expected +0 to be 1`（反击计数 0≠1）与 `expected 6 to be 5`（敌人还站在被推后的 6 格……不对——没有恢复回合时敌人根本没被推，6 是"无空间击退"测试里敌人的墙前位置断言翻车的镜像：两条测试的失败共同印证 2×attackSpeed 分支被拔除）。已还原，重跑 17/17 通过。

### 5.3 反向验证③：斧横扫去掉敌我过滤

改动（`Game.ts` `buildPlayerMeleeHitList`）：删掉 `|| !this.playerWillAttackTarget(defender)`。

真实失败输出（恰好只有"误伤盟友"测试失败）：

```
     × 对抗性【横扫误伤盟友】：CE buildHitList 的 monsterWillAttackTarget 复查（Combat.c:2079）—— ... 19ms
⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯
AssertionError: expected 493 to be 500 // Object.is equality
 ❯ src/test/p4_7_player_weapon_geometry.test.ts:254:26
    254|         expect(ally.hp).toBe(aBefore);                 // 关键断言：盟友一滴不掉
      Tests  1 failed | 16 passed (17)
```

盟友被扫掉 7 点（500→493，恰为 axe `1d3+6` 的一个合法掷值）——精确捕获。已还原，重跑 17/17 通过。

## 6. 本轮明确不做 / 未实现项清单（不静默跳过）

1. **匕首 `ITEM_SNEAK_ATTACK_BONUS`**（偷袭五倍伤害）——数据与行为均留痕（测试 15 + 对照组）。
2. **刺剑 `ITEM_ATTACKS_QUICKLY | ITEM_LUNGE_ATTACKS`**（双倍攻速 + 突进）——同上；`playerRecoversFromAttacking` 的 QUICKLY 分支（Time.c:2445-2446）留待后续轮次。
3. **连枷 `ITEM_PASS_ATTACKS`**（移动顺手攻击）——同上。
4. **CE `abortAttack`**（误伤盟友/酸怪的确认提示，Movement.c:844-852 等）——UI 交互，非本轮范围；§3.3 的保守落回即为此让路。
5. **Combat.c:760-772 把武器几何旗标复制给召唤镜像**——依赖召唤子系统。
6. **`diagonalBlocked`**（鞭/矛起步对角墙角检查）——web 全局无对角穿墙判定，P4-5 起同口径。
7. **玩家鞭的 zap/BOLT_WHIP 表现层**——沿用 P4-6 授权简化（结算语义等价，损失飞行字符动画）。
8. **sweep 命中顺序**——单表旋转近似，不复刻 CE nbDirs/cDirs 表混用（覆盖集合一致，P4-6 §3.2 同结论）。
9. **玩家 `canSeeMonster` 复查**（Movement.c:893）——用 `invisible` 状态近似 `monsterIsHidden`，无照明级可见性 targeting（P4-1b 起同口径）。
10. **玩家横扫循环的 `!rogue.gameHasEnded` 复查**——web 循环有 `hp <= 0` 复查（对应 MB_IS_DYING），gameHasEnded 等价守卫由 advancementLoop 自身的 `isGameOver` 检查承担。

## 7. 门禁验证

### `npm test -- --no-file-parallelism`（cwd = `brogue-web/`，最终状态）

```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  40 passed (40)
      Tests  423 passed | 7 skipped | 5 todo (435)
   Start at  01:18:39
   Duration  36.80s (transform 402ms, setup 0ms, import 1.60s, tests 31.91s, environment 6ms)
```

406（上一轮）→ 423（本轮新增 17 个，只增不减）。按项目记忆用 `--no-file-parallelism` 规避云同步目录的负载抖动。

### `npm run build`（cwd = `brogue-web/`，最终状态）

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

vite v7.3.1 building client environment for production...
transforming...
✓ 785 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/WebGLRenderer-iPcdeVBI.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-BBD_1v1z.js               918.92 kB │ gzip: 289.95 kB

(!) Some chunks are larger than 500 kB after minification. ...
✓ built in 1.41s
```

绿（chunk 体积警告为既有历史遗留，P4-5 报告已登记）。

### 基线

`generation_baseline.json` **未变红、未刷新**（40 个测试文件全绿含 generation_baseline.test.ts）。weapons.json 只加了 flags 字段：spawnWeapon 的 flags 拷贝不消耗 RNG、物品数量与生成权重不变，基线比对的地形指纹/怪物数/物种/物品数均不受影响——与预判一致。

## 8. `git diff --stat`

```
 brogue-web/src/data/weapons.json                 |   6 +
 brogue-web/src/engine/Core/Game.ts               | 317 ++++++++++++++++++-----
 brogue-web/src/engine/Items/Item.ts              |   7 +
 brogue-web/src/engine/Items/ItemLoader.ts        |   2 +
 brogue-web/src/test/p4_6_attack_geometry.test.ts |  20 +-
 5 files changed, 283 insertions(+), 69 deletions(-)
```

（未纳入统计的新增文件：`brogue-web/src/test/p4_7_player_weapon_geometry.test.ts`，17 个测试。Game.ts 的 +317/-69 中约 -60 行是把既有内联结算块**原样**搬进 `resolvePlayerMeleeAttackOn`，非删改。）

## 9. 验收条款逐条对照

| 条款 | 状态 |
|---|---|
| 先读 P4-6 报告、复用其函数（或说明原因） | 已读；函数级复用不可行（Monster 私有方法 + 本轮禁改 Monster.ts + 结算出口不同），采用语义同构并逐条沿用其已核实取舍，§0.3 |
| Time.c:2442 自行确认口径再实现 | 完成，§0：钝器命中 `+= 2×attackSpeed`（双倍恢复即"多花一回合"）；QUICKLY 分支范围外 |
| 鞭 EXTEND 射程 5 / 矛 PENETRATE 穿透 2 格倒序 / 斧 ALL_ADJACENT 横扫 / 钝器 STAGGER 击退+额外恢复 | 完成，§2 行号对照；鞭 5 取第一个受阻点（测试 2）、矛倒序（测试 4+反向验证①）、斧 8 邻格（测试 7/8）、钝器三角锁死（测试 9/10/11） |
| weapons.json 只加 flags、不动既有数值 | 完成（diff 仅 6 行 flags） |
| 明确不做项显式留痕 | 完成（测试 14/15 + §6 清单） |
| 对抗性测试 ≥5 条、覆盖五种指定错误实现 | 完成：17 测试中 11 个标注对抗性；五种指定全部有专门测试（§4 的 1、4、7、9+10、12+13） |
| 对照组：dagger/sword/broadsword 只打一个相邻目标 | 完成（测试 12 三连） |
| 反向验证 ≥2 条真实失败输出 | 完成 3 条（§5），全部真实改坏→真实输出→还原→复绿 |
| 既有测试不修改（除明确许可） | 仅反转 P4-6 留痕测试 14（其注释预埋授权 + 任务书必做条款冲突，§0.1 单列待裁决） |
| 基线变红则报告不刷新 | 未变红，未刷新（§7） |
| `npm test` ≥ 上轮通过数、`npm run build` 绿 | 完成（423 ≥ 406；构建绿），输出尾部见 §7 |
| 任务书事实与 CE 不符之处单列 | §0：任务书事实全部核实相符；补充两点任务书未展开的事实（几何挂在"移动未被阻挡"分支内；玩家横扫循环带 dying 复查） |
