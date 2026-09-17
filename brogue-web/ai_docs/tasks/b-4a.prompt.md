# B-4a：物品生成规则对齐 ——「生成什么」（**独占轮，移动 RNG 流**）

## 0. 角色与授权反驳条款

你是**开发方**。本任务书由**验收方**撰写，验收方**会写错 CE 事实**。
凡本文引用的 CE 行号、字段位、数值，你都**必须打开
`BrogueCE-master/src/brogue/*.c|*.h` 与 `BrogueCE-master/src/variants/GlobalsBrogue.c`
逐字核对**。冲突时**以 CE 源码为准**，并在最终回复开
`## 对任务书的反驳` 一节写明：验收方原话 / CE 实际内容（文件:行号 + 原文片段）/ 你据此做了什么。

**没有反驳节 = 你没核对。** 本轮数值密集，是最容易抄错的一轮：
`itemTable` 是**无字段名的定位初始化**，数错一位就全盘皆错。
结构体定义在 `Rogue.h:1424-1438`，**先把字段序抄下来再读表**。

## 1. 背景：P1-50 登记的生成灾区

实测每局产出：life 药水 10-15 只、enchantment 卷轴 8-13 张、铁钥匙 140-166 把、
金币恒 0、dart 照吃 20% 附魔 + 12% 符文。**这些都是玩家直接感知的平衡性问题。**

B-4 拆成两轮，**本轮是 B-4a，只管「生成出来的是什么」**：

| | 归属 |
|---|---|
| 计量表、频率加权抽取、附魔/符文模型、投掷物规则、缺失物品种类 | **本轮 B-4a** |
| 落位热力图、金币投放、钥匙数量、每层物品数量 | **下一轮 B-4b，不要碰** |

两轮都移动 RNG 流，**必须串行**。本轮**授权重新捕获 `generation_baseline`**。

## 2. 本轮要改的五件事

### 2.1 计量表（`meteredItems`）—— 本轮的核心

CE `Items.c:570-580` / `:674-686` / `:702-716` / `:740-752`，
表定义在 `variants/GlobalsBrogue.c:626-658`，结构体 `Rogue.h:1451-1462`。

机制全貌（**你必须自己读完这四段再动手**，验收方只给骨架）：

1. **基表频率为 0**。`populateItems` 开头 `memcpy` 备份 potion/scroll 两张表，
   结尾再 `memcpy` 还原 —— CE 注释明写：
   *"Restore potion and scroll tables which sets the frequency of these items to zero."*
   也就是说 **enchanting 卷轴 / life 药水 / strength 药水在基表里频率就是 0**，
   它们**只能靠计量表临时把频率写上去才可能被抽中**。
   这正是 web 一局刷出 8-13 张附魔卷轴的根因：web 把它们当普通卷轴等概率抽。
2. **每层入口**（`:577-579`）：`rogue.meteredItems[i].frequency += incrementFrequency`。
3. **每件物品生成前**（`:676-686`）：把 `meteredItems[j].frequency` 写回
   `scrollTable[j].frequency` / `potionTable[j - numberScrollKinds].frequency`。
   ⚠️ **索引是「先卷轴后药水」的拼接**：`j < numberScrollKinds` 走 scrollTable，
   否则走 `potionTable[j - numberScrollKinds]`。**计量表的条目顺序必须与
   scrollTable / potionTable 的顺序逐一对齐**，错一位就是给错药水加频率。
4. **阈值强制生成**（`:702-709`）：
   `numberSpawned * genMultiplier + genIncrement < depthLevel * levelScaling + randomDepthOffset`
   成立则**强制**本件为该物品。只有 `levelScaling != 0` 的条目参与（表里只有 POTION_LIFE）。
5. **按层硬保底**（`:710-715`）：`depthLevel == levelGuarantee && numberSpawned < itemNumberGuarantee`。
6. **生成后扣减**（`:740-752`）：命中计量物则
   `frequency -= decrementFrequency`、`numberSpawned++`。

表里**只有三条非零**（其余全是 `{category, kind}` 占位，参与索引对齐但不生效）：

