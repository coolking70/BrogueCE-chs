# B-1c：detect magic 极性揭示 —— 执行方报告

> 执行方：Claude（对照实验轮）。工作树 `wt-b-1c`，未执行任何 git 写操作。
> CE 权威路径：`BrogueCE-master/src/brogue/`（只读）。

---

## 一、CE 极性模型（逐行复核，行号为本机 CE 源码实际行号）

### 1.1 两个字段（`Rogue.h:1435-1436`）

```c
typedef struct itemTable {
    ...
    boolean identified;            // :1433
    boolean called;                // :1434
    int magicPolarity;             // :1435
    boolean magicPolarityRevealed; // :1436
    char description[1500];
} itemTable;
```

- `magicPolarity` 是**种类固有**的静态数据列（+1 善意 / −1 恶意 / 0 无极性），
  写死在五张种类表里：药水 `variants/GlobalsBrogue.c:665-682`、卷轴 `:684-699`、
  魔杖 `:701-711`、法杖 `brogue/Globals.c` staffTable、戒指 ringTable（全 +1）、
  护符 charmTable（全 +1）。
- `magicPolarityRevealed` 是**运行期**状态，只有两个写点：
  `detectMagicOnItem`（`Items.c:8030`）置真，`resetItemTableEntry`（`Items.c:8777`）
  新局清零。读点两个：`tryIdentifyLastItemKind`（`:6648`）与
  `magicPolarityRevealedItemKindCount`（`:6618`），以及
  `itemMagicPolarityIsKnown`（`:5939`，投掷自动选敌用）。

### 1.2 `itemMagicPolarity()`（`Items.c:8267-8299`）——这一「件」的极性

**它不是 `magicPolarity` 的同义词。** 逐分支：

| 类别 | 取值来源 |
|---|---|
| WEAPON / ARMOR | 实例：`ITEM_CURSED \|\| enchant1 < 0` → −1；`enchant1 > 0` → +1；否则 0 |
| WAND | `charges == 0` → 0；**否则 fallthrough 到表查** |
| SCROLL / POTION / CHARM / STAFF | 种类表 `magicPolarity` |
| RING | 实例：与武器/护甲同构（**压过 ringTable 的全 +1**） |
| AMULET | 恒 +1 |
| 其它（食物/金币/钥匙） | 0 |

web 侧实现：`ItemLoader.itemMagicPolarity(item)`，逐分支一一对应。

### 1.3 `detectMagicOnItem()`（`Items.c:8027-8038`）——三件事

```c
static void detectMagicOnItem(item *theItem) {
    if (theItem->category & HAS_INTRINSIC_POLARITY) {          // Rogue.h:768
        tableForItemCategory(...)[kind].magicPolarityRevealed = true;
    }
    theItem->flags |= ITEM_MAGIC_DETECTED;                      // Rogue.h:1372
    if ((theItem->category & (WEAPON | ARMOR))
        && theItem->enchant1 == 0                               // ★ 是 == 0，不是 <= 0
        && !(theItem->flags & ITEM_RUNIC)) {
        identify(theItem);
    }
}
```

`enchant1 == 0` 的语义：零附魔无符文的武器/护甲**没有秘密可留**，
照到即全亮；**负附魔的诅咒品不白送鉴定**（写成 `<= 0` 就送了，对抗测试 D8 钉这条）。

### 1.4 `POTION_DETECT_MAGIC`（`Items.c:8137-8185`）——三轮遍历 + 收口

1. 地面物品（`floorItems`，`CAN_BE_DETECTED` 过滤，`Rogue.h:770`）→
   `detectMagicOnItem`；有极性的额外 `pmapAt(loc)->flags |= ITEM_DETECTED` 供地面 sigil；
2. 怪物携带品 `monst->carriedItem`；
3. 背包物品；**自身除外**（`:8164` `tempItem != theItem`，注释原文：
   不许探测魔法药水探测它自己）；
4. 有效果 → `tryIdentifyLastItemKinds(HAS_INTRINSIC_POLARITY)`（`:8172`）+
   三选一消息；无效果 → 「感到没有魔法」。

### 1.5 升格规则里的极性——**两个**入口（`Items.c:6609-6653`）

