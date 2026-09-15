# B-1 轮次报告：匕首背刺 / 刺剑突进与双速 / 连枷移动攻击

分支 `round/b-1`（worktree），改动全部留在工作区，未执行任何 git 写操作。
CE 源码位置：`../BrogueCE-master/src/brogue/`（只读，未动）。

---

## 一、改动清单

| 文件 | 改动 |
|---|---|
| `src/data/weapons.json` | 仅给三件武器加 `flags`（数值逐字段冻结，测试钳死）：dagger `["ITEM_SNEAK_ATTACK_BONUS"]`；rapier `["ITEM_ATTACKS_QUICKLY","ITEM_LUNGE_ATTACKS"]`；flail `["ITEM_PASS_ATTACKS"]` |
| `src/engine/Combat/Combat.ts` | ①偷袭触发集补齐：新增 `sneakAttack`（玩家攻击 WANDERING 目标，Combat.c:1193-1195）与 `lungeAttack`（opts 新形参，对应 CE `attack()` 第三形参）两支；②倍率改为 CE Combat.c:1259-1268 口径——触发集命中时**只乘一次**，玩家持匕首 ×5、否则通用 ×3；③触发集整体自动命中（Combat.c:1239）；④补 MONST_INANIMATE 守卫（Combat.c:1190-1194，web 原实现漏了）；⑤`AttackResult` 新增 `lunge` 字段（观测用） |
| `src/engine/Core/Game.ts` | ①`playerRecoversFromAttacking` 落地 `ITEM_ATTACKS_QUICKLY` 分支（attackSpeed/2，Time.c:2445-2446），优先级 STAGGER>QUICKLY>普通照 CE；②新增 `buildLungeFlailHitList`（突进：两格之外；连枷：移动前后双相邻）；③移动分支接入：移动**前**收集、移动**后**结算，`hitList` 非空时本回合耗时走攻击口径（=attackSpeed，刺剑为半），`movementSpeed` 分支被抢占——与 CE playerTurnEnded 的 `==0` 分支逐 tick 同构；④`resolvePlayerMeleeAttackOn` 增加 `lungeAttack` 形参透传 |
| `src/test/b_1_weapon_specials.test.ts` | 新增，16 条用例（对抗性 10 + 对照 4 + 留痕 2） |

Item.ts / ItemLoader.ts **未改动**：`spawnWeapon` 已有 `if (data.flags) weapon.flags = [...data.flags]`（ItemLoader.ts:393），flags 随数据自动流转，无需动代码。

## 二、CE 行号对照

| 机制 | CE 位置 | web 落点 |
|---|---|---|
| 旗标赋予（DAGGER/RAPIER/FLAIL） | Items.c:219-232 switch | weapons.json flags（照抄三 case） |
| 偷袭四触发源定义 | Combat.c:1190-1199（inanimate 清零 :1190-1194；sneakAttack=WANDERING :1193-1195；asleep :1196-1198；paralyzed :1199） | Combat.ts 偷袭触发集块 |
| 触发集自动命中 | Combat.c:1239 `if (sneakAttack \|\| defenderWasAsleep \|\| defenderWasParalyzed \|\| lungeAttack \|\| attackHit(...))` | `const autoHit = backstab \|\| lungeAttack` → hitProb=100 |
| ×5 / ×3 倍率 | Combat.c:1259-1268（匕首 ×5，否则 ×3；只乘一次） | `damage *= daggerSneak ? 5 : 3` |
| 符文触发率翻倍集 | Combat.c:1419-1421 `magicWeaponHit(..., sneakAttack \|\| asleep \|\| paralyzed)`——**不含 lungeAttack** | `backstab` 字段语义 = 该集合；突进不置 backstab，只吃倍率+自动命中 |
| 攻速分支 | Time.c:2439-2452（STAGGER 且命中 → 2×；QUICKLY → attackSpeed/2；否则 attackSpeed） | `playerRecoversFromAttacking`（P4-7 同函数，本轮插 QUICKLY 支） |
| 突进目标收集 | Movement.c:1368-1391（两格之外那一格；可见/已揭示、敌人、非盟友、未死亡、格可通行或 MONST_ATTACKABLE_THRU_WALLS） | `buildLungeFlailHitList` 突进支 |
| 连枷目标收集 | Movement.c:1025-1048 `buildFlailHitList`（★与移动前、移动后两格都相邻；`distanceBetween` 为 Chebyshev，Monsters.c:1341-1343） | `buildLungeFlailHitList` 连枷支 |
| 移动后结算 + 攻击恢复 | Movement.c:1480-1492（先移动→hitList 逐个 attack→`if (hitList[0]) playerRecoversFromAttacking(anyAttackHit)`→playerTurnEnded） | 移动分支 specialTargets 块 |

