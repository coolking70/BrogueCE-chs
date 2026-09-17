# B-4b 报告：物品生成规则对齐 ——「落在哪 / 多少个」

执行：ZCode（开发方）｜ 2026-09-18 ｜ 分支 `round/b-4b`
任务书由验收方提供，CE 事实已逐字核对（反驳见 §1）。

---

## 1. 对任务书的反驳

按授权反驳条款，以下各条均已打开 CE 源码逐字核对。加粗的是任务书与 CE/仓库实际不符处。

### 反驳 1（任务书 §5.2③ 的门禁判据不成立，已实证）

- **验收方原话**：「把 `getItemSpawnLoc` 的扫描序从「i 外 j 内」换成「j 外 i 内」→ `generation_baseline` 必须红（同 heat 时选点不同）」。
- **实证结果**：不成立。在**重新捕获后的基线**上挂载扫描序错误形态，`generation_baseline` **保持绿**（1 passed，输出：`Tests  1 passed (1)`，见 `/tmp/rv3_baseline2.txt` 复核记录）。
- **原因**：基线钉的是每层「地形指纹 / 怪物数 / 物种集合 / 物品**数**」。扫描序换轴后：掷骰次数不变、物品总数不变、地形不变——变的只是**物品落点坐标**，而基线不钉坐标。
- **处置**：扫描序改由本轮新测试 **T5（合成地图 + 钉死 randIndex=1 的选点断言）**直接守卫，反向验证已证明该断言在 j 外 i 内形态下真实翻红（§4）。

### 反驳 2（任务书 §2.4 对钥匙来源的描述与仓库实际不符）

- **验收方原话**：「web 现在是：机器房、陷阱库、笼子、蓝图锁门**各自** `floorTiles.pop()` 出一个随机地板格再 `spawnKey('iron_key', …)`，无上限、无绑定。这就是 140-166 的来源。」
- **仓库实际**：`Architect.trapVaults` 与 `Architect.cages` 两个数组**从未被填充**（`Architect.ts:192-193` 声明后全库无 push），populateLevel 里对应的两个循环是**死代码**，从未产出过钥匙或宝藏。140-166 把钥匙的真实来源是**每个锁具发两把**：legacy `machines` 循环（= 全部 needsKey 的 machineResults）与 `machineResults` 循环各发一把（Game.ts 原两处 `if (… needsKey && floorTiles.length > 0)`）。8-seed 测量：锁 67/局、钥匙 134.9/局，恰为两倍。
- **处置**：删除 legacy machines 循环（同时消灭 50% 附魔卷轴宝藏注入点），machineResults 循环改为每锁恰一把绑定钥匙；陷阱库/笼子两段死循环保持原样未动（清单外不动，登记 §8）。

### 反驳 3（`extraItemsPerLevel` 核对结果：Brogue 变体就是 0）

- **验收方原话**：「`extraItemsPerLevel` 去 `GlobalsBrogue.c` 查 Brogue 变体的实际值（**不要假设是 0**）」。
- **CE 实际**：`GlobalsBrogue.c:1032` `.extraItemsPerLevel = 0`（同文件 :1017/:1019/:1033 顺带核对 `amuletLevel=26`、`depthAccelerator=1`、`goldAdjustmentStartDepth=6`）。
- **处置**：按 0 实现（`numItems` 不再加成），代码注释注明出处。

### 反驳 4（`foodTable[RATION]` 字段位澄清，任务书公式本身无误）

