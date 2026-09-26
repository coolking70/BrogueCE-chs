# X-1：U00–U27、UR 后的 CE 对齐度只读复核

基准：`4292fd3ef79005a3d6b246d1f0aed84e6b787b44`；2026-09-27（Asia/Shanghai）。规格按任务书 §0 指向的 [X-0](x-0-survey.report.md) §2、§3.1、§4.3；权威为本工作树 `BrogueCE-master`。**大量原缺口已有实现和有效守卫，但不能宣布全项目 CE 对齐完成。** 优先剩余项是动画录像 OOS、盟友命中状态误施给玩家、附魔/解除诅咒卷轴、派生地形旗标分裂，以及测试模式退池物品可达。

本轮只新增本报告、`scripts/x1-*` 和 `x-1-evidence/`。未修生产代码、未改现有测试/数据/基线、未重捕获基线、未提交 git。**D27–40 深层生成统一登记“待 U26a 合并后复核”**，不根据当前树已有的深层常量或分支作验收。域编号 D27（RNG）与地下层 D27 不是同一概念。

## 1. 方法、证据和结论口径

从真实入口追到状态消费者，核对本树 CE，读取测试的具体断言，再以隔离副本定向运行既有测试。报告自述仅用于建立待核账本，不能独立证明关闭。遍历了现有 **61 份** `u-*.report.md`（含 `u-r1` 至 `u-r4`），提取 871 行边界线索；逐报告处置见 §5，[原文定位清单](x-1-evidence/report-boundaries.json)保留文件、行号和原文。关键词命中包含历史过程及限制，不能把 871 当成缺陷数。

- **已闭合**：X-0 此条具体缺口已有生产消费路径，且至少抽读一个真正约束它的断言。并不外推成整个子系统完全同 CE。
- **部分**：旧缺口的一部分已关闭，但原条目的剩余语义或已明确登记边界仍在。
- **未闭合**：核心旧问题仍有可达执行路径。**已过期**用于事实已被后续实现或核实推翻的旧债；不把故意不做旧格式兼容写成 bug。
- **缺 / 偏 / 创**分别指 CE 行为无出口、已有但语义不同、web 自定规则。证据不足明确写“未核实”，不按未找到一个测试推断功能不存在。
- X-0 §3.1 实际还有 **K42**；任务明确要求的 K01–K41 全列，另补 K42，避免漏掉 U18a 对应的跨消费者风险。

引用：`G`＝`src/engine/Core/Game.ts`；`M`＝`src/entities/Monster.ts`；`C/`＝`../BrogueCE-master/src/brogue/`；`V/`＝`../BrogueCE-master/src/variants/`。其余生产路径默认省略 `src/engine/`，测试文件默认位于 `src/test/`。行号均针对上述基准。表内箭头表示调用/消费关系，不表示每一步都已做自然场景端到端实测。

验证证据：

| 验证 | 本轮结果与证明边界 |
|---|---|
| 只读隔离 | [stage](x-1-evidence/validation-stage.json)：复制到临时项目，356 个源码/public/构建输入 SHA 一致。构建产物、缓存、测试临时输出在副本；原树全部受版本控制文件另做前后 SHA 比较。 |
| 类型与构建 | `vue-tsc -b`、`vite build` 均退出 0；分别 7.737 秒、4.427 秒。见 [摘要](x-1-evidence/validation-summary.json)、[类型日志](x-1-evidence/typecheck.txt)、[构建日志](x-1-evidence/build.txt)。 |
| 主要定向测试 | [66 文件清单](x-1-evidence/selected-tests.json)，**1286 passed、0 failed、0 pending**，383.349 秒；含 U/UR、退池、i18n、发现/详情、RNG、既有 generation_baseline。[机器结果](x-1-evidence/targeted-results.json)。JSON 的 202 suites 含嵌套 describe，不能称 202 个文件。 |
| 光照与外观补核 | C-7、R-1、UI-1 共 **3 文件、105 passed**，6.190 秒；[结果](x-1-evidence/extra-results.json)。合计 69 个不同测试文件、1391 项通过。没有声称运行全套。 |
| 断言阅读 | `guard-review-*.json` 保存 AST 提取的测试名和 expect 表达式；对 `it.each`、模板测试名再读原文件。§3 每个“已闭合”均列实际断言；不是按文件名盖章。 |
| 运行探针 | [源码](../../scripts/x1-observe.mjs)、[输出](x-1-evidence/runtime-observations.json)：执行原实现，无方法替换或生产变体；合成局面验证因果，不代表自然发生率。另含自然 seed 424242 / D1 派生旗标观察与实际 test 模式生成。 |
| 浏览器 | 全新 Edge 无头上下文，1440×960，正常局 seed 424242，实际中文菜单/发现/背包；[脚本](../../scripts/x1-browser.mjs)、[状态与录像](x-1-evidence/browser-observations.json)，page/console errors 均 0。[游戏](x-1-evidence/browser-game.png)、[发现](x-1-evidence/browser-discoveries.png)、[背包](x-1-evidence/browser-inventory.png)均打开检查。浏览器录像 OOS 是失败发现，不能并入“通过”。 |

测试沿用原有超时、断言和 fixtures。没有注入新反向变体，也没有运行旧报告生成器覆盖历史证据。浏览器及测试子进程因沙箱限制在授权的隔离执行环境启动；没有使用用户浏览器存储。首次浏览器默认 Chromium 缺失，改用本机 Edge，未下载浏览器。探针编写过程中的初始化/类型用法错误修在新增脚本内，未以此改产品。

## 2. D01–D27 域表

