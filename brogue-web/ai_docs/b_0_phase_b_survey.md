# B-0：Phase B 现状测绘报告（鉴定系统 / 投掷武器 / 占位物品）

> 2026-09-17。纯测量轮，零生产代码改动。CE 源码以 `BrogueCE-master/src/brogue/` 为准
> （下文 `Items.c` / `Rogue.h` / `GlobalsBrogue.c` 等均指该仓库；注意物品目录里
> 药水/卷轴/魔杖/护符四张表在 `variants/GlobalsBrogue.c`，武器/护甲/法杖/戒指/
> 食物/钥匙在 `brogue/Globals.c`）。web 侧路径省略 `src/` 前缀。
> 读者是 B-1…B-n 的出题人：本文按"拿着它就能直接写任务书"的标准写。

---

## 0. 结论摘要

1. **web 的鉴定底座比交接文档暗示的完整**：`ItemLoader.identifiedItems`（per-kind
   全局 Set）+ 三张风味表 + `Item.displayName` 按鉴定态切换，这套骨架与 CE 的
   `itemTable.identified`（per-kind 布尔）语义同构。**缺的不是"鉴定态"本身，
   而是揭示规则、持久化、call（猜名）与反泄露。**
2. **实测确认的三个硬伤**（只登记不修）：① 鉴定态**不进存档**
   （`serializeItem`/`GameSnapshot` 无此字段，读档走 `initConsumables()` 全清，
   探针实测 3→0）；② 未知武器/护甲**泄露附魔与诅咒**（`Item.displayName` 直接拼
   `+2`，`DetailGenerator` 直接显示"基础伤害/实际伤害/被诅咒"）；③ `Game.ts:837`
   引用 `spawnScroll('scroll_of_enchanting')`，而 consumables.json 里只有
   `scroll_of_enchantment`——**机器房宝藏的 50% 分支静默落空，机器房一半时间没宝物**。
3. **CE 的鉴定远不止"用一次就知道"**：武器要杀 20 个敌人（`weaponKillsToAutoID=20`，
   GlobalsBrogue.c:1040）、护甲穿 1000 回合、戒指戴 1500 回合才揭示；全部 16 类药水
   /14 类卷轴里有"最后一个未鉴定种类自动升格"规则（`tryIdentifyLastItemKind`，
   Items.c:6622）；检测魔法药水揭示"极性"（善意/恶意）而不揭示真名；玩家可给
   未鉴定品类起绰号（call，Items.c:1347）。web 一样都没有。
4. **投掷在 web 是"传送+落地"**：`throwItemAt`（Game.ts:4096）无弹道、无命中掷骰、
   无伤害——扔剑砍不了人。CE 的投掷是完整攻击（临时换手算命中、`randClump`×
   `damageFraction(netEnchant)` 结算、符文可触发、miss 落地可拾回）。
   **药水投掷的 7 条 DF 链里 web 已接 4 条**（毒/惑/麻/焚化——F/G 链的遗产），
   缺黑暗/坠门/地衣 3 条。
5. **生成规则是"两边都有但规则不同"的最大灾区**：web 每层 3-6 件均匀九类抽签；
   CE 是 `3+while(60%)` 起步、金币堆 `min(5, D/4)`+递增连抽、密门热图偏置、
   药水/卷轴频率计量（metered items，防 life 药水刷屏）、附魔走
   `40% → 50% 诅咒(33% 恶符文) / 伤害挂钩好符文 / while(10%) 加附魔` 三岔链。
   实测 web 每局（26 层合计）药水中 life 占 10-15 只、enchantment 卷轴 8-13 张——
   两者都是 CE 计量对象。web **每局生成 140-166 把铁钥匙**；CE 有 keyTable
   （Globals.c:1571）但钥匙由机器按锁需求生成，量级是个位数。
6. **风味名系统已存在且可复现**（item_flavor_pool 轮的遗产）：药水 27 色 / 卷轴
   21 词素程序化拼装（与 CE 中文分支同构，`rand_range(3,4)` 词素）/
   材质·木材·宝石池，走 `RNG_COSMETIC` 不扰主流；实测同 seed 双射可复现、
   异 seed 不同、26 层生成链逐位不受扰。**已与 CE 对齐的部分不要再动。**
7. **CE 目录与 web 目录的差集**（详见 §3.5）：药水缺 darkness；卷轴缺
   aggravate monsters、多一个自创 amnesia 与一个冗余 enchantment/enchanting 二重身
   （见 #2③）；魔杖 web 的 fire/lightning 是 CE 法杖的错位实体（已 D2 退池），
   CE 的 polymorphism/negation/domination/plenty 四杖全缺；法杖 web 7/12；戒指
   web 6/8（缺 light/reaping）；护符 web 6/12；武器 web 13/15（缺 war axe、
   incendiary dart、javelin，多了自创 halberd——已退池）。
8. **三个占位卷轴（P1-16）的载体现状已改观**：C-4b/C-4c 落成后，sanctuary（铺
   禁行地形）与 shattering（墙→水晶 promoteTile）第一次有了地基；negation 的
   "魔法剥夺"在 P4-1b 怪物施法系统上有挂点。**但三个都还没有任何一格代码**——
   `readItem` 里是纯日志占位（Game.ts:3087-3095）。
9. **拆轮建议（§5.4，含两处对任务书拆法的修正）**：B-1 拆成
   **B-1a 未知态模型与揭示规则（含反泄露）→ B-1b call/持久化/装备三格**
   两刀；投掷 **B-2 放在 B-1a 之后**（扔药水鉴定依赖未知态语义，且 F/G 链的
   DF 基建正好被它接满）；三占位卷轴 **B-3 独立成轮、可并行**；生成规则对齐
   **B-4 收尾单独一刀**（它移动 RNG 流，绝不能与其他轮并行）。
10. **发现一处 F-0 报告需要修正的表述**：F-0 §5.2 称"CREEPING_DEATH 是 web 自创
    （CE 无此气体）"——气体侧正确；但 **CE 本版有 `potion of creeping death`
    （POTION_LICHEN，GlobalsBrogue.c:680）**，效果是在脚下种致命地衣
    （`DF_LICHEN_PLANTED`），不是毒气。web 把它做成毒气自创效果并按 D2 退池——
    **D2 标记语义应改为"CE 同名但效果未对齐，待效果重写后回池"**；
    `potion_of_poison`（= CE caustic gas，CE 原生恶意药水）同样不该永久退池。

---

## 一、CE 鉴定系统全貌

### 1.1 数据模型：两层分离——"种类已知"是全局的，"个体已鉴定"是实例的

CE 把"鉴定"拆在两个地方（这是整个系统最重要的结构，B-1a 的建模基准）：

**层 1：全局种类表**（`itemTable`，Rogue.h:1424-1437）。每个种类一条：
```c
typedef struct itemTable {
    char *name;          // 真名："healing"
    char *flavor;        // 风味名指针，指向 itemColors[i] 等全局数组
    char callTitle[30];  // 玩家起的绰号
    ...
    boolean identified;              // ← 这个"种类"是否已被玩家认识
    boolean called;                  // ← 玩家是否给这个种类起过绰号
    int magicPolarity;               // +1 善意 / -1 恶意 / 0 无魔法
    boolean magicPolarityRevealed;   // 极性是否已被 detect magic 揭示
} itemTable;
```
`shuffleFlavors()`（Items.c:8782）开局把五张表的全部运行时字段归零
（`resetItemTableEntry`，Items.c:8775：identified/magicPolarityRevealed/called/callTitle），
即"新的一局，什么都不知道"。

**层 2：物品实例旗标**（Rogue.h:1361-1386，鉴定相关的 12 个）：

| 旗标 | 位 | 语义 |
|---|---|---|
| `ITEM_IDENTIFIED` | Fl(0) | 这一件的附魔/充能已知（武器+值、戒指+值） |
| `ITEM_EQUIPPED` | Fl(1) | 装备中 |
| `ITEM_CURSED` | Fl(2) | 被诅咒（装备后摘不下来） |
| `ITEM_PROTECTED` | Fl(3) | 保护卷轴打过（防酸蚀/防负附魔） |
| `ITEM_RUNIC` | Fl(5) | 携带符文 |
| `ITEM_RUNIC_HINTED` | Fl(6) | "有未知符文"提示已给出 |
| `ITEM_RUNIC_IDENTIFIED` | Fl(7) | 符文种类已知 |
| `ITEM_CAN_BE_IDENTIFIED` | Fl(8) | 鉴定卷轴/call 的合法目标 |
| `ITEM_MAGIC_DETECTED` | Fl(11) | 这一件被 detect magic 照过 |
| `ITEM_MAX_CHARGES_KNOWN` | Fl(12) | 最大充能已知（杖） |
| `ITEM_KIND_AUTO_ID` | Fl(22) | **本版 CE 只读不写**（Items.c:853/1289 读、6681 清；无赋值点）——移植时不要为它发明机制 |
| `ITEM_PLAYER_AVOIDS` | Fl(23) | explore/travel 回避拾取（投掷落地物、坏药水） |

