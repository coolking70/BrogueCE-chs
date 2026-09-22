# V-2b-9d dungeonProfile：13/14

## 1. 复核与事实纠正

§2 的三个可复用部分基本成立：两条 profile 的频率数组及 corridorChance 是纯数据，MAXIMIZE 复用扩张器的参数 1，attachRooms 的四参数签名可直接使用。额外接线包括 BlueprintDef.dungeonProfile、从 BlueprintEngine 调用 Architect 的重建器，以及 scratch 环路入口。两条 profile 不经过深度调整。

另外，原有 choke 计数封顶 181 必须随两条蓝图 roomSize 上沿 200 提升到 201（p1_33 c2 元守卫）。不改时 >200 的大口袋可能被截成 181，错误落入 [100,200]，而不只是“选不到房间”。本轮同步上调，元守卫本身仍要求 CAP 大于全表最大房间上沿。

“真活只有 redesignInterior”低估了地形闭包：MUD_FLOOR.fireType 的 STENCH_SMOKE_GAS 缺载体；MACHINE_GLYPH.promoteType 的 MACHINE_GLYPH_INACTIVE 缺载体，后者又需要 DF_ACTIVE_GLYPH 回环。新增两个地形与一个 DF，填活两个原有 DF。缺 tile 清单 32 → 30；DF 目录 133 → 134；地形 133 → 135。

纠正任务 §3：CE Architect.c:759–763 记录 interior 邻格的坐标，置 -1 的却是当前 exterior 格 `grid[i][j]`，随后 break，只记录第一个合格邻格。任务文字要求将“那个 interior 邻格”置 -1，与原码不符。本轮采用 CE 原码。

发现既有抄录错误：DF_STENCH_SMOLDER 应对应 Globals.c:931，subsequentDF 是 DF_EMBERS；旧目录的 :930 / DF_PLAIN_FIRE 实际属于紧邻的 DF_STENCH_BURN。该错误与 9c 的 ectoplasm 错行同类，本轮修正。

## 2. 五步落地与孤儿数组

1. Architect.redesignInterior 构造 0/1/-1 scratch；origin 为 1。外部可走/密门/钥匙门/连层地形按 CE 四层旗标判据处理，屏蔽外部孤儿门，按 UP/DOWN/LEFT/RIGHT 记录首个 interior 邻格。
2. 原有 attachRooms 传入原始 profile、40、40；没有复用 carveDungeon 的 35/35 常量，也没有应用深度曲线。
3. 每个孤儿重新建立多源 Dijkstra：interior 内正值为距离 0，其余 30000；内部 cost=1、外部=-2，四向扫描。沿首个严格下降邻格开路；若无下降方向则抛出带坐标错误，对应 CE 的 brogueAssert，避免无限循环。
4. 抽出 addLoopsToWorkGrid，保留全图 Fisher–Yates 洗牌与既有 loopDoorSiteScan；Web addLoops(Grid) 也调用该入口，原有 0/1/2 地牢语义与 RNG 次数不变。不能直接将真实 dungeon Grid 传入：它会重新从旧地形提取布局，丢失刚建好的房间和 -1 屏障。另修正旧扫描器的 cost 映射：CE 是 copyGrid，再替换 0 与 1..30000，负值须原样保留；旧代码将所有非零值映为 cost=1，只适用于过去没有负值的输入。
5. 按层清 SURFACE/GAS，保留 LIQUID；0 写 GRANITE 并从同一 interior Set 删除，正值（含门位 2）写 FLOOR。此步骤位于 SURROUND 之后、IMPREGNABLE 之前，以及 machineNumber 标记和 feature 放置之前。availableCells 与返回 cells 均从修改后的 interior 取得。

orphanList 使用动态数组，保留 CE 的记录顺序与重复项，不截断 20 项。CE 的 pos[20] 无越界检查，第 21 项起越界写栈，属于未定义行为，可能破坏其他局部状态或崩溃。测试用 30 个外部接口验证超过 20 仍全部接回。

