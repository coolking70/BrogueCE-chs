# V-2b-9b 补完轮

> **在分支 `round/v-2b-9b` 上执行**。产物基本完好，不要推倒重来。

## 0. 先说清楚：上一轮做得比任务书预期的好，失败不是你的判断错

已完成且经验收方复核成立：

| 已完成 | 复核结果 |
|---|---|
| 九条蓝图逐字入表 | ✅ 抽查 31（`{80,180}` freq 10）、65/66（`{40,80}` freq 0 + `BP_NO_INTERIOR_FLAG`）与 CE 一致 |
| 12 条 DF 的 `tile` 从 `null` 填成真 TerrainType | ✅ 这是本轮的实质：解开 `DeferredPromotion`（`tile-missing-in-web`） |
| 9 个活动态地形 | ✅ |
| §3「四种效果共用既有管线、不需要写新循环」 | ✅ **验收方任务书写错了** |
| 38/39 不退池 | ✅ `MF_BUILD_ANYWHERE_ON_LEVEL` 确由 V-2b-2a 落位 |
| §8 如实申报最终复跑被云端掐断 | ✅ **这一条做得对，继续保持** |

**两条要专门讲：**

**① 验收方 §3 写错了。** 任务书把 bulk promote 说成"本轮引擎主场，要接 `promoteTile` 的 bulk 分支"。
你回查后说不需要新循环——`spawnDungeonFeature` / spread 管线**早就存在**，
这些 DF 只是 `tile: null` 卡在延迟态。验收方复核：`Promotion.ts` 确有完整
`DeferredPromotion` 机制，`spawnDungeonFeature` 在 `Map/DungeonFeature.ts`。**你是对的。**

**② §8 的诚实没有白费。** 你申报了最终批次在云端约 20 秒被环境终止、30 个授权文件
未跑完、"这不冒充通过"。验收方本地全量门禁跑出 **90 条失败 / 44 文件**——
**这些你根本没机会看到**，不算谎报。但也因此，报告 §6「行为断言撞断未超过五个」
是没有依据的，本轮要重新回答。

## 1. 根因 A：一个缺失地形污染了大半个门禁（先修这个）

90 条里最扎眼的是同一条**抛错**出现 10 次：

```
Error: DF#170（MACHINE_CHASM_EDGE）引用了 web 尚不存在的 tileType，登记未实现（C-4b 目录）
```

这是 `catalogFeature()` 在运行时 **throw**，不是断言失败。它会顺着调用栈污染
**任何会生成关卡或跑晋升的测试**——这就是为什么 `p4_7_player_weapon_geometry`、
`p2_2_real_speed`、`b_1_weapon_specials`、`ui_2_protection`、`monster_stats_effect`
这些跟本轮毫无关系的文件也在红。

**成因**：`DungeonFeatureCatalog.ts:1371` 的
`[DF.DF_ADD_DORMANT_CHASM_HALO]: df(170, 843, 'MACHINE_CHASM_EDGE', null, …)`
仍是 `tile: null`。而 CE `Globals.c:556` 的 `MACHINE_CHASM_EDGE` 的 promoteType 是
**`DF_BRIDGE_ACTIVATE_ANNOUNCE`**——正是你本轮填了 tile 的那条。
**闭包只闭了一半**：你把下游填活了，上游的门却还锁着，于是一走到就抛。

**处置**：新建 `MACHINE_CHASM_EDGE` 地形（CE `Globals.c:556`，DF 目录行 `:843`），
逐字段照抄。**然后自己把闭包走一遍**——本轮填活的 12 条 DF 各自的上下游里，
还有没有第二个、第三个这种"引用了不存在 tile"的门？**一次找齐，别再留半扇。**

## 2. 根因 B / C：两个同类的缺符号

**B — `DF_PUDDLE` 未抄录。** 新地形 `FLOOD_WATER_SHALLOW`（`TerrainCatalog.ts:1155`）
的 promoteType 列写了 `'DF_PUDDLE'`，但它不是 DF 枚举成员：

```
AssertionError: TerrainCatalog 引用的 DF_PUDDLE 必须是 DF 枚举成员: expected undefined to be defined
```

CE 依据：`Rogue.h:1523` 有 `DF_PUDDLE`；`Globals.c:446` 的 `FLOOD_WATER_SHALLOW`
promoteType 列确实是它、promoteChance `-100`。抄录它（连同它的闭包）。

