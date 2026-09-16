# B-1a 报告：未知态模型与揭示规则（含反泄露）

> 2026-09-17。执行：ZCode/GLM（round/b-1a 分支，与 C-5 并行）。
> CE 源码以 `BrogueCE-master/src/` 为准（只读）。本轮范围 = B-0 §5.4 修正一划定的
> B-1a：两层未知态模型、被动揭示规则表、三处反泄露。持久化/call/戒指双槽/作弊按钮
> 归 B-1b；detect magic 极性整条归 B-1c。

---

## 0. 结果速览

- **两层未知态模型落地**：层 1（种类）沿用 `ItemLoader.identifiedItems`（并补上
  CE 的开局清零语义与护符/护符石预亮）；层 2（实例）在 `Item` 上新增
  `identified` / `canBeIdentified` / `maxChargesKnown` / `timesUsed`，`charges`
  按 CE 复用为武器/护甲/戒指的熟悉度倒计时。
- **被动揭示规则表**（B-0 §1.4 的 web 缺失项）全部接上载体：杀 20 敌亮武器、
  穿 1000 回合亮护甲、戴 1500 回合亮戒指、最后一种类自动升格（极性分组）、
  enchanting 卷轴用完不自亮、clairvoyance/stealth 戒指戴上即亮、
  魔杖放电计数与"空杖敲一下亮上限"。
- **三处反泄露全部修复**（§3 对照表），未鉴定物品不再泄露附魔/诅咒/充能。
- **RNG 流零移动**：`generation_baseline` 绿（自然保持，未动 fixture），
  新增哨兵测试把 seed 42/2026 全链物品签名钉死。
- 新增测试 31 条全绿；反向验证 5 组（超出 ≥4 要求）真实改坏并还原。
- **反驳了 B-0 一处实测结论**（identify 卷轴其实会自亮，§6.1），并发现
  web 药水表缺 `potion_of_speed`（§6.3）。

---

## 1. 两层模型的 CE 行号与字段语义（复核结果）

### 1.1 层 1：全局种类表 `itemTable`（Rogue.h:1424-1437）

```c
typedef struct itemTable {
    char *name; char *flavor; char callTitle[30];
    short frequency; short marketValue; short strengthRequired;
    int power; randomRange range;
    boolean identified;            // ← 种类是否被认识
    boolean called;                // call 绰号（B-1b）
    int magicPolarity;             // +1/-1/0（B-1c 才有 detect magic 载体）
    boolean magicPolarityRevealed; // （B-1c）
    char description[1500];
} itemTable;
```

- web 对应物：`ItemLoader.identifiedItems: Set<string>`（键 = consumableId /
  identityId）。**武器/护甲没有种类表条目**（CE `tryIdentifyLastItemKinds` 注释：
  "非风味类别的基础类型本就 identified"）——武器/护甲的识别只发生在实例层，
  本轮实现与测试（A5）都钉死了这一点。
- 开局清零：`shuffleFlavors` → `resetItemTableEntry`（Items.c:8775-8790）只清
  五张风味表的 identified/magicPolarityRevealed/called/callTitle。web 的
  `initConsumables()` 本就 clear 整个 Set——本轮补上**护符/护符石预亮**
  （CE charmTable 预置 `identified=true`，GlobalsBrogue.c:714-726；
  makeItemInto 对食物/钥匙/护符直接 `ITEM_IDENTIFIED`）：护符 6 种 + 护符石
  在开局即入 Set，对齐"护符无未知态"（§1.3，B-0）。

### 1.2 层 2：物品实例旗标（Rogue.h:1361-1386，鉴定相关 12 位）

