# X-0：全项目 CE 对齐度勘察

基准：`e1db52a718bae08e1322927fd3c5466242ed6d1f`；2026-09-24；只读源码、数据、测试与 CE。交付仅本报告、`scripts/x0-*` 和 `x-0-evidence/`。**建议先处理存档丢字段、跨局状态和生成产物唯一性，再推进玩法对齐；不建议先整体搬空 Game.ts。拆分与路线取舍由用户决定。**

最需要纠正的“完成”印象是：W 链完成的是已声明的玩家杖/魔杖合同，不是全项目魔法/怪物/持久化完成；V 链的目录身份覆盖，也不等于每台机器的玩法完成。本轮没有计算“全项目完成百分比”。

## 1. 方法、证据与域划分

按 CE 的职责和状态生命周期划分，而不是照 web 目录分工：生成决定初始世界，行动/客观时间改变世界，持久化保存世界，UI 展示玩家已知世界。物品再按 CE 类别分开，防止 W 链的强守卫掩盖戒指、护符、药水的偏差。

- 权威是此工作树的 `BrogueCE-master`，不是网络最新版或历史报告中的行号。任务中的 `../BrogueCE-master` 是相对 `brogue-web` 的路径。
- 从入口追到消费者：如 `App.saveGame → toSnapshot → serializeItem`，`tryUseBolt → castMonsterBolt → applyMonsterBoltHit`，`applyBlueprint → MachineResult → populateLevel`。关键“缺失”同时检查字段/分支和调用者；注释只用于寻找线索。
- **缺**＝CE 有而 web 无执行出口；**偏**＝已有执行出口但语义不同；**创**＝web 新增的规则/替身。旧记录已修复的写“已过期”；证据不足的写“未核实”。表中的 🟡 是整域存在实质缺口，不表示该域没有完成过工作。没有将窄抽样升级为整域 ✅。
- 静态 AST 盘点见 [inventory-summary.json](x-0-evidence/inventory-summary.json)、[Game 成员区间](x-0-evidence/game-members.json)、[测试直接 any 访问](x-0-evidence/test-any-accesses.json)、[私有同名引用全集](x-0-evidence/test-private-name-references.json)。脚本排除注释/字符串；同名引用统计不是类型证明。
- 合成对象探针见 [runtime-observations.json](x-0-evidence/runtime-observations.json)，由 [x0-observe.mjs](../../scripts/x0-observe.mjs) 执行现有代码。验证了物品/普通怪物序列化、开新局、读档、目录数量；**不是自然生成覆盖、浏览器验收或完整 CE 差分**。
- 只执行构建和只读探针，没有改测试、注入反向变体或重捕获基线；本轮没有运行完整测试套件。下表“守卫”表示读到的现有测试覆盖面，不能读作本轮全绿证明。

引用缩写（均为当前文件行号）：`C/`＝`BrogueCE-master/src/brogue/`；`V/`＝`BrogueCE-master/src/variants/`；`G`＝`brogue-web/src/engine/Core/Game.ts`；其他 web 路径相对 `brogue-web/src/`；为缩短表格，`Generator/`、`Map/`、`Lighting/`、`Combat/`、`Items/`、`UI/`、`Environment/`、`Status/`与`Random.ts`省略前缀`engine/`，`types`指`types/index.ts`。行号区间包括所读的执行分支，不仅是函数声明。测试路径除特别注明均在 `src/test/`。

## 2. §1.1 子系统覆盖表

| 域 | CE 权威位置 | web 实现位置 | 判定、已核执行路径与主要缺口 | 已有守卫（非本轮运行结果） |
|---|---|---|---|---|
| D01 地牢：房间、湖、蓝图、自动生成、楼梯 | C/Architect.c:2877–2974、3690–3740；V/GlobalsBrogue.c:109–170、173–622 | Generator/Architect.ts:324–491、812–946；Generator/BlueprintEngine.ts:658–690、1180–1800；G:1302–1375 | 🟡 房间/湖/两趟 autoGen/机器已有真实链。**缺/偏**：楼梯从含 FLOOR 的格抽取后才过滤通行，D26 不造下梯；CE66 因此仍退池；SECRET_DOOR feature 缺映射、Q 族物品资格未消费、部分机器只有起始态。见 K11、K27–32、K37。 | c_0…c_3、c_6、c_8、p1_33、V 系列、b2_transcription、generation_baseline |
| D02 多层地形、DF、晋升/机器 | C/Architect.c:3210–3285、3359–3495；C/Time.c:1173–1303 | Map/Grid.ts:1038–1089；Map/DungeonFeature.ts:612–643、710–860；Map/Promotion.ts:256–299、600–660 | 🟡 四层写入、DF 扩散、subsequentDF、wired 晋升实际执行。**缺**：135 条已登记 DF 中 30 条 tile=null；catalogFeature 会抛错，Promotion 的缓办不能当玩法完成；复活直接抛错。通用 refresh/疏散/聚怪副作用未整体接齐（K19、K28）。 | c_4a_0、c_4a、c_4b、c_4c、v_2b_3/4/5/9* |
| D03 火、气体、环境伤害 | C/Time.c:315–324、421–440、1289–1303、1390–1450、1590–1710 | Environment/Gas.ts:239–245、295–308、351 起；G:7965–8115、8990–9452 | 🟡 客观块调用火更新、两次气扩散；gas flags 分派混乱/麻痹，爆炸与毒有伤害出口。**缺/偏**：恶心无消费者；深水卷物、潜水、蛛网计时未齐，DF 刷新仍分散。气体存在不能证明它所有症状存在。 | f_1/f_2a/b/c、g_1/2/3、w_10、w_15 |
| D04 光照、FOV | C/Light.c:54–153、208–287；C/Time.c:859–913；C/Rogue.h:127–174 | Lighting/LightMap.ts:150–210；Map/LightCatalog.ts:32、301–310；G:2879–3000 | 🟡 updateVision 清光→逐层 glow→燃烧生物→矿灯→FOV 与阈值相交。**偏**：矿灯固定传 lightMultiplier=1、darkness/inWater=0；`CE_DCOLS=64` 与当前 CE 的79不符；普通怪物固有辐射/flare 不完整（K16、K40）。 | c_7_lighting、ui_1_rendering、v_2b_9c_effects |
| D05 怪物目录、horde、突变、俘虏/休眠生成 | C/Globals.c:1025–1164；C/Monsters.c:28–52、797–805、1080–1160；V/GlobalsBrogue.c:744 起 | data/monsters.json:1–20；G:1016–1032、1834–2095、2293–2312、9467–9608；entities/Monster.ts:382–433 | 🟡 rat 的 HP6/acc80/伤害1–3/双速100核对通过；候选过滤、加权抽 horde、落地、休眠表回调存在。**缺/偏**：伤害 clump 未入模型、突变全表/全部被动 DF 未逐项重核；延迟实化导致生成期占用不足。 | data/monsters.test.ts、monsterDamage.test.ts、hordes.test.ts；horde_selection、horde_terrain_spawn、v_2b_5、w_19/21 |
| D06 怪物 AI：移动、逃跑、追踪、施法、召唤、跟随 | C/Monsters.c:1313 起、1718 起、2299–2370、2596–2800、3049–3345；C/Dijkstra.c:209 起 | entities/Monster.ts:115–173、813–832、1222–1685；Map/Scent.ts:37–48、SafetyMap.ts:119–131、WaypointMap.ts:237；G:2198–2252 | 🟡 takeTurn 先召唤/施法，再盟友或敌对分支；气味/安全图/waypoint 已有消费。**缺** blink 专调度与学习；**偏**目标资格、反射回避、普通盟友选敌、深水资格；不是 CE moveAlly 的完整移植（K06–10）。 | ai_1、p4_1b/2/3/8/9/10、w_16/18/23 |
| D07 战斗：命中、伤害、偷袭、攻击几何、符文 | C/Combat.c:68–140、681–844、921 起、1193–1285、1811–1850 | Combat/Combat.ts:76–248、314–323；G:6244–6598、6718–7025 | 🟡 护甲进入命中率，匕首偷袭×5、一般×3，突进/连枷/鞭矛有真实调用。**偏**：自动命中仍调用 randPercent(100)，全伤害 clumping=1，隐形另乘1.5、虚弱固定半伤；speed/mercy/slaying 等符文非完整 CE。怪物法伤仍套近战（K09、K15、K24）。 | Combat/CombatFormulas.test.ts、armor_model/runic、b_1、p4_5/6/7、w_8/15 |
| D08 状态效果及计时 | C/Rogue.h:1990–2018、2299–2300；C/Items.c:4558–4566；C/Monsters.c:1834 起；C/Time.c:2211 起 | entities/Creature.ts:9、53–58、187–257；entities/Monster.ts:625–640；G:6090–6655、7965 起 | 🟡 poisonAmount、maxShield、速度刷新及持续期已消费。**缺/偏**：NAUSEOUS/DARKNESS/MAGICAL_FEAR、weaknessAmount、STUCK、DONNING、ENRAGED/LIFESPAN、完整 maxStatus；SEARCHING 有独立 searchingCharge，不能说全缺；营养也有独立载体。 | p1_28、p2_3、g_3、w_9/10/15/18/21/23 |
| D09 武器、护甲（目录/装备/实例） | C/Globals.c:1582–1618；C/Items.c:209–277；C/Combat.c:1193–1285 | data/weapons.json:1 起、armors.json:1 起；Items/ItemLoader.ts:1270–1405；G:3742–3771 | 🟡 dagger 的3–4/力量12和赋旗标路径已核；装备与诅咒拦截有消费者。**缺/偏**符文目录空槽和物种目标；更严重的是序列化遗漏武器 flags（K02），不能以生成时正确证明读档后正确。 | data/weapons/armors.test.ts、b_1、armor_model、b_4a、snapshotQuantity |
| D10 戒指 | C/Items.c:8685–8748；C/Globals.c 的 ringTable | data/arcana.json:323–383；Items/ItemLoader.ts:1428–1439；G:6030–6088、6142–6165、6232–6242；Items/ArcanaRecharge.ts | 🟡 双槽/自动鉴定/智慧充能可运行。**缺/偏**：6种目录缺 light/reaping；出生未按 CE 生成戒指附魔；awareness 变成telepathy/抗性，再生固定0.6回满时间；stealth/transference/clairvoyance 尚无相应完整消费者。它们是 CE 原生，不能按旧注释当自创退池（K22）。 | b_1b、b_4a、w_6_arcana_recharge |
| D11 护符（CHARM） | C/Items.c:7522–7579；V/GlobalsBrogue.c:713 起 | data/arcana.json:385–452；Items/ItemLoader.ts:1442–1453；G:4247–4280 | 🔴 **偏/创/缺**：health固定8HP、speed施加漂浮、protection随机免疫一种状态；telepathy/fire immunity进入generic日志但扣冷却；缺其余 CE 类别、附魔/效果/回充曲线。不能拿 W-15 护盾完成替它结案（K23）。 | 仅旧 smoke/物品/UI的间接覆盖；未找到完整护符 CE 行为守卫 |
| D12 药水 | C/Items.c:8063–8135、8185–8197；V/GlobalsBrogue.c:666–681 | data/consumables.json；G:3924–4072、5794–5980 | 🟡 下坠→DF→fall、探魔、火免灭火可执行。**偏**：life只回满不增maxHP；confusion喝下给hallucinating；多种持续期固定；**缺** darkness/lichen完整链，lichen退池原因是未实现而非自创（K34）。 | b_1c、b_2、c_5、f_2b、g_2；无全药水逐效果合同 |
| D13 卷轴 | C/Items.c:4904–4920、7783–8007 | G:4103–4232、5196–5699 | 🟡 鉴定选物、附魔、消魔、圣徽、碎墙、纷争/召唤有真实入口。**偏**：碎墙未查已有IMPREGNABLE集合；完整装备/状态消魔仍受模型边界；mapping没有CE记忆结构（K20、K18）。 | scroll_effects、b_1b、w_23、w_7/13、t_1 |
| D14 食物 | C/Globals.c:1577–1580；C/Items.c:7482–7499；C/Time.c:949–963 | Items/ItemLoader.ts 的 spawnFood；G:4074–4101；entities/Player.ts:124–173 | 🟡 吃食物按nutrition加并截2150、行动耗时；**缺**不够饿的确认、临饿死自动吃包内食物。CE此路径没有“芒果微量治疗”，历史欠账方向错误（K35/E06）。 | hunger_regen、hunger_curve_sim、startingKit、b_4a/b |
| D15 钥匙 | C/Items.c:4036–4087；C/Rogue.h:1391–1398；C/Architect.c:1523–1529 | G:1431–1503、7661–7689、8388–8497 | 🟡 坐标/机器号/深度匹配及消耗规则存在。**偏**：serializeItem漏originDepth与disposableHere，普通携带怪漏carriedItem；keyOnTileAt的全域生命周期未齐（K02、K28）。 | v_2b_6_keys、i_1_interaction、w_17 |
| D16 杖/魔杖（W口径复核） | C/Items.c:5131–5555、7353–7355；V/GlobalsBrogue.c:61–89、staff/wandTable | Combat/BoltCatalog.ts、BoltTrajectory.ts；G:4234–5185、8354–8386；Items/Arcana*.ts | 🟡 玩家入口→瞄准→轨迹/反射→效果→扣资源/鉴定已核；W的物品身份/资源/反射修复仍有效。**缺**强化学习；怪物BE_DAMAGE另一路；vines/web不执行。不能据此撤销W-26 §8（K05–09）。 | w_2…w_21、w_23…w_26；W-22只有审计脚本，无学习实现测试 |
| D17 物品生成、鉴定、价值 | C/Items.c:85–107、171 起、409–420、569–756、7719–7802、8861 起 | G:865–1144、1568–1693、5196–5359、8354–8386；Items/ItemLoader.ts:68–94、1270 起 | 🟡 食物保底→metered→加权类别/种类；鉴定实例/种类/绰号入档。**缺/偏**蓝图无杖/魔杖类别实化、Q重掷未消费、计量未入档、符文空槽；marketValue未接CE结算，不应派生出“要做商店”的需求。 | b_1a/b/c、b_4a/b、v_1a、w_5/24/25/26 |
| D18 玩家：力量、营养、搜索、潜行、再生、经验/负重 | C/Time.c:792–810、930–963、2211–2220、2397 起、2523–2541；C/Items.c:8685–8748；C/Rogue.h:987 | entities/Player.ts:32–50、124–173、219–222；G:6030–6088、9865–9991；Items/Inventory.ts:8–35 | 🟡 nutrition的麻痹/护符20%门与搜索充能已执行；**偏**戒指/虚弱未进入应有公式。26槽存在但不堆叠；weight只统计，不宜叫“缺CE重量负重/XP升级”（未发现CE要求这种系统，见§7）。 | hunger_regen、p1_42、p2_3、ai_1、i_1 |
| D19 盟友、俘虏、死亡/复活 | C/Combat.c:1632–1750、1934–2038；C/Monsters.c:3049–3345；C/Architect.c:3365–3368 | G:10121–10190、7693–7717；entities/Monster.ts:276–280、519；Map/DungeonFeature.ts:723–725 | 🟡 支配→demotion→转盟友、魔法释俘掉物有路径。**缺**学习、carriedMonster释放/寄宿、purgatory/复活祭坛、一般死亡群体继任；钥匙旧开笼未统一helper（K05、K13、K21）。 | w_17/19/20/21/23、v_2b_5/6 |
| D20 换层、跨层状态/跟随 | C/RogueMain.c:547–870；C/Rogue.h:2572 起 | G:1179–1300、7411–7646、8935 | 🟡 内存保存grid/怪/物/休眠，坠落有pending队列；**缺/偏**楼层气味/客观时间/普通跨层跟随与CE不同，缓存引用不能代表JSON完整；没有每层种子隔离（K01、K03、K04）。 | p1_31_35、c_5、w_16/17/19/20 |
| D21 存档/读档 | C/Recordings.c:1255–1268、1421–1455 | App.vue:105–129；G:8388–8956 | 🟡 当前层JSON可往返，但与CE通过录像恢复整局状态的方式不同。**缺/偏**整levels/RNG流/计量等；武器旗标、钥匙字段和普通怪物携带物/行动等待丢失；已有特例快照不能覆盖普通对象（K01/02）。 | snapshotQuantity、b_1b、p1_31_35、p2_0、W各持久化子集 |
| D22 胜负、结局、得分、高分榜 | C/RogueMain.c:1046 起、1255–1341；C/Items.c:8861 起；V/GlobalsBrogue.c:43–44 | G:1338、10522–10551；components/GameEndOverlay.vue:14–72；App.vue:238–248 | 🔴 有死亡/携护符逃出UI。**创/缺**深度/击杀/固定物品加分与胜利×2为自定；无CE完整D27–40/宝石/超胜利及高分保存。普通胜利不能直接套用superVictory规则（K37、K39）。 | p1_24死亡归宿；未找到完整计分/高分榜合同 |
| D23 录像、回放、种子输入 | C/Recordings.c:127 起、369 起、1421 起 | G:3059–3230；App.vue:144–231；components/ReplayControls.vue | 🟡 JSON事件导出/导入/seek真实调用handlePlayerAction。**缺/偏**事件外的背包调用、确认/选物结果未形成完整命令日志；无CE每回合RNG校验/OOS合同，读档后录制起点也非真实新局（K38）。 | p2_0_seeded_rng的种子/ID部分；没有完整交互回放CE守卫 |
| D24 UI：侧栏、消息、背包、详情、发现、目标、帮助 | C/IO.c:3897、4198–4393、4650 起；C/Items.c:3582 起 | components/Sidebar.vue:23–64、InventoryOverlay.vue、DetailPanel.vue、GameCanvas.vue:402–425；engine/UI/DetailGenerator.ts；engine/Input.ts:27–126 | 🟡 背包操作/详情/目标选择已有。**缺/偏**侧栏只有玩家状态、日志50条；发现屏及完整帮助命令不存在；详情与符文内部名/数值未全齐。W的后缀接口不是发现屏（K12、K16、K26、K41）。 | r_1、ui_1/ui_2、p1_30、p1_46、w_2/24/25/26、UI/DetailGenerator.test.ts |
| D25 地图记忆、可见性/知识 | C/IO.c:1154–1308；C/Items.c:7729–7738；C/Rogue.h 的 MAGIC_MAPPED/remembered* | G:2984–2993；UI/Appearance.ts:359–376、458–481；components/GameCanvas.vue:489–508 | 🟡 hasMemory/探魔/telepathy显示有消费者。**缺/偏**记忆渲染读当前地形，非历史地形；monsterAppearance与文本只凭格可见可显示隐形怪，选目标另有不可见过滤（K17、K18）。 | r_1、ui_1、b_1c、w_19浏览器登记；缺跨出口一致性合同 |
| D26 i18n | C/I18n.c；C/IO.c:4198 起（界面语义）；C/Items.c:7522–7555（效果语义） | i18n.ts:5–16；locales/zh_CN.json；G:6355、6394、6401；components/Sidebar.vue:32–37、79–104 | 🟡 真实客户端加载zh_CN，静态键门存在。**偏/缺**硬编码英文浮字、中文侧栏、runic内部名/旧效果描述；键齐全不证明文字与玩法一致。CE中文版和web词表不应按同一键名强比。 | p1_30_i18n_gate、i18n_scan、p1_37；缺自由文本和语义守卫 |
| D27 RNG与确定性 | C/Math.c:95–111、160–189；C/RogueMain.c:257–268、679–738 | Random.ts:43–111；G:742、1179–1300、8776；GameCanvas.vue:18–31 | 🟡 32位小随机核心/双流可运行，渲染切cosmetic。**缺/偏**64位种子高位被丢、per-level seed无载体、加载重播种；光照/互动会影响后层。`rand_range(1,1)`零耗随机是两侧一致，不是欠账（K04/E15）。 | Random.test.ts、p2_0、generation_baseline；后者不推进交互，不能证明回放或读档流一致 |

