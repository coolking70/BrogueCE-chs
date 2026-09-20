# UI-2 报告：`isProtected` 的其余三个 CE 消费点

> 执行分支 `round/ui-2`（worktree wt-ui-2），与 V-2a 并行。
> 本轮严格待在战斗与物品显示路径：改动集 4 个生产文件 + 1 个新测试文件，
> **无** `Generator/`、**无** `blueprints.json`、**无** fixture / baseline 触碰
> （证据见「六、门禁结果」）。

---

## 一、对任务书的反驳

按 §0 授权反驳条款，CE 三处消费点均已在 `../BrogueCE-master/` 逐字核对。
以下为分歧与修正，**均已按"以 CE 为准"处理**：

1. **测试条款②「已降到 −10 的武器不再继续降」与 CE 字面冲突，已按 CE 反转。**
   CE `Combat.c:1439` 字面是 `rogue.weapon->enchant1 >= -10`（**含等号**）：
   附魔 −10 的武器**仍会再降一次到 −11**，−11 才停（下界实为 −11）。
   任务书把它读成了 `> -10`。web 照 CE 实现并把测试钉在
   「−10 → −11、−11 → 不动」（`ui_2_protection.test.ts` 用例 3）。
   若验收方原意确是 −10 封底，那是 CE 行为之外的自创口径，请明示。

2. **「MONST_DEFEND_DEGRADE_WEAPON 是真 CE 旗标（CE 树 15 处命中）」——
   旗标为真无疑，但计数不符：实际 9 处**
   （Combat.c 1、Globals.c 4＝2 条目录项＋2 行词条表、Items.c 1、Movement.c 1、
   Rogue.h 2）。实质结论（非自创词元、应实现机制）不受影响。

3. **§2.3 说详情行在"护甲详情段"——CE 的 `// protected?` 块其实在武器/护甲
   if-else 之外（Items.c:2394 前的最后一个类别分支是 2313 的 WEAPON，块本身
   在两支合流之后），对两类装备都显示。** web 的 `protectEquippedGear`
   （Game.ts:4748）本来就能保护武器（SCROLL_PROTECT_WEAPON），故 web 在
   武器段与护甲段各放一行，测试条款④照测护甲，另加武器侧用例钉住 CE 范围。

4. **「weakens」消息 CE 无中文分支**：`Combat.c:1446-1447` 的
   `sprintf(buf, "your %s weakens!", buf2)` **未包 `chineseUi`**（对比 :2394 的
   酸液行是包了的）。故该句不存在"CE 中文原文"可采——zh_CN 的
   「你的{{weapon}}变弱了！」为本轮自译（英文 defaultValue 照 CE 原文
   `your {{weapon}} weakens!`）。措辞如需统一，交验收方裁决。

5. **§2.1 的"web 现状"经复核属实**：`MONST_DEFEND_DEGRADE_WEAPON` 的
   战斗消费点为零（仅 monsters.json 两条数据 + DetailGenerator.ts:98 词条 +
   i_1_interaction.test.ts 头注提及）。"详情面板对玩家撒谎"的判断成立，按既定
   裁决**优先实现**（已实现），词条文案保留。

---

## 二、三件逐条落地情况

### 2.1 武器降级（CE Combat.c:1432-1450）——已实现，重头戏落地

**落点**：`Game.resolvePlayerMeleeAttackOn`（普通近战 / 鞭 / 矛几何共用的玩家
结算出口）命中支尾部——对应 CE `attack()` 命中支内、`splitMonster`（:1424）
之后、返回之前。投掷路径 `resolveThrownWeapon` 不接（CE 该块只在近战
`attack()`，测试钉死）；目标被同一击打死时降级照常发生（CE 同，测试钉死）。

**条件对照**（同一 if，CE :1432-1439）：