## 3. CE 蓝图逐 feature 对照

原表：BrogueCE-master/src/variants/GlobalsBrogue.c:264–288。两条均 category=reward，frequency=15，roomSize=[100,200]，完整保留 BP_ROOM | BP_REWARD | BP_MAXIMIZE_INTERIOR | BP_REDESIGN_INTERIOR。13 的深度为 5–15，14 为 10–23。itemFlags 的 ITEM_KIND_AUTO_ID 作为原列保留；Web 既有物品消费端尚无此旗标的自动种类识别入口，本轮没有改动 Game/ItemLoader。

新测试直接读取只读 CE 原表，逐字段对比全部 19 条的 DF、terrain、layer、数量、最小数量、物品类别/种类、怪物、间距、hordeFlags、itemFlags、feature flags，而非只核对 feature 数。

| 13 feature / CE 行 | 地形/DF | 数量 / 最低 | 内容与旗标 |
|---|---|---|---|
| 0 / 266 | MUD_FLOOR DUNGEON | 0–0 / 0 | EVERYWHERE |
| 1 / 267 | MUD_DOORWAY DUNGEON | 1 / 1 | BUILD_AT_ORIGIN；间距 1 |
| 2 / 268 | MUD_WALL DUNGEON | 1 / 100 | BUILD_IN_WALLS、EVERYWHERE；间距 1 |
| 3 / 269 | PEDESTAL DUNGEON | 1 / 1 | 附魔卷轴、哥布林领主；GENERATE_ITEM、MONSTER_SLEEPING、ALTERNATIVE、TREAT_AS_BLOCKING、NOT_IN_HALLWAY、FAR_FROM_ORIGIN；间距 2 |
| 4 / 270 | PEDESTAL DUNGEON | 1 / 1 | 生命药水、哥布林领主；与上条相同旗标，二选一 |
| 5 / 271 | 无 | 5–8 / 5 | HORDE_MACHINE_GOBLIN_WARREN；GENERATE_HORDE、NOT_IN_HALLWAY、MONSTER_SLEEPING；间距 2 |
| 6 / 272 | 无 | 2–3 / 2 | WEAPON\|ARMOR；GENERATE_ITEM、TREAT_AS_BLOCKING、NOT_IN_HALLWAY；间距 1 |
| 7 / 273 | DF_HAY | 10–15 / 1 | NOT_IN_HALLWAY；间距 1 |
| 8 / 274 | DF_JUNK | 7–12 / 1 | NOT_IN_HALLWAY；间距 1 |

| 14 feature / CE 行 | 地形/DF | 数量 / 最低 | 内容与旗标 |
|---|---|---|---|
| 0 / 277 | MARBLE_FLOOR DUNGEON | 0–0 / 0 | EVERYWHERE |
| 1 / 278 | CRYSTAL_WALL DUNGEON | 0–0 / 0 | BUILD_IN_WALLS、EVERYWHERE |
| 2 / 279 | PEDESTAL DUNGEON | 1 / 1 | 附魔卷轴；GENERATE_ITEM、ALTERNATIVE、TREAT_AS_BLOCKING、NOT_IN_HALLWAY、FAR_FROM_ORIGIN；间距 2 |
| 3 / 280 | PEDESTAL DUNGEON | 1 / 1 | 生命药水；与上条同旗标，二选一 |
| 4 / 281 | MACHINE_GLYPH DUNGEON | 30–35 / 20 | PERMIT_BLOCKING；间距 1 |
| 5 / 282 | STATUE_INERT DUNGEON | 3–5 / 3 | SENTINEL；TREAT_AS_BLOCKING、NOT_IN_HALLWAY；间距 2 |
| 6 / 283 | STATUE_INERT DUNGEON | 10–15 / 8 | SENTINEL；BUILD_IN_WALLS；间距 2 |
| 7 / 284 | 无 | 4–6 / 4 | GUARDIAN；TREAT_AS_BLOCKING；间距 1 |
| 8 / 285 | 无 | 0–2 / 0 | WINGED_GUARDIAN；TREAT_AS_BLOCKING；间距 1 |
| 9 / 286 | 无 | 2–3 / 2 | SCROLL\|POTION；GENERATE_ITEM、TREAT_AS_BLOCKING、NOT_IN_HALLWAY；间距 1 |