## 3. §1.2 未闭合项总清单（去重）

规模：S＝一条已存在链的小范围补线/字段；M＝多个出口或数据+行为+UI合同；L＝跨系统状态机、生成契约或迁移。不是工时承诺。影响列 `玩/生/档` 分别表示玩家可见、会影响生成结果或随机流、涉及持久化。`生=间接`表示互动消费变化会经当前共享RNG影响后来新层。依赖引用第4节派发单元。

### 3.1 仍有效及需拆分核实的规范账本

| ID | 有效性、问题与当前证据 | 来源（合并） | 影响 玩/生/档 | 依赖；规模依据 |
|---|---|---|---|---|
| K01 | **有效**：toSnapshot只有当前层；loadSnapshot清levels并重播种，meteredItems/foodSpawned/goldGenerated、spawnFuse等未入档。合成读档RNG计数51→0，既有metered值原样残留，说明恢复依赖当前实例。G:8543–8587、8776–8809、8935；CE Recordings.c:1421–1455。 | W-26第10项；W-5/6/7及W-16以后；路线图P1-32 | 是/是/是 | U02→U03；L，整局状态与迁移 |
| K02 | **有效，新证实**：serializeItem漏flags、originDepth、keyLoc.disposableHere；普通怪serializeMonster虽构造runtime，却只给polymorph/clone等特例输出，普通carriedItem/ticksUntilTurn/machineHome丢失。探针：矛旗标有→无；普通怪携带真→假、37→100、home17→0。G:8388–8427、8595–8645。 | 新；推翻V-2b-6§1.2快照完成声明，扩展W存档边界 | 是/间接/是 | U01；M，多类schema与旧档重建 |
| K03 | **有效**：普通换层缓存未保存scent；生成新层新建scent，重访没有从缓存恢复它；普通盟友跨梯/离层时间推进未齐。G:1192–1249、8917，对C/RogueMain.c:547–870。坠层幸存者队列已有，不能算缺整个跨层系统。 | parity_gap_analysis§盟友/存档；P1-35；W第10/11项边界 | 是/间接/是 | U03；L，层状态+到达队列 |
| K04 | **有效**：每层levelSeed、64位seed、完整RNG状态缺失；Random.ts:57–76只用低32位，G:1179–1300无隔离，对C/Math.c:106–110和RogueMain.c:257–268、679–738。 | P1-32；W第10项 | 是/是/是 | U02；L，一次性全生成漂移；简并rand_range债已过期 |
| K05 | **有效**：newPowerCount只由empower增长/保存，没有尸体资格/选择/行走/吸收/安装/递减/中断链；Monster.ts:519、1222，G:7693；CE Combat.c:1632–1750、1823，Monsters.c:3266–3338。 | W第1项、W-22 | 是/间接/是 | U07/U08/U09/U10后U11；L，多入口状态机 |
| K06 | **有效**：怪物blink被specificallyValidBoltTarget:117拒绝，无偏好图40周界瞄准调度；CE Monsters.c:2299–2370。玩家blink和安置原语不能替代。 | W第2项 | 是/间接/部分 | U07，依赖移动判据审查；M，专门AI支路 |
| K07 | **有效**：Bolt.ts:212–213的SPIDERWEB/VINES effect=null，经Monster:117与G:5026入口早退；CE Globals.c:525–526、684–685及V/GlobalsBrogue.c:boltCatalog。两者学习资格不同，不可一起删出候选。 | W第3项 | 是/间接/是 | U08；M，路径/落点DF+生命周期 |
| K08 | **有效/部分未全验**：学习后的TELEPORT/POLYMORPH等怪物映射/出口缺；飞行/火免有sync，invisible仅变形永久化；弱化玩家出口有而怪物受害者/浓度不齐。Monster:117、625–640，Bolt.ts:198–214，G:5069–5180；CE Monsters.c:2596起。TRANSFERENCE全伤害通路、TURRET复合位仍需专项核实。 | W第4/5项 | 是/间接/是 | U09；L，逐能力资格/命中/同步矩阵 |
| K09 | **有效**：FIRE/SPARK/DRAGONFIRE走CombatSystem.attack(caster,target)，用怪物accuracy/自身damage和护甲命中；CE Items.c:5168用staffDamage(magnitude)→inflictDamage。G:5070–5084。 | W第6项 | 是/间接/否 | U06；M，可复用玩家伤害原语但须保留BE_ATTACK |
| K10 | **有效**：一般施法/队友/反射敌人资格与CE不同；web友方bolt只查teammates，CE还排enemies；反射回避只散落在NEGATION等支路。普通盟友按玩家格可见选敌，缺完整逃险/追领袖优先级；V-7的CE33永久逃跑只写state，没有MODE_PERM_FLEEING（G:9597–9600，对CE Architect.c:1651–1653）。Monster:125–149、1253–1289，对CE Monsters.c:2598–2631、3049起。 | W第7项、P4系边界 | 是/间接/部分 | U09后U12；L，AI调度与地形策略 |
| K11 | **有效，范围扩大**：机器STAFF/WAND显式id及类别请求都返回null；Q族itemQualifiers只是指令，没有任何Game/ItemLoader读方，**地面也未消费**，不仅携带路径。携带收口还丢品质字段。G:1035–1144、1468、1496–1503；BlueprintEngine:1623–1629、1783–1785；CE Architect.c:1504–1509。 | W第8项；V-2b-2a、9e-2的CE8奖励 | 是/是/部分 | U05；L，实例先生成再流转/重掷/资源初始化 |
| K12 | **有效**：完整发现屏和D入口不存在；只有magicCharDiscoverySuffix与背包极性。Input.ts:27–126，对CE IO.c:4372–4393。 | W第9项 | 是/否/否 | U22；M，分类/未知信息边界 |
| K13 | **有效**：carriedMonster字段存在但普通死亡未释放完整寄宿链；复活DF抛错；普通群体继任不是W支配demotion已有路径的同义词。Monster:280、543；G:7693–7717、10121–10144；DF:723–725；CE Combat.c:1934–2038。 | W第11项 | 是/间接/是 | U03/U14后U16；L，死亡、关系、复活祭坛 |
| K14 | **有效**：NAUSEOUS/DARKNESS/MAGICAL_FEAR/weaknessAmount及若干maxStatus、STUCK/DONNING/ENRAGED/LIFESPAN缺或近似；G:2882–2885固定无黑暗，Creature:9、53–58；CE Rogue.h:1990–2018、Items.c:4558。SEARCHING/营养已有独立表示，不能整表机械补字段。 | W第12/13项；V-9d恶心 | 是/间接/是 | U14分两轮；L，时间/AI/光/伤害/保存消费者 |
| K15 | **有效，新增子项**：clumping=1不只怪物，Combat.ts:83、208–213也覆盖玩家；CE Combat.c:1245消费damage全range。自动命中仍多掷一次、额外隐形×1.5、虚弱固定半伤（:201、223–248），CE :1239短路及:68–108公式不如此。 | W第14项；P0-1旧clump登记；本轮扩展 | 是/间接/否 | U13；M，核心公式/RNG调用次数 |
| K16 | **有效/表现部分未实测**：flare/固有生物光/侧栏怪物条目不齐；力场等无terrainAppearance专用case而落黑色空白。G:2937–2971、Appearance:189–192、458–481，对CE Light.c:208–281、IO.c:4650起。射线末帧残留仍是历史浏览器登记，本轮未重现。 | W第15/16项；V新地形DEFAULT_LOOK | 是/光可影响主流/否 | U21/U23；M–L，逻辑光与渲染需分开 |
| K17 | **有效**：monsterAppearance与render_game_to_text按格可见返回怪物，不检查真正隐形；目标候选另走canObserveBoltCreature。Appearance:462–476，GameCanvas:491–494，CE IO.c:1253。 | W第17项 | 是/否/否 | U21；S–M，统一多个展示出口 |
| K18 | **有效**：MAGIC_MAPPED、rememberedTerrain/flags、MB_SUBMERGED缺独立完整载体；hasMemory下读现地形（Appearance:359），CE Items.c:7731保存历史值。IMPREGNABLE已存在，不再列缺字段。 | W第18项 | 是/否/是 | U23；L，知识与物理状态分离 |
| K19 | **有效**：DF返回evacuationRequired/aggravateRadius等并不等于副作用落实；spawn递归未形成统一生物/物品refresh事务；DF.ts:774–776、839–859，对CE Architect.c:3210–3285、3359–3495。W obstruction局部补丁只证明那条路径。 | W第19项；C-4b/V缺口 | 是/是或间接/部分 | U17；L，生成/互动共享出口 |
| K20 | **有效**：crystalizeFromPlayer没有IMPREGNABLE门，直接把阻挡层变FORCEFIELD；G:5571–5586，对CE Items.c:4911–4913。 | W第20项 | 是/间接/否 | U15a；S，已存在集合的消费者补线 |
| K21 | **有效**：canMoveTo仍排深水；CE深水允许游泳并另处理卷物。蛛网为近似；钥匙开笼仍有旧关系写法。G:9711–9723、9234起，对CE Time.c:557–577、Monsters.c:1313起。 | W第21项；P1-25/39 | 是/间接/是 | U18，依赖U14；L，移动/逃险/落位/物品链 |
| K22 | **有效**：戒指效果/附魔/实际附魔可见程度未完整CE；awareness错误给予telepathy与抗性、regen忽略E；6种戒指都经genRings入池。G:6142–6165、6232–6242，ItemLoader:90、1428–1439，对CE Items.c:8685–8748。智慧充能已接，不重复修W-6。 | W第22项；P1-14；parity_gap | 是/是/是 | U15b；L，目录/实例/公式/显示 |
| K23 | **有效**：护符整个模型见D11；telepathy和fire_immunity目录有而调用只打日志。G:4247–4280，对CE Items.c:7522–7579。 | W第22项；parity_gap第67行 | 是/是/是 | U15c，复用U14/W原语；L，不宜只改单个speed字符串 |
| K24 | **有效**：缺W_MULTIPLICITY/SLOWING/PLENTY、A_MULTIPLICITY/BURDEN/VULNERABILITY/IMMOLATION等生成映射；slaying物种目标、speed额外一击、mercy复活至1HP等偏差。ItemLoader:347–375，G:6347–6422，对CE Combat.c:681–844、921起。A_MULTIPLICITY消魔识别不等于动态生成完成。 | W第23/25项；旧符文债 | 是/是/是 | U13后U15d；L，目录/效果/谱影/保存 |
| K25 | **有效/未穷举**：onHitStatus/statusImmunities/legacy abilities仍可影响状态；G:5100–5108、6142–6230，Monster:191–215。是否每个残留都在当前自然目录可达，未做全目录逆向证明；不得全清或给消魔虚构规则。 | W第24项 | 是/间接/是 | U12/U14/U15；M，逐物种归属审计 |
| K26 | **有效**：完整CE数值详情、词表和退池旧描述未齐；staff_of_light保留定义非SHIELDING效果，普通词表非全CE woods；G符文浮字仍英文，详情与实际E/资源需逐项核。 | W第26项；W-7；handoff突进措辞 | 是/否/否 | U22/U24；M，按已落实玩法校正文案，不反推规则 |
| K27 | **有效**：CE66楼梯孤岛根因仍在楼梯候选，AutoGenerator.ts:554、674仍退66；G:1325–1347先抽含FLOOR的格；CE Architect.c:3690–3740检查最终落位。不能先删过滤。 | V-2b-9e-2§5.1；P1-19/20/33安全遗留 | 是/是/部分 | U04；L，楼梯/入场/生成门禁 |
| K28 | **有效**：机器后继缺tile/祭坛交互未齐；CE24暗杆、CE52电晶、CE55虫道仍资格退池；CE47闭祭坛由领养资格排除；CE6置换/CE7复活、麻痹喷口/裂雕像payoff未闭合。BlueprintEngine:679–688、839起；DF_MISSING_TILES 30条；CE V表及Time.c:1173起。 | V-2b-3/4/5/7/9b/c/d/e、B2四处DF留形 | 是/是/是 | U17分族→U19；L，闭包+交互+可解性，见3.3 |
| K29 | **有效**：SECRET_DOOR虽是Grid枚举，却不在BlueprintEngine私有地形映射/外观表，feature写入被跳过；CE17/F0、27/F1不是已落密门。BlueprintEngine:1500–1557；data/blueprints.json对应feature；CE V/GlobalsBrogue.c:304–307、358–359。 | B2§4 | 是/是/否 | U04b；S–M，映射和全层可解性会漂移 |
| K30 | **有效**：领养品无条件进入itemSpawns，随后又携带；Game分别spawn两次。BlueprintEngine:1614–1616、1692、1783；G:1468、1497。CE Architect.c:1499–1501、1527–1529、1705–1710只流转一个实例。 | V-9e-1/2 | 是/是/是 | U05a先于U05；M，所有权及递归失败回滚 |
| K31 | **有效**：生成machineCells来自∪mr.cells，漏外部feature；读档按全grid.machineNumber重建。G:1309–1311、1365–1369、8921–8926；CE Items.c:463–535/Architect.c:3830的IS_IN_MACHINE。新流恰未观测到不等于修复。 | V-2b-3、9e-2§5.3；P1-41 | 是/是/是 | U04c；M，热图/传送/落物消费方一起反查 |
| K32 | **有效**：MF_IN_VIEW_OF_ORIGIN无viewMap消费者；前厅HAS_ITEM停增长未接pendingItems；horde额外随从延迟实化导致占用/个体代价与CE不同。BlueprintEngine:1920–1927、2279起、pendingMonsters；CE Architect.c:532–535、712、1185。NEAR/FAR原点错误已修，不混在本项。 | V-2a、V-2b-2a/5/9e-1 | 是/是/部分 | U19；L，三子轮：视图判据→前厅占用→实体时序 |
| K33 | **有效/部分未核实**：机器覆盖仍有人工语义核对、延迟实化和空转风险；需要逐feature来源/产物唯一性观测。现有性能超时历史不能当本机当前回归，本轮未测全生成耗时。 | handoff“无法机械核验”；V-2a-perf、V-2b-7 | 否/验证面/否 | U25；M，观测工具与定向测试；性能先测再定 |
| K34 | **有效**：life/confusion/持续期与CE偏离；lichen/drink/thrown DF未完整，darkness目录/状态链不全。G:3942、3985–4005、4016、4034–4047，对CE Items.c:8067–8135；消耗品表life effect=heal_full。 | 本轮重核；P1-44/45旧项拆解；parity_gap | 是/是或间接/是 | U15e；M–L，逐效果子轮；lichen回池单列需在场 |
| K35 | **有效**：自动进食与不够饿确认缺；G:4074–4101只有直接remove→加nutrition；CE Items.c:7482–7499、Time.c:949–963。麻痹与护符饥饿门已过期，不重复实现。 | P1-14 | 是/间接/否 | U15f；S–M，交互确认/客观块顺序 |
| K36 | **有效**：Inventory.addItem只查槽数后push，同种堆叠缺；CE Items.c:867允许满包仍收可堆叠物。Inventory.ts:12–21，投掷弹药/拾取会受影响。weight不是CE重量惩罚的授权。 | 全项目新补登记（原已有quantity不等于stack） | 是/间接/是 | U20；M，拾取/丢弃/投掷/存档数量 |
| K37 | **有效**：D26断下梯、CE最深40/宝石/超胜利缺；得分自创，高分榜无持久化。G:1338、10539–10551，对CE RogueMain.c:1305–1341、Items.c:8861。 | parity_gap§9；本轮复核 | 是/是/是 | U26，依赖U03/U04/U20；L，终局扩展分深层/分数两轮 |
| K38 | **有效/端到端未核实**：仅handlePlayerAction记录，InventoryOverlay直接调用quaff/read/equip等及目标结果未完整记录；重放也不校验存入的tick/loc，G:3071–3098、3182–3195。录制框架有，不等于所有交互可复现。 | parity_gap§录像；P2-0边界 | 是/间接/是 | U27，依赖U02/U03；L，完整命令日志与OOS |
| K39 | **有效，新证实**：startNewGame未清stats、pendingFallenByDepth、isGameOver；探针保留金币987/击杀12/maxDepth18和旧坠层键。App:240只重置isGameOver，故正常返标题缓解结束锁，**不能说普通重开一定卡死**；统计串局仍成立。CE RogueMain.c:214清rogue。 | 本轮 | 是/间接/是 | U00；S–M，枚举run级状态和单例重入 |
| K40 | **有效，新发现历史事实错**：LightCatalog:32写CE_DCOLS64，矿灯基半径:310用它；当前CE Rogue.h:127、168、174得79，web types:46–53也79。除爆炸/传送光范围，矿灯实际计算受影响；以此树为准，不能沿用C-7“64”黄金值。 | C-7报告§一“单位口径”及生产注释；本轮纠正 | 是/可能主流/否 | U21b；M，公式/常量测试重核，勿只改期望 |
| K41 | **有效**：i18n静态门只覆盖可解析t调用，硬串与描述语义不受保护；G:6355/6394/6401英文浮字、Sidebar:32–37中文硬串。 | P1-30；handoff硬串/突进文案；W第22/26项 | 是/否/否 | U24；M，真实zh_CN渲染与语义对照 |
| K42 | **有效**：Grid派生passable/opaque仍小白名单，与全层flags及AI各cost图分裂；Grid:1043–1054，Scent:37–48、SafetyMap:119–131、WaypointMap:237，对CE Monsters.c:1313起/地形flags。这不意味着所有图应共用同一个“可走”布尔值，CE各职责本就不同。 | P1-38/40；P1-25更正 | 是/是/部分 | U18a；L，按玩家/气味/逃跑/waypoint逐消费者定义合同 |

