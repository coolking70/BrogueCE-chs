# V-2b-9b 环境效果链轮（E 族）：涨水 / 塌方 / 岩浆退缩 / 显桥

> **本轮在 Codex Cloud 运行。门禁口径见 §6——V-2b-8 与 V-2b-9a 连着两轮栽在这上面。**

## 0. 又一次拆分，以及为什么

原 V-2b-9 是「环境效果链 + 杂项」，勘察报告（`v-2b-0.report.md` §"V-2b-9"）
列的解锁面是 **15 条蓝图 + 五族机制**（E 环境效果链 / L 闪电 promote /
暗 黑暗生产者 / R dungeonProfile / BP_TREAT_AS_BLOCKING 连通性复核）。

它已经被拆过一次（9a 只落载体）。**这里再拆一次**，理由是勘察报告自己给的切开点：

> 「R/dungeonProfile 理论上可独立（只服务 13/14 两条）…… 若验收方愿意，
> R 可切出成第 10 轮，不强求。」

于是：

| 轮次 | 范围 | 蓝图 |
|---|---|---|
| ~~9a~~ ✅ | 载体（12 地形 + 8 DF + 闭包） | 无 |
| **9b（本轮）** | **E 族 + BP_TREAT_AS_BLOCKING 激活** | **31 / 34 / 36 / 37 / 38 / 39 / 44 / 65 / 66（9 条）** |
| 9c | L（闪电 promote）+ 暗（黑暗生产者）+ 泥潭 | 32 / 51 / 52 / 54（4 条） |
| 9d | R（dungeonProfile 两档 + BP_MAXIMIZE/REDESIGN_INTERIOR） | 13 / 14（2 条） |

**E 族之所以不能再拆**：勘察报告的耦合理由成立——涨水 / 塌方 / 岩浆退缩 /
显桥共享同一套「触发 → 整片地形改写」管线（`promoteTile` 的 bulk 分支），
拆开每件都要重搭同一副脚手架。

**载体已就位**：9a 落了 `FLOOR_FLOODABLE`、`CHASM_WITH_HIDDEN_BRIDGE`、
`LAVA_RETRACTABLE`、`MUD_*`、`MARBLE_FLOOR`、`FLOOD_TRAP` 等 12 个地形
（`Grid.ts` 的 `TerrainType` 尾部，注释写着「仅登记 9b 蓝图所需载体」）
与 `DF_SPREADABLE_WATER_POOL` / `DF_LAVA_RETRACTABLE` /
`DF_ADD_MACHINE_COLLAPSE_EDGE_DORMANT` / `DF_CATWALK_BRIDGE` /
`DF_CHASM_HOLE` / `DF_LAKE_CELL` 等 DF。**本轮是消费它们的一轮。**

## 1. 九条蓝图（CE `GlobalsBrogue.c` 逐字）

| # | CE 行 | 名称 | 本轮要解锁的机制 |
|---|---|---|---|
| 31 | L377 | Flood room（取钥匙 → 房间涨浅水） | DF_FLOOD / SPREADABLE_WATER_POOL |
| 34 | L394 | Collapsing floor area（取钥匙 → 地板塌陷） | MACHINE_COLLAPSE_EDGE 回路 |
| 36 | L404 | Levitation challenge（取钥匙/拉杆 → 现桥） | CHASM_WITH_HIDDEN_BRIDGE |
| 37 | L413 | Web climbing（同上，蜘蛛版） | 同 36 |
| 38 | L420 | Lava moat room（取钥匙/拉杆 → 岩浆退缩） | LAVA_RETRACTABLE → 黑曜石 |
| 39 | L429 | Lava moat area | 同 38 |
| 44 | L464 | Guardian water puzzle（把守卫引进水里掉钥匙） | FLOOD_TRAP + DF_FLOOD |
| 65 | L589 | Chasm catwalk（深渊窄桥，可能有炮塔） | **BP_TREAT_AS_BLOCKING 连通性复核** |
| 66 | L595 | Lake walk（浅水窄桥） | 同 65 |

**逐字**指 depths / roomSize / freq / featureCt / dungeonProfileType / flags
与每条 feature 的全部 12 列。抄完给行号。

## 2. BP_TREAT_AS_BLOCKING / BP_REQUIRE_BLOCKING——**这是一笔留痕账，本轮是它的激活轮**