```
{ SCROLL, SCROLL_ENCHANTING, .initialFrequency=60, .incrementFrequency=30, .decrementFrequency=50 }
{ POTION, POTION_LIFE,       .initialFrequency=0,  .incrementFrequency=34, .decrementFrequency=150,
                             .genMultiplier=4, .genIncrement=3, .levelScaling=1 }
{ POTION, POTION_STRENGTH,   .initialFrequency=40, .incrementFrequency=17, .decrementFrequency=50 }
```

**逐字核对 `GlobalsBrogue.c:626-658` 的全部 30 条**，把完整顺序搬过来 ——
占位条目**不能省**，它们是索引的一部分。

`randomDepthOffset`（`Items.c:668-672`）：`depthLevel > 2` 时
`rand_range(-1,1) + rand_range(-1,1)`，否则 0。**两次独立掷骰，不是一次 rand_range(-2,2)** ——
分布不同（前者三角分布），且消耗两个随机数。

### 2.2 频率加权抽取取代等概率

web 现在（`Game.ts:1182` 起）是 `rng.randRange(0, 9)` 选类别 + 类别内
`randRange(0, valid.length-1)` **等概率**抽种类。
CE 是 `chooseKind(table, count)` —— **按 `itemTable.frequency` 加权**。
去 `Items.c` 找 `chooseKind` 的实现逐字照抄（含它消耗几次随机数）。

⚠️ `itemTable` 字段序（`Rogue.h:1424-1438`）：
`name, flavor, callTitle, frequency, marketValue, strengthRequired, power, range, ...`
—— **第 4 个字段才是 frequency**。验收方已核对过一次：
`Globals.c:1600` 的 dart 是 `{"dart", "", "", 0, 15, 10, 0, {2,4,1}, ...}`，
即 **dart 的 frequency = 0，CE 里飞镖根本不参与随机生成**（只来自初始装备与蓝图）。
web 的 `weapons.json` 把 dart 放进了通用池 —— 这是 P1-50「dart 吃附魔」的一半根因。
**请自己复核这一条**，它直接决定本轮怎么改。

### 2.3 武器/护甲附魔与符文模型

CE `Items.c:237-263`（武器）。web `ItemLoader.ts:872-880` 现在是
`randPercent(20)` + `randRange(-1,2)` + `randPercent(12)` 符文 —— **与 CE 完全不同**。

CE 武器：`rand_percent(40)` 才进入附魔分支，然后

- `enchant1 += rand_range(1,3)`；
- `rand_percent(50)` → **诅咒**：`enchant1 *= -1`、置 `ITEM_CURSED`，
  再 `rand_percent(33)` 给**坏符文** `rand_range(NUMBER_GOOD_WEAPON_ENCHANT_KINDS, NUMBER_WEAPON_RUNIC_KINDS-1)`；
- 否则若
  `rand_range(3,10) * (STAGGER?2:1) / (QUICKLY?2:1) / (EXTEND?2:1) > damage.lowerBound`
  → **好符文** `rand_range(0, NUMBER_GOOD_WEAPON_ENCHANT_KINDS-1)`，
  若为 `W_SLAYING` 再 `chooseVorpalEnemy()`；
  ⚠️ 这是**整数除法**且**从左到右求值**，顺序不能重排，否则结果不同；
- 否则 `while (rand_percent(10)) enchant1++;` —— **无上界循环**。

护甲分支（`Items.c:278` 起）请自己读完照抄，别照搬武器的。

武器的**特性旗标**（`Items.c:209-235`）按 kind 派发：
DAGGER→`ITEM_SNEAK_ATTACK_BONUS`；MACE/HAMMER→`ITEM_ATTACKS_STAGGER`；
WHIP→`ITEM_ATTACKS_EXTEND`；RAPIER→`ITEM_ATTACKS_QUICKLY | ITEM_LUNGE_ATTACKS`；
FLAIL→`ITEM_PASS_ATTACKS`；SPEAR/PIKE→`ITEM_ATTACKS_PENETRATE`；
AXE/WAR_AXE→`ITEM_ATTACKS_ALL_ADJACENT`。
这些旗标**参与上面的符文阈值计算**，所以必须先于附魔分支设置。
web 已有的武器特殊性由 B-1 轮做过一部分（见 `b_1_weapon_specials.test.ts`），
**先查清 web 现状再决定是复用还是补齐**，不要造第二套。

