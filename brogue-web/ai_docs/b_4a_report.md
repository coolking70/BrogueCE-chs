# B-4a 交付报告：物品生成规则对齐——「生成什么」

> 日期：2026-09-17（执行方单轮完成）
> 分支：`round/b-4a`（改动全部留在工作区，未 commit）
> CE 只读路径：`/Users/coolking70/Documents/同步空间/brogue/BrogueCE-master/src/`（worktree 内符号链接已断，与 f_1 报告同款处理）

---

## 1. 对任务书的反驳

按 5.4 条款逐字核对了任务书引用的全部 CE 锚点。**任务书的核心事实全部核对无误**
（itemTable 字段序 Rogue.h:1424-1438 第 4 字段=frequency；dart 在 Globals.c:1600
frequency=0；计量表 30 条 GlobalsBrogue.c:627-658 顺序与三条非零原值；武器附魔
Items.c:237-263；投掷物 :265-274"先掷后剥"；charges :275；weaponKind 15 种
Rogue.h:810-832；armorTable 6 种 Globals.c:1605-1612）。以下是与预设不符之处：

| # | 任务书/在库断言 | CE 实际内容（文件:行号 + 原文） | 本轮处置 |
|---|---|---|---|
| R1 | 任务书 §2.5：halberd「核实后按 D2 退池惯例处理」 | web 的 weapons.json 里 halberd **已带 `excludeFromGeneration: true`**（先前轮次完成），`invented_content_pool.test.ts` 亦已钉住。核实 CE weaponTable 15 种确无 halberd。 | 无需改动；核实即闭环。 |
| R2 | 任务书 §2.5：护甲「缺的补上」 | web armors.json 6 条与 CE armorTable（Globals.c:1605-1612）**逐一对齐**（leather 3/scale 4/chain 5/banded 7/splint 9/plate 11 = CE {30,40,50,70,90,110}/10），无缺可补。 | 补 frequency=10 列，无新增条目。 |
| R3 | `invented_content_pool.test.ts` 原断言：「potionTable_Brogue 16 种无 poison」→ potion_of_poison 被钉为自创退池 | **前提错误**：CE `POTION_POISON` 的显示名是 "caustic gas"（potionTable_Brogue 第 9 条，GlobalsBrogue.c:673：`{"caustic gas", ..., -1, ... "deadly cloud of caustic purple gas..."}`，frequency=15）。web 的 potion_of_poison（effect=poison_burst，`addGas(POISON,1000)`）正是它的载体，G-1 量纲折算已在库。 | 按授权反转该测试（断言新事实+保留 heal 退池），json 去掉退池标记、frequency=15，回池。 |
| R4 | Game.ts 顶部 D2 注释（F-0 §5.2-5 / G-1 / P1-45）：「potion_of_creeping_death 是 web 自创（CE 无 creeping death 药水）」 | **与 CE 冲突**：creeping death 是 CE 原生 POTION_LICHEN（potionTable_Brogue 末条，GlobalsBrogue.c:681，frequency=7）。 | 只改注释（事实更正），**维持退池**：web 效果是纯 stub（只打日志），且 DF_LICHEN_PLANTED 无载体——生成"什么都不做的药水"比不生成更糟。载体补齐轮回池（见 §8）。 |
| R5 | 任务书 §2.5：javelin 的 range 从 CE 表「逐字段搬」 | CE javelin range={3,11,3}——clumping=3 **无法**用项目 `XdY+Z` 记法表达（该记法 clumping=X 且 min=X+Z，任何取值都无法同时满足 min=3/max=11/clump=3）。 | damage 写 `"1d9+2"`（min=3/max=11 与 CE 一致，clumping=1），另加 `clumping: 3` 字段留形；Combat 侧消费 clumping 需改 Combat.ts（本轮未授权），已登记 §8。 |
| R6 | 任务书 §2.3 引用「web `ItemLoader.ts:872-880` 现在是 randPercent(20)...」 | 属实（旧代码就在那几行）。无反驳，仅确认。 | 已整体替换为 CE 模型。 |
| R7 | 任务书 §2.1 说计量表在 `variants/GlobalsBrogue.c:626-658` | 实际表体在 627-658（626 是注释行 `// To meter item generation...`）。 | 照搬 30 条，注释里写实际行号。 |
| R8 | CE 机制补充（任务书未提）：**开局装备也走完整附魔掷骰后剥离**（RogueMain.c:423-441：`generateItem(WEAPON, DAGGER)` 后 `enchant1 = enchant2 = 0; flags &= ~(ITEM_CURSED|ITEM_RUNIC)`；开局 dart 的 quantity=15 是**覆盖** generateItem 掷出的 5-18，不是跳过掷骰） | web 开局 kit（Game.ts:605-636）恰好同构：spawnWeapon('dagger'/'dart') 后手动清零。新模型下开局装备自动继承 CE 的消耗形态。 | 无需特判，天然对齐。 |
| R9 | CE 机制补充：armorTable 六种的 range 全是 `{N,N,0}` 退化区间，`randClumpedRange` 对 `upperBound<=lowerBound` **零消耗**直接返回（Math.c:43-45） | 故 web 直取显示值（`armor.armor = data.armor`）与 CE `randClump` 行为一致，不消耗随机数。 | 保持原样并在代码注释里记录该核对结论。 |
| R10 | 任务书 §1 说 P1-50 实测「enchantment 卷轴 8-13 张」 | 本轮改造前实测 10 seed 为 **52/局**（520 张/260 层）。C-6 自动生成器/B-3 之后祭坛数量增长，祭坛宝物 20% 硬编码（见 §8-B4b-5）才是最大来源；任务书的根因判断（等概率抽卷轴）对随机物品路径成立，但只占小头。 | 随机路径按 CE 计量表修正（贡献 ~13/局）；祭坛/机器结构登记给 B-4b。 |
| R11 | CE 机制补充：metered 的 increment 只在 `depth <= amuletLevel` 时发生，D26+ 走 lumenstone 分支不再生成普通物品（Items.c:573-580） | web 的生成循环到 D26 为止、无 lumenstone 制。本轮 metered increment 每层（含 D26）照加。 | 登记为 D26+ 差异（§8-B4b-8）。 |

