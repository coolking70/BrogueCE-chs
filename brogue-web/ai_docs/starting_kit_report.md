# 开局装备对齐 CE — 交付报告（starting kit）

日期：2026-09-14
任务：对齐 Brogue CE 开局装备（口粮 ×1 → 匕首 → 飞镖 ×15 → 皮甲），基线
`BrogueCE-master/src/brogue/RogueMain.c:420-443`。

## 1. 结论

全部验收通过：

| 验收项 | 结果 |
| --- | --- |
| `npm test` | **37 passed \| 1 expected fail \| 7 todo (45)**，4 个测试文件全过。原有 32 passed 未减少（37 = 32 + 本次新增 5），"1 expected fail" 仍是 CombatFormulas.test.ts:183 的既有 `it.fails`（护甲公式，与本任务无关） |
| `npm run build` | vue-tsc -b 无类型错误，vite build 成功（✓ built in 1.35s） |
| 改动范围 | 仅任务允许的 3 个修改文件 + 1 个新增测试文件，无越界 |

## 2. npm test 输出尾部（原文）

```
> brogue-web@0.0.0 test
> vitest run


 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web


 Test Files  4 passed (4)
      Tests  37 passed | 1 expected fail | 7 todo (45)
   Start at  00:53:36
   Duration  741ms (transform 337ms, setup 0ms, import 429ms, tests 550ms, environment 1ms)
```

新增用例（src/engine/Core/startingKit.test.ts，5 个）：

1. normal 模式：背包含口粮/匕首/飞镖/皮甲，且发放顺序与 CE 一致
2. 匕首与皮甲：已装备、enchantment=0、无诅咒、已鉴定（runicKnown）
3. 飞镖：数量 15、已鉴定、无诅咒、不装备
4. easy 模式：同样发放开局套件，maxHp/strength 覆盖保持不变
5. wizard 模式：同上（it.each 展开，共 2 条）

## 3. npm run build 输出尾部（原文）

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

vite v7.3.1 building client environment for production...
transforming...
✓ 784 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                               0.76 kB │ gzip:   0.43 kB
dist/assets/index-LeVsgywH.css               16.93 kB │ gzip:   4.08 kB
dist/assets/Filter-DZMlv12A.js                0.90 kB │ gzip:   0.48 kB
dist/assets/BufferResource-BAa51P_c.js       10.60 kB │ gzip:   2.79 kB
dist/assets/webworkerAll-DtMQWhbW.js         11.88 kB │ gzip:   3.94 kB
dist/assets/CanvasRenderer-tVHdsPQD.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-DFoicRj9.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-Cai74qIJ.js           41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-CKBh_Dxz.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-C3y1ul2U.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-HueYhzlh.js               852.81 kB │ gzip: 272.71 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.35s
```

（chunk 体积警告为项目既有状态，与本次改动无关。）

## 4. git diff --stat（改动范围证明）

```
 brogue-web/src/data/weapons.json    |  9 +++++++++
 brogue-web/src/engine/Core/Game.ts  | 35 +++++++++++++++++++++++++++++++++++
 brogue-web/src/engine/Items/Item.ts |  3 +++
 3 files changed, 47 insertions(+)
```

`git status --porcelain` 原文：

```
 M brogue-web/src/data/weapons.json
 M brogue-web/src/engine/Core/Game.ts
 M brogue-web/src/engine/Items/Item.ts