| CE 条件 | web 落地 |
|---|---|
| `degradesAttackerWeapon`（防守方旗标） | `target.hasBehavior('MONST_DEFEND_DEGRADE_WEAPON')`（载体：acid_mound / acidic_jelly，monsters.json 恰两条） |
| `attacker == &player && rogue.weapon` | `this.player.equippedWeapon` 空守卫（徒手整块跳过，测试钉死） |
| `!(flags & ITEM_PROTECTED)` | `!weapon.isProtected`——完全跳过、无消息（I-1 护甲侧同口径） |
| 非 W_SLAYING×vorpal 类别豁免 | **无载体，未落地**（见下方登记；`Item.vorpalEnemy` 字段 B-4a 已有，但 `monsterIsInClass` 的成员名册 web 无） |
| `enchant1 >= -10` | `weapon.enchantment >= -10`（CE 字面含等号，下界实为 −11，见反驳 §1） |

**效果对照**（CE :1440-1449）：

| CE | web |
|---|---|
| `enchant1--` | `weapon.enchantment -= 1` ✓ |
| `quiverNumber` 非零 → `rand_range(1, 60000)` 重掷 | `weapon.quiverNumber` 非零 → `rng.randRange(1, 60000)` ✓（**有载体**，ItemLoader:1253 同源；唯一一笔条件性交互期掷骰） |
| `equipItem(...)` 装备刷新 | web 属性读取时即时推导，无需（非缺失，注记） |
| `"your %s weakens!"`（itemMessageColor） | `combat.weapon_weakens`（harness 回退 `your {{weapon}} weakens!`），色 `#646432`＝CE `itemMessageColor {100,100,50}`（Globals.c:281） |
| `checkForDisenchantment(rogue.weapon)` | **web 无载体，未落地**（I-1 遗留第 3 条维持，见登记） |

**假文案清算（条款⑤）**：机制已实现，`DetailGenerator.ts:98` 词条
「被击中时会腐蚀武器」**保留**；新测试把「文案 ↔ 旗标」耦合钉死
（全库恰两条载体、每条载体怪的面板必出该词条）。文案不再撒谎。

**无载体登记（本轮 2.1 的两处）**：

- **`monsterIsInClass` 成员名册**（CE Combat.c:1434-1437 的 W_SLAYING 豁免）。
  证据链：CE 按各类别 `memberList` 逐一比对 `monst->info.monsterID`
  （Monsters.c:293-301）；web `ItemLoader.ts:379-385` 自注
  「成员表（MK_* 名册）web 尚无对应体系，战斗侧类别门未接线」，
  `grep MK_ src/data/monsters.json` = 0 命中，web 怪物亦无 CE 数字 monsterID
  映射。落地需动 monsters.json（或新建数据文件）——均在授权清单外。
  按 `Game.ts:5974` A_IMMUNITY 类别门的既有先例**不落地、保留其余条件**。
  偏差方向：W_SLAYING 武器命中其 vorpal 类别时会被降级（CE 豁免）——
  **欠豁免**（与"过豁免"相反方向的窄口径偏差）。
- **`checkForDisenchantment`**（CE Items.c:1063-1080）：腐蚀降级后
  「好符文 + enchant≤0 → 符文消散」web 无该机制。I-1 报告第 3 条原样维持，
  本轮未自创。

**RNG 流声明（惯例要求）**：生成期零改动（战斗结算路径不动生成）；
交互期新增一笔**条件性**掷骰——仅当玩家以 quiverNumber 非零的武器近战命中
降级怪时重掷（CE :1436-1438 同位同步）。`generation_baseline` 全量绿；
测试另钉了「quiverNumber 零值不掷骰」防无条件重掷白移交互流。

### 2.2 物品栏 `}` 括号（CE Items.c:3629/3641）——已实现

`InventoryOverlay.vue:283` 硬编码 `)` 改为
`{{ entry.item.isProtected ? '}' : ')' }}`。CE 两处（魔法探测分支 :3629 与
普通分支 :3641）同式；web 单一 item-letter span 一处覆盖。全库
`grep "letter }})"` 确认无第二处硬编码残留。测试用静态守卫（b_1a/ui_1 同款
readFileSync 模式）钉接线并守旧形态退场。

### 2.3 详情「不会被酸液腐蚀。」（CE Items.c:2394-2400）——已实现

`DetailGenerator.generateItemDetail` 的**武器段与护甲段**各加一行：
`item.isProtected` 时推入 `{ text: `${item.displayName}不会被酸液腐蚀。`, color: '#44ff44' }`。
中文采 CE `chineseUi` 原文「不会被酸液腐蚀。」逐字（含 theName 前缀结构），
绿色对应 CE `goodColorEscape`。未受保护不出该行（测试双向钉死）。
本文件既有风格为硬编码中文（无 i18next），从本地惯例，未新增 i18n 键。

