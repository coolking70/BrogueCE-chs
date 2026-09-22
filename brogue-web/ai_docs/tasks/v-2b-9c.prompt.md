# V-2b-9c 闪电 / 黑暗 / 泥潭轮

> **本轮在本地执行（`codex exec --worktree`），不是云端。**
> 你有完整的 10 核机器和可用的 `npx vitest`——**能自己验证，请务必验证**。

## 0. 三条从 V-2b-9b 换来的教训，先读

上一轮（9b，环境效果链）走了三次派发 + 验收方两次亲自动手才收口。
下面三条是那一轮的直接产物，本轮按它们做：

### 0.1 填活一条 DF 的 tile，就要把整条闭包一次走完

9b 把 12 条 DF 的 `tile` 从 `null` 填活，**漏了 `MACHINE_CHASM_EDGE`**。
后果不是少一个地形，而是 `catalogFeature()` 在运行时 **throw**，
污染了**任何会生成关卡或跑晋升的测试**——验收方本地门禁一次跑出 **90 条失败 / 44 文件**，
其中 `p4_7_player_weapon_geometry`、`b_1_weapon_specials`、`ui_2_protection`、
`monster_stats_effect` 这些跟那轮毫无关系的文件全在红。

**成因是闭包只闭了一半**：`MACHINE_CHASM_EDGE` 的 promoteType 正是那轮填活的
`DF_BRIDGE_ACTIVATE_ANNOUNCE`，下游通了、上游的门还锁着，一走到就抛。

⇒ **本轮每填活一条 DF 的 tile，就沿 `promoteType` / `fireType` /
`propagationTerrain` / `subsequentDF` 四条边把上下游走一遍，一次找齐所有
"引用了 web 尚不存在的 tile"的门。** 报告里给出你走闭包的方法和找到了几个。

### 0.2 退池留形 = **加引擎过滤**，不是改数据

9b 要退 `vestibule_secret_lever`（= CE 18 号）时，执行方把 `blueprints.json` 的
`frequency` 从 8 改成 0，撞上 `v_2b_3_wired` E4 钉死的 CE 逐字值
（`GlobalsBrogue.c:305`），然后**又写了个守卫断言「frequency 必须为 0」**
去保护这个错误选择——两条守卫正面冲突。

既定口径（47 号先例，见 `BlueprintEngine.ts` 的 `canReceiveAdoptedItem` 说明）：

> 按 D2 口径退池留形：**数据照带旗标**，只是它不再被抽为领养机器

⇒ **数据永远保持 CE 逐字；退池在 `blueprintQualifies` 里做**
（那里已有 9b 留下的 `vestibule_secret_lever` 先例可照抄）。

**判别法：改数据能让守卫变绿，往往说明你在改被守卫的那个事实本身。**

### 0.3 覆盖门没有观测对象时，**换样本**而不是改期望

9b 里 `c_6_autogenerators` AD-8 在单 seed 单层测"autogen 机器建成数 > 0"，
生成流一动 D5 不再命中，执行方就把它改成 `toEqual([])` / `toBe(0)`，
理由写"真实目录 MT_* 仍全部登记为 no-machine"。

**该理由被验收方实测证伪**：13 个 `machine: MT.*` 条目里 7 个带真实载体，
探针 3 seed × D1-26 实测建成 **28 台**，D5 只是恰好没命中。

⇒ 覆盖门（"必须 ≥1"这类）翻红时，**先问"是不是样本里恰好没有观测对象"**，
是就换更大的样本，**不要把期望改成零**。
⚠️ 换样本后也**不要钉精确台数**——9b 实测同一探针独立运行 9 台、放进文件内跑
7 台，该值随同文件前序用例的模块态而动。覆盖门守的是"建得出来"。

## 1. 本轮范围：三族机制 + 四条蓝图

| # | CE 行 | 名称 | 机制族 |
|---|---|---|---|
| 32 | `:383` | Fire trap room（钥匙在祭坛，水塘 + 满地火陷阱） | 陷阱（多为既有） |
| 51 | `:509` | Mud pit（取钥匙 → 泥里冒沼泽怪） | **泥潭 + 休眠唤醒** |
| 52 | `:514` | Electric crystals（电击水晶球放钥匙） | **L：闪电 promote** |
| 54 | `:531` | Haunted house（取钥匙 → 房间变暗 + 幽灵） | **暗：黑暗生产者** |