?? brogue-web/src/engine/Core/startingKit.test.ts
?? output/
```

- 修改 3 文件 + 新增 1 个测试文件（未跟踪，故不出现在 diff --stat），恰好等于任务允许清单。
- `output/` 为会话开始前已存在的未跟踪目录（开场 git 快照即有 `?? ../output/`），本任务未创建、未触碰。
- 未执行任何 git commit / add / push / reset / checkout，改动全部留在工作区。

## 5. dart 条目的 CE 来源与数值对照

**来源更正：任务书指向 `BrogueCE-master/src/variants/GlobalsBrogue.c`，该文件中不存在 weaponTable。**
实际位置：`BrogueCE-master/src/brogue/Globals.c:1582`（`itemTable weaponTable[NUMBER_WEAPON_KINDS]`），**DART 条目在第 1600 行**：

```c
{"dart", "", "", 0,  15,         10, 0, {2, 4,  1},     true, false, 0, false, "These simple metal spikes are weighted to fly true and sting their prey with a flick of the wrist."},
```

按 `Rogue.h:1424-1438` 的 `itemTable` 结构逐字段对照：

| CE 字段（Rogue.h 顺序） | DART 值 | web 落地 |
| --- | --- | --- |
| name | `"dart"` | `id: "dart"` / `name: "Dart"` |
| frequency | 0（CE 中飞镖不随机落地） | 不适用（web 无此列，不影响本任务） |
| marketValue | 15 | 不适用（web 无此列） |
| strengthRequired | **10** | `strengthRequired: 10` |
| power | 0 | 不适用 |
| range（min/max/clumps） | **{2, 4, 1}** | `damage: "2d2"` → parseDamageString 得 min 2 / max 4，均值 3，与 CE {2,4} 三项全一致 |
| identified（表级默认） | true | 发放代码显式置已鉴定（见 §7 边界说明） |
| description | "These simple metal spikes…" | 中文意译写入 description |

新增 JSON 条目（weapons.json 末尾），来源行号以 `source` 字段注明（JSON 不支持注释）：

```json
{
    "id": "dart",
    "name": "Dart",
    "strengthRequired": 10,
    "damage": "2d2",
    "weight": 2,
    "description": "这些简单的金属飞镖经配重后能稳定飞行，手腕轻弹便能刺伤猎物。",
    "source": "CE 来源：BrogueCE-master/src/brogue/Globals.c:1600（weaponTable DART 条目：frequency=0, marketValue=15, strengthRequired=10, power=0, range={2,4,1}）。damage 2d2 对应 CE range {2,4}（min 2 / max 4 / 均值 3）；weight 为 web 侧自定（CE 表无 weight 列）。"
}
```

注：CE weaponTable 无 weight 列，`weight: 2` 为 web 侧自定（仅参与 Inventory.getWeight 统计）。

## 6. 改动明细

1. **src/data/weapons.json**：数组末尾追加 dart 条目（见 §5），既有 12 条逐字未动。
2. **src/engine/Items/Item.ts**：新增 `public quantity: number = 1;` 字段（对齐 CE `item->quantity`）。堆叠采用"quantity 字段"方案（任务允许两案中改动最小者；15 个实例会虚假撑满 26 格背包）。
3. **src/engine/Core/Game.ts**：`startNewGame()` 内、easy/wizard 的 maxHp/strength 覆盖块（保持原样）之后、`generateDepth(false, true)` 之前，按 CE 顺序发放：口粮 → 匕首（enchantment=0、清 cursed/runic、runicKnown=true、addItem + equip）→ 飞镖 ×15（同上设置、quantity=15、不装备）→ 皮甲（同匕首、equip）。发放顺序不可调换：物品创建会消耗全局 rng，回放系统依赖该顺序。
4. **src/engine/Core/startingKit.test.ts**：新增，5 个用例（见 §2）。

未触碰：Architect.ts、BlueprintEngine.ts、Gas.ts、Bolt.ts、Monster.ts、CombatFormulas.ts、Combat.ts、hordes.json、monsters*.json、以及 P0 全部既有测试（CombatFormulas.test.ts、Random.test.ts、smoke.test.ts、harness.ts）。

## 7. 任务边界声明（第 4 条）

**投掷命中公式不在本任务范围，本次未做任何投掷逻辑改动。** 飞镖目前只达成"背包里有 15 支飞镖"（quantity=15、已鉴定、不装备）；投掷流程、命中/伤害结算、投掷后数量扣减与消失逻辑均未触碰（Bolt.ts、Combat.ts 未修改），留待后续任务按 CE Items.c 的投掷路径对齐。

同理：quantity 目前仅是数据字段，背包 UI 尚不显示"×15"（UI 文件不在本任务允许修改清单内）。

## 8. 与预设不符之处（只列不修，由验收方判断）

1. **weaponTable 路径错误**：任务书指定查 `src/variants/GlobalsBrogue.c` 的 weaponTable，该文件没有 weaponTable；实际在 `src/brogue/Globals.c:1582`，DART 条目在 **1600 行**。本报告按实际位置取值。
2. **web 既有武器/护甲表与 CE 数值系统性不一致**（本任务未顺手对齐，严格只加 dart）：如 web dagger `strengthRequired: 10`、`damage: "1d4"`，CE dagger 为 strengthRequired 12、伤害 3-4（Globals.c:1583）；其余条目同样存在偏移。开局匕首/皮甲发放按 web 现有表值生成，仅在发放代码中强制 enchantment=0、无诅咒、已鉴定。
3. **CE 的 `player.status[STATUS_DONNING] = 0`（RogueMain.c:443）无 web 对应**：web 项目没有 donning（穿戴延迟）状态，`Player.equip` 是直接赋值，故开局皮甲无需清 donning。
4. **CE 的 `recalculateEquipmentBonuses()`（RogueMain.c:445）无 web 对应**：web 的装备加成在使用点实时读取 equippedWeapon/equippedArmor，无集中重算步骤，故未调用等价物。
5. **"已鉴定"的模型差异**：CE 对每件物品有 ITEM_IDENTIFIED 标志；web 的武器/护甲无独立 identified 标志（附魔/诅咒恒可见，runicKnown 是唯一物侧标记），开局发放以 `runicKnown = true` 表达已鉴定，测试同此断言。
6. **GameSnapshotItem（存档快照接口）未包含 quantity**：存档/读档路径不序列化飞镖数量（读档后 quantity 回落为 1）。存档接口不在本任务允许修改清单内，未改。
7. **weapons.json 追加 dart 的连带影响**：测试模式"武器"分类房多一间飞镖房；蓝图 WEAPON 随机池多了 dart（追加在数组末尾，既有条目索引不变，常规楼层随机掉落的武器池用的是硬编码 dagger/sword，不受影响）。属预期行为面变化，非缺陷。

## 9. 验收条款逐条对照

| 任务要求 | 状态 |
| --- | --- |
| new Player 之后、generateDepth 之前按 CE 顺序发放 4 类物品 | ✅ Game.ts:305 块后插入，顺序 口粮→匕首→飞镖→皮甲 |
| 匕首/皮甲 enchantment=0、清 cursed/runic、已鉴定、直接 equip | ✅ |
| 飞镖 enchantment=0、清 cursed/runic、已鉴定、不装备 | ✅ quantity=15 |
| weapons.json 新增 dart + 注明 CE 来源行号 | ✅ Globals.c:1600（`source` 字段） |
| quantity 堆叠方案二选一、不改投掷 | ✅ Item.quantity 字段；投掷未动（§7） |
| easy/wizard maxHp/strength 覆盖不变 | ✅ 原块逐字未动 + 测试断言 |
| 新增测试断言 4 类物品/装备位/诅咒/附魔/鉴定/数量 | ✅ startingKit.test.ts |
| npm test 全绿、原 32 passed 不减少 | ✅ 37 passed \| 1 expected fail \| 7 todo |
| npm run build 全绿 | ✅ |
| 不碰禁区文件 / 不改 P0 测试 / 不 commit | ✅ §4、§6 |
