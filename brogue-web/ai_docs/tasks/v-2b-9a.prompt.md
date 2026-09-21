# V-2b-9a 载体轮：地形 + DF 目录（不落蓝图）

> **本轮在 Codex Cloud 运行。门禁口径见 §5——上一轮（V-2b-8）就是栽在这上面。**

## 0. 为什么先只做载体

V-2b-9 原范围是 **20 地形 + 8 DF + 15 条蓝图** ——比 V-2b-8（4 地形 + 6 DF + 8 蓝图）
大一倍，而 V-2b-8 在验收方本地全量门禁上撞了 **15 条失败**、需要一个补完轮。

所以拆成两轮：

- **本轮（9a）**：只落**载体**（地形 + DF 目录），**一条蓝图都不落**。
- 下一轮（9b）：落 15 条蓝图，消费本轮的载体。

**这样做的关键好处**：未被任何蓝图引用的新地形/DF **不会移动生成流**。
所以本轮的基线**应当保持不变**——见 §3，那是本轮最重要的自检。

**顺带并入 RUBBLE**（V-2b-5 登记的堵点）：`DFF_ACTIVATE_DORMANT_MONSTER` 那三条 DF
的 tile 全是 `RUBBLE`，缺它导致「雕像 burst 出怪」的端到端唤醒至今走不通。
它本质也是"加一个地形"，与本轮同类，合并做掉——**但仍不接线**（唤醒链路由 9b 或
专门轮验证端到端）。

## 1. 要落的载体

### 1.1 地形

先分类，别照单全收——下面这些**不是地形**，不要新建 TerrainType：

| 符号 | 实际是什么 | 处置 |
|---|---|---|
| `POTION_LEVITATION` / `POTION_LIFE` / `POTION_FIRE_IMMUNITY` / `SCROLL_ENCHANTING` | **物品种类** | 核对 web 是否已有（`potion_of_*` / `scroll_of_enchantment`），有就补 id 映射 |
| `DP_GOBLIN_WARREN` / `DP_SENTINEL_SANCTUARY` | **dungeonProfile**（CE 的 `dungeonProfileCatalog`） | **本轮不做**，登记为独立机制缺口 |
| `CRYSTAL_WALL` / `ALTAR_INERT` | web **已有** TerrainType | 只补 `TERRAIN_MAP` 映射（`ALTAR_INERT` → `ALTAR`，V-2b-6 已裁决） |

**真正要新建的**（自行复核这份清单，多退少补）：
`FLOOR_FLOODABLE`、`CHASM_WITH_HIDDEN_BRIDGE`、`LAVA_RETRACTABLE`、
`MUD_FLOOR`、`MUD_WALL`、`MUD_DOORWAY`、`MARBLE_FLOOR`、`FLOOD_TRAP`、
`ELECTRIC_CRYSTAL_OFF`、`TURRET_LEVER`、`HAUNTED_TORCH_DORMANT`、
`DARK_FLOOR_DORMANT`、**`RUBBLE`**。

每条逐字段照 CE `Globals.c`（flags / mechFlags / 各 DF 列 / glowLight / drawPriority），
给行号。

### 1.2 DF 目录（8 条 + 闭包）

`DF_ADD_DORMANT_CHASM_HALO`、`DF_LAVA_RETRACTABLE`、`DF_SPREADABLE_WATER_POOL`、
`DF_ADD_MACHINE_COLLAPSE_EDGE_DORMANT`、`DF_MUD_DORMANT`、`DF_CATWALK_BRIDGE`、
`DF_CHASM_HOLE`、`DF_LAKE_CELL`

⚠️ **闭包**：`c_4b` E2/E3 钉死无悬空 `subsequentDF`。链上的要补齐，条数可能多于 8。
RUBBLE 落地后，V-2b-5 登记的三条 dormant DF 的缺 tile 状态也要相应更新
（`c_4b` E4 的 `DF_MISSING_TILES` 计数）。