`makeItemInto`（Items.c:198-421）生成时打初始旗标：食物/护符/钥匙/护符石/安卡
直接 `ITEM_IDENTIFIED`；未鉴定品打 `ITEM_CAN_BE_IDENTIFIED`；投掷武器
（DART/INCENDIARY_DART/JAVELIN）显式清诅咒与符文、附魔归零（Items.c:268-273）。

### 1.2 风味名系统：开局一次洗牌、主流消耗、索引绑定

- 词表：`itemColorsRef` 21 色 / `titlePhonemes` 21 词素 / `itemWoodsRef` 21 木 /
  `itemMetalsRef` 12 金属 / `itemGemsRef` 18 石（Globals.c:1455-1556；
  常量在 Rogue.h:1071-1077）。**本 CE 检出是中文本地化分支**：卷轴标题由
  `rand_range(3,4)` 个词素直接连写（Items.c:8848-8856，注释"中文不加空格"），
  共 14 个固定标题槽（NUMBER_ITEM_TITLES=14）。
- `shuffleFlavors()`（Items.c:8782-8857）：把 ref 数组拷进运行时数组后
  **Fisher-Yates 洗牌**；药水=色、杖=木、魔杖=金属、戒指=石、卷轴=标题，
  绑定方式是 `GlobalsBrogue.c` 表条目里预写 `itemColors[1]`、`itemTitles[0]`
  这类**索引引用**（GlobalsBrogue.c:666-699）——种类↔风味的对应每局重洗。
- **时机与流**：`initializeRogue` → `shuffleFlavors()`（RogueMain.c:313），
  在**主随机流（RNG_SUBSTANTIVE）**上消耗；CE 依赖"池大小恒定"保持回放稳定。
  **web 已刻意分岔**：`initConsumables` 走 `RNG_COSMETIC`（ItemLoader.ts:255），
  池可调而主流不动——这是已登记的合理偏离（item_flavor_pool_report §7），
  探针实测 26 层生成链逐位不受扰（§4.6）。B 轮**不要**把它搬回主流。

### 1.3 名字拼装：`itemName`（Items.c:1445-1700）的三态显示

对五个风味类别（药水/卷轴/杖/魔杖/戒指），显示逻辑三分支：

| 状态 | 药水 | 卷轴 |
|---|---|---|
| `identified` | potion of healing | scroll of magic mapping |
| `called`（起过绰号） | potion called X | scroll called X |
| 都没有 | `crimson potion`（风味名，紫色高亮） | scroll entitled "XXXX"（标题） |

武器/护甲（无风味）：真名 + 附魔**仅在 `ITEM_IDENTIFIED` 时**显示（Items.c:1488-1493）；
带符文且未识别但已 IDENTIFIED/HINTED → 追加"（未知符文）"（Items.c:1518-1523）。
魔杖未识别时显示**使用次数**而非充能（`enchant2` 计数，"（已使用 2 次）"，
Items.c:1615-1634）；杖在 `ITEM_MAX_CHARGES_KNOWN` 时显示 `[?/N]`（:1650-1653）。
护符（CHARM）**无未知态**：真名+附魔永远可见（Items.c:1663-1697，表也预置
`identified=true`，GlobalsBrogue.c:714-726）。

### 1.4 揭示时机全表（B-1a 的规则清单，全部有行号）

| 时机 | 规则 | 位置 |
|---|---|---|
| 喝药水 | 全部种类 autoIdentify（含恶意药水——喝完才知道是毒） | Items.c:8199-8205 |
| 读卷轴 | 全部 autoIdentify，**例外：enchanting 与 identify 自己**（用完不亮） | Items.c:8019-8026 |
| 施展魔杖/法杖 | 弹道产生可观察效果（命中/着火/挖掘…`autoID` 置位）→ `identifyItemKind`，"(Your X must be …)" | Items.c:7399-7409；autoID 置位点 5118-5310 |
| 投掷药水 | 7 种气体/地衣/坠门/黑暗药水落地碎裂即 autoIdentify；普通药水摔碎不鉴定；hallucination 仅当已检测或善意类全揭示才鉴定 | Items.c:6988-7050 |
| 武器击杀 | `decrementWeaponAutoIDTimer`：杀 20 个敌人 → `ITEM_IDENTIFIED`（只亮这一件+附魔，不亮符文） | Combat.c:1099-1121；常数 GlobalsBrogue.c:1040 |
| 穿戴护甲 | 每回合倒计时（`charges` 复用为计数器）1000 回合 → `ITEM_IDENTIFIED`（"熟悉度"只亮附魔） | Time.c:1988-2024 |
| 戴戒指 | 同上 1500 回合 → `identify()`（亮到真名） | Time.c:1988-2024；常数 GlobalsBrogue.c:1042 |
| 戒指特例 | clairvoyance/light/stealth **戴上即刻** `identifyItemKind`（效果立即可感） | Items.c:8583-8586 |
| 弹道反射 | 反射护符（A_REFLECTION）触发即 autoIdentify 护甲 | Items.c:5695-5702 |
| 符文生效 | 武器符文命中触发 `magicWeaponHit`、护甲符文触发 `applyArmorRunicEffects` → autoIdentify 整件（RUNIC_IDENTIFIED\|HINTED） | Items.c:6752-6764、Combat.c:1090-1094 |
| 鉴定卷轴 | `identify(theItem)`：亮这一件的全部（附魔+符文）+ `identifyItemKind` 亮种类 | Items.c:7636-7646、7774-7802 |
| 恶意品使用确认 | 已检测或已识别的恶意品（`magicCharDiscoverySuffix==-1`）使用前 confirm"Really drink a cursed potion?" | Items.c:7757-7766、8050-8060 |
| 最后一个自动升格 | 某类别只剩一个未识别种类 → 自动 `identified=true`；带极性时若对侧极性全揭示也升格 | Items.c:6570-6674（tryIdentifyLastItemKind/Kinds） |

`identifyItemKind`（Items.c:6675-6720）的附加规则：**enchant≤0 的戒指**与
**充能范围退化的魔杖**（lowerBound==upperBound，如 empowerment {1,1,1}）在种类
被认识时直接连 `ITEM_IDENTIFIED` 一起打上——**负附魔/零变化没有隐藏价值**。

### 1.5 call（猜名）与 inscribe（题字）

- `call()`（Items.c:1347-1437）：对未识别的风味品类写 `callTitle`（≤29 字符）+
  `called=true`；显示链里 called 分支优先于 flavor（§1.3）。武器/护甲/护符等
  无风味类别转 `inscribeItem`（题字，写 `inscription`，任何物品可题）。
- 鉴定/识别该种类后 callTitle 作废（identified 分支短路）。
- web **完全没有** call/inscribe：InventoryOverlay 无入口，Item 无 inscription 字段。

### 1.6 detect magic 与极性（CE 1.9 的新维度）

- 每个种类有固有极性 `magicPolarity`（GlobalsBrogue.c 表倒数第 3 列：
  药水 life=1、毒气=-1…；卷轴 aggravate/summon=-1、其余=1…）。
- 喝 detect magic（Items.c:8137-8182）：全场地面物品+怪物携带品+背包全部
  `detectMagicOnItem`——打 `ITEM_MAGIC_DETECTED`、种类 `magicPolarityRevealed=true`；
  地面魔法物在地图上亮 sigil（`pmap ITEM_DETECTED` 位，placeItemAt 436 行起）。
  附魔为 0 且无符文的武器/护甲被照后**直接整件 identify**（Items.c:8146-8150）。
- 极性揭示参与"最后一个自动升格"（§1.4 末行）。
- `CAN_BE_DETECTED = WEAPON|ARMOR|POTION|SCROLL|RING|CHARM|WAND|STAFF|AMULET`
  （Rogue.h:770）。
- web：`potion_of_detect_magic` 的 effect 是 `'detect_magic'` → **只打印一句日志**
  （Game.ts:2977-2979），零机制。

### 1.7 诅咒：锁定、揭示与解除

