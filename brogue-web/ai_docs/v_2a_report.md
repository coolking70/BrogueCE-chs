# V-2a 报告：把前厅与守卫机器接回来

日期：2026-09-19　分支：`round/v-2a`（worktree wt-v-2a）　状态：完成

---

## 1. 对任务书的反驳

按授权反驳条款逐字核对了 `GlobalsBrogue.c` / `Architect.c` / `Rogue.h`，以下与任务书不符处**以 CE 为准**：

1. **「web 的 5 个 reward 蓝图按此补上对应 feature」与 CE 不符（2.1）**。
   CE 的 Kennel 蓝图（`GlobalsBrogue.c:243-251` "Kennel -- allies locked in
   cages…"）的 feature 表**没有**前厅 feature——它是
   `MONSTER_CAGE_CLOSED` 笼群 + `KEY_CAGE` 外包钥匙 + 血迹/骨堆 + 墙内火把。
   带前厅递归 feature 的 reward 蓝图是：Mixed library(:186)、Mono
   library(:194)、Treasure room(:204)、Permanent pedestal(:213)、Consumable
   pedestal(:220)、Commutation(:235)、Resurrection altar(:232) 共 7 条，
   **Kennel 不在其中**。本轮只给 4 个有 CE 依据的 reward 蓝图接前厅
   （library / consumables / pedestals / commutation），`reward_kennel` 未接。
   这不影响内容回归目标：CE 的 Kennel 也不产生锁门（它的锁是笼锁
   KEY_CAGE，归钥匙轮）。
2. **「每个奖励房蓝图末尾都有一条统一的前厅 feature」的"末尾"不准确（2.1）**。
   CE 两个 library 蓝图的前厅 feature 在表内**第 2 位**（CARPET 涂装之后、
   内容笼之前，:186/:194）；pedestal / commutation 才在末尾。本轮按各 CE
   蓝图原位插入：`reward_library` 插在 features[0]（web 无 CARPET 涂装，
   等价位置 = 内容 feature 之前），其余三个在末尾。
3. **「web 的 4 个 vestibule_* 蓝图按 CE 对应物补上」的落地范围收窄（2.2）**。
   CE 前厅目录 9 条里只有 "Plain locked door"（:299-301）带
   `KEY, KEY_DOOR` + `MF_OUTSOURCE_ITEM_TO_MACHINE` 钥匙外包；其余前厅
   （flammable barricade / statue / pit traps 等）**没有**钥匙外包，且各自
   需要 web 尚无载体的地形/物品（WOODEN_BARRICADE、SCROLL_SHATTERING、
   TRAP_DOOR_HIDDEN×60 等）——照抄会造出死数据。故 2.2 实际落地 =
   `vestibule_locked` 按 CE :300 逐字段补齐；其余 3 个 vestibule 蓝图保持
   V-1c 现状（它们照常参与前厅抽签、可被递归建成），全面重写归 V-2b。
4. **2.3 的行号归属**：CE :218-219 两条 feature 属于独立的
   "Guaranteed good consumable item on glowing pedestals" 蓝图（:215-221）；
   web 只有 pedestal 系的 `reward_pedestals`（形态对应 :206-214 永久物）。
   按任务书指令把两条落到 `reward_pedestals`，照做无误；登记：CE 实为两个
   蓝图，V-2b 全表扩充时宜拆分。
5. **`MF_KEY_DISPOSABLE` / `MF_IMPREGNABLE` 按数据带、按语义不带**。CE :300
   的 feature 原值带这两旗标；任务书 §3 禁止"实现" MF_KEY_DISPOSABLE。
   处理：数据字符串按 CE 原值带上（引擎零消费路径，`key_rat_trap` 的 KEY
   feature 已有先例），语义实现归钥匙轮——不构成"实现"。