```c
if (theItemTable[lastItemKind].magicPolarityRevealed          // 入口 A（:6648 前半）
        || oppositeRevealedCount == oppositeCount) {          // 入口 B（:6648 后半）
    theItemTable[lastItemKind].identified = true;
}
```

而 `oppositeRevealedCount` 来自 `magicPolarityRevealedItemKindCount`（`:6609-6624`），
它的计数条件是：

```c
theItemTable[i].magicPolarity == polarityConstraint
    && (theItemTable[i].identified || theItemTable[i].magicPolarityRevealed)   // :6618
```

**`|| magicPolarityRevealed` 就是第二个入口。** 这一点下面 §四要用。

---

## 二、`magicCharDiscoverySuffix(...) == -1` 前置条件在做什么

### 2.1 它本身（`Items.c:8213-8262`）

CE 注释原文即说明用途：发现屏（Discoveries screen）的后缀，
1 = 好、−1 = 坏、0 = 说不准。它是一张**与种类表并行的硬编码开关表**，不读 `magicPolarity`：

- POTION：−1 名单 = hallucination / incineration / descent / poison / paralysis /
  confusion / lichen / darkness，其余 +1；
- SCROLL：−1 名单 = aggravate monsters / summon monsters，其余 +1；
- WAND / STAFF：查 `boltCatalog[table[kind].power].flags & BF_TARGET_ALLIES`；
- **RING：恒 0**（`:8250-8252`）——**与 ringTable 全 +1 的 `magicPolarity` 明确不同**；
- CHARM：恒 1。

我逐条比对了 POTION/SCROLL 的 −1 名单与 `potionTable_Brogue` / `scrollTable_Brogue`
的 `magicPolarity` 列（`GlobalsBrogue.c:665-698`）：**完全一致**。
所以对药水/卷轴两类，两者可以查同一张表；对戒指/法器则不能。

### 2.2 两个消费点（`Items.c:7757-7767` 读卷轴 / `8050-8060` 喝药水）

```c
if (magicCharDiscoverySuffix(theItem->category, theItem->kind) == -1
    && ((theItem->flags & ITEM_MAGIC_DETECTED) || potionKind.identified)) {
    ... confirm("Really drink a potion of %s?" / "Really drink a cursed potion?")
    if (!confirm(...)) return false;
}
```

**作用 = 恶意品使用前的误操作保护，且它自带反泄露。** 两个析取项缺一不可：

- 漏掉 `== -1`：连生命药水都弹确认（噪音）；
- 漏掉后半段：一瓶从没鉴定、也从没被 detect magic 照过的未知瓶子突然弹出
  「真的要喝这瓶**被诅咒的**药水吗」——**等于免费剧透**，与 B-1a §2.3 反泄露
  同一类错误。

还有一个容易抄漏的细节：后半段读的是**实例**旗标 `ITEM_MAGIC_DETECTED`，
**不是**种类级的 `magicPolarityRevealed`。CE 在这里刻意用实例粒度
（你在别处照过同种类的另一瓶，不等于手上这瓶你认得）。web 照抄了这个粒度。

---

## 三、载体盘点（任务书 §二.4）

**结论：载体齐备，`src/data/*.json` 一个字没动。**

| 需要的载体 | web 现状 | 结论 |
|---|---|---|
| detect magic 药水 | `src/data/consumables.json` 有 `potion_of_detect_magic`，`effect: "detect_magic"`，**未标 `excludeFromGeneration`**（在生成池内） | ✅ 有 |
| 效果分派点 | `Game.quaffItem` 的 `case 'detect_magic'`（原来只 log 一句） | ✅ 有 |
| 地面物品链 | `Game.items`（本层地面物品数组） | ✅ 有 |
| 背包链 | `player.inventory.items` | ✅ 有 |
| 恶意药水/卷轴（确认闸的被测对象） | incineration / paralysis / descent / confusion / hallucination / creeping death；summon monsters | ✅ 有 |
| **怪物携带品** | `Monster`/`Creature` **无 `carriedItem` 字段**（全库 grep 零命中） | ❌ 结构性缺载体，留痕钉住 |
| **地面 sigil 渲染**（pmap `ITEM_DETECTED`） | `Grid.Cell` 无对应旗标；渲染层不在本轮允许清单 | ❌ 边界外，留痕钉住 |
| **`magicCharDiscoverySuffix` 的 WAND/STAFF 分支** | web 无「法器种类 → bolt 旗标」表（`MONSTER_BOLT_TABLE` 是怪物施法用的，按 CE bolt 名索引，不含 wand/staff 的 `power` 列） | ❌ 结构性缺载体，恒 0，留痕钉住 |

