# V-2b-9a 补完轮报告

## 1. 十一条失败：成因、处置与依据

### A 类：穷举表与闭包（4 条）

1. **`c_4a_terrain_catalog` 全键覆盖（103 → 115）**  
   成因：WIP 加入 12 个新枚举成员后，穷举计数仍停在 V-2b-8 的 103。处置：按既有沿革格式记录 12 个成员，并把精确值改为 115；`RUBBLE` 已在 V-2b-7 存在，不重复计数。
2. **`r_1_appearance` 全成员覆盖（103 → 115）**  
   成因相同。外观映射已覆盖 12 个成员，但精确计数仍为 103；本轮把计数同步为 115。
3. **`c_4a_0_layer_model` 归属层与优先级全等表**  
   成因：生产表已有 12 条，测试中的两张独立全等表没有同步。处置：逐条补入 `TERRAIN_HOME_LAYER` 与 `DRAW_PRIORITY` 期望；依据为 CE `Globals.c:324,326,344,358,390,421,554,563,565,576-578` 以及相应 DF layer 列。
4. **`c_4b` E2 闭包集合差 3**  
   实测集合差为目录独有 `DF#50/195/197`：`DF_ECTOPLASM_DROPLET`、`DF_DARK_FLOOR`、`DF_HAUNTED_TORCH`。后两者是尚未迁为 `TerrainType` 的过渡 tile 的合法 promote 终点；`DF_DARK_FLOOR` 又以 subsequentDF 合法带入 #50（CE `Globals.c:885-888`）。处置：把 #195/#197 作为同组状态入口加入静态起点，仍以集合全等而非包含关系守卫，#50 由链展开自动进入。

### B 类：新地形可通行性（2 条）

5. **`terrainAllowsMove ≡ 旧排除清单` 的 `MUD_WALL` 失败**  
6. **`Game.canMoveTo ≡ 旧排除清单` 的 `MUD_WALL` 失败**  

成因不是生产 flags 错，而是“旧清单等价”测试未把迁移后新增的阻挡成员排除并交给 CE 正向断言。CE `Globals.c:577` 的 `MUD_WALL` 是 `T_OBSTRUCTS_EVERYTHING`，必含 `T_OBSTRUCTS_PASSABILITY`，所以应不可通行。处置：加入 `POST_LEGACY_TILES`，没有篡改生产数据或旧清单。

同批 12 条逐一核对后，另有三条同类：`ELECTRIC_CRYSTAL_OFF`（`Globals.c:563`，四个阻挡位）、`TURRET_LEVER`（`:565`，`T_OBSTRUCTS_EVERYTHING`）、`HAUNTED_TORCH_DORMANT`（`:344`，`T_OBSTRUCTS_EVERYTHING`），一并加入。`LAVA_RETRACTABLE`（`:421`）只有 `T_LAVA_INSTA_DEATH` 而无 PASSABILITY，`CHASM_WITH_HIDDEN_BRIDGE`（`:554`）只有 `T_AUTO_DESCENT`，其余六条也没有 PASSABILITY；它们不属于同类，继续留在旧等价论域内以捕获误加阻挡位。

### C 类：目录边界与缺 tile 镜像（5 条）

7. **`c_4b` E5 的 DF#21x 未登记合同**  
   WIP 把检查对象从 218 改成 219，却仍调用 `catalogFeature(218)`，断言内部自相矛盾。#218 `DF_STENCH_SMOLDER` 是合法闭包成员：`MUD_FLOOR.fireType`（CE `Globals.c:576`）直接引用它，且目录行 `Globals.c:930` 再链到 `DF_PLAIN_FIRE`。处置：保留 #218，边界守卫统一检查未授权的 #219 `DF_STENCH_BURN`；没有放宽“未登记 id 必须失败”的合同。
