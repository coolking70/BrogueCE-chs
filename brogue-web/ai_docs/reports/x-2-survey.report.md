# X-2：X2 修补阶段后的 CE 对齐度终期复核（只读）

2026-09-27（Asia/Shanghai），Windows；基准 `996450fb148b4829bfe4247740146a13f722a661`。**不能宣布已覆盖范围全部对齐。** X-1 的多数具体缺口和 X-1b 的 XB01–XB03 已有闭环，但本轮复现了“死亡对象仍进入 AI 恐惧扫描”和“闪光帧改变录像法器默认目标、随后 OOS”两处交互遗漏，另将已有详情债定位到力量需求为 0 的武器伤害显示。其余生成、一般 AI、光照随机序列等保留边界仍不能由专项全绿替代。

规格采用任务书 §0 引用的 [X-1](x-1-survey.report.md)、[X-1b](x-1b-survey.report.md)、X2a–X2o，并回溯 [X-0](x-0-survey.report.md) §2、§3.1、§4.3 的原始范围；权威为本工作树 `BrogueCE-master`。本报告不修复发现，不修改历史报告，不提交 git。

## 1. 方法、证据与判定口径

沿真实入口、状态写入和消费者检查当前源码，对照本树 CE，再抽读既有守卫的实际断言。报告自述只用于建立清单。已整理全部 15 份 X2 报告的 196 条边界线索，见 [原文定位](x-2-evidence/report-boundaries.json)；命中数不是缺陷数。断言 AST 摘录见 [X2](x-2-evidence/guard-review-x2.json)、[U/UR 及其他](x-2-evidence/guard-review-legacy.json)。

- **已闭合**仅指该行列出的原始缺口和验收合同，不代表整个子系统等价于 CE。
- **部分**表示已有修复，但该条继承的语义边界或当前集成缺口仍在；**未闭合**表示所述具体差异仍可执行。
- **未核实**不等于失败。有限自然样本、镜像夹具、web 回归基线、提取 CE 函数的 oracle 各有证明范围，不能互相替代。
- 本轮新增探针只构造内存场景、调用原实现；没有替换方法、注入变体、重捕获基线。既有测试原有的 mock/fixture 保持原样。未重新编译或重采历史 CE oracle，相关测试仍核验其来源哈希及实际结果。

路径简写：`G`=`src/engine/Core/Game.ts`，`M`=`src/entities/Monster.ts`，`GC`=`src/engine/Core/GenerationCoordinator.ts`；`E/`=`src/engine/`，`T/`=`src/test/`，`C/`=`../BrogueCE-master/src/brogue/`，`V/`=`../BrogueCE-master/src/variants/`。测试简称均指相应 `.test.ts` 文件；行号对应本轮 HEAD。`†` 表示本轮读过断言但未运行该文件；其他引用的测试均在本轮 89 文件清单中。

| 验证 | 本轮结果及范围 |
|---|---|
| 隔离执行 | 临时副本 `E:/bench/tmp/brogue-x2-survey-aC23BV/brogue-web`，登记的 949 项输入 SHA 一致，差异为空；构建缓存及测试临时产物只在副本。见 [stage](x-2-evidence/validation-stage.json)。 |
| 类型、构建 | `vue-tsc -b`、`vite build` 均退出 0，分别 9.279 秒、5.713 秒；见 [执行摘要](x-2-evidence/validation-summary.json)、[类型日志](x-2-evidence/typecheck.txt)、[构建日志](x-2-evidence/build.txt)。 |
| 既有测试 | [89 个不同文件](x-2-evidence/selected-tests.json)，**1645 passed、0 failed、0 pending**，672.210 秒，`maxWorkers=2`。包括全部 X2 专项、所列 U/UR、浅/深生成基线、退池、i18n、光照、外观、发现/详情等；[原始结果](x-2-evidence/targeted-results.json)。JSON 的 285 suites 包含嵌套 describe，不能当成文件数。未声称运行全套或整个 `test:drift` 命令。 |
| 新差异探针 | [源码](../../scripts/x2-survey-observe.ts)、[执行器](../../scripts/x2-survey-observe.mjs)、[结果](x-2-evidence/runtime-observations.json)。同一原实现的镜像初态/对照支线，复现三项结果，详见 §6；不代表自然发生率。 |
| 浏览器与自然长局 | 本轮未操作浏览器，未新跑自然 D1→D40 完整通关录像。既往浏览器证据仅作为历史范围说明，不算本轮实测。渲染入口的可达性由 `src/components/GameCanvas.vue:651–675` 源码确认。 |
| 原件保护 | 9555 个受版本控制文件前后 SHA 不变，HEAD 不变、工作区已跟踪 diff 和暂存 diff 均空；见 [比较](x-2-evidence/tracked-comparison.json)。新增文件范围、LF 和交付检查见 [检查结果](x-2-evidence/delivery-check.json)。 |

Node 子进程在受限沙箱内出现 `EPERM`，实际验证使用获准的隔离执行权限；没有改项目配置或依赖来绕过失败。辅助脚本的路径读取错误只影响调查命令，不作为产品测试失败。

## 2. X-1 / X-1b 具体发现结案