## 2. 纯测量数据

测量口径：`createHeadlessGame(seed)` 起 D1，逐层 `generateDepth(false,false)` 至 D26，
统计 `game.items`（**含机器/祭坛/金库 treasure**——它们也是玩家看到的产出）。
种子 = [1, 7, 42, 2024, 65537, 99991, 123456, 654321, 424242, 8675309]（10 局 × 26 层）。
测量脚本为一次性 vitest 文件，采集后已删除（`git status` 无残留）。

### 改造前（旧模型：randRange(0,9) 等概率类别 + 等概率种类 + 20%/12% 附魔）

| 指标 | 总量（260 层） | 折合每局 |
|---|---|---|
| scroll_of_enchantment | **520** | **52.0** |
| potion_of_life | 136 | 13.6 |
| potion_of_strength | 10 | 1.0 |
| iron_key | 1500 | 150.0 |
| dart（地面产出） | 9 | 0.9 |
| 食物（ration+mango） | **0** | **0** |
| halberd | 0 | 0（已退池） |
| war_axe / incendiary_dart / javelin | 不存在 | — |
| 武器附魔率（n=7200 直采） | 15.1% | 诅咒 367、符文 11.8%；附魔值只有 {-1,1,2} |
| 护甲附魔率（n=3600 直采） | 15.3% | 符文 10.5% |

### 改造后（计量表 + 加权抽取 + CE 附魔模型）