W-26原26项逐项去向（无遗漏、无重复建账）：`1→K05; 2→K06; 3→K07; 4/5→K08; 6→K09; 7→K10; 8→K11/K37; 9→K12; 10→K01/K03/K04; 11→K13; 12/13→K14; 14→K15; 15/16→K16; 17→K17; 18→K18; 19→K19; 20→K20; 21→K21; 22→K22/K23/K26; 23/25→K24; 24→K25; 26→K26`。其中W第15项的全知回放并入K38，W第8项的价值读方并入K37。

### 3.2 已过期、错误归因或已缩小的历史项

| 历史登记 | 复核结论与代码证据 | 剩余归属 |
|---|---|---|
| E01 P1-1/5/7：怪/武器伤害记法，P1-2 horde数据“全空/七种” | **旧总体断言已过期**：rat与dagger实值已按解析后范围相等；hordeCandidates→pick→spawnHordeAt真实存在（G:1834–2095）。未逐条重验全部物种/突变，不引用旧百分比。 | K15、K25；完整表见§7 |
| E02 P1-3开局；P1-4/14麻痹/护符饥饿 | **已过期**：G:808–847真实发口粮、匕首、15镖、皮甲；Player:127–132有麻痹/20%门，对CE Time:2213–2219。 | 再生戒指/进食仍K22/K35 |
| E03 P1-15保护字段零读者 | **已过期（酸蚀）**：Monster:1091、1675实际检查isProtected；G:5340–5359写保护并去诅咒。不能据此称全部disenchantment齐。 | K24 |
| E04 P1-16三卷轴占位；P1-22无下坠；P1-23无DF | **已过期**：G:4186–4197调用真实blast/地形；3962–3966→playerFalls；DF.ts:710–860执行铺装/后继。 | K19/K20/K28 |
| E05 P1-21自创生成池、`_random_good_`、自创祭坛组 | **所指旧入口已过期**：ItemLoader.gen*过滤excludeFromGeneration；BlueprintEngine:635–647/689拒绝11个null CE蓝图；现有生效分支无随机好物/祭坛组塌陷。不扩大成“全库所有自创规则均已退役”。 | K25/K34 |
| E06 parity_gap“芒果应微量治疗” | **错误前提，关闭**：CE Items:7482–7499仅加nutrition/消耗/回合；G:4084–4087同类营养路径。不得新增治疗。 | 进食确认另K35 |
| E07 P1-24死亡怪残留、P1-27淹死 | **旧淹死机制已退役**：G的WEB_ONLY_DEEP_WATER_DROWNING恒false；死怪统一removeDeadMonsters:7693–7709。本轮未重跑每个死亡源，不冒称全部一致。 | K13/K21 |
| E08 P1-31/34/35出生/loopMap/waypoint陈态 | **对应修复已存在**：G:1707–1729周边落位；1283后analyzeLoopMap/rebuild；8909–8917加载重算loop/waypoint并清scent。清空气味是防陈态，不是CE恢复语义。 | K03 |
| E09 P1-37烧焦地板冒充机器、P1-36中心护栏空转 | **旗标旧替身已过期**：G:8519存machineNumber、8921–8926重建；blueprint_center现按feature/机器实产检查。读档/生成machineCells不一致仍有效。 | K31/K33 |
| E10 P1-42搜索无入口；P1-46 WASD冲突 | **已过期**：Input:47–80 vi/箭头和s/S→search，G:3388→manualSearch:9967。 | 无需另开“接s键”轮 |
| E11 P1-44火免药水无效；P1-45幽灵气 | **旧具体行为已过期**：G:4028施immune_fire并灭火；creeping_death:4016只日志，不再写GasType.FIRE。lichen仍未实现、仍退出生成。 | K34 |
| E12 P1-47 explosion_immunity补标签 | **原方向错误且已修**：Status/statusConfig.ts的isSidebarVisibleStatus显式隐藏；Sidebar:54–55消费；CE Globals.c状态名表该项空。 | 不应补可见标签 |
| E13 P1-48/49种类鉴定丢失/未知显示；P1-50/53无计量/随机好物超发 | **对应结构已修**：G:8576–8581、8784–8800往返鉴定/绰号/极性；spawnPopulateItem:879–919先计量再抽取。未复测历史分布数字。未知详情还需按新物品逐项审；整局计量保存仍缺。 | K01/K11/K26 |
| E14 V-2a NEAR_ORIGIN用center、trapVaults死循环、cap41、area/profile/no-machine | **指定旧形态已过期**：BlueprintEngine:2216起以origin计算；G:1253实际populate不带trapVaults；LoopMap当前cap176；Architect.redesignInterior:252起、fillAreaInterior:1944起、AutoGenerator13个MT行已wired。CE66仍退池。 | K27/K32 |
| E15 V-2b-1“CE rand_range(1,1)也耗骰” | **原事实错误，关闭**：C/Math.c:160–166在计数前`upperBound<=lowerBound`返回；Random.ts:97–105相同。debug C分支:141–151也相同。 | 不得据此移动全局RNG |
| E16 V-2b-5 RUBBLE未有/69、70无autoGen/MachineResult无feature落点 | **已过期（这些子项）**：DungeonFeatureCatalog已接RUBBLE；AutoGenerator MT行wired；BlueprintEngine有featureSpawns。**裂雕像中间态未齐**不能连带关闭。 | K28 |
| E17 W-0旧十身份/玩家轨迹反射/毒/掘地/阻障/护盾/刀刃/支配/变形/克隆缺席 | **指定“缺席”已过期**：G:4335–4517真实提交/轨迹；4691–5001按效果分派；W各独立原语已被调用。强化的数值计数与学习必须分开。 | 仍保留W→K映射全部限制 |
| E18 V钥匙“任意钥匙开任意锁”、领养KEY全丢 | **未存档时旧缺口已过期**：G:7662–7667有category/depth/loc/machine判定，:1450只跳过非领养KEY。**V-6声称快照完整则不成立**，见K02。 | K02/K30 |
| E19 P1-13统计脆弱/P1-26旧play快照/并行超时 | **不能按旧数字判当前失败**：当前invariant/generation_baseline及显式文件门已存在；本轮未跑这些长测，旧样本失败率/耗时为未核实。 | K33；不要以build成功替代性能结案 |
| E20 P1-6丢quantity/伤害解析、P1-17护甲展示 | **对应旧bug已过期**：G:8397/8436往返quantity；DetailGenerator:312用CombatSystem.parseDamageString，:360用armor+ne，:183–185用playerDefense公式重算内部防御；不能再派同名修复。 | 新的字段丢失K02、其余详情K26 |
| E21 P1-12水生horde无法匹配落点 | **“没有匹配路径”已过期**：G:1953–1972实际按spawnsIn匹配地形/排占用/抽池，populateLevel有调用。枚举候选替代CE拒绝采样不等于逐骰同构，全horde合同未全验。 | K04/K32及§7 |