三条缺载体的都写了**显式留痕测试**（断言现状 + 注明反转轮次），
没有接成空转链（C-4c 硫矿的教训）。

---

## 四、★ B-1a 那条预测的验证结论：**只对了一半**

B-1a 报告 §8「给 B-1c」第 1 条写的是：

> `ItemLoader.isPolarityRevealed()` 恒 false 留形；接上 detect magic 时改为读
> 真实状态，**升格规则的极性半支即激活**。

**实测：把 `isPolarityRevealed()` 改为读真实状态，只激活了两个入口中的一个。**

- **入口 A**（`Items.c:6648` 前半，`theItemTable[lastItemKind].magicPolarityRevealed`）
  —— 确实就是 `isPolarityRevealed(lastKind)` 那一句，改完即活。预测命中。
- **入口 B**（`:6648` 后半 `oppositeRevealedCount == oppositeCount`）
  —— B-1a 把它实现成了

  ```ts
  const oppositeAllIdentified = opposite.every(k => this.identifiedItems.has(k));
  ```

  **漏掉了 CE 计数函数 `:6618` 里的 `|| theItemTable[i].magicPolarityRevealed`。**
  也就是说：对侧极性类「全部被 detect magic 照过但一个都没鉴定」时，CE 会升格，
  B-1a 的写法不会。这一条**不是**接上 `isPolarityRevealed` 就能激活的，
  必须单独改计数口径。

本轮已修（`ItemLoader.polarityKnownCount()`），并由对抗测试
「入口B：对侧极性类的极性**全部已知**」钉住；反向验证 RV4 把它改回 B-1a 的旧写法，
该条立刻翻红（输出见 §七）。

> 教训归纳（建议写进 project_conventions）：**「留形挂点」只保证了它自己那一句
> 能被接上，不保证同一条 CE 规则的其它分支也被完整移植。** 激活轮必须把
> 整条 CE 规则重读一遍，而不是只看留形函数的调用点——这与「照抄留形的死分支
> 不受任何测试保护」（2026-09-17 G-2 条）是同一个盲区的两种形态。

---

## 五、与预设不符之处（只列不修的除外，已修的注明）

### 5.1 ★ B-1a / B-0 的事实错误：web **有**速度药水，id 叫 `potion_of_haste`（已修）

- B-1a 的 `MAGIC_POLARITY` 表里写的键是 `potion_of_speed`；
- `src/data/consumables.json` 里实际的 id 是 **`potion_of_haste`**
  （`trueName: "Potion of Speed"`、`effect: "speed"`，正是 CE 的 `POTION_SPEED`）；
- 后果：那个键**恒查不到**，速度药水此前落在「无极性（0）」，**完全不参与**
  善意药水分组 → 善意药水类被少算成 7 种；
- 连带：B-0 §5.1-9「web 缺速度药水（目录缺口）」的结论**不成立**，
  B-1a 报告 §6.3「补 `potion_of_speed` 目录」这条待办**应作废**（不是缺目录，是键写错）；
- b_1a 测试里那句「web 药水表无 potion_of_speed……善意类现为 7 种」的注释同样是错的。

本轮已在 `ItemLoader.MAGIC_POLARITY` 改正为 `potion_of_haste: 1`，并更新了
b_1a 测试里的那段注释（**只改注释，未动该用例的任何断言**——它断言的是
「不得升格」，与善意类是 7 种还是 8 种无关，改前改后都绿）。
善意药水类现为 **8 种**，由新测试 D5 显式断言。

### 5.2 CE 的 `magicPolarity` 与 `magicCharDiscoverySuffix` 对**戒指**结论相反