| 域 | 当前入口 → 消费者及权威对照 | 复核结果 |
|---|---|---|
| D01 地牢/楼梯/蓝图 | `G:1153 → Core/GenerationCoordinator.ts:142 → Generator/Stairs.ts:11、GenerationCoordinator:333 → Architect.prepareStairLoc`；C/Architect.c:3690 | 原 CE66/SECRET_DOOR/占用/物品品质等具体缺口已承接；**偏**：全生成 RNG 与 CE 非逐骰同构，地形派生旗标仍有自然差异（N05）。D27–40 待 U26a 合并后复核。 |
| D02 多层地形/DF/晋升 | `Map/Promotion.ts → DungeonFeature.spawnDungeonFeature → Grid 绑定 effects`；C/Architect.c:3210、3359 | 原 30 个缺 tile 登记已过期：当前 172 DF、`DF_MISSING_TILES=[]`。**缺**：目录外 lichen、darkness potion、ROT_GAS 不因该数组为空而实现；**偏**：直接 Grid 写口仍不统一派生遮挡。 |
| D03 火/气/环境 | `G` 客观时间 → `Core/TimeCoordinator.ts` → 环境/气体/即时效果；C/Time.c:1289、1590 | 恶心/深水卷物/蛛网已有消费者；STENCH_SMOKE 已承接。**缺**潜没载体、腐败气/lichen 等；**偏**部分死亡集中到批处理，非 CE 立即 killCreature。 |
| D04 光/FOV | `G:2340、2388 → Map/LightCatalog.ts:334、358 → LightMap`；C/Light.c:208、291 | 79 列、戒指/黑暗/水中矿灯、固有光修复有效。**偏**：flare 只影响显示光，不完整临时揭示；FOV 仍读 `cell.isOpaque`，N05 可漏挡；随机颜色口径仍不同。 |
| D05 怪物/horde/突变 | `GenerationCoordinator:41 → spawnHordeAt → new Monster`；C/Monsters.c:797、1080 | 立即实体占用、damage clump、实例保存已补。**缺/偏**：monster item hopper、性别/构造 RNG/随从数量分布并未全 CE；自然目录仍有 legacy onHitStatus。全突变被动效果逐种验收未核实。 |
| D06 AI/追踪/盟友 | `M:151、takeTurn → Combat/MonsterBlink、MonsterAbsorption`；C/Monsters.c:2299、2596、3049 | blink/施法资格/学习/mode 有真链。**偏**：一般 updateMonsterState 仍是 web 调度；盗窃只改逃跑态，无 CE 搬物/永久逃跑完整链；blink 缓存/重算口径保留。 |
| D07 战斗 | `Combat/Combat.ts:201 → G:6110、6272`；C/Combat.c:1193 | 核心近战短路、clump、虚弱、符文时点已修。**偏**投掷仍由伤害字符串重建 clump 并四舍五入；盟友额外状态串写玩家（N02）。 |
| D08 状态/计时 | `Creature → TimeCoordinator → M`，`Status/statusConfig.ts`；C/Rogue.h:1990 | X-0 列出的状态值/maxStatus/计时主要闭合；ENRAGED/LIFESPAN 有真实用途。缺 guardian charm 是来源缺席，不再列 LIFESPAN 无消费者；MB_SUBMERGED 单列 N07。 |
| D09 武器/护甲 | `Items/ItemLoader.ts:1270 → Inventory → G.chooseEnchantTarget`；C/Items.c:7824 | flags、符文生成、实例图保存已修；**偏/创**附魔卷轴只选优先装备、漏力量/次数、额外随机授符文（N03）。 |
| D10 戒指 | `ItemLoader:1454 → Items/RingBonuses.ts → 视野/再生/战斗/充能`；C/Items.c:8685 | 八种生成及有效附魔消费者已接；U15b/b2 具体旧缺口闭合。解除诅咒错误可影响负戒指，属跨类别卷轴 N04，不能称整个戒指生命周期全齐。 |
| D11 护符 | `ItemUseCoordinator.ts:59 → Creature.heal/状态/护盾 → finishItemUse`；V/GlobalsBrogue.c:713 | 原六种效果/曲线已修；**缺另外六种**：levitation、shattering、guardian、teleportation、recharging、negation。K23 部分。 |
| D12 药水 | `G:3600 → statuses/DF`，投掷 `G:5659`；C/Items.c:8063、8185 | life/confusion/已接持续期修复；**缺** lichen 与完整 darkness 投掷 DF。creeping death 喝下仍仅日志，且发现屏错误列出其概率。 |
| D13 卷轴 | `G.readItem → 5172、5182、5467`；C/Items.c:7740、7806、7824 | 碎墙保护、mapping 记忆、充能已承接；**偏/创**附魔、解除诅咒见 N03/N04；全卷轴不能结案。 |
| D14 食物 | `G:3782 → finishItemUse → TimeCoordinator`；C/Items.c:7482、Time.c:949 | 不够饿确认、自动吃、堆叠按份数已补；“芒果应治疗”是旧错误方向，现中文也未再这样宣称。 |
| D15 钥匙 | 机器唯一实例 → `EntitySnapshot` keyLoc/originDepth → 开笼/晋升；C/Items.c:4036 | X-0 字段和重复领养产物已修；整个罕见机器可解性分布未由本轮抽样证明。 |
| D16 杖/魔杖 | 玩家轨迹 + `G.applyMonsterBoltHit` + M 学习/施法入口；C/Items.c:5131 | W 后列出的怪物法伤、web/vines、学习主要有承接。**偏**玩家自反射法伤致死后停止/死亡归因仍有未承接边界，不能用怪物施法测试代替。 |
| D17 生成/鉴定/价值 | 机器候选 → Q 拒绝重掷 → 单实例流转；`Endgame.ts` 消费价值；C/Items.c:171、8861 | 品质、STAFF/WAND、计量保存、符文空槽、CE 结算已修；**偏**发现表不是实际生成资格池；**创**附魔卷轴造符文。 |
| D18 玩家/搜索/潜行/再生 | `Player → RingBonuses → TimeCoordinator`；C/Time.c:792、930 | 戒指、虚弱、营养、搜索已有消费；背包26单位/堆叠已修。**偏**搜索/自动探索/视线仍留旧 opaque/passable 消费（G:9408、9503、9659）。没有依据新增 CE 经验升级或重量惩罚系统。 |
| D19 盟友/死亡/复活 | `G:7590 → release passenger/DF/learning/demotion/purgatory → 9159`；C/Combat.c:1934 | 寄宿/继任/复活/学习有真链；**偏**死亡批处理、落物/复活无候选回退与 CE 距离算法未全齐；盟友命中串写已复现。 |
| D20 换层/跟随 | `GenerationCoordinator:173、195、310 → level state/followers/environment`；C/RogueMain.c:547 | scent、离层时间、跟随与当前种子隔离旧缺口闭合。保留跨层实体落位顺序/构造 RNG 精确性边界，未做全 CE 轨迹逐骰等价。 |
| D21 存档 | `App → G:8283、8328 → WholeRunSnapshot、EntitySnapshot`；C/Recordings.c:1421 | 整世界、对象图/循环引用、状态/计量/两流恢复有强断言。JSON 快照与 CE 录像恢复架构不同属设计差异；不做旧档迁移是明确边界，不能重复派兼容任务。 |
| D22 终局/分数 | `G:10371 → Core/Endgame.ts、HighScores.ts → GameEndOverlay`；C/RogueMain.c:1305 | U26b 计分/价值/高分持久化旧缺口闭合；深层/宝石生成/超胜利地图待 U26a 合并后复核。 |
| D23 录像/种子 | `executeCommand:2591 → recordInputEvent:2575 → replaySeek:2827`；C/Recordings.c | 命令/选物/确认/两流校验已补，但**偏**动画记录时点导致真实新录像首条 OOS；reference overlay 关闭绕过记录（N01）。 |
| D24 UI/详情/帮助 | `Input → ReferenceOverlay → Discoveries/DetailGenerator/MonsterSidebar`；C/IO.c:4198、4650 | 缺屏/侧栏/地形黑格已补；**偏**生成概率、部分能力描述、完整数值详情；测试模式直接显示历史退池物品。 |
| D25 知识/可见性 | `MonsterVisibility → Appearance/Sidebar/render_game_to_text`；Grid memory → snapshot；C/IO.c:1154 | 隐形身份主出口、历史记忆和 MAGIC_MAPPED 已修；**缺**潜没；AgentControls 的 sr-only 调试描述另有隐私/可访问性边界，见 §6。 |
| D26 i18n | `i18n.ts → zh_CN.json → Vue/日志/详情`；CE 中文语义对照 | 中文主要路径实测正常；**偏**动态 OOS 英文避开硬串 AST 门、详情与未实现能力不一致。静态键齐全不代表语义完成。 |
| D27 RNG/确定性 | `Random.ts:76、100 → Core/LevelSeeds.ts:17 → GenerationCoordinator:218、299`；C/Math.c:95、160 | uint64、每层种子、双流保存旧缺口闭合；**偏**CE 生成全程调用序列、显示帧与回放 checkpoint 不等价；固定生成基线和 UR 中性测试不能替代 CE oracle。 |

## 3. K01–K41 结案表（另补 K42）

守卫列记录本轮实际读到的断言含义。`†` 表示读过断言但该文件未列入本轮运行清单；其余引用的 U/UR/本轮补核文件已运行。

