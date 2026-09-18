# V-1a 报告：拆掉 `_random_good_` 直投

日期：2026-09-18。分支 `round/v-1a`，改动全部留在工作区（未 commit，遵守 §5.1）。

---

## 对任务书的反驳

| # | 任务书说法 | 核对结果 |
|---|---|---|
| 1 | **「area_shrine 改掩码应该零代码即可达成——把 JSON 里的 `_random_good_` 换成对应的类别声明即可」** | **不成立，两处都不成立。** ① web 的蓝图数据结构表达不了多类别掩码：`FeatureDef.itemCategory` 是单字符串，`spawnBlueprintItem` 的 switch 是单类别分支，且 **RING 无分支**——五类掩码既写不进 JSON 也走不到 RING。② 更根本的：CE 的掩码消费端**不是**"五类合成一张池子单次加权"。逐字核对 `Items.c:171-179`（makeItemInto）：掩码先过 `pickItemCategory(itemCategory)`（`Items.c:85-107`）——按 13 槽定序、`itemGenerationProbabilities_Brogue`（`GlobalsBrogue.c:109`：GOLD 50 / SCROLL 42 / **POTION 52** / STAFF 3 / WAND 3 / WEAPON 10 / ARMOR 8 / FOOD 2 / **RING 3** / CHARM 2 / AMULET 0 / GEM 0 / KEY 0）做**类别级加权**抽出**一个**类别，再在该类别内 `chooseKind` 基表频率选 kind。是**两段抽取**。任务书 §5.3 说「五类掩码确实按基表频率加权，不是等概率」——对，但完整的 CE 语义是「先按类别概率表选类（POTION 45.2%、SCROLL 36.5%、WEAPON 8.7%、ARMOR 7.0%、RING 2.6%），再按基表选种」。**本轮实现**（最小改动方案，均已落地）：JSON 用 `'POTION|SCROLL|WEAPON|ARMOR|RING'` 逐字转录 CE 位掩码记法（不自创新语法）；`Game.ts` 掩码分支按 `ItemLoader.CE_ITEM_GENERATION_PROBABILITIES`（即 CE 13 槽序、public 已有）做类别抽取后递归进既有单类别分支；补 `case 'RING'`（与四支同构，chooseKind 基表加权；`ItemLoader.ts` 不在授权清单，未动）。 |
| 2 | 「`case '_random_good_'` 在 :911-932」 | ✓ 属实（本次会话 Read 原文核对）。 |
| 3 | 「11 处 JSON 引用（4 vestibule + 6 key + 1 area_shrine）」 | ✓ 恰好 11 处，逐一核对无遗漏。`grep -rn "_random_good_" src/` 的完整引用面：JSON 11 处 + Game.ts case 1 处 + **注释性引用 4 个文件**（`b_4a_item_generation.test.ts:144`、`t_1_tail.test.ts:135`、`p1_20_item_placement.test.ts:8,12`、`BlueprintEngine.ts:454`）。测试注释不影响断言，未动（清单外的 `t_1_tail`/`p1_20`/`BlueprintEngine.ts` 见 §遗留）。 |
| 4 | 「CE 全源码没有这个概念」 | ✓ `grep -rn "_random_good_" BrogueCE-master/src/` 零命中（本次复核）。 |
| 5 | 「T-1 已把类别分支改成 chooseKind 基表加权」 | ✓ 属实，且本轮掩码第二段直接复用该分支。 |
| 6 | §2.2「CE 的这些机器本来就不放自产奖励」 | ✓ 与 V-0 勘察一致；CE 侧已抽查 `GlobalsBrogue.c` 门厅/守卫机器条目佐证。 |
| 7 | §4 允许清单 | **漏了两个已知会撞红的文件**（V-0 报告 §6 自己预告过的 `t_1_tail.test.ts`，和结构性扫描会撞的 `p1_33_machine_chokepoint.test.ts`——见「需要追加授权的测试」）。 |
| 8 | §5.1 「目标参考：CE 的附魔卷轴约 12-15/局」 | 方向正确：改造后 web 实测 13-16/局（10 seed 均值 14.9），已入量级。 |

