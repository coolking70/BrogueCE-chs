# B-2 报告：投掷系统（弹道 / 命中 / 落地 / 药水细分 / 交互期哨兵）

> 两段式执行：第一段实现 + 测试（撞 GLM 5 小时配额上限中断，产物以
> `2720f08 wip(B-2)` 快照保全）；第二段（本报告）收尾——修 TS 错、
> 裁决 legacy.json、补反向验证、跑完整门禁。
> 实现本体未推倒重来，收尾段对它做了全文复核（见 §一）。

---

## 一、CE 投掷路径行号与复核要点（收尾段逐条重核）

CE 权威出处：`BrogueCE-master/src/brogue/Items.c`

| CE 位置 | 内容 | web 载体 | 复核结论 |
|---|---|---|---|
| Items.c:6771-6811 | `hitMonsterWithProjectileWeapon` 开头：非 WEAPON 返回 false；aggro 置位（6791-6801，掷骰**前置**）；临时换手 equipItem→attackHit→换回（6804-6811） | `CombatSystem.resolveThrownWeapon`（Combat.ts）+ `Game.throwItemAt` 弹道循环 | ✅ web 直接把净附魔传入 `hitProbability`，等价于 CE 的临时换手 |
| Items.c:6791-6801 | aggro：非 ALLY / 非 FLEEING（无魔法恐惧）/ 非 CAPTIVE / 非 PERM_FLEEING → `MONSTER_TRACKING_SCENT`，**miss 也激怒** | `throwItemAt` 命中检测内、`resolveThrownWeapon` 之前置 `state = HUNTING` | ✅ web 无 ENTRANCED/魔法恐惧/CAPTIVE/PERM_FLEEING 载体，条件近似为 `!isAlly && state !== FLEEING`（登记 §六-1） |
| Combat.c:149-158 | `attackHit`：只有 STUCK/PARALYZED/CAPTIVE 自动命中；睡觉**不**自动命中、无偷袭倍率 | `resolveThrownWeapon` 的 `autoHit = hasStatus('paralyzed')` | ✅ web 无 stuck/captive 载体，自动命中集只有 paralyzed |
| Items.c:6820-6822 | 伤害 = 豁免 ? 0 : `randClump(damage) × damageFraction(netEnchant)`；无背刺 ×3/×5、无隐形 ×1.5 | 同款；豁免（IMMUNE_TO_WEAPONS/INVULNERABLE）在三目里先判，**豁免不掷伤害骰** | ✅ C 端 `/FP_FACTOR` 是整除，web 用 `Math.round`——极端情形舍入方向可差 1（登记 §六-2） |
| Items.c:6845-6849 | `magicWeaponHit` 只在目标**存活**分支调用（击杀分支不调） | `resolveThrownWeapon` 的 `if (!killed && item.runicType)` | ✅ web 把 CE `magicWeaponHit` 内部掷骮改写为 `runicWeaponChance` + 单次 `randPercent`（与 web 近战侧同款），流口径与 C 不同但项目内自洽（登记 §六-3） |
| Items.c:6882-6947 | `throwItem` 弹道：`for (i<numCells && i<maxDistance)` 逐格；HAS_MONSTER 且非 SUBMERGED → 武器结算/未中 break；挡通行/挡视 → 退一格（point-blank 落原地）+ `hitSomethingSolid` | `throwItemAt` 弹道 for 循环（Game.ts:4588-4652） | ✅ **逐格推进，无"瞬移到目标格"残留**（B-0 留痕已反转，见 §五）；web 无潜水簿记，不跳过 SUBMERGED 怪（登记 §六-4） |
| Items.c:6906-6921 | 武器命中 → `deleteItem` 即消失；miss → break 后落怪格的合格邻格 | 命中 `return`（不落地）；miss `break` 走通用落地 | ✅ |
| Items.c:6949-7047 | 药水碎裂：条件 `hitSomethingSolid \|\| 落点非 T_AUTO_DESCENT`；功能性 7 种 → 各 DF + `autoIdentify`；其余 "splashes harmlessly"；碎裂即 `deleteItem` | `throwItemAt` 药水段（Game.ts:4657-4712），功能性集合 = 5 种有载体者 | ✅ 幻觉特例见下行；DARKNESS/LICHEN 无载体只登记（§三） |
| Items.c:7036-7046 | 幻觉药水特例：默认无害不亮；`ITEM_MAGIC_DETECTED` 或 善意药水全亮（`magicPolarityRevealedItemKindCount(...,1) == numberGoodPotionKinds`，=8）→ autoIdentify | `thrownPotionAutoIdentifies`（Game.ts:4528-4539），复用 B-1c 的 `magicDetected` / `isPolarityRevealed` | ✅ |
| Items.c:7055-7058 | 落地：`getQualifyingLocNear(x, y, deterministic=false, forbiddenTerrain=OBSTRUCTS_ITEMS\|OBSTRUCTS_PASSABILITY, forbiddenMap=HAS_ITEM)` | `qualifyingThrowLanding`（Game.ts:4473-4504），环序扫描+抽第 N 个 | ✅ 偏差：web `randRange(1,1)` 上界≤下界短路**不消耗**掷骮（CE 消耗一次）——只影响流位置不影响分布（登记 §六-5） |
| Items.c:7100-7112 | 诅咒已装备武器投掷：confirm 后 "You cannot unequip…" 拦截 | `throwItemAt` 入口直接拦截 + `throw.cursed_equipped` 文案；confirm 弹层是 UI 债（登记 §六-6） | ✅ CE 的拦截前提是 `(EQUIPPED \|\| timesEnchanted>0) && quantity<=1`，web 只判已装备（web 无 timesEnchanted 投掷分支，登记 §六-6） |
| Items.c:7130 | `maxDistance = 12 + 2 × max(力量 − 虚弱量 − 12, 2)` | `throwMaxDistance()`（Game.ts:4459-4462） | ✅ 下限 2 不是 0（力 12 也扔 16 格，T9 钉死） |
| Items.c:7152-7162 | 堆叠 >1：克隆件（quantity=1）起飞、背包 −1；最后一件整件移出 | `throwItemAt` 中段 | ✅ web 克隆后重分配 `id` 使堆叠件与飞行件可区分 |
| Items.c:7173 | `throwItem()` 尾部 `playerTurnEnded()`——投掷消耗完整回合 | 命中/碎裂/落地三出口都 `currentTick += movementSpeed` + `playerTurnEnded()` | ✅ |