6. **字段序核对（Rogue.h:2618-2637 machineFeature）**：DF、terrain、layer、
   instanceCountRange[2]、minimumInstanceCount、itemCategory、itemKind、
   monsterID、personalSpace、hordeFlags、itemFlags、flags——与任务书 2.1
   的读法一致，无冲突。通用前厅 feature 的 CE 原值
   （:186 等）：DF=0、terrain=0、layer=0、{1,1}、minInsts=1、全 0、
   personalSpace=**2**、flags=(MF_BUILD_AT_ORIGIN | MF_PERMIT_BLOCKING |
   MF_BUILD_VESTIBULE)——与任务书一致。

---

## 2. 三件逐条落地情况

### 2.1 reward 蓝图接前厅 feature ✅（4/5，kennel 按 CE 反驳除外）

4 个蓝图各加一条：

```json
{
  "instanceCount": [1, 1],
  "minimumInstanceCount": 1,
  "personalSpace": 2,
  "flags": ["MF_BUILD_AT_ORIGIN", "MF_PERMIT_BLOCKING", "MF_BUILD_VESTIBULE"]
}
```

插入位按 §1 反驳第 2 条。引擎侧为此补了 `findFeaturePosition` 的
`MF_BUILD_AT_ORIGIN` 支持（`Architect.c:520-522` 候选资格函数与
`:1404-1407` 落点循环的直译：feature 恒落 origin=机器门位，且在
occupied/personalSpace 检查之前放行——web 侧同样无视 usedCells）。
`minimumInstanceCount` 按显式值 1（=CE minInsts，也是缺省值，行为中性）。

### 2.2 vestibule_locked 接钥匙外包 ✅（其余 3 个前厅无 CE 依据，见 §1.3）

按 CE :300 逐字段：

```json
{
  "terrain": "LOCKED_DOOR",
  "itemCategory": "KEY",
  "instanceCount": [1, 1],
  "minimumInstanceCount": 1,
  "personalSpace": 1,
  "flags": ["MF_BUILD_AT_ORIGIN", "MF_PERMIT_BLOCKING", "MF_GENERATE_ITEM",
            "MF_OUTSOURCE_ITEM_TO_MACHINE", "MF_KEY_DISPOSABLE", "MF_IMPREGNABLE"]
}
```

KEY 指令经既有递归块（V-1c）交由 `buildAMachine([BP_ADOPT_ITEM])` 领养，
10 次全败则整机回滚。**kind 维度（KEY_DOOR/KEY_CAGE/KEY_PORTAL）未扩**，
归钥匙轮；web 的守卫机器尚无 `MF_ADOPT_ITEM` 消费 feature（CE 16 条领养
蓝图全带），故「守卫机器持有钥匙」暂由 Game 的锁驱动钥匙近似（B-4b 口径，
keyLoc 绑门位）——领养机制本身在合成蓝图测试（v_1c R1/R3）与生产数据
（本报告 T2）双双行使。

### 2.3 基座二选一 ✅

`reward_pedestals` 按 CE :218-219 补两条：

| CE 原值 | web 落地 |
|---|---|
| `(SCROLL), SCROLL_ENCHANTING, {1,1}, 1, PEDESTAL, personalSpace 2, (ITEM_KIND_AUTO_ID), (MF_GENERATE_ITEM\|MF_ALTERNATIVE\|MF_TREAT_AS_BLOCKING)` | `itemCategory: "SCROLL", itemId: "scroll_of_enchantment", instanceCount [1,1], minimumInstanceCount 1, personalSpace 2, flags [MF_GENERATE_ITEM, MF_ALTERNATIVE, MF_ALTAR]` |
| `(POTION), POTION_LIFE, …同上` | `itemCategory: "POTION", itemId: "potion_of_life", …同形态` |

差异说明：① `PEDESTAL` 地形 web 无载体，跟随该蓝图既有 WEAPON/ARMOR
feature 的 `MF_ALTAR` 形态（物品标 altar 呈现）；② `ITEM_KIND_AUTO_ID`
由 web 的显式 `itemId` 承担；③ `MF_TREAT_AS_BLOCKING` 属连通性复核链
（V-1c 降 scope 未接线，本轮授权不含 c_4b F1 扩白名单），未带。
V-1b 的替代集合机制在构建循环前一次性选一（`BlueprintEngine.ts:681-703`），
生产数据自此非零掷骰——v_1b P1 前提已按留痕惯例反转（见 §4）。