**C — `CE_CHOKE_COUNT_CAP` 要上调。** 断言消息自己给了公式：

```
出现了 roomSize[1] > CE_CHOKE_COUNT_CAP − 1 的蓝图：必须同步上调
LoopMap.CE_CHOKE_COUNT_CAP（= roomSize[1] 最大值 + 1）
```

肇事者是 **31 号，`roomSize` `{80, 180}`**——验收方已核对 CE `GlobalsBrogue.c:378`，
**这个值是对的，不许改蓝图**。要改的是 `LoopMap.ts:408` 的 `CE_CHOKE_COUNT_CAP`
（现 176）。按公式上调，并在注释里写明是 31 号带来的。

## 3. 根因 D：留痕反转欠账

本轮把一批 DF 的 tile 从 `null` 填活了，于是那些**钉着"此条应为 null"**的守卫翻红：

```
AssertionError: DF#112 应为 null tile: expected 122 to be null
```

这类守卫的前提已经为假。**按留痕反转改写：断言新事实（DF#112 现有 tile
`FLOOD_WATER_SHALLOW`，因 V-2b-9b 落地），不要删掉断言。**
`DF_MISSING_TILES` 的各处长度镜像同样同步到实测值，**不许放宽为下限或 contains**。

顺带核一条：

```
AssertionError: B-3 后负值载体必须是且仅是 CE 洞族两条 + 力场族两条，且取 CE 原值:
  expected [ 'FLOOD_WATER_DEEP:-200', …(6) ] …
```

`FLOOD_WATER_DEEP` 带了负 promoteChance 进入这份清单。**回 CE 核 `Globals.c:447`
的 promoteChance 原值**，按事实决定它该不该进、以及这条守卫的"且仅是"口径要不要
按留痕反转扩写。

## 4. 根因 E：BP_TREAT_AS_BLOCKING **接到了错误的调用点**（本轮唯一的实现硬伤）

你把复核接进了 `fillVestibuleInterior`，对着 CE `Architect.c:723-728` 抄——
**那段代码本身抄得没问题**。问题是 CE 里这个检查有**两个**调用点：

| CE 位置 | 所在函数 | 服务对象 | 失败语义 |
|---|---|---|---|
| `:723-728` | `fillInteriorForVestibuleMachine`（`:674` 起） | **前厅机器** | `success = false` |
| **`:1196-1201`** | **`buildAMachine` 的区域机器 interior 循环** | **区域机器** | **`tryAgain = true` → 换位重试**（`do{…}while(chooseBP && tryAgain && --locationFailsafe)`） |

而你声称的四个载体，CE 旗标是：

```
65/66  (BP_REQUIRE_BLOCKING | BP_OPEN_INTERIOR | BP_NO_INTERIOR_FLAG)
34     (BP_ADOPT_ITEM | BP_TREAT_AS_BLOCKING)
39     (BP_ADOPT_ITEM | BP_PURGE_INTERIOR | BP_OPEN_INTERIOR | BP_TREAT_AS_BLOCKING)
```

**没有一条带 `BP_VESTIBULE`**——它们全是区域机器，永远不进
`fillVestibuleInterior`。**所以你新接的这段代码，对它自己声称的载体一次都不会执行。**

连带后果：报告 §2 那段留痕反转写的是**假事实**（"65/66 是 REQUIRE 的首批活载体"）。
留痕反转的全部意义是断言新事实，断言一个假的比不反转更坏。

**处置**：
1. 把复核补到 **`:1196-1201` 对应的区域机器路径**上，**并照 CE 的失败语义**——
   是 `tryAgain` 换位重试（受 `locationFailsafe` 约束），不是硬 `return null`。
2. 前厅路径那段**保留**（CE 确实两处都有），但把留痕反转的措辞改成事实：
   前厅路径当前**无载体**，活载体在区域机器路径上。
3. CE 两处都用 **`else if`**（TREAT 与 REQUIRE 互斥分支），你写成了两个独立 `if`。
   当前九条里无蓝图同时带两旗标，所以行为等价——**但按 CE 口径改回 `else if`**，
   并在报告里说明这是留形不是改语义。
4. 对抗用例要覆盖**区域机器路径**。原来那个只测前厅，测不到真载体。

## 5. 根因 F：`v_2b_6_keys` F1 是真回归，**优先级最高**