任务书 §二.1 把两者当成同一件事描述（「`magicPolarity`（+1/−1/0）与
`magicPolarityRevealed`」，然后 §二.2 让我去看 `magicCharDiscoverySuffix`）。
实际它们是两张独立的表：ringTable 的 `magicPolarity` 全 +1，而
`magicCharDiscoverySuffix(RING, *)` 恒 **0**（`Items.c:8250-8252`）。
本轮两者分别实现，并由测试「magicCharDiscoverySuffix：戒指恒 0」钉住差异。

### 5.3 web 卷轴目录缺口让「恶意卷轴」一照就被识别（符合 CE 规则，但结果与 CE 不同）

CE 恶意卷轴有两种（aggravate monsters + summon monsters）；web 只有
`scroll_of_summon_monsters`。于是 detect magic 照到它之后，恶意卷轴类
「只剩 1 种未识别 + 该种极性已揭示」恰好满足 `Items.c:6648` 入口 A，
**卷轴当场被连带识别成真名**。

这是**规则正确、目录不全**的真实后果，不是实现错。E2E 测试里显式断言了这条，
并注明：B-4 补上 aggravate monsters 后本条会自动变回「未识别」，届时改断言。
**只登记，未擅改 `src/data/*.json`。**

### 5.4 任务书 §二.2 的定位小误

任务书说「注意 `magicCharDiscoverySuffix(...) == -1` 那个**前置条件**（`Items.c:7757`
与 `8050` 各出现一次）」——措辞容易读成它是 `detectMagicOnItem` 的前置条件。
它不在 `detectMagicOnItem` 里，而是 `readScroll` / `drinkPotion` 的**使用前确认**闸。
行号 7757 / 8050 本机复核**准确**。

### 5.5 边界判断（需验收方裁决）

- **`InventoryOverlay.vue` 我除了极性 sigil，还加了「恶意品使用确认」行。**
  任务书写的是「**仅**极性显示」。我的理由：确认闸是极性系统在 UI 上的另一半，
  引擎里实现了却没有任何消费点，就成了本项目明令禁止的**空转链**（C-4c 硫矿）。
  若验收方认为越界，删掉该段 template/handler 即可，引擎侧
  （`requiresMalevolentUseConfirmation` / `confirmPendingUse` / `cancelPendingUse`）
  与测试不受影响。
- **`zh_CN.json` 我改了 1 个既有键的值**（`potion.detect_magic`），
  任务书写的是「仅增键」。理由：CE 的 detect magic 有四条互斥消息，
  原键的文案「你感知到了周围的魔法光环。」对应不上其中任何一条；
  若把它留着不用，`p1_30_i18n_gate` 的**死键断言会翻红**（该门禁不在允许清单里，
  不能改），删键又不是「增键」。三条路我选了「复用 + 校正文案」这条最小改动。
  新增 7 个键，改值 1 个，无删键。
- **`ItemLoader.MAGIC_POLARITY` 的键名修正**（§5.1）严格说是数据修正，
  但它在 `ItemLoader.ts`（允许清单内）而非 `src/data/*.json`（禁改），未越界。

### 5.6 只登记不修（任务书 §三已划走）

- `removeCurseFromInventory` 清负附魔的偏差（B-0 §5.3-5/9）——未动。
- 投掷（B-2）、三占位卷轴（B-3）、生成规则对齐（B-4）——未动。
- 生成器/地图（C-6 地盘）——未动，`git diff --stat` 可证。
- `itemMagicPolarityIsKnown`（`Items.c:5935-5943`）目前只被 CE 的投掷自动选敌
  （`canAutoTargetMonster`，`:5964`）使用；web 的投掷在 B-2，本轮不接。

---

## 六、实现清单

### 生产代码