| ID | 判定 | 当前执行链、守卫抽查及剩余边界 |
|---|---|---|
| K01 | 已闭合 | `G.toSnapshot:8283 → WholeRunSnapshot.ts:146–188` 保存 levels/计量/RNG；`G.loadSnapshot:8328` 整图解码、:8424 恢复 RNG。`u_03_whole_run_snapshot:159–177` 在脏局恢复后整快照相等，并钉住 food=4321/gold=987/fuse=37、tick=1290、turn=81。 |
| K02 | 已闭合 | `Core/EntitySnapshot.ts:9–38、94–110` 字段清单及按 ID 对象图，不再普通怪漏 runtime。`u_01_instance_snapshot:90–99` 全 Item 值/keyLoc/flags 往返且无别名/耗骰；:124–131 自然 D1–D3 普通实体深比，数量>10。 |
| K03 | 已闭合 | `GenerationCoordinator:173–189、195、310–316` 保存 scent/离层计时/跟随，重访恢复。`u_03b_level_travel:40–56` 逐行比对4608条本树 CE 跟随资格 oracle；`u_03_whole_run_snapshot:94–105` 验证跨层/待坠/携带/leader 对象唯一及返回关系。 |
| K04 | 已闭合 | `Random.ts:76–82、100–110` 保存双流和 uint64；`LevelSeeds.ts:17–32 → GenerationCoordinator:218–220、299` 每层生成切换后恢复。`u_02b_level_rng:27` 对高低32位/调用计数逐值断言；U02a 状态复原与简并范围不耗骰断言仍在。不是全 CE 生成同种子同地图保证。 |
| K05 | 已闭合 | `G.removeDeadMonsters:7630 → MonsterAbsorption.anyoneWantABite → M.takeTurn → updateMonsterCorpseAbsorption:132–162` 完成安装并递减。`u_11_corpse_learning:253–258` 存在第13行动恢复后只余13次，最后 points1→0 并安装飞行；:281–284 真实调度20行动完成、不移动。 |
| K06 | 部分 | 原拒绝 blink 已消除；`M → MonsterBlink.ts:145–171、315–341 → G.castMonsterBlink:4850`；`u_07_monster_blink:46–55` 核对100个 CE 瞄准/耗骰样本。U07 保留的 mapToMe 缓存与重算时机、一般 AI 路径并未完整承接，不能把“有专调度”写成全部 CE AI 等价。 |
| K07 | 已闭合 | `M.tryUseBolt → BoltCatalog → G.castMonsterBolt` 实际铺 SPIDERWEB/VINES DF。`u_08_terrain_bolts:82–98` 真蜘蛛/树精施法、400/100 ticks、拒绝睡眠/遮挡/重复web；:182–185 学到 vines 的盟友真铺 SURFACE 藤蔓且不额外扣点。 |
| K08 | 已闭合 | `MonsterAbsorption:136–140 → M.syncFlagDerivedStatuses → specificallyValidBoltTarget:151 → G.applyMonsterBoltHit`。`u_09_learning_consumers:51–58` 22个可学 identity 元数据和7个不可学排除；:178–197 真支配/刀刃消费者断言；`Combat.ts:335–348` transfer 消费真实 HP 伤害。K25 的非学习 legacy 状态未因此关闭。 |
| K09 | 已闭合 | 怪物 BE_DAMAGE 已分派法伤原语，不用近战命中/护甲。`u_06_monster_damage:133–137` SPARK 多目标 HP `[96,100,96]` 与两次伤害抽样断言；`G:4924–4979` 为对应消费者。玩家自反射致死是另外保留项 N10。 |
| K10 | 部分 | `M:151–231` 统一 bolt 关系/反射门；`u_12a_cast_eligibility:24–38` 同队与敌对交叉排除；`u_12b_ally_mode:23–30` 盟友可在玩家 FOV 外追敌。普通 AI 全优先级/盗窃实际搬物未移植，`M:1257、1872` 仍主要写 FLEEING。 |
| K11 | 已闭合 | `G.spawnMachineItem → ItemLoader → machineItemRejections`，`GenerationCoordinator:41–140` 接收实例而非重复 spawn。`u_05_machine_items:63–73` 重放67个历史 null 请求均有实体、类别正确、资源初始化正确；品质拒绝/重掷断言也在同文件。 |
| K12 | 部分 | D 入口、发现/帮助屏已出现；`UI/Discoveries.ts:18–44 → ReferenceOverlay` 与 `Discoveries.test.ts` 约束分类/未知概率。剩余 N06：creeping death 在实际正常生成被排除，却仍进入分母/列表，浏览器显示3%。 |
| K13 | 部分 | `G:7590–7643、9159–9221` 已接寄宿释放、继任、purgatory、复活。`u_16_lifecycle:82–103` 真实 DF 复活最强盟友，祭坛惰化、满血、存档再恢复。但批量处理死亡与 CE killCreature 立即副作用、无候选落位算法仍不同。 |
| K14 | 已闭合 | `Creature` current/max + 客观块 + `M` 实际消费；`u_14a_status_gaps:52–57` 虚弱叠加上限与到期；`u_14b_status_gaps:47–53` 蛛网三次挣扎后移位，:170–177 current/max 在玩家/活动/休眠怪保存、寿命到期致死。缺少某些 CE 来源仍在 D03/D11，不再等同状态全缺。 |
| K15 | 部分 | 近战 `Combat.ts:201–250` 已短路自动命中、读 clump/weakness，去掉额外隐形倍率；`u_13_combat_math:40–41` 1215个 CE 命中黄金点。投掷 :424–427 仍忽略实例 clumping 且 `Math.round`，对 C/Items.c:6817–6819 整数截断；N08。 |
| K16 | 部分 | 固有光、137枚举外观、侧栏、末帧清理已有链；`u21c_flare_sidebar:8–29` 半径6临时光与到期恢复/清帧真实断言。flare 临时知识/FOV、其余触发源与随机色未完整；自然射线历史残留本轮未重现，不再按旧截图宣称当前仍残留。 |
| K17 | 已闭合 | `UI/MonsterVisibility.ts:22–36 → Appearance.ts:468、MonsterSidebar、GameCanvas 文本出口` 共用身份谓词。`u21c_flare_sidebar:32–40` 可见格怪物先有一行、施隐形后零行。MB_SUBMERGED 不在已实现谓词载体内，另计 K18；隐藏调试出口见 §6。 |
| K18 | 部分 | `Grid` remembered 字段 → `Appearance.ts:256、372–373`，mapping 保存记忆；`u_23_memory_mapping:12–26` 隐藏区真实地形变后外观不变、记住物品、存档记忆门。MB_SUBMERGED 仍无独立运行态与显隐消费。 |
| K19 | 已闭合 | `DungeonFeature.spawnDungeonFeature → bound effects` 接描述、疏散、瞬时效果、aggravate/递归事务；`u_17a_df_transaction:42–49` 即使刷新关闭仍按 CE 顺序疏散；:62–69 阻断否决无副作用，PERMIT 放行真实移动/报警。全 CE DF 目录外效果及 mapToShore 仍不在此关闭声明中。 |
| K20 | 已闭合 | `G.readItem → crystalizeFromPlayer:5467–5505` 先检查 impregnable，后 DF/致死/俘虏释放。`u_15a_shattering:103–116` 受保护休眠怪不动、普通格先唤醒再致死；保存保护集合断言保留。 |
| K21 | 已闭合 | 深水移动/物品漂移、STUCK、钥匙开笼统一 helper 已执行；`u_18_water_cage:12–23` 玩家真实进入深水，`u_14b:47–53` 脱网移动；K02/K30 保证钥匙唯一及保存。水生怪潜没状态仍归 K18，不能外推全部水域行为齐全。 |
| K22 | 已闭合 | `ItemLoader.spawnRing:1454–1473 → RingBonuses.ts:4–30 → G/Combat/ArcanaRecharge`。`u_15b2_ring_birth:40–48` 八类/frequency 与出生抽签；`u_15b_rings:18–28` 未知正附魔上限1/3/4、负附魔全效；各消费者专项断言已运行。 |
| K23 | 部分 | `CharmModel.ts:3–12、40 → ItemUseCoordinator:59–103` 六种现有护符真施效；`u_15c_charms:10–20` CE 曲线黄金值。另六种缺席，见 N07；不能以六种修复完成整个 CHARM。 |
| K24 | 部分 | `ItemLoader` 全10/11符文槽 → `G:6110–6448` 新效果；`u_15d3_runic_generation:27–30` 枚举无洞；U15d/d2 的 mercy50%、slaying类别、额外攻击/护甲效果有断言，旧“符文在伤害前”已过期（Combat:296–320）。谱影安置/构造耗骰等精确 CE 边界仍在，附魔授随机符文另见 N03。 |
| K25 | 未闭合 | 自然数据 kobold/goblin/vampire 的 onHitStatus 仍被构造器复制；`M:1505–1509 → G.applyMonsterOnHitStatus:6036–6099` 实际会写玩家。N02 探针复现非受击玩家被混乱。不能根据学习复合位清理完成来关闭此项。 |
| K26 | 部分 | `DetailGenerator.ts:463、469–482` 与 CharmModel/部分杖公式共用；中文健康护符20/40/100%及1377/759/128冷却一致。仍缺各杖完整数值详情，MA_HIT_BURN 文案有而行为无；退池旧物品在 test 模式仍可出现。 |
| K27 | 已闭合 | `Stairs.ts:11–40 → GenerationCoordinator:340–360` 先最终资格再选点；`AutoGenerator.ts:536` 退 CE66 集合已空。`v_2b_9e_2_autogen:238–249†` 真调度 CE66，断言 carrier wired、实际耗骰和 build回调次数；`c_8_connectivity:176–203†` 30seed×D1–25双向连通断言。D27–40 不纳入。 |
| K28 | 已闭合 | 对原列机器/30个 null tile：`DungeonFeatureCatalog` 全172有载体，晋升/祭坛/CE24、47、52、55已接回。`u_19d_machine_families:77–82` 真实CE28笼内物品及存档唯一；`u_16_lifecycle:97–102` 真复活；`u_19f_autogen:17–30` 21tile/24DF全字段与missing=[]；U19e/f机器消费测试本轮通过。不代表目录外lichen等已实现，也不证明每台自然成功率等于CE。 |
| K29 | 已闭合 | `BlueprintEngine.ts:294、405、1583–1621` SECRET_DOOR 映射与写层可达；`b2_transcription:249–263†` 执行真实 feature 写入，断言无显式层清其他层/显式层保留水草气两条输出，不只查枚举存在。 |
| K30 | 已闭合 | `BlueprintEngine` 领养/外包/携带转移唯一实例 → `GenerationCoordinator.createMachineRuntime`。`u_05a_item_ownership:96–100` 外包携带只有一个最终归属，父地面/父携带均空；:166–179 置换旧携带物后任何容器不再持有旧实例。 |
| K31 | 已闭合 | 生成与加载都按最终 grid machineNumber/area flags 重建 machineCells；`u_04c_machine_cells:45–55` 核对集合及RNG不变。旧“结果∪mr.cells漏外置feature”已关闭；历史即时存读可见ID差另列未核实，不混算修复失败。 |
| K32 | 部分 | `BlueprintEngine:2367` view、:719/767 pending occupancy、`GenerationCoordinator:41–140` 立即实体写口都存在。`u_19a:23–26` 579 CE masks；`u_19b:31–43` 64真值；`u_19c:30–40` 时序/抽样 oracle。个体构造 RNG、horde数量 min/max 与 CE clump 等边界尚未承接。 |
| K33 | 已闭合 | `Generator/MachineObservation.ts:47` 钩子 → U25显式逐层 runner；`u25_machine_observation:8–28` 同seed观测开关D1–26输出完全相等、成功committed记录非空。关闭的是可机械观测/中性性缺口；不能把观测器当 CE 正确性证明或据旧超时派性能修复。 |
| K34 | 部分 | `G:3600–3770` life加maxHP、confusion气体、黑暗状态/矿灯已有；`u_15e_potions:20–39` +10maxHP、满血和panacea清症状。creeping death :3701–3705仍仅日志、darkness/lichen投掷缺DF，发现概率也不一致。 |
| K35 | 已闭合 | `G.eatItem:3782–3802 → finishItemUse`，客观块自动进食。`u_15f_food:16–33` 拒绝无物品/时间/RNG变化，接受后nutrition2149；U27确认回放保存 false/true 决策。 |
| K36 | 已闭合 | `Items/Inventory.ts` 容量/同类合并 →拾取/分出/消耗；`u20_inventory:13–24` 食物按数量占容量、可合并、金币不占包；对象字段/数量经 K02 整图保存。 |
| K37 | 部分 | U26b已关闭自创计分/高分缺失：`Endgame.ts:9–31 → G:10371 → HighScores.ts:39–58`。`u_26b_endgame:17–27` 真死亡/普通/超胜利/easy分数 `[1734,2234,46234,81234,8123]`。生成与深层终局地图部分待 U26a 合并后复核。 |
| K38 | 部分 | `executeCommand/executeItemCommand`、选物/confirm/OOS有实现；`u_27_recording:6–18、63–78` 无动画真实wait/eat、确认回放通过。但正常动画录像在首个wait快进即OOS（N01）；:34只在故意坏录像上开动画，不能覆盖健康动画录制。 |
| K39 | 已闭合 | `G.startNewGame:487–658` 清stats/levels/pendingFallen/endgame、解绑旧grid而保留session回调；`u_00_new_run:128–172` 四mode×四入口脏A→B与全新B整状态和两流相等，旧集合未被别名清空；:177–187旧grid不能唤醒新局。 |
| K40 | 已闭合 | `LightCatalog.ts` CE_DCOLS=79、:334–416矿灯公式 → `G.refreshMinersLight`；`c_7_lighting:129–133` portal7900/79；:609–630真实darkness入口使半径/FOV变小、到期恢复。不是只改数字常量或期望。 |
| K41 | 部分 | U24键/硬串门、中文真实界面有效；`u24_hardcoded_text:46–59` 中文发现/符文名称不含旧英文。但 `G:2800–2802` 拼接英文OOS后用变量入日志，实际浏览器已见；描述语义与生成资格未被AST门保护。 |
| K42（补） | 部分 | U18a各职责cost已大量迁移；`Grid.ts:1187–1237` 仍小白名单，`G.updateVision:2395` 等读派生字段。自然seed424242/D1：106格至少一字段不同，其中opaque103格/passable7格；不是106个独立bug。N05详证。 |

