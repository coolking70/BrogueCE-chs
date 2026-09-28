# X-4：内容完整性勘察——替身/缺失内容、零生成、物品详情、文本（只读）

> 执行环境：Claude Code 云端会话。仓库 `https://github.com/coolking70/BrogueCE-chs`，基线 `main`。
> **只读勘察：不修改 `brogue-web/src/`、`brogue-web/scripts/`。** 只新增报告与 txt/json 证据；提交到分支 `survey/x-4` 并推送；不推 main、不打标签、不动 gh-pages；不跑完整 `npm test`（只允许 `npx vitest run <单个临时探针>` 或 `npx tsx <脚本>` 规模，探针放未跟踪临时目录，证据以 .txt 附在报告目录）。

## 0. 背景（验收方已核实的两个实例）

1. **血根草完全缺失**：CE 地形 `BLOODFLOWER_STALK`/`BLOODFLOWER_POD`（`BrogueCE-master/src/brogue/Globals.c:513-514`），DF `DF_BLOODFLOWER_PODS_GROW_INITIAL/GROW/POD_BURST`（`:699-700`），蓝图 "Bloodwort"（`src/variants/GlobalsBrogue.c:557-560`），自动生成行 `MT_BLOODFLOWER_AREA`（`:161`，D1–30）。web：`TerrainType` 里**没有 BLOODFLOWER_POD**；`src/engine/Map/DungeonFeatureCatalog.ts:1460-1461` 两个 DF 的 `ceTile:'BLOODFLOWER_POD'` 却 `tile: TerrainType.BLOODFLOWER_STALK`（替身）；V-2b-8 探针中该蓝图建成 0 次（`ai_docs/reports/v-2b-8.report.md:28`）无人追查。同段 `DF_URINE` 的 `ceTile:'URINE'` 而 `tile: BLOOD`，也是替身。
2. **物品详情为空**：`src/engine/UI/DetailGenerator.ts:337-345` 说明文字仅 `kindKnown` 时显示，且描述兜底只覆盖戒指/护符——未鉴定药水什么都不显示，已鉴定药水/卷轴/法杖/魔杖也常为空。CE `Items.c` `itemDetails()`（约 1400–2400 行）对各类物品、各鉴定状态都有成段文字（外观描述、"Who knows what it will do"、发现深度、魔法极性、力量/附魔、充能、符文提示、已知/未知分支等）。web 详情是自创简化版，不是移植。

这说明存在一类"**以占位/替身/简化实现通过了测试，但内容在游戏里缺失或不对**"的问题，需要系统筛查。

项目裁决（勿列为差异）：不追求同种子逐骰一致；不兼容 `.broguerec`；不做旧存档迁移；不做无障碍；web 自创内容只保留定义（不入生成）。

## 1. 勘察范围

**A. 替身与缺失目录项**（脚本化，全量）：
- 所有带 CE 对照字段的目录（DF 目录 `ceTile`↔`tile`、`cePropagationTerrain`↔`propagationTerrain`、`ceDf`↔`df`；自动生成表 `ceTerrain/ceDf/ceMachine`↔实际；蓝图 feature 的 terrain/DF/item/monster 名；地形目录；怪物/物品/符文/护符等目录的 CE 名↔web 实体）：列出**名字对不上**、**映射到别的实体**、**CE 实体在 web 不存在**的每一项。
- CE 枚举全集对照：`Rogue.h` 的 tileType、dungeonFeatureTypes、machineTypes、monsterTypes、各物品种类枚举 → web 是否有对应实体（缺失即列出）。
- 记录每项的"carrier"/note 字段说明（如 'wired'、占位注释），判断是否真实接线。

**B. 零生成/低生成**（探针）：
- 用 web 生成器跑足量种子（D1–D40 分层，每层 ≥ 50 个种子，或按耗时调整并说明），统计每个自动生成行、每个蓝图（含机器内房间/物品/怪物）、每种地形、每种物品种类、每种怪物的出现次数；与 CE 的频率/深度范围对照，列出 **CE 应出现（freq>0 且深度内）但 web 出现 0 次或显著偏低** 的条目，并定位原因（缺实体/替身/条件永不满足/候选筛选错误）。不要求与 CE 逐骰一致，只看"应有却没有"。

**C. 物品详情对照**：逐类（武器/护甲/药水/卷轴/食物/法杖/魔杖/戒指/护符/宝石/钥匙/金币）× 鉴定状态（未知/种类已知/完全已知/已探测魔法极性/诅咒已知）对照 CE `itemDetails` 各分支，列出 web 缺失的段落与数值；实测：用探针对每个物品种类在各状态生成 `generateItemDetail` 文本，统计空详情/仅标题的组合。

**D. 文本完整性**：地形 description/flavorText、怪物 description/flavor（CE `monsterText`：flavor、absorbing、summon 等）、物品种类描述（药水/卷轴/法杖/魔杖/戒指/护符描述文本）、蓝图/机关相关消息——统计 web 中缺失、为空、或仍为英文未进 i18n 的条目（按目录给出数量与清单）。

**E. 发现即记**：勘察过程中发现的其它"测试绿但内容缺"的实例。

## 2. 交付

`brogue-web/ai_docs/reports/x-4-survey.report.md`：
1. 总表：编号（X4-A01…）、类别、严重度（S1 缺失影响游玩/平衡的内容，如血根草、关键物品说明；S2 明显缺失/错误；S3 细节）、CE 出处、web 出处、现象、建议修法、门禁档位（轻＝纯前端；中＝引擎非规则/文本/显示；全量＝规则/生成/RNG/存档）。
2. A–E 分节说明；B 节附统计表（web 次数 vs CE 期望）。
3. 修复单元分组（互不冲突，注明文件）；特别给出"物品详情按 CE itemDetails 移植"的单元方案。
4. 覆盖声明与探针说明（种子数、耗时、方法）。
完成后回复报告路径、按严重度统计的条数与分组摘要。