| 指标 | 总量（260 层） | 折合每局 | 每 seed 分布 |
|---|---|---|---|
| scroll_of_enchantment | 600 | 60.0 | 43-68（其中随机物品路径贡献 ≈13/局，其余来自祭坛/机器 treasure——**结构归 B-4b**，见 §8） |
| potion_of_life | 184 | 18.4 | 15-27 |
| potion_of_strength | 88 | 8.8 | 7-10 |
| iron_key | 1395 | 139.5 | 未动（B-4b） |
| dart（仅机器等概率路径偶得） | 5 | 0.5 | 基表频率 0，随机路径 0 产出 |
| **食物** | **110**（ration 89 + mango 21） | **10.9** | 9-13（改造前恒 0；CE 食物保底公式落地） |
| halberd | 0 | 0 | 退池维持 |
| war_axe / incendiary_dart / javelin | 11 / 7 / 11 | 2.9 合计 | 全部可生成 |
| potion_of_poison | （回池，5 局采样 >0） | — | 改造前恒 0（被误退池） |
| 武器附魔率（n=9000，含投掷物） | 32.7% | 非投掷 40.8%；诅咒占附魔 49.9%；长尾 +4×34、+5×3；值域 {-3..-1, 1..5} | CE 形态 |
| 护甲附魔率（n=3600） | 40.6% | 诅咒占附魔 50.4%；符文 6.4%（好符文段 7/8 映射 + 坏段全未实现，理论 ≈4.8-5.9%） | CE 形态 |
| 投掷物 quantity | dart/javelin 5-18、incendiary 3-6、quiverNumber 1-60000、恒无附魔/符文/诅咒 | CE Items.c:265-274 | |

### 过程数据（首轮实现曾出现、修复于提交前的真 bug）

普通抽取路径最初漏调计量扣减：附魔卷轴 72/局、life 22/局、strength 22.4/局
（频率只涨不跌、life 阈值每层触发）。修复方式：`spawnPopulateItem` 的普通路径
同样在生成后走 `decrementMeteredForSpawn`（CE Items.c:740-752 对每件生成物生效）。
修复后复测即上表数值。**首轮数字证明测试带是活的**：产物区间断言能抓到这类错误。

## 3. 改动清单

生产代码：
- `src/engine/Items/ItemLoader.ts`（+421 行主体）
  - `CE_METERED_ITEMS_TABLE`：CE 30 条计量表逐条搬运（前 14 卷轴后 16 药水，
    三条非零原值，占位条目全保留；每条带 `webId` 映射，web 缺的种类记 null）。
  - `initMeteredItems` / `incrementMeteredItems`（CE RogueMain.c:251 / Items.c:577-579）。
  - `chooseKind`（Items.c:409-420 逐字：total 用 max(0,·)、走表用原始值比较、
    扣减用 max(0,·)、恰 1 次掷骰——有测试钉）。
  - `CE_ITEM_GENERATION_PROBABILITIES`（GlobalsBrogue.c:109 权重，惰性构造——
    ItemLoader↔Item 循环依赖，静态初始化器拿不到 ItemCategory，本文件 283 行注释的坑）
    + `pickItemCategory`（Items.c:85-107，1 次掷骰）。
  - `CE_POW_FOOD`（Items.c:551-555 全 50 项）+ `foodGuaranteeTriggered`
    （Items.c:685-691 整数口径逐字）。
  - `WEAPON_RUNIC_BY_CE_INDEX` / `ARMOR_RUNIC_BY_CE_INDEX`（CE 枚举序 → web 符文 id；
    web 未实现的 multiplicity/slowing/plenty/burden/vulnerability/immolation 记 null，
    掷骰照常消耗——登记 §8）。
  - `CE_MONSTER_CLASSES`（Globals.c:1416-1432 全 15 类的 frequency/maxDepth）
    + `chooseVorpalEnemy`（Items.c:7667-7679 + lotteryDraw :7648-7662）。
  - `spawnWeapon` 重写：CE 40% 分支 / 诅咒 ×-1 / 坏符文 rand_range(8,9) / 好符文
    整数除法阈值（顺序不可重排，每步 Math.floor）/ while(rand_percent(10)) 长尾 /
    投掷物先掷后剥 / charges=weaponKillsToAutoID；新增 `depth` 可选形参（vorpal 抽取用）。
  - `spawnArmor` 重写：同构但按 CE 护甲规则（好符文判据 `rand_range(0,95) > armor×10`、
    A_IMMUNITY→vorpalEnemy、坏符文段 rand_range(8,10)）。
  - `damageLowerBound`（内联 parseDamageString 的 min 口径，避免 ItemLoader→Combat→
    Monster→ItemLoader 循环导入——Monster.ts:16 引 ItemLoader）。
