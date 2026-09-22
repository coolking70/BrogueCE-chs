# V-2b-9c 闪电 / 黑暗 / 泥潭轮

## 1. 交付与闭包自查

四条 CE 蓝图 32/51/52/54 已登记，全部 `category: key_guard`；32/51/54 可进入领养池，52 按引擎资格过滤退池留形。没有修改它们的 CE frequency 或 flags 来退池。七个效果地形落地，地形枚举 126 → 133，缺 tile DF 清单 39 → 32。

闭包方法：先在只读 CE `Globals.c` 中查找目标 DF 及其 tile 的全部引用，核对上游地形 `promoteType/fireType`，再递归沿 DF `tile/propagationTerrain/subsequentDF` 和产物地形的 `promoteType/fireType` 展开。新测试把七条填活 DF 作为起点，反查所有引用它们的上游地形，递归检查下游的目录存在性、缺 tile 登记、`catalogFeature` 转换，并对闭包内每个地形实跑普通晋升和 fire 晋升，要求 `deferred === null`。`c_4b` 原有全目录闭包等式继续保留，黑暗/火炬终态起点改由真实中间地形自动供给。

找到并关闭 **7 个缺失 tile 的门**：

| 新地形 | CE Globals.c | 填活 DF |
|---|---:|---|
| MACHINE_MUD_DORMANT | 434 | DF_MUD_DORMANT (:891) |
| DARK_FLOOR_DARKENING | 359 | DF_DARKENING_FLOOR (:885) |
| DARK_FLOOR | 360 | DF_DARK_FLOOR (:886) |
| ECTOPLASM | 468 | DF_ECTOPLASM_DROPLET (:673) |
| HAUNTED_TORCH_TRANSITIONING | 345 | DF_HAUNTED_TORCH_TRANSITION (:887) |
| HAUNTED_TORCH | 346 | DF_HAUNTED_TORCH (:888) |
| ELECTRIC_CRYSTAL_ON | 564 | DF_ELECTRIC_CRYSTAL_ON (:895) |

上游 DARK_FLOOR_DORMANT / HAUNTED_TORCH_DORMANT / ELECTRIC_CRYSTAL_OFF 已存在。本轮没有漏掉火炬链；泥潭实际使用的是 MACHINE_MUD_DORMANT，不是名字相近的 MUD_FLOOR/MUD_WALL/MUD_DOORWAY。后者的 DF_STENCH_SMOLDER 缺口与 51 号无关，继续显式登记。

## 2. 四条蓝图与 CE 对照

引用文件为 `BrogueCE-master/src/variants/GlobalsBrogue.c`。新增测试直接读取只读 CE 四个原始段落，对比名称、深度、面积、频率、feature 数、全部蓝图 flags，并逐 feature 对比 DF、terrain、layer、数量、最小数量、怪物、personalSpace、hordeFlags、feature flags。

| CE 编号 | CE 行 | web id | 深度 / 面积 / frequency | category / 池状态 |
|---|---|---|---|---|
| 32 | 383–389 | key_fire_trap_room | 4–26 / 80–180 / 6 | key_guard / 入池 |
| 51 | 509–513 | key_mud_pit | 12–26 / 40–90 / 10 | key_guard / 入池 |
| 52 | 514–520 | key_electric_crystals | 6–26 / 40–60 / 10 | key_guard / 退池留形 |
| 54 | 531–536 | key_haunted_house | 16–26 / 45–150 / 10 | key_guard / 入池 |

52 的三个水晶、笼祭坛、7–9 个炮塔拉杆、MK_SPARK_TURRET 与休眠旗标均按 CE 保留。数据没有通过删除炮塔、换普通祭坛或把频率设零来伪造可解性。

## 3. 三族机制与事实纠正

### 闪电

触发源实际在 **CE Items.c:5455–5465** 的 `BF_ELECTRIC → exposeTileToElectricity`，逐层晋升在 **Time.c:1289–1303**；不是任务书猜测的 Combat.c/Architect.c。开始时 web `Combat/Bolt.ts` 没有 promoteTile 引用，玩家实际施法消费在 `Game.applyBoltEffect`，怪物在 `Game.castMonsterBolt`。

新增共享的 `exposeBoltPathToElectricity`，仅 LIGHTNING/SPARK 命中格逐层消费 TM_PROMOTES_ON_ELECTRICITY，复用既有晋升与断路器机制。SPARK 的电属性来自 GlobalsBrogue.c:82。玩家和怪物两条真实执行路径均接入；电击射线包含水晶命中格，并在阻挡地形处停止，不会越过水晶继续伤害其后的目标。地形改变后刷新光照。