8. **`g_2` 的 DF#159 不得提前入目录**  
   旧注把 159 误称为 `DF_PARALYSIS_GAS_CLOUD_POTION`；按 CE `Rogue.h:1675-1677` 的枚举数序，#158/#159/#160 实为 `DF_SPREADABLE_WATER / DF_SHALLOW_WATER / DF_WATER_SPREADS`。#159 是本轮水扩散闭包的合法成员（CE `Globals.c:827-830`），因此从“未授权”列表移除；#218 同理由 `MUD_FLOOR` 合法引入。其余九个 id 的 undefined 边界守卫原样保留。
9. **`g_2` 的 `DF_MISSING_TILES` 长度镜像**  
10. **`v_2b_3` 的长度镜像**  
11. **`v_2b_5` A3 的长度镜像**  
   三者共同成因是公共清单由 31 变为 53：WIP 新抄录的 32 条 DF 中 22 条中间态尚无本轮授权的 web tile。三处同步到精确值 53，仍不放宽为下限或只做 contains。任务书所说 RUBBLE 解堵已在本分支更早的 V-2b-7 完成：`DF_SHATTERING_SPELL / DF_WALL_SHATTER / DF_STATUE_SHATTER` 当前均已接 `TerrainType.RUBBLE` 且不在缺 tile 清单；本轮没有把它们重新加入。因此相对于本轮实际 WIP 的 31，净变化是 +22，而不是重复执行历史上的 -3。

## 2. 基线自检

最终状态下执行 `npm run test:drift`：1 个文件、1 个测试通过。没有修改或重捕获 `src/test/fixtures/generation_baseline.json`，证明补完只修正数据守卫与测试穷举表，没有移动生成流。

## 3. §3 最终复跑声明

**时间点：全部代码、测试与本报告编辑完成之后；也是提交前执行的最后一步。以下是最终状态下的运行结果，不是中途快照。**

授权清单逐文件结果：

| 文件 | 结果 |
|---|---|
| `src/test/v_2b_9a_carriers.test.ts` | 通过 |
| `src/test/c_4a_terrain_catalog.test.ts` | 通过 |
| `src/test/c_4a_0_layer_model.test.ts` | 通过 |
| `src/test/c_4b_dungeon_feature.test.ts` | 通过 |
| `src/test/c_7_lighting.test.ts` | 通过 |
| `src/test/r_1_appearance.test.ts` | 通过 |
| `src/test/g_2_gas_df_wiring.test.ts` | 通过 |
| `src/test/p1_42_secret_door_search.test.ts` | 通过 |
| `src/test/invented_content_pool.test.ts` | 通过 |
| `src/test/p1_30_i18n_gate.test.ts` | 通过 |
| `src/test/v_2b_3_wired.test.ts` | 通过 |
| `src/test/v_2b_5_dormant.test.ts` | 通过 |

附加门禁：`npm run test:drift` 通过；`npm run build` 通过。未跑文件：无。未执行任务书禁止的不带文件参数的全量 `npx vitest run`。

## 4. 授权反驳与改动申报

- **反驳/纠正**：任务书把 RUBBLE 描述成本轮才落地，但当前分支的生产目录和既有测试均记录它已于 V-2b-7 落地；本轮尊重现状，不重复建成员，也不把三条已解堵 DF 重新计入缺 tile。
- **反驳/纠正**：旧 `g_2` 注释声称 DF#159 是麻痹药水云；CE 枚举证明 #159 是 `DF_SHALLOW_WATER`，本轮水扩散闭包合法需要它。
- **边界守卫未放宽**：#218 与 #159 仅因可证明的 CE 引用进入授权闭包；#219 及其余未抄录 id 继续得到 `undefined`/“未抄录”错误；E2 继续要求集合全等。
- 清单外改动：仅新增任务书要求的 `ai_docs/reports/v-2b-9a-finish.report.md`。未改 `src/data/blueprints.json`、`src/test/fixtures/generation_baseline.json` 或只读的 `BrogueCE-master/`。