| 文件 | 改动 |
|---|---|
| `src/engine/Items/ItemLoader.ts` | 新增 `magicPolarityRevealed:Set`、`HAS_INTRINSIC_POLARITY` / `CAN_BE_DETECTED` 类别集（**惰性 getter**，见下）、`kindPolarity()`、`isPolarityRevealed()`（留形挂点接真状态）、`itemMagicPolarity()`、`magicCharDiscoverySuffix()`、`detectMagicOnItem()`、`polarityKnownCount()`、`tryIdentifyLastItemKindsAllPolarityCategories()`；修 `tryIdentifyLastItemKind` 的对侧计数口径（§四）；修 `potion_of_speed` → `potion_of_haste`（§5.1）；`initConsumables` 清零极性揭示 |
| `src/engine/Items/Item.ts` | 新增实例旗标 `magicDetected`（≙ `ITEM_MAGIC_DETECTED`） |
| `src/engine/Core/Game.ts` | `applyDetectMagic()`（CE `:8137-8185`）；确认闸 `requiresMalevolentUseConfirmation` / `malevolentUseConfirmPrompt` / `gateMalevolentUse` / `confirmPendingUse` / `cancelPendingUse` / `pendingUseConfirm`；`quaffItem`/`readItem` 加 `confirmed` 形参；快照 `magicPolarityRevealed` 与 `GameSnapshotItem.magicDetected` 的读写两侧 + 旧存档兼容；新局/读档复位 `pendingUseConfirm` |
| `src/components/InventoryOverlay.vue` | 极性 sigil 列（CE `Items.c:3611-3625`：+1 → `⧳` U+29F3 实心带杠圆、−1 → `⧲` U+29F2 空心带杠圆、0 → `-` 黄；**未被照过的不显示任何符号**，护符除外）；恶意品确认行 |
| `src/locales/zh_CN.json` | 增 7 键、改 1 值（§5.5） |

**一个实现坑（记一笔）**：`HAS_INTRINSIC_POLARITY` / `CAN_BE_DETECTED` 最初写成
`static readonly ... = new Set([ItemCategory.POTION, ...])`，**构建绿、测试全崩**——
`ItemLoader.ts` 与 `Item.ts` 是循环依赖，静态字段初始化器在模块求值期就跑，
那时 `ItemCategory` 还是 `undefined`（`TypeError: Cannot read properties of
undefined (reading 'POTION')`）。改成 static getter 惰性构造即可。
与本项目既有的 `WATER_DEEP` 坑同源：**「构建绿 ≠ 运行期有值」**。

### 既有测试的到期断言（逐条）

只改了一处，且是任务书 §五明确授权的「极性留痕本轮反转」：

| 文件 | 原断言 | 为什么到期 | 反转后 |
|---|---|---|---|
| `src/test/b_1a_identification.test.ts`<br>`describe('留痕：detect magic 极性系统未实装（→ B-1c 反转）')` | `expect((ItemLoader as ...).magicPolarityRevealed).toBeUndefined()`<br>（「ItemLoader 上根本没有极性揭示这个状态」） | 本轮新增了 `ItemLoader.magicPolarityRevealed`，前提失效 | 改名为「已反转（B-1c）：detect magic 极性系统已实装」，断言新事实（极性状态存在且 detect magic 写进了它），并**保留两条越界守卫**：①揭示极性 ≠ 揭示真名（被照的焚化药水种类仍未识别、显示名仍是风味名）；②没被照到的种类不得被顺手揭示 |

另外改了 **两处纯注释**（不是断言）：文件头补一条 B-1c 更正说明、A11 第二例里
「web 药水表无 potion_of_speed……善意类现为 7 种」的错误注释（§5.1）。
**该用例的断言一字未动，改前改后都绿。**

- `src/test/b_1b_identification_persistence.test.ts`：**未改**（任务书授权「若极性需入档」，
  但极性持久化的断言我写在新文件里，没有必要动它，也没有任何既有断言到期）。
- `src/test/scroll_effects.test.ts`：**未改**（授权了但无断言到期；恶意卷轴确认闸
  只在「已照过/已鉴定」时触发，该文件的卷轴都是新造未知实例，全部不触发）。
- **未放宽任何守卫性质的断言。**

### 新增测试：`src/test/b_1c_detect_magic.test.ts`（25 条）

对抗性组 D1–D9 + X1 + 三组留痕，每条的「具体错误实现」对照写在文件头。
覆盖任务书 §六要求的全部六项：