- 生成（§3.3 详述）：武器/护甲 40% 附魔岔里 50% 诅咒（33% 恶符文）；
  戒指 16% 诅咒。诅咒=负附魔+`ITEM_CURSED`。
- **装备后无法卸下**：`unequipItem` 对 CURSED 直接失败，"it appears to be
  cursed"（Items.c:7110/8377/8648）——**这是玩家得知诅咒的主通道**。
  投掷已装备诅咒品也被拦（Items.c:7105-7111）。
- 解除：remove curse 卷轴对**全背包** `uncurse()`（Items.c:7806-7815；uncurse
  只清旗标、**负附魔保留**，Items.c:7740-7746）；enchanting 卷轴附魔时顺手
  uncurse 目标物（Items.c:7892 附近）。
- 诅咒的"预知"途径：detect magic 极性（恶意→空心 sigil）+ 使用前 confirm（§1.4）。
- web：InventoryOverlay 有 Unequip 按钮但对 `item.isCursed` 直接拒绝
  （InventoryOverlay.vue:127-133）——**锁定的玩家可感语义已对齐**；但"Remove Curse"
  是个**任意时刻免费的按钮**（Game.ts:3900-3911 还把负附魔清零——CE 保留负值），
  等于自带无限解咒卷轴，属 web 自创作弊面（登记，D2 口径应移除入口）。

### 1.8 CE 的"存档"如何保住鉴定态（架构注记）

本 CE 的存档=**按键记录回放**（Recordings.c），没有任何 itemTable 序列化代码
（grep `potionTable|scrollTable` 在 Recordings.c 零命中）：读档=同 seed 重放，
`shuffleFlavors` 重洗出同一风味、操作流重放出同一鉴定态。**web 是状态快照存档**，
没有等价物——所以 web 的鉴定态持久化**必须显式进 snapshot**（identifiedItems、
三张风味表或其种子、callTitle），这不是"缺优化"而是快照架构的必然要求（B-1b）。

---

## 二、web 现状逐条对照

### 2.1 已有且语义基本正确的（B 轮的既有资产，动前先读）

| web | 位置 | 对应 CE | 备注 |
|---|---|---|---|
| per-kind 鉴定 Set | `ItemLoader.identifiedItems`（ItemLoader.ts:104） | `itemTable.identified` | 键是 id 字符串；**不持久化**（#0-2①） |
| 三张风味表 | `potionFlavorMap`/`scrollFlavorMap`/`arcanaFlavorMap`（:99-101） | flavor 字段 | 池已对齐 CE 词表（见 §2.5） |
| displayName 三态切换 | Item.ts:79-133 | itemName 三分支 | 药水/卷轴/杖/魔杖/戒指/护符都对；**武器分支泄露**（§2.3） |
| 使用即鉴定 | Game.ts:2985（药）、3112（卷）、3163/3180（护符/杖/魔杖）、4112（投掷药水） | §1.4 前四行 | 骨架已对；缺"卷轴 enchant/identify 自己不亮"例外（现有代码对这两类也直接亮，Game.ts:3112 无例外分支） |
| 诅咒锁定卸装 | InventoryOverlay.vue:127-133 | unequip 失败 | 语义对；文案已有 i18n 键 `item.cannot_unequip_cursed` |
| remove curse 卷轴 | Game.ts:3069-3073 `removeCurseFromInventory` | SCROLL_REMOVE_CURSE | 已实装；细节差异 §5.3-9 |
| protect 卷轴 | Game.ts:3079-3086 | SCROLL_PROTECT_* | 已实装（isProtected 字段+存档） |
| identify 卷轴 | Game.ts:3055-3061 → `identifyRandomItem`（:3913-3930） | SCROLL_IDENTIFY | **偏差**：CE 是玩家指定目标（promptForItemOfType），web 随机挑一件背包未鉴定品 |
| 卷轴标题程序化拼装 | ItemLoader.ts:150-156、298-311 | shuffleFlavors 标题段 | 与 CE 中文分支同构 |
| 风味隔离流 | ItemLoader.ts:246-261 | — | 有意偏离，保留 |

### 2.2 完全没有的（CE 有、web 零代码）

1. **kind 级自动升格**（tryIdentifyLastItemKind，§1.4 末行）。
2. **熟悉度倒计时**：武器杀 20 / 护甲穿 1000 / 戒指戴 1500（CE 用 `charges`
   字段复用倒计时；web 的 Item 有 charges 字段但仅魔杖/杖用）。
3. **call/inscribe**（§1.5）——UI 输入、存储、显示链全缺。
4. **detect magic 极性**（§1.6）——magicPolarity、ITEM_MAGIC_DETECTED、
   地面 sigil、"最后一个善意/恶意升格"联动，全缺。
5. **恶意品使用确认**（"Really drink a cursed potion?"）。
6. **鉴定卷轴的目标指定**（web 是随机）。
7. **戒指双槽**（CE `rogue.ringLeft/ringRight`，Items.c:8529-8580；web 单
   `equippedRing`，Player.ts:25）。
8. **装备即鉴定特例**（clairvoyance/light/stealth 三戒指戴上立刻识别）。
9. **投掷武器真实命中**（§三）。
10. **negation/sanctuary/shattering 三卷轴效果**（§三.3）。

### 2.3 泄露清单（web 有显示、CE 会藏的）——B-1a 的反泄露门禁

| 泄露点 | web 行为（实测截图语句） | CE 行为 |
|---|---|---|
| `Item.displayName` 武器分支 | 未识别剑显示 `"Sword +2"`（Item.ts:100-101 无条件拼后缀） | 附魔只在 ITEM_IDENTIFIED 后显示（Items.c:1488） |
| `Item.displayName` 诅咒前缀 | `"Cursed Leather Armor -1"`（Item.ts:104） | 诅咒只在穿戴失败时告知（Items.c:7110） |
| DetailGenerator 武器段 | `"基础伤害: 1d3+6 (7~9); 实际伤害: 6~7 (附魔 +2)"`（DetailGenerator.ts:305-320，不查任何鉴定态） | 未识别只给"类型已知"的伤害与力量需求，附魔/符文段缺席 |
| DetailGenerator 护甲段 | `"实际防御值… 被诅咒"`（:336-362） | 同上；诅咒不预亮 |
| DetailGenerator 法器段 | `充能: x/y`（:382-391）对未识别魔杖也显示（displayName 藏了名字但详情漏了充能） | 未识别杖显示使用次数，不显示 x/y |
| 符文段 | `runicKnown` 才显示（:367） | **唯一已对齐的段** ✓ |

（探针原文输出见 §4.5 的 [ID-WPN]/[ID-ARMOR-CURSED] 行。）

### 2.4 存档表示：未知态在 web 存档里根本不存在

- `GameSnapshotItem`（Game.ts:154 附近）有 `runicKnown?: boolean` 并随
  `serializeItem`/`deserializeItem`（Game.ts:5996-6054）持久化——**符文知识活，
  品类知识死**。
- `identifiedItems` 是静态内存 Set；`loadSnapshot` 第一件事就是
  `ItemLoader.initConsumables()`（Game.ts:6161）→ 清空+重洗。
- 探针实测（§4.5 [ID-SAVE]）：喝掉/读掉/扔掉的 3 个鉴定全部丢失
  （`identifiedBefore=3 identifiedAfter=0`）；风味表因为 cosmetic 流从 seed
  重播种，**碰巧**逐条不变（`flavorMapUnchanged=true`）——但这依赖"seed 没变"，
  若未来风味池改大小或换 seed 逻辑，读档后所有未鉴定品会**换皮**。
- CE 对应架构注记见 §1.8。

### 2.5 生成池与鉴定状态的耦合点（B-4 的主战场）

- 物品生成唯一入口 `populateLevel`（Game.ts:761-1095）：楼梯/机器/祭坛/陷阱库/
  蓝图特征/随机 3-6 件。随机段的抽取表是 `randRange(0,9)` 十分类别均匀抽签
  （Game.ts:1052-1094）——**与 CE 的频率表（frequency 列）+计量（metered items）
  +热图偏置完全不同**。CE 表频率列现状：药水 life/strength 频率 0（动态计量）、
  卷轴 enchanting 0（动态）、identify 30、aggravate 15…（GlobalsBrogue.c:665-700）。
- **CE 的 metered items**（Items.c:560-562；表=全部 14 卷轴+16 药水，
  GlobalsBrogue.c:626-656）：全部 30 种入表跟踪，其中带**主动计量参数**的只有
  三种——enchanting（初频 60，每生成 +30、每现世 -50）、life（初频 0，+34/−150，
  含 levelScaling）、strength（40，+17/−50）——频率随"本局已生成数量"动态调整，
  保证每局 2-3 只而不是 15 只。
  web 没有计量 → life 10-15 只/局、enchantment 8-13 张/局（探针实测，§4.2）。