路线图其余同义项：P1-6/17的具体旧bug已关闭（E20）；其余详情不完整归K26，P1-19/20/33落位归K27/K31，P1-25/38/39/40通行归K21/K42，P1-41路径距离归K31/K32，P1-43物品闸归K11/K30，P1-51的“CE原生却当D2”归K34，P1-52甩尾的原bug归因已被撤销，当前气味等待周期未在本轮做端到端差分。P0/P2已存在测试、tick/动画设施；其本轮复核仅限已引述执行路径，不按历史勾选认定整条全齐。

### 3.3 V链剩余载体的精确边界

运行时目录盘点：**135个DF条目，30个缺tile条目（不是30种不同tile）**；自动生成表49行：17 wired、28 no-tile、3 c7-light、1 dead-index0；wired里CE66仍被过滤，因此不能称17行全部活跃。详单在runtime-observations.json，来源为模块真实导出值，不是数注释。AutoGenerator:674确实以carrier/退池集合跳过条目；但`no-tile`只是历史分类名，不能反推地形当前仍缺。例如:200的DF_RUBBLE仍为df=null，而DungeonFeatureCatalog:714–715已可生成RUBBLE（CE V/GlobalsBrogue.c:121）。这是**载体已具备但autoGen仍未接回**的K28/U19f子项，不该再派一轮“新建RUBBLE”。

30条按后续施工族归并（数字为DF id；不是本轮激活许可）：

- 植被/火/桥：61 TRAMPLED_FOLIAGE、66 ACTIVE_BRIMSTONE、104 BRIMSTONE_FIRE、83 OPEN_IRON_DOOR_INERT、98 BRIDGE_FALLING。
- 触发/陷门/暗杆：154 MACHINE_PRESSURE_PLATE_USED、17和152 TRAP_DOOR、95 WALL_LEVER、144 MACHINE_TRIGGER_FLOOR_REPEATING。
- 喷口/长明灯：179/180甲烷、182 PILOT_LIGHT、183/185麻痹、174/175毒气；另14 GAS_TRAP_POISON、19 FLAMETHROWER。
- 祭坛/管道：85 ALTAR_CAGE_CLOSED、140 COMMUTATION_ALTAR_INERT、141 PIPE_GLOWING、143 RESURRECTION_ALTAR_INERT、145 SACRIFICE_ALTAR。
- 破壳/虫道/其余：155 RAT_TRAP_WALL_CRACKING、187 STATUE_CRACKING、148 COFFIN_OPEN、191 WORM_TUNNEL_MARKER_ACTIVE、87 FLOOR_FLOODABLE、88 PORTAL_LIGHT。