怪物别名采用既有数据：MK_GOBLIN_CHIEFTAN → goblin_warlord，MK_GUARDIAN → stone_guardian，其余去 MK_ 小写。物品别名为 scroll_of_enchantment / potion_of_life。沿用既有 DF_HAY→GRASS、DF_JUNK→BONES 的 Web 载体映射，本轮没有另造 HAY/JUNK 美术与燃烧语义。新两地形的专用 Appearance 分支仍是既有 UI 欠账；符文 DIM/BRIGHT 光已接入现有 LightCatalog。腐臭烟雾的类型、体积、快速消散旗标及火晋升链已接通；Game 尚无 T_CAUSES_NAUSEA 的症状消费，这项既有玩法缺口没有在禁改文件中另行实现。

## 4. 可解性与范围

奖励落位发生在重建与 interior 收缩之后，只有最终房间地板参与落位。两条原样蓝图通过真实 applyBlueprint → populateLevel → pickup 验证：奖励实际存在，奖励格到 origin 有四向通路，拾取后仍能退出；哥布林领主/哨兵/守卫实际实化。没有将特征改为宽松数量以帮助建成。

孤儿重连在 interior 四向连通且存在 origin 的前提下，为每个记录接口开到已有正值格的最短路，外部格禁止作 Dijkstra 通道。它维持 CE cellIsPassableOrDoor 所描述的接口连通性，不能凭此单独声称 Web 的所有移动图（例如危险液体、后续 feature）必然连通，因此另外保留 c_8 的真实上下楼梯双向可达性门。

最终封顶值下，最初五种子样本只有哥布林巢穴（seed20260913/D6），没有哨兵观测对象；按 §0.3 改用 seed1–30 × D1–D26，保留“两条都至少出现一次”的覆盖要求，探针通过。观测为：

| seed / 深度 | 蓝图 | interior 格 | 物品 | 实化机器怪 |
|---|---|---:|---:|---:|
| 15 / 11 | 13 哥布林巢穴 | 208 | 4 | 27 |
| 17 / 9 | 13 哥布林巢穴 | 344 | 4 | 14 |
| 18 / 13 | 14 哨兵圣所 | 206 | 4 | 22 |
| 24 / 18 | 14 哨兵圣所 | 178 | 4 | 20 |
| 27 / 7 | 13 哥布林巢穴 | 201 | 4 | 10 |

全部奖励指令落点都从入口四向可达；上述数量仅为观测，没有钉精确台数。MAXIMIZE 后的面积可以超过原始选址窗口 200，符合 CE 先选址、再扩张的段序。先前 CAP=181 的观测不作为最终证据。

改动前独立副本 c_8：7 用例通过，30 seed × D1–D25 共 750 层坏层 0。最终对照结果见验证节。

区域机器生长路径未改；65/66 沿用本轮开始时的 frequency=0 退池状态，没有恢复候选资格。注意这两条的既存退池实现就是零频率，并非 blueprintQualifies 显式过滤；本轮不为统一形式越界重写 9e 的内容。

## 5. 对抗断言

新增用例均在头注说明其捕获的实现缺陷。覆盖：原表错抄/错类别/错误别名；闭包缺门；腐臭烟雾错后继；符文不能复位或缺光；origin 清零/错误屏蔽 interior 邻格/35,35/截断孤儿；负值屏障当作路径；只铺地板而不重建；错误 profile 或擅加深度调整；MAXIMIZE 与 OPEN 的优先级；沿用旧 room.cells 导致 GRANITE 参与机器/物品放置；只有生成指令而没有真实奖励与怪物。