| §六要求 | 本文件对应 |
|---|---|
| 极性揭示后仍显示为未知 | D1 第 1 例（显示名仍是风味名、种类仍未识别） |
| `magicPolarity` 正负号写反 | D2（善意 4 种 / 恶意 5 种 + 卷轴两极逐条） |
| `magicCharDiscoverySuffix == -1` 前置条件漏掉 | D4 共 5 例（两个析取项各自单独钉） |
| 升格规则的极性半支没被激活 | D5 入口A / 入口B + 守卫例 |
| 极性状态进存档 | D6（种类级 + 实例级 + 新局清零 + 旧存档兼容） |
| RNG 流被移动 | D7 哨兵（**构造地图口径**，对 C-6 改生成器免疫） |

额外：D3（实例 vs 种类分流，含护身符/安卡恒 +1）、D8（`== 0` 不是 `<= 0`）、D9（CAN_BE_DETECTED 类别集）、
X1（待决确认态不跨场景泄漏）。

---

## 七、反向验证（5 条，全部真改真跑真还原）

还原后 `grep -rn "REVERT-ME" src/` = **0**。

### RV1：`detectMagicOnItem` 把种类写进 `identifiedItems` 而不是 `magicPolarityRevealed`

```
 ❯ src/test/b_1c_detect_magic.test.ts (24 tests | 4 failed) 4016ms
     × 照过之后：种类极性已揭示、实例 magicDetected 为真，但种类仍未识别、显示名仍是风味名 460ms
     × 背包与地面各有带极性的物品 → 两处都被照到，且极性揭示落在种类上 166ms
     × 背包空、地面空 → 只报"感到没有魔法"，不产生任何极性揭示 165ms
     × 存读一轮：两级状态都往返；新局清零（CE resetItemTableEntry :8777） 161ms

 FAIL  ... > 照过之后：种类极性已揭示、实例 magicDetected 为真，但种类仍未识别、显示名仍是风味名
AssertionError: expected false to be true // Object.is equality
 ❯ src/test/b_1c_detect_magic.test.ts:87:73
     87|         expect(ItemLoader.isPolarityRevealed('potion_of_incineration')…
```

### RV2：删掉确认闸的 `magicCharDiscoverySuffix(...) !== -1` 前置判断

```
 ❯ src/test/b_1c_detect_magic.test.ts (24 tests | 2 failed) 6199ms
     × 善意药水永不弹确认（漏掉 `== -1` 的实现在此翻红） 251ms
     × 读恶意卷轴走同一条闸（CE :7757-7767） 360ms

 FAIL  ... > 善意药水永不弹确认（漏掉 `== -1` 的实现在此翻红）
AssertionError: expected true to be false // Object.is equality
 ❯ src/test/b_1c_detect_magic.test.ts:210:62
    210|         expect(game.requiresMalevolentUseConfirmation(life)).toBe(fals…
```

### RV3：在 `applyDetectMagic` 开头注入 `rng.randRange(1, 6)`

**这一条第一次跑没翻红——哨兵当时是漏的，反向验证抓住了我自己的测试缺陷。**
第一版哨兵只直接调 `ItemLoader.detectMagicOnItem(...)`，没有盖住
`Game.applyDetectMagic` 本体：

```
 Test Files  2 passed (2)        ← 注入了额外掷骰，哨兵与 generation_baseline 双双假绿
      Tests  25 passed (25)
```

把哨兵改成直接调用 `applyDetectMagic` 本体后（走 `quaffItem` 不行——它会连带
`playerTurnEnded`，怪物 AI 有掷骰，增量口径就失守），同样的注入立刻翻红：

```
 ❯ src/test/b_1c_detect_magic.test.ts (24 tests | 1 failed) 5987ms
     × 极性揭示全链零掷骰消耗 329ms

 FAIL  ... > B-1c D7：RNG 流哨兵（任务书 §四硬门禁） > 极性揭示全链零掷骰消耗
AssertionError: ★ 任何新增抽取在此翻红: expected 43 to be 42 // Object.is equality
 ❯ src/test/b_1c_detect_magic.test.ts:509:60
    509|         expect(rng.randomNumbersGenerated, '★ 任何新增抽取在此翻红').toBe(c0);
```

> 顺带一个对验收方有用的观察：**`generation_baseline` 对交互期新增的掷骰是瞎的**
> ——RV3 注入的那次抽取它全程绿。任务书说「`generation_baseline` 是硬门禁」是对的，
> 但它只管生成期；交互期必须靠本轮这种增量哨兵。这也正是 B-1b 建哨兵的理由。