| 条目 | 当前判定 | 当前执行路径与实际守卫 |
|---|---|---|
| N01 动画提交时点、参考屏漏记 | **原问题已闭合；录像整体部分** | `G:2613` 命令入口记录事件，`G:8321` 推进完成后提交 checkpoint；`G:2799` 回放共用完成校验。`T/x2a_recording_checkpoint:10–40` 断言在途事件已存在但拒绝导出、完成后与同步相等、回放/seek 无错、损坏 tick 正确 OOS；`:43–56` 断言发现屏 Escape 关闭确实成为事件。新 XN02 是显示归一化漏入口，不是旧 checkpoint 时点问题复发。 |
| N02 盟友命中状态写玩家、自然 legacy | **已闭合（所列目录与归属）** | `M:322` 的 effective 门、`M:1612` 等传真实 target 到 `G:6161`；`T/x2c_hit_status_owner:24–31` 三个自然 legacy 行均不生效，`:34–68` 真实攻击后受击鼠获得指定状态，非受击玩家仍为 0。保留定义及显式运行时能力，不做全表清空。 |
| N03 附魔目标/力量/次数/弹药/随机符文 | **已闭合（变更语义）** | `G:5337 → E/Items/ItemUseCoordinator.ts:32–65` 验包内实例、选定对象、力量下限 0、次数/附魔/弹药组和解咒。`T/x2d_scroll_equipment:69–106` 精确检查数量、quiver RNG、拆分回堆及 DONNING；`:159–175` 真选备用护甲，原装备不变；`:198–227` 八事件同步/动画回放一致。XN03 属下游详情债，不否认正确附魔变更。 |
| N04 解咒只优先装备、抹负 E | **已闭合** | `G:3935 → G:5285` 遍历背包清诅咒；`T/x2d_scroll_equipment:178–195` 所有包内件解咒，负 E/次数/力量/符文原值不变，地面物品仍诅咒。 |
| N05 派生 passable/opaque 分裂 | **已闭合（列举写口/消费者）** | `E/Map/Grid.ts:815–821` 合并四层 flags，`:956` 等写口刷新；存读重新派生。`T/x2b_terrain_derivation:90–108` 钉住 TORCH_WALL/FOLIAGE 自然样本并检查两个 seed 的 D1–40 全层；`:123–149` 腐坏缓存恢复、DF/晋升/火写口；AST 写口守卫仍在。各用途 cost 不应统一成一个 bool，一般 AI 全权重另留。 |
| N06 发现概率、OOS 中文、描述与能力 | **部分** | `E/UI/Discoveries.ts:18` 使用同一生成池；`T/x2i_discovery_text:19–31` 行集合、creeping death 入池及未知概率分母相等，`:38–69` 真燃烧攻击、免疫、盗窃/潜没文案和中文 OOS。完整杖数值详情仍缺，XN03 另证武器详情失真。 |
| N07 缺失原生效果族 | **已闭合（点名族）** | 六种新护符由 `G:4001 → E/Items/ItemUseCoordinator.ts:86–145`，lichen/darkness/ROT_GAS/潜没由 `G:3742,5938,5941,6663`、`M:828` 接入。`T/x2e_charms:54–66,140–169` 对 624 个 CE 曲线值、真守护者/存档/到期；`T/x2g_native_effects:52–86,92–142,160–197` 对喝/扔/死亡 DF、负光、血量、潜没骰子、身份与命中及续行。不是全 CE 效果穷尽声明。 |
| N08 投掷 clump / 舍入 / 耗骰 | **已闭合** | `E/Combat/Combat.ts:423–445` 消费实例 clumping、有效附魔和截断；`T/x2f_thrown_math:30–50` 对原 C 分布/调用路径，`:53–94` 对 miss、俘虏自动命中、武器免疫、slaying 各短路耗骰。 |
| N09 公开 test 模式退池内容可达 | **已闭合（公开入口）** | `G:2058–2157` 取 gen 池、过滤退役符文/蓝图；`T/x2h_test_mode_reachability:19` 起从菜单载荷进入 test、通过楼梯走 D1–40、实际拾取，检查退池 ids/符文/11 蓝图不存在。保留直接构造 API 属测试/历史定义边界。 |
| N10-a 玩家自反射法伤死亡 | **已闭合（点名火/电路径）** | `G:4514` 共用致死归因/终止；`T/x2l_reflected_death:29–51` 实际反射后只伤玩家，后方怪 HP100、格草不变、死亡/高分归因正确。毒伤后续计时、独立爆炸仍走各自生命周期。 |
| N10-b AI / 盗窃 / blink 缓存 | **部分** | `E/Combat/MonsterTheft.ts:36–58` 真拆分/搬物和 PERM；`MonsterAI.ts:68` 状态树；`MonsterBlink.ts:229–239` 缓存。`T/x2j_monster_ai:38–53,84–118,198–208` 对所有权、保存、死亡落物、缓存；`:226` 起对 10240 个受控依赖 CE 状态样本。但 XN01 证死者迭代缺口，一般感知/寻路/构造边界仍有效。 |
| N10-c 即时死亡 / 落物 / 复活 | **核心事务已闭合，集成部分** | `M:409 → G:7715` 同步死亡事务，`G:7762` 延后清扫，`G:9330` 复活、`:10035` 落物。`T/x2k_lifecycle:34–94` 对原始 DF 恢复、落物先于 DF、重入、寄宿、FALLING/休眠；`:137,158` 对最高 power/平手及 256 个 CE 候选。XN01 表明“事务完成但名单仍在”的消费者合同未全部闭合。 |
| N10-d 生成 RNG / horde | **部分** | X2o 已补 horde 三元组和两个消费者（XB02）；`GC:42` 即时实化、`:144` 层种子路径保留。`M:556–563` waypoint 延迟初始化和 CE 构造/hopper 差异仍在；全生成逐骰同构没有证据。 |
| N10-e flare / 动态色 | **部分** | `G:4383–4425` 临时可见性、命令收尾、逐帧显示，动态色有目录与消费者；`T/x2m_lighting:40–56,83–94,210–223` 对临时知识/身份/消退/快慢与空闲 RNG。保留与 CE 不同的随机流和基础光近似，且新 XN02 打破回放命令边界归一化。 |
| XB01 胜利描述按堆少算宝石 | **已闭合** | `G:10531–10569` 胜利描述按 quantity 求和；`E/Core/Endgame.ts:9–31` 死亡和胜利各保原口径。`T/x2n_lumenstone_description:38–54` 普通/超胜利描述按颗、死亡按堆；`:57–85` 25 颗及 195000/160000 分的终局回放且不重复写榜。 |
| XB02 D30–39 大群漏 clump | **已闭合** | `G:1559,1722` 两个 horde 入口调用 `randClumpedRange`；`T/x2o_horde_clump:26–34` 全 175 行/91 三元组与 CE 相等；`:51–74` 原 C 路径及两条实际 RNG，`:79–113` 数量先抽后放、石像/克拉肯实际落位及召唤消费。 |
| XB03 十个风味蓝图深度上限 | **已闭合** | `src/data/blueprints.json → E/Generator/BlueprintEngine.ts:696–710` 资格消费者；明确编号仍走 `:867–884` 的原强制分支。`T/x2o_horde_clump:36–49` 全 70 个映射蓝图上下界及前后边界资格与 CE 相等，保留 CE48 和 11 自创蓝图排除。未凭零频率数据改写强制生成语义。 |