### 验收条款（任务书 §5 六条）逐条对照

| 条款 | 状态 | 载体 |
|---|---|---|
| ① 行为终点（命中先行断言排假绿） | ✓ | 用例 1/2（先 `mound.hp < maxHp` 再断言附魔与消息） |
| ② `>= -10` 下界 | ✓（按 CE 反转语义） | 用例 3（−10→−11；−11 不动） |
| ③ `}` 括号 | ✓ | 用例 8（静态守卫）+ 生产模板 |
| ④ 详情文案（护甲，含未保护反向） | ✓ | 用例 9（恰一行、含名字；未保护无该行） |
| ⑤ 假文案清算（实现侧保留文案） | ✓ | 用例 11（文案↔旗标耦合 + 恰两载体） |
| ⑥ 对抗性 ≥3 + 强制反向验证 | ✓ | 11 条对抗性用例；2 次真改坏（见下节） |

---

## 三、改动清单

```text
 brogue-web/src/components/InventoryOverlay.vue |  3 ++-   （} 括号三元 + 注释）
 brogue-web/src/engine/Core/Game.ts             | 28 ++++++ （武器降级块，resolvePlayerMeleeAttackOn 命中支尾部）
 brogue-web/src/engine/UI/DetailGenerator.ts    | 10 +++++ （武器/护甲段各一行 protected 详情）
 brogue-web/src/locales/zh_CN.json              |  1 +     （combat.weapon_weakens）
 4 files changed, 41 insertions(+), 1 deletion(-)
 ?? src/test/ui_2_protection.test.ts                      （新建，11 用例）
```

清单外**零改动**：无 `Generator/`、无 `blueprints.json`、无 monsters.json、
无既有测试修改、无调试埋点残留（`grep -rn "REVERT-ME" src/` = 0）。
i18n：新增 `i18next.t` 调用 1 处（Game.ts），`zh_CN.json` 同轮补键
`combat.weapon_weakens`（保留 `{{weapon}}` 插值），p1_30 门禁全量绿。

---

## 四、对抗性测试与反向验证

新文件 `src/test/ui_2_protection.test.ts` 共 11 用例，每条注释写明打红的具体
错误实现。必中配置：防守方 `defense = -10000`（`defenseFraction = 0.987^d`
对负防御指数爆炸、`hitProbability` 钳 100，对任意武器附魔必中，
`accuracyFraction = 1.065^e` 恒正）——与 I-1 的"攻击方 accuracy=10000"对偶，
且每条先断言目标掉血再断言豁免，排除"没打中"假绿。

**强制反向验证（真实改坏两处 → 真实失败输出 → 还原）**：

改坏 ①——Game.ts 删掉 `!weapon.isProtected` 豁免（带 REVERT-ME 标记）；
改坏 ②——InventoryOverlay.vue 回退硬编码 `)`。同跑本文件：

```text
 ✓ src/test/ui_2_protection.test.ts (11 tests | 2 failed) 1737ms
     × 带保护的武器完全跳过：附魔不动、无消息，但命中照样发生 198ms
     × 闭括号按 isProtected 取 } / )（模板接线守卫） 1ms
 FAIL  … > 带保护的武器完全跳过：附魔不动、无消息，但命中照样发生
AssertionError: expected -1 to be +0 // Object.is equality
    145|         expect(mound.hp).toBeLessThan(mound.maxHp); // 命中发生——豁免不是 miss
    146|         expect(sword.enchantment).toBe(0); // CE：带保护完全跳过
 FAIL  … > 闭括号按 isProtected 取 } / )（模板接线守卫）
AssertionError: expected '<script setup lang="ts">\nimport { re…' to match /entry\.item\.isProtected \? '\}' : '\…/
 Test Files  1 failed (1)
      Tests  2 failed | 9 passed (11)
```

还原后复跑 11/11 绿；`grep -rn "REVERT-ME" src/` = **0**（已复核）。