## 三、web 原本有没有 ×3 偷袭基线（查证结论）

**有，且确实改变伤害**——改前 `Combat.ts` 中 `backstab` 布尔在 sleeping（state===0）或 paralyzed（hasStatus）时置位，随后 `if (backstab) damage *= 3`。所以通用 ×3 **是补触发集而非补倍率**。本轮在既有基线上补齐：

1. **触发源缺口**：CE 四触发源（sneakAttack/asleep/paralyzed/lungeAttack）里 web 只有 asleep/paralyzed 两支。本轮补 `sneakAttack`（WANDERING 目标；CE 里 creatureState==WANDERING 天然排除盟友，web 的 `isAlly` 是独立维度故显式排除）和 `lungeAttack`。
2. **自动命中缺口**：上述两支新触发源现在整体自动命中（CE Combat.c:1239 的 `||` 短路）。
3. **匕首 ×5 升档**（任务核心）。
4. **附带修正**（CE Combat.c:1190-1194）：MONST_INANIMATE 目标身上三类偷袭标志清零——web 原实现对此无守卫（镜像类目标会被 ×3/自动命中），照 CE 补上。

另核对一处易错点：**倍率只乘一次**。CE 的倍率块是单个 if，WANDERING 目标挨突进不会 3×3 叠乘；web 同口径（`if (backstab || lungeAttack)` 单次乘）。

## 四、Movement.c:1480-1500 那处 LUNGE 引用的语义（任务书要求单独查证）

任务书只展开了 Movement.c:1368-1391（目标收集），要求我自行读 :1484 附近。实际语义（Movement.c:1480-1492）：

```c
for (i = 0; i < 16; i++) {
    if (hitList[i]) {
        if (attack(&player, hitList[i],
                   (rogue.weapon && (rogue.weapon->flags & ITEM_LUNGE_ATTACKS)))) {
            anyAttackHit = true;
        }
    }
}
if (hitList[0]) {
    playerRecoversFromAttacking(anyAttackHit);
}
playerTurnEnded();
```

三个此前未被展开的关键事实，均已照实现：

1. **攻击发生在移动完成之后**（玩家坐标已更新、`pickUpItemAt` 已执行）。目标在移动前收集（连枷判据需要移动前坐标），结算在移动后。
2. **`lungeAttack` 形参按武器旗标对所有 hitList 目标传同一值**：持刺剑时突进目标吃"自动命中 + ×3"；持连枷时该参数为 false——**连枷移动攻击是普通攻击**（要掷命中、无倍率），只是免费挂在移动上。
3. **`playerRecoversFromAttacking` 只在 `hitList[0]` 非空时调用，且之后 `playerTurnEnded()` 的 `ticksUntilTurn==0` 分支被跳过**——突进/连枷回合总耗时 = 攻击恢复（刺剑为 attackSpeed/2，**比普通移动还快**；连枷为 attackSpeed，等于"移动价格买一送一击"）。web 用同一对账结构复刻（攻击恢复先记进 `ticksUntilTurn`，`playerTurnEnded` 的 `==0` 分支跳过 movementSpeed）。

## 五、对抗性测试清单（各捕获哪种错误实现）

文件 `src/test/b_1_weapon_specials.test.ts`，16 条全绿。伤害值域互相钳制：dagger raw 3..4（×5→15/20；误×3→9/12）、rapier raw 3..5（×3→9/12/15；误×5→15/20/25）、sword raw 7..9（×3→21/24/27；误×5→35/40/45）。