## 二、载体盘点表

**投掷命令本体**：CE 一切物品皆可投（THROW_KEY，Rogue.h:1183）。web 侧 `t` 键已接（Input.ts，
P1-46 让位后空闲）；CE 大写 `T` = RETHROW_KEY（Rogue.h:1184，重扔 `rogue.lastItemThrown`）——
web 无此簿记，**不接**，且 p1_46 新增断言钉死 `T` 必须为空映射（不得悄悄接到别的动作）。

**投掷武器（weapons.json，禁改，归 B-4）**：CE weaponTable（Globals.c:1582）15 件，web 13 件。
投掷机制上 web 对全部 13 件武器走同一条 CE 弹道（武器命中即消失，不再落地），
与 CE 一致——CE 的"投掷武器"不是独立类别，`dart` 只是因为轻（力 10）常被当弹药：

| CE weaponTable | web weapons.json | 备注 |
|---|---|---|
| dart | ✅ `dart`（damage `"1d3+1"` ≙ CE `{2,4,1}`，经 parseDamageString 核对） | 唯一"典型投掷物" |
| incendiary dart | ❌ 无 | **其两处投掷特判因此结构性不可达**：弹道撞可燃障碍直接命中（Items.c:6934-6937）、命中后 DF_DART_EXPLOSION 爆燃（7050-7053）——web 未抄这两段，登记 B-4 |
| javelin | ❌ 无 | clumping=3 的特例（`{3,11,3}`），B-4 引入时注意 parseDamageString 的 `XdY` 语义 |
| war axe | ❌ 无 | 与 axe 同弧，纯数据缺失，B-4 |
| （其余 11 件） | ✅ 一一对应 | — |
| （无 halberd） | ⚠️ web 有 `halberd` | CE weaponTable 无此武器，属 web 自创——按 D2 应不在生成池（invented_content_pool_report 已管，B-4 复核） |