**B2的四处未接DF（CE6/F2、7/F2、22/F0、28/F1）仍是留形**：目录存在不代表catalogFeature可调用；SECRET_DOOR两处另归K29。V-9e-2的麻痹机器和雕像机器可以有建造证据而没有最终payoff；V-4的置换/复活不能以地形名出现判为已可交互。各族恢复须把数据起点、地形三链、DF后继、最终消费者、可解性一起闭合。尚未展开的其余CE DF/autoGen条目见§7，不用现有30条当“全CE仅剩30条”。

## 4. §1.3 建议派发单元与优先级

这是可据以起任务书的施工边界，不是本轮修改授权。**先保住已有进度和产物，再改大量玩法，最后扩池与大面积表现**。P0优先级最高：丢档/串局/重复奖励会破坏玩家信任，且会污染后续验收夹具。P1按“常见且明显的玩法偏差→依赖较多的能力/机器”推进；P2处理信息表达；P3处理内部观测和重构。P3中的观测准备可以提前做，但不能代替玩法收口。

### 4.1 共用派发合同

- **生成流列**：`直`＝新局/生成路径确定会改，必须独占归因；`间`＝互动、光照等可能经共享SUBSTANTIVE流影响后层；`无`＝目标是不影响实质随机流，但仍需证据。U02实施前不能把“只改战斗”写成“绝不动后续生成”。
- **R(files)+S(pattern)**：R为表列生产文件的直接/间接消费者及测试、fixture、源码扫描脚本；S为行为名/字段/缺口注释的全仓搜索。两者取并集，不能只运行任务同名前缀测试。表中路径相对`src/`，`G`用§1缩写，`M`为`entities/Monster.ts`，`DF`为`engine/Map/DungeonFeature.ts`。§2中的省略测试名是文件名前缀，可用`find src -name '*前缀*.test.ts'`展开。
- 当前环境没有`rg`，本轮用Python/grep定位。未来可在`brogue-web`执行`rg -n -F 'engine/Core/Game' src scripts`找R，再执行`rg -n 'serializeItem|keyLoc|originDepth' src scripts ai_docs`找S；逐条排除仅注释命中，并递归追踪导入/包装调用。无rg时用`grep -RnE`，再人工读上下文。生产读方也在R中，不能只找测试。
- 每单元先冻结**本轮CE合同、允许文件及R∪S既有断言**；撞红按真实回归、旧缺口翻正、已归因生成漂移分类。旧基线不能自动重捕，不能以改期望代替证明。下表“红”是预判而非本轮已观察失败；未写数量代表未测，不能承诺零红。
- 通用收口：明确的入口→状态→消费者→保存/显示合同；定向CE对照和正反边界；R∪S守卫；适用的客观时间/行动耗时/RNG计数；生成改动另做逐层漂移、连通/落位/机器可解性、产物唯一性证明，最后才处理已批准基线。
- “在场=是”表示**该未来单元开始/关键产品决定和最终验收时应有用户参与**，并非要求用户盯每条工具调用；不是现在发起审批。涉及格式迁移、生成池、结局选择及大面积UI，须先交具体兼容/漂移/交互方案供决定。

### 4.2 P0：持久化、局生命周期、生成安全

| 单元；范围/关联账本 | 前置 | 生成流；在场 | 改动面与反查 R + S | 预期撞红与专属收口 | Game区（§5） |
|---|---|---|---|---|---|
| **U00 开新局状态归零**：枚举run级状态，处理统计、结束锁、坠落队列和其他待处理请求；K39 | 无 | 间；否 | R: G、App.vue、harness；S: startNewGame、replayRestart、stats、pendingFallenByDepth、isGameOver | 新局起点断言/重放seek可能红；同实例A局→B局与新实例B局等价，正常返标题/死亡/重放三入口均验；不重置应跨局保留的显示设置 | A0/A5/A11/A16 |
| **U01 实例快照丢字段**：物品flags/钥匙绑定，普通怪物runtime/携带品/等待时钟；K02 | U00可独立 | 间；**是：旧档恢复策略** | R: G、Item.ts、M、snapshotQuantity、V-6、W-16…23；S: GameSnapshotItem、serializeMonster、originDepth、disposableHere、ticksUntilTurn、machineHome | 旧shape/缺省值测试会红；自然普通对象与变形/克隆各往返，存前存后下一步穿刺/开锁/掉物一致；旧档缺字段能重建的显式重建、不可推断的注明迁移限度 | A0/A4/A13 |
| **U02 RNG与分层种子合同**：双流完整状态/计数保存、种子宽度与CE每层seed隔离；K04及K01随机部分 | U01；先选兼容模式 | **直**；**是** | R: Random.ts、G、App.vue/种子输入、generation_baseline、Random/p2_0；S: seed、levelSeed、RNG_SUBSTANTIVE、getState、seedRandomGenerator | 全局生成指纹预计大面漂移；分两交付：先可无损恢复当前算法状态，再单独切CE种子/层隔离；固定CE例/首后层两流状态、64位输入、交互不污染未生成层；不能把两次漂移混捕 | A0/A1/A5/A13 |
| **U03 整局和跨层保存**：levels、计量、pending坠层/跟随、层时间/气味、全局关系；K01/K03 | U01/U02 | 直/间；**是：schema迁移** | R: G、Grid/Scent、M、App.vue；S: levels、meteredItems、foodSpawned、goldGenerated、spawnFuse、pendingFallenByDepth、leaderId | p1_31_35、b_4a/b、c_5、W持久化/生成夹具；D1→D2→存读→D1与连续局等价，当前层/缓存层/休眠/随从都测；单列旧档不可恢复的历史层，不能伪造其原状态 | A0/A1/A2/A11/A12/A13 |
| **U04 楼梯候选与CE66解封**：先修最终地形落位，后独立验CE66；K27 | U02宜先；U18a输出落位合同 | **直**；**是：回池** | R: G、Architect/AutoGenerator、Grid、c_8/p1_26/29/33；S: floorCandidates、DOWN_STAIRS、MT_LAKE_PATH、RETIRED_AUTOGENERATOR_MACHINES | 连通基线和退池留痕预计红；最终四层判据、上下梯互达、初始入场/深渊/深水对抗；不以“换成功种子”修机器 | A1/A2 |
| **U04b 密门映射补全**：CE17/F0与27/F1；K29 | 可独立，接U04验收 | **直**；**是** | R: BlueprintEngine、Grid/TerrainCatalog/Appearance；S: TERRAIN_MAP、TERRAIN_VISUALS、SECRET_DOOR、b2_transcription | B2潜伏缺口守卫翻正；真实生成格、发现前后和寻路可解；不能只查featureSpawns | A1（一般无需改G）/A15 |
| **U04c 机器格单一来源**：全grid机器号派生；K31 | U04b宜先 | **直**；**是** | R: G、BlueprintEngine、b_4b、p1_37、V-3/6/9e；S: machineCells、machineNumber、mr.cells、NO_INTERIOR_FLAG、heatMap | 定种子A−B pin可能换；含外部feature/区域机的生成后与读档后集合一致，所有落物/传送消费者同合同 | A1/A2/A13 |
| **U05a 领养/携带产物唯一性**：一个实例只能一个所有者，失败能回滚；K30 | U01；观察准备U25可提前 | **直**；**是** | R: BlueprintEngine、G、ItemLoader、V-1a/2a/6/9e；S: adoptedItem、itemSpawns、carriedItem、MF_MONSTER_TAKE_ITEM | 生成怪/物/资源/RNG指纹会改；地上/怪身/包内总数与身份守恒、最后携带者规则、递归失败不遗留幽灵物品，普通携带怪死前后存档均验 | A1/A2/A10/A13 |

### 4.3 P1：明显玩法偏差与依赖链