`BlueprintEngine.ts` 的 `fillVestibuleInterior` 头注（约 :1765-1770）与函数尾
（约 :1812-1813）各有一处**明确登记的未接线占位**，原文：

> 「CE :715-723 的 BP_TREAT_AS_BLOCKING / BP_REQUIRE_BLOCKING 连通性复核
> **本轮刻意未接线**：`levelIsDisconnectedWithBlockingMap` 属 DF 子系统，
> 生产引用受 c_4b F1 留痕扫描器白名单钉死（本轮授权清单不含该测试），
> 且当前数据零载体、检查结构性不可达——**接线留给激活轮，届时按该测试
> 标题预告的流程扩白名单**。」

**65/66 就是那个"载体"**——它们带 `BP_TREAT_AS_BLOCKING`，所以本轮必须接线。

**做法**（按占位自己预告的流程，不要另起炉灶）：
1. 读 `c_4b_dungeon_feature.test.ts` 的 **F1 留痕扫描器**，看它的标题与注释
   怎样预告"激活轮扩白名单"；**按它说的方式扩**，别改扫描器的判据。
2. 接 CE `Architect.c:715-723` 的复核逻辑。
3. **把两处占位注释按「留痕反转」改写**——前提（零载体、结构性不可达）现在为假了，
   要**断言新事实**（已接线、载体是 65/66），不是删掉这段注释。

## 3. `promoteTile` 的 bulk 分支——本轮的引擎主场

E 族四种效果都是「触发 → 整片地形改写」。V-2b-3 已把 `TM_IS_WIRED` 分支做进
`promoteTile`。本轮要把**成片改写**这一层补上。

**回 CE 定位**：`promoteTile` 在 `Architect.c`，`DFF_*` 的
`DFF_SUBSEQ_EVERYWHERE` / `spread` / `startProbability`-`probabilityDecrement`
扩散语义在 `spawnDungeonFeature`（`Architect.c`）。自行定位行号并在报告里给出。

⚠️ **不要为每种效果各写一套**。若你发现它们确实走的是同一个 `spawnDungeonFeature`，
那就只接那一个入口——报告里说清楚"四种效果共用同一条路径"的证据。
若你发现**它们其实不共用**（勘察报告的耦合判断可能是错的），**驳回并说明**。

## 4. 生成流会动——基线重捕获是最后一步

九条蓝图入池 + BP blocking 复核改变前厅内部 ⇒ 生成流必动。
**基线重捕获放在所有改动之后**，`npm run test:drift` 应在重捕获后绿。

成因至少三股：①九条蓝图入池；②BP_TREAT_AS_BLOCKING 复核（可能改变前厅内部格集）；
③bulk promote 若在生成期就触发。沿用受控单变量分离。**分不开就说分不开。**

## 5. 可解性证明（本轮最容易出死局的地方）

前三轮（V-2b-6 / V-2b-7 / V-2b-9a 的前身）各抓出真死局，**都在钥匙链上**。
本轮九条里有 **6 条是钥匙机器**（31/34/36/37/38/39/44 全是"key on an altar"）。

**逐条回答：玩家怎么拿到钥匙、拿到之后怎么活着出来。** 特别是：
- 34 塌陷：地板塌了，玩家在不在塌陷区里？CE 靠什么保证不把人埋了？
- 38/39 岩浆：CE 说 "levitation/fire immunity/lever elsewhere on level"——
  **web 有没有那个 lever / 有没有在别处放悬浮药水的机制？** 没有就是死局，
  按同类数据不变量**退池留形**并登记，不要硬塞。
- 65/66：窄桥 + 炮塔，桥断了还能不能过？

**发现死局就退池留形 + 登记，不要为了凑数落进池子。**

## 6. 门禁跑法（**连续两轮栽在这里，本轮口径最严**）

- V-2b-8：任务书写成「只跑你改动过的文件」→ 验收方本地 15 条失败，9 个文件从未跑过。
- V-2b-9a：口径已改对，但报告称「全部跑过、全部通过」，而
  `c_4a_terrain_catalog` / `c_4a_0_layer_model` **根本没被改动**、其写死计数必然红
  ⇒ 成因是**时序**：早期跑过一次就绿，加完载体后没复跑。