- `src/engine/Core/Game.ts`
  - 字段 `meteredItems` / `foodSpawned`，`startNewGame` 重置（CE RogueMain.c:229-252）。
  - `populateLevel` 的物品循环重写：`randomDepthOffset`（两次 rand_range(-1,1)，D>2）
    → 每层 metered 加频 → 逐槽 `spawnPopulateItem`（食物保底 → 计量阈值/硬保底 →
    pickItemCategory → chooseKind → 扣减）。旧的 randRange(0,9) 十类等概率表整体退役
    （该表 randType=9 还有 10% 概率什么都不生成的洞，一并消失）。
  - 所有 spawnWeapon/spawnArmor 调用点（蓝图、机器、怪物掉落）传 depth。
  - D2 注释事实更正（R4）。
- `src/engine/Items/Item.ts`：`quiverNumber`、`vorpalEnemy` 两字段（生成侧留形，消费点登记）。
- `src/data/weapons.json`：12 条补 frequency 列（dart=0）；新增 war_axe / incendiary_dart /
  javelin 三条（CE 值逐字段 + source 注释）。
- `src/data/armors.json`：6 条补 frequency=10。
- `src/data/consumables.json`：potions/scrolls/food 补 frequency 列（CE 原值；
  enchanting/life/strength 基表 0）；**potion_of_poison 去掉退池标记**（R3 回池）。
- `src/data/arcana.json`：wands/staffs/rings/charms 补 frequency 列（CE 原值；
  web 自创/退池条目不动）。
- `src/locales/zh_CN.json`：`name.War Axe`/`name.Incendiary Dart`/`name.Javelin`
  （前两个取自 CE 自带中文资源 bin/assets/zh_CN.json；javelin CE 资源无译名，取通用词「标枪」）。

测试：
- `src/test/b_4a_item_generation.test.ts`（新建，24 条）：见 §4。
- `src/test/invented_content_pool.test.ts`：potion_of_poison 留痕反转（§4-R3）；
  `totalArmorRunics` 反真空阈值 150→100（CE 模型下护甲符文本征水位 ≈4-6%，
  旧 10% 均匀模型的 377 → 实测 136；逐符文 ≥5 的真牙保留）。
- `src/test/fixtures/generation_baseline.json`：重捕获（4 seed × D1-D26 全量）。
  `note` 保留全部历史并追加 B-4a 授权理由；`capturedAt` = "B-4a (物品生成规则对齐后)"；
  每层的 `d` 字段保留。重捕获后 `generation_baseline.test.ts` 绿。

## 4. 对抗性测试与反向验证

`b_4a_item_generation.test.ts` 24 条全绿，其中对抗性断言与反向验证如下
（真实失败输出均为生产代码注入错误后实测，非构造）：

### 对抗① 投掷物"提前 return、跳过附魔分支"
注入（ItemLoader.spawnWeapon 开头插 `if (throwing) { quantity; quiver; return weapon; }`）：

```
AssertionError: 最小消耗 2（先掷后剥 = 附魔分支至少 1 掷 + quantity + quiver = ≥3）
    expected 2 to be greater than or equal to 3
❯ src/test/b_4a_item_generation.test.ts:277:110
```