## 3. K01–K42 复判

本表覆盖所有原条目；X-1 判“部分/未闭合”的条目明确列出推进与剩余。判定承接原缺口，不能把“有一个同名测试”当作完成证明。

| ID | X-1 → 当前 | 当前执行链、抽读的真实断言与限制 |
|---|---|---|
| K01 | 已闭合 → 已闭合 | `G:8444,8490 → E/Core/WholeRunSnapshot.ts:146,204` 整世界、计量、层缓存、RNG；`T/u_03_whole_run_snapshot:159–177` 脏局加载后整快照相等并钉住 food4321/gold987/fuse37/tick1290/turn81。浏览器存储配额另列未核实。 |
| K02 | 已闭合 → 已闭合 | `E/Core/EntitySnapshot.ts:9–35,94–131` 显式字段与唯一对象图；`T/u_01_instance_snapshot:79–99` 字段合同/往返无别名与零耗骰，`:124–131` 自然普通实体数量>10并逐值相等。 |
| K03 | 已闭合 → 已闭合 | `GC:173–214,310` 层 scent/离层时间/跟随及重访；`T/u_03b_level_travel:40–56` 比较 4608 个 CE 资格样本，`u_03_whole_run_snapshot:94–105` 检查跨层/待坠/携带/leader 唯一关系。 |
| K04 | 已闭合 → 已闭合 | `E/Random.ts:76–82,100–110 → E/Core/LevelSeeds.ts:17–32 → GC:218,299`；`T/u_02a_rng_snapshot:37–38` 不重播种/不额外 raw 且全状态等；`u_02b_level_rng:18–27` 比对 uint64 元组、调用计数及 41 层种子。不是 CE 同 seed 同地图承诺。 |
| K05 | 已闭合 → 已闭合 | `G:7756 → E/Combat/MonsterAbsorption.ts:70,132 → M.takeTurn`；`T/u_11_corpse_learning:253–258` 第13行动存读后准确完成并 points1→0/安装飞行，`:281` 真调度20行动吸收且不移动。 |
| K06 | 部分 → 已闭合（专用 blink 合同） | `E/Combat/MonsterBlink.ts:149–166,229–239,339 → G:4961`；`T/u_07_monster_blink:46–55` 100 个 CE 瞄准/骰子，`x2j_monster_ai:198–208` target 移动距离>3才重算、同玩家行动复用安全图。一般 AI 留 K10，不据此外推。 |
| K07 | 已闭合 → 已闭合 | `M.tryUseBolt → G.castMonsterBolt → SPIDERWEB/VINES DF`；`T/u_08_terrain_bolts:82–98` 真蜘蛛/树精铺层及400/100 ticks、拒绝遮挡/睡眠/重复web；`:182–185` 学会 vines 的盟友实际铺藤蔓且不额外扣点。 |
| K08 | 已闭合 → 已闭合 | `E/Combat/MonsterAbsorption.ts:136 → M.syncFlagDerivedStatuses → G.applyMonsterBoltHit`；`T/u_09_learning_consumers:51–58` 22个可学/7个排除，`:178–197` 支配、刀刃与 transfer 实际 HP 消费。旧自然 legacy 问题由 K25 单独关闭。 |
| K09 | 已闭合 → 已闭合 | `G.applyMonsterBoltHit` 的 BE_DAMAGE 使用法术伤害，不再走近战 accuracy；`T/u_06_monster_damage:133–137` 真 SPARK 多目标 HP `[96,100,96]`、两次伤害抽样；玩家自反射另由 X2l 关闭。 |
| K10 | 部分 → 部分 | `M:1503 → E/Combat/MonsterAI.ts:68`，盗窃/模式/缓存已补；`T/u_12a_cast_eligibility:24–38` 队友与敌人交叉门、`u_12b_ally_mode:23–40` 玩家 FOV 外追敌及逃距，X2j 对真偷物/模式保存。XN01、一般感知/路径代价与 waypoint 仍留。 |
| K11 | 已闭合 → 已闭合 | `G.spawnMachineItem → E/Items/ItemLoader → GC:42` 原实例流转/品质拒绝重掷；`T/u_05_machine_items:25–35,63–73` 类别资源/RNG/ID及67个历史null请求均得到真实物品。 |
| K12 | 部分 → 已闭合 | `E/UI/Discoveries.ts:18 → ReferenceOverlay` 读同一 gen 池；`T/x2i_discovery_text:19–31` 集合及分母精确相等，原 creeping death 列表/生成矛盾消除；D/关闭合同见 X2a。 |
| K13 | 部分 → 部分（核心死亡/复活已补） | `G:7715,7762,9330` 即时副作用、延后摘链、复活原对象；`T/x2k_lifecycle:34–94,137–158` 有时序/重入/原生DF/候选断言，原复活抛错和普通寄宿缺失已过期。XN01 是剩余死亡对象迭代消费者问题。 |
| K14 | 已闭合 → 已闭合 | `Creature` current/max、`E/Core/TimeCoordinator` 客观块和 M 消费；`T/u_14a_status_gaps:52–57` 虚弱叠加/到期，`u_14b_status_gaps:47–53,170–177` 三次挣网移动及活动/休眠状态保存、寿命致死。 |
| K15 | 部分 → 已闭合（列举数学） | `E/Combat/Combat.ts:101–110,423–445` 共用 clump/netEnchant/截断；`T/u_13_combat_math:40–41` 1215个 CE 命中点，X2f 对投掷原 C 分布和自动命中/免疫短路。特殊状态完整组合未穷举。 |
| K16 | 部分 → 部分 | `G:4383–4425` 与 `E/Map/LightCatalog.ts`/`TerrainColorCatalog.ts` 已补来源、短暂知识、动态色；`T/x2m_lighting:40–56,83–94` 有实际揭示/身份和消退。基础光确定化、定点平方根近似、CE 主流与 web cosmetic 分工差异仍在；XN02 新增。 |
| K17 | 已闭合 → 已闭合（主展示出口） | `E/UI/MonsterVisibility.ts:8–35 → Appearance/MonsterSidebar/GameCanvas` 共用身份门；`T/u21c_flare_sidebar:32–40` 隐形后侧栏零行，`x2g_native_effects:160` 起潜没上方看不见、心灵感应不泄身份。sr-only 调试出口单列未核实。 |
| K18 | 部分 → 已闭合（点名载体） | `Grid` 历史记忆和 `E/Core/EntitySnapshot.ts:33` submerged → `M:828`/MonsterVisibility；`T/u_23_memory_mapping:12–26` 隐藏现地形变化不改记忆外观、存读旧门；X2g 对潜没概率、独立状态、可见性/命中及存读续行。 |
| K19 | 已闭合 → 已闭合（DF 事务） | `E/Map/DungeonFeature.spawnDungeonFeature → bound effects` 疏散/阻断/瞬时效果/递归；`T/u_17a_df_transaction:42–49,62–69` 真实先疏散、阻断否决无副作用、PERMIT 实际移动/报警。全目录组合及 mapToShore 不在此声明。 |
| K20 | 已闭合 → 已闭合 | `G:5584` crystalize 先验 impregnable 后铺 DF/杀怪/放俘虏；`T/u_15a_shattering:103–116` 受保护休眠怪不动、普通格先唤醒再致死及保护集合存档。 |
| K21 | 已闭合 → 已闭合（所列移动/水/钥匙） | 玩家移动、`G:7785` 深水渐进、Grid/钥匙晋升共用原语；`T/u_18_water_cage:12–23` 玩家真实进深水，`u_14b_status_gaps:47–53` 脱网移动；K02/K30 对钥匙字段与唯一所有权守卫。 |
| K22 | 已闭合 → 已闭合 | `E/Items/ItemLoader.ts:1457 → RingBonuses.ts:4–30 → Combat/ArcanaRecharge/视野`；`T/u_15b2_ring_birth:40–48` 八类频率/出生抽签，`u_15b_rings:18–28` 未知正 E 上限1/3/4、负 E 全效及消费者专项。 |
| K23 | 部分 → 已闭合（12 护符） | `E/Items/ItemUseCoordinator.ts:86–145` 全12种真实端口；`T/x2e_charms:54–66` 624曲线点，`:140–169` 守护者真实类别/位置/生命/寿命/冷却、存读后8次wait消失且不入复活池，`:257` 起全目录频率/机器入口。共用构造/落位一般边界见 §5。 |
| K24 | 部分 → 部分 | `G:6310–6338,6424–6449` 武器/护甲谱影有真消费者；`T/u_15d3_runic_generation:27–30` 全10/11槽无洞，U15d/d2 对slaying、mercy、额外攻击/护甲效果。X2d已去掉随机授符文；`E/Combat/Conjuration.ts:33–68` 安置、clone/构造耗骰的全 CE 等价仍未完成。 |
| K25 | 未闭合 → 已闭合（原自然 legacy 范围） | `M:322` effective 检查与所有命中入口传 target；`T/x2c_hit_status_owner:24–68` 三自然 onHit行失效、天然 legacy 抗性不覆盖 CE 位、显式实例状态写真实受击者。未删除历史定义或把显式注入测试能力一并禁用。 |
| K26 | 部分 → 部分 | `E/UI/DetailGenerator.ts:440–467` 杖主要显示充能/回电，完整当前/升级后数值未齐；`:355–363` 还有 XN03。护符、发现、燃烧/盗窃/潜没、退池入口已由 X2e/h/i/j/g 各自关闭，不能将全部旧文案债原样沿用。 |
| K27 | 已闭合 → 已闭合（含深层链） | `GC:335 → E/Generator/Stairs.ts:11–40` 最终资格后落位；`T/v_2b_9e_2_autogen:238–249†` 实际 CE66 调度/耗骰/wired，`c_8_connectivity:176–201†` 30seed×25层双向可达；本轮已运行 `u_26a_deep_levels:179–250` 真D40楼梯链和终局入口。 |
| K28 | 已闭合 → 已闭合（原机器/30 缺 tile） | `DungeonFeatureCatalog → 晋升/祭坛/AutoGenerator` 真实出口；`T/u_19f_autogen:17–37` 21tile/24DF全字段、missing空、49行目录/48执行行；`u_19d_machine_families:77–82` CE28真笼内物品唯一、U16真复活、U19e/f真机器交互。不是每台自然成功率证明。 |
| K29 | 已闭合 → 已闭合 | `E/Generator/BlueprintEngine.ts:294,405` 密门映射及 feature 写层；`T/b2_transcription:249–263†` 真实 applyBlueprint 后，无显式层清其他层、显式层保留水/草/气，严格比较输出数组。 |
| K30 | 已闭合 → 已闭合 | `BlueprintEngine` 领养/外包/携带 → `GC:42` 单实例运行时；`T/u_05a_item_ownership:96–100,166–179` 只一个最终容器、旧携物移除后所有容器均不持有它。 |
| K31 | 已闭合 → 已闭合 | `GC:214,375` 生成/重访按最终 Grid 重建 machineCells，快照亦重建；`T/u_04c_machine_cells:45–55` wired/origin 集合精确相等且 RNG 不变。历史即时存读可见ID异常仍未核实，不等同当前集合算法失败。 |
| K32 | 部分 → 部分 | `E/Generator/BlueprintEngine.ts:2365` viewMap、pending 占用和 `GC:42` 即时实体；`T/u_19a_machine_view:23–26` 579 masks、`u_19b_pending_occupancy:31–43` 64真值、`u_19c_immediate_entities:30–40` 时序/抽样oracle。X2o补全 horde clump；构造/性别/hopper/waypoint RNG仍留。 |
| K33 | 已闭合 → 已闭合（机械观测能力） | `E/Generator/MachineObservation.ts:47 → runner`；`T/u25_machine_observation:8–28` 四seed D1–26开关观测结果全等、committed非空。证明工具中性与来源可观察，不是机器CE正确率。 |
| K34 | 部分 → 已闭合（点名药水/DF） | `G:3742,5938,5941 → DF/状态/负光`；`T/u_15e_potions:20–39` life加10maxHP/治疗，`x2g_native_effects:52–86` 真喝/扔/死亡地衣与 darkness 气体/喝下状态不同，存读相等；发现池同步恢复。 |
| K35 | 已闭合 → 已闭合 | `G:3811 → finishItemUse → TimeCoordinator` 自动吃/不够饿确认；`T/u_15f_food:16–33` 拒绝不改物品/时间/RNG、接受后nutrition2149；U27保存确认false/true。没有芒果治疗需求。 |
| K36 | 已闭合 → 已闭合 | `E/Items/Inventory.ts` 合并/容量 → 拾取/丢弃/投掷；`T/u20_inventory:13–24` 食物按份占容量、两堆合为5、金币不占包；U26a宝石同来源层满包合并/整堆/来源保存合同保留。 |
| K37 | 部分 → 已闭合（原深层/结算合同） | `GC:700–795 → G:3022,10531 → E/Core/Endgame.ts`；`T/u_26a_deep_levels:29–38,179–267` CE40/配额/三seedD40/入口拒绝；`u_26b_endgame:17–27` 真分数；X2n关闭最后的胜利描述计数。一般放置回退和自然有限资源全局通关另列未核实。 |
| K38 | 部分 → 部分 | `G:2613,2629,2799,2826` 命令/选物/确认/checkpoint已接，X2a/U27真回放断言通过；XN02 仍可由显示帧改变 item:use 默认目标，不能对全部新局录像结案。完整自然深层日志/seek未核实。 |
| K39 | 已闭合 → 已闭合 | `G:505` 重开清 run state/旧Grid端口，保session回调；`T/u_00_new_run:128–187` 四mode×四入口脏A→B与新B整状态/两流相等、旧集合不别名清空、旧Grid不能唤醒新局。 |
| K40 | 已闭合 → 已闭合 | `E/Map/LightCatalog.ts:307–318,334–416` 79列与实际深度矿灯 → G视野；`T/c_7_lighting:129–133,609–630` 7900/79及真黑暗缩小/恢复，`u_26a_deep_levels:164–174` D27/30/39/40定点半径及D40黑暗11。不含K16保留的全光学序列。 |
| K41 | 部分 → 部分 | X2i将动态局部const错误链纳入门禁、实际 OOS 中文；`T/u24_hardcoded_text:46–59` 中文发现/符文名，`x2i_discovery_text:59–69` 能力及OOS语义。完整描述数值合同仍受K26/XN03限制；未将静态键覆盖率当全界面语义证明。 |
| K42 | 部分 → 已闭合（列举派生/用途合同） | `E/Map/Grid.ts:815–821` 全层派生，U18a按玩家/scent/safety/waypoint职责使用不同cost；X2b自然80层、恢复腐坏缓存、DF/火写口和AST守卫。`T/u_03b_level_travel:60–61` 仍检查不同cost mask，不能反向统一成本图；完整 monsterAvoids/mapToShore 留一般AI边界。 |