| CE 旗标 | web 字段（本轮新增/沿用） | 本轮语义 |
|---|---|---|
| `ITEM_IDENTIFIED` Fl(0) | `Item.identified?: boolean`（新增；getter `isIdentified`） | 这一件的附魔/充能已知 |
| `ITEM_CAN_BE_IDENTIFIED` Fl(8) | `Item.canBeIdentified`（新增） | 鉴定卷轴合法目标 |
| `ITEM_RUNIC_IDENTIFIED` Fl(7) | `Item.runicKnown`（沿用） | 符文种类已知 |
| `ITEM_MAX_CHARGES_KNOWN` Fl(12) | `Item.maxChargesKnown`（新增） | 杖/魔杖上限已知 |
| `ITEM_RUNIC_HINTED` Fl(6) | **不设字段** | 本版 CE 无"只 HINTED 不 IDENTIFIED"的赋值路径（autoIdentify 两枚同置，Items.c:6762）；显示条件 `IDENTIFIED && RUNIC && !RUNIC_IDENTIFIED` 用现有三字段即可表达 |
| （熟悉度计数器） | `Item.charges` 复用（武器/护甲/戒指） | Items.c:275/285/353 同款 |

**`identified` 采用三态设计（`undefined` ≙ 已鉴定）——这是被文件边界逼出来的
设计决策，不是随意的 API 选择**：既有测试 `armor_display_effect.test.ts` 与
`DetailGenerator.test.ts`（均不在本轮允许修改清单）用裸 `new Item(...)` 构造
并断言详情面板的"实际防御值"行存在。CE `makeItemInto` 只给五个可未知类别发
`ITEM_CAN_BE_IDENTIFIED`，其余类别（食物/金币/钥匙/护符/护符石）生来
`ITEM_IDENTIFIED`——裸构造 ≙ "普通物品"，五类可未知物品由 `ItemLoader.spawn*`
显式置 `false`。语义等价于 CE 的"未鉴定是可未知类别的生成期属性"。

### 1.3 与 C-5 的边界遵守

`Game.ts` 只动了物品/鉴定相关区段（startNewGame 开局三件套、objectiveTimeBlock
挂 processIncrementalAutoID、resolvePlayerMeleeAttackOn 杀敌钩子、quaff/read/
useArcana/equip/identifyRandomItem、serialize/deserialize）。未触碰地图生成、
坠落、公共结构。`src/engine/Map/`、`src/entities/Monster.ts` 零改动。

---

## 2. 揭示门槛的准确数值与出处