V-0 的结论本轮未发现需要反驳之处；其「掩码必须挂在新结构上」的警告恰好被反驳 #1 证实（掩码消费端连抽取结构都和"换类别声明"的想象不同）。

---

## 纯测量数据

口径：`createHeadlessGame(seed)` + D1→D26 逐层 `generateDepth`，逐层收集 `game.items`（与 b_4a `collectFullRun` / t_1 完全一致）。ench=scroll_of_enchantment，life=potion_of_life，str=potion_of_strength。

### 10 seed（b_4a 口径）改造前 → 改造后

| seed | ench 前 | ench 后 | life 前 | life 后 | str 前 | str 后 |
|---|---|---|---|---|---|---|
| 1 | 24 | 16 | 21 | 6 | 9 | 9 |
| 7 | 27 | 14 | 24 | 6 | 7 | 9 |
| 42 | 31 | 14 | 16 | 7 | 9 | 9 |
| 2024 | 26 | 15 | 17 | 6 | 7 | 10 |
| 65537 | 25 | 15 | 17 | 6 | 8 | 10 |
| 99991 | 25 | 15 | 20 | 7 | 10 | 9 |
| 123456 | 24 | 16 | 16 | 6 | 9 | 10 |
| 654321 | 30 | 16 | 23 | 6 | 9 | 9 |
| 424242 | 22 | 13 | 14 | 6 | 10 | 8 |
| 8675309 | 25 | 15 | 19 | 7 | 9 | 8 |
| **合计** | **259** | **149** | **187** | **63** | **87** | **91** |
| 均值 | 25.9 | **14.9** | 18.7 | **6.3** | 8.7 | 9.1 |

- ench **-42%**（25.9→14.9/局），已落 CE 参考量级 12-15；life **-66%**（18.7→6.3/局）；str 不变（`_random_good_` 从不产出 strength，符合预期）。
- **蓝图路径归因（改造前仪表）**：`_random_good_` 每局被抽 58-76 次（均值 ≈66），其中附魔卷轴 9-16 张/局（均值 ≈11.3，≈66×1/6）、life 8-18 只/局（均值 ≈12.7，>1/6 的部分来自 roll 0-3 在浅层池空时兜底到 life）。
- **改造后蓝图路径贡献 = 恰 0**：10 seed 的蓝图路径产物 tally 里 ench/life/strength 均 0 次出现（v_1a T4 钉死）。
- **剩余来源量化（§5.1 要求）**：改造后 ench/life 100% 来自 `populateItems` 计量路径（CE 同构的 meteredItems 机制）。蓝图 SCROLL/POTION 类别抽取虽然每局仍有约 30-90 次（改造前仪表 33-91 次/局），但 enchanting/life/strength 基频 0 → 贡献恰 0（仪表证实）。V-0 §7.4 担心的 trapVault 自创循环**实测为死代码**：`Architect.trapVaults` 声明后无任何 push（`grep trapVaults.push` = 0），10 seed × 26 层的 spawnPotion 仪表里 vault 路径 0 次调用——该直投渠道实际不存在，无需处理（死数组本身登记 §遗留）。**机器密度放大器（web 每层 2-6 台 vs CE 约每 4 层 1 间）本轮未动**，但拆直投后它已没有可放大的直投渠道——留给 V-1b 按配额对齐。

---

## 改动清单