## 4. 新证实或需承接的具体差异

### N01 动画录像 checkpoint 时点错误；参考屏关闭漏记（玩家可见，优先）

正常浏览器 `GameCanvas.vue:279` 开启 `animationEnabled`。`G.executeCommand:2591–2601` 执行命令后立即 `recordInputEvent:2575–2587`；`TimeCoordinator.ts:448–449 → G.beginAdvancement:8099–8106` 只建立后续推进迭代器，尚未完成怪物/环境回合。`replaySeek:2827–2852` 则强制同步完成回合再比较 checkpoint。

复现：seed424242全新正常局，开动画，调用原wait入口；等渲染推进结束（实际turn=1）再导出。录像只有一条wait，记录turn=0；加载并seek(1)得到 `OOS at command 1: state mismatch after command 1`、cursor0。另一个同seed无动画新局两条wait完整回放2/2、error=null。混合发现/背包操作的场景也在第4条wait报OOS，独立新局复现排除了必须依赖前置菜单的误归因。证据 `browser-observations.json.animatedReplay/freshReplay`。

现有 `u_27_recording:21–37` 的动画行测试是“故意坏 checkpoint 应报错”，不证明正常动画录制可播；`u_r4_trace` 的动画/同步比较去除了录制字段（`withoutRecording`），因此不能填补此洞。另 `components/ReferenceOverlay.vue:27–31` 的 close 直接清 `referenceScreen` 并截获 Escape，不经过 executeCommand；本轮录制事件为 discoveries、toggle_inventory、escape、wait，没有关闭发现的事件。重播 modal 分支会错位（G:2864–2867），当前checkpoint也未覆盖该UI状态。