---

## 3. 纯测量数据

同一口径前后对比：**15 seeds × D1-D26 = 390 层**，临时 spec 采集后已删除
（改造前测量在动第一行数据之前完成；V-1c 报告 §3 的 15 seeds 组成员未
记录，故本轮自建 15 组并**前后同组**对比；任务书引用的 V-1c 数字 87 台/
锁门 35 与本表 90/31 的差即 seeds 组不同所致）。

| 指标 | 改造前（V-1c 后） | 改造后（V-2a） | 变化 |
|---|---|---|---|
| 机器总数 | 90（0.23/层） | **185（0.47/层）** | +106% |
| 类别分布 | reward 90 | reward 86 / **vestibule 71 / key_guard 28** | 递归两类回归 |
| 锁门机器（needsKey） | 31 | **64** | +107% |
| 蓝图物品指令 | 129 | 128 | ≈持平（基座大奖进了 pedestal 台内） |
| 蓝图怪物指令 | 16 | **100** | 守卫机器内容回归 |
| 递归子机器（subMachines） | **0** | **99**（71 前厅 + 28 守卫） | 递归路径真实行使 |
| 出现蓝图种数 | 5 | **15**（现有全目录） | 内容回归 |

改造后蓝图分布：reward_consumables 31 / reward_commutation 21 /
reward_kennel 15 / reward_pedestals 11 / reward_library 8 /
vestibule_locked 28 / vestibule_flammable 19 / vestibule_guardian 18 /
vestibule_pit_traps 6 / key_rat_trap 9 / key_lava_moat 8 / key_poison_gas 4 /
key_boss 3 / key_fire_trap 2 / key_flood_trap 1。

行为终点（任务书 §6.1）：vestibule / key_guard 机器重新出现（0 → 71/28），
锁门 31 → 64（V-1c 口径 35 → 64，回升 83%），锁/钥一一对应保持
（b_4b T11 全绿）。

---

## 4. 改动清单

```
 src/data/blueprints.json                        | 105 ++-   ← 2.1/2.2/2.3 数据
 src/engine/Generator/BlueprintEngine.ts         | 100 +-   ← MF_BUILD_AT_ORIGIN + 三项性能缓存（失效点解耦）
 src/test/fixtures/generation_baseline.json      | 742 +--   ← 授权重捕获（note 追加 V-2a 段）
 src/test/blueprint_center.test.ts               |  30 +-   ← b) 前厅类别豁免（CE 锚点语义）
 src/test/p1_33_machine_chokepoint.test.ts       |  20 +-   ← a) 机器结构合同前厅豁免
 src/test/v_1a_blueprint_items.test.ts           |  22 +-    ← T2 留痕反转（错误消息自预告）
 src/test/v_1b_alternative.test.ts               |  29 +-    ← P1 前提留痕反转
 src/test/v_1c_machine_structure.test.ts         |  21 +-    ← Q1b 类别断言反转
 ?? src/test/v_2a_vestibule_return.test.ts       （新建，3 用例）
 8 files changed, 649 insertions(+), 404 deletions(-)
```

- `BlueprintEngine.ts` 的改动均在"新 feature 需要的支持"内：
  ① `findFeaturePosition(origin)` 参数与 `MF_BUILD_AT_ORIGIN` 分支；
  ② ** chokeMap 分析缓存**（`gateAnalysisCache`）——失败重试间共享、
  机器建成（applyBlueprint 返回成功前）才失效；失败路径 `restoreLevel`
  恢复到与缓存一致的状态。CE 的 chokeMap 本就是每层预计算、机器阶段
  不重算（`Architect.c:1063-1101`），web 每次重试全图重算是性能债；
  ③ **门位候选缓存**（`gateCandidatesCache`，按 roomSize 区间键控）——
  失效点在 applyBlueprint **步骤 1**（machineNumber 是候选过滤
  `!IS_IN_MACHINE` 的依据，写入即失效）；**与 ② 解耦**：analysis 在建成
  前不被步骤 1 失效——递归子机器沿用父选址时的分析正是 CE 的预计算
  语义，两者同点失效会让子机器的分析耦合进父机器地形、选址与基线分叉
  （seed31337/D2 实证，基线翻红后二分定位、解耦后回绿）；
  ④ `effectiveBpFlags` 的 WeakMap 缓存（蓝图是静态数据）。
  ②③④ 是纯性能修复，RNG 消耗逐位不变（generation_baseline 复跑绿为证）。
  病态层（seed100/D2 的领养确定性空转，40 万次 noCandidates 调用）
  554s → 105s → **21-25s**，剩余是 chooseBP 的 JS 固有成本（CE 同行为
  0.4s，60 倍语言差距，行为语义对齐）。