**产物断言此刻仍绿**（enchantment=0 恒成立）——这正是任务书要求必须做 RNG 增量
断言的原因。还原后 `grep -rn "REVERT-ME" src/` = 0。

### 对抗② 计量表索引错位（"给错药水扣频率"）
注入（`decrementMeteredForSpawn` 改为按 web 药水目录序 +14 换算槽位）：

```
AssertionError: seed1 strength 药水 1 只/局: expected 1 to be greater than or equal to 3
❯ src/test/b_4a_item_generation.test.ts:149:59
```

探针显示错位后别的药水生成去扣 life/strength 的槽（life 频率被打到 **-4398**、
numberSpawned 虚增到 30），两类药水直接崩没。还原后绿。

### 对抗③ randomDepthOffset 单次 rand_range(-2,2)（分布与消耗次数双错）
先重捕获新基线（绿），再注入：

```
AssertionError: 生成结果偏离基线 354 处（若非有意改动，请查清成因）
    expected [ …(354) ] to deeply equal []
❯ src/test/generation_baseline.test.ts:38:9
```

还原后基线绿。（任务书建议"基线或 life 阈值断言必须红"——基线承担了这条。）

### 首轮实现自证（测试带是活的）
普通路径漏扣减的首版实现被自家区间断言抓住：附魔卷轴 72/局 > 90 上限内未超
但 strength 22.4/局 > 16 上限、life 22/局 ≈ 上限——若直接提交，`strength 药水整局总数`
必红。修复过程见 §2 过程数据。

## 5. 哨兵处置

本轮移动生成期 RNG 流。按任务书 §6.3：

- **未新增**任何锚定"RNG 流绝对位置"的哨兵；新哨兵全部为 ① `randomNumbersGenerated`
  增量（对抗①判据、chooseKind 恰 1 掷）或 ③ 性质断言（区间/分布/存在性/同 seed 双跑
  多重集一致）。
- `generation_baseline`：验收方已授权重捕获；已按"保留 note/capturedAt/d 字段 +
  追加 B-4a 授权理由"完成，重捕获后绿。
- `p1_31_35_placement_snapshot`（落位快照，授权清单内）：全量门禁中**绿**，无需处置。
- 撞红的两处既有哨兵（授权清单外）见 §6。

## 6. 需要追加授权的测试

全量串行门禁 1045 条中恰 2 红，**都在授权清单外**，均判定为本轮流位移的必然连带
（非语义回归），停下申报、未动手：

1. **`src/test/c_5_fall_subsystem.test.ts`** — "坠落回合的 RNG 消耗增量"哨兵，
   `.toBe(12327)`（C-6 捕获的"一层完整生成成本"pin 值）。
   红：`expected 14218 to be 12327`（c_5_fall_subsystem.test.ts:113）。
   必然撞它的理由：pin 值 = generateDepth 的固定生成账，本轮计量表/加权抽取/
   附魔模型全在生成期消耗 RNG，账面必然变。该测试自己的注释写明
   "pin 值……随生成链 legitimately 变化"（C-5→C-6 已重捕获过一次，7550→12327）。
   **申请**：按该测试既有惯例重捕获 pin 值为 14218 并注明 B-4a；机制断言
   （坠落回合消耗 == 一层固定生成账、怪物不得获得推进等 5 条）全部保持不变。
2. **`src/test/p4_8_scent_map.test.ts`** — T5 追踪怪贴脸场景，红在
   `expect(caught).toBe(true)`（p4_8_scent_map.test.ts:206）。
   必然撞它的理由：场景建在 `createHeadlessGame(20260915,'test')` 的种子流上，
   临时复现探针（已删）显示 wait4 回合怪物一回合消耗 42 次掷骰后 state 从
   HUNTING(2) 翻成 WANDERING(1) 然后走散——**气味系统与怪物 AI 代码本轮零改动**，
   是开局装备/生成消耗变化移动了流，翻转了某个怪物决策骰的结果。
   **申请**：由验收方裁定修法（候选：给该场景换用对生成期消耗不敏感的建场方式；
   或把 rat 的游走骰 mock 掉使场景对流位移免疫）。不建议硬改期望值。