**功能性药水 7 种（Items.c:6986-7026）**：

| CE | web 载体 | 状态 |
|---|---|---|
| POTION_POISON → DF_POISON_GAS_CLOUD_POTION | `poison_burst` addGas(POISON,1000) | ✅ |
| POTION_CONFUSION → DF_CONFUSION_GAS_CLOUD_POTION | `confusion_burst` addGas(CONFUSION,1000) | ✅ |
| POTION_PARALYSIS → DF_PARALYSIS_GAS_CLOUD_POTION | `paralyze_burst` addGas(PARALYSIS,1000) | ✅ |
| POTION_INCINERATION → DF_INCINERATION_POTION | `fire_burst` igniteForced 3×3 | ✅ |
| POTION_DESCENT → DF_HOLE_POTION | `fall_down` spawnDungeonFeature | ✅（C-5 的 DF 既有） |
| POTION_DARKNESS → DF_DARKNESS_POTION | 无该药水种类 | 只登记（测试钉子：`potion_of_darkness` 不在池） |
| POTION_LICHEN → DF_LICHEN_PLANTED | 无 DF 载体，且 creeping_death 已按 D2 退池 | 只登记 |

## 三、交互期哨兵（S1 组）设计与反向验证

**为什么 generation_baseline 不够**（project_conventions「generation_baseline 对交互期掷骰是盲的」，
B-1c 实证）：其口径是"建局 + 逐层 generateDepth"，根本不推进回合——投掷路径多消耗/
少消耗的每一颗骰子它一概看不见。B-1c 的哨兵还调错了函数层，两道防线同时失灵。

**本轮口径**（`b_2_throwing.test.ts` S1 组，`rng.randomNumbersGenerated` 增量）：

- 场景用 `createHeadlessGame(seed, 'test')`（S-1 摸清的隔离通道：合成层 + 清场 +
  搭好后重播种），场地由 `prepareField` 手工构造，**所有 setup 掷骰发生在计数起点
  `c0 = rng.randomNumbersGenerated` 之前**，增量只对投掷路径本身敏感；
- 场上怪一击毙命且 `prepareField` 清掉其余怪 → 怪的回合零掷骰，口径纯净；
- 三条口径：
  - **S1a 药水碎裂路径 = 0 掷**（无命中骰、无伤害骰、无血迹骰——CE 全程 0 掷）；
  - **S1b 麻痹目标（自动命中免掷）= 恰 2 掷**（伤害骰 + spawnBlood 的 randPercent(60)）；
  - **S1c 防御 0 目标（randPercent(100) 也掷）= 恰 3 掷**（命中骰+伤害骰+血迹骰）。
- **教训（第一段实测，注释已写入 S1 组）**：不能用 `vi.spyOn(rng,…).mockReturnValueOnce`
  强造命中——mock 替换真实实现后那次调用**不计数**，把口径悄悄弄脏。S1c 改用
  "defense=0 → 命中率恒 100"的结果确定路径，不用 mock。

**RV4（交互期注入翻红，第二段补做）**：往 `throwItemAt` 弹道循环体注入一次
`rng.randPercent(50)`（REVERT-ME 标记，验后还原），S1 三条**全部翻红**：

```
× S1a: 药水投掷碎裂全程零掷骰
  AssertionError: 药水投掷路径多消耗了掷骰（CE 全程 0 掷）: expected 3 to be +0
× S1b: 麻痹目标（自动命中）恰消耗 2 掷——伤害骰+血迹骰
  AssertionError: …expected 3 to be 2
× S1c: 正常目标（必中）恰消耗 3 掷——命中骰+伤害骰+血迹骰
  AssertionError: …expected 4 to be 3
Test Files  1 failed | Tests  3 failed, 13 skipped (16)
```