两个同机水晶的测试不调用回合晋升、不手动 promote：非电 bolt 不触发；第一次雷击只亮命中的水晶，离线水晶保持 OFF、笼保持关闭；第二次命中最后一个水晶才通电开笼。笼实际变成 **ALTAR_INERT（web ALTAR）**，依据 Globals.c:812 DF_CAGE_DISAPPEARS；不是 ALTAR_CAGE_OPEN。水晶永久光已由 CRYSTAL_WALL_LIGHT 消费；CE CHARGE_FLASH_LIGHT 瞬时 flare 保留在 DF 数据，通用 flare 渲染仍是既有未接线边界。

### 黑暗

Globals.c:358–360：休眠地板 wired 晋升为 DARK_FLOOR_DARKENING，按 `promoteChance=1500`（15%）成为 DARK_FLOOR；终态携带 DARKNESS_CLOUD_LIGHT。火炬按 :344–346 转换，过渡机会为 2000（20%），终态是 HAUNTED_TORCH_LIGHT。

LightCatalog 已有负光 RGB=(-20,-20,-20)、半径 500、穿透生物的条目（Globals.c:1011），可由 Game.updateVision/LightMap 直接消费，无需修改光照目录或另造黑暗状态。实测邻格光强和 **311 → 0**，移动判据保持可通行。

纠正既有 DF_ECTOPLASM_DROPLET：正确位置是 **Globals.c:673**，参数 **0/0**；原目录写成 :670 和 100/50，误抄了别的条目。DF_DARK_FLOOR 在每个完成晋升的格唤醒怪物，并经 subsequentDF 放下单格 ectoplasm。建造并实化 54 号后，通过实际 pickup 再驱动正常晋升更新，**5 只休眠幽灵全部唤醒**，地板/ectoplasm/幽灵火炬终态均实测出现。

### 泥潭

Globals.c:891–892：DF_MUD_DORMANT 放 MACHINE_MUD_DORMANT，后者 wired 晋升到 DF_MUD_ACTIVATE，放回 MUD 并带 DFF_ACTIVATE_DORMANT_MONSTER。沿用 V-2b-5 的 Game 绑定回调、唤醒表迁移和占位避让；本轮补齐 Game 的 `SPAWNS_IN_TERRAIN.MACHINE_MUD_DORMANT`，使 horde 地形匹配不再先失败重抽 50 次后依赖最后一次兜底生成。

端到端测试使用原样 51 号 features、真实 applyBlueprint、真实 populateLevel，固定合法房间以隔离选址，然后实际执行 `handlePlayerAction('pickup')`。实测 **3 只休眠泥潭怪 → 3 只活怪**，原格液体变 MUD，玩家仍在祭坛取钥匙位置、持有钥匙且出口可达。不是仅调用唤醒函数的单元测试。CE 唤醒依据 Architect.c:3487–3496 / Monsters.c:4156–4210，既有唤醒 200 tick 反应时间由 v_2b_5 守卫继续覆盖。

## 4. 可解性与退池

- **32**：到普通祭坛取钥匙，不需要解笼或通电。原样建造至少 20 个火陷阱，测试对入口→祭坛与祭坛→出口两方向都使用排除 T_PATHING_BLOCKER 的路径，明确避开陷阱、深水、火、岩浆、坠落地形；实际取钥匙后仍存活。实际战斗与误踩陷阱当然仍可致死，未声称任意走法都安全。
- **51**：拾取时玩家站在 ALTAR_SWITCH，怪物在泥格唤醒；MACHINE_MUD_DORMANT/MUD 均不阻挡通行。测试取钥匙前后均能连接出口，唤醒不会把出口改成墙。玩家有既有唤醒延迟的反应窗口。
- **52**：web 有 staff_of_lightning（arcana.json，frequency=15）；wand_of_lightning 是保留但 excludeFromGeneration 的自创数据。随机法杖不能保证同层供给。更关键的 CE 反驳是 **52 自带 SPARK 炮塔**，并未配发闪电物品（:520）。CE Movement.c:1151–1160 可撞击带 ON_PLAYER_ENTRY 的阻挡地形拉杆，web 尚无该撞墙分支；另外 canReceiveAdoptedItem 和物品实化闸都会拒绝闭笼落点。故在 `blueprintQualifies` 明确过滤 CE52，frequency=10 与原始 flags 完整保留。现只宣称闪电开笼机制已验证，不宣称该蓝图已经可自然生成并解完。
- **54**：钥匙先可达，取走后才逐格变暗。远处出口不保证仍有可见光；实测可以完全黑到 0。黑暗改变光照/可见性，Game.canMoveTo 依赖地形通行/深水旗标，不依赖 isVisible。已经走过的路径可沿原路退出；测试确认黑暗前后物理路径保留。记忆显示仍受项目既有渲染行为约束。