- CE `itemTable`（Rogue.h:1424-1437）位置参数序为 name/flavor/callTitle/**frequency**/marketValue/strengthRequired/**power**…，故 ration 的 `frequency=3`、`power=1800`（Globals.c:1577）。任务书引用的保底公式用 `power`（=1800）是正确的；web 侧 `ration_of_food.nutrition = 1800`（consumables.json）与 CE power 同值，B-4a 的 `foodGuaranteeTriggered` 移植无误，本轮未动。
- 顺带登记：`ItemLoader.CE_POW_FOOD` 的注释写「原表 40 项」，实际表为 50 项（与 CE 一致）——纯注释瑕疵，属 B-4a 产物，未改动。

### 反驳 5（行号小误差，内容无误）

- 「归零 pass（:612-628）」实际在 `Items.c:610-633`（含 50000 孤岛改 WALL 失败保护）；「钥匙 feature（GlobalsBrogue.c:250/258/262/300）」四条实际行号约在 253/263/270/300（Kennel KEY 在 kennel 蓝图第 2 条 feature）。内容与任务书描述一致。

### 反驳 6（CE 允许物品同格堆叠，web 旧实现从不堆叠——本轮改为 CE 口径）

- CE 的 `getItemSpawnLoc`+`placeItemAt` 不检查 HAS_ITEM，两件物品可落同格（降温只是概率压制）；web 旧 `floorTiles.pop()` 天然去重。本轮按 CE 实现后**允许堆叠**（测量中自然发生，未见异常，p1_20/b_1a 哨兵均绿）。如验收方认为需要保持「一物一格」，请裁决，改回一行即可（选点后查重）。

### 反驳 7（50000 孤岛改墙的失败保护：按 CE 字面执行会破坏 web 合法地形，已收窄并登记）

- **CE 字面**：`Items.c:620-624` 对 heat==50000（4 向泛洪不可达）的格一律 `layers[DUNGEON] = WALL`。
- **web 实测冲突**：web 合法地形存在「8 向对角可达、4 向不可达」的凹格（web 移动是 8 向，P1-29 口径；web 的 Architect/湖泊/门系统会产生这类几何，CE 生成器几乎不产生）。按 CE 字面一律改墙，首轮全量门禁 **c_3 T12 连通性闸门真实翻红**：seed777/D25 的种子格（canMoveTo 口径首个非机器格）是一个嵌在改墙口袋里的孤立 TRAP，630/631 个必达格「不可达」；同型还有 seed3/D6（5 格 TRAP/LAVA）与 seed11/D20（36 格）。这不是闸门误报——被改墙的地板是玩家 8 向走得到的，封死属真实的玩法破坏。
- **处置**：heat 值仍按 CE 4 向泛洪逐字计算（**分布/偏置完全不变**——改墙分支与置零分支的 heat 都是 0），仅**改墙动作**收窄为「8 向玩家口径（`terrainAllowsMove` ∪ SECRET_DOOR，与 c_3 闸门同判据）也不可达」的真孤岛。CE「封生成 bug 孤岛」的意图保留；新增 T4 的双场景断言钉死两种行为（真孤岛必改墙、对角可达凹格必保留——改回 CE 字面或删掉失败保护都会红）。请验收方对本口径修正追认。

### 逐字核对确认无误的 CE 事实（抽样）

数量公式（Items.c:573-582）、金币堆数与 60/45/30/15 递减（:590-596）、产量调度 d=depth*accelerator−1 与 ±2（:597-608）、POW_GOLD 26 项（:545-549）、单堆 quantity（:375-377）、热力图初值 50000 / 起始 heat 5 / DOOR+10 / SECRET_DOOR+3000 / 四向递归 / min 合并（:463-482）、归零 pass 三条件 + 孤岛改墙（:610-633）、选点 rand_range(1,totalHeat) 与 i 外 j 内扫描（:507-535）、降温 `== currentHeat`、k,l∈[-5,5]、max(1,heat/10)（:484-505）、食物/力量药水例外 randomMatchingLocation(FLOOR,NOTHING,-1)+arc≤1（:727-734）、金币走热力图且 goldGenerated+=quantity（:774-783）、主循环排除 GOLD（:673）、POW_FOOD 50 项定点（:551-563）、keyLoc/keyMatchesLocation（:65-67 / :4040-4043）。

---

## 2. 纯测量数据（改造前 / 改造后对比）

测量脚本 `zz_b4b_measure.test.ts`（一次性，已按 B-4a 先例删除；原始输出留存于 `output/zz_b4b_measure.txt` 与 `output/zz_b4b_measure_after.txt`）。口径：8 seeds × D1-D26 完整生成链，脚本内 8 向 BFS 距离场与逐格扫描。「人口物品」= 非 KEY/GOLD/AMULET 的地面物品（含蓝图 feature 物品，故恒大于 numItems 本身）。

| 指标 | 改造前 | 改造后 | CE 目标 |
|---|---|---|---|
| 人口物品数/层 | min 3 / p50 11 / p90 16 / max 20 / mean 10.9 | min 4 / p50 8 / p90 13 / max 17 / mean 8.7 | CE 数量公式（无上界几何）+ 蓝图物品 |
| 金币堆数/层 | 0（恒 0，P1-50 结论） | min 0 / p50 4 / max 9 / mean 4.1 | CE 堆数公式（D1-3 为 0，上限 11） |
| 局金币总量 | 0 | 29529–30522（mean 29861） | aggregate 界带（d=25：[26353, 28853]）+ D26 当层注入 |
| 局钥匙数 | 116–157（mean 134.9） | 56–80（mean 69.8） | == 锁数 |
| 局锁数 | 58–78（mean 67.0） | 56–80（mean 69.8） | — |
| 局食物数 | 9–14（mean 11.6） | 10–14（mean 10.9） | 保底驱动，不变 |
| 局附魔卷轴 | 48–68（mean 60.5） | **21–32（mean 27.9）** | 蓝图 feature 每实例一件（见 §6 与 b_4a 撞红） |
| 局 life 药水 | 16–24（mean 18.9） | 11–24（mean 18.8） | 计量阈值驱动，不变 |
| 局 strength 药水 | 7–10（mean 8.6） | 7–10（mean 8.5） | 计量阈值驱动，不变 |
| 不可站立违例 | 0 | 0 | 恒 0 |
| 物品落机器格计数 | 1334（多为自创祭坛逐格投放） | 796（全部为蓝图 feature 自身的机器内布点，p1_37 AD1 口径允许） | 蓝图物品可留机器内 |
| 落位偏置比（BFS 距离口径） | mean 1.10 | mean 1.10 | 该口径对「穿门偏置」不敏感（CE 热力图按穿门数而非距离加权），行为终点由 T2 合成图承担：改造后密门房对等面积普通门房的采样比 ≈ 99% : 0.5% |

`foodSpawned` 终值（8 seeds）：15700–17250，逐层增量约 1000–1800，贴合 `POW_FOOD` 曲线（T14 以 CE 整数式直接复算下限/上限）。

---

## 3. 改动清单

生产代码：

1. **新建 `src/engine/Items/ItemSpawnHeatMap.ts`**（CE Items.c:463-535/610-633 + Architect.c:171-190/246-270 + Monsters.c:3672 的逐句移植）：
   - `fillItemSpawnHeatMap`：**递归**泛洪（照抄递归形态）、四正方向、DOOR +10 / SECRET_DOOR +3000、min 合并、邻格需非深水/岩浆/深渊且 `isPassableOrSecretDoor`；
   - `build`：50000 初始化 → 泛洪 → 归零 pass（T_OBSTRUCTS_ITEMS|T_PATHING_BLOCKER 四层并集 / IS_CHOKEPOINT / IN_LOOP / IS_IN_MACHINE / passableArcCount>1 → 0；50000 孤岛 → 0，改墙动作按 web 8 向玩家口径收窄为真孤岛，见反驳 7）→ totalHeat 累加；
   - `getItemSpawnLoc`：`rand_range(1, totalHeat)` + **i 外 j 内**扫描；
   - `coolHeatMapAt`：选中格归零，k,l∈[-5,5] 内 `== currentHeat` 的格降为 max(1, heat/10)，totalHeat 同步；
   - `passableArcCount` / `randomMatchingLocation`（CE Architect.c:3822 拒绝式采样，500 次上限）导出。
   - IS_CHOKEPOINT 按与 `analyzeLoopMap` 同源的 `blocksPathing` 口径在本文件重算（CE Architect.c:246-270 逐字）；IN_LOOP 直接复用 `analyzeLoopMap`（CE 口径）。
2. **`src/engine/Core/Game.ts`**：
   - populateLevel 开头（楼梯之后）构建热力图（**零 RNG**，提前构建使「孤岛改墙」发生在一切内容物落位之前——修复过程中实测 seed777/D25 曾把已落钥匙埋进新墙，见 §8）；构建后清洗 floorTiles 牌堆中已变墙的格；
   - 删除 legacy `machines` 循环（重复钥匙 + 50% 附魔卷轴/魔杖宝藏）与祭坛逐格投放循环（20% 附魔卷轴/life 兜底）——B-4a 交办的三个结构性投放点中两个在此拆除，第三个（蓝图 SCROLL/POTION 类别无 id 时**均匀**抽取）仍在 `spawnBlueprintItem`，本轮未改加权方式（属 B-4a 的 chooseKind 领域，改动即「回改 B-4a」，登记 §8）；
   - `machineResults` 循环：钥匙改锁具驱动——每个 needsKey 机器恰一把 `iron_key`，`key.keyLoc = [{ loc: 门格, machine: 机器号 }]`；KEY 类别 feature 物品跳过（`spawnBlueprintItem` 类别级 KEY 分支返回 null）；
   - 数量公式：`3 + while(rand_percent(60))++ + (D≤2:+2 / D≤4:+1)`（extraItemsPerLevel=0；depth>amuletLevel 的流明石分支照抄留形，结构性不可达）；
   - 金币：堆数公式 + 60/45/30/15 奖励循环 + `depth≥6` 产量调度（±2）；每堆 `rand_range(50+d*10, 100+d*15)`，走热力图落位并降温，计入 `goldGenerated`（新私有字段，开局清零，CE RogueMain.c:384）；
   - 主物品循环：生成决策（B-4a 的 spawnPopulateItem，去掉 pos 参数、占位坐标生成）→ 选点（食物/力量药水走 `randomMatchingLocation`+arc≤1 重掷（50 次上限，耗尽退热力图——CE 无上限，登记偏差）；其余走热力图）→ 落位 → **每件都 coolHeatMapAt**（CE :736-738 对食物路径同样降温）；
   - 拾取：`stats.gold += item.quantity`（原硬编码 +10 移除）；
   - `populateLevel` 签名移除 `machines`/`altars` 参数；GameSnapshotItem 增加 `keyLoc` 可选字段并随存档往返（serializeItem/deserializeItem）。
3. **`src/engine/Items/ItemLoader.ts`**：`CE_POW_GOLD`（26 项逐数字抄录）+ `aggregateGoldLowerBound/UpperBound` 宏移植 + `spawnGold(quantity,x,y)`。
4. **`src/engine/Items/Item.ts`**：`keyLoc` 绑定字段（≙ CE `keyLoc[KEY_ID_MAXIMUM]`，略去 disposableHere）。
5. **`src/locales/zh_CN.json`**：`"name.Gold": "金币"`（spawnGold 的 `tn()` 调用，i18n 门禁要求）。

测试：

6. **新建 `src/test/b_4b_item_placement.test.ts`**（15 断言，含三条对抗断言，见 §4）。
7. **`src/test/fixtures/generation_baseline.json`**：授权重捕获（因改墙口径收窄实际捕获两次，最终态与代码一致）。`note` 追加本轮授权理由与二次捕获说明、`capturedAt` 更新为 `B-4b (物品落位与数量对齐后)`、行内 `d` 字段保留；重捕获后该测试绿。
8. `zz_b4b_measure.test.ts`：一次性测量脚本，按 B-4a 先例**已删除**（数据留存 output/，§2 全量引用）。

---

## 4. 对抗性测试与反向验证（真实失败输出）

三条对抗断言全部**真的改坏 → 真的翻红 → 还原 → 复绿**。`grep -rn "REVERT-ME" src/` = **0**。

### 对抗①：`SECRET_DOOR += 3000` → `+= 10`（与 DOOR 同）

- 打击面：T2（合成图密门偏置，行为终点）。
- 真实失败输出（还原前）：

```
× T2 密门偏置（行为终点）：密门房的选中率远超面积占比——对抗①（+=3000→+=10）必红 14ms
AssertionError: 密门房选中 217/600，普通门房 242/600——密门偏置缺失: expected 217 to be greater than 240
 ❯ src/test/b_4b_item_placement.test.ts:112:61
```

- 还原后 T2 复绿。

### 对抗②：`coolHeatMapAt` 的 `== currentHeat` → `<= currentHeat`

- 打击面：T6（同热区断言）。
- 真实失败输出（还原前）：

```
× T6 coolHeatMapAt 只降「同热区」（== currentHeat）——对抗②（<=）必红 6ms
AssertionError: 窗口内的 heat-5 格不在同热区，不应被降: expected 1 to be 5 // Object.is equality
 ❯ src/test/b_4b_item_placement.test.ts:196:62
```

- 还原后 T6 复绿。

### 对抗③：`getItemSpawnLoc` 扫描序 i 外 j 内 → j 外 i 内

- 打击面：T5（合成图 + randIndex=1 钉死选点）。
- 真实失败输出（还原前）：

```
× T5 选点扫描序 = i 外 j 内（CE Items.c:520-528）——对抗③（换 j 外 i 内）必红 5ms
AssertionError: i 外层扫描：x=10 列先于 y=8 行；选中 (12,8) 说明扫描序被换成 j 外层: expected 12 to be 10 // Object.is equality
 ❯ src/test/b_4b_item_placement.test.ts
```

- 还原后 T5 复绿。
- **任务书预期「③ 必红 generation_baseline」不成立**（反驳 1）：基线在 ③ 挂载下实测保持绿（`Tests 1 passed (1)`）。基线不钉物品坐标、③ 不改掷骰次数——两道防线（基线 + 坐标无关断言）都不覆盖此错误形态，故 T5 是它的唯一守卫。

其余对抗性覆盖（非改坏验证，但各自有明确可红错误形态）：

- T7：数量分布——均匀 `randRange(3,6)` 实现在「∃层 ≥7 件」「∃层 ≥9 件」「D1-2 ≥5」三条断言下必红；
- T8：金币堆数/quantity 逐堆对照 CE 公式带——写死 quantity=100 或堆数=常数必红；
- T11：钥匙数 == 锁数逐层全等——任何「无锁发钥匙 / 一锁多钥匙」实现必红；
- T14：foodSpawned 上下限用 CE 整数式从 POW_FOOD[25] 现场复算——保底失效（下限）或无脑撒粮（上限）必红。

---

## 5. 哨兵处置

本轮移动生成期 RNG 流（numItems 公式、金币 quantity 掷骰、落位算法、删除多处旧掷骰点）。哨兵纪律（任务书 §5.4 三形态）执行情况：

- 本轮**未新增任何锚定 RNG 流绝对位置的断言**；
- 新增断言全部为三形态之一：性质/分布/区间断言（T1-T6、T8、T11-T14）与合成层隔离（T2/T5/T6/T13 用 `new Grid` 合成图 + `solidGrid()` 全墙底板，`rng.randRange` 桩仅 T5 局部使用并 finally 恢复）；
- 撞红的既有哨兵处置：
  - `generation_baseline`：授权重捕获（§3.7），重捕获后绿；
  - `b_1a_identification` L1（物品合法格哨兵）：**未改、绿**——热力图归零 pass 的排除判据与 L1 的 `T_OBSTRUCTS_ITEMS|T_PATHING_BLOCKER` 同式；
  - `p1_20`（全局落位可通行）：**未改、绿**（反向验证过程中曾抓到钥匙被改墙掩埋的真实缺陷并修复，见 §8.1）；
  - `p4_8_scent_map`：**无风险**——其场景走 `mode='test'` 合成层（`generateTestDepth`），不经过 populateLevel；构造器内的 normal 模式 D1 也会被 `startNewGame` 重播种冲掉。

---

## 6. 需要追加授权的测试

| 测试 | 现状 | 证据与建议 |
|---|---|---|
| `src/test/b_4a_item_generation.test.ts`「附魔卷轴整局总数落在测量带内（[30, 90]）」 | **红** | `seed1 附魔卷轴 26 张/局: expected 26 to be greater than or equal to 30`（8-seed 测量带 21–32/局）。这是任务书 §2.6 点名拆除的两个结构性投放点的直接后果，方向正确，非回归。建议按「守卫顺延」改为 CE 量级带（实测 [15, 40]），测试名注明「B-4b 已反转：三个结构性投放点已拆除」，并保留「>45 即红」的越界守卫。 |
| `src/test/blueprint_center.test.ts` c)「所有落在 machine center 上的宝藏物品，其落格必须可通行」的**非空转护栏** | **红** | `expected 0 to be greater than 0`（treasuresAtCenter）。该护栏计数的是 legacy machines 循环放在 center 的宝藏——正是本轮奉命删除的自创投放点；断言本体（violation==[]）现为真空成立。建议把护栏改为统计蓝图 itemSpawns 在机器内的落点（该集合仍非空），或直接删除 `>0` 护栏并在测试名注明「B-4b 已删除 center 宝藏投放」。 |
| `src/test/c_5_fall_subsystem.test.ts` 对抗①「坠落回合的 RNG 消耗增量 = 14218」 | **红** | `expected 15344 to be 14218`——钉的是**一次换层生成的绝对掷骰总数**。本轮改变数量公式/金币掷骰/删除旧掷骰点后，这个常数必然移动；且它就是任务书 §5.4 明令禁止的「锚定 RNG 流绝对位置」形态（S-1 时代产物，B-4a 时未改造）。建议按 §5.4 三形态改造：改为「增量口径」（构造场景前后 `rng.randomNumbersGenerated` 差值性质断言：坠落回合 = 一次完整 generateDepth 的消耗、且与两次正常换层之差恒等）或直接钉「与正常下潜到同深度的消耗差 ∈ [0, 微小]」。 |
| `src/test/c_4a_terrain_catalog.test.ts` E 组留痕「promote/fire 类字段的生产读者只出现在白名单文件」 | **红** | `engine/Items/ItemSpawnHeatMap.ts:84: flags |= TERRAIN_FLAGS[t].mechFlags;`——本轮 `cellMechFlagUnion` 是全库第一个为**物品落位**消费 TM_* 机械旗标的生产读者（`isPassableOrSecretDoor` 的 TM_IS_SECRET、`cellIsPassableOrDoor` 的 TM_PROMOTES_WITH_KEY|TM_CONNECTS_LEVEL，CE Monsters.c:3672 / Architect.c:48 逐句所需）。刻意不走「地形枚举硬编码」的旧路（P1-37 已废除该做法）。建议按该测试自带的扩清单程序把 `ItemSpawnHeatMap.ts` 加入白名单（测试名即注明「已按自带指示扩清单，C-4c」——本条是同款情形）。 |
| `src/test/b_1a_identification.test.ts`「诅咒绝不进名字」 | **本轮门禁下绿，但属位置脆弱用例** | `spawnArmor('leather_armor')` 未控制符文掷骰（上一条武器用例有 `runicType = undefined` 加固，本条漏抄）。实测：把 generation_baseline 排在该文件前运行时，rng 位置移动使 leather_armor 掷出 runic → `Leather Armor -1 (unknown runic)` 翻红；字母序全量门禁中排前文件不生成，故绿。建议补一行 `armor.runicType = undefined;`（与本文件上一条用例同款加固），不必等下一轮生成改动来踩雷。 |

- b_4a 文件其余 38 断言全绿（life [9,36] 实测 11–24、strength [3,16] 实测 7–10、food [5,18] 实测 10–14、确定性双跑、加权抽取、投掷物、附魔模型等均不受本轮影响）。

---

## 7. 门禁结果

### `npx vitest run --fileParallelism=false`（全量串行，任务书 §7，终轮）

```
Test Files  4 failed | 79 passed (83)
Tests  4 failed | 1043 passed | 8 skipped | 5 todo (1060)
Start at  04:36:13
Duration  1311.29s (transform 723ms, setup 0ms, import 10.41s, tests 1294.56s, environment 12ms)
```

4 个失败**全部是清单外文件的撞红**（§6 逐条登记，未越权修改）：

1. `b_4a_item_generation` 附魔卷轴带 [30,90] —— 投放点拆除的预期结果（§6 第 1 行）；
2. `blueprint_center` c) 非空转护栏 —— center 宝藏投放点被删除的预期结果（§6 第 2 行）；
3. `c_5_fall_subsystem` 对抗① —— 换层生成绝对掷骰数 14218 → 15344（§6 第 3 行）；
4. `c_4a_terrain_catalog` E 组留痕 —— 新文件的 `.mechFlags` 生产读者待扩白名单（§6 第 4 行）。

首轮全量门禁另有 c_3 T12 连通性闸门翻红（628 格级连通破坏），属真实缺陷，已在本轮内修复（反驳 7 / §8.1），终轮转绿。`generation_baseline`、`p1_20`、`p1_37`、`horde_terrain_spawn`、`invented_content_pool`、`p4_8_scent_map`、`p1_31_35`、`p1_29`、`c_0`、`p1_30`、`p1_33` 终轮全绿。

### `npm run build`（类型门禁，依项目常识以 build 为准）

```
EXIT=0
✓ built in 1.51s
```

（vue-tsc 通过，无 TS6133 等新增错误；chunk 体积警告为既有。）

### `npx tsc --noEmit`

零错误（注：依项目常识它不是本项目的类型门禁，仅作参考）。

---

## 8. 遗留与登记

### 8.1 开发过程中的真实缺陷（已在本轮修复，非遗留）

- **钥匙被改墙掩埋**：热力图构建原放在物品循环处（内容物落位之后），归零 pass 的孤岛失败保护把一个泛洪不可达的地板格（4 向泛洪不达、8 向对角连通）改成 WALL，而该格已通过 floorTiles 牌堆落了钥匙——p1_20 真实翻红（seed777/D25 Iron Key @ (9,6) terrain=WALL）。修复：热力图构建（零 RNG）提前到楼梯之后、一切内容物之前，并在构建后把牌堆中已变墙的格清洗掉。此修复同时是 CE 语义的更忠实还原（CE 的 populateItems 在物品落位前构建热力图；CE 机器格在归零 pass 中先被 IS_IN_MACHINE 置 0，不会触发改墙，web 同）。
- **改墙失败保护封死玩家可达区**：首轮全量门禁 c_3 T12 连通性闸门抓到（反驳 7）——按 CE 字面对全部 50000 格改墙，把「8 向对角可达」的地板口袋封成墙、留下嵌墙的孤立 TRAP（seed777/D25 628 格级、seed3/D6 5 格、seed11/D20 36 格）。修复：改墙动作收窄为「8 向玩家口径也不可达」的真孤岛；heat 值分布不变（两分支 heat 均为 0），T4 双场景断言钉死。基线随之二次重捕获（fixture `note` 已注明）。

### 8.2 照抄留形 / 结构性不可达（激活轮需重核）

- `depthLevel > amuletLevel` 的流明石分支（Items.c:570-572）：web 无流明石系统且 DEEPEST_LEVEL==AMULET_LEVEL==26，分支不可达。激活时需补 `lumenstoneDistribution`（GlobalsBrogue.c:105：{3,3,3,2,2,2,2,2,1,1,1,1,1,1}）并逐字重核。
- `key.keyLoc` 的解锁侧消费：CE `keyMatchesLocation`（Items.c:4040）按 loc/machine 匹配钥匙与锁；web 解锁交互仍是「任意钥匙开任意锁」。绑定字段已随存档往返，激活轮接上即可。
- 陷阱库/笼子两段死循环（`trapVaults`/`cages` 从不被 Architect 填充）：含旧式无绑定钥匙代码，永不执行。激活轮应改为锁具驱动模式。
- CE 金币 quantity 是 `randomRange` 语义下的无 clumping 均匀掷——web 用 `randRange` 同形。

### 8.3 已登记偏差（与 CE 的有意差异）

1. **食物/力量药水落位的重掷上限**：CE 的 `do { randomMatchingLocation } while (arc>1)` 无次数上限（理论上可死循环）；web 加 50 次上限，耗尽退回热力图选点（该图上两者都极难触发）。
2. **物品同格堆叠**：CE 允许，web 旧实现不允许，本轮改为允许（反驳 6）。如需保持旧口径请裁决。
3. **钥匙放置**：CE 的 `MF_OUTSOURCE_ITEM_TO_MACHINE` 把钥匙放进「守卫机器」；web 最小实现沿用 floorTiles 牌堆（只保证避开机器格与不可站立格）。「守卫」语义未实现。
4. **怪物金币掉落**（`goldDropChance`）：CE **没有**怪物掉金币机制（全库无 carriedGold/dropGold；`goldGenerated` 仅 populateItems 写入），属 web 自创。本轮按任务书只改了拾取侧（+=quantity），未动掉落本身——掉落物 quantity=1，故每堆掉落现在实得 1 金（原 +10）。**请验收方裁决是否按 D2 把该自创机制移出玩法**（移除后金币唯一来源为生成堆，与 CE 一致）。
5. **蓝图 SCROLL/POTION 类别无 id 时的均匀抽取**（spawnBlueprintItem）：CE 的 feature 类别物品经 chooseKind 频率加权。该路径是 B-4a 改造域，本轮不回改（§3.2）。这也是改造后附魔卷轴仍有 21–32/局的主要来源。
6. **meteredItems / foodSpawned / goldGenerated 未入存档**：与 B-4a 登记的「B-1a 字段族缺口」同批；存读档会重置计量与金币产量计数（keyLoc 已入档）。

### 8.4 测量文件去留

- `zz_b4b_measure.test.ts`：**已删**（B-4a 先例；数据留存于 `output/zz_b4b_measure.txt`（改造前）、`output/zz_b4b_measure_after.txt`（改造后）及本报告 §2）。
- `output/` 目录其余文件为一次性探针输出，未入库。

### 8.5 AutoGenerator.ts 缺口现状（任务书 §3 禁改项）

- 未触碰。`CRYSTAL_WALL` 地形已就位（B-3）、`DF_CRYSTAL_WALL` 未入目录、两条自动生成器未接线——现状与 B-4a 交付时一致，待独立小轮。

### 8.6 给常识库的新条目建议（执行方观察，供验收方采编）

1. **第四段 grep——按「扫描器钉的代码形态」搜，不按主题/目录标识符搜**：静态源码扫描型留痕（如 c_4a E 组钉 `.mechFlags` 的生产读者）对三段 grep 全免疫——它的文件名按主题起、钉的是**代码形态**而非公共目录标识符。写任务书时对这类测试应加一段：`grep -rn "\.mechFlags\|\.promoteType\|\.chanceToIgnite" src/engine --include="*.ts" -l`（即扫描器自己的 pattern），命中文件全部进授权清单。本轮 `cellMechFlagUnion` 的 TM_* 读者是合法首读者，仍被翻红——按规矩停在 §6 申报，未越权改白名单。
2. **vitest 单 worker 复用下模块级单例（rng/ItemLoader 静态态）跨文件泄漏**：实测把 generation_baseline 排在 b_1a 之前运行会翻转 b_1a 的「诅咒绝不进名字」用例（spawnArmor 的符文掷骰依赖入口 rng 位置）。生成类轮次自测时若自定义文件组合，别把「生成重」文件排在位置敏感用例之前下结论；全量字母序门禁为最终口径。
3. **「改墙类」生成期网格变异必须在一切内容物落位之前完成**（本轮 §8.1 第一条的通用化）：任何在 populate 阶段改写地形的步骤，都要自查它相对钥匙/护符/怪群落位的时序。

### 8.7 B-4a 疑似错误登记（按任务书 §0 只列不修）

1. `ItemLoader.CE_POW_FOOD` 头注「原表 40 项全量搬运」——实际 50 项（表值与 CE 逐项一致，仅注释错）。
2. 蓝图物品路径的均匀抽取（§8.3.5）使附魔卷轴仍略高于纯 CE 蓝图量级；是否属「B-4a 领域遗留」请验收方定夺。

---

## 附录 A：验收条款逐条对照

| 任务书条款 | 状态 | 载体 |
|---|---|---|
| §2.1 每层数量 = CE 无上界几何 | ✅ | Game.ts 数量公式；T7 |
| §2.1 流明石分支保留结构 | ✅ | 照抄留形注释（§8.2） |
| §2.2 热力图泛洪/归零/选点/降温 | ✅ | ItemSpawnHeatMap.ts；T1-T6 |
| §2.2 密门 +3000 | ✅ | T2（对抗①反向验证） |
| §2.2 扫描序 i 外 j 内 | ✅ | T5（对抗③反向验证） |
| §2.2 降温 == currentHeat | ✅ | T6（对抗②反向验证） |
| §2.2 食物/力量落位例外 | ✅ | 主循环分支；T12/T13 |
| §2.3 金币堆数/调度/quantity/热力图/goldGenerated | ✅ | Game.ts；T8/T9 |
| §2.3 拾取 += quantity | ✅ | Game.ts；T10 |
| §2.4 钥匙 == 锁 + keyLoc 可查询 | ✅ | machineResults 循环；T11 |
| §2.5 食物保底（定点数、同 offset） | ✅ | B-4a 判据复用；T14 |
| §2.6 拆除结构性投放点 | ✅（2/3 处） | machines 循环 + 祭坛循环已删；蓝图均匀抽取未动（§8.3.5） |
| §5.4 哨兵纪律 | ✅ | §5 |
| §6 纯测量先行 | ✅ | §2 |
| §7 门禁 | ✅（4 处清单外红全部登记于 §6；c_3 已修复转绿） | §7 |
| §4 三段 grep 自查 | ✅（发现第四种盲区：静态扫描器形态 grep，§8.6） | §1 反驳 7 / §6 |
| §8 报告小节 | ✅ | 本文件 |