另：`npm run build` 在**改动前的原树上就红**（`src/test/scroll_effects.test.ts:20
TS6133: 'T_OBSTRUCTS_VISION' declared but never read`，vue-tsc -b 阶段失败；
已用 git stash 在原树复验同红）。非本轮引入；本轮文件在 vue-tsc 下零新增错误。

## 7. 门禁结果

- `npx vitest run --fileParallelism=false`（全量串行，1302s）：

```
 Test Files  2 failed | 80 passed (82)
     Tests  2 failed | 1030 passed | 8 skipped | 5 todo (1045)
```

  2 红 = §6 申报的两处授权外文件；授权清单内文件（b_1/b_1a/b_1b/b_1c、
  invented_content_pool、itemFlavors、p1_30_i18n_gate、p1_31_35_placement_snapshot、
  generation_baseline、horde_selection、p2_0_seeded_rng）**全部绿**。
  类型修补（GameWithGen 交叉收缩 never、Map 泛型，均非语义变更）后复跑
  `b_4a + generation_baseline`：`25 passed`。
- `npx tsc --noEmit`：**EXIT 0**（零错误）。
- `npm run build`：失败于**先前既有**的 scroll_effects TS6133（原树同红，证据见 §6 尾），
  本轮引入的 3 个类型错误已修复，vue-tsc 下本轮文件零报错。

## 8. 交给 B-4b 的登记（本轮看到但被禁止/未授权修的一切）

按任务书 §3 边界，以下全部**只登记不修**：

1. **每层物品数量**：web `numItems = rng.randRange(3, 6)`；CE 是
   `3 + while(rand_percent(60))++`，D≤2 再 +2、D≤4 再 +1，另加 `extraItemsPerLevel`
   （Items.c:580-586）。web 每层数量期望 4.5 vs CE ≈6-7。
2. **落位热力图**：CE 全部随机物品走 `getItemSpawnHeatMap` + `coolHeatMapAt`
   （Items.c:719-737），食物与力量药水走 `randomMatchingLocation` 且避开走廊
   （:718-722）；web 全部 `floorTiles.pop()`。本轮未动。
3. **金币**：CE `numberOfGoldPiles`（POW_GOLD 议程调整，Items.c:594-660，金币
   "不是惩罚"单列投放）；web 金币恒 0。未动。
4. **钥匙**：机器/陷阱库/笼子各硬刷一把 iron_key 的结构未动（实测仍 ~140/局；
   CE 钥匙只由蓝图锁需求生成、量级个位数）。注意：randType-8 的 90% 随机钥匙
   分支已随旧等概率表退役——随机物品路径不再产钥匙，**剩余钥匙全部来自机器结构**。
5. **祭坛/机器 treasure 结构（本轮实测的附魔卷轴最大来源，≈45/局）**：
   web 祭坛按**每个 position** 掷 `randRange(0,4)`，20% 直接
   `spawnScroll('scroll_of_enchantment')`（Game.ts populateLevel altar 循环）；
   机器 treasure 也是"随机好物"。CE 的对应机制是**蓝图 feature 表**：每个蓝图实例
   在 PEDESTAL 上生成一件 feature 表指定的物品（GlobalsBrogue.c:218/269/279：
   `{0, PEDESTAL, DUNGEON, {1,1}, 1, (SCROLL), SCROLL_ENCHANTING, ...,
   MF_GENERATE_ITEM | MF_ALTERNATIVE}`——CE 祭坛**确实**摆附魔卷轴，但每蓝图
   **一件**，不是每格 20%。对齐方向：宝物生成挂到蓝图 feature/结果表，而非
   逐格重掷。**此轮 B-4a 完成后，随机物品路径的附魔卷轴已收敛到 CE 计量水位
   （≈13/局）；总量要从 60/局 降到 CE 量级，唯一的杠杆就在这条。**