生成流还暴露了**既有 CE55**的死局：seed777/D19，reward_commutation 的锁 `(33,19)`，匹配钥匙 `(25,4)` 被 key_worm_tunnels（machine #3，门 `(54,7)`）放在 GRANITE/WORM_TUNNEL_MARKER_DORMANT 后。其 WALL_LEVER_HIDDEN 与活动隧道 DF 仍缺 tile，无法打开。依据 CE GlobalsBrogue.c:537–544，按同样口径在 `blueprintQualifies` 过滤 key_worm_tunnels，数据未改。这是旧缺口被新 RNG 流揭出，不把原因归咎于泥潭/黑暗。55 的既存 BP_MAXIMIZE_INTERIOR 数据缺口仍属后续轮，不在此借机修改。

## 5. 守卫与归因

首次授权清单运行 511 条：498 通过、13 失败。其中 10 条是穷举表/名称别名顺延，3 条是行为失败（两条 center 合同、一条钥匙可达性），行为断言未超过任务书的 5 条停止门槛。

- c_4a_0 / c_4a：七地形 home/priority 全等表补齐；133 的精确计数；新增三种阻挡地形不属于迁移前旧白名单，按既有 POST_LEGACY 规则登记，9c 新测试逐字段正向钉死 CE flags。
- r_1：七地形显式登记现有 DEFAULT_LOOK；专用 UI 外观仍是欠账，本轮没有修改 Appearance.ts。该边界不影响已经实测的负光生产与移动。
- c_7：完整 glow 全等表增加七条，非零载体精确集合 27 → 32，三种已有光类别变为真实消费者。
- c_4b / g_2 / v_2b_3 / v_2b_5：缺 tile 精确数量 39 → 32，逐条 null/可转换验证保留。
- c_4b F3：流移后出现 CE36 的 FLOOR+CHASM/HIDDEN_BRIDGE/MACHINE_CHASM_EDGE（seed424242/D9 machine #7），按 :410–411 / DF :843 只增这三种具体合法两层形态；CE32 的 FLOOR+WATER_SHALLOW，以及 FLAMETHROWER_HIDDEN+WATER_SHALLOW+GRASS 也逐字段登记（seed777/D9 machine #7，:387–389 / DF :899–900）。另登记同机的 NOTHING+WATER_SHALLOW+NOTHING+GRASS 精确四层数组（73,17）：DF_GRASS 没带 BLOCKED_BY_OTHER_LAYERS，CE Architect.c:3228/:3232 只在请求时跨层比较优先级。三层上限、GAS 恒空均未放宽。
- v_2b_2a：从四条原始 CE feature 复核精确普查：IMPREGNABLE 38、TREAT_AS_BLOCKING 93、NOT_IN_HALLWAY 68、BUILD_IN_WALLS 30、EVERYWHERE 31、FAR_FROM_ORIGIN 36、BUILD_AT_ORIGIN 48、ADOPT_ITEM 32、GENERATE_HORDE 18、MONSTERS_DORMANT 18；未变旗标保持旧数。
- v_2b_7 G2：补 ALTAR_INERT→ALTAR 的已存在别名；不可领养的闭笼精确集合变为 47/52。原 14 seed 全扫“退池机器不出现”同时覆盖二者，没有移除原 47 号守卫。
- blueprint_center / p1_33：seed42/D23 的 32 号水池可覆盖预先选择的 center `(63,21)`。引擎在全部 features 落完后按最终四层通行性重选最近室内非门格，保留原可通行中心，不改地形、不耗随机数。旧合同断言未改。
- v_2b_6 F1：上述 55 号引擎退池后，多 seed×D1–26 原钥匙可达断言通过，测试未改。
- c_6 的覆盖门一直保留“建得出来”，本轮没有改成零或精确机器台数，也没有为过门更换样本。

中途中心修复曾把字符串旗标 BP_ROOM 误写为未定义变量，造成一轮运行时异常污染；已按任务要求暂停说明、修正、先通过编译再重跑。该中途结果不作为交付证据。