## 4. X-1 §7.1 / §7.2 与 X-1b 剩余清单逐条处置

### 4.1 X-1 §7.1 的 11 个单元

| 原单元 | 当前结案及证据落点 |
|---|---|
| X2-录像提交时点 | **指定时点/关闭合同已闭合，整体验收部分**。N01的X2a断言通过；旧“首个wait必OOS”作废。新XN02及自然深层/长期渲染交错仍需覆盖。 |
| X2-legacy命中归属 | **已闭合（原清单）**。N02/K25；自然表与显式实例分开约束，受害者断言不是只查数据。 |
| X2-卷轴装备语义 | **已闭合（变更/选择/回放合同）**。N03/N04的真实备用装备、弹药、全包/地面、负E与回放；详情另列XN03。 |
| X2-地形派生与消费 | **已闭合（所列写口及职责）**。N05/K42；既有自然样本80层及恢复/晋升/火写口守卫均通过。未声称全CE寻路权重相同。 |
| X2-退池可达性 | **已闭合（菜单公开test入口）**。N09真实D1–40展陈/拾物及退役集合，11自创蓝图保持退池。 |
| X2-发现与文本语义 | **部分**。发现分母、OOS中文、燃烧/盗窃/潜没叙述已补；完整staff数值/词表与XN03未闭合。 |
| X2-投掷数学 | **已闭合**。N08实际clump、整数截断、命中/免疫/slaying短路耗骰。 |
| X2-原生效果分族 | **已闭合（点名六护符、lichen/darkness/ROT_GAS/潜没）**。N07/K23/K34；不能由此宣布所有CE原生内容穷尽相等。 |
| X2-AI与生命周期 | **部分**。盗窃/模式/缓存、死亡事务/候选、反射致死已补；XN01及一般AI/构造继承边界尚在。 |
| X2-光照表现 | **部分**。来源/临时知识/动态色已补，XN02待修；CE随机流、基础光近似有意保留；本轮无浏览器全法术视觉验收。 |
| U26a合并后复核 | **外部延期已消除，指定复核已闭合**。X-1b已完成深层核实，XB01–XB03现均有当前守卫；不继续挂“待U26a”。自然整局/资源与存储配额的证据限制单列。 |