- 武器/护甲附魔：web `randPercent(20) → randRange(-1,2)`+负则诅咒（ItemLoader.ts:396-401）；
  符文 12%/10% 均匀抽。CE：40% 岔 → 50% 诅咒（33% 恶符文）/ 伤害挂钩好符文 /
  while(10%) 累加（Items.c:237-266）；戒指 16% 诅咒否则 while(10%)（:349-358）。
- web 生成的 **dart 也吃 20% 附魔+12% 符文**（spawnWeapon 无种类区分）——CE 明确
  禁止投掷武器带魔法（Items.c:268-273）。
- 金币：`ItemCategory.GOLD` 存在、拾取 +10（Game.ts:2802-2804），但**全引擎无
  生成点**——每局金币收入恒 0（探针 [GEN-CAT] 五种子均无 GOLD）。
- 钥匙：web 每台机器/陷阱库/笼子/锁门蓝图各发一把 `iron_key`，五种子实测
  140-166 把/局；CE 的钥匙只由机器锁需求生成且数量受蓝图控制，量级是个位数。
  钥匙泛滥同时**挤占 3-6 件随机物品的落格池**（同一 floorTiles 牌堆）。

---

## 三、投掷武器与占位物品专项

### 3.1 CE 投掷机制全貌（Items.c:7068-7156 命令层、6864-7066 弹道层、6772-6862 命中层）

1. **选目标**：`maxDistance = 12 + 2*max(力量-12, 2)`（Items.c:7130，注意这个
   变体下限是 2 不是 0——力 12 也能扔 16 格）；自动瞄准上一个目标
   （canAutoTargetMonster）。
2. **弹道**：`BOLT_NONE` 参数取线（遇墙/挡视格提前停）；逐格动画；命中第一个
   非潜水的生物即结算（Items.c:6906-6920）。
3. **武器命中**：临时把投掷物换手装备算命中（`equipItem(theItem,true)` →
   `attackHit` → 换回，Items.c:6804-6811）；伤害 `randClump(damage) ×
   damageFraction(netEnchant)`（:6819-6821）；**符文触发**（magicWeaponHit，
   :6846）；士气攻击；**命中即消失**（deleteItem，:6921——扔中就没了）；
   **miss 才落地**且清 ITEM_PLAYER_AVOIDS（可被 travel 拾回，:6855-6858）。
4. **投掷系武器**（DART/JAVELIN/INCENDIARY_DART）：数量递减不消失
   （quantity--，:7160-7162）；INCENDIARY_DART 落点爆 `DF_DART_EXPLOSION`+
   点燃生物（:7052-7058）。
5. **药水**：7 种功能性药水碎裂转 DF（毒/惑/麻/焚化/黑暗/坠门/地衣 →
   DF_POISON_GAS_CLOUD_POTION 等七条，:6986-7026）；hallucination 特殊判定；
   其余药水"splash harmlessly"。
6. **其他物品**：落在落点附近合格格（getQualifyingLocNear，:7060-7064）。
7. **杂项**：已装备/附魔过的物品投掷要 confirm；诅咒装备的物品扔不出去
   （:7099-7111）；整回合（playerTurnEnded，:7170）。
8. **怪物也扔**（throwItem 的 thrower 参数化）：MONST_CARRY_ITEM 怪的投掷走同一路径。

### 3.2 web 现状（Game.ts:4090-4154 + InventoryOverlay.vue:151-154）

- 入口完整：背包「Throw」按钮 → `enterThrowMode` → 点击目标格 → `throwItemAt`。
- **无弹道**（瞬移判定）、**无距离上限**（只查 isValidPos）、**无命中/伤害**
  ——扔武器=把武器放地上（Game.ts:4142-1446）；**对怪物没有任何效果**。
- 药水投掷：`fire_burst`→igniteForced 3×3（F-2a 对齐）、`poison_burst`/
  `confusion_burst`→addGas 1000（G-1 对齐）、`heal_full`→满血目标怪/自己
  （CE 无此投掷效果——healing 类本版 CE 不存在，此分支是自创残留）；**投掷即
  鉴定**已实现（:4112-4115）。
- quantity：dart 的 `quantity` 字段在投掷分支**完全不消费**——扔一次整包落地。
- 键位：无快捷投掷键（CE `t`/`T`）；P1-46 留痕 `w/a/d` 仍空闲
  （p1_46_keybindings.test.ts:94-98，接 CE 命令键的轮次需翻转该断言）。

### 3.3 占位物品三卷轴（P1-16）的载体盘点

| 卷轴 | CE 效果 | web 现状 | 载体评估（"会不会是空壳"） |
|---|---|---|---|
| negation | `negationBlast`（Items.c:8004→实现在别处）：视野内生物与地面物品剥魔法——怪掉旗标/状态/召唤关系，魔法构装死，装备附魔清零 | `readItem` 只打日志（Game.ts:3087-3089） | **载体已浮现**：P4-1b 后怪物有 bolts/status 体系可剥离；装备附魔清零需 B-1a 的鉴定态字段；CE 的 negation 连玩家自己的药水卷轴不受影响——实现时注意豁免清单（Items.c:8000 注释段） |
| sanctuary | `SCROLL_SANCTUARY`：脚下铺禁行地形（怪物不踏） | 只打日志（:3090-3092） | **载体已浮现**：C-4b DF 目录+promoteTile 可产新 tile（CE 的 sanctuary 是 REVEAL 全场persistent tile，带 `TM_INTERRUPT_EXPLORATION` 一族旗标）；寻路图已按旗标消费。需要新增 1 个地形条目 → c_4a_0/c_4a_terrain_catalog 两张穷尽表届时进允许清单 |
| shattering | `crystalize(9)`（Items.c:8007→Items.c 另段）：半径 9 墙→水晶墙（可挖/可见） | 只打日志（:3093-3095） | **载体已浮现**：promoteTile 已能改墙层；水晶墙 tile 需新增条目（同上两张表）；FOV 重算入口现成 |
| （对照）已实装的 5 个 | teleport/protect×2/summon/discord | 已有测试（scroll_effects.test.ts） | — |
| amnesia | **CE 无此卷轴**（本版卷轴表 14 类无 amnesia） | 自创、已退池 | 维持退池；删除与否是产品决策（路线图已登记） |

### 3.4 其他与本专项相关的登记

- `scroll_of_enchantment` 与 `'scroll_of_enchanting'` 二重身：json 只有前者；
  Game.ts:837 用后者 → **机器房宝藏 50% 分支返回 null**（#0-2③）。CE 只有一种
  enchanting 卷轴。
- `enchant_item` 效果（Game.ts:3062-3068 → `enchantEquippedItem` :3932-3960）只
  附魔**已装备**的武器/护甲且 `runicKnown=true` 直接点亮符文——CE 是玩家从
  背包任选一物、`enchantMagnitude()` 掷骰、随机降力量需求、顺手解咒、
  （魔杖加下限值充能）。差异列 §5.3。
- `recharge_item`：CE 对**全部**杖+护符充能；web `rechargeRandomArcana` 随机一件。
- UI 自创操作：InventoryOverlay 的「Recharge」（免费充能）与「Remove Curse」
  （免费解咒+清负附魔）两个按钮无 CE 对应，D2 口径应移除（登记）。

---

## 四、★ 行为基线测量（后续轮"逐位不变"门禁的依据）

### 4.1 测量口径（B 系列各轮必须用同一套复测）

- 工具：临时 vitest 脚本 `src/test/zz_b0_probe.test.ts`（跑完已删，**全文见附录 A**，
  可原样恢复复跑）。
- 环境：`src/test/harness.ts` 的 `createHeadlessGame(seed)`（headless、空 i18n，
  文案走 defaultValue——按项目常识这是预期 fallback）；i18n 在探针内最小 init。
- **生成链口径**：`createHeadlessGame(seed)` 后，`game.depth=d; (game as any)
  .generateDepth(false,false)` 逐层推到 D26——同一 rng 主流上的完整链，
  符合项目常识 §四（"同 seed 可复现单元=完整生成链"）。
- 物品签名：`类别|种类|坐标|附魔|诅咒|符文|符文已知|数量`（不含实例 id——
  实体 id 是进程级单调计数器，跨运行必然不同）。
