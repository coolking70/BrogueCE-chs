# V-2b-9a 载体轮报告

## 1. 分类复核

- `POTION_LEVITATION`、`POTION_LIFE`、`POTION_FIRE_IMMUNITY`、`SCROLL_ENCHANTING` 是物品 kind，不是 tile；web 已在 `ItemLoader.ts:153,168,171,174` 映射到 `scroll_of_enchantment`、`potion_of_life`、`potion_of_levitation`、`potion_of_fire_immunity`，实体位于 `consumables.json`，故不改 `arcana.json`。
- `DP_GOBLIN_WARREN`、`DP_SENTINEL_SANCTUARY` 是 dungeon profile，本轮不实现，登记为独立机制缺口。
- `CRYSTAL_WALL` 已有同名地形；`ALTAR_INERT` 已由 web `ALTAR` 逐字段承载。本轮补齐二者 `TERRAIN_MAP` 别名。
- 任务书“真正要新建”表中的 `RUBBLE` 并非缺失：它已在 V-2b-7 落地（CE `Globals.c:465`），且相关 dormant 唤醒 DF 已接到该 tile。因此本轮没有重复创建枚举成员；其余 12 条均新建。

## 2. 新建地形（CE 行与字段）

所有列按 `display/fore/back, drawPriority, chanceToIgnite, fireType, discoverType, promoteType, promoteChance, glowLight, flags, mechFlags` 抄录；web 数据面保存玩法字段、层、优先级和光源。

| 地形 | CE 行 | 关键字段（priority / ignite / 三链 / chance / light / flags / mechFlags） |
|---|---:|---|
| FLOOR_FLOODABLE | 324 | 95 / 0 / PLAIN_FIRE,-,- / 0 / NO / 0 / 0 |
| MARBLE_FLOOR | 326 | 85 / 0 / EMBERS,-,- / 0 / NO / 0 / 0 |
| HAUNTED_TORCH_DORMANT | 344 | 0 / 0 / PLAIN_FIRE,-,HAUNTED_TORCH_TRANSITION / 0 / TORCH / OBSTRUCTS_EVERYTHING / STAND,VANISHES,WIRED |
| DARK_FLOOR_DORMANT | 358 | 95 / 0 / PLAIN_FIRE,-,DARKENING_FLOOR / 0 / NO / 0 / VANISHES,WIRED |
| FLOOD_TRAP | 390 | 58 / 0 / FLOOD,-,- / 0 / NO / IS_DF_TRAP / SIDEBAR,DISTINCT |
| LAVA_RETRACTABLE | 421 | 40 / 0 / OBSIDIAN,-,RETRACTING_LAVA / 0 / LAVA / LAVA_INSTA_DEATH / STAND,VANISHES,WIRED,SUBMERGING |
| CHASM_WITH_HIDDEN_BRIDGE | 554 | 40 / 0 / PLAIN_FIRE,-,- / 0 / NO / AUTO_DESCENT / STAND |
| ELECTRIC_CRYSTAL_OFF | 563 | 0 / 0 / PLAIN_FIRE,-,ELECTRIC_CRYSTAL_ON / 0 / NO / 四个阻挡位 / STAND,ELECTRICITY,CIRCUIT_BREAKER,WIRED,SIDEBAR |
| TURRET_LEVER | 565 | 0 / 0 / PLAIN_FIRE,-,TURRET_LEVER / 0 / NO / OBSTRUCTS_EVERYTHING / STAND,VANISHES,PLAYER_ENTRY,SIDEBAR,DISTINCT,INVERT |
| MUD_FLOOR | 576 | 85 / 0 / STENCH_SMOLDER,-,- / 0 / NO / FLAMMABLE / VANISHES |
| MUD_WALL | 577 | 0 / 0 / PLAIN_FIRE,-,- / 0 / NO / OBSTRUCTS_EVERYTHING / STAND |
| MUD_DOORWAY | 578 | 25 / 50 / EMBERS,-,- / 0 / NO / VISION,GAS,FLAMMABLE / STAND,DISTINCT |