| 规则 | 数值 | CE 出处 | web 实现 |
|---|---|---|---|
| 武器杀敌 familiarity | **20 杀** | `weaponKillsToAutoID = 20`，variants/GlobalsBrogue.c:1040；计数器装载 Items.c:275（charges 复用）；扣减 `decrementWeaponAutoIDTimer` Combat.c:1099-1121，**调用点 Combat.c:1427-1430：玩家近战击杀且目标非无生命**（`MB_WEAPON_AUTO_ID` 生成时对非 `MONST_INANIMATE` 恒置，Monsters.c:157-159） | `ItemLoader.decrementWeaponAutoIDTimer`，钩子在 `resolvePlayerMeleeAttackOn` 的 `target.hp <= 0` 分支 |
| 护甲穿戴 familiarity | **1000 客观块** | `armorDelayToAutoID = 1000`，GlobalsBrogue.c:1041；计数器 Items.c:285；`processIncrementalAutoID` Time.c:1987-2024，**调用点 Time.c:2664：客观时间块内（每 100 tick 恰好 1）**；揭示时"只亮实例、不必然亮符文种类"（Time.c:2013-2015 注释原文） | `ItemLoader.decrementWornFamiliarity`，钩在 `objectiveTimeBlock()` 的 `tickArcanaResources()` 之后（与 CE 块内次序一致） |
| 戒指穿戴 familiarity | **1500 客观块** | `ringDelayToAutoID = 1500`，GlobalsBrogue.c:1042；计数器 Items.c:353；同上 Time.c:1987-2024；归零走 `identify(theItem)`（Time.c:2021）＝**实例+种类一起亮** | 同上；web 单戒指槽（CE 三槽 armor/ringLeft/ringRight），双槽归 B-1b |
| 喝药水 | 全种类自亮 | Items.c:8199-8205 | 既有逻辑，本轮改经 `identifyItemKind` 接升格联动 |
| 读卷轴 | 全种类自亮，**例外 enchanting** | 通用块 Items.c:8019-8026；**identify 卷轴在 case 内先自亮**（Items.c:7776-7781，见 §6.1 反驳） | `readItem` 例外清单只含 `scroll_of_enchantment`；identify 卷轴在 effect 前自亮+宣告 |
| 魔杖放电计数 | 每次放电 +1 | Items.c:7435（`enchant2++`，仅 WAND）；未识别时显示使用次数（1615-1634） | `Item.timesUsed`；displayName/详情显示 |
| 空杖/空杖再施放 | 亮充能上限 | Items.c:7420-7424（"it must be depleted" → `ITEM_MAX_CHARGES_KNOWN`） | `useArcanaItem` 的 `charges <= 0` 分支 |
| 戴上即亮 | clairvoyance / light / stealth | Items.c:8583-8586 | `equipItem` 钩子；清单 `INSTANT_ID_RING_KINDS`（web 无 light 戒指，留形） |
| 种类亮时的实例副规则 | 附魔 ≤0 的戒指、充能区间退化的魔杖 | Items.c:6696-6706 | `identifyItemKind` 内；退化魔杖清单 = `{wand_of_empowerment}`（GlobalsBrogue.c:701-711 逐行核对：唯有 empowerment {1,1,1}） |
| 最后一种类自动升格 | 极性类内剩 1 且（本类极性已揭示 ∨ 对侧全识别） | `tryIdentifyLastItemKind(s)` Items.c:6635-6673；`HAS_INTRINSIC_POLARITY = POTION|SCROLL|RING|WAND|STAFF`（Rogue.h:768） | `ItemLoader.tryIdentifyLastItemKinds` + 极性表 `MAGIC_POLARITY`（纯数据，逐行取自五张 CE 表，行号见代码注）；`isPolarityRevealed` 恒 false 留形给 B-1c |
| 鉴定卷轴 | `identify()`：实例全亮+种类亮 | Items.c:7636-7648、7774-7805 | `identifyRandomItem` 重写：目标池按 `canBeIdentified`（先整包 `updateIdentifiableItem` 扫一遍 ≙ CE `updateIdentifiableItems`，Items.c:7719-7727） |
| `identifyItemKind` 副规则·升格触发 | 见上 | Items.c:6675-6720 | 同名方法 |

**升格规则的极性数据与 D2 后果**：极性表覆盖全部 5 类风味种类（含退池条目，
CE 语义按整张表计）。web 自创/错位实体（healing 药水、amnesia 卷轴、
wand fire/lightning、staff light）记 0（不参与分组）。**结构性不可达登记**：
`potion_of_poison`（=CE caustic gas，恶意）与 `potion_of_creeping_death`
（=CE POTION_LICHEN，恶意）均退池且恒不识别 → **恶意药水类的"最后升格"在
B-4 回池前不可达**；善意药水/卷轴/戒指/魔杖/法杖各类均可达（卷轴恶意类仅
summon 一种，识别后善意类升格即被激活）。激活轮（B-4 回池）需重核 CE 极性列。

---

## 3. ★ 三处反泄露对照（玩家最直接感知的部分）

对照口径：seed=42 headless，spawn 后手工设置附魔/诅咒/符文（B-0 §4.5 同款
探针场景），截图语句取自 B-0 §2.3 的修复前实测。

### 3.1 未知武器的 displayName

| | 修复前 | 修复后 |
|---|---|---|
| `sword` +2（未鉴定） | `"Sword +2"`（Item.ts 旧 100-101 行无条件拼后缀） | `"Sword"` |
| 诅咒皮甲 -1（未鉴定） | `"Cursed Leather Armor -1"`（旧 104 行诅咒前缀） | `"Leather Armor"`——**诅咒与负附魔都不显示**（CE itemName 全函数无 cursed 分支；玩家经"摘不下来"（Items.c:7110，web InventoryOverlay 已有该拦截）或鉴定卷轴得知） |
| 同一把剑鉴定后 | `"Sword +2"` | `"Sword +2"`（不变——修复不剥夺已获得的信息） |
| 已鉴定+未知符文 | `"Sword +2"`（无提示） | `"Sword +2 (unknown runic)"`（CE Items.c:1518-1523 的"（未知符文）"提示，zh 资源下显示中文） |

