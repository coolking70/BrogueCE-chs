# V-2b-2b 蓝图级改造 + 地形载体 + 落六条蓝图

## 0. 定位与前置

V-2b-2 的后半（前半 V-2b-2a 已做 feature 级落位旗标）。本轮做三件事：蓝图级内部改造旗标（BP_*）、7 个地形载体、CE 逐字落 6 条蓝图（目录序 3/4/5/19/20/23）+ 基座蓝图拆分。

**前置**：V-2b-2a 必须已合并。本轮的 6 条蓝图全部依赖它实现的 feature 旗标（`MF_BUILD_IN_WALLS` 让雕像进墙、`MF_EVERYWHERE` 让地毯铺满、`MF_BUILD_ANYWHERE_ON_LEVEL` 让 19 号的点火物落在机器外）。

---

## 1. 验收方对勘察报告的两处范围修正（**本轮按修正后的范围做**）

勘察报告 §2.3 给 V-2b-2 列的是「纯条目批次 17 个」地形。验收方按 6 条目标蓝图的实际引用重算，**只需要 7 个**，其余 10 个是后续轮次（哥布林 warren 的泥三件套、镣铐、shrine 铺盖卷等）才用到的：

| 需要的地形 | 被几条蓝图引用 | CE 位置 |
|---|---|---|
| `CARPET` | 3（3/4/5 号） | `Globals.c:325` 可燃地毯，SURFACE 层 |
| `STATUE_INERT` | 3（3/4/5 号） | 雕像 |
| `PEDESTAL` | 2（4/5 号） | 基座 |
| `FUNGUS_FOREST` | 1（3 号） | `Globals.c:475`；**web `FOLIAGE` 可作别名**（阻挡+可燃都有，缺踩踏晋升，可缺省） |
| `STATUE_INERT_DOORWAY` | 1（20 号） | 门内雕像 |
| `WOODEN_BARRICADE` | 1（19 号） | 可燃木栅 |
| `TRAP_DOOR_HIDDEN` | 1（23 号） | 隐藏陷阱门；**web `HOLE` 载体已有、P1-42 搜索揭示已有**，缺的是 hidden 位 |

**第二处修正：五个"缺失"的物品种类其实全都有**，勘察报告把它们算进缺口是因为比对的是 `TerrainType`。web id 对照：

| CE | web id | 状态 |
|---|---|---|
| `POTION_LIFE` | `potion_of_life` | ✅ |
| `SCROLL_ENCHANTING` | **`scroll_of_enchantment`**（注意不是 `_enchanting`） | ✅ |
| `INCENDIARY_DART` | `incendiary_dart` | ✅ 数据有（见 §4 风险） |
| `POTION_INCINERATION` | `potion_of_incineration` | ✅ |
| `SCROLL_SHATTERING` | `scroll_of_shattering` | ✅ 且计量表 frequency=0（对应 CE 的"只由机器产出"） |

**所以本轮不需要新增任何物品种类。** 若你发现某个 web id 实际不可用，行使授权反驳并指出。

---

## 2. 蓝图级内部改造旗标（BP_*）

CE 把这些集中在 `Architect.c:858-945` 一段（`BP_NO_INTERIOR_FLAG` 例外，在 `:1691`）。web 目前只消费 4 个蓝图级旗标，本轮补这 6 个：

| 旗标 | CE 行 | 语义 |
|---|---|---|
| `BP_OPEN_INTERIOR` | :864 | 扩张 interior 直到凸或撞到邻房 |
| `BP_PURGE_PATHING_BLOCKERS` | :882-896 | 逐层清掉带 `T_PATHING_BLOCKER` 的地形（即"不许有陷阱"） |
| `BP_PURGE_LIQUIDS` | :897-907 | 清掉 interior 的液体层 |
| `BP_SURROUND_WITH_WALLS` | :908-932 | 给 interior 外圈补墙。**注意 `!(pmap[i][j].flags & IS_GATE_SITE)` 这个豁免**——门位不补墙，否则机器被封死 |
| `BP_IMPREGNABLE` | :938 | 整个 interior 标记不可挖掘 |
| `BP_NO_INTERIOR_FLAG` | :1691 | 不给 interior 打 `IS_IN_MACHINE` 标记（23 号用它，让陷阱区不算机器内） |

`BP_PURGE_INTERIOR`（:869-881）web 已实现，不要重做。

`BP_MAXIMIZE_INTERIOR`（:862）与 `BP_REDESIGN_INTERIOR`（:933）**本轮不做** —— 目标 6 条蓝图都不带它们。

---

## 3. 六条蓝图（CE 逐字）

| # | CE 名 | roomSize | freq | 蓝图旗标 |
|---|---|---|---|---|
| 3 | Treasure room（药剂库/档案室） | {20,40} | 20 | ROOM\|PURGE_INTERIOR\|SURROUND_WITH_WALLS\|OPEN_INTERIOR\|IMPREGNABLE\|REWARD |
| 4 | Guaranteed good **permanent** item on pedestal | {10,30} | 30 | 同上 |
| 5 | Guaranteed good **consumable** item on pedestals | {10,30} | 30 | 同上 |
| 19 | Flammable barricade in the doorway | {1,1} | 10 | VESTIBULE |
| 20 | Statue in the doorway（碎裂卷轴进入） | {1,1} | 6 | VESTIBULE |
| 23 | Pit traps（入口外一片陷阱） | {30,60} | 8 | VESTIBULE\|OPEN_INTERIOR\|NO_INTERIOR_FLAG |

**基座蓝图拆分**：CE 的 4 号（永久物：符文武器/护甲或两根法杖）与 5 号（消耗品：附魔卷轴、生命药水）是**两条独立蓝图**，web 合并成了一条 `reward_pedestals`（V-2a 报告 §1.4 已登记）。本轮按 CE 拆回两条。拆分后注意 V-1b 落地的 `MF_ALTERNATIVE` 配对关系要跟着走对。

