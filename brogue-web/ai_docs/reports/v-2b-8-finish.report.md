# V-2b-8 补完轮报告

## 0. 结论

本轮承接提交 `3c43c5e WIP(V-2b-8)`，没有推倒重做。验收方列出的 15 条失败已经逐条诊断并处置；其中没有一条要求回滚 V-2b-8 的 MT 接线。修改均为测试合同随 CE 数据/生成流顺延，或修正原测试把“全图”误当“探针”的前提。

## 1. 15 条失败：成因 → 处置 → 依据

### A. 三条穷举表

1. **`c_4a_terrain_catalog` 103 vs 101**：V-2b-8 新增两个枚举成员 `BLOODFLOWER_STALK`、`HAVEN_BEDROLL`（`BONES`、`SACRED_GLYPH` 复用既有成员）。计数 101→103，并在注释中记录增量。
2. **`r_1_appearance` 103 vs 101**：同一成因；穷举表本体已在 WIP 中包含两成员，只更新计数 101→103。
3. **`c_4a_0_layer_model` 全等表**：运行时表已有键 101/102，而手写 oracle 漏了两项。补 `SURFACE` 归属与 draw priority 20/50；依据 CE `Globals.c:513`（stalk）及 `:517`（bedroll）。

### B. 新地形通行性两条

4–5. **`terrainAllowsMove` / `Game.canMoveTo` 的 BLOODFLOWER_STALK 差异**：实现正确，旧迁移等价论域过期。CE `Globals.c:513` 明列 `T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_IS_FLAMMABLE`，所以 stalk 必须不可通行；将其加入“迁移后新增、由 CE 正向字段把关”的排除集合，而不是改实现凑绿。若反过来实现错，会看到 stalk 的 `blocksPassability`/两套移动 API 返回 true；实测没有。

### C. 两条 center 合同（重点诊断）

6–7. **`blueprint_center` 与 `p1_33`**：反例均为 `ce_60_idyll` / `ce_61_swamp` 的 area machine，且 center 最终被 `DF_DEEP_WATER_POOL` 覆盖。

诊断路径：

- JSON 复核：两蓝图都没有 `BP_ROOM`，而是 `BP_NO_INTERIOR_FLAG`。
- CE 分支复核：`Architect.c:1075-1120` 才是 BP_ROOM 的 gate/interior 分支；非 room/non-vestibule 走 `:1145-1205`，origin 从 FLOOR 起步并按距离扩张。后续 feature 可以合法覆盖 origin。
- web 合同复核：历史 center 可通行合同是为了 center 宝藏；但 B-4b 已拆除自创 center 投宝。area origin 并无“最终仍可通行”的 CE 保证。
- 反向检查：若这是 reward/BP_ROOM 实现错，应看到带 `BP_ROOM` 的机器 center 不可通行、center 不在 cells、或 center 与锁门重合；修订后的测试仍对 BP_ROOM 保留全部检查，扫描未见这些现象。

处置是按蓝图 flag（不是按容易漂移的名字）识别 area machine：仍要求 center 属于 cells，但不再套用 BP_ROOM 的“最终可通行/不得与门重合”前提。vestibule 既有豁免不变。12 seeds 扫描与 15 seeds P1-33 均通过。

另外留痕：web 当前非 vestibule 的选址路径仍统一走 gate-room，这与 CE 的独立 area 选址算法并不完全等价；但这不是本次“深水 center”失败能证明的缺陷，也不应靠强行保持 center 可通行来伪装修复。

### D. 覆盖门

8. **`v_2b_7_features` 携钥匙怪观测为 0**：11 号 Vampire lair 没有退池；V-2b-8 强制 thematic 机器合法改变普通机器机会与 RNG 流，使原 6-seed 小样本空转。没有放宽 `carriersSeen >= 1`，改用固定 seed 1..20 × D1–26；真实扫描重新观察到携钥匙怪，且原有可达、非致死落点、`keyLoc` 三重行为断言全部保留并通过。

### E. 其余七条