### N02 legacy 盟友命中把状态写到未受击玩家（K25）

自然目录 `src/data/monsters.json:49–51、218–220、1504–1506` 给 kobold/goblin/vampire 保留 confused/paralyzed。`M:522–529` 构造器复制这些字段；盟友攻击分支 :1505–1509 同时调用玩家状态 helper 和怪物状态 helper。`G.applyMonsterOnHitStatus:6062` 的目标固定是 `this.player`，传入的 target.name 仅改变消息。

不改概率/实现的合成场景：seed1212，玩家(6,8)、kobold盟友(8,8)、rat敌人(9,8)，rat只提高HP以避免过早死亡。第一击rat10000→9999，玩家confused0→2、rat仍0（其免疫使它无混乱）；玩家不在该攻击目标位置。这证明串写执行路径，不声称自然一局中必定首击发生。应逐物种拆清 legacy 规则与 CE MA 位；不能直接全清 statusImmunities。

另一个必须纠正的旧印象：数据 rat 仍写 goldDropChance=.1/itemDropChance=.05，但 `M:305–306` 实例默认0、构造器未复制；探针实例均0。**不能声称自然老鼠仍按该JSON概率额外掉金币。** `G.dropMonsterLoot:6737–6756` 的遗留出口与 CE item hopper 缺席是两件事。

### N03 附魔卷轴装备资格/效果仍是旧规则（新补）

`G.canEnchantTarget:5182 → Items/ItemUseCoordinator.ts:31–35` 对武器护甲仅允许 `equippedWeapon ?? equippedArmor`。玩家持匕首时，身穿皮甲、飞镖、备用剑都不能选。`chooseEnchantTarget:5189–5192` 最终回调 `enchantEquippedItem:5204–5225`：只加enchantment，未减strengthRequired/增timesEnchanted，负值未升到非负便不解除诅咒；无符文物品另有20%随机授符文。

CE `C/Items.c:7824–7850、7892` 可选择包内各合格物品、增加timesEnchanted、武器护甲力量需求下降、无条件按uncurse规则处理，不在此随机授新符文。探针匕首 strength12/times0/E0 → 12/0/1。`invented_content_pool` 的8000次附魔只约束“不生成被禁符文名”，并不证明授CE符文这条自创规则符合CE。与新增符文目录完整性必须分开验收。

### N04 解除诅咒卷轴只处理第一件并改负附魔（新补）

`G.readItem:3894 → removeCurseFromInventory:5172–5178` 用find选第一件，清curse且把负附魔置0。CE `C/Items.c:7806–7808` 遍历整个背包，`uncurse:7740–7745` 只清flag。

合成背包两件：匕首E=-3、备用剑E=-2，都诅咒。执行原helper后匕首变E0/无诅咒，剑仍E-2/有诅咒。入口真实接到此helper；输出保存在runtime-observations。当前旧 `p1_37_machine_flag_i18n` 只触发日志，无法证明CE全包/负附魔语义。

### N05 自然地形派生旗标仍与全层flags分裂（K42延续）

`Grid.ts:1187–1204、1207–1237` 更新 passable/opaque 的小白名单未覆盖完整terrain catalog；`BlueprintEngine:1613` 等真实feature直接写层。DF专用 `DungeonFeature.ts:176–182` 会完整刷新，但不是所有写口都走DF。

自然新局 seed424242/D1，无人工铺地或改旗标：106格有差异，103格遮挡差异、7格通行差异（有重叠）。例如(1,6) TORCH_WALL 实际passable=true/opaque=false，按全层flags应false/true；FOLIAGE也有opaque漏设。`G:2395` FOV、:9503视线、:9659搜索仍读旧opaque，:9408/9420自动探索等仍读旧passable。**这不是说CE玩家/气味/逃跑各cost应使用同一布尔值**；差异统计仅核对Grid自身声称的地形派生值。未量化该自然图中每个漏挡格造成多少额外可见格。

### N06 发现屏概率和详情语义仍不一致（K12/K26/K41）

`UI/Discoveries.ts:18–40` 使用 `ItemLoader.genPotions`；`G:103、733、921–926` 正常地面和机器实际再过滤 creeping_death。因此当前浏览器发现屏仍显示“蔓延死亡药水 3%”，这个比例不是当前正常生成未知药水的比例。不能因为 CE 本应有这种药水，便把未实现/退池状态当成已正确展示。

`DetailGenerator.ts:86` 将 MA_HIT_BURN 展示为“攻击会点燃目标”，但全src生产搜索只有该描述和monsters数据，未找到读取该位的战斗出口；这是描述与实现不符。MA_HIT_STEAL_FLEE 的完整搬物也缺。`G:2800` OOS拼接英文实际可见，静态硬串门只对直接表达式不能穷尽数据流。健康护符抽查通过（§6），不外推为所有杖/符文/怪物详情正确。

### N07 原生内容尚缺，不能当自创继续永久退池

`CharmModel.ts:3–12`/`ItemLoader.genCharms` 只有六种；对 V/GlobalsBrogue.c:713–726，另外六种护符未实现。`G:3701–3705` creeping_death喝下只日志；`THROWN_FUNCTIONAL_POTION_EFFECTS:5659` 无lichen/darkness完整分支；DF枚举/目录未有相关全套来源。黑暗**喝下状态及矿灯**已有效，不能写“黑暗完全没做”。ROT_GAS未承接，STENCH_SMOKE及恶心出口已有；MB_SUBMERGED仍无运行态。这些是CE原生缺口，恢复自然池应在效果/保存/显示合同建立之后另行施工。

### N08 投掷伤害（U13已登记，仍有效）

`Combat.resolveThrownWeapon:424–427` 重新parseDamageString，再用parts.clumping，忽略已保存的item.clumping；乘damageFraction后Math.round。CE `C/Items.c:6817–6819` randClump(theItem->damage)并整数截断。近战U13黄金测试与投掷自动命中短路修复不能关闭这两项；下一轮需同时核对数值与RNG调用数，而非只换舍入函数。

### N09 自创退池：正常池维持，但“玩家不可触达”不成立