（还原后 16/16 复绿。）B-1c 的"哨兵调错层、注入不翻红"失灵模式**没有重演**。

## 四、对抗性测试与反向验证汇总

`b_2_throwing.test.ts` 16 条，每条在文件头对照"具体错误实现"（T1-T9 / S1a-c / W1 / K1）。
第二段补做的反向验证（改坏 → 贴真实失败输出 → 还原 → `grep REVERT-ME` = 0）：

| # | 对应 | 改坏（真实注入） | 失败输出（节选） |
|---|---|---|---|
| RV1 | T1 弹道 | 弹道循环内 `getMonsterAt` 短路为 `null`（瞬移实现的语义：无视挡路怪） | `AssertionError: 投掷物瞬移到了目标格: expected Item{ id: 54, … } to be undefined`（同跑 engaged 断言亦红） |
| RV2 | T2 命中骰 | `resolveThrownWeapon` 的 `hit` 砍成 `= true`（必中） | `AssertionError: 强制 miss 仍造成伤害——命中必中，没掷命中骰: expected 897 to be 999` |
| RV3 | T8 堆叠 | 删 `item.quantity--`（堆叠不递减） | `AssertionError: 堆叠应只剩 14: expected 15 to be 14` |
| RV4 | S1 哨兵 | 弹道循环体注入 `rng.randPercent(50)` | S1a/b/c 三条全红（§三） |
| RV5 | i18n 门禁（legacy 裁决） | 把 `monster.looks_healthy` 移回 zh_CN.json | `× zh_CN.json 没有从未被引用的死键… monster.looks_healthy: expected [ 'monster.looks_healthy' ] to deeply equal []` |

五条全部真实翻红、全部还原，`grep -rn "REVERT-ME" src/` = **0**；
还原后工作区相对快照只有 `b_2_throwing.test.ts` 的 TS 修复（+12/−2）。

**TS2367 的真相（验收方问询的回复）**：`b_2_throwing.test.ts` 原 97 行
`blocker.state === MonsterState.HUNTING` 报 TS2367 **不是真 bug，是 TS 属性收窄假象**——
92 行 `blocker.state = MonsterState.ASLEEP` 之后 TS 把该属性窄成 `ASLEEP` 字面量，
而 `throwItemAt` 内部（Game.ts aggro 置位）对 state 的运行时改动 TS 看不见
（第一段 16/16 全绿即运行时断言成立的证据）。断言本意（投掷的 aggro 把熟睡怪推进
HUNTING，或命中扣血，二者必居其一）完全正确。修法：新增 `stateOf(m)` helper 经函数
中转还原联合类型，**断言强度一字未动**；TS6133 则是纯粹的未使用 import，删除。

## 五、既有测试断言的改动

只动了两个既有文件（原任务书 §五清单内）：

1. **`b_1a_identification.test.ts`**——"留痕：投掷仍是传送+落地（→B-2 反转）"按
   标准反转法改造（B-1 范本）：改名为"已反转（B-2）"，注释保留原断言全文；
   原断言"对怪物零效果"改为断言新事实（命中结算或 aggro 必居其一），另拆一条
   **越界守卫**"扔到空地的物品仍落在目标格"保住原留痕的存活部分。堆叠 −1 作守卫断言。
2. **`p1_46_keybindings.test.ts`**——追加（非修改）一条：`t` → `throw_item` 的
   对抗性断言（没接上 / 接错动作都红），并钉死 `T`（RETHROW）必须为空映射。

## 六、与预设不符之处（只列不修 / 登记）

**对本轮提示词的更正与澄清**：

1. **原任务书 `ai_docs/b-2.prompt.md` 不存在**——`ai_docs/tasks/` 下只有
   b-0 ~ b-1c。§四/§五/§六/§七 的具体条款按本轮提示词 + project_conventions 重建。
   （不排除快照时被一起收走的可能，请验收方核对原始归档。）
2. **TS2367 不是"可能的真 bug"，是 TS 收窄假象**（详见 §四）——断言本意正确，
   已按原强度修复，未改弱。