### 2.4 投掷物：**先掷后剥**，不是跳过

CE `Items.c:265-274`：

```c
if (itemKind == DART || itemKind == INCENDIARY_DART || itemKind == JAVELIN) {
    if (itemKind == INCENDIARY_DART) { theItem->quantity = rand_range(3, 6); }
    else                             { theItem->quantity = rand_range(5, 18); }
    theItem->quiverNumber = rand_range(1, 60000);
    theItem->flags &= ~(ITEM_CURSED | ITEM_RUNIC); // throwing weapons can't be cursed or runic
    theItem->enchant1 = 0;                          // throwing weapons can't be magical
}
```

⚠️ **这段在附魔分支之后执行**。也就是说投掷武器**照样掷了那 40% 及其全部嵌套骰**，
只是结果被**事后抹掉**。**绝对不要"优化"成提前 return 或跳过附魔** ——
那会少消耗随机数、RNG 流全盘偏移，且与 CE 不一致。
这是本轮最容易被"合理简化"毁掉的一处，任务书特此点名。

`theItem->charges = gameConst->weaponKillsToAutoID`（`:275`）也别漏。

### 2.5 补齐缺失的物品种类

CE `enum weaponKind`（`Rogue.h:810-832`）共 15 种。
web `src/data/weapons.json` 现有 13 个 id：
`dagger whip spear rapier sword mace axe flail halberd broadsword war_pike war_hammer dart`。

比对后**缺 `incendiary_dart`、`javelin`、`war_axe`**，
且 web 多出 `halberd`（CE 无此武器 —— 核实后按项目的 D2「自创内容退池」惯例处理，
参考 `invented_content_pool.test.ts` 的既有做法；**不要直接删**，退池即可）。

护甲同样比对 `Globals.c:1605-1612` 的 6 种与 web `armors.json`，缺的补上。

新增种类的 `frequency / marketValue / strengthRequired / range` 一律从 CE 表**逐字段搬**，
并在 json 或加载器里留 CE 行号注释。

## 3. 绝对禁止

- **不得修改 `BrogueCE-master/` 下任何文件**（只读参考，D6）。
- **不得碰落位、金币、钥匙、每层物品数量** —— 那是 B-4b。
  具体说：不要动 `numItems = rng.randRange(3, 6)` 这一行的**数量**语义，
  不要动 `floorTiles.pop()` 的落位方式，不要新增金币投放，
  不要改机器房/陷阱库/笼子各自 spawn 一把 `iron_key` 的结构。
  （你几乎肯定会看到这些明显是错的 —— **登记到 §9 交给 B-4b，不要顺手修**。
  本项目的惯例是宁可分两轮也不让一轮的范围失控。）
- **不得修改 `src/engine/Map/AutoGenerator.ts`**（B-3 也被同样禁止，缺口归 B-4b 评估）。
- 不得修改 §5 授权清单之外的任何测试。
- 不得为了让测试变绿而放宽断言。

## 4. 与 B-3 的关系

B-3（三张占位卷轴 negation / sanctuary / shattering）刚刚落地，它**新增了地形与 DF**，
但**纯交互期、不碰生成流**。本轮从 B-3 合并后的 `main` 起步。
若你发现 B-3 的产物与本轮冲突（尤其 `Item.ts` 的字段、`Game.ts` 的卷轴分支），
在反驳节说明，**以 main 上的既成事实为准**，不要回退 B-3。

### 4.1 B-3 已落地，以下是它交给你的既成事实

- 新增了 4 个地形（`FORCEFIELD` / `FORCEFIELD_MELT` / `CRYSTAL_WALL` / `SACRED_GLYPH`）
  与 3 条 DF，`TerrainType` 已从 43 涨到 **47**，`DUNGEON_FEATURE_CATALOG` 从 28 涨到 **31**，
  `DF_MISSING_TILES` 从 6 涨到 **7**。
