# I-1 结题报告：交互期两笔欠账（与 V-1c 并行，零生成期改动）

日期：2026-09-18 · 分支：`round/i-1`（worktree `wt-i-1/brogue-web`）· 执行：开发方（ZCode）
任务书事实复核方式：引用的 CE 行号逐条回源打开 `BrogueCE-master/src/brogue/` 核对；web 侧每个判断附 grep 证据。

---

## 一、对任务书的反驳

任务书 §1–§3 的 CE 事实**全部属实**（Combat.c:425-431 / 1432-1447 / Items.c:2395 / Items.c:3630 /
Light.c:249-251 / Time.c:894 逐一打开核对，含那条 Acid Mound Slaying 注释）。反驳集中在**前提过期与载体错判**：

### 反驳 1（任务书前提过期）：第 2 件（燃烧发光）已被 C-7 激活，本轮不重复实现

任务书说第 2 件是"UI-1 deferral ①"，写明激活路径待本轮执行。实际 `git log -L` 查证：
`Game.updateVision` 里的 `paintBurning` 已由 **C-7（commit `6c3a34a` feat(C-7)）** 接上
（`Game.ts:2666-2682`），且逐字对上 CE：

| CE `Light.c:241-263` | web `Game.ts:2666-2682` | 一致性 |
|---|---|---|
| `status[STATUS_BURNING] && !(info.flags & MONST_FIERY)` | `burningDuration(entity) > 0 && !fiery` | ✅ |
| 循环含玩家自己（`handledPlayer` 模式） | `paintBurning(this.player, false)` | ✅ |
| `lightCatalog[BURNING_CREATURE_LIGHT]` | `LIGHT_CATALOG[LightKind.BURNING_CREATURE_LIGHT]`（条目 = `Globals.c:959`：fireBoltColor{500,150,0} 半径{300,400} fade 0 passThroughCreatures false，c_7 穷举钉死） | ✅ |
| 玩法光网格 `tmap.light`（Time.c:894 每回合重刷） | `lm.paintLight`，`updateVision` 每回合 `clearLighting` 后重泼 | ✅ |

FIERY 的 web 载体核（UI-1 交代的重核项）：`Monster.hasBehavior('MONST_FIERY')`
（`Monster.ts:376`），web 数据里 FIERY 怪 = wisp / salamander / flamedancer。
渲染侧零改动、自动受益——与 UI-1 §七.1 的预告一致。

**处置**：本轮不对 Game.ts 做任何实现（重复接线=自造第二份），改为**核验 + 行为面钉死
（新建测试 3 条）+ 翻转过期的 deferral 留痕**。任务书 §6.1-6.3 的测试要求全部按此口径满足。

### 反驳 2（载体错判，形态②）：`}` 括号不在 Appearance.ts，在 InventoryOverlay.vue

任务书 §5 预授权 `Appearance.ts`"仅当 `}` 括号显示需要"并预授权 `b_1a_identification.test.ts`
"若 `}` 括号影响 displayName"。查证：CE 的 `}` 是物品栏按钮的**闭括号替换**
（`Items.c:3629/3641`：`(theItem->flags & ITEM_PROTECTED ? '}' : closeParen)`）；web 的对应显示载体是
`src/components/InventoryOverlay.vue:287` 的 `<span class="item-letter">{{ entry.letter }})</span>`
——**硬编码 `)`**，与 Appearance.ts / displayName 均无关（displayName 无任何括号后缀，b_1a 无涉）。
InventoryOverlay.vue 不在允许清单 → **未做**，登记（§七.4）。

### 反驳 3（语境查证 + 载体在清单外）：Items.c:2395 是物品详情文本行

该处在 `itemDetails(char*, item*)`（Items.c:1941 起）内：护甲详情里"protected?"段——
"The %s cannot be corroded by acid."（带保护时的绿色说明行）。web 对应载体是物品详情面板
`DetailPanel.vue`（经 `game.inspectTarget` 驱动），同样不在允许清单 → 未做，登记（§七.4）。

### 反驳 4（字面授权外的最小改动，请追认）：Appearance.ts 注释刷新