生产代码（2 文件）：
- `src/engine/Core/Game.ts`：删除 `case '_random_good_'`（原 :911-932 六选一）；新增掩码分支（`'|'` 分段 → CE 13 槽序 `pickItemCategory(mask)` 等价 → 递归单类别分支）；新增 `case 'RING'`（chooseKind 基表加权，无深度门，与 CE 环表全基频 1 一致）。
- `src/data/blueprints.json`：10 台门厅/守卫机器删除 `_random_good_` feature（**未替换**——CE 形态即零自产奖励；`vestibule_locked` 的 features 因此为空数组，对应 CE 门厅"机器=门本身"）；`area_shrine` 的 `_random_good_` → `'POTION|SCROLL|WEAPON|ARMOR|RING'`（CE `GlobalsBrogue.c:561-565` 掩码逐字转录；ALTAR/SIGN 等其余自创装饰按 V-2 范围不动）。

测试（5 文件，均在授权清单或授权语义内）：
- `src/test/fixtures/generation_baseline.json`：**授权重捕获**（4 seed × D1-D26 全量重采；note 保留并追加 V-1a 条目；capturedAt 更新；seeds 不变。D1 指纹不变——D1 无机器，符合预期；D2 起全变）。
- `src/test/b_4a_item_generation.test.ts`：ench/life 两条带**跟随实测平移**（ench [15,40]→[8,20]、life [9,36]→[2,12]，带内实测 13-16 / 6-7；注释记 V-1a 数据与理由）。strength 带未动。
- `src/test/b_4b_item_placement.test.ts`：T7b 断言范围修正（详见下节——这不是放宽，是把断言范围对齐 CE Items.c:729-734 的双路径语义）。
- `src/test/c_5_fall_subsystem.test.ts`：维护式 pin 15344→15339（任务书明示"可能再顶一次"），+1 行沿革注释。
- 新建 `src/test/v_1a_blueprint_items.test.ts`：7 条（结构钉 ×3 + 整局行为终点 ×2 + 掩码分布/哨兵 ×2）。

`git diff --stat`（见门禁结果节）。

---

## 对抗性测试与反向验证

新增测试的对抗性设计（每条钉一种"具体的、合理的错误实现"）：
- **T1 墓碑**：JSON 字面量扫描 + 「所有 itemCategory 必须落在 CE 类别名集合」语义守卫（防改名回归——按"改写形态绕过"教训，扫的是值域不是名字）。
- **T2 零奖励结构**：10 台机器不得有任何带 itemCategory 的 feature——不管用什么名字，"守卫房自产奖励"这个形态本身不得回流（V-2 按 CE 补解题工具时改写白名单，不是放宽）。
- **T4 行为负向**：整局仪表断言蓝图路径 0 次 `_random_good_` 抽取、0 件 ench/life/strength。
- **T5 整局带**：上限 20/12 挡直投回流（改造前 22-31/14-24 必破上限）；下限挡计量机制被误伤。
- **T6 分布**：6000 次掩码抽取的类别份额带（±6σ+1%）——等概率五选一实现（POTION 18.5% vs 期望 45.2%）与"合成单池按 kind 数加权"实现都出带。
- **T7 哨兵（形态①增量）**：掩码抽取 RNG 消耗恰 2（CE 类别 1 + kind 1）——合成单池单次抽取实现消耗 1 必红；神祠全掩码下界 ≥2。不锚定流绝对位置。

强制反向验证（真改坏 → 跑 → 贴真实失败输出 → 还原 → `grep -rn "REVERT-ME" src/` = **0**）：

**RV1+RV2（直投回流）**：把 `_random_good_` feature 加回 `vestibule_locked`（JSON）+ 六选一 case 加回 `spawnBlueprintItem`（Game.ts）→ 4 条同红：

```
× T1 墓碑…  × T2 十台门厅/守卫机器零自产奖励…  × T4 蓝图路径零直投…  × T5 整局 ench/life 下移带…
AssertionError: seed1 附魔卷轴 22/局: expected 22 to be less than or equal to 20
```

**RV3（等概率掩码）**：类别权重全部改为 1（等概率五选一）→