```
AssertionError: seed42 D15 锁 (64,24) 的钥匙 (68,3) 不可达: expected false to be true
```

这是可解性证明。**前三轮各靠它抓出一个真死局，都在领养链上。**

先修 §1（`MACHINE_CHASM_EDGE` 抛错会污染可达性计算），**然后复跑 F1**。
若仍红，那是真死局：查清是哪条新蓝图造成的，**按同类数据不变量退池留形并登记**，
不要改断言、不要换 seed。

## 6. 其余：机器结构族

`v_1c`（Q1b thematic 反转）、`blueprint_center`、`p1_33`、`v_2b_2a`、`v_2b_4`、
`v_2b_5`、`v_2b_7`、`c_8_connectivity`、`c_6_autogenerators` 等。
**先修 §1-§4 再看**——多半是抛错连带或生成流变动的正常顺延。
修完仍红的逐条给结论。

⚠️ **`v_1c` Q1b 要单独盯**：它钉的是 V-2b-8 刚翻转的"thematic 不再绝迹"。
若本轮把 thematic 机器又挤没了，那是回归，不是顺延。

## 7. 基线

§1-§4 的修复会再动生成流。**基线重捕获仍是最后一步。**
上一轮 §5 的三股成因分离写得不错，本轮沿用；**新增第④股：`MACHINE_CHASM_EDGE`
抛错消失后，原先被中断的生成路径会跑完**——这一股可能不小，尽量分离。

## 8. 门禁跑法（上一轮被云端掐断，本轮改策略）

上一轮最终批次以 31 个文件参数一次启动，约 20 秒被环境终止，**只有 1 个文件拿到结果**。
显然一次性启动整份清单在云端窗口里跑不完。

**本轮改为分批，每批跑完立刻记录：**

1. 先跑**根因批**（最小、最快，验证 §1-§4 修对了）：
   `c_4b_dungeon_feature`、`c_4a_terrain_catalog`、`c_4a_0_layer_model`、
   `c_7_lighting`、`r_1_appearance`、`g_2_gas_df_wiring`、`v_2b_9b_environment`
2. 再跑**机器批**：`v_2b_6_keys`（§5，优先）、`v_1c_machine_structure`、
   `blueprint_center`、`p1_33_machine_chokepoint`、`v_2b_2a`、`v_2b_4`、`v_2b_5`、`v_2b_7`
3. 再跑 `npm run build` 与 `npm run test:drift`
4. 剩余授权文件能跑多少跑多少

**每批的结果在报告里单独成行，写明该批是在第几轮编辑之后跑的。**
若又被环境掐断，**照上一轮那样如实说**——那是对的做法。
§8 的"最终状态"声明改为**逐批声明**：哪几批是最终状态下的、哪几批不是。

## 9. 授权改动清单

沿用 `v-2b-9b.prompt.md` §7，**再加**：
`src/engine/Map/LoopMap.ts`（§2 C 的 `CE_CHOKE_COUNT_CAP`）、
`src/engine/Map/DungeonFeature.ts`（若 §4 的区域机器路径需要）、
以及 §6 里实际撞红的测试文件。

`src/test/fixtures/generation_baseline.json` **仅最后一步重捕获**。
清单外改动必须申报。`BrogueCE-master/` 只读。**守卫顺延不放宽**。

## 10. 报告

写到 `ai_docs/reports/v-2b-9b-finish.report.md`，含：

1. **§1 闭包自查的结果**：除 `MACHINE_CHASM_EDGE` 外还找到几个缺 tile 的门
2. §2 B/C 两条的 CE 依据与落地
3. §3 留痕反转清单（哪些"应为 null"的守卫改成了断言什么新事实）+ `FLOOD_WATER_DEEP` 的 CE 核对
4. **§4 区域机器路径的接线**（本轮最重要的一节）：CE `:1196-1201` 的落地位置、
   `tryAgain` 重试语义怎么表达、前厅那段留痕反转怎么改成事实、对抗用例怎么覆盖区域路径
5. **§5 F1 的结果**：修完 §1 后是否复绿；若仍红，死局归因与退池登记
6. §6 逐条结论（特别是 `v_1c` Q1b）
7. §7 基线重捕获与四股成因分离
8. **§8 的逐批声明**
9. 授权反驳（本任务书的失败分类是验收方按错误消息首行做的，读代码发现分错了就指出来）