- 未动：Game.ts、V-1c 的递归/配额/回滚逻辑、`MF_KEY_DISPOSABLE` 语义、
  keyLoc kind 维、`BP_TREAT_AS_BLOCKING/REQUIRE_BLOCKING` 复核。

---

## 5. 对抗性测试与反向验证

三条对抗路径各做了一次真改坏 → 跑 → 贴真实失败输出 → 还原；
还原后 `grep -rn "REVERT-ME" src/` = **0**，工作区 diff 与改坏前逐字一致。

**A. 拆掉基座大奖的替代集合（数据层）**——把 reward_pedestals 两条
feature 的 `"MF_ALTERNATIVE"` 改名移除 → T3 红（V-0 点名的双份发放）：

```
AssertionError: seed 局的一台 pedestal 发出 2 件基座大奖（ench=1, life=1）
——双份发放陷阱（V-0 点名）或替代集合失效: expected 2 to be 1
 ❯ src/test/v_2a_vestibule_return.test.ts:143
 Test Files  1 failed (1)   Tests  1 failed | 2 skipped (3)
```

**B. 拆掉钥匙外包（数据层）**——把 vestibule_locked 的
`"MF_OUTSOURCE_ITEM_TO_MACHINE"` 改名移除 → T2 b) 红：

```
AssertionError: 没有任何 vestibule_locked 外包钥匙给守卫机器
——MF_OUTSOURCE 未被生产数据行使: expected 0 to be greater than or equal to 1
 ❯ src/test/v_2a_vestibule_return.test.ts:114
 Test Files  1 failed (1)   Tests  1 failed | 2 skipped (3)
```

**C. 拆掉 AT_ORIGIN 锚点（引擎层）**——把
`if (fFlags.has('MF_BUILD_AT_ORIGIN')) return origin;` 的条件短路 → 前厅
feature 落随机内部格 → T2 c) 红（此改坏同时触发性能悬崖：递归近乎全败、
用例 26 分钟跑完——锚点失守的危害本身就是这条断言的另一半依据）：

```
AssertionError: 前厅门位 (40,2) ≠ 父机器门位 (47,7)——AT_ORIGIN 锚点失守:
expected false to be true
 ❯ src/test/v_2a_vestibule_return.test.ts:124
 Test Files  1 failed (1)   Tests  1 failed | 2 skipped (3)
```

---

## 6. 哨兵处置

- 新测试全部经 `createHeadlessGame(seed)` 完全隔离合成层（形态②）+
  性质断言（形态③）；**无 RNG 流绝对位置锚**（任务书 §6.1）。
- `generation_baseline` ✅ 任务书授权重捕获：seeds 不变（424242/777/
  20260913/31337），note 追加 V-2a 段，`capturedAt` 更新为
  "V-2a（前厅与守卫机器回归后）"；重捕获后复跑绿。
- **重捕获后的引擎性能缓存迭代全部经基线回归验证**： chokeMap 缓存
  （尾失效）→ 候选缓存（首版与 analysis 同点失效，seed31337/D2 起翻红）
  → 失效点解耦（候选步骤 1 / analysis 尾部）→ 基线复跑逐位回绿。性能
  优化全程保持"生成结果零变化"，最终形态以基线绿为准绳。