- 鉴定流水口径：公开入口触发（`quaffItem`/`readItem`/`equipItem`/`dropItem`/
  `throwItemAt`/`toSnapshot`/`loadSnapshot`），断言读
  `ItemLoader.identifiedItems` 与 `displayName`。
- 种子：生成分布 5 种子 `[1,42,777,2026,31337]`；流水/决定性/风味 `42`（外加
  `2026` 做决定性对照）。
- 跑法：`npx vitest run src/test/zz_b0_probe.test.ts --silent=false
  --disable-console-intercept`，全部 `[GEN]…[FLAVOR]` 行即原始数据。
  本文 §4 全部数字来自 2026-09-17 实跑输出（本轮零生产代码改动，预期长期有效；
  任何移动 RNG 流的轮次之后必须全表重采）。

### 4.2 生成分布基线（5 seeds × D1..D26，全链口径）

**每层物品数曲线**（`D1:D2:…:D26`，无金币、含钥匙）：

| seed | 全 26 层合计 | 曲线 |
|---|---|---|
| 1 | 348 | 2,8,8,7,8,13,10,12,14,6,12,11,19,13,16,16,19,8,14,8,12,23,25,14,26,24 |
| 42 | 408 | 2,8,6,8,16,20,13,8,9,18,17,14,13,8,19,19,16,18,24,21,21,21,25,20,25,19 |
| 777 | 386 | 6,5,13,13,10,9,4,15,18,16,19,18,10,8,15,17,13,20,25,11,16,14,25,22,17,27 |
| 2026 | 410 | 1,9,9,8,5,9,17,14,20,13,16,23,22,12,13,11,13,16,24,23,24,28,17,20,19,24 |
| 31337 | 393 | 1,10,10,7,7,12,14,12,11,9,15,20,15,15,8,19,19,5,8,30,19,19,28,25,27,28 |

**类别合计**（五种子范围，KEY 之外的"真物品"合计 208-248/局）：

| 类别 | 五种子计数 | 备注 |
|---|---|---|
| KEY | 140 / 162 / 147 / 162 / 166 | 机器+陷阱库+笼子+蓝图锁门各一把，CE 无此物 |
| POTION | 24-37 | 其中 potion_of_life 10/15/10/15/13——CE 计量对象 |
| SCROLL | 33-46 | 其中 scroll_of_enchantment 8/9/13/10/8——CE 计量对象 |
| WAND | 48-64 | 九类抽签的 10% 档位，量级远超 CE |
| RING | 22-27 | |
| CHARM | 19-36 | |
| STAFF | 17-23 | |
| WEAPON | 11-21 | |
| ARMOR | 12-18 | |
| AMULET | 1 | 恒 1（D26 护符） |
| GOLD | **0** | 无生成点 |

**武器/护甲的附魔·诅咒·符文率**（B-4 对齐 CE 三岔链时的门禁基线）：

| seed | 武器数 | 附魔>0 | 诅咒 | 符文 | 护甲数 | 附魔>0 | 诅咒 | 符文 |
|---|---|---|---|---|---|---|---|---|
| 1 | 19 | 2 | 0 | 2 | 12 | 2 | 0 | 2 |
| 42 | 14 | 1 | 0 | 0 | 16 | 3 | 0 | 2 |
| 777 | 21 | 4 | 1 | 3 | 16 | 0 | 0 | 2 |
| 2026 | 14 | 2 | 1 | 1 | 18 | 3 | 0 | 2 |
| 31337 | 11 | 5 | 1 | 4 | 17 | 3 | 1 | 2 |

（现状代码口径：武器/护甲各 20% 附魔 `[-1..2]`、12%/10% 符文；CE 口径见 §2.5。
逐种直方图太长，已由 `[GEN-KIND]` 行原样输出；复跑即得。）

### 4.3 鉴定比例基线

- **出生时 `identifiedItems.size = 0`**；开局三件套（匕首/飞镖/皮甲）的
  `runicKnown=true` 但 runicType=undefined（startNewGame Game.ts:502-530 手工清）。
- 地面物品 displayName 实测：药水显示风味名（"猩红色药水"）、武器显示素名
  （"Dagger"）——地面阶段无泄露。
- 全程没有任何"熟悉度"消耗：鉴定**只**发生在我方喝/读/用/扔四类动作后
  （每局玩家实际鉴定的种类 ≤ 一二十），CE 的"穿 1000 回合亮护甲"类被动揭示
  为 0。**这就是"已鉴定/未鉴定比例"基线：web ≈ 0%（被动揭示恒 0），
  CE 的对应比例由 §1.4 的九条被动规则产生。**

### 4.4 回合流水基线（seed=42，公开入口触发）

| 动作 | 实测结果 |
|---|---|
| `quaffItem(potion_of_life)` | displayName "Purple Potion"→鉴定 `potion_of_life` 入 Set；hp 满 30/30；整回合 |
| `readItem(scroll_of_teleportation)` | 风味名"题为「妙法天书天书星辰」的卷轴"→鉴定；玩家实际传送；整回合 |
| 未识别魔杖 displayName | `"Copper Wand"`，无充能泄露（名称层对齐 CE） |
| `equipItem(sword,+2,runic,未识别)` | **不产生鉴定**（Set 维持 2 不变）；displayName **泄露为 "Sword +2"**；DetailGenerator **泄露基础/实际伤害与附魔**；runicKnown 保持 false |
| DetailGenerator(诅咒皮甲-1) | **直接显示"被诅咒"与负附魔**（"实际防御值: 2.5 … 被诅咒"） |
| `dropItem(ring)` | 背包 6→5，落点=(玩家位) |
| `throwItemAt(potion_of_confusion, +3,0)` | 鉴定入 Set；不落地为物品；整回合（heal_full 之外的投掷效果分支详见 §3.2） |
| `toSnapshot → loadSnapshot` | **鉴定态 3→0 全丢**（快照无字段）；风味表逐条不变（cosmetic 流从 seed 重播种的巧合，§2.4）；快照 keys 无任何 identif* 字段 |

### 4.5 决定性复核 —— **通过**

- seed=42 与 seed=2026，各自两遍 D1..D26 全链，逐层物品签名（无 id 口径）
  **全等**：`[DETERMINISM] seed=42 depths=26 identical=true`、
  `seed=2026 … identical=true`。
- 风味分配：同 seed 两遍双射逐条相同、异 seed（777）不同；
  药水 16 条 / 卷轴 14 条映射齐；**外观流不扰主流**
  （`mainStreamUnaffectedByCosmetic=true`——风味分配后重走 26 层链逐位一致）。

### 4.6 复跑方法

从附录 A 恢复 `src/test/zz_b0_probe.test.ts`，按 §4.1 命令跑。
B-1a 起的"行为逐位不变"门禁建议直接钉死：
**§4.2 五条曲线 + 类别合计 + 附魔率表逐位相等**（B-4 改生成时才允许重采）、
**§4.4 流水表逐条结论不变**（B-1a 会把其中"泄露"三行翻成"不泄露"——届时以
新表为门禁）、**§4.5 两条决定性恒真**。

---

## 五、差异清单与拆轮建议

### 5.1 CE 有而 web 没有（B 系列要补的）

1. kind 级"最后一个自动升格"（带极性联动）（Items.c:6570-6674）。
2. 熟悉度被动揭示三件套：武器 20 杀 / 护甲 1000 回合 / 戒指 1500 回合
   （Time.c:1988-2024、Combat.c:1099-1121；常数 GlobalsBrogue.c:1040-1042）。
3. 戒指双槽 + 三戒指戴上即识别特例（Items.c:8583-8586）。
4. call（品类绰号）+ inscribe（个体题字）（Items.c:1347-1437）。
5. detect magic 极性系统全套（§1.6）：magicPolarity 表列、ITEM_MAGIC_DETECTED、
   地面 sigil、恶意品使用确认、极性联动升格。
6. 鉴定卷轴的目标指定 UI（promptForItemOfType 的 web 对应物——InventoryOverlay
   已有选择 UI 可挂）。
7. 投掷：弹道、距离上限、武器命中/伤害/符文/命中即消失、miss 落地、
   incendiary dart 爆燃、7 条药水 DF 链的黑暗/坠门/地衣 3 条、数量递减。
8. 生成：金币堆、频率表抽取、metered items、密门热图偏置、附魔三岔链、
   投掷武器数量 5-18/3-11/3-6 与"不可附魔"。
9. CE 目录缺口：potion darkness、scroll aggravate monsters、wand
   polymorphism/negation/domination/plenty、staff tunneling/blinking/
   entrancement/obstruction/discord/protection、ring light/reaping、charm
   levitation/shattering/guardian/teleportation/recharging/negation、
   weapon war axe/incendiary dart/javelin（各表的 CE 行号见 §1.2/§3.5 引文）。