## 6. 对抗性要求

新增 `v_2b_9c_effects.test.ts` 共 10 条，每条头注写明翻红缺陷：

1. CE 逐字段对照：错误频率/类别/旗标、漏炮塔或 feature 数量即红。
2. 55 退池：恢复永久不可达钥匙的候选资格，或改数据来退池即红。
3. 七地形数据：错 flags/home/priority/chance/glow，或再次误抄 ectoplasm 即红。
4. 闭包：漏任何上游门、中间态、subsequent/propagation 载体，或 fire 晋升残留缺口即红。
5. 玩家闪电：非电也触发、首击提前通电、离线水晶顺带亮起、最后一次雷击未开笼均红；完全不运行回合晋升，排除了其他触发路径假阳性。
6. 障碍与 SPARK：穿墙电击、漏怪物电击触发、穿过水晶伤害后方玩家均红。
7. 泥潭：只生成休眠指令而没实化、错 horde 地形、拾取 wired/唤醒回调未接、泥变墙均红。
8. 鬼屋：缺中间态/终态/ectoplasm 后继 DF、概率驱动没接、幽灵仍留休眠表均红。
9. 火陷阱房：真实数量下建不成、center 在深水、取钥匙或退出必须经过危险格均红。
10. 负光：只改地形名字而没实际变暗，或把光照当碰撞条件均红。

## 7. 基线与最终验证

基线只在引擎/数据/测试修正全部结束后重捕获，保持原四种子、D1–D26 与 fp/n/species/items 四字段口径。成因分离：32/51/54 候选与实际建造改变生成 RNG；55 的旧死局退池改变选择流；泥潭 horde 真实地形匹配改变其重抽流。52 虽保留 CE 数据，但资格过滤不参与随机抽签。玩家雷击与黑暗随机晋升发生在交互期，捕获不执行这些动作；负光本身不抽主随机数。center 修复是最终几何元数据修正，不移动特征、不额外掷骰。

重捕获实测：104 层中 56 层改变；地形指纹 56、活怪数 51、物种集合 56、物品数 51，共 214 个字段变化。四种子顺序与原基线保持一致。捕获探针另记录到 seed31337/D21 自然生成 key_mud_pit，休眠怪 3 只；本轮对 32/54 的玩法证据来自固定合法场地的真实建造/实化/拾取链，不把该四种子样本中未观测到的蓝图谎报为自然覆盖。

最终验证命令：`npm run build`；`npm run test:drift -- --maxWorkers=1 --reporter=json --outputFile=/tmp/v9c-final-drift.json`；`npx vitest run` 后逐个显式传入 §4 的 33 个 `.test.ts` 路径，并加 `--maxWorkers=3 --reporter=json --outputFile=/tmp/v9c-final.json`。未运行无参数全量 vitest。最终复跑开始前保存全部 src 文件（含测试和 fixture）的 SHA-256，结束后复核，保证提交给最终复跑的状态未被中途编辑。

`npm run build` 已通过（Vite 的现有大 chunk 提示不影响退出码 0）；`test:drift` 已通过，1 文件 / 1 用例，14.15 秒。授权清单最终汇总见 §9。

## 8. 改动范围

生产代码、blueprints.json、基线 fixture 与所有变更测试均在 §4 授权名单内；本报告为 §7 指定产物。清单外持久文件改动：**无**。BrogueCE-master 只读未改。探针、捕获脚本和原始测试日志仅放 /tmp；本地 node_modules 从原仓库复制用于独立运行，未提交依赖或改 package/lock 文件。

## 9. §5 最终复跑结果

**这是最终状态下的运行结果，不是中途快照。**

在最后一次源码、测试、数据和基线编辑完成后，重新运行全部授权文件：**33 文件通过，521 用例通过，0 失败，0 跳过**，墙钟 402.94 秒。最终构建与 drift 也均通过。复跑前后全部 src 文件的 SHA-256 及文件集合完全相同；之后只补写本报告的结果。原始汇总保存在 `/tmp/v9c-final.json`、`/tmp/v9c-final-drift.json`，构建日志 `/tmp/v9c-final-build.log`。