6. **机器内 SCROLL/POTION/WEAPON/ARMOR 等概率抽取**（spawnBlueprintItem）：CE 机器
   物品由蓝图 feature 指定 kind/category，不做等概率池抽。且这些路径不过计量表
   （CE 同构——metering 只管 populateItems——所以"机器不过计量"本身不是偏差，
   偏差在池的构成）。
7. **怪物掉落**：`randPercent(50) ? 'dagger' : 'sword'` / `leather|chain` 硬编码
   （Game.ts ~6177）；CE 掉落走 per-monster 的 carryItem 概率与掉落表。
8. **D26+ 制度**：CE `depth > amuletLevel` 后不再生成普通物品（GEM/lumenstone
   分支、食物不占 lumenstone 名额，Items.c:573-577/694）；web D26 照常生成随机
   物品 + 特殊摆安卡。metered increment 在 CE 的 amulet 之后层不发生，web 照加。
9. **目录缺口**（非 B-4b，供排期）：potion_of_darkness、scroll_of_aggravate（计量表
   占位条目已为它们留 webId=null 的位）；wands polymorphism/negation/domination/
   plenty；staffs tunneling/blinking/entrancement/obstruction/discord/protection；
   rings light/reaping（INSTANT_ID_RING_KINDS 已预留 ring_of_light）；charms
   levitation/shattering/guardian/teleportation/recharging/negation。
10. **符文缺口**：武器 multiplicity/slowing/plenty、护甲 multiplicity/burden/
    vulnerability/immolation 无 web 实现——生成时掷骰照常消耗（流对齐 CE）、
    结果记 null 不落符文。效果实现在哪轮回池哪轮接（WEAPON/ARMOR_RUNIC_BY_CE_INDEX
    的 null 位就是回填点）。
11. **vorpalEnemy 战斗门**：字段已落（W_SLAYING 武器 / A_IMMUNITY 护甲），战斗侧
    类别门（Combat.c:133/402/669：vorpal 类别必杀/免伤）需要 monsterClass 成员
    名册（MK_* → web 怪物 id 映射）。Game.ts:5714 前后 A_IMMUNITY 现行"全额抵挡"
    简化维持原状（未授权扩大战斗语义）。
12. **计量状态持久化**：`meteredItems`/`foodSpawned` 未入 GameSnapshot，读档重置
    （与 B-1a 字段族同款缺口）。CE 里它们在 rogue 结构随存档往返。
13. **quiverNumber**：生成侧已按 CE 写入（1-60000），投掷交互（快速切换投掷目标）
    尚未消费。CE Items.c 的 quiver 轮换逻辑归投掷系统轮。

## 9. 验收条款逐条对照