两条真实 profile 各用四个 seed，要求确实建出多个房间、留出内部花岗岩、最终 interior 收缩、所有保留内部格从 origin 可达、无走廊、40 次房型抽取且禁用房型零抽取。故全铺 FLOOR、原地不动、错 profile 都不能通过。

## 6. 守卫、生成归因与最终复跑

首轮完整授权门禁 34 文件 / 525 用例：520 通过、5 个元守卫失败，行为守卫 0 失败。具体处理：

- c_7：GLYPH_LIGHT_DIM / BRIGHT 已有真实 terrain 消费者，将两光加入载体精确集合；全 terrain glow 表与非零精确集合一并顺延 32 → 34。
- g_2：STENCH_SMOKE_GAS 从“无 tile”清单摘出，新增 isGasTerrain、DF tile 与 catalogFeature 正向断言；GasType 命名成员仍不存在，原守卫保留。
- p1_33 c2：上调生产计数 CAP 到 201，期望最大 roomSize=200；没有放宽 CAP 必须大于所有房间窗口的条件。
- v_1b：追加四条精确替代条目（两蓝图各附魔卷轴/生命药水），ALTERNATIVE_2 仍零载体。
- v_2b_2a：按原表新增 feature 普查：PERMIT_BLOCKING 46、TREAT_AS_BLOCKING 102、NOT_IN_HALLWAY 78、BUILD_IN_WALLS 33、EVERYWHERE 35、FAR_FROM_ORIGIN 40、BUILD_AT_ORIGIN 49、GENERATE_HORDE 19；其他计数不变。

其余必要顺延：c_4a_0 的 home/priority 全等表增加两地形、按层写入口白名单精确加入 Architect；c_4a/r_1 地形数 135，r_1 显式登记两种 DEFAULT_LOOK；c_4b 目录 134/缺 tile 30，其闭包集合全等仍保留；g_2/v_2b_3/v_2b_5 缺 tile 数顺延；v_2b_3 的符文缓办断言改为真实落地，并保留同机通电、逐层晋升和 RNG 断言。新增测试开发中曾有越界 y 坐标、实体 ID/种类 ID 混用及 PromotionDriver 缺参数，均修正夹具/API 使用，未据此放宽生产断言。

第一次完整门禁中，interior 收缩没有撞断 blueprint_center、p1_33 的行为合同、p1_37 的全扫描 machineCells 往返合同、奖励/钥匙落位或 c_8。首轮新测试的全部十项通过；之后增加第 11 项，独立钉死“只记录首个 NB4 邻格”与 addLoops 的阈值 10。CAP 修正后的重点复跑（12 文件 / 183 用例）全绿。最终全授权结果见下节。

生成流归因：①13/14 进入 BP_REWARD 加权池，改变选蓝图与失败重试 RNG；②原表 Web 既有蓝图没有 MAXIMIZE，故开关对既有蓝图的独立影响为零（新测试精确扫描为 [13,14]）；③新机器按 profile 调用 attachRooms(40,40) 与 scratch addLoops(10)，改变内部几何及生成 RNG；choke CAP=201 是新房间窗口所需的选址修正，同属①的配套。符文重亮和泥地烧出烟雾为交互期链，基线捕获不执行这类动作。

## 7. 改动范围

引擎、数据、测试均限于任务 §7；本报告为 §10 指定产物。BrogueCE-master 只读。运行探针、测试 JSON、日志及改动前副本位于 /tmp；node_modules 从原工作区复制，本轮不改 package/lock。清单外持久改动：无。另逐行对比 Git HEAD 与最终 JSON，原有 78 条蓝图完全相同；仅追加 13/14 两条。


## 8. 最终验证记录

基线在全部源码与测试编辑完成后重捕获，保留原四种子顺序和 D1–D26、fp/n/species/items 四字段口径。104 层中 62 层变化：地形指纹 62、怪物数 59、物种集合 62、物品数 52，共 235 字段。之后已执行 `npm run test:drift`。