CE 旗标（自行复核）：
```
32 (BP_ROOM | BP_SURROUND_WITH_WALLS | BP_PURGE_LIQUIDS | BP_PURGE_PATHING_BLOCKERS | BP_ADOPT_ITEM)  freq 6
51 (BP_ROOM | BP_ADOPT_ITEM | BP_SURROUND_WITH_WALLS | BP_PURGE_LIQUIDS)                              freq 10
52 (BP_ROOM | BP_ADOPT_ITEM | BP_SURROUND_WITH_WALLS | BP_OPEN_INTERIOR | BP_PURGE_INTERIOR)          freq 10
54 (BP_ROOM | BP_ADOPT_ITEM | BP_PURGE_INTERIOR | BP_SURROUND_WITH_WALLS)                             freq 10
```

⚠️ **`category` 要填对**：四条都带 `BP_ADOPT_ITEM`，是**钥匙机器 → `key_guard`**。
9b 一律填了 `thematic`，撞红 `v_1c` Q1b（`LEGAL = {reward, vestibule, key_guard}`）。

### 1.1 L：`TM_PROMOTES_ON_ELECTRICITY`

`ELECTRIC_CRYSTAL_OFF` 已由 9a 落地（CE `Globals.c:563`，带
`TM_PROMOTES_ON_ELECTRICITY | TM_IS_CIRCUIT_BREAKER | TM_IS_WIRED`），
断路器逻辑 V-2b-3 已有。**缺的是触发源**：闪电 bolt 命中格要触发 promote。

回 CE 定位 bolt 命中如何触发该 mech flag（`Combat.c` / `Architect.c`），给行号。
web 侧 `src/engine/Combat/Bolt.ts` 已有 `promoteTile` 引用，先看它缺什么。

### 1.2 暗：黑暗生产者

`DARK_FLOOR_DORMANT` 已由 9a 落地（CE `:358`）。链条是
`:358 DARK_FLOOR_DORMANT --DF_DARKENING_FLOOR--> :359 DARK_FLOOR_DARKENING
--DF_DARK_FLOOR--> :360 DARK_FLOOR`（带 `DARKNESS_CLOUD_LIGHT`）。

**中间态 `DARK_FLOOR_DARKENING` 与终态 `DARK_FLOOR` 目前都不是 TerrainType**
（只在 `DungeonFeatureCatalog` 里以字符串出现）——这正是 §0.1 说的半开门，
本轮要闭上。`LightCatalog` 已有 `DARKNESS_CLOUD_LIGHT`，核对它是否可直接消费。

54 号还要 ectoplasm（`LightCatalog` / `DungeonFeatureCatalog` 里已有痕迹，先查）。

### 1.3 泥潭

`MUD_FLOOR` / `MUD_WALL` / `MUD_DOORWAY` 已由 9a 落地，`DF_MUD_ACTIVATE` 在目录里。
51 号是"取钥匙 → 泥里冒沼泽怪"，属**休眠唤醒**——
`DFF_ACTIVATE_DORMANT_MONSTER` 的端到端链路至今未验证过端到端
（V-2b-5 登记、9a 只落了 RUBBLE tile）。
**若本轮能让它真的冒出怪，给实测数据；若走不通，查清卡在哪一环并登记，不要假装通了。**

## 2. 可解性（四条全是钥匙机器）

逐条回答：玩家怎么拿到钥匙、拿到后怎么活着出来。特别是：

- **52**：钥匙"caged on an altar"，要用闪电打水晶球才放出来。
  **玩家从哪来的闪电？** web 有没有闪电法杖/魔杖且会被生成到同层？
  没有就是死局 ⇒ §0.2 的口径退池留形 + 登记。
- **54**：房间变暗后还看得见出口吗？黑暗对可达性的影响 web 怎么算？
- **51**：沼泽怪冒出来时玩家站在哪？泥地可通行吗？

**发现死局就退池留形 + 登记，不要硬塞。**

## 3. 生成流会动——基线重捕获是最后一步

四条蓝图入池必动生成流。**重捕获放在所有改动之后**，之后 `npm run test:drift` 必须绿。