| 任务书条款 | 状态 | 落点 |
|---|---|---|
| §2.1 计量表 30 条 + 三条非零原值 + 索引先卷轴后药水 | ✅ | ItemLoader.CE_METERED_ITEMS_TABLE；b_4a 测试钉 30 条长度/顺序/原值/占位数 |
| §2.1 每层入口 +increment | ✅ | Game.generateDepth → incrementMeteredItems；开局态测试钉 90/34/57 |
| §2.1 每件生成前写回（含 741-746 索引语义） | ✅ | spawnPopulateItem 的 meteredFreq sync；对抗②守护配对 |
| §2.1 阈值强制（仅 POTION_LIFE 生效） | ✅ | spawnPopulateItem 强制分支；"D6 前必出第一只 life"×10 seed |
| §2.1 按层硬保底 | ✅ 已实现（CE 全表 levelGuarantee=0，机制性死码，测试钉 levelScaling 唯一性时同表覆盖） | 同上 |
| §2.1 生成后扣减 | ✅ | decrementMeteredForSpawn（食物/强制/普通三路统一） |
| §2.1 randomDepthOffset 两次独立掷骰 | ✅ | Game.generateDepth；对抗③由基线抓 |
| §2.1 基表频率 0 + memcpy 还原 | ✅ | json 三类 frequency=0 + 跑局后仍 0 断言（web 无持久工作表，语义等价） |
| §2.2 chooseKind 频率加权（含消耗次数） | ✅ | 逐字移植；恰 1 掷有断言 |
| §2.2 dart frequency=0 不被随机抽中 | ✅ | json 0 + 20000 次抽取 0 出现 + 整局 dart ≤12（实测 5，仅机器路径） |
| §2.3 CE 武器附魔/符文模型（含整数除法顺序） | ✅ | spawnWeapon 重写；40%/各半/长尾三条统计断言 |
| §2.3 护甲分支独立照抄 | ✅ | spawnArmor 重写（rand_range(0,95)>armor×10 等）；leather/plate 符文率断言 |
| §2.3 特性旗标先于附魔分支 | ✅ | flags 从 json 先下发再掷骰（阈值计算吃 STAGGER/QUICKLY/EXTEND） |
| §2.3 W_SLAYING→chooseVorpalEnemy | ✅ | 字段+抽取落地；战斗门登记 §8-11 |
| §2.4 投掷物先掷后剥（不许跳过附魔） | ✅ | 产物断言 + RNG 增量断言（对抗①实证产物断言不够） |
| §2.4 charges=weaponKillsToAutoID | ✅ | spawnWeapon 尾部 |
| §2.5 补 war_axe/incendiary_dart/javelin | ✅ | weapons.json 3 条 CE 原值 + source 注释；整局可生成断言 |
| §2.5 halberd 退池不删 | ✅ 已是既成事实（反驳 R1），测试维持 0 出现 | — |
| §2.5 护甲比对 | ✅ 无缺（反驳 R2） | — |
| §6 测试 1（附魔卷轴区间） | ✅ [30,90]/局，来自 10-seed 测量（43-68），并注明 B-4b 收口后应收紧 |
| §6 测试 2（life 区间 + 阈值触发） | ✅ [9,36]/局 + D6 前必出 |
| §6 测试 3（基表 0 + 还原） | ✅ |
| §6 测试 4（加权抽取：高频>低频、freq=0 零出现） | ✅ telepathy/haste 比值带 + dart 零出现 |
| §6 测试 5（投掷物产物 + RNG 增量） | ✅ 含对抗①实证 |
| §6 测试 6（附魔 40%/各半/长尾） | ✅ |
| §6 测试 7（新种类可生成、halberd 0） | ✅ |
| §6.1 对抗性 ≥3 条 | ✅ 三条全部反向验证翻红（§4） |
| §6.2 反向验证贴真实输出 + REVERT-ME=0 | ✅ grep 计数 0 |
| §6.3 哨兵纪律 | ✅ 见 §5 |
| §7 门禁 | ✅ 见 §7（2 红均为授权外申报） |
| §8 纯测量先行 | ✅ 改造前/后两轮测量，脚本已删 |
| i18n 新物品名补键 | ✅ 3 键（War Axe/Incendiary Dart/Javelin），p1_30_i18n_gate 绿 |

## 10. 其余说明

- `git diff --stat`（见 §3 尾部数字）：10 文件，+1569/−939；新增 `src/test/b_4a_item_generation.test.ts`。
- 未执行任何 git commit/add/push（按 5.1）。
- 临时文件（测量脚本 ×2、探针 ×2、重捕获脚本 ×1）全部已删，`git status` 无残留。
- ItemLoader 与 Game 的两处循环导入风险（CombatSystem、ItemCategory 求值期）
  以内联小函数与惰性 getter 处理，均有注释说明来历。