最终复跑前，全部 src 文件（含测试与 fixture）共 179 个逐文件计算 SHA-256，清单文件为 `/tmp/v9d-src-before.json`，最终 SHA-256 在运行完成后记录。报告位于 src 外，可在运行结束后补录结果。

最终命令：通过 `/tmp/v9d-files.json` 显式列出 §7 的全部 34 个 `.test.ts` 路径，运行 `./node_modules/.bin/vitest run <34 paths> --maxWorkers=6 --reporter=default --reporter=json --outputFile=/tmp/v9d-final.json`；另跑 `npm run build` 与 `npm run test:drift -- --maxWorkers=1 --reporter=json --outputFile=/tmp/v9d-final-drift.json`。没有运行不带文件参数的全量 vitest。Vite/Vitest 在沙箱中曾触发 macOS `SecItemCopyMatching failed -50` 并崩溃；获准使用正常权限后运行成功，与代码失败区分记录。


最终复跑启动后的一次只读审查发现，新奖励路径夹具使用的 Cell.isPassable 缓存不足以涵盖新地形。已停止该次 Vitest，在编辑前再次核对全部 src 哈希相同，并将旧日志存为 `/tmp/v9d-aborted-final.log`，不作为最终证据。随后把夹具加严为四层 `terrainAllowsMove`，避免路径穿过泥墙、水晶墙或雕像；11 项新测试全部通过。再次重捕获基线后重新冻结并重跑。独立自然生成探针一直使用真实 Game.canMoveTo，未受此夹具问题影响。


**这是最终状态下的运行结果，不是中途快照。**

全部编辑（包括四层路径夹具加严及最后一次基线重捕获）完成后，最终复跑 **34 文件通过、526 用例通过、0 失败、0 跳过**，墙钟 **457.72 秒**。实际执行文件集合与任务 §7 的 34 个文件逐项相等。`npm run build` 通过（Vite 仅有既有 chunk 大小提示）；`npm run test:drift` 通过，1 文件 / 1 用例。

复跑前后 src 的 **179 个文件及文件集合完全相同**，逐文件 SHA-256 清单字节一致。`/tmp/v9d-src-before.json` 与 `/tmp/v9d-src-after.json` 的 SHA-256 均为 `781a446558b9332967745994450e5636ac1c47f8111bfb479d81f5297fe84e6c`。之后仅补写本报告，不再改 src。最终连通性 c_8 依然为 **0/750 坏层，与改动前一致**。机器格、feature 落位与存档往返合同均未放宽。

原始结果：`/tmp/v9d-final.json`、`/tmp/v9d-final-drift.json`、`/tmp/v9d-final-build.log`；自然生成观察为 `/tmp/v9d-natural.json`（30 seeds）与 `/tmp/v9d-natural-five.json`（原五种子）。最终重捕获是在测试加严之后再次执行的，与已有 fixture 逐字节一致；本报告的 62 层 / 235 字段变化仍以本轮开始时的 9c 基线为参照。