---

## 4. 必答风险：19 号有一半概率不可解

CE 19 号给了两个 `MF_ALTERNATIVE` 点火物，二选一：

```
{… WEAPON, INCENDIARY_DART,      … (MF_GENERATE_ITEM | MF_BUILD_ANYWHERE_ON_LEVEL | MF_NOT_IN_HALLWAY | MF_ALTERNATIVE)},
{… POTION, POTION_INCINERATION,  … (MF_GENERATE_ITEM | MF_BUILD_ANYWHERE_ON_LEVEL | MF_NOT_IN_HALLWAY | MF_ALTERNATIVE)}
```

**验收方已实测**：web 的 `incendiary_dart` 除 `ItemLoader` 生成外**引擎零消费点** —— 投掷落点不点火（grep 全引擎无 `DF_DART_EXPLOSION` / 投掷点燃路径）。所以 ALTERNATIVE 掷到飞镖的那一半房间，玩家没有任何点火手段，**木栅烧不掉、房间进不去**。

**本轮必须处置，三选一，在报告里写明选了哪条与理由**：

1. **接上飞镖点燃**（最忠实，但扩大了本轮范围到投掷系统）；
2. **临时改为只保留焚化药水一条**（去掉 ALTERNATIVE 配对），并把"飞镖点燃未接线"登记为阻塞项，等投掷轮补回；
3. **19 号本轮不落**，留到飞镖点燃接线之后。

验收方倾向 **2**（本轮仍能落 19 号的主体结构，偏差单点、可登记、日后一行数据改回），但你可以驳。**不接受**的是：照抄 CE 数据然后不提这件事。

---

## 5. 基线重捕获（最后一步）

本轮大幅改动生成（6 条新蓝图 + 地形 + BP_* 改造），基线必然大幅偏离。照旧：**§1-4 全改完、其余门禁全绿之后，最后一步**才重捕获。

报告里要给成因拆分：多少来自新蓝图入池（抽签概率变化）、多少来自 BP_* 改造（同一机器的内部形态变化）。**分不开就说分不开**，不要编 —— V-2b-1 那轮的 2×2 受控实验是好范例。

---

## 6. 授权改动清单

**引擎与数据**
- `src/engine/Generator/BlueprintEngine.ts`
- `src/engine/Map/Grid.ts`（新增 TerrainType 成员）
- `src/engine/Map/TerrainCatalog.ts`
- `src/data/blueprints.json`
- `src/engine/Core/Game.ts`（仅在地形/物品落点需要时）

**测试与固件**
- `src/test/fixtures/generation_baseline.json`（仅 §5 最后一步）
- 新建 `src/test/v_2b_2b_blueprints.test.ts`
- `src/test/blueprint_center.test.ts`、`p1_33_machine_chokepoint.test.ts`、`v_1a_blueprint_items.test.ts`、`v_1b_alternative.test.ts`、`v_1c_machine_structure.test.ts`、`v_2a_vestibule_return.test.ts`、`p1_20_item_placement.test.ts`、`p1_31_35_placement_snapshot.test.ts`、`p1_37_machine_flag_i18n.test.ts`、`c_8_connectivity.test.ts`、`p1_26_invariants.test.ts`、`c_4a_terrain_catalog.test.ts`、`c_4a_0_layer_model.test.ts`、`invented_content_pool.test.ts`

新增地形会撞 `c_4a_*` 的地形目录穷举表与 `invented_content_pool` 的自创内容扫描，所以它们在清单内。

**只读**：`BrogueCE-master/`。

**守卫顺延不放宽**；撞断 > 5 个时停下来在报告里说明，不要硬改。

---

## 7. 本轮明确不做

- `BP_MAXIMIZE_INTERIOR` / `BP_REDESIGN_INTERIOR`
- 勘察报告 17 个地形里本轮用不到的那 10 个
- wired 触发网络、DF 系统、休眠唤醒、钥匙真实化（分别归 2b-3/7/5/6）
- 3/4/5/19/20/23 之外的任何 CE 蓝图
- 调大测试 timeout（超时线已于 V-2a 统一校准：全局 900s / `blueprint_center` 900s / `armor_model_effect` 2400s。不够就回报申请）

---

## 8. 授权反驳

以上判断若与你读 CE 源码所得不符，**驳回并纠正**，给出 `BrogueCE-master/src/...` 的文件:行号。

特别请复核三条：
1. **§1 的「只需 7 个地形」** —— 验收方是对 6 条蓝图各自的符号集与 web `TerrainType` 取差得出的。若某条蓝图还隐含依赖别的载体（例如经 DF 列间接引用），指出来。
2. **§1 的物品 id 对照** —— 尤其 `scroll_of_enchantment` 这个拼写。
3. **§2 中 `BP_SURROUND_WITH_WALLS` 的 `IS_GATE_SITE` 豁免** —— 漏了它机器会被自己的墙封死。

---

## 9. 门禁与报告

```
npx vitest run
npm run build
```

并行跑，不加 `--fileParallelism=false`；类型门禁用 `npm run build`。失败清单完整输出，不要 `| tail`。

报告写到 `ai_docs/reports/v-2b-2b.report.md`，含：

1. 7 个地形与 6 条蓝图的落地情况 + CE 行号
2. §2 六个 BP_* 旗标的落地位置
3. **§4 必答题选了哪条，理由**
4. §5 基线偏离的成因拆分
5. 基座蓝图拆分后 `MF_ALTERNATIVE` 配对的核验
6. 撞断的守卫清单与处置
7. 任何行使授权反驳之处
8. 门禁两条命令的完整输出结尾