i18n：`name.Cursed` 键仍留在主文件（`name.*` 前缀受动态引用规则保护，
i18n 门禁不会判死键；留作 CE 式诅咒文案的储备）。

### 3.2 DetailGenerator 的装备段

| | 修复前（DetailGenerator.ts 旧 305-362 行） | 修复后 |
|---|---|---|
| 未鉴定武器详情 | `"基础伤害: 1d3+6 (7~9); 实际伤害: 6~7 (附魔 +2); 被诅咒"` | `"基础伤害: …; 力量需求: …"`——**实际伤害与被诅咒两行缺席**（基础伤害是种类数据，CE 对未鉴定也显示类型已知信息，保留） |
| 未鉴定诅咒护甲详情 | `"基础防御值: 3; 实际防御值: 2.5 (净附魔 -1.5); 被诅咒"` | `"基础防御值: 3; 力量需求: …"` |
| 鉴定后 | 同修复前 | 实际伤害/实际防御值照常显示（锁定信息来自鉴定态而非行被删除——A2/A3 各有正反两条断言） |

### 3.3 未识别魔杖的详情面板

| | 修复前 | 修复后 |
|---|---|---|
| 名称 | `"Copper Wand"`（名称层本来就藏了） | `"Copper Wand"`；用 1 次后 `"Copper Wand (used once)"`（CE Items.c:1615-1634 的使用次数显示；zh 资源下"（已使用 1 次）"） |
| 详情面板 | `充能: 3/3` **直接泄露余量**（旧 384-385 行不查鉴定态） | 未识别：无充能行，魔杖显示`已使用 N 次`；敲空一次后显示`充能上限: N（当前余量未知）`；鉴定后显示`充能: x/y` |
| 名称充能标注 | 种类识别后即显示 `[x/y]`（旧逻辑） | 实例层已知才显示，且对齐 CE 记法：魔杖 `[剩余]`（Items.c:1611-1613）、法杖 `[剩余/上限]` 或 `[?/上限]`（1650-1653）；标注跟在**当前名字**（未识别种类时是风味名）之后 |

### 3.4 顺带修复的第四处泄露（identifyRandomItem 目标池语义）

鉴定卷轴旧目标池 = "背包里种类未识别的物品"，选中后**只亮种类不亮实例**
——对武器/护甲等于白读。现按 CE：目标池 = `ITEM_CAN_BE_IDENTIFIED`
（`updateIdentifiableItem` 维护，Items.c:7699-7713），命中者 `identify()`
全亮（附魔+符文+种类）。目标指定 UI 仍归 B-1b（web 维持随机，B-0 §5.3-2）。

---

## 4. 硬门禁：generation_baseline 保持绿（RNG 流零移动）

本轮**零掷骰消耗**：全部改动是状态字段、显示分支与既定随机数之后的纯赋值
（spawn* 的 charges/identified 赋值在既有 randPercent 链之后，无新增抽取）。

```
（2026-09-17，B-1a 改动落地后实跑）
>npx vitest run src/test/generation_baseline.test.ts
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  05:40:36
   Duration  11.87s (transform 227ms, setup 0ms, import 388ms, tests 11.40s, environment 0ms)
```

fixture 未动（`git status` 无 fixtures 变更）。另加**哨兵测试**（A13）把
seed 42 / 2026 全链 D1..D26 逐层物品签名（`类别|种类|坐标|附魔|诅咒|符文|数量`
排序后 FNV-1a）钉死在测试文件里——generation_baseline 只锁"物品数"，
哨兵补上"种类/坐标/附魔分布"粒度。反向验证 RV5 注入一次额外掷骰后哨兵与
基线双双翻红（输出见 §7）。

---

## 5. 测试

### 5.1 新增文件 `src/test/b_1a_identification.test.ts`（31 条，全绿）

对抗性断言与"具体错误实现"的对照（每条都能在对应错误下失败）：