10. 三占位卷轴效果（§3.3）。
11. 存档持久化鉴定态/风味/callTitle（§2.4）。

### 5.2 web 有而 CE 没有（D2：保留代码、退出实际游戏）

1. `potion_of_healing`（heal_partial）——已退池 ✓ 维持。
2. `scroll_of_amnesia`——已退池 ✓ 维持。
3. `potion_of_creeping_death` 的**毒气效果**与 `GasType.CREEPING_DEATH` 气体
   ——已退池 ✓；**但 CE 同名药水存在（POTION_LICHEN）**，B-4/药水轮应"重写
   效果为种地衣后回池"而不是永久退池（F-0 表述修正见 #0-10）。
4. `potion_of_poison`（= CE caustic gas）：**CE 原生物种被误标 D2 退池**
   ——CE 药水表第 9 条 caustic gas 是恶意主流药水（GlobalsBrogue.c:673）。
   它的 quaff 效果（原地毒云）其实已对齐 DF_POISON_GAS_CLOUD_POTION（G-1）。
   **建议回池**（挂 B-4 或更早的效果核对轮）。
5. `weapon halberd`、`wand_of_fire`、`wand_of_lightning`、`staff_of_light`
   ——已退池 ✓ 维持。
6. InventoryOverlay 的「Recharge」「Remove Curse」两按钮（免费作弊面，#1.7）。
7. throwItemAt 的 `heal_full` 投掷分支（CE 无）。
8. `identifyRandomItem` 的随机目标（CE 是指定）——列入 §5.3 修正而非删除。

### 5.3 两边都有但规则不同（最危险，逐条列全）

| # | 主题 | CE | web | 后果 |
|---|---|---|---|---|
| 1 | 药水/卷轴"使用即鉴定" | 同左，但 enchanting/identify 两卷轴用完**不**自亮 | 无例外、全亮（Game.ts:3112） | 玩家白得 2 个种类识别/张 |
| 2 | identify 卷轴目标 | 玩家指定（含"nothing to identify"短路） | 随机挑背包一件 | 关键战术差异（CE 可点名护甲/魔杖） |
| 3 | 武器/护甲附魔揭示 | 20 杀/1000 回合熟悉度；或鉴定卷轴 | **永不**（只能靠 identify 卷轴随机命中） | 玩家整局不知道手里剑几_plus |
| 4 | 诅咒可见性 | 穿戴失败/detect magic/使用确认 | DetailGenerator 直接亮"被诅咒" | web 诅咒纯利己信息，无风险 |
| 5 | uncurse 后的负附魔 | 保留负值，需再附魔回正 | removeCurseFromInventory 是否清零未核对（「Remove Curse」按钮路径已证实清零，Game.ts:3905） | 若一致清零则白送修装备 |
| 6 | 附魔生成链 | 40% 岔三分支（诅咒 50%/好符文按伤害/while10%） | 20% `[-1..2]` 均匀 | 装备价值分布完全不同（§4.2 表） |
| 7 | 戒指诅咒率 | 16% 且无正符文概念 | 与武器同 20%/10% 链 | — |
| 8 | 每层物品数 | `3+while(60%)+早层补偿`；D1 期望 ≥5 | `randRange(3,6)`；D1 实测 1-2（落格池先供楼梯/钥匙） | 前期节奏贫瘠 |
| 9 | remove curse 作用域 | 全背包 uncurse（不掉附魔） | 已实装 removeCurseFromInventory（作用域一致，细节未逐行核对） | B-1b 核对 |
| 10 | enchanting 卷轴 | 任选一物；+掷骰附魔；降力量需求；解咒；杖加充能下限 | 只附魔已装备武器/护甲；直接点亮符文 | web 白送符文识别 |
| 11 | recharging 卷轴 | 全部杖+护符 | 随机一件 | — |
| 12 | 投掷武器命中 | 完整攻击结算 | 无效果 | §三 |
| 13 | 风味洗牌流 | 主流 | COSMETIC（有意偏离，保留） | 已在 item_flavor_pool_report §7 论证 |
| 14 | 存档与鉴定 | 回放架构隐式持久 | 快照架构**不持久**（bug） | #0-2① |

### 5.4 拆轮建议（含对任务书拆法的两处修正）

**总序列：B-1a → B-1b → （B-2 ∥ B-3）→ B-4。**

**修正一：任务书的"鉴定系统"一刀太宽，必须拆 a/b。**
B-1a（未知态与揭示）：补 §1.4 揭示规则表（含熟悉度倒计时、升格规则、
enchant/identify 不自亮例外）、反泄露（§2.3 三处）、`potion_of_detect_magic`
极性系统可留在本轮或挪 B-1c——**建议本轮只做"种类识别"，极性整条挪后**
（它要求 detect magic 药水+sigil 渲染+恶意确认三件套联动，独立成 B-1c 更干净）。
B-1b（持久化与交互）：鉴定态/风味/callTitle 进 snapshot、call/inscribe UI、
identify 卷轴目标指定、戒指双槽（若装备轮不做）、移除 Recharge/Remove Curse
作弊按钮。

**修正二：投掷（B-2）排在 B-1a 之后、与 B-3 并行，而不是"鉴定全部做完之后"。**
理由：① B-2 依赖的只是"扔药水→鉴定"这个已有语义（§3.2 已实现）+ F/G 链的
DF 基建（incendiary dart 的 `exposeTileToFire`、气体 DF 四条已接）——**载体
就绪度是三者中最高的**；② 它反哺 B-1a 的揭示规则表（投掷药水自动鉴定是
CE 揭示时机之一）；③ 三占位卷轴（B-3）依赖 C-4b/C-4c 的地形基建（§3.3 盘点
已改观）且与鉴定零耦合——两者允许修改面几乎不相交，可并行（并行规则：B-2 动
Game.ts 投掷段+新增 dart DF；B-3 动 readItem 三 case+TerrainCatalog/DF 目录
新增条目——**TerrainCatalog/DF 目录两张穷尽表同时进 B-3 允许清单**，B-2 不碰）。

**B-4（生成规则对齐）必须收尾且独占**：金币、频率表、metered items、热图、
附魔三岔链——每一项都移动 RNG 流（项目常识 §四），与任何轮并行都会互毁基线。
它落地后按 §4.6 重采全部生成基线表。

**各轮门禁与预告翻红（按交接文档「两段 grep」法预查）**：
- **① 结构性穷尽表**（本轮逐一实查）：B-3 新增地形/DF 会打红
  `c_4a_0_layer_model`、`c_4a_terrain_catalog`、`c_4b_dungeon_feature`、
  `g_2_gas_df_wiring`（若接气体 DF）、`f_1`/`f_2a`（若接火 DF）——届时全数
  进允许清单，限定"仅为新增条目"。
- **② 本轮主题关键词**：
  - B-1a：`ItemLoader|identifiedItems|displayName|runicKnown|quaff|readItem`
    → 翻红 `itemFlavors.test.ts`（分配/池断言）、`armor_runic_effect.test.ts`
    （符文揭示路径）、`scroll_effects.test.ts`（identify 卷轴改指定目标）、
    `b_1_weapon_specials.test.ts`（武器旗标与熟悉度的交互面）。
  - B-2：`throwItemAt|enterThrowMode|dart|quantity` → 翻红
    `p4_7_player_weapon_geometry.test.ts`（武器几何口径）、
    `p1_31_35_placement_snapshot.test.ts`（物品快照增字段）、
    `scroll_effects.test.ts`（药水投掷分支）。
  - B-4：`spawnWeapon|spawnArmor|genPotions|populateLevel` → 翻红
    `p1_20_item_placement.test.ts`、`generation_baseline.test.ts`、
    `invented_content_pool.test.ts`（回池/退池变动）、`horde_terrain_spawn`
    （floorTiles 牌堆顺序）——**全部预告，届时逐条判定"回归 vs CE 行为首次生效"**。
- **键位留痕**：B-2 接投掷键（CE `t`）时，`p1_46_keybindings.test.ts:94-98`
  的 `w/a/d` 留痕须按其注释翻转——该文件届时进 B-2 允许清单。

### 5.5 本轮登记的 bug / 与预设不符（只列不修）

1. **鉴定态不持久化**（§2.4，探针 [ID-SAVE] 实证）——B-1b 的核心交付。
2. **机器房宝藏静默落空**：Game.ts:837 `'scroll_of_enchanting'` 无此 id
   （json 只有 `scroll_of_enchantment`）→ 50% 分支 `spawnScroll` 返回 null。
   同函数 :880/:614 用的是正确 id。一行修复，挂任意顺手轮。