- `AutoGenerator.ts` 的两条 `CRYSTAL_WALL` 缺口（序 1 / 序 33）**地形侧已就位，但仍未接线**，
  且 **`DF_CRYSTAL_WALL` 本身还没进 web 的 DF 目录**
  （CE `Globals.c:607` `{CRYSTAL_WALL, DUNGEON, 200, 50, DFF_CLEAR_OTHER_TERRAIN}`）。
  **本轮（B-4a）依然不要碰 `AutoGenerator.ts`** —— 那条线归 B-4b 评估。

### 4.2 ⚠️ 写授权清单前必读：第三段 grep

`project_conventions.md` 刚刚新增了**漏授权的第四种形态**（B-3 踩的）：
**跨轮公共目录被按主题命名的测试文件钉死**，主题 grep 永远搜不到。

本轮**大改物品表**，等于往 `weaponTable` / `armorTable` / `potionTable` /
`scrollTable` 这些公共目录里增删条目。**动手前先按目录标识符 grep 整个测试树**，
而不是按「物品 / 生成 / 附魔」这类主题词。B-3 实测：
**加一个地形要看 7 个测试文件** —— 加一类物品同理。

## 5. 允许修改的文件

**生产代码：**
- `src/engine/Items/ItemLoader.ts`（附魔模型、加权抽取、计量表的主场）
- `src/engine/Items/Item.ts`（`quiverNumber` 等新字段）
- `src/engine/Core/Game.ts`（每件物品生成前后的计量表读写钩子）
- `src/data/weapons.json`、`src/data/armors.json`、`src/data/potions.json`、`src/data/scrolls.json`
- `src/engine/Random.ts`（**仅当** `chooseKind` 需要一个加权抽取原语且 web 确实没有）
- `src/locales/**`

**测试（授权修改）：**
- `src/test/generation_baseline.test.ts` + `src/test/fixtures/generation_baseline.json`
  —— ✅ **本轮授权重新捕获**。重捕获时**必须保留并追加 `note` / `capturedAt` / `d` 字段**
  （历史上有三次脚本把这些字段写丢了）。`note` 里写明本轮授权理由。
- `src/test/p1_31_35_placement_snapshot.test.ts`（落位快照随生成流变）
- `src/test/invented_content_pool.test.ts`（halberd 退池、种类数变化）
- `src/test/b_1_weapon_specials.test.ts`（武器特性旗标）
- `src/test/b_1a_identification.test.ts`、`src/test/b_1c_detect_magic.test.ts`（附魔/符文字段语义）
- `src/test/itemFlavors.test.ts` → 真实路径是 `src/engine/Items/itemFlavors.test.ts`
- `src/test/p1_30_i18n_gate.test.ts`（新物品名的 i18n）
- `src/test/horde_selection.test.ts`、`src/test/p2_0_seeded_rng.test.ts`（若被生成流位移撞到）

**清单外的测试红了：停下来，不要改**，在 `## 需要追加授权的测试` 列出文件 + 红断言 + 必然撞它的理由。
（授权漏项在本项目已发生 7 次，是最高频返工原因。本轮移动 RNG 流，**撞击面比以往任何一轮都大**，
所以这一节大概率非空 —— 如实写出来比硬改要好。）

## 6. 测试要求

新断言建议放 `src/test/b_4a_item_generation.test.ts`（新建）。

必须覆盖：

1. **计量表·附魔卷轴不再泛滥**：跑完整一局深度（D1→D26）统计
   `scroll_of_enchantment` 总数，钉在 CE 的合理区间内。
   ⚠️ **区间不要凭感觉写**：先用**纯测量**跑若干 seed 得出实际分布，
   再据此写断言，并把测量数据贴进回复。宽到永远不会红的断言等于没有断言。
2. **计量表·life 药水**：同上统计，且验证**阈值强制生成**确实触发
   （`numberSpawned*4+3 < depth` 的层上必出一只）。
3. **基表频率为 0**：直接断言 enchanting / life / strength 三者在**基表**里频率为 0，
   且 `populateItems` 结束后被还原为 0（CE 的 memcpy 还原语义）。