### 4.2 X-1 §7.2 的 4 个单元

| 原单元 | 当前结案及证据落点 |
|---|---|
| CE生成逐骰专项 | **部分**。X2o关闭horde数量分布/调用顺序；`M:556–563` 仍按游荡时初始化waypoint，`C/Monsters.c:102–153` 构造中包括waypoint和hopper。`M:666` 不复制自然JSON掉落概率；不能误报自然老鼠仍按表随机掉金币。CE hopper、构造/性别和全生成事件序列尚未承接。 |
| 补盲区守卫 | **原点名五类已闭合，新组合部分**。X2a健康动画、X2d多诅咒/任意装备、X2b自然地形、X2h公开test均有真实断言；但AI×死亡名单、flare×回放item入口、0力量需求×详情三种组合漏检。既有1645项全绿与本轮发现不矛盾。 |
| 历史异常复核 | **未闭合（证据未核实）**。U04c即时存读可见实体ID、U10旧详情异常、CE38自然药水替代分布未按原步骤重现；当前通过的snapshot/机器专项不足以断言全部历史异常已消失。XN03不冒充同一历史异常。旧性能超时无新的失败证据，不派性能修复。 |
| 单例/调试出口 | **未闭合（证据未核实）**。`G:10576` 全局activeGame及全局rng仍在；`src/components/AgentControls.vue:3–70` sr-only调试出口与 `src/engine/Visuals/FloatingText.ts:18` 随机ID用途未做实际辅助技术/并行多局验证。单活跃Game重开已受U00保护，不能据此宣称多Game隔离或重新要求搬空Game.ts。 |