`Appearance.ts:442-453` 的 deferral 注释因反驳 1 的事实而**整体过期**（还在说"激活轮 = ……"、
"在那之前本函数不做任何事"——会误导下一轮以为光没接）。留痕反转惯例（B-1 范本）要求注释与断言
同步改口，故对这段**纯注释**做了等量改写（deferral 记录保留、追记 C-7 激活与 I-1 钉行为；
染色禁令原文保留并注明"不随激活失效"）。函数体零改动（diff 全部为 ` * ` 注释行，可复核）。
若不追认：revert 该段即可，不影响任何行为与测试。

### 反驳 5（门禁口径）：按 2026-09-18 更正执行并行全量

任务书 §7 写 `npx vitest run --fileParallelism=false`；项目常识同日已更正为
**并行 `npx vitest run`（不带文件参数、不加该旗标）**，用户指示同此。已按并行执行（§六）。

---

## 二、两件逐条落地情况

### 第 1 件：`isProtected` 消费点

**调查结论（先查机制，再决定接线）**：

| CE 消费点 | web 机制有无 | 证据 | 处置 |
|---|---|---|---|
| 护甲腐蚀（Combat.c:425-431，`MA_HIT_DEGRADE_ARMOR` 命中玩家） | **有载体** | `Monster.ts` 两处：`resolveGeometryAttackOn`（原 :814）与 `takeTurn` 近战支（原 :1316）——`hasAbility('MA_HIT_DEGRADE_ARMOR')` → `enchantment -= 1` | ✅ 两处均接上 `!isProtected` 豁免（带保护完全跳过、无消息，≙ CE） |
| 武器降级（Combat.c:1432-1447，防守方 `MONST_DEFEND_DEGRADE_WEAPON`） | **无载体** | 全库 grep：该旗标只在 `monsters.json:425/935`（数据）与 `DetailGenerator.ts:98`（怪物词条文案）出现；`degradesAttackerWeapon`、武器 enchantment 减免的**战斗消费点为零** | 按任务书 §2.3 **不自创**，登记"无载体"+激活路径（§七.1） |
| 物品详情"不会被酸液腐蚀"（Items.c:2395） | 有载体但清单外 | 载体 = `DetailPanel.vue` | 登记（§七.4） |
| 物品栏 `}` 括号（Items.c:3630） | 有载体但清单外 | 载体 = `InventoryOverlay.vue:287`（反驳 2） | 登记（§七.4） |

**接线内容**（两处同款，注释注明 CE 出处）：

```ts
if (game.player.equippedArmor && !game.player.equippedArmor.isProtected && game.player.equippedArmor.enchantment > -3) {
```

测试（新建 `i_1_interaction.test.ts`，3 条）：takeTurn 路径带保护不降级且无腐蚀消息 /
不带保护降 1 点且有消息 / `resolveGeometryAttackOn` 路径同豁免（两极性都钉）。
命中确定性：`accuracy = 10000`（`hitProbability` 在 CombatFormulas.ts:73 钳 100，对任意护甲防御必中），
`hp < 200` 先证明"命中确实发生"，排除"豁免=没打中"的假绿。

### 第 2 件：燃烧怪物的发光

机制已在（反驳 1），本轮落地 = **核验 + 3 条行为测试 + 留痕翻转**：

1. 非 FIERY 燃烧怪：`updateVision` 后自身格光增量恰 = 2×fireBoltColor{1000,300,0}
   （LightMap.paintLight 掩码内一份 + 原点无条件整份，CE 原样）、邻格受光（是"光"不是标记）、
   蓝通道 0（错光种在此翻红）；
2. FIERY 怪（wisp）燃烧：三通道零增量（不叠加）；**且 burning 状态仍为 7**
   （FIERY 怪燃烧不衰减是 Monsters.c:1879-1881 的另一条机制——防"用不燃烧来修"）；
3. 玩家燃烧：同样 +{1000,300,0}（CE handledPlayer 模式）。

留痕翻转（按惯例断言新事实，不是删断言）：
`ui_1_rendering.test.ts` 第 2 条 describe 标题与注释改为"C-7 已接线；I-1 补行为钉死"，
**两条断言原样保留**（外观等价 + monsterAppearance 代码零燃烧分支——它们就是任务书 §6.3
要的形式守卫：发光≠染色，永久有效）；`Appearance.ts` 注释同步改口（反驳 4，请追认）。

**Deferral 汇总**：本轮无新增 deferral；登记项（非 deferral，是"无载体/清单外"的激活登记）
见 §七。

---

## 三、改动清单