### RV4：把升格规则的对侧计数改回 B-1a 的旧写法（只认 `identified`）

```
 ❯ src/test/b_1c_detect_magic.test.ts (24 tests | 1 failed) 6195ms
     × 入口B：对侧极性类的极性**全部已知**（identified 或 revealed 都算，CE :6617-6620） 325ms

 FAIL  ... > B-1c D5：最后一种类升格的极性半支已激活 > 入口B：...
AssertionError: CE magicPolarityRevealedItemKindCount 把 revealed 也算作"极性已知": expected false to be true
 ❯ src/test/b_1c_detect_magic.test.ts:338:75
```

（这条同时是 §四那个「B-1a 预测只对了一半」结论的可执行证据。）

### RV5：把 `detectMagicOnItem` 的 `enchantment === 0` 改成 `<= 0`

```
 ❯ src/test/b_1c_detect_magic.test.ts (24 tests | 1 failed) 3359ms
     × enchant==0 且无符文 → identify；enchant<0 或带符文 → 只打 magicDetected 7ms

 FAIL  ... > B-1c D8：零附魔无符文的武器/护甲被照到即全亮，负附魔的不得白送
AssertionError: 负附魔不是"零附魔"，CE 不白送鉴定: expected true to be false
 ❯ src/test/b_1c_detect_magic.test.ts:188:58
    188|         expect(cursed.identified, '负附魔不是"零附魔"，CE 不白送鉴定').toBe(false);
```

---

## 八、门禁

### `npm run build`（尾部）

```
dist/assets/WebGLRenderer-CivuEqH-.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-<hash>.js                 817.94 kB │ gzip: 248.79 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 3.68s
```

（`vue-tsc -b` 零错误；chunk 体积警告是既有的，与本轮无关。）

### `generation_baseline`（任务书 §四硬门禁：必须保持绿）

```
$ npx vitest run --fileParallelism=false src/test/generation_baseline.test.ts

 RUN  v4.1.11 .../wt-b-1c/brogue-web

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  10:50:14
   Duration  39.43s (transform 1.11s, setup 0ms, import 1.81s, tests 37.18s, environment 1ms)
```

**保持绿，fixture 未刷新。** 本轮全部改动都在交互期（喝药水之后的状态读写），
生成期一行没碰（`src/engine/Generator/` 与 `src/engine/Map/` 零改动，见 §八 diff --stat）。


### 全量 `npx vitest run --fileParallelism=false`（串行）

```
$ npx vitest run --fileParallelism=false        # 与 C-6 并行执行，同机争用 CPU

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/test/armor_model_effect.test.ts > 护甲模型改造前后配对对照（5 档 × 20 seed × 400 回合） > 聚合对比：玩家被命中率 / 累计受伤 / 死亡次数
Error: Test timed out in 180000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/test/armor_model_effect.test.ts:319:5
    319|     it(`聚合对比：玩家被命中率 / 累计受伤 / 死亡次数`, { timeout: 180_000 }, () => {
       |     ^

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 77 passed (78)
      Tests  1 failed | 931 passed | 8 skipped | 5 todo (945)
   Start at  10:52:10
   Duration  1655.40s (transform 1.49s, setup 0ms, import 12.14s, tests 1635.73s, environment 15ms)
```

#### 唯一一条红是**并行负载超时假红**，不是真失败

判据（按任务书「先单跑复核再下结论，报告里区分真失败与超时」）：

1. **错误类型是 `Test timed out in 180000ms`，零断言失败**——
   日志里 5 档数据全部跑完并打印（`[armor_model_effect] 板甲+3 …` 是最后一档），
   是被 180s 看门狗掐的，不是断言不成立；
2. **单跑复核绿**：

```
$ npx vitest run --fileParallelism=false src/test/armor_model_effect.test.ts

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  11:20:49
   Duration  95.86s (transform 222ms, setup 0ms, import 358ms, tests 95.42s, environment 0ms)
```

   全量里它耗时 **247s**，单跑 **96s**（2.6×），差值就是与并行轮次抢 CPU；
3. **前例完全一致**：`b_1b_identification_persistence_report.md` §0.3 记录了同一条
   测试在与 C-6 并行时被饿到 302s 撞 180s 超时、单跑 103s 绿。本轮是第二次复现；