```
AssertionError: POTION 份额 0.1850，期望 0.4522: expected 0.185 to be greater than 0.40362166288296797
```

**RV4（合成单池单次抽取）**：掩码分支直接返回 POTION 抽取（省掉类别掷骰）→

```
AssertionError: 掩码抽取必须恰消耗 2 次掷骰（类别+kind，CE 两段各 1）: expected 1 to be 2
```

每次注入 → 真实红 → 还原 → 复跑全绿（7/7）→ REVERT-ME 残留 0。

**哨兵处置中的额外发现（已按 CE 修正，非放宽）**：b_4b T7b 断言"人口物品不落 IN_LOOP 格"翻红，排查（临时探针，已删）证实落环上格的是**一枚干粮**——CE `Items.c:729-734` 明文：食物与力量药水不走热力图，落位只有"不落走廊弧"一条约束，`randomMatchingLocation` 本就不查环。web 生产代码与 CE 完全一致，是测试把热力图路径的性质错加到了 randomMatchingLocation 路径上。修正：IN_LOOP 断言收窄到热力图路径物品（其余三条断言对两类物品都保留）。V-1a 移动流只是让第一枚"走运落环"的干粮在固定 seed 上现身——与 B-4a 的 T5 教训同类（断言超出了机制保证的范围）。

---

## 哨兵处置

本轮移动生成期 RNG 流（每台受影响机器少掷 `randRange(0,5)` 与后续类别骰、物品总数变）。处置按 §5.1 三形态：

1. **`generation_baseline.json`**：授权重捕获（note 追加 V-1a 条目，seeds/字段口径不变；p2_3 的活跃元数据断言只涉及 `p2_3_baseline.json`，未触碰）。
2. **c_5 维护式 pin**：15344→15339（D2 层固定生成成本；原作者既定设计 + 验收方 2026-09-18 说明许可硬填，+1 行沿革）。
3. **交互期**：本轮全部改动在生成期（spawnBlueprintItem 只在 populateLevel 调用），交互期掷骰零改动——未新立交互期哨兵。
4. 新增哨兵全部为形态①（`rng.randomNumbersGenerated` 增量）/性质断言，无流绝对位置锚定。
5. b_4a 的既有哨兵（AD-A3 类别抽取消耗等）全部原样保持绿；本轮唯一动过的带类断言均"跟随实测平移"。

---

## 需要追加授权的测试

**五个清单外测试撞红，均未改动**，全部登记待裁决。其中四个是**同一个坏层**（seed20260916/D21 基础地图断连）从四份扫描口径各自观察到，一个是 t_1_tail 的量带下限：

1. **`src/test/t_1_tail.test.ts`**（「整局附魔卷轴/life/strength 总数：测量带」一条）：
   ```
   AssertionError: seed1 附魔卷轴 16/局: expected 16 to be greater than or equal to 18
   ```
   它钉的量与 b_4a 那两条带完全同源（ench [18,38]、life [10,30]），改造后实测 13-16 / 6-7 **必然**跌破下限。V-0 报告 §6 的授权预告里列了它，任务书清单漏收。**建议裁决**：比照 b_4a 的授权语义平移（ench [18,38]→[8,20]、life [10,30]→[2,12]，"跟随实测平移，不是放宽"）；该文件 135 行注释还提着 `_random_good_`（纯注释，可顺带更新）。在拿到授权前我不动它。