9. **`c_5` RNG 增量**：换层生成因 MT 机器接线移动，固定增量 10611→10401；怪物位置/存活与“坠落回合不推进”行为断言仍同时把关，故仅重捕获数值。
10. **`c_5` 深水零伤害**：测试只铺一个随机候选格，生成流移动后落到旁边 FLOOR，属于测试选样错误。改为最近切比雪夫环全部铺目标落地地形、外环铺干地（满足深水可游出检查），并清探针区机器标记；深水 0 伤、浅水 4–5 伤重新通过，生产实现未改。
11. **`f_2c` 起火豁免**：`promotions.length` 统计全图，新 thematic 内容让图上另有晋升，错误首行误归为探针失败。改为按坐标检查 (4,4)：第一趟无该格晋升、第二趟有该格晋升并消失；测试更强且不受无关格污染。
12. **`g_2` 2 体积**：该断言把随机扩散的“期望守恒”误写成单样本下界；体积 2 在整数随机舍入中可以全变 0。真正接线合同已由同用例的 `spawn.gasVolumeAdded === 2` 钉死；扩散后改钉不得凭空增加（≤2）并继续核对 gasGrid 镜像。
13. **`p1_37` A−B**：生成流合法移动后，按既有 featureSpawns 反查流程重核为 `['5,14']`，更新全等快照；逐格旗标/存档往返行为合同未放宽。
14. **`v_1a` area_shrine undefined**：蓝图不是缺失，而是 V-2b-8 按 CE 编号改名为 `ce_59_shrine`。测试改查新 id；五类掩码、数量及 `MF_GENERATE_ITEM` 原断言不变。
15. **`v_2b_2a` 旗标载体数**：失败分类只报了第一处。全表复核后同步 V-2b-8 数据事实：TREAT 67→73、NOT_IN_HALLWAY 43→55、FAR 25→26、NEAR 20→18、BUILD_AT_ORIGIN 38→41、IN_VIEW 4→9。NEAR 减少来自拆除自创 `area_shrine` 并换入 CE 59；其余为 58–64/71 的 CE feature。其余计数保持原值。

## 2. 基线重捕获

WIP 已按最终生产实现重捕获 4 seeds × D1–26，fixture note 明记三股成因：正 `bp` 强制形参、MT 回调接线、八蓝图与地形/DF。本补完轮只改测试 oracle，没有再改生产生成流；最后重新运行 `generation_baseline.test.ts`，104 层逐字段与 WIP 捕获值完全一致，因此重捕获结果是**字节上无需变化**。

成因分离仍如实申报“数值上分不开”：本轮窗口用于授权清单全量门禁，没有再做三次完整反事实构建。静态因果仍为：孤立 `bp` 形参无调用时零变化；MT 回调开始消耗生成 RNG；新蓝图成功后地形/DF 才落地。

## 3. 授权反驳

- B 类不是实现应当保持旧移动白名单；CE `Globals.c:513` 明确要求 stalk 挡路。
- C 类错误首行把 BP_ROOM 的 treasure-center 前提泛化到了 area origin；CE 分支结构不支持该泛化。
- `f_2c` 的 “expected 1 to be 0” 是全图计数受新内容污染，不代表 (4,4) 探针违反豁免。
- `g_2` 的 “2 体积不得消失” 对整数随机扩散的单次样本不成立；接线是否吞量应在 spawn 返回点判断。
- `v_1a` 是 id 顺延，不是 shrine 数据丢失。
- `v_2b_2a` 不只一处计数到期；vitest 在首个 expect 停止，必须全表复核。

## 4. §4 授权清单门禁

按“授权清单全部文件”口径执行，不限于本轮改动文件。任务书 §4 又明确把 `b_4a_item_generation`、`c_1_room_profile` 称为清单内重项，虽它们在所引用旧 §3 的正文枚举中漏写，本轮按更严格口径也纳入。

### 已运行

- 本轮 15 条涉及文件：`c_4a_terrain_catalog`、`r_1_appearance`、`c_4a_0_layer_model`、`blueprint_center`、`p1_33_machine_chokepoint`、`v_2b_7_features`、`c_5_fall_subsystem`、`f_2c_explosion`、`g_2_gas_df_wiring`、`p1_37_machine_flag_i18n`、`v_1a_blueprint_items`、`v_2b_2a_placement_flags`。
- 其余授权测试：`c_4b_dungeon_feature`、`c_6_autogenerators`、`c_7_lighting`、`p1_42_secret_door_search`、`invented_content_pool`、`p1_30_i18n_gate`、`p1_20_item_placement`、`p1_31_35_placement_snapshot`、`b_4b_item_placement`、`v_1b_alternative`、`v_1c_machine_structure`、`v_2a_vestibule_return`、`v_2b_2b_blueprints`、`v_2b_3_wired`、`v_2b_4_altars`、`v_2b_5_dormant`、`v_2b_6_keys`、`p1_26_invariants`、`v_2b_8_autogen`、`c_8_connectivity`、`b_4a_item_generation`、`c_1_room_profile`、`generation_baseline`。
- `npm run build`。

### 未运行

无（没有运行禁止的不带文件参数全量 `npx vitest run`）。

## 5. 改动范围

只修改任务授权的测试文件及本报告；`BrogueCE-master/` 保持只读，生产代码与 WIP fixture 未改。