```
 brogue-web/src/entities/Monster.ts         |  10 +++++-   [两处 MA_HIT_DEGRADE_ARMOR 腐蚀点接 isProtected 豁免 + CE 出处注释]（第1件）
 brogue-web/src/engine/UI/Appearance.ts     |  23 +++---   [纯注释：第 2 条 deferral 注释改口为"已激活"（反驳 4，请追认）]
 brogue-web/src/test/ui_1_rendering.test.ts |  17 +++---   [留痕框架翻转：describe 标题+注释改口，断言原样保留]（第2件）
 brogue-web/src/test/i_1_interaction.test.ts|  新文件      [6 条：isProtected 3 条 + 燃烧光 3 条]
 3 files changed, 30 insertions(+), 20 deletions(-)
```

另：`ai_docs/i-1_report.md`（本报告）。

**零改动确认**：`Game.ts` 最终 diff = 0 行（RV2 曾临时拆 `if (fiery) return` 做反向验证，
已逐字还原）；`Item.ts`、`src/locales/**`、`scroll_effects.test.ts`、`b_1a_identification.test.ts`
均未动（无需要）。`BrogueCE-master/`、`src/engine/Generator/`、`src/engine/Map/`、生成期 fixture
零触碰（§六证据）。

## 四、对抗性测试与反向验证

每条 it 的注释写明它打红的具体错误实现。强制反向验证 2 轮（任务书要求 ≥2）：
真改坏 → 跑 → 记录 → 还原。**还原后 `grep -rn "REVERT-ME" src/` = 0 条**（调试 console.log 亦 0）。

### 反向验证 ①：拆掉 takeTurn 落点的 `!isProtected` 豁免（模拟"漏改一处"）

```
 FAIL  src/test/i_1_interaction.test.ts > I-1 第 1 件：isProtected 豁免酸液腐蚀护甲（CE Combat.c:425-431） > takeTurn 近战路径：带保护的护甲被酸怪命中也不降级、无腐蚀消息
 AssertionError: expected -1 to be +0 // Object.is equality
 ❯ src/test/i_1_interaction.test.ts:96:35
 Test Files  1 failed (1)   Tests  1 failed | 5 passed (6)
```

（命中了任务书点名的错误实现：带保护的装备照样降级。还原后全绿。）

### 反向验证 ②：拆掉 Game.ts 的 `if (fiery) return;`（FIERY 怪也泼燃烧光）

**第一跑全绿——这暴露了测试自身的空洞**：wisp 测试漏了 `game.monsters.push(wisp)`，
怪不在场、断言空转（正是项目常识 B-1c"哨兵调错层"的形态）。补上 push 后重跑（Game.ts 仍在坏状态）：

```
 × FIERY 怪（wisp）燃烧：不叠加光；但燃烧状态本身照常在（防"用不燃烧来修"） 167ms
 FAIL  src/test/i_1_interaction.test.ts > … > FIERY 怪（wisp）燃烧：不叠加光 …
 AssertionError: expected 1000 to be +0 // Object.is equality
 Test Files  1 failed (1)   Tests  1 failed | 5 passed (6)
```

（wisp 格翻出 1000 的红通道 = FIERY 排除失效被当场抓住。还原 Game.ts 后 6/6 全绿。）

### 测试起草期的两次自纠（终稿前修复，附 spokes）

- 初版光照测试用 `lightAt(...)` 存"before"——该 API 返回**活引用**，clearLighting 原地清零，
  before/after 是同一对象、增量恒 0；终稿改为快照取值。
- 初版在 depth 1 断言"12 格外基线为 0"——D1 矿灯半径约 44 格，实测基线 457；终稿按 c_7 同款
  置 `game.depth = 40`（深层矿灯 ~2.3 格）取得真 0 基线。

## 五、需要追加授权的测试

**无清单外测试撞红**（受影响面 7 文件先行全绿；全量 91 文件零红为证）。

需要**追认**的是生产文件 `Appearance.ts` 的纯注释改写（反驳 4——字面授权是"仅当 `}` 括号
显示需要"，实际用途是留痕注释与事实同步；不追认可 revert，无行为影响）。

## 六、门禁结果

### 全量 vitest（`npx vitest run`，并行、不带文件参数、不加 `--fileParallelism=false`）