| 单元；范围/账本 | 前置 | 生成流；在场 | 改动面与 R + S | 预期撞红与专属收口 | Game区 |
|---|---|---|---|---|---|
| **U05 机器物品实化/Q族**：STAFF/WAND身份、Q筛选重掷、实例流转；K11 | U05a/U02 | **直**；**是** | R: BlueprintEngine/G/ItemLoader/Arcana*；S: itemQualifiers、MF_REQUIRE_GOOD_RUNIC、spawnBlueprintItem、STAFF、WAND；V与W-5/24/25/26 | 类别空值/质量留痕与生成基线红；类别→种类→CE资源→筛选→归属逐步观测，不能从最终名称反推抽取正确；重掷上界与CE失败传播须先核 | A1/A2/A7/A13 |
| **U06 怪物直接法伤**：BE_DAMAGE三族移出近战判定；K09 | U01；U13可分开 | 间；否 | R: M、G、Combat/Bolt/StaffDamage；S: applyMonsterBoltHit、BE_DAMAGE、FIRE、SPARK、DRAGONFIRE、inflictDamage；p4_1b、W-8/15/23 | 旧命中率/伤害/耗骰断言红；固定magnitude、护甲差异不影响法伤、反射归因、盾/火免/死亡出口；BE_ATTACK另测保留 | A7/A9/A10 |
| **U07 怪物blink专调度**（W-22前置一）；K06 | U18a的怪物位置合同；不依赖学习 | 间；否 | R: M、G、Bolt、SafetyMap/Pathfinding；S: blinkToPreferenceMap、specificallyValidBoltTarget、BLINK、40；p4_9、W-11/12 | 玩家blink守卫应保持，怪物旧拒绝路径翻正；CE偏好图/周界目标/收益门/障碍/盟友敌人场景，失败不耗行动/资源的具体规则回源确认 | A2/A7/A15 |
| **U08 蜘蛛网与古灵藤蔓DF施法**（W-22前置二）；K07 | U17必要副作用、U18a | 间；否；若顺带回池则另单 | R: Bolt.ts、M、G、DF/TerrainCatalog；S: SPIDERWEB、ANCIENT_SPIRIT_VINES、DF_SPIDERWEB、DF_ANCIENT_SPIRIT_VINES | effect=null拒绝留痕翻正；路径/终点不同语义、藤蔓占格/死亡、网接触行为；分清非可学习与可学习项，不能让学习盲装无出口能力 | A7/A10/A14/A15 |
| **U09 学习能力消费者矩阵**：先逐能力资格，后补已证实的怪物效果/永久特性；K08/K10局部/K25 | U06/U07/U08 | 间；否 | R: M、Bolt、G、Creature；S: monsterCanLearnBolt、negatable、TELEPORT、POLYMORPH、invisible、weakness、TRANSFERENCE、TURRET | W-19/21/23及p4_1b/3；每位“可学习/可施放/可消魔/需同步”有CE证据和消费者；TRANSFERENCE/TURRET未核部分先勘规格，不以本表猜规则 | A7/A9/A10/A15 |
| **U10 吸收过程字段及存档**（W-22前置三）；K05持久化部分 | U01/U03；U09确定字段语义 | 无→间；**是：格式** | R: G、M、实体引用恢复；S: targetCorpseLoc、targetCorpseName、corpseAbsorptionCounter、absorptionFlags、absorbBehavior、absorptionBolt、MB_ABSORBING、newPowerCount、totalPowerCount（CE Rogue.h:2280–2286、2305–2306，逐字段建web映射） | W-21与snapshot新增字段形状；目标尸体、已学能力、剩余计数、中断态都往返，关系用稳定ID/位置恢复；旧档默认不凭空赠送能力 | A0/A4/A10/A13 |
| **U11 完整盟友尸体学习状态机**；K05 | **U07/U08/U09/U10齐** | 间；否 | R: M、G、Combat、尸体/死亡载体；S: newPowerCount、absorb、removeDeadMonsters、corpse、moveAlly；W-17/19/20/21/23 | 学习前置留痕/死亡顺序可能红；资格→选能力→走尸体→倒数→安装→扣额度；被打断/尸体消失/离层/存读/消魔/复制逐项，不再只验数值强化 | A7/A10/A11/A12/A13 |
| **U12 一般AI/盟友战术**；K10/K25 | U09/U18a；学习部分在U11后 | 间；否 | R: M、SafetyMap/Scent/Waypoint、G；S: teammates、enemies、boltEffect、moveAlly、fleeing、MODE_PERM_FLEEING、leader、reflection | p4_1b/8/9/10、ai_1、W-17/18；拆为施法资格→盟友逃险/跟随两轮，CE33永久逃跑模式及保存纳入第二轮；目标排序/掷骰位置同CE，旧胜率非正确性标准 | A2/A7/A11/A12/A15 |
| **U13 战斗基础数学和耗骰**；K15 | 无；与U06分批归因 | 间；否 | R: Combat.ts、Creature/Player/M、G；S: randClump、autoHit、backstab、invisible、weaknessAmount；CombatFormulas、monsterDamage、b_1、armor、p4_5/6/7 | 旧分布与战斗tick基线可能红；先抄CE range/公式/短路，再固定RNG计数/正反边界；不拿“平均伤害近似”替代分布 | A9/A10 |
| **U14 状态缺口**；K14/K25 | U01；darkness依赖U21b合同 | 间；否；schema变化与U03协调 | R: Creature/M/Player、G、Status、Sidebar；S: NAUSEOUS、DARKNESS、MAGICAL_FEAR、weaknessAmount、maxStatus、STUCK、DONNING、ENRAGED、LIFESPAN | 分U14a恶心/黑暗/恐惧/虚弱，U14b束缚/穿甲/狂怒/寿命；p2_3、g_3、W-9/10/15/18/23红面；每项施加、刷新、客观/主观计时、到期/消魔、保存/显示；独立SEARCHING/营养不重做 | A0/A3/A9/A12/A13/A14 |
| **U15a 不可碎墙**；K20 | 无 | 间；否 | R: G、Grid、BlueprintEngine；S: crystalizeFromPlayer、impregnableCells、IMPREGNABLE；scroll_effects、b_3、V相关 | 原“所有墙”期望可能红；不可破格保留全部层/标记，普通格仍碎，集合往返后同效 | A8/A13 |
| **U15b 戒指目录/附魔/效果**；K22 | U13/U14/U21b；充能复用W-6 | **直/间**；**是** | R: arcana.json、ItemLoader、G、Player、Light、Detail；S: awareness、regeneration、clairvoyance、transference、stealth、wisdom、light、reaping | b_1b/b_4a/W-6/7、饥饿/光/生成红面；先现有6种逐效果，后缺失2种入池另轮；实际E/可见E/充能、可观察性与旧档迁移分清 | A1/A3/A9/A10/A12/A13/A16 |
| **U15c 护符模型**；K23 | U14及W效果原语/U03 | **直/间**；**是** | R: arcana.json、ItemLoader、ArcanaRecharge、G、InventoryOverlay/Detail；S: CHARM、cooldown、useArcanaItem、health、speed、protection | 旧固定值/漂浮/免疫随机替身应翻正；先现有类别映射与CE效果/冷却/附魔，再扩目录独立轮；取消操作/未发生效果是否消耗按CE，不补另一套魔法原语 | A1/A6/A7/A9/A12/A13 |
| **U15d 武器护甲符文**；K24 | U13/U01；MULTIPLICITY需U16生命周期 | **直/间**；**是** | R: ItemLoader/Item、Combat、G、M、Detail；S: MULTIPLICITY、SLOWING、PLENTY、BURDEN、VULNERABILITY、IMMOLATION、slaying、speed、mercy | armor_runic、b_4a、W-20/23；逐符文小轮：目标物种/几率/附魔、谱影和消魔、负面符文生成、持久化；禁一轮全表只测目录数量 | A1/A9/A10/A13/A16 |
| **U15e 药水语义**；K34 | U14/U17必要DF | 间；**lichen等回池是** | R: consumables.json、G、DF/Status；S: heal_full、life、confusion、hallucinating、darkness、creeping_death、throwItemAt | b_2/c_5/f_2b/g_2/b_1c；喝与扔分矩阵、CE maxHP/持续期/鉴定/取消；lichen闭包成功后单独回池与漂移 | A6/A8/A9/A14 |
| **U15f 食物确认与自动食用**；K35 | U00；U27后需命令日志同步 | 间；否 | R: G、Player、InventoryOverlay、Input；S: eatItem、nutrition、starvation、requestConfirm、autoEat | hunger_regen、p2_3、i_1；不够饿取消不消耗，饿死前自动食物优先/无食物伤害，麻痹/护符节流不回退；不新增芒果治疗 | A5/A6/A11/A12 |
| **U16 死亡/寄宿/复活/群体继任**；K13 | U03/U14；祭坛接入需U17/U19相应族 | 间；复活机回池**是** | R: M、G、DF、关系恢复；S: carriedMonster、leaderId、purgatory、resurrect、demoteMonsterFromLeadership | W-16/17/19/20/23、V-5；先寄宿释放/死亡继任，再purgatory与祭坛；循环引用/已死领袖、跨层释放、装备掉落唯一性、复活后存档 | A10/A11/A13/A14/A15 |
| **U17 DF副作用与机器后继载体**；K19/K28 | U18a；不同族前置见§3.3 | **直/间**；**是：生成链恢复** | R: DF/DFCatalog/TerrainCatalog/Promotion、G、Grid；S: evacuationRequired、refresh、aggravateRadius、subsequentDF、DF_MISSING_TILES | c_4b/c_4c、f/g、V、W-13/14；先副作用事务，再按§3.3五族独立施工；每族铺装→实体疏散/落物→晋升→后继→可解/显示；禁止一次删完30条缺口登记 | A1/A2/A7/A12/A14/A15 |
| **U18a 各调用者地形判据**；K42 | 无；优先供U04/U07/U08/U17用 | **直/间**；**是：生成消费者** | R: Grid/TerrainCatalog、Scent/Safety/Waypoint、M、G；S: passable、opaque、T_PATHING_BLOCKER、T_DIVIDES_LEVEL、canMoveTo | c_8/ai_1/p4_8/9/10/p1_26/29；分别建立玩家、怪物、气味、逃跑、waypoint、生成落位真值表，不统一成一个万能布尔；门、密门、网、深水、熔岩、四层叠加对抗 | A2/A3/A5/A11/A12/A14/A15 |
| **U18 深水/网/开笼消费者**；K21 | U18a/U14；网DF U08 | 间；否 | R: G、M、Grid、Item、关系helper；S: DEEP_WATER、STUCK、SUBMERGED、keyMatchingEntry、becomeAllyWith、itemsAt | p1_27/c_5/V-6/i_1/W-11/12/17；允许游泳不复活自创淹死，卷物及免疫、陷网挣脱时间、开笼统一关系；保存后同效 | A5/A9/A11/A14/A15 |
| **U19 蓝图剩余算法/机器玩法**；K28/K32 | U05/U17、视图需U18a；复活族U16 | **直**；**是** | R: BlueprintEngine/Architect/AutoGenerator、G、数据；S: IN_VIEW_OF_ORIGIN、pendingItems、pendingMonsters、CE24/47/52/55、COMMUTATION、SACRIFICE | V全链/b2/blueprint_center/c_8/generation；按下文子轮分别验，先闭包后解退池；每台必须有“用户触发→结果”的证据，不能只点亮身份覆盖 | A1/A2/A13/A14/A15 |
| **U20 堆叠与容量**；K36 | U01/U05a | 间；否；旧档合并策略需确认 | R: Inventory/Item、G、InventoryOverlay；S: addItem、quantity、26、throwItemAt、dropItem、pickup | snapshotQuantity、startingKit、b_2、i_1；满包收可堆叠物、不可叠拒绝、分投/分丢数量守恒、鉴定/诅咒兼容条件按CE，不创造重量惩罚 | A5/A6/A8/A13/A15 |
| **U21b 光照CE口径纠正**；K40与K16逻辑光 | U14黑暗互相共定合同；可先正常矿灯 | 间（含生成后光刷新）；**是：涉及流漂移与显著可见范围** | R: LightCatalog/LightMap、G、TerrainCatalog；S: CE_DCOLS、minersLight、lightMultiplier、darkness、inWater、intrinsicLight、flare | c_7黄金值预计红；先当前CE 79宽固定公式对照，再状态/戒指/生物光，各阶段记录两流计数与FOV；亮度修正不是改地图尺寸 | A3/A9/A12 |
| **U26 深层/终局/分数**；K37 | U03/U04/U20 | **直/间**；**是：范围与终局体验** | R: G、ItemLoader、App、GameEndOverlay、新高分持久层；S: amuletLevel、deepestLevel、lumenstone、itemValue、superVictory、score | 深度26夹具、generation/胜负UI；分深层生成/结局条件和结算/高分两轮；金钱/物品价值逐CE核，不照抄旧简写得分公式；死亡/普通胜利/超胜利分别验 | A0/A1/A2/A5/A13/A16 |
| **U27 完整可复现命令日志**；K38 | U00/U02/U03；纳入已落实物品交互 | 间；**是：格式/交互合同** | R: G、Input、App、InventoryOverlay、ReplayControls、目标/确认UI；S: recordInputEvent、handlePlayerAction、quaffItem、chooseIdentifyTarget、tick、loc | 旧录像JSON/seek行为红；所有实际用户入口同一命令边界，取消/确认/目标/选物可重演，逐事件位置/tick/RNG校验、OOS报错；CE二进制录像兼容须另行决定，不默认为此轮范围 | A0/A5/A6/A7/A8/A12/A13/A16 |

U19的最小可派发子轮：**U19a** IN_VIEW_OF_ORIGIN视图约束；**U19b** 前厅HAS_ITEM与pending产物占用；**U19c** horde个体实化时机/失败回滚；**U19d** 暗杆/陷门与麻痹喷口/裂雕像（每族再独立）；**U19e** 置换/复活/献祭/闭笼祭坛（每类独立，复活走U16）；**U19f** 电晶/虫道及剩余autoGen植被火桥链（逐闭包独立）。全部继承U19的R/S/生成/在场标记；a/b/c主要G:A1/A2，d/e/f主要A1/A2/A14/A15及schema A13。本表明确划开交付，**不建议把U19整行派成一个无限扩展的大任务**。

### 4.4 P2信息呈现、P3观测/内部债