## 4. 授权改动清单

**引擎与数据**：`src/engine/Generator/BlueprintEngine.ts`、
`src/engine/Map/Grid.ts`、`src/engine/Map/TerrainCatalog.ts`、
`src/engine/Map/DungeonFeatureCatalog.ts`、`src/engine/Map/LightCatalog.ts`、
`src/engine/Combat/Bolt.ts`、`src/engine/Map/Promotion.ts`、
`src/engine/Core/Game.ts`、`src/data/blueprints.json`

**固件**：`src/test/fixtures/generation_baseline.json`（**仅最后一步**）

**测试**：新建 `src/test/v_2b_9c_effects.test.ts`、
`c_4a_terrain_catalog`、`c_4a_0_layer_model`、`c_4b_dungeon_feature`、
`c_4c_promotion`、`c_7_lighting`、`r_1_appearance`、`g_2_gas_df_wiring`、
`invented_content_pool`、`p1_30_i18n_gate`、`p1_42_secret_door_search`、
`blueprint_center`、`p1_33_machine_chokepoint`、`p1_37_machine_flag_i18n`、
`p1_20_item_placement`、`p1_31_35_placement_snapshot`、`b_4b_item_placement`、
`v_1a_blueprint_items`、`v_1b_alternative`、`v_1c_machine_structure`、
`v_2a_vestibule_return`、`v_2b_2a_placement_flags`、`v_2b_2b_blueprints`、
`v_2b_3_wired`、`v_2b_4_altars`、`v_2b_5_dormant`、`v_2b_6_keys`、
`v_2b_7_features`、`v_2b_9a_carriers`、`v_2b_9b_environment`、
`c_6_autogenerators`、`c_8_connectivity`、`p1_26_invariants`

清单外改动必须申报。`BrogueCE-master/` **只读**。**守卫顺延不放宽**；
**行为断言**撞断 > 5 个停下来说明（穷举表连带不计入）。

## 5. 门禁跑法（本地执行，与云端不同）

你在本机跑，10 核，`npx vitest run <file>` 单文件通常几秒到几分钟。

- **跑 §4 授权清单的全部文件**（不只是你改动过的）
- ⚠️ **不要跑不带参数的全量 `npx vitest run`** ——那是 135 分钟 CPU / 13 分钟墙钟，
  而且**验收方会在你交付后自己跑全量**，你跑等于和它抢核
- `npm run build` 要跑
- 基线重捕获后 `npm run test:drift`

**最终复跑（硬要求）**：在**所有编辑完成之后**，重新跑一遍授权清单，
报告里给出逐文件结果，并**明确声明「这是最终状态下的运行结果，不是中途快照」**。
中途跑过多少次都不算数。**这条不满足，本轮判为未完成。**

## 6. 授权反驳

事实判断若与 CE 不符，**驳回并纠正**并给行号。你在前几轮抓出过验收方多处错误
（RUBBLE 早已落地、DF#159 是 `DF_SHALLOW_WATER`、`DF_PUDDLE` 与 flood drain
是两条独立 DF、E 族无需新循环、F1 的真凶是既存 18 号而非新蓝图）——**继续这样做**。
§1 的机制归属与 §1.1-1.3 的"缺什么"都是验收方按符号名推的，很可能有错。

**对抗性要求**：每条新断言回答「这条用例在什么实现缺陷下会翻红？」
——尤其 §1.1 的闪电触发：它必须能区分"真的被闪电触发了"与"promote 被别的路径顺带跑了"。

## 7. 报告

写到 `ai_docs/reports/v-2b-9c.report.md`，含：

1. **§0.1 闭包自查**：方法 + 找到几个半开的门
2. 四条蓝图逐条 CE 行号与落地（含 `category` 填了什么）
3. §1.1 / 1.2 / 1.3 三族机制各自的 CE 依据与落地情况（走不通的登记，别假装通）
4. **§2 可解性逐条**（含退池留形的条目与理由，**按 §0.2 的口径退**）
5. §3 基线重捕获与成因分离
6. 撞断的守卫清单与处置（**覆盖门按 §0.3 处置**）
7. §6 对抗性要求的回答
8. **§5 的最终复跑声明**
9. 清单外改动申报