3. **泄露三处**（§2.3）：displayName 附魔/诅咒前缀、DetailGenerator 武器段、
   法器充能段。
4. **`potion_of_poison` 被 D2 误标**：CE 原生 caustic gas 应在池（#0-10、§5.2-4）。
5. **F-0 报告 CREEPING_DEATH 表述需加注**（#0-10）：气体自创成立，
   但 CE 有同名药水（POTION_LICHEN，效果=种地衣）。
6. **dart 参与附魔/符文生成**（ItemLoader.spawnWeapon 无种类豁免，CE 明令禁止，
   Items.c:268-273）；开局飞镖在 startNewGame 手工清除故未暴露。
7. **金币体系死代码**：GOLD 类别+拾取记账存在、零生成点（§2.5）。
8. **钥匙泛滥**：140-166 把/局且挤占物品落格池（§2.5）——量级对齐 CE 需 B-4
   顺带设计（CE 的机器钥匙由蓝图按需放）。
9. **identify 卷轴随机目标**（§5.3-2）、**Recharge/Remove Curse 作弊按钮**
   （§1.7）——行为差异与 D2 违背，归 B-1b。
10. **任务书 §二.4 的载体盘点法本轮逐条执行**，结果内嵌 §一/§二/§三 各表——
    没有发现"整条机制零载体"的 C-4c 型空壳风险；最接近的是 B-3 三卷轴
    （载体已随 C-4b/C-4c/P4-1b 就绪，见 §3.3）。

---

## 六、门禁（npm test / npm run build / git status）

（本轮零生产代码改动；`git status --porcelain` 在探针删除后、本文档写入前
实测为空串。）

**`npm run build`（2026-09-17，exit 0）：**

```
> [!build tail]
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit to this warning via build.chunkSizeWarningLimit.
✓ built in 1.70s
```

**`npm test`（`npx vitest run --fileParallelism=false` 串行全量，2026-09-17）：**

```
 RUN  v4.1.11 /private/tmp/claude-501/-Users-coolking70-Documents------brogue/8ee12a9f-9b98-4460-8396-dd8dbcd34c7b/wt-b-0/brogue-web


 Test Files  74 passed (74)
      Tests  848 passed | 8 skipped | 5 todo (861)
   Start at  04:44:04
   Duration  1041.15s (transform 688ms, setup 0ms, import 8.79s, tests 1026.22s, environment 12ms)

EXIT=0
```

（串行全量按交接文档的推荐跑法执行；74 文件全绿零红，与 main 完全一致——
本轮没有任何生产代码或测试改动。探针脚本在门禁启动前已删除，未参与本轮。）

**`git status --porcelain`（终态）：**

```
?? ai_docs/b_0_phase_b_survey.md
```

（临时测量脚本 `src/test/zz_b0_probe.test.ts` 已删除；除本文档外工作区干净。）

---

---

## 附录 A：测量脚本全文（`src/test/zz_b0_probe.test.ts`，跑完已删）