`RUBBLE` 继续保持 CE :465 的 priority 70、SURFACE、`DF_PLAIN_FIRE`、`TM_STAND_IN_TILE`。

## 3. DF 目录、闭包及缺 tile

八个指定起点为：`:843 ADD_DORMANT_CHASM_HALO`、`:846 LAVA_RETRACTABLE`、`:830 SPREADABLE_WATER_POOL`、`:837 ADD_MACHINE_COLLAPSE_EDGE_DORMANT`、`:891 MUD_DORMANT`、`:917 CATWALK_BRIDGE`、`:916 CHASM_HOLE`、`:920 LAKE_CELL`。

展开并登记的 family/链包括：

- water：`SPREADABLE_WATER → WATER_SPREADS → SHALLOW_WATER`，以及 `SPREADABLE_WATER_POOL → SPREADABLE_DEEP_WATER_POOL`；
- collapse：`SPREADABLE_COLLAPSE`、`COLLAPSE_SPREADS → COLLAPSE → SHOW_TRAPDOOR_HALO`；
- bridge：`BRIDGE_ACTIVATE(_ANNOUNCE) → BRIDGE_APPEARS`；
- lava：`RETRACTING_LAVA`、`OBSIDIAN_WITH_STEAM → STEAM_ACCUMULATION`；
- mud 和 lake：`MUD_ACTIVATE`、`LAKE_CELL → LAKE_HALO`；
- 新地形三链强制闭包：`FLOOD → FLOOD_2`、`DARK_FLOOR → ECTOPLASM_DROPLET`、haunted torch、electric crystal/turret、`STENCH_SMOLDER → PLAIN_FIRE`。

目录从 99 条增至 131 条，所有 `subsequentDF` 均有目录条目。`DF_MISSING_TILES` 从 31 增至 53：新增 32 个 DF 中 22 个中间态 tile 不在本轮授权的地形清单，均明确登记为 `null`；其余 10 个有真实载体。RUBBLE 在开工前已落地，四条 RUBBLE DF 早已不在缺 tile 清单，因此本轮该部分变化为 **0**，与任务书预期的历史状态不同。

## 4. 基线自检

开工前与交付前均执行 `npm run test:drift`，两次均退出码 0；未修改、未重捕获 `generation_baseline.json`。新增载体没有蓝图消费者，生成流未移动。

## 5. 撞断守卫与处置

- TypeScript 穷举守卫首先撞断 `c_7_lighting` 与 `r_1_appearance`：补齐全部 12 个枚举成员；其中只有 retractable lava 与 haunted torch 为非零光源。
- `c_4b` 的目录条数、闭包集合全等、缺 tile 精确计数守卫撞断：更新为 131/53，并把八个授权起点及同组状态入口纳入静态闭包；没有放宽为包含关系。
- `c_7` 非零光源精确集合从 24 更新为 26。

## 6. 对抗性断言

新测试不是按名字自证：分别交叉钉住 priority+layer+fireType（可抓错列）、CHASM 的 AUTO_DESCENT、LAVA 的致死/有线/promote 三列、ELECTRIC 的 electricity 位与 promote、MUD_DOORWAY 的 ignite/fire/priority；DF 测试同时钉 CE 行、flags、链尾并穷举所有 `subsequentDF`。把 discoverType 抄入 promoteType、把 DFF_CLEAR_OTHER_TERRAIN 抄错、遗漏链尾、写反层或优先级，都会翻红。

## 7. 门禁执行范围

已跑 §4 授权测试清单的**全部文件**：`v_2b_9a_carriers`、`c_4a_terrain_catalog`、`c_4a_0_layer_model`、`c_4b_dungeon_feature`、`c_7_lighting`、`r_1_appearance`、`g_2_gas_df_wiring`、`p1_42_secret_door_search`、`invented_content_pool`、`p1_30_i18n_gate`；全部通过。另跑 `npm run build` 与 `npm run test:drift`，均通过。未跑文件：无。

## 8. 清单外改动申报

无。未修改 `src/data/blueprints.json`、`src/test/fixtures/generation_baseline.json`，未修改只读 `BrogueCE-master/`。