```
 Test Files  91 passed (91)
      Tests  1167 passed | 8 skipped | 5 todo (1180)
   Start at  22:36:30
   Duration  414.48s (transform 3.53s, setup 0ms, import 30.82s, tests 3361.26s, environment 28ms)
```

（exit code 0。91 文件含本轮新建的 `i_1_interaction.test.ts` 与 `generation_baseline.test.ts`——
**generation_baseline 绿**。重型文件 armor_model_effect / c_8_connectivity 用时 253s/177s，
无 V-1c 抢 CPU 导致的假红，无需单独重跑。）

### npm run build（类型门禁，非 tsc --noEmit）

```
 dist/assets/WebGLRenderer-CTlcAS0g.js        68.42 kB │ gzip:  18.71 kB
 dist/assets/index-Bcvgslap.js               882.59 kB │ gzip:  266.41 kB
 (!) Some chunks are larger than 500 kB after minification. …   ← 既有告警，非本轮引入
 ✓ built in 3.10s
```

### 生成期未越界证据

```
 git status --porcelain：
 M brogue-web/src/engine/UI/Appearance.ts
 M brogue-web/src/entities/Monster.ts
 M brogue-web/src/test/ui_1_rendering.test.ts
?? brogue-web/src/test/i_1_interaction.test.ts
 git diff --name-only | grep -i "fixture\|baseline" → 空（exit 1）
```

diff 中无 `Generator/`、`Map/` 下任何文件；本轮无任何掷骰改动（豁免是纯守卫条件，
不增减 RNG 消耗），RNG 流零移动。

## 七、遗留与登记

1. **武器降级"无载体"登记**（第 1 件武器侧）：`MONST_DEFEND_DEGRADE_WEAPON`（CE
   Combat.c:1168 由防守方旗标置位，Combat.c:1432-1447 消费）在 web 只有数据与词条文案、
   无战斗消费点。激活路径：在玩家攻击命中结算处（CombatSystem.attack 的攻击者=玩家分支之后）
   加"防守方 hasBehavior('MONST_DEFEND_DEGRADE_WEAPON') → 武器 enchantment--"分支，
   豁免三条件照抄 CE：`!isProtected`、非"针对该敌人的 W_SLAYING 符文武器"
   （monsterIsInClass(defender, vorpalEnemy)）、`enchantment >= -10`（CE 字面 -10，注意与护甲
   下限口径不同）。激活轮需重核 web 的 W_SLAYING/vorpalEnemy 载体名。
2. **护甲腐蚀下限口径差（只列不修）**：web 现行 `enchantment > -3`，CE 是
   `enchant1 + armor/10 > -10`（armor 为 ×10 定点，leather=3 → CE 允许附魔降到 -13）。
   属既有行为、非本轮引入；按 D1 是偏差，登记给后续平衡对齐轮（与本轮豁免正交：
   豁免接在下限判断之前，两口径下行为一致）。
3. **CE 腐蚀后的 `checkForDisenchantment`（Items.c:1063-1080）web 无载体**：CE 在腐蚀降级后
   检查"好符文 + enchant≤0 → 符文消散（'the runes fade from your %s.'）"。web 无该机制，
   与 ① 同属腐蚀链深化，激活轮一并考虑。
4. **两个显示层消费点**（清单外未做）：物品栏 `}` 括号 → `InventoryOverlay.vue:287`
   （把硬编码 `)` 改为按 `isProtected` 取 `}`）；物品详情"不会被酸液腐蚀"说明行 →
   `DetailPanel.vue`。均为纯显示，激活轮各一处小改。
5. **CE 燃烧光循环的其余两笔光 web 无载体**：`intrinsicLightType`
   （SPECTRAL_IMAGE_LIGHT，Combat.c:951；SACRIFICE_MARK_LIGHT，Monsters.c:885——web 无灵影/
   祭品印记机制）与 mutation 光（CE 变异系统，web 无）。属"照抄留形"的缺页，留待对应机制轮。
6. **单帧口径差（观察项）**：web 燃烧光只画 `hp > 0` 的怪；CE 遍历 monsters 列表
   （当回合垂死未清理的怪仍在列，其燃烧光多画一帧）。一帧渲染差，无玩法影响。
7. **F-2b 已登记项不重复**：熄火时的"光色/视野刷新 web 无对应矿灯光色系统"退化仍在
   （f_2b_creature_burning_report.md）。