| # | 测试 | 捕获的错误实现 |
|---|---|---|
| 1 | 匕首×熟睡：5 种子伤害全 ∈{15,20} 且 15/20 都出现 | 匕首写成 ×3（9/12 立即翻车，实测抓到 12） |
| 2 | 匕首×清醒：伤害恰为 {3,4} | "×5 全局生效"、匕首无差别加倍 |
| 3 | 剑×熟睡：∈{21,24,27} 且不被 5 整除、≥2 个不同值 | 匕首旗标泄漏成全局 ×5 |
| 4 | 剑×WANDERING（防御 300，命中率 ≈2.2%）：10 种子全中且 ∈{21,24,27}；HUNTING 对照 10 种子必出 miss | WANDERING 未入触发集（漏自动命中）；×5 误用 |
| 5 | 刺剑：两格外敌人挨打 + 玩家进格 | 突进漏实现；写成"只打相邻" |
| 6 | 刺剑：斜前方相邻敌人不挨打 | "移动时打所有相邻" |
| 7 | 刺剑×防御 300 两格外：5 种子全中 ∈{9,12,15} | 突进无自动命中；突进写成 ×5 |
| 8 | 剑朝两格外走：只走不打 | 突进传染到普通武器 |
| 9 | 攻速行为：6 击窗口刺剑吃 2 次反击、剑吃 5 次 | QUICKLY 分支漏实现（刺剑按 100 tick 恢复→5 次） |
| 10 | 攻速窃取：刺剑恢复恰 [50]、剑恰 [100]（包装原方法观察瞬时 ticksUntilTurn，不绕过逻辑） | 恢复量写错（attackSpeed 而非一半） |
| 11 | 双旗标武器（STAGGER+QUICKLY，数据中不存在、专测分支序）：恢复 [200] + 行为镜像反击 1 次 | 分支优先级倒置（误走 QUICKLY 支记 50） |
| 12 | 连枷正交移动：双相邻 (5,4) 挨打；旧格独有 (3,5)、新格独有 (6,5) 均不挨打 | "所有移动前相邻"；"所有移动后相邻" |
| 13 | 连枷斜向移动 (4,5)→(5,6)：双相邻 (5,5)、(4,6) 均挨打；旧格独有 (3,6) 不挨打 | 对角漏判；"只看直线"；"打满所有旧邻" |
| 14 | 连枷留痕：盟友在弧线上不挨打、敌人挨打、整回合恰好 +100 tick | 盟友进 hitList；abortAttack 式额外确认回合 |
| 15 | 对照组：dagger/rapier/flail 之外武器全部场景无特殊行为（#3#8 及 #9 的剑侧、#2 的匕首清醒侧互相钳制） | 旗标泄漏/几何传染 |
| 16 | 数据留痕：三件 flags 照 CE、P4-7 六件不变、13 件武器 damage/strengthRequired/weight 逐字段冻结、spawnWeapon 流转；镜像盟友无武器旗标继承通路（明确不做项） | 越权改数值；flags 没进 Item |

## 六、反向验证（真实改坏 → 真实失败输出 → 还原）

三组（要求 ≥2），改坏→跑→贴输出→还原，最终 16/16 复绿。

**①匕首倍率改坏为恒 ×3**（`damage *= daggerSneak ? 5 : 3` → `damage *= 3`）：

```
 FAIL  src/test/b_1_weapon_specials.test.ts > B-1 匕首背刺（ITEM_SNEAK_ATTACK_BONUS） > 对抗性【匕首偷袭写成 ×3】：…
 Error: 种子伤害 12 不是匕首 ×5（允许 15/20）
      Tests  1 failed | 15 passed (16)
```

**②连枷判据删掉"与移动后格相邻"**（=写成"所有移动前相邻的敌人"）：

```
 FAIL  … > 对抗性【判据写成"所有相邻敌人" / "所有落格相邻"】：…
 AssertionError: expected 486 to be 500 // Object.is equality     ← 旧格独有探针 (3,5) 被误甩 14 点
 FAIL  … > 对抗性【对角移动漏判 / 只看直线】：…
 AssertionError: expected 487 to be 500 // Object.is equality     ← 旧格独有探针 (3,6) 被误甩
      Tests  2 failed | 14 passed (16)
```