2-5. **同一个坏层，四个观察者**（`c_3_walls_doors` T12 / `p1_26_invariants` / `p1_29_lake_connectivity` / `p1_33` a)）：
   ```
   c_3 T12:   AssertionError: 密门视作通路口径下仍存在不可达层（真回归，非假阳性）：
              seed20260916/D21
   p1_26:     AssertionError: 下楼梯不可达层数=1（要求严格 0）。
              坏层明细: seed20260916/D21: 从上楼梯可达 23/466 格
   p1_29:     AssertionError: 端到端坏层集合与已知机器阶段缺陷集不符。
              实测坏层: 20260916/D21: 从上楼梯可达 23 格
   p1_33 a):  AssertionError: 端到端存在不可达层（机器阶段仍在切断关卡）：
              20260916/D21（可达 23 格）
   ```
   **已探明根因（只读探针 + 阶段快照，探针已删，生产代码未动）**：该层**一台机器都没建成**（`buildMachines` 返回空）、不可达区 **0 个机器格**；对 `Architect.generateTerrain` 挂快照后实测——**在 generateTerrain 返回点 up 楼梯所在连通块就只有 23 格**（阶段末 2 个连通块 996+23，终局可达恰 23，分毫不差——后续 placeTraps/机器/autogen/finishDoors/finishWalls(true) 未再改变可达性）。即：断连产生于 **generateTerrain 内部**（carve/loops/湖泊/finishWalls(false) 一带，具体切割者待勘察——它穿过了 P1-29 的"全部干地一个连通块"合同），与本轮改动无机制因果；V-1a 的唯一作用是移动了流位置，把一张新的布局骰面掷了出来——与 B-4a 的「挑 seed 的测试」教训同类（判据：断言的保证依赖流位置选中的具体布局，而非机制不变量）。**建议裁决**：(a) 四个文件都属清单外，红线不动；若验收方认可"流移动轮次重掷布局骰"的定性，按各测试自己预留的协议操作——p1_29 的失败消息明写「若…合并了会移动 RNG 流的轮次，请复跑实测并更新 KNOWN_MACHINE_STAGE_BAD_LEVELS」，p1_26/p1_33/c_3 同理显式收录或改口径；(b) **真正该修的是 generateTerrain 内部的连通性漏洞**，建议开独立勘察轮（p1_33 文件头基线"坏层 5"说明这类缺陷在 P1-33 修复前就存在过 5 例，P1-33 只灭了机器致的 5 例，湖泊/墙门段的残余缺陷此次是首次在流位移后现身）。另注：p1_33 a) 的机器数下限断言（1519 台）未触线，p1_26/p1_29/c_3 的其余断言全绿。

---

## 门禁结果

`npm run build`（vue-tsc -b，非 tsc --noEmit）：

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build
dist/assets/index-CW7eYKs6.js   879.81 kB │ gzip: 265.38 kB
✓ built in 1.66s
```
（chunk >500kB 警告为既有 advisory，非本轮引入。）

`npx vitest run --fileParallelism=false`（不带文件参数）：

```
 Test Files  5 failed | 82 passed (87)
      Tests  5 failed | 1105 passed | 8 skipped | 5 todo (1123)
 Start at  11:43:49
 Duration  2499.78s (transform 946ms, setup 0ms, import 12.09s, tests 2480.50s, environment 14ms)
```

**已知红 = 恰好上节申报的 5 条**：t_1_tail 的量带 ×1；20260916/D21 坏层 ×4（c_3 T12 / p1_26 / p1_29 / p1_33，同一根因，四个观察者）。**授权清单内及全部其余测试 1105 条全绿**（含 generation_baseline 重捕获、b_4a 平移后、b_4b T7b 修正后、c_5 pin 更新后、新建 v_1a 7 条）。

`git diff --stat`：

```
 brogue-web/src/data/blueprints.json                | 115 +---
 brogue-web/src/engine/Core/Game.ts                 |  61 +-
 brogue-web/src/test/b_4a_item_generation.test.ts   |  16 +-
 brogue-web/src/test/b_4b_item_placement.test.ts    |  12 +-
 brogue-web/src/test/c_5_fall_subsystem.test.ts     |   4 +-
 brogue-web/src/test/fixtures/generation_baseline.json | 736 ++++++++++-----------
 6 files changed, 433 insertions(+), 511 deletions(-)