### 4.3 X-1b §6 其余登记

| 条目 | 当前处置 |
|---|---|
| 热图耗尽丢件/食物50次回退/孤岛改墙 | **保留，发生率未核实**。`GC:768–791` 50次选点、回退热图、仍无loc则continue；`E/Items/ItemSpawnHeatMap.ts:279–286,318–324` 八向孤岛处理仍在。现有自然浅/深基线通过不等于永无资源损失，不把潜在边界报成已发生的宝石配额故障。 |
| 完整自然深层录像/seek、浏览器持久化容量、全种子有限资源通关 | **未核实**。现有深层API往返及终局镜像夹具通过；本轮没有可自由导入的自然D1→D40全命令记录，也没有浏览器配额测量。 |
| “25颗描述14”及深层延期文档 | **产品已闭合，历史账本需标过期**。XB01由X2n修复、延期由X-1b解除；不改死亡按堆500的正确规则。历史报告保留当时证据。 |
| 过时源码注释 | **文档债仍有效**。`E/Map/AutoGenerator.ts:618–628`、`E/Generator/BlueprintEngine.ts:786–787` 的历史缺载体表述，应与当前wired目录/消费者区分；`G:1651` 旧安置注释也不能代替实际helper。此次只登记，不改原文件。 |

## 5. X2a–X2o 保留边界汇总

| 轮次 | 后续已闭合/已过期的边界 | 当前仍有效或本轮新增 |
|---|---|---|
| [X2a](x2a.report.md) | checkpoint与参考屏关闭实际修复，旧首条wait OOS不成立。 | v2命令合同、拒v1、读档后不导出残缺新局录像均为既定范围；14事件旧浏览器楼梯命令未实际换层。XN02是新显示入口遗漏。 |
| [X2b](x2b.report.md) | 全层派生/保存恢复已统一，X-1b深层与本轮专项均支持。 | 保留own字段常数时间读取及不同职责cost；全 `populateCreatureCostMap`、`mapToShore` 预算/一般A*策略并未借本轮全部移植。 |
| [X2c](x2c.report.md) | 自然legacy串写已关闭；燃烧由X2i、盗窃由X2j、腐败气/潜没由X2g、死亡时序由X2k接续。 | 数据定义和显式实例能力保留；自然JSON金钱掉率未复制，不能用它推导实际自然掉落。CE item hopper仍缺。 |
| [X2d](x2d.report.md) | 旧“只附优先装备/随机授符文/解咒抹负E”与相应过期测试前提已裁决；当前X2d和退池专项通过。 | pending卷轴知识字段与新schema合同，旧档不迁移；CE收尾自动鉴定按目标kind等条件执行，不凭直觉改规则。新XN03是正确降力量后的详情错误。旧中止全量不当作当前失败。 |
| [X2e](x2e.report.md) | 另六种护符和gen池、全12曲线/效果已补。 | 无合法guardian落点仍完成使用/冷却，有限候选避免复制CE非法坐标行为；共用安置/怪物构造的逐骰边界没有因此消失。 |
| [X2f](x2f.report.md) | 玩家投掷数学具体缺口已闭合。 | 作用域是当前玩家投掷入口，不能由其oracle推导不存在的“怪物投掷→玩家护甲”完整管线已对齐。 |
| [X2g](x2g.report.md) | lichen真实SURFACE、darkness气体负光/喝下状态、ROT_GAS和MB_SUBMERGED已补，相关药水已回正常池；行政删除/死亡统一后由X2k承接。 | 不代表全部DF组合或所有生成/寻路策略等价；存档显式新字段不承担历史schema迁移。 |
| [X2h](x2h.report.md) | 公开test退池可达性已收口；当时所述darkness/creeping和缺护符不能再按“仍未实现”沿用（X2g/e已补）。 | 展陈按九层主题循环、最多48项，蓝图只投影首feature，不是完整机器生成演示。原定义/直接构造保留、11自创蓝图继续退池；旧前提与UR2/4验收记录不是当前红项。 |
| [X2i](x2i.report.md) | 实际池/概率、动态OOS中文、MA_HIT_BURN已有真实消费者；合并恢复X2g药水/潜没文案，盗窃随后由X2j支撑。 | 完整CE数值详情/词表仍未齐，XN03新增具体证据。动态硬串门只证明已覆盖的数据流，不能保证所有未来动态日志。 |
| [X2j](x2j.report.md) | 真偷物/分堆、PERM模式、主要状态分支、blink缓存已接；其登记的落物时点/候选由X2k关闭。 | oracle替代感知/路径等依赖，只证明状态树分支；一般Scent/monsterAvoids/waypoint/构造并非整套CE。新增XN01暴露死亡后迭代语义。 |
| [X2k](x2k.report.md) | 即时死亡副作用与延后物理摘链分开正确；X2g原生死亡DF、复活还原原生DF/状态已承接。 | 完全无合法复活格保留purgatory并false，不复制CE非法坐标未定义行为；概率战利品扩展路径与CE hopper未迁移。新增XN01不是要求提前摘链，而是要求消费者跳过已死者。 |
| [X2l](x2l.report.md) | 自反射火/电致死后同格效果、下游命中与死亡归因已闭合。 | 后续毒伤和独立爆炸各有生命周期，不扩大为所有致死源已由同一bolt分支穷尽验证。 |
| [X2m](x2m.report.md) | flare来源、临时知识/FOV、193地形动态色与空闲续流有真代码/断言；旧U00展示回调残留、U17未播放事件被删已修，本轮对应测试通过。 | `C/Light.c:65,374` 使用SUBSTANTIVE，web按该轮约束只用cosmetic，基础光确定化/平方根近似/队列预采样不承诺CE逐帧逐骰相同。报告“命令边界归一化”在replay item分派漏接，XN02。 |
| [X2n](x2n.report.md) | XB01胜利颗数修正，死亡按堆及计分规则保持正确。 | 已存历史高分描述不迁移是范围选择，不是新终局仍少算。 |
| [X2o](x2o.report.md) | XB02全horde三元组/两个消费口、XB03全70蓝图深度关闭。 | CE48本身禁用且web未纳入、11自创蓝图继续退池；不等于全构造/生成逐骰同构。旧并发负载超时后同输入原门限全量通过属历史记录，本轮未复现为失败。 |