`BlueprintEngine.ts:673–710` 的11个退池ID均仍被 `blueprintQualifies` 拒绝，探针D1/D12为false。名单：reward_library、reward_consumables、vestibule_flammable、vestibule_guardian、vestibule_pit_traps、key_rat_trap、key_fire_trap、key_flood_trap、key_web_room、key_lava_moat、key_boss。普通调度/加权资格门未被U19f原生CE载体恢复绕开。`ItemLoader.ts:67–99` gen池仍过滤标记退池内容；`invented_content_pool.test.ts` 正常池和自然层守卫本轮通过。CE66/52/55回池与自创11蓝图退池不是同一集合。

但 `components/MainMenu.vue:120` 公开test模式，`GenerationCoordinator:152 → G.generateTestDepth:1967` 会建测试展陈，按完整数据而非正常gen池放物。实际test模式探针：D1 halberd(56,3)；D2 wand_of_fire(62,3)、wand_of_lightning(68,3)；D3 scroll_of_amnesia(14,11)；D4 potion_of_healing(14,3)；D5 staff_of_light(44,11)；D9 dagger+venom(14,3)、dagger+vampirism(26,3)、leather_armor+vitality(14,11)。这些是场景地面物品，不仅是文件里保留定义。现有退池测试:153–161还明确允许按ID直接构造退池定义。

所以结论是：**正常自然生成退池有效；跨公开模式的不可触达要求未满足。** 没有证明11个自创蓝图在test模式都能成功建成，不能据测试展陈目录就称全部已可玩。建议明确公开test的产品边界，并用实际模式入口守卫覆盖；本轮不隐藏菜单或删定义。

### N10 其他仍有效的已登记边界

| 范围 | 当前执行证据与限定 |
|---|---|
| 玩家反射致死 | `G:4400–4426` 玩家直接bolt伤害路径与:4622 lightning继续遍历，缺怪物bolt路径:4924–4979已有的完整玩家致死停止/归因处理；C/Items.c:5168后有专门死亡分支。U06登记仍需独立反射致死场景，不据怪物施法全绿关闭。 |
| 盗窃/一般AI | `M:1257–1260、1872` 改FLEEING/消息，未实现 C/Combat.c:480–510 的选择包内物→carriedItem→MODE_PERM_FLEEING。U12b只补mode及盟友子流程，不能等同完整普通怪状态机。 |
| 死亡/落物/复活 | `G.removeDeadMonsters:7590` 批量收口；`dropCarriedItem`/`resurrectAlly:9159` 仍用web候选/回退，与CE立即killCreature及距离图口径不同。寄宿/学习/purgatory存在，不再重复派“从零实现复活”。 |
| 生成精确耗骰 | `GenerationCoordinator.createMachineRuntime:41–140` 立即实化已修占用；`new Monster`/horde数量、item hopper、性别和waypoint懒建等仍非CE逐骰构造。U19c/02b/07已明确留下，UR黄金轨迹只保web行为不证明CE等价。 |
| flare/颜色 | `G.createFlare → visualLightAt` 临时光合成，与`updateVision`基础FOV分离；C/Light.c:291–403临时可见性未全移植。未接全触发源；地形/光颜色随机实现仍不同。 |

## 5. 逐轮保留边界处置

以下覆盖现存61份报告；一行合并的报告逐一具名。原文行号完整保存在report-boundaries.json；当前裁决依赖§2–4执行证据和§3守卫，不能以“后轮标题看起来承接”代替验证。