```
新增：`src/test/v_1a_blueprint_items.test.ts`（未跟踪）。临时测量/探针脚本（zz_v1a_measure / zz_v1a_capture / zz_probe*）已全部删除，`git status` 除上述外无它物。

---

## 遗留与登记

交给 **V-1b**（引擎补机制）：
1. 机器密度/配额：web `min(2+⌊depth/3⌋,6)` 台/层 vs CE 约每 4 层 1 间奖励房（全局计数器载体需先定，V-0 §7.2）。拆直投后该放大器已无直投渠道可放大，但仍使门厅/守卫机器出现频率远超 CE。
2. `MF_ALTERNATIVE`/`MF_ALTERNATIVE_2`、抽签资格过滤、`MF_BUILD_VESTIBULE` / `MF_OUTSOURCE_ITEM_TO_MACHINE` / `MF_ADOPT_ITEM` 递归与失败回滚（V-0 §6 的 1-5 步清单不变）。
3. 铁钥匙的"守卫机器领养落位"（本轮 vestibule/key 机器删除室内奖励后，锁门机器的唯一内容就是锁+无守卫钥匙——中间态观感见下）。

交给 **V-2**（blueprints.json 全表重写）：
4. `area_shrine` 其余自创装饰（ALTAR×1 + SIGN×1）应按 CE 换成 SACRED_GLYPH + HAVEN_BEDROLL + BONES；掩码物品 feature 本轮已对齐（含 MF_ALTAR 的 web 落位语义保留）。
5. 受影响房间"变空"的实际观感（§5.1 要求的说明）：10 台机器中 5 台仍保留地形/机关 feature（草/陷阱/水/蛛网/熔岩圈/怪），`vestibule_locked` 与 `key_lava_moat` 分别只剩"一扇锁门"和"一圈熔岩"；锁门机器的钥匙仍在无守卫的随机地板上。开荒体验：这些房间从"机关房+保底大奖"退化为"纯机关房"，大奖流入完全交给 populateItems 计量路径——**这正是 CE 形态**（V-0：门厅零奖励、守卫机器靠领养），不是功能缺失。
6. `blueprint_center.test.ts` / `p1_31_35_placement_snapshot.test.ts` / `p1_37_machine_flag_i18n.test.ts` / `invented_content_pool.test.ts` 本轮实测全绿未动（授权清单内备而未用）。

其他登记：
7. **generateTerrain 内部的连通性漏洞**（见申报 #2-5 的根因）：seed20260916/D21 在 generateTerrain 返回点即已分裂（996+23 两块），机器阶段零参与；具体切割者在 carve/loops/湖泊/finishWalls(false) 一带待勘察。p1_33 文件头的修复前基线"坏层 5"说明此类缺陷在机器阶段之外早有先例；四个端到端扫描（c_3/p1_26/p1_29/p1_33）这次同时被流位移掷出的新布局触发。建议独立勘察轮；四个测试的"零坏层"承诺在流移动下不构成机制保证（B-4a 教训的同型）。
8. `BlueprintEngine.ts:454` 注释仍提 `_random_good_`（文件不在授权清单，1 行注释清理顺延）。
9. `Architect.trapVaults` 是从未被填充的死数组（连带的 Game.ts:1208-1231 vault 循环为死代码）——与 V-0 §7.4 的判断不同：那里担心的"vault life 直投仍在"实测为 0 次调用。建议后续轮按 D2 清理或激活。
10. 戒指目录缺口：CE 8 环（light / reaping 缺），web 现有 6 环全基频 1。掩码路径暂按 6 环加权（合计权重不变，份额按 6 环归一）。
11. **RNG 流已移动**（常识 §四要求声明）：同 seed 的地图与掉落全变（D1 除外）；`generation_baseline.json` 已随本轮授权重捕获。

---

## 附录

- 全量套件的 5 条失败详情全文见「需要追加授权的测试」节引用。
- 本报告与全部改动同在工作区，未执行任何 git 写操作。