| # | 断言 | 能抓住的错误实现 |
|---|---|---|
| A1 | 未鉴定武器不显示 +N / 诅咒不进名字 / 未知符文提示 | displayName 无条件拼后缀（旧代码）；诅咒前缀（旧代码） |
| A2 | 未鉴定武器详情无"实际伤害/被诅咒"；鉴定后有 | DetailGenerator 不查鉴定态（旧代码） |
| A3 | 未鉴定护甲详情无"实际防御值/被诅咒"；鉴定后有 | 同上 |
| A4 | 未识别魔杖名称/详情均无充能；用后显示次数；鉴定后 `[剩余]`；空杖亮 `[?/上限]` | 法器段不查实例旗标（旧代码）；漏放电计数；漏 MAX_CHARGES_KNOWN |
| A5 | 实例揭示不外溢到同类他件；种类揭示作用于所有实例；熟悉度只亮实例 | 两层合并成一层（任一方向） |
| A6 | 19 杀不亮、第 20 杀亮；无生命怪不计入；真实近战击杀恰好 -1 | 门槛差一；漏 `MONST_INANIMATE` 豁免；漏接线 |
| A7 | 999 块不亮、第 1000 块亮；脱下不计数 | 护甲门槛差一；脱装仍计数 |
| A8 | 戒指 1499 块不亮、第 1500 块实例+种类一起亮；clairvoyance/stealth 戴上即亮 | 戒指路径误抄护甲的"只亮实例"；漏戴上即亮 |
| A9 | 上一局识别的种类不漏进新局；护符/护符石预亮清单精确 | initConsumables 漏 clear / startNewGame 漏调 |
| A10 | enchanting 用完不自亮；identify 读的瞬间自亮；其它卷轴自亮 | 例外清单写错（含把 identify 错加进例外——见 §6.1） |
| A11 | 戒指类剩 2 种不升格、剩 1 种升格；善意药水剩 1 但对侧未全识别不升格 | 升格阈值写错；漏极性分组；漏对侧条件 |
| A12 | 鉴定卷轴按 CAN_BE_IDENTIFIED 选目标并实例全亮；无秘密物品被移出目标池 | 目标池口径错（旧"种类未识别"）；选中后只亮种类 |
| A13 | seed 42/2026 全链物品签名逐位一致 | 任何 RNG 流移动 |
| A14 | CAN_BE_IDENTIFIED 维护四分支（武器无符文/有未知符文/符文已亮/药水种类已知） | updateIdentifiableItem 漏分支 |

留痕测试（本轮明确不做，均注明反转轮次）：
- **P1-48 鉴定态不进存档**：快照无 identif* 字段；读档后种类集与实例旗标全丢
  （开局三件套读档后暂失已鉴定态——deserialize 按 spawn 语义重建为未识别）。
  → B-1b 持久化时反转。
- call/inscribe 无 API（→ B-1b）；戒指单槽、第二枚顶掉第一枚（→ B-1b）；
  `uncurseItem`/`rechargeArcanaItem` 免费作弊面仍在线（→ B-1b 移除时反转）。
- 投掷仍是"传送+落地"，扔剑对怪物零效果（→ B-2）。
- negation/sanctuary/shattering 读取后无机制效果（→ B-3）。
- detect magic 只亮种类、无极性揭示机制（→ B-1c）。

### 5.2 既有测试的断言修改：**零条**

任务书预授权了 5 个文件（`itemFlavors` / `armor_runic_effect` / `scroll_effects`
/ `b_1_weapon_specials` / `p4_7_player_weapon_geometry`），逐条核查后**全部无需
改动**，守卫性质自然零放宽：

- `itemFlavors`（实际路径 `src/engine/Items/itemFlavors.test.ts`，任务书写的是
  `src/test/`——见 §6.4）：只断言风味池大小/双射/跨 seed 不同，本轮未触碰风味系统。
- `armor_runic_effect`：断言 `runicKnown` 在符文触发后为 true——本轮保留
  `runicKnown` 字段与触发路径，未动。