| 授权文件（src/test/） | 结果 | 用例通过数 | 文件耗时（秒） |
|---|---|---:|---:|
| [b_4b_item_placement.test.ts](../../src/test/b_4b_item_placement.test.ts) | PASS | 15 | 71.86 |
| [blueprint_center.test.ts](../../src/test/blueprint_center.test.ts) | PASS | 5 | 52.30 |
| [c_4a_0_layer_model.test.ts](../../src/test/c_4a_0_layer_model.test.ts) | PASS | 20 | 80.91 |
| [c_4a_terrain_catalog.test.ts](../../src/test/c_4a_terrain_catalog.test.ts) | PASS | 30 | 66.29 |
| [c_4b_dungeon_feature.test.ts](../../src/test/c_4b_dungeon_feature.test.ts) | PASS | 31 | 1.88 |
| [c_4c_promotion.test.ts](../../src/test/c_4c_promotion.test.ts) | PASS | 21 | 36.44 |
| [c_6_autogenerators.test.ts](../../src/test/c_6_autogenerators.test.ts) | PASS | 17 | 7.55 |
| [c_7_lighting.test.ts](../../src/test/c_7_lighting.test.ts) | PASS | 25 | 2.35 |
| [c_8_connectivity.test.ts](../../src/test/c_8_connectivity.test.ts) | PASS | 7 | 107.57 |
| [g_2_gas_df_wiring.test.ts](../../src/test/g_2_gas_df_wiring.test.ts) | PASS | 17 | 1.71 |
| [invented_content_pool.test.ts](../../src/test/invented_content_pool.test.ts) | PASS | 7 | 72.25 |
| [p1_20_item_placement.test.ts](../../src/test/p1_20_item_placement.test.ts) | PASS | 1 | 17.62 |
| [p1_26_invariants.test.ts](../../src/test/p1_26_invariants.test.ts) | PASS | 5 | 65.08 |
| [p1_30_i18n_gate.test.ts](../../src/test/p1_30_i18n_gate.test.ts) | PASS | 16 | 3.07 |
| [p1_31_35_placement_snapshot.test.ts](../../src/test/p1_31_35_placement_snapshot.test.ts) | PASS | 10 | 6.70 |
| [p1_33_machine_chokepoint.test.ts](../../src/test/p1_33_machine_chokepoint.test.ts) | PASS | 7 | 75.38 |
| [p1_37_machine_flag_i18n.test.ts](../../src/test/p1_37_machine_flag_i18n.test.ts) | PASS | 8 | 45.64 |
| [p1_42_secret_door_search.test.ts](../../src/test/p1_42_secret_door_search.test.ts) | PASS | 14 | 32.16 |
| [r_1_appearance.test.ts](../../src/test/r_1_appearance.test.ts) | PASS | 45 | 0.01 |
| [v_1a_blueprint_items.test.ts](../../src/test/v_1a_blueprint_items.test.ts) | PASS | 8 | 37.89 |
| [v_1b_alternative.test.ts](../../src/test/v_1b_alternative.test.ts) | PASS | 9 | 0.50 |
| [v_1c_machine_structure.test.ts](../../src/test/v_1c_machine_structure.test.ts) | PASS | 12 | 14.83 |
| [v_2a_vestibule_return.test.ts](../../src/test/v_2a_vestibule_return.test.ts) | PASS | 3 | 49.49 |
| [v_2b_2a_placement_flags.test.ts](../../src/test/v_2b_2a_placement_flags.test.ts) | PASS | 27 | 1.32 |
| [v_2b_2b_blueprints.test.ts](../../src/test/v_2b_2b_blueprints.test.ts) | PASS | 24 | 37.05 |
| [v_2b_3_wired.test.ts](../../src/test/v_2b_3_wired.test.ts) | PASS | 28 | 0.02 |
| [v_2b_4_altars.test.ts](../../src/test/v_2b_4_altars.test.ts) | PASS | 36 | 55.62 |
| [v_2b_5_dormant.test.ts](../../src/test/v_2b_5_dormant.test.ts) | PASS | 17 | 15.89 |
| [v_2b_6_keys.test.ts](../../src/test/v_2b_6_keys.test.ts) | PASS | 18 | 86.02 |
| [v_2b_7_features.test.ts](../../src/test/v_2b_7_features.test.ts) | PASS | 22 | 148.31 |
| [v_2b_9a_carriers.test.ts](../../src/test/v_2b_9a_carriers.test.ts) | PASS | 2 | 0.00 |
| [v_2b_9b_environment.test.ts](../../src/test/v_2b_9b_environment.test.ts) | PASS | 4 | 0.01 |
| [v_2b_9c_effects.test.ts](../../src/test/v_2b_9c_effects.test.ts) | PASS | 10 | 1.31 |