4. **因果上也不可能是本轮引起的**：该测试是护甲命中率的 legacy/wired 配对模拟，
   全程不喝药水、不读卷轴、不碰鉴定态；本轮改动零新增掷骰
   （哨兵 D7 + `generation_baseline` 双重钉住）。

> 建议验收方考虑把这条测试的 `timeout` 从 180s 提到 360s（它不在本轮允许清单里，
> **未动**）。这已经是同一条测试第二次因并行负载假红了。

**除此之外：78 个测试文件、945 条用例，931 绿 / 8 skip / 5 todo，零断言失败。**


### `git diff --stat`

```
 brogue-web/src/components/InventoryOverlay.vue  |  65 +++++++++
 brogue-web/src/engine/Core/Game.ts              | 169 +++++++++++++++++++++-
 brogue-web/src/engine/Items/Item.ts             |   7 +
 brogue-web/src/engine/Items/ItemLoader.ts       | 191 ++++++++++++++++++++++--
 brogue-web/src/locales/zh_CN.json               |   9 +-
 brogue-web/src/test/b_1a_identification.test.ts |  35 ++++-
 6 files changed, 453 insertions(+), 23 deletions(-)

未跟踪（新增）：
 brogue-web/src/test/b_1c_detect_magic.test.ts
 brogue-web/ai_docs/b_1c_detect_magic_report.md
```

---

## 九、给下一轮的登记清单

**B-2（投掷）**
1. CE `canAutoTargetMonster`（`Items.c:5956-5966`）用
   `itemMagicPolarityIsKnown(theItem, MAGIC_POLARITY_BENEVOLENT)` 把
   「已知善意的药水」排除出自动选敌目标——本轮已备好
   `itemMagicPolarity` + `magicPolarityRevealed` + `magicDetected` 三块料，
   接上即可（`itemMagicPolarityIsKnown` 的判据是
   `(实例 MAGIC_DETECTED|IDENTIFIED) || (种类 identified|magicPolarityRevealed)`，
   注意这里是**四项析取**，与确认闸的两项不同）。

**B-4（生成规则对齐）**
1. §5.1：`potion_of_speed` 目录缺口**不存在**，B-0 §5.1-9 / B-1a §6.3 的这条待办作废。
2. §5.3：补上 `scroll_of_aggravate_monsters` 后，`b_1c_detect_magic.test.ts` 的
   E2E 第一例里「summon monsters 被连带识别」那条断言会自动到期，需翻回「未识别」。
3. `potion_of_poison` / `potion_of_creeping_death` 回池后，恶意药水类的升格链才真正可达。

**渲染层轮次**
1. 地面 sigil：需给 `Grid.Cell` 加 `ITEM_DETECTED` 等价旗标 + 渲染
   （CE `Items.c:8144` 打旗标、`IO.c:1216-1234` / `Movement.c:204-220` 画）。
   `applyDetectMagic` 的地面遍历处已留注释，留痕测试在新文件尾部。

**怪物携带品轮次**
1. `Monster` 接上 `carriedItem` 后，`applyDetectMagic` 需补 CE `:8150-8157` 的
   第二轮遍历（只计 `hadEffectOnLevel`）。留痕测试在新文件尾部。

**法器 bolt 目录轮次**
1. `ItemLoader.magicCharDiscoverySuffix` 的 WAND/STAFF 分支恒 0 是**结构性留形**，
   激活轮**必须回 CE `Items.c:8243-8249` 逐字符重核**（「照抄留形的死分支不受
   任何测试保护」，2026-09-17 G-2 条）。留痕测试在新文件尾部。

**建议写进 `project_conventions.md`**
- §四归纳的那条：**留形挂点只保证它自己那一句能被接上，不保证同一条 CE 规则的
  其它分支也被完整移植**——激活轮必须重读整条 CE 规则，而不是只看留形函数的调用点。
- RV3 归纳的那条：**`generation_baseline` 对交互期新增掷骰是瞎的**，
  凡本轮新增交互期代码路径，哨兵必须**直接调用被测函数本体**，
  走完整回合的调用会被怪物 AI 的掷骰淹没。