3. **legacy.json 越界的裁决材料**：`monster.looks_healthy` 是**第一段实现删除旧
   throwItemAt 时失去最后一个引用点**的键（旧实现落地后有
   `t('monster.looks_healthy')` 的"看起来生龙活虎"消息；新实现按 CE 无此消息）。
   键变死键后 i18n 门禁红灯项强制归档（测试失败消息原文即"应归档到
   zh_CN.legacy.json"）。**不能只改 zh_CN.json**：RV5 实测移回主文件即翻红。
   结论：该改动是门禁所迫的必要动作，请验收方追认；若仍有疑虑，唯一替代是
   给投掷落地加一条 CE 不存在的"looks healthy"消息——按 D1 不取。
4. 第一段实现还顺手把 `zh_CN.json` 里 4 个 `throw.*` 新键就位（i18n 门禁对新增
   `t()` 调用的硬要求），这在允许清单内（"仅增键"）。

**对第一段实现复核中发现的小偏差（不改，登记）**：

- **偏差①（载体缺失近似）**：CE aggro 条件含 ENTRANCED 清零、魔法恐惧、CAPTIVE、
  PERM_FLEEING 细分，web 无这些载体，近似为 `!isAlly && state !== FLEEING`。
- **偏差②（舍入）**：CE 伤害 `/FP_FACTOR` 是整除（向下），web `Math.round`——
  极端情形可差 1 点伤害。
- **偏差③（符文掷骰形态）**：CE `magicWeaponHit` 内部自行掷骰，web 提为
  `runicWeaponChance` + 单次 `randPercent`（与 web 近战同款）。RNG 流消耗次数
  与 C 不同——**投掷符文触发会移动交互期流**，S1 口径不含符文（测试用例均无符文
  武器），B-3 引入符文投掷载体时需扩口径。
- **偏差④（潜水）**：CE 弹道跳过 SUBMERGED 怪，web 无潜水簿记，命中所有怪。
- **偏差⑤（落地掷骰）**：web `randRange(1,1)` 短路不消耗掷骰（CE 消耗一次），
  只影响流位置不影响落点分布。
- **偏差⑥（confirm 弹层）**：CE 投掷已装备/曾附魔的最后一件先 confirm；web 无
  同步确认层，诅咒已装备直接拦截 + 文案。UI 债，与 B-1b identify 异步同款架构代价。
- **CE 有而 web 未抄的投掷特判**：INCENDIARY_DART 两处（见 §二载体表）；
  `handlePaladinFeat`（圣骑士专精，无载体）；`moralAttack` / `splitMonster`
  （命中后的士气/分裂，web 无此二载体）。

**给 B-3 / B-4 的登记清单**：

- **B-3（鉴定/详情，如按 roadmap）**：投掷命中不调 `decrementWeaponAutoIDTimer`
  ——W1 留痕钉死"投掷击杀不消耗任何熟悉度"（CE 原样，反驳了 B-1a 登记①
  "临时换手会顺手推进熟悉度"的猜想：CE 的换手只包住 attackHit）。
- **B-4（投掷数据表）**：① 补 `incendiary dart`（注意两处弹道特判 + DF_DART_EXPLOSION
  要同时接，否则数据进了机制不在）；② 补 `javelin`（clumping=3）；③ 补 `war axe`；
  ④ 复核 `halberd`（web 自创，D2 处置）；⑤ `potion_of_darkness` 种类与
  DF_DARKNESS_POTION 载体；⑥ 若引入符文投掷，按偏差③扩 S1 口径。

## 七、门禁输出

### `npx vitest run --fileParallelism=false`（全量串行）尾部

```
 RUN  v4.1.11 /…/wt-b-2/brogue-web

 Test Files  80 passed (80)
      Tests  968 passed | 8 skipped | 5 todo (981)
   Start at  21:16:37
   Duration  1065.65s (transform 660ms, setup 0ms, import 9.19s, tests 1050.36s, environment 12ms)
```

（exit code 0，零失败。）