| 报告 | 当前处置（已过期 / 仍有效 / 未核实） |
|---|---|
| [u-00.report.md](u-00.report.md) | §5跨局清理具体缺口已闭合（K39）；历史正向seek边界不能视为已全闭，N01仍有动画问题。并存多个Game共享模块单例是内部架构边界，非当前单活跃局必然串局。 |
| [u-01.report.md](u-01.report.md) | 普通实例字段/循环引用经U03、UR1整图接续，旧当前层边界已过期（K01/02）。不做旧schema迁移属有意设计；不能派“补兼容”。 |
| [u-02a.report.md](u-02a.report.md) | :111的uint64/per-level/整局延期已由U02b/U03承接；RNG快照本身有往返守卫。 |
| [u-02b.report.md](u-02b.report.md) | 环境50/100块与跟随后由U03b承接；完整CE生成RNG、hopper、waypoint/出生与坠层实化顺序仍有效（N10）。不再说“互动消耗全局流必然改未来层种子”。 |
| [u-03.report.md](u-03.report.md) | scent/follow/catchup原延期由U03b承接；存档对象图、计量与两流已闭合。旧档兼容排除保留为范围说明。 |
| [u-03b.report.md](u-03b.report.md) | machineCells旧差异由U04c接续；资格/离层推进已实测守卫。完整生成逐骰不在其承诺内，留N10。 |
| [u-04c.report.md](u-04c.report.md) | :26集合/只读资格闭合。报告登记的“即时楼梯存读可见实体ID差”本轮未按原完整步骤复现，记**未核实**，不声称仍失败也不以普通roundtrip覆盖它。 |
| [u-05a.report.md](u-05a.report.md) | 单所有者/外包失败回滚有效；后续即时实体已由U19c承接。CE异常多TAKE/最后torch无定义或幽灵目标，web拒绝属已记录范围差异，非正常重复产物仍未修。 |
| [u-05.report.md](u-05.report.md) | :81缺符文槽由U15d3关闭；品质与STAFF/WAND消费者已闭合。全CE生成分布/RNG/hopper仍有效，不能把67null请求回放当全目录分布证明。 |
| [u-06.report.md](u-06.report.md) | :104学习/状态相关边界主要由U09/U14/U16承接；玩家反射法伤致死停止/归因仍有效N10；魔法伤害本体K09已闭合。 |
| [u-07.report.md](u-07.report.md) | :152学习由U11闭合；普通盟友部分由U12b承接。mapToMe缓存、一般AI和完整跨局oracle仍未完全承接，K06保留部分。 |
| [u-08.report.md](u-08.report.md) | :41 STUCK近似由U14b闭合，learnable vines由U11接上；MB_SUBMERGED仍缺。web/vines不是null效果了。 |
| [u-09.report.md](u-09.report.md) | :95 legacy归属保留仍有效，且N02证实错误目标；状态/复合位/转移学习消费者已补，不能据此全删旧字段。 |
| [u-10.report.md](u-10.report.md) | :27尸体学习行为由U11接续；“仅字段载体、未学习”已过期。历史浏览器详情加载异常本轮未按原步骤复现，未核实。 |
| [u-11.report.md](u-11.report.md) | :146批量死亡、落物/安置算法边界仍有效；状态/学习链本身强守卫。旧“未来层共享RNG”风险需按U02b每层隔离收窄。 |
| [u-12a.report.md](u-12a.report.md) | :29列的一般AI/状态/显示延期部分由U12b/U14/U21承接；施法目标关系具体合同已闭合，一般怪状态机仍不能外推。 |
| [u-12b.report.md](u-12b.report.md) | :20明确未移植完整updateMonsterState、普通盗窃，仍有效N10；mode字段存在≠所有来源都正确赋值。 |
| [u-13.report.md](u-13.report.md) | :132投掷clump/取整仍有效N08；虚弱后由U14a承接；符文先于伤害旧时点已过期（Combat:296–320）。零伤害“miss”措辞与FloatingText随机ID仍为表现/内部债。 |
| [u-14a.report.md](u-14a.report.md) | :103矿灯黑暗由U21b、喝黑暗由U15e承接；STENCH由U19f接回，不再“恶心无来源”；ROT_GAS、潜没和darkness投掷DF仍缺。 |
| [u-14b.report.md](u-14b.report.md) | :67 LIFESPAN谱影/刀刃来源已有后轮消费；guardian未实现应归缺护符类别。STUCK/DONNING/ENRAGED/maxStatus具体债闭合。 |
| [u-15a.report.md](u-15a.report.md) | :26通用DF由U17、外观由U21c、复活结构由U16承接；批量死亡仍留。:30“只有蓝图写IMPREGNABLE”已过期，`Architect.ts:219` 楼梯准备也写保护集合。 |
| [u-15b.report.md](u-15b.report.md)、[u-15b2.report.md](u-15b2.report.md) | 前者出生范围由后者承接；八戒指/有效附魔闭合。仍应将跨类别remove curse的N04单列，不能借戒指局部守卫关闭卷轴。 |
| [u-15c.report.md](u-15c.report.md) | 六种护符修正有效；另外六CE类别明确未补，K23/N07仍有效。 |
| [u-15d.report.md](u-15d.report.md)、[u-15d2.report.md](u-15d2.report.md)、[u-15d3.report.md](u-15d3.report.md) | 武器/护甲空槽和生成映射由三轮接续，不能重复列“无multiplicity”等；谱影位置、CE构造耗骰/视觉精度仍有效。附魔卷轴自创授符文N03未被“生成表完整”覆盖。 |
| [u-15e.report.md](u-15e.report.md) | life/confusion等修复有效；lichen、darkness投掷仍未承接。矿灯由U21b闭合，flare由U21c仅部分承接。 |
| [u-15f.report.md](u-15f.report.md) | :39确认/自动吃已闭合；芒果旧描述已被U24纠正。别把“没有芒果治疗”列CE功能缺陷。 |
| [u-16.report.md](u-16.report.md) | :15复活地形外观由U17e/U21c承接；死亡批处理、落物/复活候选算法仍有边界。 |
| [u-17a.report.md](u-17a.report.md) | :143事务已接；mapToShore与完整描述/底层规则仍有边界，完全封闭无疏散候选沿既有回退，不凭假设改规则。生成期立即实体由U19c承接。 |
| [u-17b.report.md](u-17b.report.md)、[u-17c.report.md](u-17c.report.md)、[u-17d.report.md](u-17d.report.md) | 后继无tile、待接通自动生成等已由U19分族/U19f接续；原“剩余缺tile数”作为历史数字已过期。未在目录中的ROT/lichen不能由missing=[]关闭。 |
| [u-17e.report.md](u-17e.report.md)、[u-17f.report.md](u-17f.report.md) | :132后续机器入口由U19d/e/f承接，祭坛/晶墙等载体有真消费；FUNGUS旧别名冲突由U19f接成LUMINESCENT_FUNGUS。全机器自然成功率仍未核实。 |
| [u-18a.report.md](u-18a.report.md) | :133职责化地形判断有效；其“未迁移生成消费者”由U18a-2/-3大量承接。但Grid派生位旧白名单未消失，N05自然复现，不能把整个K42关闭。 |
| [u-18a-2.report.md](u-18a-2.report.md)、[u-18a-3.report.md](u-18a-3.report.md) | 奖励/护符落点、热图、horde等已使用对应全层旗标与专门资格。与FOV/搜索仍读opaque是不同消费面，后者仍有效。 |
| [u-18.report.md](u-18.report.md) | 水域移动/卷物/开笼具体合同已闭合；潜没没有因此实现，K18仍留。 |
| [u-19a.report.md](u-19a.report.md) | viewMap具体空转已关闭，579 oracle样本约束实际判据。不能将viewMap局部正确扩大为每台蓝图几何完全正确。 |
| [u-19b.report.md](u-19b.report.md) | :127 pending实体时点延期由U19c承接；道具占用门真实消费。不再保留“全部实体都延迟到populate”的旧结论。 |
| [u-19c.report.md](u-19c.report.md) | :142构造器随机、性别、hopper、horde数量分布、waypoint等仍有效N10；补了实化时点不等于全CE spawnMonster/horde同构。 |
| [u-19d.report.md](u-19d.report.md) | :116 CE47由U19e、52/55由U19f接续；原资格退池债已关闭。CE38特定自然药水替代端到端发生率本轮未核实。 |
| [u-19e.report.md](u-19e.report.md) | :123机器族闭包已有执行与测试；后继无tile由U19f消除。保留只对具体链证明，不泛化自然频率/全局可解性。 |
| [u-19f.report.md](u-19f.report.md) | 登记的autogen载体/后继恢复有效；旧 no-tile分类不再等同无实现。未声明全CE生成同图，本轮也不以U25中性测试替它声明。 |
| [u-20.report.md](u-20.report.md) | 堆叠/容量/分出合同已闭合；持久化由整图codec承接，未见本轮需重派原堆叠缺口。 |
| [u-21a.report.md](u-21a.report.md) | 主地图/侧栏/文本身份门已共享；潜没边界仍有效。调试sr-only出口需单独核实可访问性用途，非主画面隐形已回归。 |
| [u-21b.report.md](u-21b.report.md) | :50当时浏览器不可用属于历史环境限制；本轮有限中文浏览器可用，不等于补验所有深水/黑暗视觉场景。C-7实际药水/FOV守卫通过，79列原错误已关闭。 |
| [u-21c.report.md](u-21c.report.md) | :28未接全flare源、短暂揭示、色彩随机、缩放小图边界仍有效。:22旧外观守卫红项后来在同报告:30以后已裁决更新；本轮三文件105项通过，不能把历史红项当当前失败。 |
| [u-22.report.md](u-22.report.md)、[u-22b.report.md](u-22b.report.md) | 屏幕/CE顺序/未知概率公式、知识状态已接；实际池与gen表不一致N06仍在。CE原生缺失种类不能借“只列池内”文案隐去实现债。 |
| [u-23.report.md](u-23.report.md) | :25记忆载体/mapping已修，旧DF null范围被U19f关闭；MB_SUBMERGED未承接。 |
| [u-24.report.md](u-24.report.md) | 硬串与已改描述测试有效；历史保留描述快照中如speed/芒果旧说法只作为文档更新债，不能再当当前产品行为。动态OOS与MA_HIT_BURN语义漏网N06有效。 |
| [u-25.report.md](u-25.report.md) | 观测中性和落点事件真实有效，定向测试本轮通过；性能旧超时未复现为当前瓶颈，不派无证据优化。机器覆盖数据不是CE正确率。 |
| [u-26b.report.md](u-26b.report.md) | :29计分/榜单闭合；D27–40深层/宝石/超胜利地图待U26a合并后复核；没有用计分造物夹具替代生成验收。 |
| [u-27.report.md](u-27.report.md) | 旧v1拒绝、读档后不导出残缺录像是明确范围选择；不需擅自补兼容。新局命令记录虽有合同，动画时点/参考屏漏记N01仍需承接。 |
| [u-r1.report.md](u-r1.report.md) | codec提取保行为；`u_r1_codec:18–35` 循环关系/共享物品/零耗骰深比有效。没有要求重写旧格式兼容。 |
| [u-r2.report.md](u-r2.report.md) | item协调器零行为漂移按每命令fixture守卫保留；不能将“保持旧行为”当成卷轴CE正确，N03/N04恰在被保留语义内。 |
| [u-r3.report.md](u-r3.report.md) | 四seed×D1–26生成世界hash保持，证明拆分中性；不能替代CE生成oracle，N10仍有效。 |
| [u-r4.report.md](u-r4.report.md) | 时间协调器同步/动画世界状态等价守卫有效；比较排除录制数据，因此N01可以在这些测试全绿时存在。 |