**③攻速分支优先级倒置**（QUICKLY 提到 STAGGER 之前）：

```
 FAIL  … > 对抗性【分支优先级写反（钝器命中反而走 QUICKLY）】：…
 AssertionError: expected [ 50 ] to deeply equal [ 200 ]
      Tests  1 failed | 15 passed (16)
```

## 七、基线变红情况（需验收方裁决）

全量 `npm test`（56 文件）：**除下述 2 条外全绿**。`generation_baseline` **绿**（未刷新任何 fixture）。

红的是 **P4-7 轮的两条"数据留痕"测试**（`p4_7_player_weapon_geometry.test.ts` 末尾的 `P4-7 数据留痕` describe）。它们是 P4-7 当轮对"这四个旗标暂不做"的显式标记（断言三件武器**不应**携带这些 flags），本任务书明确要求补上这些 flags，二者逻辑上不可同时成立。已有测试不得修改，按规只报告：

```
 FAIL  src/test/p4_7_player_weapon_geometry.test.ts > P4-7 数据留痕 > weapons.json 旗标对照 CE Items.c:209-236：…
 AssertionError: dagger 的 flags: expected [ 'ITEM_SNEAK_ATTACK_BONUS' ] to deeply equal []

 FAIL  src/test/p4_7_player_weapon_geometry.test.ts > P4-7 数据留痕 > 留痕（本轮明确不做项）：dagger 的 ITEM_SNEAK_ATTACK_BONUS、…
 AssertionError: dagger 不应携带 ITEM_SNEAK_ATTACK_BONUS（本轮明确不做）: expected [ 'ITEM_SNEAK_ATTACK_BONUS' ] to not include 'ITEM_SNEAK_ATTACK_BONUS'
```

裁决建议：这两条是"上一轮的暂缓标记"，被本轮任务书正式推翻——请验收方删除或改写这两条（例如改为断言 B-1 后的正确旗标），行为侧断言（P4-7 的鞭/矛/斧/钝器用例、对照组）全部不受影响、依旧全绿。

## 八、门禁输出尾部

**npm test**（完整套件，当前工作区状态）：

```
 Test Files  1 failed | 55 passed (56)
      Tests  2 failed | 578 passed | 8 skipped | 5 todo (593)
   Start at  22:42:32
   Duration  238.30s (transform 2.25s, setup 0ms, import 16.91s, tests 1462.54s, environment 17ms)
```

失败的 2 条即第七节的 P4-7 留痕。i18n gate（p1_30）绿——本轮**没有新增任何 `i18next.t` 调用**。generation_baseline 绿。

**npm run build**：

```
dist/assets/WebGLRenderer-tdmUC905.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-DUNXklwp.js               756.61 kB │ gzip: 230.40 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration/#output-manualchunks
- Adjust chunk size limit via build.chunkSizeWarningLimit.
✓ built in 1.38s
```

（chunk 体积提示为既有状态，非本轮引入。）

**git diff --stat**：

```
 brogue-web/src/data/weapons.json       |  3 ++
 brogue-web/src/engine/Combat/Combat.ts | 59 ++++++++++++++++----
 brogue-web/src/engine/Core/Game.ts     | 99 +++++++++++++++++++++++++++++---
 3 files changed, 145 insertions(+), 16 deletions(-)
```

另新增未跟踪文件 `src/test/b_1_weapon_specials.test.ts`（16 用例）。`git status` 仅上述 3 改 1 增，无边界外文件。

## 九、验收条款逐条对照