- 生成期流移动的既定成本（V-1c §9 第 6 条预告的 c_5 成本 pin 与 b_4a
  D1 life 计量）**本轮实测均未翻红**——本轮的掷骰增量落在机器 feature
  层（替代集合骰、前厅 instanceCount 骰、递归掷骰），未触及那两处计量位。

---

## 7. 需要追加授权的测试

**本轮行为断言层面无清单外撞红**。四段 grep 的清单外命中：
`p1_20_item_placement`（物品落格可通行行为断言）、`c_6_autogenerators`
（仅注释引用 blueprints.json）、`b_4b_item_placement`（锁/钥不变量 T11）
——三者在数据/引擎落地后单跑全绿，未做任何修改。授权清单内的测试按
留痕反转惯例改了 v_1a T2 / v_1b P1 / v_1c Q1b 三处；p1_33 a) 与
blueprint_center b) 在清单内按 CE 前厅语义做了**类别豁免**（vestibule
机器 center=door=origin 是 CE 锚点语义，reward/key_guard 合同不动）。

**需要追加授权 1 项（性能受害者申报）**：
- `armor_model_effect.test.ts` 的聚合用例（文件内显式 timeout=360s）在本轮
  内容回归后实测需 **823-923s** 才能跑完（100 次建局 × 400 回合：生成期
  RNG 消耗从 V-1c 的每局约 30 万涨到 70-80 万 substantive 抽取、怪物指令
  +525%、每层递归子机器，全部真实成本；seed100/31337 类 D2 空转层另加
  20-25s）。**不是行为断言翻红**——用例从未在 360s 内跑到断言（同文件
  的"板甲+3"小用例绿，模型行为无异常迹象）。该文件**不在本轮授权清单**，
  按边界规矩未动。请验收方裁决：① 授权拉长该用例 timeout（建议 1500s）
  或 ② 授权缩减其样本量（20 seed → 10）并注明代价。裁决前，该用例在
  全量门禁中将持续被判超时红。

---

## 8. 门禁结果

`npx vitest run`（不带文件参数、不加 `--fileParallelism=false`）最终形态：

```
 Test Files  7 failed | 86 passed (93)
      Tests  7 failed | 1175 passed | 8 skipped | 5 todo (1195)
 Start at  14:44:39
 Duration  1653.43s (transform 7.60s, setup 0ms, import 78.32s, tests 13098.94s, environment 39ms)
```

**7 个失败全部是超时、无一断言红**，逐个处置如下：

| 失败用例 | 并行门禁 | 单跑复核 | 定性 |
|---|---|---|---|
| b_4b T7 | timed out 300s | **绿**（b_4b 全文件 15/15，265s） | 纯并行负载 |
| c_4a_0 全量生成测量 | timed out 300s | **绿**（文件 20/20，145s） | 纯并行负载 |
| c_4a F cost 分歧表 | timed out 300s | **绿**（两文件 44/44） | 纯并行负载 |
| invented_content_pool 520 层 | timed out 300s | **绿**（7/7，289s） | 纯并行负载 |
| monster_stats_effect 聚合 | timed out 300s | **绿**（2/2，292s） | 纯并行负载 |
| blueprint_center b) | timed out 180s | **绿**（4/4，110s，违例 0） | 修复后负载超时 |
| armor_model_effect 聚合 | timed out 360s | **923s 仍未到断言** | §7 申报项（清单外，未动） |

上一次全量（缓存失效点修复前）的 8 失败中另有 p1_33 a)（前厅机器
center==door 撞合同）与 blueprint_center b)（99 条同类违例）两个真断言红，
均已按 CE 前厅语义改写合同（§7），本轮全量不再出现。

**C-8 连通性广度断言（任务书 §4 硬要求）**：
`c_8_connectivity.test.ts` 全绿（7/7，239s），其中
`T2 广度断言：30 seed × D1-D25 坏层=0` ✓——
`✓ T2 广度断言（区间来自修复前后实测）：30 seed × D1-D25 坏层=0  208453ms`
出现坏层即真回归的闸门在本轮数据落地后保持零。

`npm run build` ✓（vue-tsc -b，2.65s，零错误；仅既有 chunk 体积警告）：