跨轮合并/验收记录按其最终状态阅读：例如 X2d 的旧拒绝对象/授符文前提、X2h 的展陈前提、X2m 的C-7载体登记、X2o 的horde对象形状与深层基线变更，均不能只截取报告中的第一次红项。本轮未重新裁决、修改或重捕获这些材料；当前既有断言通过只证明其当前合同，不自动证明未被其覆盖的组合。

## 6. 本轮新差异及重点扫描结果

### XN01：已完成死亡事务的对象仍影响恐惧状态和本回合走位

**玩家可见，未闭合；AI×死亡集成遗漏。** `G:7715–7759` 已同步落物、DF并置 `deathProcessed`，但按CE规则延后物理摘链。`TimeCoordinator.ts:353–357` 的回合前入口调用 `removeDeadMonsters(false)`，直到 `:464–466` 尾声才清扫。因此在名单中留下“hp=0、事务已完成、不再占格”的对象是正常中间状态。

问题在 `E/Combat/MonsterAI.ts:50–65,85–91`：恐惧扫描直接遍历 `[player,...monsters]`，只检查观察者 `m.hp`，没有过滤目标死亡。对照 `C/Monsters.c:1753–1762` 同一恐惧扫描使用 `iterateCreatures`；该迭代器在 `:925–947` 初始化及前进时均跳过 `MB_HAS_DIED`。故不是“CE也延后摘链所以行为相同”。

三个探针均从seed22013的headless test局建立明确的平地内存夹具。此处用原目录 rat(12,10) 和友方 revenant(13,10)，后者由原 `takeDamage` 真正死亡：结果 `{hp:0, processed:true, listed:true, occupies:false}`。`monsterFleesFrom` 仍为 true，原 `updateMonsterState` 将rat置为 FLEEING(3)；仅调用原清扫后，相同判断恢复 HUNTING(2)。再经真实 `executeCommand('wait') → TimeCoordinator → M.takeTurn`，未预清扫支线走到 `(14,12)`/FLEEING，原清扫对照走到 `(11,10)`/HUNTING；主流计数分别2571/2574。证据在 runtime-observations 的 `corpseFear`、`corpseFearTurn`。

这是合成平地/阵营夹具，不证明自然发生频率；无需替换任何被测函数即可触发。X2j测试活体恐惧、X2k测试即时事务与延后清扫，各自通过仍漏掉二者交界。后续应约束消费者/迭代器跳过已完成死亡者，保留CE的延后摘链时点，并回归同回合位置/RNG与寄宿/重入。

### XN02：闪光展示帧进入回放法器目标选择，第三条命令 OOS

**玩家可见，未闭合；光照×录像入口遗漏。** 正常 `G:2613–2622 executeCommand` 先 `finishTransientDisplay()` 再 `applyCommand`。`G:2799–2818 replayStep` 直接 `applyCommand`，没有同样的归一化；普通动作还能经过 `G:2897 performPlayerAction` 补做收尾，但 `G:2629–2648` 的 `item:use` 直接 `useArcanaItem`，绕开了它。

`G:4383–4425` 的flare显示会修改格子的临时可见性；`E/Combat/BoltTargeting.ts:25–40` 用可见性筛目标；`G:4001–4042` 取第一个候选为默认cursor。`src/components/GameCanvas.vue:652,670` 的真实ticker分别调用回放和flare，说明渲染交错入口存在。本轮只调用原帧函数模拟单步交错，没有浏览器视觉实测。

镜像夹具：黑暗中的玩家 `(10,10)`，rat `(14,10)`，力量药水、已鉴定迟缓魔杖10发。实际 `quaff → tickFlareAnimation(10) → use → confirm_target` 录制三事件。录制的use在命令边界清瞬态光，默认目标为玩家自身，确认取消，未耗充能。回放结果如下：

| 同一录像、同一镜像初态 | use之前目标格可见 | 默认目标 | 结果 |
|---|---:|---|---|
| 无显示帧 | false | (10,10) | cursor=3/3，error=null，充能10，rat迟缓0 |
| quaff后插入一次原flare tick | true | (14,10) | confirm实际发射，充能9、rat迟缓49；cursor=2/3，第3条OOS |

见 runtime-observations 的 `flareItemReplay`。这段录像依赖显式镜像夹具，不能直接从自然D1自由导入；无显示帧对照完整通过，定位的是同一初态下显示是否泄入命令。不是用一个缺初态的片段导入失败来报bug。后续应把显示归一化放到录制与回放共同命令边界，覆盖item use/throw选择、自动与单步回放、seek及不同帧间隔；不能只放宽checkpoint比较。X2a的健康混合命令和X2m的快慢/空闲展示分别未覆盖这个组合。

CE依据与范围：临时光及其可见性来自 `C/Light.c:291–403`；这里直接违背的是web已定的命令回放确定性及X2m“显示不进入下一命令目标/AI”的合同，不要求web兼容CE二进制录像，也不把cosmetic与CE主流分工本身当成本次新回归。

### XN03：力量需求 0 被详情当成 12，显示伤害偏低

**玩家可见，未闭合；既有K26语义债的具体新定位，未证明由X2新引入。** `E/Items/ItemUseCoordinator.ts:52` 正确把武器力量需求降至0；`C/Items.c:7841–7851` 同样允许0。战斗 `E/Combat/Combat.ts:105–110` 使用0，CE `C/Combat.c:66–83` 也直接用实际需求。然而 `E/UI/DetailGenerator.ts:357` 使用 `item.strengthRequired || 12`，把合法0当作缺省。

原实例/原详情函数探针：玩家力量12，已知匕首基础3–4、E12、需求0。实际战斗共用公式净E15、倍率约2.571838，普通命中未加其他修正的端点应为7–10；详情用净E12，输出“实际伤害: 6~8 (附魔 +12)”。`runtime-observations.zeroStrengthDetail` 保存两种净附魔、实际倍率和完整详情行。这是公式/显示对照，没有声称统计实战攻击分布。后续需按合法0/未知需求分别测试，并保留未鉴定信息边界；不应修改正确的附魔或战斗公式来迎合详情。

### 扫描覆盖与未发现新增问题的边界