| 授权文件（src/test） | 结果 | 通过用例 | 文件耗时（秒） |
|---|---|---:|---:|
| [b_4b_item_placement.test.ts](../../src/test/b_4b_item_placement.test.ts) | PASS | 15 | 149.43 |
| [blueprint_center.test.ts](../../src/test/blueprint_center.test.ts) | PASS | 5 | 88.54 |
| [c_0_add_loops.test.ts](../../src/test/c_0_add_loops.test.ts) | PASS | 14 | 353.06 |
| [c_1_room_profile.test.ts](../../src/test/c_1_room_profile.test.ts) | PASS | 14 | 242.29 |
| [c_4a_0_layer_model.test.ts](../../src/test/c_4a_0_layer_model.test.ts) | PASS | 20 | 147.39 |
| [c_4a_terrain_catalog.test.ts](../../src/test/c_4a_terrain_catalog.test.ts) | PASS | 30 | 113.73 |
| [c_4b_dungeon_feature.test.ts](../../src/test/c_4b_dungeon_feature.test.ts) | PASS | 31 | 3.11 |
| [c_6_autogenerators.test.ts](../../src/test/c_6_autogenerators.test.ts) | PASS | 17 | 12.45 |
| [c_7_lighting.test.ts](../../src/test/c_7_lighting.test.ts) | PASS | 25 | 3.49 |
| [c_8_connectivity.test.ts](../../src/test/c_8_connectivity.test.ts) | PASS | 7 | 217.34 |
| [g_2_gas_df_wiring.test.ts](../../src/test/g_2_gas_df_wiring.test.ts) | PASS | 17 | 2.01 |
| [invented_content_pool.test.ts](../../src/test/invented_content_pool.test.ts) | PASS | 7 | 152.59 |
| [p1_20_item_placement.test.ts](../../src/test/p1_20_item_placement.test.ts) | PASS | 1 | 30.33 |
| [p1_26_invariants.test.ts](../../src/test/p1_26_invariants.test.ts) | PASS | 5 | 111.44 |
| [p1_30_i18n_gate.test.ts](../../src/test/p1_30_i18n_gate.test.ts) | PASS | 16 | 4.95 |
| [p1_31_35_placement_snapshot.test.ts](../../src/test/p1_31_35_placement_snapshot.test.ts) | PASS | 10 | 11.80 |
| [p1_33_machine_chokepoint.test.ts](../../src/test/p1_33_machine_chokepoint.test.ts) | PASS | 7 | 123.40 |
| [p1_37_machine_flag_i18n.test.ts](../../src/test/p1_37_machine_flag_i18n.test.ts) | PASS | 9 | 123.30 |
| [r_1_appearance.test.ts](../../src/test/r_1_appearance.test.ts) | PASS | 45 | 0.02 |
| [v_1a_blueprint_items.test.ts](../../src/test/v_1a_blueprint_items.test.ts) | PASS | 8 | 59.21 |
| [v_1b_alternative.test.ts](../../src/test/v_1b_alternative.test.ts) | PASS | 9 | 0.48 |
| [v_1c_machine_structure.test.ts](../../src/test/v_1c_machine_structure.test.ts) | PASS | 12 | 25.57 |
| [v_2a_vestibule_return.test.ts](../../src/test/v_2a_vestibule_return.test.ts) | PASS | 3 | 89.74 |
| [v_2b_2a_placement_flags.test.ts](../../src/test/v_2b_2a_placement_flags.test.ts) | PASS | 27 | 1.45 |
| [v_2b_2b_blueprints.test.ts](../../src/test/v_2b_2b_blueprints.test.ts) | PASS | 24 | 59.09 |
| [v_2b_3_wired.test.ts](../../src/test/v_2b_3_wired.test.ts) | PASS | 28 | 0.03 |
| [v_2b_4_altars.test.ts](../../src/test/v_2b_4_altars.test.ts) | PASS | 36 | 87.47 |
| [v_2b_5_dormant.test.ts](../../src/test/v_2b_5_dormant.test.ts) | PASS | 17 | 25.68 |
| [v_2b_6_keys.test.ts](../../src/test/v_2b_6_keys.test.ts) | PASS | 18 | 157.87 |
| [v_2b_7_features.test.ts](../../src/test/v_2b_7_features.test.ts) | PASS | 22 | 309.34 |
| [v_2b_9a_carriers.test.ts](../../src/test/v_2b_9a_carriers.test.ts) | PASS | 2 | 0.00 |
| [v_2b_9b_environment.test.ts](../../src/test/v_2b_9b_environment.test.ts) | PASS | 4 | 0.02 |
| [v_2b_9c_effects.test.ts](../../src/test/v_2b_9c_effects.test.ts) | PASS | 10 | 2.37 |
| [v_2b_9d_dungeon_profile.test.ts](../../src/test/v_2b_9d_dungeon_profile.test.ts) | PASS | 11 | 4.74 |