- `scroll_effects`：断言的 6 张卷轴（teleport/protect×2/summon/discord）均不在
  自亮例外清单；isProtected 存读档往返不涉新增字段。
- `b_1_weapon_specials` / `p4_7`：测试内击杀数 ≤5，武器熟悉度计数（20）远未
  触底；spawnWeapon 新增的 charges/identified 赋值不影响其断言的 flags/damage。

**边界冲突预判兑现**：`armor_display_effect.test.ts` 与 `DetailGenerator.test.ts`
（不在预授权清单、也不在 B-0 预告清单）用裸 `new Item` 断言详情行存在——
这正是 §1.2 `identified` 三态设计的成因；若 `identified` 默认 false，这两个文件
会翻红且本轮无权修改。已在实现层消解，无需申报裁决。

### 5.3 反向验证（5 组，均真实改坏 → 贴真实失败输出 → 还原）

**RV1 — displayName 去掉鉴定门（还原旧泄露代码）**：`if (this.isIdentified)` →
`if (true)`。失败输出（节选）：

```
AssertionError: expected 'Sword +2' to be 'Sword'
AssertionError: expected 'Leather Armor -1' to be 'Leather Armor'
AssertionError: expected 'Mace +1' to be 'Mace'
（A1/A5/A6 三组共 6 条翻红；还原后 31/31 绿）
```

**RV2 — DetailGenerator 实际伤害段去掉鉴定门**：
`if (item.isIdentified && item.enchantment !== 0)` → `if (item.enchantment !== 0)`。

```
 FAIL ... A2: DetailGenerator 武器段反泄露 > 未鉴定武器只给基础伤害与力量需求
AssertionError: expected true to be false
Tests: 1 failed | 30 passed（还原后 31/31 绿）
```

**RV3 — 武器门槛 20 → 19**（`WEAPON_KILLS_TO_AUTO_ID = 19`）：

```
Tests: 2 failed | 29 passed
AssertionError: expected 19 to be 20        ← spawn 计数器断言
AssertionError: expected 'Leather Armor -1 (unknown runic)' to be 'Leather Armor -1'
                  ← 边界断言：第 19 杀提前揭示，连锁污染后续用例
（还原后 31/31 绿）
```

**RV4 — initConsumables 注释掉 `identifiedItems.clear()`**：

```
Tests: 3 failed | 28 passed
AssertionError: expected true to be false   ← A9：上一局的 potion_of_life 漏进新局
（还原后 31/31 绿）
```

**RV5 — spawnWeapon 注入一次额外掷骰 `rng.randPercent(100)`（模拟移动 RNG 流）**：

```
Tests: 3 failed | 28 passed
AssertionError: seed=42 的物品生成签名漂移——RNG 流被移动了:
  expected [ '797cbf34', '33d60b83', …(24) ] to deeply equal [ 'c2cc20da', '70d5549a', …(24) ]
（还原后 b_1a + generation_baseline 合跑 32/32 绿）
```

---

## 6. 与预设不符之处（只列不修；含对任务书/B-0 的反驳）

### 6.1 ★ B-0 §1.4 表格第 2 行有误：identify 卷轴**会**自亮

B-0 与本任务书都写"卷轴用完自亮的例外：enchanting 与 identify 自己"。
CE 源码不支持后半句——`readScroll` 的 `case SCROLL_IDENTIFY`（Items.c:7776-7781）
在让玩家选目标**之前**就 `identify(theItem)`（实例+种类全亮）并宣告
`"this is a scroll of identify."`；末尾通用自亮块（8019-8026）把 identify 排除，
只是因为它的种类在 case 里已经亮过（避免重复跑 autoIdentify/再发一条消息）。
语义上也自洽：消息直接告诉玩家这是鉴定卷轴，种类没有可藏性；enchanting
卷轴的效果发生在别的物品上、消息不点名卷轴身份，所以它才永不自亮。
**已按 CE 实现**：读 `scroll_of_identify` 时先自亮+宣告（新键
`scroll.reveal_identify`），例外清单只含 `scroll_of_enchantment`。
A10 有对应断言锁死此行为。

### 6.2 任务书预授权清单的文件路径与翻红预告