| 热区 | 实际抽查 | 本轮结论 |
|---|---|---|
| AI状态/盗窃/缓存 | X2j状态分支、真实搬物/拆分/保存、候选扫描和死亡中间态 | 新XN01；受控CE状态oracle不覆盖死者迭代或全部Scent依赖。 |
| 死亡/复活/反射 | kill事务时点、重入、行政/FALLING、原生DF恢复、purgatory、火/电反射停止 | X2k/l点名合同通过；XN01是外部消费者遗漏，未再发现可证实的新归因/重复DF问题。 |
| 光照/可见性/记忆 | flare显示与清理、身份门、保存、GameCanvas逐帧入口 | 新XN02；既有两流/快慢/空闲守卫仍通过，不足以证明每个命令入口隔离。 |
| 原生效果 | 全12护符曲线/端口、lichen/darkness/ROT_GAS、submerged可见性/命中/存档 | X2e/g对应断言通过，未取得新的可执行差异；不是全DF组合穷尽。 |
| 卷轴/装备/详情 | 任意包内目标、负E/解咒、降力量、弹药组、待选知识及回放 | 变更合同通过；新定位XN03。CE收尾自动鉴定的特殊条件按源码保留。 |
| 投掷 | 实例clump、整数截断、命中/免疫/屠戮短路及目标实际消费 | X2f原C路径守卫通过，未发现新增已证实差异；不扩到不存在的怪物投掷入口。 |
| 录像/深层 | 事件立即记录、推进后提交、参考关闭、item分派、seek、终局和两流 | 原N01及XB01相关终局回放通过，XN02仍使整体不能结案；自然全深层长记录未核实。 |

## 7. 结论、剩余工作与明确不做

结论是**具体旧缺口大量关闭，但尚不能宣布web在已覆盖范围内全部与CE对齐**：即使排除有意保留的显示随机流/历史格式差异，XN01与XN02仍影响既有玩法与录像合同，XN03仍使玩家详情与实际公式不一致。对齐声明应列明已通过的具体合同，不使用“全部X2测试通过”代替全域结论。

| 分类/优先 | 剩余单元 | 可检验的后续完成条件 |
|---|---|---|
| 玩家可见，先 | XN02命令边界与显示归一化 | 同一可自由导入的新局记录，含flare后法器选物/确认；不同渲染间隔、单步/自动/seek的目标、充能、时间、两流、结局一致，OOS仍能检出真坏记录。先补当前镜像最小复现，再扩自然记录。 |
| 玩家可见，先 | XN01死亡对象迭代合同 | 同回合已死目标不参与恐惧/寻敌等活体判断；保留事务期占用与延后摘链；位置/RNG、寄宿/爆炸/复活均有交叉守卫。 |
| 玩家可见，次 | XN03及完整数值详情 | 0需求、普通正需求和未鉴定边界与实际共享公式一致；补各staff当前/升级后数值和词表，逐项连接效果与中文。 |
| 玩家可见/潜在，续核 | 一般AI/寻路/谱影、落点回退 | 将Scent、monsterAvoids、mapToShore、waypoint及谱影构造的剩余合同单独比CE；对食物50次/热图耗尽先找到原地图因果证据，不靠修改基线推断修复成功。 |
| 内部，若承诺同seed则升级玩家行为 | 全生成逐骰 | horde已补；继续构造/性别/hopper/waypoint及整体事件序列。UR/U25中性和固定web基线不能替代CE事件oracle。 |
| 内部验收，未核实 | 自然完整深层录像、持久化容量、有限资源通关 | 真实D1起点可导入命令日志及深层seek、实际浏览器存储读写、资源合法通关证据；镜像夹具和无消耗距离图不能代替。 |
| 内部，未核实 | 历史异常、多Game、sr-only与随机UI ID | 按X-1 §7.2原步骤/用途复核，先证实再派修；不把旧超时或未读守卫当作当前失败。 |
| 仅文档 | 更新总账的过期条目与范围 | 标注N01原时点、N02–N05/N07–N09、XB01–XB03、深层延期等具体闭合；补本轮三项与仍有效边界；更正旧缺载体/六护符等注释。保留历史原件，不回写旧报告伪造当时状态。 |

明确不做或不作为缺陷派发：

- **CE二进制录像兼容、旧v1录像/旧存档schema迁移、读档后拼接新局录像**：当前合同是web命令录像和整局JSON快照，已有明确拒绝边界；本任务没有新增兼容授权。
- **把11个自创蓝图、退池物品/符文重新放回正常或公开test池，或删除其所有历史定义/直接构造接口**：公开入口排除已验证；历史定义服务已有测试/资料，不等于玩家自然可达。CE48自身禁用也不补进池。
- **为了逐骰同构直接把X2m光照抽样移到主流、重录生成基线**：该轮明确采用cosmetic、保留基础光近似；应作为另行界定的范围决定，不在只读复核中暗改。
- **复制CE非法坐标访问等未定义行为**：无候选的有限失败策略是有意边界，应记录而非制造崩溃。
- **凭历史注释增加芒果治疗、经验升级、重量惩罚，或以“整理”为由整体搬空Game.ts**：均无本次规格依据；旧性能超时也不构成当前优化任务。

## 8. 交付完整性与复现

新增入口：[inventory](../../scripts/x2-survey-inventory.mjs)、[stage](../../scripts/x2-survey-stage.mjs)、[validate](../../scripts/x2-survey-validate.mjs)、[audit](../../scripts/x2-survey-audit.mjs)、[read](../../scripts/x2-survey-read.mjs)、[observe](../../scripts/x2-survey-observe.mjs) 与 [探针源码](../../scripts/x2-survey-observe.ts)、[finalize](../../scripts/x2-survey-finalize.mjs)。工作区根目录下用 `node brogue-web/scripts/x2-survey-<name>.mjs` 执行；inventory第一次用`before`、结束用`after`，stage后再validate/observe，finalize最后执行。不要运行历史capture/recapture脚本覆盖旧证据。

本轮只新增本报告、`scripts/x2-survey-*` 和 `ai_docs/reports/x-2-evidence/`。前后9555个已跟踪文件逐字节不变，未暂存、未提交、未重采基线；新增文本无CRLF。各项机器核对均保存在上述证据目录。