| 单元；范围/账本 | 前置 | 生成流；在场 | R + S | 预期撞红与专属收口 | Game区 |
|---|---|---|---|---|---|
| **U21 展示可见性/地形外观/动画**；K16/K17 | U21b逻辑光；其他可先做 | 无；**大面积视觉是** | R: Appearance/GameCanvas/Sidebar、G；S: invisible、telepathy、canObserveBoltCreature、FORCEFIELD、DEFAULT_LOOK、render_game_to_text、boltAnimation | r_1/ui_1/W-19/目标选择快照；画面、文本、hover、侧栏、瞄准统一已知信息；隐形不泄漏，已揭示可见；真实浏览器验末帧/黑格/侧栏，不改战斗RNG | A3/A4/A7/A16 |
| **U22 发现屏/详情/帮助**；K12/K26 | U15各物品真实模型，W后缀可先接 | 无；**是** | R: Input、InventoryOverlay/DetailPanel/新屏、DetailGenerator、G；S: discovered、magicCharDiscoverySuffix、maxChargesKnown、runicKnown、actualEnchantment | w_2/7/24/25/26、DetailGenerator、键绑定；未知身份不泄漏，极性/绰号/资源口径一处定义；D键与帮助真实入口；浏览器双尺寸交互验 | A4/A5/A7/A8/A16 |
| **U23 地图记忆/魔法测绘**；K18 | U03；U21知识判断 | 无（不得偷耗实质流）；**是：格式/UI** | R: Grid/Appearance/G、GameCanvas；S: hasMemory、rememberedTerrain、rememberedFlags、MAGIC_MAPPED、MB_SUBMERGED | r_1/ui_1/scroll_effects/b_1c与snapshot；离开视野后环境变化不泄露，测绘只给CE允许的信息；回访/读档一致，水下生物展示另测 | A0/A3/A6/A13/A16 |
| **U24 i18n与物品文字校正**；K26/K41 | 相应玩法先稳定 | 无；否；整界面改版则另在场 | R: G/M、components、DetailGenerator、locales/i18n；S: spawnFloatingText、logger.log、defaultValue、runic、猛烈突刺 | p1_30/p1_37/DetailGenerator、动态名称；逐出口真实zh_CN渲染、不漏变量、不显示内部枚举，文本准确描述已实现效果；自由硬串不靠键扫描自证 | A4/A6/A7/A8/A9/A10/A16 |
| **U25 机器产物追踪与性能观察**；K33 | 可提前独立 | 无：观测不可耗骰；否 | R: 现有scripts、headless harness、BlueprintEngine/G观测接口；S: featureSpawns、machineNumber、adoptedItem、MAXIMIZE、REPEAT_UNTIL_NO_PROGRESS | 定位/时间阈值守卫可能红；seed/depth/CEid/feature/来源→最终格/怪/物可追踪，关观测同指纹；串行重复计时先查慢点，不能把历史超时写当前性能缺陷 | A1/A2（若需观测接口） |
| **UR Game分步拆分**；结构债 | 见§5，不做所有玩法前置 | **无，须证明**；**是：是否/何时拆** | R: §5私有调用清单、全部导入/源码扫描测试及harness；S: activeGame、setDormantAwakener、this、各迁移成员 | 私有入口/源码位置/模块初始化次序均可能红；逐步黄金轨迹/完整状态/两流计数零差异，行为修复与搬迁分提交 | 见§5步骤 |

推荐起步队列：**U00→U01→U05a**；U02/U03先提交兼容方案，在该方案稳定后实施。U18a先确定落位合同，U04系列再执行。玩法第一批选U06/U13/U15a这种边界清晰且玩家明显受益的修复；学习链按U07/U08/U09/U10→U11，不能绕过三项W-22前置。机器扩池/戒指护符扩目录/终局扩层均独立排期，避免一次把多种生成漂移混在一起。

## 5. §1.4 Game.ts 拆分评估

### 5.1 实测规模与职责区

AST实测：**10,559行、58条import声明、327个类成员、227个方法、152个private方法**。行数含空行/注释，不等于复杂度。以下是主要责任区；完整每个成员的起止行见game-members.json，分区之间的说明注释不逐行列出。

| 区 | 当前行号 | 职责 | 关键耦合 |
|---|---|---|---|
| A0 | 1–852 | 导入、DTO/type、类字段、构造、开局 | 全局rng/ItemLoader/ID、App、玩家/背包、各run状态；constructor也有初始化副作用 |
| A1 | 865–1693 | 计量抽物、突变、机器物品/怪物实化、生成层/填充 | Architect/BlueprintEngine延迟指令、ItemLoader、machineCells、全局随机顺序 |
| A2 | 1707–2312 | 入场落位、horde、召唤、周期刷怪 | Grid/Dijkstra、怪物占用/资格、领导关系与spawnFuse |
| A3 | 2879–3000 | 矿灯/环境光、FOV、玩家黑暗 | LightMap/LightCatalog、全层地形、怪物状态、SUBSTANTIVE随机 |
| A4 | 2314–2858 | 测试层、检查/观测、createMonsterFromSnapshot、视觉事件 | 测试模式和生产构造/反序列化交叉；合成夹具不代表自然可达 |
| A5 | 3002–3740 | 帧更新、录像/回放、玩家行动路由/移动 | 输入、动画锁、整套玩法方法、回合推进；UI另有直接调用入口 |
| A6 | 3742–4232 | 装备/丢弃/恶性确认、探魔、饮食/卷轴入口 | Inventory、确认回调、鉴定态、行动耗时、UI pending状态 |
| A7 | 4234–5185 | 护符入口、杖/魔杖提交/瞄准/动画/效果、怪物bolt | Arcana*、BoltTrajectory、目标选择、Monster、击杀/地形副作用 |
| A8 | 5196–5980 | 鉴定/附魔/充能/保护、消魔等群体效果、投掷 | ItemLoader静态鉴定、装备、状态、地形、怪物/落物 |
| A9 | 5988–6675 | 搜索相关辅助、潜行、状态/抗性、戒指/符文、毒/饥饿日志 | Creature、Combat公式、legacy能力、物品模型、i18n |
| A10 | 6693–7320 | 近战几何/命中/耗时、掉落、克隆/分裂/死亡DF | Creature/Monster、关系/占用、G多私有伤害出口与rng |
| A11 | 7341–7717 | 确认、下坠/落位、钥匙匹配、死怪/孤立谱影清理 | 跨层队列、levels、领袖引用、DF/地形、物品绑定 |
| A12 | 7719–8386 | playerTurnEnded、推进循环/客观块/尾声、异步节奏、渐进鉴定/充能 | 全系统更新顺序、行动债、环境时钟、动画暂停恢复 |
| A13 | 8388–8956 | 物品/怪物编解码、toSnapshot/loadSnapshot、关系恢复 | 构造副作用、ID最大值、全局rng/鉴定/外观、DTO、图层、缓存 |
| A14 | 8970–9608 | 火/爆炸/环境接触、休眠唤醒/机器怪收口 | Gas/DF/Promotion回调、damage/状态/死亡、Grid与怪物占用 |
| A15 | 9610–10252 | 自动探索/鼠标移动、通行/视线、特殊格、搜索/陷阱、位移/转盟友 | AutoExplore/Pathfinding、Grid/Promotion、钥匙、领袖/俘虏关系 |
| A16 | 10254–10559 | 地形名/hover、自动路径推进、结束/计分、activeGame单例 | UI/详情、行动锁、统计/背包；文件末模块单例初始化 |

上表不是天然的模块边界：例如A13还调用A4的实例构造，A7/A10/A14共同承担死亡/地形/状态副作用，A12在多个地方被UI触发。§4每个派发单元已映射到这些区；U14a/b、U19a…f也给出继承规则，因此不会把“只动Game某方法”误当作完整改动面。

### 5.2 私有调用与测试/模块耦合

137个受git管理的`src/**/*.test.ts`中，AST统计：

| 口径 | 数量 | 能/不能说明什么 |
|---|---:|---|
| 精确`(g as any)`的属性/元素访问 | 180 | 包含读写字段，不能全算方法调用 |
| 上述访问作为直接调用callee | 132 | 其中一个成员名不属于Game私有集合 |
| 直接调用且成员名命中Game private集合 | **131处，15个文件** | 这是本题所需的可复查私有入口耦合数；语法统计，未做类型解引用 |
| 任意receiver强转any后命中上述私有名的直接调用 | 131 | 此口径与精确g本次相同；不包括先赋给any别名再调用 |
| 更宽的所有私有同名属性引用/其中调用 | 561 / 453，89个文件 | 包括显式typed cast/别名和可能同名的别类对象，**不是453个已证实Game私有调用**；供反查扩展范围 |

高频直接私有调用：removeDeadMonsters和serializeMonster各11、triggerDeathFeatures 9、createMonsterFromSnapshot与negateCreatureMagic各8、trySplitMonster与deserializeMonster各7。源码精确位置/receiver均在证据JSON，不以grep的注释次数冒充调用次数。

生产同样越过私有边界：M:1135–1137、1332–1336、1594附近通过`game as any`调用分裂/状态等；Game公开castMonsterBolt/summon入口被Monster回调。A14 `bindDormantAwakener`:9467向DF模块安装闭包，换实例/读档会重新绑定；模块级rng、ItemLoader鉴定/资源、Entity ID和末尾activeGame使导入顺序也可能成为行为。把这些函数原样移动后再传整个Game，不能消除耦合。

另外，测试不全是运行时调用：`p2_1_tick_architecture.test.ts:252`直接读Game.ts，`v_1a_blueprint_items.test.ts:121`做旧入口墓碑扫描，`v_2b_4_altars.test.ts:762`、`p1_42_secret_door_search.test.ts:237`也读取源码，`c_4b_dungeon_feature.test.ts:1059`维护DF调用白名单。移动实现可能让局部路径扫描漏检或误红。反查必须包括`src/test`外的scripts，不应只改private可见性让编译过关。

### 5.3 推荐：延后整体拆分，采用四步小拆

**推荐不把整文件拆分设为所有CE对齐工作的前置。是否拆、何时拆是用户决策。** U00/U01/U05a已有足够明确的病灶，先修更有价值；目前没有证明大拆能减少总返工，而已有大量私有/状态/顺序耦合。

触发拆分的条件：U01稳定后的DTO合同明确；同一状态/效果要在玩家、怪物、护符三处复用且开始发生实质重复；或下轮必须横跨A7/A10/A14才能补一条伤害/状态规则。可以批准以下独立纯重构轮，**不与公式/生成/存档语义修复混做**：

| 步骤 | 提取边界/收益 | 零行为变化证明 | 私有测试处理/预计红面 |
|---|---|---|---|
| UR1 编解码和明确数据投影 | U01后从A13抽Item/Monster codecs与DTO，Game保留当前方法包装；先把所需种类信息/构造函数/ID分配显式注入 | 同一输入新旧codec逐字段等价；toSnapshot去掉savedAt后深比较；旧fixture、普通/特例/休眠/关系循环；构造前后两流state/count相同 | 现有serializeMonster11等入口保持签名和this语义；snapshotQuantity、b_1b、p1_31_35、W-16…23；不得以“序列化本应如此”为由顺便改字段 |
| UR2 物品使用/魔法效果协调 | 从A6/A7/A8抽窄服务：资源提交、目标上下文、共享效果调用；Game保留UI门面；减少U05/U06/U15复用时的分叉 | 固定初态+命令日志，对每步资源/位置/伤害/状态/日志/行动tick/两流计数做前后trace；W-2…26和b/scroll/投掷合同不变；取消/反射/失败入口也比较 | 私有applyBoltEffect、boltWorld等先保留薄包装；源码扫描迁到新实际实现而非删除；预估中等，调用边界和effect顺序为主 |
| UR3 生成/层生命周期协调 | U04/U05稳定后抽A1/A2生成协调与LevelState，明确BlueprintEngine指令产物到实体的事务；Game只接管当前层 | 同一seed逐深度生成的地形/机器/物品/怪物/两流state指纹逐位相等；原generation_baseline不重采；c/p1/V/B2全生成安全守卫；重访/保存夹具等价 | generateDepth/populate相关harness、machineCells白名单、全局初始化易红；这是高撞红面，不与任何回池轮同时进行 |
| UR4 时间/环境协调最后拆 | 在状态合同、U03/U14/U17稳定后抽A12/A14；用显式World/Clock/Effects端口，不把整Game as any传入 | p2_1/2/3/4原客观时间/速度/动画轨迹；f/g/W状态、死亡/下坠；连续与动画分帧推进一致，逐客观块的事件顺序/完整状态/两流相等 | playerTurnEnded/advancementLoop/objectiveTimeBlock等私有包装先留；Monster生产回调改窄接口；预计最大红面，输入锁、异常中断、回调bind和计时尤甚 |

薄包装是迁移兼容层，不把private全部改public；之后另轮把测试迁到正式合同/测试适配器，再移除包装。即使全测绿，也须保存前后等价证据；`generation_baseline`只证明其生成口径，不能证明物品交互、存读和录像行为。新模块不得在import阶段多构造实体、多掷骰或替换回调所属实例。

## 6. 历史“已完成”结论抽样复核

每域至少抽一个历史结论/已完成子项。**找不到该域的完成声明时如实列出，不能为了凑数捏造“曾完成”**。以下“成立”仅限抽中路径的当前源码复核，不重放历史全量测试/性能数字。普通历史报告在`ai_docs/`，V/W/B2在`ai_docs/reports/`。