其余对抗性用例一览（各自打红的错误实现写在用例注释里）：下界写 `> -10`
（任务书误读）、quiver 无条件重掷（白移交互流）、徒手崩溃/误降、降级挂进
"目标存活"分支、降级塞进投掷/共享命中核心、模板只写 `}` 丢 `)` 分支、
详情行条件写反、武器段漏接（CE 范围）、文案与旗标脱钩。

---

## 五、需要追加授权的测试

**无。** 全量 93 文件无一撞红清单外断言；b_1a / b_1c / ui_1 中涉及
InventoryOverlay 的既有静态守卫均未被本轮模板改动影响（全量绿佐证）。

---

## 六、门禁结果

1. **`npx vitest run`（不带文件参数、未加 `--fileParallelism=false`）**：

```text
 Test Files  93 passed (93)
      Tests  1190 passed | 8 skipped | 5 todo (1203)
 Start at  01:37:33
 Duration  464.74s (transform 4.36s, setup 0ms, import 40.94s, tests 4118.00s, environment 36ms)
```

   （全量启动后对 DetailGenerator.ts 做过一次纯注释归位、功能零变化；
   受影响的 `ui_2_protection` + `DetailGenerator.test.ts` 已按最终代码单独
   复跑：`Test Files 2 passed (2) / Tests 16 passed (16)`。）

2. **`npm run build`**：

```text
dist/assets/WebGLRenderer-nydK6tTo.js        68.42 kB │ gzip:  18.72 kB
dist/assets/index-C-yvmRj7.js               886.12 kB │ gzip: 267.76 kB
(!) Some chunks are larger than 500 kB after minification. …（既有告警，非本轮引入）
✓ built in 1.75s
```

3. **`generation_baseline` 绿**：全量 93 文件含之；另单独复跑点名——

```text
 ✓ src/test/generation_baseline.test.ts (1 test) …
 Tests  1 passed (1)
```

4. **fixture 未动**：`git diff --name-only | grep -i "fixture\|baseline"` →
   空输出（exit 1）。

5. **并行抗扰**：本轮未遇重型测试翻红，无"单独重跑再下结论"情形。

---

## 七、遗留与登记

1. **W_SLAYING vorpal 豁免无载体**（本轮新登记，见 §2.1）：激活路径＝
   ①数据侧落地 CE `monsterClassCatalog[].memberList`（Globals.c:1416-1432，
   15 类）与 web 怪物 id 的映射（monsters.json 或新数据文件）；②Game.ts 降级
   块补 `!(weapon.flags 含 ITEM_RUNIC && weapon.runicType === 'slaying' &&
   monsterIsInClass(target, weapon.vorpalEnemy))` 条件（注意 web runicType
   字符串为 `slaying` 小写，ItemLoader.ts:347）；③同轮可顺手接 A_IMMUNITY /
   W_SLAYING 的另两个类别门消费点（Combat.c:402/669）。
2. **`checkForDisenchantment` 无载体**（I-1 遗留 #3 维持）：符文消散机制
   web 全缺。武器降级本轮已激活，腐蚀链的最后一环（CE :1449）仍缺——
   激活轮需实现"好符文 + enchant≤0 → 符文消散"（Items.c:1063-1080）。
3. **护甲腐蚀下限口径差**（I-1 遗留 #2 维持，清单外未动）：web
   `enchantment > -3`，CE `enchant1 + armor/10 > -10`。
4. **护甲侧腐蚀消息口径**（I-1 的既有实现，本轮只列不修）：web 固定文案
   「你的护甲被酸液腐蚀了！」，CE 是 `"your %s weakens!"`（带装备名 +
   itemMessageColor，Combat.c:433）。如对齐需动 Monster.ts:823 消息行。
5. **`combat.weapon_weakens` 中文为本轮自译**（CE 无该句中文分支，反驳 §4）：
   「你的{{weapon}}变弱了！」；英文 defaultValue 照 CE 原文。措辞统一权在验收方。
6. **数据载体恰 2 条已钉死**（acid_mound / acidic_jelly ↔ CE Globals.c:1058/
   1093 两条目录项）；后续数据轮增删载体时该断言（ui_2_protection 用例 11）
   应有意识地更新，而非放宽。
7. I-1 遗留 #5/#6（燃烧光两笔无载体、单帧口径观察项）不涉本轮，原样保留。