- `itemFlavors.test.ts` 实际在 **`src/engine/Items/`** 而非任务书所写 `src/test/`
  下（git 历史确认从未在 src/test 出现过）。已按实际路径核查，零改动。
- B-0 §5.4-② 预告 B-1a 会翻红 `armor_runic_effect`/`b_1_weapon_specials` 等
  5 个文件——实测全部未翻红（§5.2 逐条理由）。预告偏保守，不是错误。

### 6.3 web 药水表缺 `potion_of_speed`（CE 有 "speed" 药水，GlobalsBrogue.c:670）

升格规则的极性表里我预置了 `potion_of_speed: 1`（CE 原值，B-4 补目录时直接
生效），但 A11 测试初版按 8 种善意药水设计断言即被此缺口绊出。web `quaffItem`
里有 `'speed'` effect 分支（`potion.speed` 文案）却没有任何 json 条目使用它——
效果代码是死分支。**只登记**：目录缺口归 B-4（与 B-0 §5.1-9 的缺口清单合并）。

### 6.4 其余登记（执行中发现，均未动手）

1. **升格规则的 D2 结构性死支**（§2 末段）：恶意药水类升格在 poison/creeping_death
   回池前不可达。极性表已按 CE 全表建好，回池即活。
2. **deserialize 的暂时副作用**：读档后开局三件套（匕首/飞镖/皮甲）的
   `identified` 暂时回落为 false（displayName 从 "Dagger" 不变——附魔 0 无差异，
   但若 B-1b 落地前玩家给开局匕首附魔…… enchantEquippedItem 也不亮实例，
   显示上无差异；登记仅为完备）。B-1b 持久化后自然消除。
3. **`useArcanaItem` 对魔杖/法杖"用一次必亮种类"是既有简化**（CE 只在弹道产生
   可观察效果时亮，Items.c:7399-7409 由 autoID 旗标驱动）。本轮未改——web 的
   use 必定产生可观察效果（bolt 或特效），行为差异仅在"零效果的施放"上，
   web 没有该路径。B-2 做投掷命中时若引入"可落空"的施放，需回头看这条。
4. **怪物详情面板的"你命中它 X%"用玩家武器真实净附魔计算**，不查武器鉴定态
   ——严格说也是一处"泄露"（命中率差异间接反映附魔）。CE 侧怪物详情同样用
   真实值算玩家命中（sidebar 无鉴定门），故本轮判定为对齐而非泄露，只登记。
5. **B-0 §2.1 称"卷轴自亮例外缺失"的位置在 Game.ts:3112**——本轮实测该块在
   readItem 尾部自亮统一块（行号漂移至 ~3130），例外已按 §6.1 的正确口径补上。

---

## 7. 门禁输出

**`npx vitest run --fileParallelism=false` 串行全量（2026-09-17 06:29，最终树，
完整日志 /tmp/b1a_final_gate.log，exit 0）：**

```
 RUN  v4.1.11 /private/tmp/claude-501/.../wt-b-1a/brogue-web

 Test Files  75 passed (75)
      Tests  879 passed | 8 skipped | 5 todo (892)
   Start at  06:29:37
   Duration  1134.78s (transform 670ms, setup 0ms, import 9.22s, tests 1119.21s, environment 12ms)
```

（75 文件零红。第一轮全量曾 1 红——`p1_30_i18n_gate` 死键 `item.unknown_runic`：
我把 `i18next.t()` 写在了模板字符串的 `${}` 里，而 i18n 扫描器的词法机遇到
反引号会整体跳过模板（含插值），调用点因此不可见。已把调用提到语句层并在
Item.ts 留注释；无其他同类调用点（全库 grep 复核）。修复后最终树重跑全量
即上面这组输出。运行期间无 `Test timed out` 假红，与 C-5 的并行未产生干扰。）

**generation_baseline 保持绿**（单独实跑输出，§4 已引；全量套件内同绿）。

```
> npm run build（最终树，2026-09-17）

(!) Some chunks are larger than 500 kB after minification. Consider:
- ...
✓ built in 1.37s
```