| 域 | 抽样来源/完成口径 | 当前复核与界限 |
|---|---|---|
| D01 | c_1_room_profile_report §生成流水线；B2的密门留形 | Architect:324–491有carve/translate/rooms链，窄口径成立；B2自己没有宣称密门落地，当前仍留形K29。不能把房间完成推广到楼梯/机器。 |
| D02 | c_4b_dungeon_feature_report：铺装/后继纯库完成 | DF:710–860铺装与后继实际存在；报告标题本已限纯库，疏散/聚怪返回值不是消费者完成，K19不是否认纯库成果。 |
| D03 | f_2b_creature_burning_report §0：火免150并灭火 | G:4028–4030真实施加150并灭火，:8990–9072燃烧状态路径存在；此子项成立，恶心/深水不在其完成口径。 |
| D04 | c_7_lighting_report §一单位口径：“CE_DCOLS=64”、公式逐条抄CE | **与当前参照树不符**：CE实际79，LightCatalog:32/310仍64；K40。不是由“测试没跑”推断，而是常量与执行公式直接相矛盾。 |
| D05 | monster_stats_merge_report §结论：五字段接入 | rat五字段→Monster构造的accuracy/defense/regen/双速消费者已核，抽样成立；67条零差异旧数字本轮未全表复算，不能重新背书。 |
| D06 | ai_1_report：门回弹/气味派生位修复；p4_1b施法入口 | 门晋升与Scent读位存在，M:813–832真实先尝试施法；窄链成立。旧追击成功率本轮不重算；施法资格仍K10。 |
| D07 | b_1_weapon_specials_report：偷袭/突进自动命中按CE | 命中结果与倍率路径存在；**随机消费不完全同构**，Combat:201仍randPercent(100)，CE Combat:1239短路；K15。其特殊武器调用已落地并不等于基础数学全部齐。 |
| D08 | W-10/W-15：毒浓度/护盾量级与持续期 | G:6603–6655真实按poisonAmount扣血/衰减，maxShield参与护盾链；所抽子项成立；CE状态整表仍缺K14，不把局部字段当全表。 |
| D09 | weapon_table_parity_report、B-1：武器数值/旗标实例化 | dagger数据/赋旗标成立；**完整生命周期不成立**：探针长矛读档后flags无，K02。旧报告未声称修好此次序列化，不归咎于数据抄录轮。 |
| D10 | b_1b_identification_persistence_report：戒指双槽 | Player:75–107/装备入口可填双槽，抽样成立；B-1b没宣称所有戒指效果齐，awareness/regen问题不能当它已关闭。 |
| D11 | parity_gap_analysis:67：speed护符错给漂浮 | **未找到整域完成声明**；现G:4262仍levitating，旧未闭合项有效。W-6资源回充不能证明CHARM效果正确。 |
| D12 | F-2b关闭P1-44火免药水 | 真实150+灭火成立（同D03）；life/confusion等未随之完成。旧“药水大半已齐”的数量判断不再沿用。 |
| D13 | b_3_scroll_blasts_report/scroll_effects_report：碎墙/消魔/纷争不再占位 | G:4186–4197真实调用群体效果，旧P1-16占位过期；IMPREGNABLE门仍K20，不能写全CE碎墙完成。 |
| D14 | hunger_regen_report：2150营养池与食物补充 | Player:124–173、G:4084–4087真实截上限/按营养恢复；未复算2179回合旧模拟。parity_gap的“芒果治疗”是错误CE前提，见E06。 |
| D15 | V-2b-6 §1.2：originDepth/disposableHere快照往返 | **直接不符**：类型/反序列化有，serializeItem:8426只写loc/machine；探针往返两字段丢失，K02。 |
| D16 | W-26关闭玩家杖/魔杖链，明确保留§8；W-15护盾 | G:4335–4517实际提交/扣资源/轨迹，applyBoltEffect对应护盾分支存在；声明的局部完成成立。W-22状态仍“学习未完成”，不翻译成已经完成。 |
| D17 | b_4a_report：metered先抽、food保底 | G:879–919计量分支/食物优先真实执行，窄口径成立；整局计量保存和机器Q族不在该证据内，K01/K11。 |
| D18 | p1_42_secret_door_search_report：search/searchingCharge | G:9865–9991按距离/阻挡/概率搜索，Input实际s/S进入；旧“搜索无入口”过期。戒指/潜行不是本子项一起完成。 |
| D19 | W-17：domination使用统一转盟友/领袖降级 | G:10121–10180和魔杖效果有真实调用，所抽路径成立；钥匙/普通死亡继任与复活不是W-17全包，K13/K21。 |
| D20 | p1_31_35_placement_and_snapshot_report：入场落位/读档loopMap重算 | G:1707–1729/8909–8917有调用，所抽修复成立；清scent仅消陈态，不等于跨层状态完整，K03。 |
| D21 | B-1b：鉴定态/绰号持久化 | G:8576–8581/8784–8800双向写读存在；该完成声明成立，不能从此推断所有物品/怪物/levels保存，K01/K02。 |
| D22 | parity_gap_analysis §9：计分自创/终局缺口 | **未找到CE计分/高分榜完成声明**；G:10539–10551仍自定公式。旧文对CE胜利倍数的简写不可靠，当前CE RogueMain:1305–1341以物品价值逐件结算。 |
| D23 | parity_gap_analysis录像框架存在；P2-0 RNG前置完成 | loadReplay→replayStep→handlePlayerAction实有；**没有完整交互回放完成证据**，直接背包入口未被该前置补齐，K38。 |
| D24 | UI-1：explosion_immunity不显示 | Sidebar:54–55实际过滤Status配置，完成项成立；发现屏/怪物侧栏/完整帮助未因此齐全，K12/K16。 |
| D25 | R-1：Appearance纯函数抽取 | Appearance通过context入参生成外观、GameCanvas调用，结构完成成立；**不是可见性语义全齐的声明**，隐形/记忆仍K17/K18。 |
| D26 | P1-30：键检查门及缺键补充 | i18n真实zh_CN入口和静态键门存在；该门本就声明不管硬串，G符文英文浮字是未闭合范围K41，不能用missing=0证明全中文。 |
| D27 | P2-0：怪移动SUBSTANTIVE、幻觉COSMETIC | M随机移动用rng，GameCanvas:18–31用try/finally切cosmetic，抽中双流路径成立；“种子可复现”不含层seed/读档恢复。V-2b-1简并rand_range耗骰说法反而错误，E15。 |

**本轮明确发现与现树不符的历史事实/范围扩张**：C-7的64宽（K40）；V-6序列化往返（K02）；B-1自动命中如果解释为同耗骰则不符（K15）；V-1的简并rand_range耗骰前提（E15）；parity_gap的芒果治疗/CE计分简写（E06、D22）。其余“局部成立但整域未齐”不应写成历史作者谎报完成。

## 7. 本轮未能核实/不能据此承诺的项

1. **没有跑CE与web全局同种子逐回合差分**。读源码和现有黄金测试不能证明所有调用次序同构；未重验全怪物、horde、突变、武器/护甲/环符文全表每个数字。抽样不足部分已保留黄色，不给完成百分比。
2. 没有自然生成复现每个缺口的发生率；领养物重复、缺Q筛选、CE66退池等有直接执行路径证据，但不声称“每个种子都会遇到”。30个缺tile条目是现有DFCatalog范围，**不是CE全量DF与所有autoGen缺失总数**。carrier标签是模块导出分类，不能替代可达性与消费者证明。
3. 未全枚举TRANSFERENCE/TURRET等复合能力、legacy技能自然目录可达性、MONST/MB的全部位、maxStatus全消费者；U09/U14开始时须补专项CE矩阵。本轮不能承诺只剩清单中的能力。
4. 未在浏览器验射线末帧残留、复杂侧栏/动画节奏、目标光标、触摸/移动端/不同像素比例及全部汉化出口；K16相关历史表现登记不算本轮重现。隐形信息泄漏结论来自Appearance/文本执行分支，未声称录了浏览器录像。
5. 未跑整段用户交互的录像导出→新实例导入→seek端到端；未使用真实用户长期存档做迁移。合成往返已证实字段/状态丢失，但不等于枚举所有旧版本兼容差异。web选JSON保存是产品选择，不强制复制CE文件格式；目标是状态/行为恢复。
6. 未重跑历史几十seed长测、性能/超时基线、W/V完整套件或反向变体；不把build成功当测试通过，也不把旧报告失败数字当现状。没有重新生成任何baseline。
7. 未完整形式化证明CE不存在XP升级/重量惩罚/商店；当前查到的玩家成长是物品/力量/盟友学习等路径，web字段weight/marketValue本身不足以派出新增系统任务。需要新增此类需求时先给CE明确入口。
8. 未研究多存档槽、跨设备/浏览器存储配额、损坏文件恢复、安全性或联网功能；不把没有依据的产品功能扩入本CE勘察。Game拆分收益是据耦合与路线的工程判断，没有声称实测性能提高。

## 8. 构建与只读自检

本节的最终文件哈希/范围核验见随附证据。工作树没有node_modules，因此在`/tmp/brogue-x0-build`对**本工作树源文件的副本**执行构建，依赖使用本机已有主检出node_modules的包链接；临时缓存、tsbuildinfo和dist全部留在该临时目录，没有安装或改动项目依赖。没有修改生产文件以适应构建环境。

- 初次`npm run build --prefix /tmp/brogue-x0-build`：vue-tsc通过后Vite进程报`SecItemCopyMatching failed -50`并退出139；完整输出[build.txt](x-0-evidence/build.txt)。这是观察到的运行环境失败，具体原因为未核实，不能据此判源码错误。
- 改为直接以该临时副本为cwd执行同一`npm run build`，**退出0**。`vue-tsc -b && vite build`通过；Vite 7.3.1转换819模块，打包1.78秒。完整输出[build-retry.txt](x-0-evidence/build-retry.txt)。仅有主chunk超过500kB的warning（1,098.19kB，gzip 316.39kB），没有在只读任务中顺带优化。
- 两个只读脚本仅写本任务允许的evidence目录；动态探针的打包/执行产物在临时构建目录。未运行完整测试套件，未宣称全测绿。

最终只读证据：

- [tracked-comparison.json](x-0-evidence/tracked-comparison.json)：入场/出场比对**1,523个受Git管理的文件，changed=[]**；哈希原表[before](x-0-evidence/tracked-before.json)/[after](x-0-evidence/tracked-after.json)。覆盖CE、生产代码、数据、测试、任务书和原历史报告。
- `git diff --exit-code`与`git diff --cached --exit-code`均为0；[git-after.json](x-0-evidence/git-after.json)中diffStat为空。新增文件均限本报告、`scripts/x0-*`、本报告证据目录，没有越界状态项，见[final-audit.json](x-0-evidence/final-audit.json)。未提交、暂存或重写任何基线。
- [build-input-comparison.json](x-0-evidence/build-input-comparison.json)：临时构建副本的**236个源码/public/配置/lock输入文件完全相同**，missing/different均空；依赖来源的package-lock也与工作树相同。这是本机既有依赖的构建验证，不宣称全新环境安装已验证。
- 报告包含27个域、42个合并账本项及21条历史项过期/缩小判语；逐域历史抽样另表。内部链接存在、Markdown表格列数一致。证据脚本、报告与JSON不进入产品执行路径。

复现只读盘点（在仓库根）：`node brogue-web/scripts/x0-inventory.mjs before /absolute/path/to/typescript/lib/typescript.js`，结束时运行`node brogue-web/scripts/x0-inventory.mjs after`；运行before会覆盖本目录该次基线，保留本轮证据时请先复制证据目录。动态探针运行`node brogue-web/scripts/x0-observe.mjs /tmp/brogue-x0-build`，需要该目录包含对应src和esbuild依赖；它只合成内存局面，不读用户存档。