### `npm run build` 尾部

```
 dist/assets/CanvasRenderer-B0HLk5dJ.js       22.67 kB │ gzip:   7.09 kB
 dist/assets/WebGPURenderer-CRlihhvU.js       38.19 kB │ gzip:  10.65 kB
 dist/assets/browserAll-BArfDm38.js           41.30 kB │ gzip:  10.83 kB
 dist/assets/RenderTargetSystem-BVb3PbMK.js   45.60 kB │ gzip:  12.57 kB
 dist/assets/WebGLRenderer-Iu9YhtV0.js        68.42 kB │ gzip:  18.31 kB
 dist/assets/index-Cq429ywh.js               844.38 kB │ gzip: 254.90 kB

 (!) Some chunks are larger than 500 kB after minification. Consider: …
✓ built in 1.52s
```

（两个 TS 错误已消，构建零错误；chunk 体积警告为既有状态，非本轮引入。）

### `git diff --stat`（相对快照 HEAD=2720f08，即本轮收尾的全部改动）

```
 brogue-web/src/test/b_2_throwing.test.ts | 14 ++++++++++++--
 1 file changed, 12 insertions(+), 2 deletions(-)
```

### `git diff HEAD~1 HEAD --stat`（快照相对其父，即 B-2 实现的全部产物，767 行）

```
 brogue-web/src/engine/Combat/Combat.ts          |  61 ++++
 brogue-web/src/engine/Core/Game.ts              | 323 +++++++++++++++++---
 brogue-web/src/engine/Input.ts                  |   7 +
 brogue-web/src/locales/zh_CN.json               |   5 +-
 brogue-web/src/locales/zh_CN.legacy.json        |   3 +-
 brogue-web/src/test/b_1a_identification.test.ts |  40 +++-
 brogue-web/src/test/b_2_throwing.test.ts        | 379 +++++++++++++++
 brogue-web/src/test/p1_46_keybindings.test.ts   |   8 +
 8 files changed, 767 insertions(+), 59 deletions(-)
```

### generation_baseline 绿的实际输出

```
 ❯ src/test/generation_baseline.test.ts (1 test | 1 passed) …s
 Test Files  2 passed (2)   ← 与 b_2_throwing.test.ts 同批：Tests 17 passed (17)
```

投掷全部走交互期，未动生成期掷骰（S1 哨兵管交互期增量，baseline 管生成期，
两道互补）。

## 八、验收条款逐条对照（本轮收尾提示词"四件事"）

| 条款 | 结果 |
|---|---|
| 1. 修掉两个 TS 错误；TS2367 先查明本意，不为消错改弱 | ✅ tsc --noEmit 0 错；TS2367 查明为收窄假象，helper 保强度修复（§四） |
| 2. 说明 legacy.json 越界 + 能否只改 zh_CN.json | ✅ §六-3：门禁所迫（RV5 实测移回即红），不能只改 zh_CN.json，请追认 |
| 3. generation_baseline 保持绿 | ✅ 与 b_2 同批 17/17 |
| 3. 另立交互期哨兵（增量口径、构造场景） | ✅ S1a/b/c 三口径（§三），第一段已建，第二段复核并写入教训 |
| 3. 哨兵反向验证：真往交互期注入掷骰确认翻红 | ✅ RV4 三条全红（§三），B-1c 失灵模式未重演 |
| 3. 全量 `--fileParallelism=false` 串行 | ✅（§七） |
| 4. 报告（CE 行号/载体盘点/哨兵设计/反向验证/登记清单） | ✅ 本文件 |
| ⚠️ 反向验证 ≥4 条 + REVERT-ME grep = 0 | ✅ RV1-RV5 五条（§四），grep = 0 |
| 禁改 `src/data/*.json` | ✅ 未触碰 |
| 无 git 写操作 | ✅ 本轮零 git 命令写库（工作区改动仅测试文件 +12/−2） |
| 自查"投掷是否逐格弹道、无瞬移残留" | ✅ §一复核 + RV1：弹道是逐格 for 循环，无瞬移残留 |