```
git status --porcelain（终态）：
 M brogue-web/src/engine/Core/Game.ts
 M brogue-web/src/engine/Items/Item.ts
 M brogue-web/src/engine/Items/ItemLoader.ts
 M brogue-web/src/engine/UI/DetailGenerator.ts
 M brogue-web/src/locales/zh_CN.json
?? brogue-web/ai_docs/b_1a_identification_report.md
?? brogue-web/src/test/b_1a_identification.test.ts

git diff --stat：
 brogue-web/src/engine/Core/Game.ts          | 133 ++++++++++--
 brogue-web/src/engine/Items/Item.ts         |  99 +++++++--
 brogue-web/src/engine/Items/ItemLoader.ts   | 310 ++++++++++++++++++++++++++++
 brogue-web/src/engine/UI/DetailGenerator.ts |  51 +++--
 brogue-web/src/locales/zh_CN.json           |   6 +
 5 files changed, 549 insertions(+), 54 deletions(-)
新增测试：src/test/b_1a_identification.test.ts（31 条）
临时文件：zz_b1a_probe.test.ts / zz_dbg_a12.test.ts 均已删除
```

---

## 8. 给 B-1b / B-2 / B-1c 的登记清单

**B-1b（持久化与交互）**：
1. 快照需新增：`identifiedItems`（种类集）、实例 `identified`/`canBeIdentified`/
   `maxChargesKnown`/`timesUsed`（`charges` 已随现有 schema 持久化，武器/护甲/
   戒指的熟悉度计数已在档内）；`deserializeItem` 里本轮按 spawn 语义重建未知态
   的分支整体可删。留痕测试"鉴定态不进存档"待反转（测试名已注明）。
2. call/inscribe：`identifiedItems` 旁需加 `callTitles: Map`；displayName 三态
   （真名/called/风味）的 called 分支还没写。
3. identify 卷轴目标指定 UI（CE promptForItemOfType）——`identifyRandomItem`
   已按 `canBeIdentified` 备好目标池，UI 只需把"随机挑一个"换成"玩家挑"。
4. 移除 `uncurseItem`/`rechargeArcanaItem` 免费按钮（留痕已注明）；注意
   `removeCurseFromInventory` 清负附魔的偏差（B-0 §5.3-5/9）仍未动。
5. 戒指双槽：`processIncrementalAutoID` 的调用方要遍历 `ringLeft/ringRight`
   （CE 三槽语义已在 `decrementWornFamiliarity` 的单件粒度上就绪，循环展开即可）。

**B-2（投掷）**：
1. 投掷武器命中应走 CE Combat.c:1427 同款 `decrementWeaponAutoIDTimer`
   （投掷击杀也计入武器熟悉度——CE `hitMonsterWithProjectileWeapon` 内
   magicWeaponHit/MB_WEAPON_AUTO_ID 同链）。web 钩子目前在近战出口。
2. `throwItemAt` 的药水自亮分支要按 Items.c:6988-7050 细分"7 种功能性药水才亮"
   （本轮保持既有的"全部亮"简化，注释已标）。
3. 留痕"投掷仍是传送+落地"待反转。

**B-1c（detect magic 极性）**：
1. `ItemLoader.isPolarityRevealed()` 恒 false 留形；接上 detect magic 时改为读
   真实状态，升格规则的极性半支即激活。
2. `MAGIC_POLARITY` 表可直接复用（CE 五张表的极性列，行号在注释）。
3. 恶意品使用确认（"Really drink a cursed potion?"）与地面 sigil 渲染同轮。
4. 留痕"detect magic 只亮种类"待反转。

**B-4（生成规则对齐）**：
1. `potion_of_poison` 回池（CE 原生 caustic gas 被误退池）→ 恶意药水升格链
   半激活；`potion_of_creeping_death` 效果重写为种地衣后回池 → 全激活。
2. 补 `potion_of_speed` 目录（§6.3）。
3. 落地后按 B-0 §4.6 重采生成基线 + 本文件 A13 哨兵签名（哨兵测试头注释已写明
   重采义务）。