```
dist/assets/WebGLRenderer-CQ9fGj95.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-d-ZVfzvW.js               887.12 kB │ gzip: 267.93 kB
✓ built in 2.65s
```

---

## 9. 遗留与登记

**给 V-2b（全表扩充）**：
1. 规模差：CE 蓝图约 69 条 vs web 20 条。本轮实证的三个缺口：
   a) CE 16 条 BP_ADOPT_ITEM 蓝图全带 `MF_ADOPT_ITEM` 消费 feature，web
   7 条 key_guard 全无——「守卫机器持有钥匙」未真实成立（KEY 指令被
   领养机制读走后丢弃，钥匙仍由锁驱动近似）；b) CE 前厅 9 条 vs web 4 条
   （flammable barricade 需 WOODEN_BARRICADE+燃烧物二选一、statue 需
   SCROLL_SHATTERING、pit traps 需 TRAP_DOOR_HIDDEN×60 等载体）；c) CE
   pedestal 系两个蓝图（:206-214 永久物 / :215-221 消耗品）web 合一为
   reward_pedestals，扩表时宜拆。
2. **thematic 内容**（area_swamp 等）回归路径 = autoGeneratorCatalog 的
   MT_* 条目接线（V-1c §9 第 3 条原样有效；本轮 buildMachines 返回值里
   thematic 仍绝迹，v_1c Q1b 的反转断言继续钉住）。
3. `MT_AMULET_AREA`（D26 护符房）仍无载体蓝图（V-1c §9 第 2 条原样有效）。
4. **性能登记（更新）**：`findGateRoom` 的 chokeMap 分析与门位候选缓存已做
   （失效点解耦：analysis 尾部失效 = CE 每层预计算语义；候选步骤 1 失效 =
   machineNumber 依赖），`effectiveBpFlags` 已缓存。残余成本是 D2 型
   「守卫候选空转」：seed100/D2 上 key_rat_trap 的 chokepoint 候选为空 →
   领养 10 次确定性失败 × 前厅 failsafe 重试 × 顶层 failsafe = 40 万次
   noCandidates 调用（**21-25s/层**，RNG 消耗数百万次；CE 同行为 0.4s，
   纯语言差距）。这是 CE 重试语义的固有形态；V-2b 扩表守卫池（16 条领养
   蓝图）会自然缓解。若届时仍慢，根治手段是递归块前的「无合格蓝图快速
   失败」——**它改变 RNG 消耗**，需当轮重捕获授权，且触碰"不得改 V-1c
   递归逻辑"红线，本轮未做。
5. **armor_model_effect 的性能账单（关联 §7 申报）**：每局生成期 substantive
   RNG 抽取从 V-1c 的约 30 万涨到 70-80 万（blueprint_center 仪表实测，
   seed31337/20260916 因空转层达 560-600 万）。重模拟型测试
   （armor_model_effect / monster_stats_effect）的时长因此翻 3-8 倍，
   前者已越过其文件内 360s 显式 timeout。后续任何"内容回归"轮次都应
   预期同样的账单。
5. **personalSpace 语义偏差（既有，非本轮引入）**：web `markPersonalSpace`
   清 (2r+1)²-1 格、CE personalSpace=2 清 3×3——差一位。本轮新 feature 按
   CE 原值给 2/1，落位密度与 CE 有微小差异；统一修法会移动全部机器布局，
   归 V-2b 评估（动则重捕获）。
6. **钥匙轮交接**（V-1c §9 第 7 条原样有效 + 本轮增量）：
   `MF_KEY_DISPOSABLE` / `MF_IMPREGNABLE` 字符串已按 CE 原值带进
   vestibule_locked 的 KEY feature 数据（引擎零消费）；keyLoc 的 kind 第三维
   仍缺；CE 的 addLocationToKey/addMachineNumberToKey 合流点已就位
   （递归领养链路在生产数据跑通）。
7. v_1b T5（RNG 增量哨兵）测的是合成蓝图行为、本轮未翻；其头注「生产
   数据零掷骰」的表述已由 P1 反转节覆盖，V-2b 动 alternative 数据时记得
   连读两处。