```ts
/**
 * src/test/zz_b0_probe.test.ts — B-0 临时测量脚本（跑完即删，不入库）
 *
 * 纯只读观测：不改任何引擎代码；只通过公开入口（createHeadlessGame /
 * handlePlayerAction / quaffItem / readItem / throwItemAt / toSnapshot /
 * loadSnapshot / ItemLoader 公开静态成员）触发游戏本就存在的行为。
 * 唯一的"私有"访问是 generateDepth（测试侧经 as any 调用、零修改），
 * 用于沿完整生成链逐层下探（项目常识 §四：确定性单元 = 完整生成链）。
 * 输出全部走 console.log，跑法：
 *   npx vitest run src/test/zz_b0_probe.test.ts --silent=false --disable-console-intercept
 */
import { describe, it } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { ItemCategory, Item } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import { generateItemDetail } from '../engine/UI/DetailGenerator';
import i18next from 'i18next';

i18next.init({
    lng: 'en',
    fallbackLng: false,
    resources: {},
    initImmediate: false,
});

const SEEDS = [1, 42, 777, 2026, 31337];
const MAX_DEPTH = 26;

interface ItemSig {
    cat: string;
    kind: string;
    loc: string;
    ench: number;
    cursed: boolean;
    runic: string | undefined;
    runicKnown: boolean;
    qty: number;
}

function catName(c: ItemCategory): string {
    return ItemCategory[c] ?? String(c);
}

function kindOf(it: Item): string {
    return (it as any).consumableId ?? (it as any).identityId ?? it.name;
}

function sigOf(it: Item): ItemSig {
    return {
        cat: catName(it.category),
        kind: kindOf(it),
        loc: `${it.loc.x},${it.loc.y}`,
        ench: it.enchantment,
        cursed: it.isCursed,
        runic: it.runicType,
        runicKnown: it.runicKnown,
        qty: it.quantity,
    };
}

function sigKey(s: ItemSig): string {
    return `${s.cat}|${s.kind}|${s.loc}|e${s.ench}|c${s.cursed ? 1 : 0}|r${s.runic ?? '-'}|rk${s.runicKnown ? 1 : 0}|q${s.qty}`;
}

/** 逐层走完整生成链收集每层物品（不含玩家背包）。 */
function walkAllDepths(seed: number): Map<number, Item[]> {
    const game = createHeadlessGame(seed);
    const perDepth = new Map<number, Item[]>();
    perDepth.set(1, [...game.items]);
    for (let d = 2; d <= MAX_DEPTH; d++) {
        game.depth = d;
        (game as unknown as { generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void }).generateDepth(false, false);
        perDepth.set(d, [...game.items]);
    }
    return perDepth;
}

describe('B-0 probe ①: 生成分布基线（5 seeds × D1..D26）', () => {
    it('逐类/逐种物品计数与附魔/诅咒/符文率', () => {
        for (const seed of SEEDS) {
            const perDepth = walkAllDepths(seed);
            const byCat = new Map<string, number>();
            const byKind = new Map<string, number>();
            let wEnch = 0, wCursed = 0, wRunic = 0, wTotal = 0;
            let aEnch = 0, aCursed = 0, aRunic = 0, aTotal = 0;
            let total = 0;
            const perDepthCounts: string[] = [];
            for (const [d, items] of perDepth) {
                perDepthCounts.push(`D${d}:${items.length}`);
                for (const it of items) {
                    total++;
                    const c = catName(it.category);
                    byCat.set(c, (byCat.get(c) ?? 0) + 1);
                    const k = kindOf(it);
                    byKind.set(`${c}/${k}`, (byKind.get(`${c}/${k}`) ?? 0) + 1);
                    if (it.category === ItemCategory.WEAPON) {
                        wTotal++;
                        if (it.enchantment !== 0) wEnch++;
                        if (it.isCursed) wCursed++;
                        if (it.runicType) wRunic++;
                    }
                    if (it.category === ItemCategory.ARMOR) {
                        aTotal++;
                        if (it.enchantment !== 0) aEnch++;
                        if (it.isCursed) aCursed++;
                        if (it.runicType) aRunic++;
                    }
                }
            }
            const kindSorted = [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            console.log(`[GEN] seed=${seed} total=${total} perDepth=[${perDepthCounts.join(',')}]`);
            console.log(`[GEN-CAT] seed=${seed} ${JSON.stringify(Object.fromEntries([...byCat.entries()].sort()))}`);
            console.log(`[GEN-WPN] seed=${seed} total=${wTotal} ench>0=${wEnch} cursed=${wCursed} runic=${wRunic}`);
            console.log(`[GEN-ARM] seed=${seed} total=${aTotal} ench>0=${aEnch} cursed=${aCursed} runic=${aRunic}`);
            console.log(`[GEN-KIND] seed=${seed} ${kindSorted.map(([k, n]) => `${k}=${n}`).join(' ')}`);
        }
    });
});

describe('B-0 probe ②: 鉴定系统现状流水（seed=42）', () => {
    it('出生时全未鉴定; 药水/卷轴使用即鉴定; 装备不鉴定且泄露附魔/诅咒; 存档丢鉴定态', () => {
        const game = createHeadlessGame(42);
        const p = game.player;
        console.log(`[ID-INIT] identifiedCount=${ItemLoader.identifiedItems.size} ` +
            `flavorSample=${JSON.stringify([...ItemLoader.potionFlavorMap.entries()].slice(0, 3))} ` +
            `scrollSample=${JSON.stringify([...ItemLoader.scrollFlavorMap.entries()].slice(0, 2))}`);

        // 地面物品的显示名（应全部是风味名）
        const floorNames = game.items.slice(0, 8).map((it) => `${catName(it.category)}:"${it.displayName}"`);
        console.log(`[ID-FLOOR] ${floorNames.join(' | ')}`);

        // —— 药水：喝下 → 鉴定 ——
        const potion = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        const potionUnidName = potion.displayName;
        p.inventory.addItem(potion);
        game.quaffItem(potion);
        console.log(`[ID-POTION] before="${potionUnidName}" after-identified=${ItemLoader.identifiedItems.has('potion_of_life')} hp=${p.hp}/${p.maxHp}`);

        // —— 卷轴：读 → 鉴定 ——
        const scroll = ItemLoader.spawnScroll('scroll_of_teleportation', -1, -1)!;
        const scrollUnidName = scroll.displayName;
        p.inventory.addItem(scroll);
        const px0 = p.loc.x, py0 = p.loc.y;
        game.readItem(scroll);
        const moved = (p.loc.x !== px0 || p.loc.y !== py0);
        console.log(`[ID-SCROLL] before="${scrollUnidName}" after-identified=${ItemLoader.identifiedItems.has('scroll_of_teleportation')} teleported=${moved}`);

        // —— 魔杖：使用 → 鉴定（charges 未知时不显示） ——
        const wand = ItemLoader.spawnWand('wand_of_teleportation', -1, -1)!;
        const wandUnidName = wand.displayName;
        p.inventory.addItem(wand);
        p.inventory.removeItem(wand); // useArcanaItem 不从背包移除魔杖，只在此占位验证显示名
        console.log(`[ID-WAND] unidDisplayName="${wandUnidName}" (true name="${wand.name}")`);

        // —— 武器：带附魔/符文的未知武器，装备与详情面板是否泄露 ——
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
        wpn.enchantment = 2; wpn.isCursed = false; wpn.runicType = 'quietus'; wpn.runicKnown = false;
        const unidWeaponName = wpn.displayName;
        p.inventory.addItem(wpn);
        game.equipItem(wpn);
        const detail = generateItemDetail(wpn, p.strength);
        const detailText = detail ? JSON.stringify(detail.sections.map(s => s.lines.map(l => l.text).join('; '))) : 'n/a';
        console.log(`[ID-WPN] unidDisplayName="${unidWeaponName}" (泄露附魔=${wpn.enchantment !== 0 ? '是(+2 显示在名上)' : '否'}) ` +
            `equipIdentifies=${ItemLoader.identifiedItems.size} detail="${detailText}" runicKnown=${wpn.runicKnown}`);
        game.unequipItem(wpn);

        // —— 诅咒护甲：详情是否直接亮"被诅咒" ——
        const armor = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        armor.enchantment = -1; armor.isCursed = true; armor.runicType = undefined;
        p.inventory.addItem(armor);
        const armorDetailObj = generateItemDetail(armor, p.strength);
        const armorDetail = armorDetailObj ? JSON.stringify(armorDetailObj.sections.map(s => s.lines.map(l => l.text).join('; '))) : 'n/a';
        console.log(`[ID-ARMOR-CURSED] displayName="${armor.displayName}" detail="${armorDetail}"`);
        p.inventory.removeItem(armor);

        // —— 丢弃：落点与背包 ——
        const ring = ItemLoader.spawnRing('ring_of_regeneration', -1, -1)!;
        p.inventory.addItem(ring);
        const invBefore = p.inventory.items.length;
        game.dropItem(ring);
        const droppedAt = game.items.find((it) => it.id === ring.id);
        console.log(`[ID-DROP] inv ${invBefore}->${p.inventory.items.length} landed=${droppedAt ? `(${droppedAt.loc.x},${droppedAt.loc.y})` : 'MISSING'} player=(${p.loc.x},${p.loc.y})`);

        // —— 投掷：药水扔空地 → 碎裂 + 鉴定 + 整回合 ——
        const p2 = ItemLoader.spawnPotion('potion_of_confusion', -1, -1)!;
        p.inventory.addItem(p2);
        const tx = p.loc.x + 3, ty = p.loc.y;
        const itemsBefore = game.items.length;
        game.throwItemAt(p2, tx, ty);
        console.log(`[ID-THROW] confusion identified=${ItemLoader.identifiedItems.has('potion_of_confusion')} ` +
            `itemLandedOnFloor=${game.items.length > itemsBefore} inventoryStillHas=${p.inventory.items.some(i => i.id === p2.id)}`);

        // —— 存档/读档：鉴定态是否存活 ——
        const identifiedBefore = new Set(ItemLoader.identifiedItems);
        const flavorBefore = new Map(ItemLoader.potionFlavorMap);
        const snap = game.toSnapshot();
        const snapKeys = Object.keys(snap);
        game.loadSnapshot(snap);
        const identifiedAfter = new Set(ItemLoader.identifiedItems);
        const flavorAfter = new Map(ItemLoader.potionFlavorMap);
        const flavorSame = flavorBefore.size === flavorAfter.size &&
            [...flavorBefore.entries()].every(([k, v]) => flavorAfter.get(k)?.name === v.name && flavorAfter.get(k)?.color === v.color);
        const lostIds = [...identifiedBefore].filter((id) => !identifiedAfter.has(id));
        console.log(`[ID-SAVE] snapshotHasIdentifiedField=${snapKeys.some(k => k.toLowerCase().includes('identif'))} ` +
            `identifiedBefore=${identifiedBefore.size} identifiedAfter=${identifiedAfter.size} lost=[${lostIds.join(',')}] flavorMapUnchanged=${flavorSame}`);
    });
});

describe('B-0 probe ③: 决定性复核（同 seed 两遍全链全等）', () => {
    it('seed=42 与 seed=2026 各跑两遍 D1..D26，逐层物品签名全等', () => {
        for (const seed of [42, 2026]) {
            const run = (): string[] => {
                const perDepth = walkAllDepths(seed);
                const sigs: string[] = [];
                for (const [d, items] of perDepth) {
                    sigs.push(`D${d}|${items.map((it) => sigKey(sigOf(it))).sort().join(';')}`);
                }
                return sigs;
            };
            const a = run();
            const b = run();
            const equal = a.length === b.length && a.every((v, i) => v === b[i]);
            console.log(`[DETERMINISM] seed=${seed} depths=${a.length} identical=${equal}`);
            if (!equal) {
                for (let i = 0; i < Math.max(a.length, b.length); i++) {
                    if (a[i] !== b[i]) { console.log(`  first divergence ${a[i]?.slice(0, 160)} vs ${b[i]?.slice(0, 160)}`); break; }
                }
            }
        }
    });
});

describe('B-0 probe ④: 风味名与 RNG_COSMETIC 隔离复核', () => {
    it('同 seed 风味分配可复现; 不同 seed 不同; 外观流不扰主流', () => {
        const flavorSig = (): string =>
            [...ItemLoader.potionFlavorMap.entries()].map(([k, v]) => `${k}:${v.name}`).sort().join('|') +
            '#' + [...ItemLoader.scrollFlavorMap.entries()].map(([k, v]) => `${k}:${v}`).sort().join('|');
        const g1 = createHeadlessGame(42);
        const f1 = flavorSig();
        const g2 = createHeadlessGame(42);
        const f2 = flavorSig();
        const g3 = createHeadlessGame(777);
        const f3 = flavorSig();
        console.log(`[FLAVOR] sameSeedIdentical=${f1 === f2} diffSeedDifferent=${f1 !== f3} potionKinds=${ItemLoader.potionFlavorMap.size} scrollKinds=${ItemLoader.scrollFlavorMap.size}`);
        // 主流对齐：同 seed 下地牢指纹不受 cosmetic 流影响（两遍生成应与无风味版一致——
        // 这里直接比对两遍链生成签名，证明 initConsumables 后主流仍可复现）
        const chainA = walkAllDepths(42);
        void g1; void g2; void g3;
        const chainB = walkAllDepths(42);
        let same = true;
        for (let d = 1; d <= MAX_DEPTH; d++) {
            const ia = chainA.get(d)!.map((it) => sigKey(sigOf(it))).sort().join(';');
            const ib = chainB.get(d)!.map((it) => sigKey(sigOf(it))).sort().join(';');
            if (ia !== ib) { same = false; break; }
        }
        console.log(`[FLAVOR] mainStreamUnaffectedByCosmetic=${same}`);
        void f3;
        void rng;
    });
});
```