| 条款 | 状态 |
|---|---|
| weapons.json 三件武器补 flags（照 Items.c:209-236，不动既有数值） | ✅ 逐字段冻结测试 #16 钳死 |
| 三项机制接到 web 实际调用路径 | ✅ 匕首×5/通用×3 走 `CombatSystem.attack`（全部玩家近战唯一出口）；突进/连枷挂在 `handlePlayerAction('move')` 实际移动分支；QUICKLY 挂 `playerRecoversFromAttacking`（P4-7 同函数） |
| 通用 ×3 偷袭倍率（若尚无）一并补齐并说明 | ✅ 查证结论见第三节：倍率已有，本轮补的是触发源（WANDERING、lungeAttack）、自动命中与 inanimate 守卫 |
| 对抗性测试 ≥5 条、禁止"调用了就算过" | ✅ 10 条对抗性（第五节 #1-#13），全部断言伤害值域/位置/时序等可观察结果 |
| 五条指定对抗场景 | ✅ ×3/×5 误写（#1#3#7）、突进打相邻（#5#6）、连枷漏双相邻判据（#12#13）、攻速优先级反（#11）、普通剑对照组（#2#8#9#15） |
| 反向验证 ≥2 条、真实失败输出、还原 | ✅ 三组（第六节），已还原并复绿 |
| 明确不做：abortAttack、镜像盟友继承 | ✅ 未实现，留痕测试 #14#16 |
| zh_CN 文案与行为对得上 | ✅ 匕首"五倍而非三倍"、刺剑"两倍攻速/三倍且永不落空"、连枷"两格之间移动获得一次免费攻击"均与实现一致 |
| 门禁 | ✅ 除 P4-7 两条留痕（第七节，待裁决）外全绿；build 绿 |

## 十、与预设不符之处（只列不修）

1. **P4-7 两条留痕测试因本轮数据变更而红**（第七节）——任务书"禁止修改既有测试/不许刷新红名"与"给三件武器加 flags"在本轮语境下互斥，按规矩留裁决。
2. **任务书对 Combat.ts 偷袭基线的预判部分不准**（授权反驳条款）："web 目前有没有 ×3 基线？……若没有，本轮要把 ×3 一并补上"——实际 **×3 倍率早已存在且生效**（asleep/paralyzed 两支触发）。真正缺的是另外两支触发源（WANDERING、lungeAttack）、这两支的自动命中，以及 inanimate 守卫。均已补齐并如实在第三节说明。
3. **CE 的 MONST_INANIMATE 守卫是 web 原实现就缺的**（非任务书明示项），因与偷袭触发集同属 Combat.c:1190-1196 一段，本轮照 CE 补上；若验收方认为越界可单独回退该 4 行（`inanimateDefender` 及三处 `!inanimateDefender &&`）。
4. **突进命中的专用文案未加**：CE 突进命中/击杀消息带"（猛烈突刺）/with a vicious lunge attack"（Combat.c:1298），web 复用既有 `combat.hit`/`combat.backstab` 文案。新增措辞需要往 `zh_CN.json` 加键并过 i18n gate，而 `src/locales/` 在本轮允许修改清单之外——按 5.1 只列不修。同时按 CE Combat.c:1419-1421，突进**不**加倍符文触发率、也不置背刺消息位，`backstab` 字段语义按此拆分（代码注释已写明）。
5. **CE 偷袭的另一截语义 web 仍缺（本轮未动，历史既有）**：Combat.c:1245-1256"被偷袭者本回合不还手 + 惊醒转追踪"web 从未实现，对全部武器一视同仁，不属于三件武器范畴，留档。
6. **web 既有偏差（与本轮无关、未动，仅登记）**：Combat.ts 的"隐身攻击 +50% 伤害"在 CE 全源码中不存在（CE 隐身只影响感知/命中，`grep INVISIBLE Combat.c` 零引用）；刺剑突进若在隐身下发动会叠加该自创加成。处置权在验收方。
7. **RNG 流影响声明**（常识第四节）：新增 sneakAttack/lungeAttack 自动命中后，这类攻击从"可能 miss（不掷伤害）"变为"必中（必掷伤害）"，凡玩家攻击 WANDERING/突进目标的轨迹，随机数消耗从该点起漂移。地图生成不经过战斗路径，`generation_baseline` 实测绿；但任何记录过"同 seed 完整战局"的旧基线表会失效。
8. **测试推演的一处修正**：攻速行为测试里剑侧 6 击反击次数是 **5** 不是直觉的 4——敌人初始计时为 movementSpeed（150，Monsters.c:116），但贴身反击作为攻击动作耗时 attackSpeed（100，P2-2 口径），首击后周期即变 100。测试注释里已按此推演落档，实测探针核实。