4. **加权抽取**：高 frequency 的种类出现次数显著高于低 frequency 的；
   **frequency=0 的种类（dart）一次都不出现**。
5. **投掷物先掷后剥**：
   - 产物侧：生成的 dart/javelin/incendiary dart **恒 `enchantment === 0`、无符文、不诅咒**；
   - **RNG 侧**：用 `rng.randomNumbersGenerated` 的**增量**证明生成一支投掷武器
     与生成一把同 kind 的普通武器**消耗同样多的随机数**
     —— 这条才是「先掷后剥」与「跳过附魔」的分水岭，**必须有**。
6. **附魔模型**：大样本统计「有附魔的武器占比 ≈ 40%」、「其中约一半是诅咒」，
   并验证 `while(rand_percent(10)) enchant1++` 的长尾确实存在（出现过 +4 以上）。
7. **新增种类可生成**：incendiary_dart / javelin / war_axe 在合适深度能被抽到；
   halberd 退池后**不再出现**在生成产物里。

### 6.1 对抗性测试（强制，至少三条）

每条都必须**真的能被某个具体的错误实现打红**。建议：

- ① 把 §2.4 改成「投掷武器提前 return、跳过附魔分支」→ 测试 5 的 **RNG 增量**断言必须红
  （产物断言仍会绿 —— 这正是为什么必须有 RNG 增量断言）；
- ② 把 §2.1 第 3 步的索引写成 `potionTable[j]`（漏掉 `- numberScrollKinds`）
  → 计量表断言必须红；
- ③ 把 `randomDepthOffset` 从两次 `rand_range(-1,1)` 改成一次 `rand_range(-2,2)`
  → 基线或 life 药水阈值断言必须红。

### 6.2 反向验证（强制）

每条对抗断言：**真的把生产代码改坏 → 跑测试 → 把真实失败输出贴进回复
→ 还原 → `grep -rn "REVERT-ME" src/` 必须为 0**。
只写「我验证过了」不贴真实失败输出的，判不合格。

### 6.3 哨兵纪律

本轮**移动生成期 RNG 流**，所以：

- **不要**新增任何锚定「RNG 流绝对位置」的哨兵 —— 那种哨兵每逢生成轮就断，
  S-1 已经为此还过一整轮的债；
- 新哨兵一律用 ① `rng.randomNumbersGenerated` **增量**，
  或 ② `createHeadlessGame(seed, 'test')` 的**完全隔离合成层**（清怪清物后 reseed），
  或 ③ 性质断言（分布、区间、单调性）；
- 若你撞见**既有**哨兵因本轮位移而断，**优先改成上述三种形态之一**，
  而不是把新数值硬填回去 —— 硬填只是把债推给下一轮。

## 7. 门禁

本轮改动面大，直接上**二级门禁**（全量串行）：

```
npx vitest run --fileParallelism=false
```

约 18 分钟。外加 `npx tsc --noEmit` 无新增错误。

`generation_baseline` 允许因重捕获而变化，但**重捕获后必须绿**，
且 fixture 的 `note` 必须写明本轮授权理由。

## 8. 纯测量先行（强烈建议）

本轮的断言区间全部依赖真实分布。建议**先写一个一次性测量脚本**
（跑 N 个 seed × D1-D26，统计各类物品产出数），把结果贴进回复，
**再**据此写断言。测量脚本不要提交，或提交到 `scripts/` 并在 §9 登记。

这也是验收方独立复核你的唯一抓手 —— 没有测量数据，验收方无法判断你的区间是否合理。

## 9. 最终回复必须包含的小节

1. `## 对任务书的反驳`（重点：itemTable 字段序、dart frequency、计量表 30 条顺序）
2. `## 纯测量数据`（改造前/改造后的产出分布对比）
3. `## 改动清单`
4. `## 对抗性测试与反向验证`（含**真实失败输出**粘贴）
5. `## 哨兵处置`（哪些断了、各自改成了哪种形态）
6. `## 需要追加授权的测试`
7. `## 门禁结果`（全量串行的真实输出尾部）
8. `## 交给 B-4b 的登记`（落位热力图、金币、钥匙、每层数量 —— 你本轮看到但被禁止修的一切）