## 2. 本轮不做

- **一条蓝图都不落**（`src/data/blueprints.json` 零改动——这是与 9b 的分界线）
- dungeonProfile（`DP_*`）机制
- 唤醒链路的端到端接线（RUBBLE 只落 tile）
- 任何会移动生成流的改动

## 3. 最重要的自检：基线必须不变

本轮新增的地形/DF **没有任何蓝图引用**，所以**生成流不应移动**。

**交付前必须跑 `npm run test:drift`（= `generation_baseline`），它必须绿。**

**若它红了，说明你改到了会移动生成流的东西——停下来查清成因再决定，
不要重捕获基线把它盖掉。** 本轮任务书没有授权重捕获。

（`generation_baseline` 已于 2026-09-22 移出默认门禁，所以 `npm test` 不会跑到它，
必须单独跑 `npm run test:drift`。）

## 4. 授权改动清单

**引擎与数据**：`src/engine/Map/Grid.ts`、`src/engine/Map/TerrainCatalog.ts`、
`src/engine/Map/DungeonFeatureCatalog.ts`、`src/engine/Generator/BlueprintEngine.ts`
（仅 `TERRAIN_MAP` 映射）、`src/data/arcana.json`（仅在缺物品 id 时）

**明确不许改**：`src/data/blueprints.json`、`src/test/fixtures/generation_baseline.json`

**测试**：新建 `src/test/v_2b_9a_carriers.test.ts`、
**穷举表类**（加地形/DF 必撞）：`c_4a_terrain_catalog`、`c_4a_0_layer_model`、
`c_4b_dungeon_feature`、`c_7_lighting`、`r_1_appearance`、`g_2_gas_df_wiring`、
`p1_42_secret_door_search`、`invented_content_pool`、`p1_30_i18n_gate`

清单外改动必须申报。`BrogueCE-master/` 只读。**守卫顺延不放宽**。

## 5. 门禁跑法（**吸取 V-2b-8 的教训**）

V-2b-8 的任务书写成「只跑你实际改动过的文件」——**那是错的**，
授权清单存在的意义就是改动会外溢，结果验收方本地跑出 15 条失败、
其中 9 个文件执行方从未跑过。

本轮口径：

> **跑 §4 授权清单里的全部文件**（不只是你改动过的），逐个或分批
> `npx vitest run src/test/<file> …`；**外加 `npm run test:drift`**（§3 的自检）。

若窗口装不下全部，**在报告里列出你没跑到的文件**——不要沉默跳过。
`npm run build` 要跑（加完地形立刻验类型，别攒到最后）。

仍然**不要**跑不带文件参数的全量 `npx vitest run`（本地并行 15 分钟）。

## 6. 授权反驳 + 对抗性要求

事实判断若与 CE 不符，**驳回并纠正**并给行号。§1.1 的那张分类表是验收方按符号名
猜的，**很可能有错**——例如某个我判为"物品种类"的其实是 tile。读 CE 发现分错了就指出来。

**对抗性要求**：每条新断言回答「这条用例在什么实现缺陷下会翻红？」
——本轮是纯数据轮，最容易写出"照着数据抄一遍"的自证式断言。
好的断言应该能抓住**抄错列**（例如把 `discoverType` 抄进 `promoteType`——
V-2b-5 就在 `STATUE_INSTACRACK` 上真发生过）。

## 7. 报告

写到 `ai_docs/reports/v-2b-9a.report.md`，含：

1. §1.1 分类表的复核结果（哪些不是地形、哪些 web 已有）
2. 新建地形逐条的 CE 行号与字段
3. DF 目录扩充与**闭包链展开**；RUBBLE 落地后 `DF_MISSING_TILES` 的变化
4. **§3 的基线自检结果**（`npm run test:drift` 绿不绿）
5. 撞断的守卫清单与处置
6. §6 对抗性要求的回答
7. §5 口径下你**跑了哪些文件、没跑哪些**
8. 清单外改动申报