## 6. i18n、UI与效果一致性抽查

正常局主菜单、游戏侧栏、日志、发现屏、背包均在真正zh_CN页面查看；截图没有用headless文本冒充视觉验收。地图为整幅79×47等比显示、已探索区较小，沿U21c边界登记，未做移动端/不同DPI/所有法术动画验收。

| 抽查 | 结果 |
|---|---|
| 健康护符 E1/E2/E5 | `DetailGenerator:469–482` 调CharmModel；中文分别显示恢复20%/40%/100%、冷却1377/759/128。`Creature.heal:207–209` 与 `ItemUseCoordinator:59–103` 按maxHP百分比实际治疗；不是旧固定8HP。 |
| 速度/保护/心灵感应/火免护符 | 六种现有护符通过ItemUseCoordinator走对应状态/护盾，U15c守卫通过；旧speed施漂浮、protection随机免疫、telepathy/fire immunity仅日志结论过期。未覆盖未实现六种。 |
| life/食物 | U15e断言真实+10maxHP及清状态；U15f确认/时间与CE一致。当前芒果文案无额外治疗；不根据旧文档造新效果。 |
| 发现屏 | 中文类别与条目可读，但creeping death仍3%（N06），因此“文字本地化通过”与“概率语义正确”分开判定。 |
| 怪物能力/符文详情 | 翻译后的符文名可读；MA_HIT_BURN与未实现盗窃语义仍失真。普通staff完整数值详情未逐项覆盖，本轮不能宣布全部正确。 |
| 硬编码英文 | 正常截图所查主要交互中文；真实录像失败路径出现英文OOS。`G:2800–2802`先拼字符串再log，AST直接字符串门会漏。`AgentControls.vue:3–70` sr-only调试名称/HP未用主可见性门，是否暴露给实际屏幕阅读器用户未核实；列内部/可访问性待核，不把它混称主画面泄露。 |

## 7. 剩余工作及建议派发单元

这些是后续建议，不是本轮修改许可。规模S/M/L仅表示边界跨度，不是工时。

### 7.1 影响玩家可见行为

| 建议单元 | 要闭合的可检验范围 | 优先/规模 |
|---|---|---|
| X2-录像提交时点 | 动画完成后的checkpoint；同步/动画/seek一致；参考屏鼠标及Escape关闭入统一命令；保持确认/选物/自动行走合同；真实浏览器新录像零OOS。来源N01/K38。 | 先，M |
| X2-legacy命中归属 | 逐自然物种核CE状态/免疫/MA位；确保盟友攻击不写未受击玩家；覆盖普通、几何、投掷/法伤等实际目标。不得全清legacy表。N02/K25。 | 先，M |
| X2-卷轴装备语义 | 包内所有合格附魔目标、力量/次数/诅咒/弹药组；去掉无CE依据的附魔随机授符文；解除全包诅咒且保负E；UI选物与回放一起守护。N03/N04。 | 先，M |
| X2-地形派生与消费 | 按写口闭合opaque/passable；按职责核FOV/搜索/自动探索/推拉，保留CE不同cost口径；用自然TORCH_WALL/FOLIAGE样本与全层写口覆盖。N05/K42。 | 先，L |
| X2-退池可达性 | 明确公开test模式合同；按真实菜单→测试层→物品操作验证D2历史物品/符文不成为未授权玩家内容；保正常池守卫，勿重新放回11自创蓝图。N09。 | 先，S–M |
| X2-发现与文本语义 | 统一实际生成资格与发现概率分母；动态错误中文；描述只宣称实际效果；建立能力/公式与中文渲染断言。N06/K12/K26/K41。 | 次，M |
| X2-投掷数学 | item完整range/clump、CE定点截断、命中/免疫短路耗骰；防与近战/符文顺序互相覆盖。N08。 | 次，M |
| X2-原生效果分族 | 分开补其余六护符、lichen/darkness投掷、ROT_GAS、潜没；每族先数据/状态/交互/显示/保存，再讨论恢复自然池。N07。 | 次，多M/L |
| X2-AI与生命周期 | 盗窃搬物/永久逃跑、一般怪状态机、blink缓存；死亡即时收口/落物复活候选；玩家自反射致死停止及归因。N10。建议拆AI、死亡、bolt三单元。 | 次，多M/L |
| X2-光照表现 | flare完整来源与临时知识/FOV、动态色，保持cosmetic/主流边界；浏览器覆盖实际法术而非仅造帧。K16。 | 后，M |
| U26a合并后复核 | **待 U26a 合并后复核**D27–40生成、宝石、超胜利地图与普通终局衔接；本轮不提出深层修补实现。 | 外部依赖 |

### 7.2 仅内部或验证能力

| 单元 | 边界 |
|---|---|
| CE生成逐骰专项 | hopper/构造/性别/horde数量/waypoint按CE事件序列比较；它会影响生成结果，若承诺CE同seed应升级玩家行为单元，不能只改黄金值。当前UR/U25证明中性，不能替代它。 |
| 补盲区守卫 | 健康动画录像、多个诅咒物品、附魔任意装备、自然地形派生、test模式可达性是当前主要缺断言区。本轮没有新增产品测试或反向变体。 |
| 历史异常复核 | U04c即时存读可见实体ID、U10旧详情异常、CE38自然替代分布按原步骤重现后再决定派修，当前未核实；不按旧性能超时数字启动优化。 |
| 单例/调试出口 | 多Game并存、sr-only AgentControls可访问性、FloatingText随机ID保留为内部核查。单活跃浏览器路径未证实因此串局；没有理由再整体搬空Game.ts。 |

### 7.3 仅文档

更新总账时把：当前层存档、uint64缺失、学习缺席、30个DF无tile、SECRET_DOOR无写口、CE66/52/55原资格退池、所有实体延迟实化、无侧栏/发现屏、旧外观红项、芒果治疗要求、自然老鼠按JSON掉金币等过期说法标为历史。保留各轮原始证据，不覆写旧报告来伪造当时状态。将“六种护符已修”“登记DF全有tile”“UR无漂移”明确写成局部成果，不写为全CE完成。

## 8. 交付完整性与复现

新增脚本：[x1-audit.mjs](../../scripts/x1-audit.mjs)、[x1-stage.mjs](../../scripts/x1-stage.mjs)、[x1-validate.mjs](../../scripts/x1-validate.mjs)、[x1-observe.mjs](../../scripts/x1-observe.mjs)、[x1-browser.mjs](../../scripts/x1-browser.mjs)、[x1-finalize.mjs](../../scripts/x1-finalize.mjs)。stage重新建立隔离副本；validate默认跑类型/构建/66文件，`extra`只跑三文件；observe/browser仅执行已有实现并写本轮证据；finalize检查条目、报告覆盖、链接及新增文本LF。不要运行历史baseline捕获脚本。

原树前后 **7796** 个受版本控制文件的SHA均不变，见 [tracked-comparison.json](x-1-evidence/tracked-comparison.json)；Git HEAD/暂存区/新增范围见 [git-integrity.json](x-1-evidence/git-integrity.json)，最终范围/LF/引用检查见 [delivery-check.json](x-1-evidence/delivery-check.json)。没有修改、暂存或提交现有文件。测试全绿与本报告发现并不矛盾：本轮明确区分了守卫实际覆盖的合同、守卫未覆盖的可执行差异和仅历史未核实项。