**本轮两条硬要求：**

1. **跑 §7 授权清单里的全部文件**（不只是你改动过的）。装不下就在报告里列出没跑到的。
2. **最终复跑**：在**所有编辑完成之后**，重新跑一遍授权清单，报告里给出
   时间点、逐文件结果，并**明确声明「这是最终状态下的运行结果，不是中途快照」**。
   中途跑过多少次都不算数。**这条不满足，本轮判为未完成。**

外加 `npm run build` 与 `npm run test:drift`。
仍然**不要**跑不带文件参数的全量 `npx vitest run`（本地并行 15 分钟）。

## 7. 授权改动清单

**引擎与数据**：`src/engine/Generator/BlueprintEngine.ts`、
`src/engine/Generator/Architect.ts`、`src/engine/Map/Grid.ts`、
`src/engine/Map/TerrainCatalog.ts`、`src/engine/Map/DungeonFeatureCatalog.ts`、
`src/engine/Core/Game.ts`、`src/data/blueprints.json`

**固件**：`src/test/fixtures/generation_baseline.json`（**仅最后一步重捕获**）

**测试**：新建 `src/test/v_2b_9b_environment.test.ts`、
`c_4a_terrain_catalog`、`c_4a_0_layer_model`、`c_4b_dungeon_feature`（§2 的 F1 扫描器）、
`c_7_lighting`、`r_1_appearance`、`g_2_gas_df_wiring`、`invented_content_pool`、
`p1_30_i18n_gate`、`p1_42_secret_door_search`、
`blueprint_center`、`p1_33_machine_chokepoint`、`p1_37_machine_flag_i18n`、
`p1_20_item_placement`、`p1_31_35_placement_snapshot`、`b_4b_item_placement`、
`v_1a_blueprint_items`、`v_1b_alternative`、`v_1c_machine_structure`、
`v_2a_vestibule_return`、`v_2b_2a_placement_flags`、`v_2b_2b_blueprints`、
`v_2b_3_wired`、`v_2b_4_altars`、`v_2b_5_dormant`、`v_2b_6_keys`、
`v_2b_7_features`、`v_2b_9a_carriers`、
`c_5_fall_subsystem`（34 塌陷必撞）、`c_8_connectivity`（§2 必撞）、`p1_26_invariants`

清单外改动必须申报。`BrogueCE-master/` 只读。**守卫顺延不放宽**；
**行为断言**撞断 > 5 个停下来说明（穷举表连带不计入）。

## 8. 本轮不做

- 9c 的 L / 暗 / 泥潭（32 / 51 / 52 / 54）
- 9d 的 R / dungeonProfile（13 / 14）
- `DP_GOBLIN_WARREN` / `DP_SENTINEL_SANCTUARY`（属 9d）

## 9. 授权反驳 + 对抗性要求

事实判断若与 CE 不符，**驳回并纠正**并给行号。你前几轮抓出过验收方多处错误
（CE 护符房不是抽签建成、`ALTAR_INERT` 不该独立、`featureDF` 列其实已存在），
继续这样做。**§0 的四轮拆分表与 §1 的机制归属列都是验收方按符号名推的，很可能有错。**

**对抗性要求**：
① §3 的"四种效果共用同一条路径"是验收方转引勘察报告的判断，**回 CE 验证它**；
② 每条新断言回答「这条用例在什么实现缺陷下会翻红？」——
   尤其 §2 的 BP_TREAT_AS_BLOCKING：它必须能抓住**接线了但判据抄反**
   （把"连通"当"断连"），而不只是"函数被调用了"。

## 10. 报告

写到 `ai_docs/reports/v-2b-9b.report.md`，含：

1. 九条蓝图逐条的 CE 行号与落地情况（含**退池留形**的条目与理由）
2. **§2 BP_TREAT_AS_BLOCKING 的激活**：F1 白名单怎么扩的、两处占位怎么反转的
3. **§3 bulk promote 的 CE 依据**与 ①的验证结论
4. **§5 可解性证明**（6 条钥匙机器逐条）
5. §4 基线重捕获与三股成因分离
6. 撞断的守卫清单与处置
7. §9 两条对抗性要求的回答
8. **§6 的最终复跑声明**（时间点 + 逐文件结果 + "这是最终状态"）
9. 清单外改动申报
