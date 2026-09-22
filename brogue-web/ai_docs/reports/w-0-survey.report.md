# W-0：杖与魔杖子系统勘察与分轮方案

基准：`4426154d99fc4e237220f2ae85903e207d1f9780`，2026-09-22。本轮只读生产代码；结论限于本仓库所附 CE 源码，不套用其他 Brogue 版本。

**建议拆成 26 个独立派发单元，详见 §2。** 不是“补六个 switch 分支，再加物品”就能收口：还有路径截断、附魔量纲、充能、毒伤、护盾、召唤、阵营/克隆等不同爆炸半径的欠账。机制改动、效果改动、入池改动应分别验收。

核实后的主要数字：

| 口径 | 实测 |
|---|---:|
| CE 杖 / 魔杖种类 | **12 / 9，共 21** |
| web `arcana.json` 杖 / 魔杖定义 | **7 / 7，共 14** |
| web 对应 CE 的定义，也是当前允许随机生成的种类 | **6 / 5，共 11** |
| web 自创且已退池 | **1 / 2，共 3** |
| 缺少的 CE 物品身份 | **6 / 4，共 10** |
| CE `boltEffects` | **22，含 `BE_NONE`** |
| CE `boltType` | **30，含 `BOLT_NONE`**；不是效果数 |
| web `BoltEffect` | **24，含 `NONE`** |
| 玩家 `applyBoltEffect` 的具名 case 标签 | **15**，折合 **14 个 CE 效果** |
| 怪物 `castMonsterBolt` 的具名 case 标签 | **12**；与玩家合并去重为 **19 个 web 成员** |
| CE 杖/魔杖实际使用的效果种类 | **20**；两种伤害杖共用 `BE_DAMAGE` |
| 上述 20 种中，没有玩家 case 的效果 | **6**；这只是分支缺口数，不是完整行为欠账数 |

取证方法：先读表、枚举和函数体；用限定声明范围的提取核数，再用 TypeScript AST 复核 web 枚举及两个方法的 `CaseClause`，不把注释算引用。沿“物品 → 配置 → 选目标 → 路径 → 效果 → 状态/伤害/地形消费”追查。另运行一次性内存场景探针，结果见 §1.4；没有跑 Vitest。测试影响通过生产文件的相对 import/re-export 反向闭包及符号调用点交叉查找，见 §2.2。

下文简称：`GC` = `BrogueCE-master/src/brogue/Globals.c`；`GB` = `BrogueCE-master/src/variants/GlobalsBrogue.c`；`RH` / `IC` / `MC` / `MV` / `TC` / `CC` / `PT` = 同一 CE `src/brogue/` 下的 `Rogue.h` / `Items.c` / `Monsters.c` / `Movement.c` / `Time.c` / `Combat.c` / `PowerTables.c`。web 的 `Game` = `src/engine/Core/Game.ts`，`Bolt` = `src/engine/Combat/Bolt.ts`，`Loader` = `src/engine/Items/ItemLoader.ts`，路径均相对 `brogue-web/`。

## §1.1 CE 杖/魔杖 ↔ web 物品对照

**任务书的 CE 杖表位置有误。** 实际为 `GC:1641` 的 `staffTable[NUMBER_STAFF_KINDS]`，不存在所称的 `staffTable_Brogue`。魔杖表确为 `GB:701` 的 `wandTable_Brogue`。表中 frequency 左列是 CE 原表，右列是 JSON 实值，不能拿 `weight` 代替。

### 杖：CE 12 种

| CE 名 / kind | CE 行 | web id（JSON id 行） | frequency CE / web | 自创？ / 当前状态 |
|---|---:|---|---:|---|
| lightning / `STAFF_LIGHTNING` | GC:1642 | `staff_of_lightning` (:102) | 15 / 15 | 否，在池 |
| firebolt / `STAFF_FIRE` | GC:1643 | `staff_of_fire` (:90) | 15 / 15 | 否，显示名别名，在池 |
| poison / `STAFF_POISON` | GC:1644 | `staff_of_poison` (:114) | 10 / 10 | 否，在池；毒伤链未完成 |
| tunneling / `STAFF_TUNNELING` | GC:1645 | **缺** | 10 / — | CE 原生；有 web 效果枚举和分支，但无物品 |
| blinking / `STAFF_BLINKING` | GC:1646 | **缺** | 11 / — | CE 原生 |
| entrancement / `STAFF_ENTRANCEMENT` | GC:1647 | **缺** | 6 / — | CE 原生 |
| obstruction / `STAFF_OBSTRUCTION` | GC:1648 | **缺** | 10 / — | CE 原生 |
| discord / `STAFF_DISCORD` | GC:1649 | **缺** | 10 / — | CE 原生；有 web 效果分支，但玩家分支用错状态 |
| conjuration / `STAFF_CONJURATION` | GC:1650 | `staff_of_conjuration` (:150) | 8 / 8 | 否，在池；分支仅文案/飘字 |
| healing / `STAFF_HEALING` | GC:1651 | `staff_of_healing` (:126) | 5 / 5 | 否，在池 |
| haste / `STAFF_HASTE` | GC:1652 | `staff_of_haste` (:138) | 5 / 5 | 否，在池 |
| protection / `STAFF_PROTECTION` | GC:1653 | **缺** | 5 / — | CE 原生；不能用 `staff_of_light` 顶替 |

### 魔杖：CE 9 种

| CE 名 / kind | CE 行 | web id（JSON id 行） | frequency CE / web | 自创？ / 当前状态 |
|---|---:|---|---:|---|
| teleportation / `WAND_TELEPORT` | GB:702 | `wand_of_teleportation` (:28) | 3 / 3 | 否，在池 |
| slowness / `WAND_SLOW` | GB:703 | `wand_of_slowness` (:40) | 3 / 3 | 否，在池 |
| polymorphism / `WAND_POLYMORPH` | GB:704 | **缺** | 3 / — | CE 原生 |
| negation / `WAND_NEGATION` | GB:705 | **缺** | 3 / — | CE 原生；效果分支已存在 |
| domination / `WAND_DOMINATION` | GB:706 | **缺** | 1 / — | CE 原生 |
| beckoning / `WAND_BECKONING` | GB:707 | `wand_of_beckoning` (:76) | 3 / 3 | 否，在池 |
| plenty / `WAND_PLENTY` | GB:708 | **缺** | 2 / — | CE 原生 |
| invisibility / `WAND_INVISIBILITY` | GB:709 | `wand_of_invisibility` (:52) | 3 / 3 | 否，在池 |
| empowerment / `WAND_EMPOWERMENT` | GB:710 | `wand_of_empowerment` (:64) | **1 / 3** | 否，在池；**权重错抄** |

`Loader:47` 的“wandTable 全 3”注释也是错的：domination、empowerment 为 1，plenty 为 2。`Loader:576` 左右的“CE 其余 5 种杖 web 缺”也应是 **6**。这两个注释不能继续作为后续抄表依据。

### web 额外的三条定义

| web id / JSON 行 | CE 对应 | frequency | 自创登记是否成立 | 是否退池 / 是否还能构造 |
|---|---|---|---|---|
| `wand_of_fire` :4 | 魔杖表无此物；CE 火是 staff | 字段缺省 | **成立**，类别错位的自创物品 | `excludeFromGeneration:true`；`spawnWand` 仍可构造；Bolt:86 配置保留 |
| `wand_of_lightning` :16 | 魔杖表无此物；CE 闪电是 staff | 字段缺省 | **成立** | 同上；Bolt:87 配置保留 |
| `staff_of_light` :162 | CE 杖表无 light | 字段缺省 | **成立**；其效果不是 CE protection | 已退池；`spawnStaff` 仍可构造；Bolt:101 映射 SHIELDING，实际给 telepathy |

退池并非仅凭测试头注：JSON 标记 → `Loader:81–94` 的 `filterPool` → `Game:838–842` 的普通生成抽签，链条明确；运行时读到 `genWands.length=5`、`genStaffs.length=6`。蓝图物品路径还应按其显式 id/类别解析另验，不能把退池理解为禁止直接构造。`invented_content_pool.test.ts` 的登记对此三物仍正确。

CE 杖 frequency 合计 110，web 在池杖合计 58；CE 魔杖合计 22，web 在池魔杖合计 15（同一 CE 子集本应是 13）。这是不同候选池的权重合计，不是掉落率百分比。缺省 frequency 也不等于 0：`Game:865–868` 抽签兜底为 10，但上述三物先被排除，不进入普通抽签。

## §1.2 CE `BE_*` ↔ web `BoltEffect`

CE 权威枚举为 `RH:1824–1847`，22 个成员。下表完整覆盖，`P` = 玩家 `applyBoltEffect`，`M` = 怪物 `castMonsterBolt`，行号均为 **Game 中真正的 case**，不是注释命中。无 case 不等于缺少某个非物品系统；有 case 也不等于 CE 语义完成。

| CE 效果（RH 行） | web 枚举成员 | Game 有无 case：P / M | CE 消费者 / 映射判断 |
|---|---|---|---|
| `BE_NONE` (1825) | `NONE`；怪物 DF 两项映射为 `null` | 无 / 无 | `BOLT_NONE` 哨兵；spider 的 SPIDERWEB、mangrove dryad 的 ANCIENT_SPIRIT_VINES（GB:83、88）靠 DF 生效，**不是杖/魔杖欠账** |
| `BE_ATTACK` (1826) | `DISTANCE_ATTACK`、`POISON_DART` | 无 / **有 :4655、4656** | arrow turret / centaur 的箭，dart turret 的飞镖；另有 WHIP（GB:89、MV:889/906），web 的鞭/延伸攻击走独立武器几何，不能要求都经此 switch |
| `BE_TELEPORT` (1827) | `TELEPORT` | **有 :4391** / 无 | teleportation 魔杖；会移动目标，但目的地/占位/IMMOBILE/俘虏处理不齐 |
| `BE_SLOW` (1828) | `SLOW` | **有 :4421 / :4750** | slowness 魔杖；SLOW_2：ogre totem、dar battlemage、pixie；两种 magnitude 不同 |
| `BE_POLYMORPH` (1829) | **无** | 无 / 无 | polymorphism 魔杖；缺枚举与效果 |
| `BE_NEGATION` (1830) | `NEGATION` | **有 :4541 / :4769** | negation 魔杖；dar priestess、pixie；已清状态/杀特定魔法生物，尚缺完整能力剥离 |
| `BE_DOMINATION` (1831) | `DOMINATION` | 无 / 无 | domination 魔杖；枚举空壳 |
| `BE_BECKONING` (1832) | `BECKONING` | **有 :4455 / :4784** | beckoning 魔杖；mirrored totem；web 只拉两格，不是 CE 的反向 blink |
| `BE_PLENTY` (1833) | **无** | 无 / 无 | plenty 魔杖；缺枚举与效果 |
| `BE_INVISIBILITY` (1834) | `INVISIBILITY` | **有 :4505** / 无 | invisibility 魔杖；挂状态有行为，但时长/空射回落到自己均不同 |
| `BE_EMPOWERMENT` (1835) | `EMPOWERMENT` | **有 :4520** / 无 | empowerment 魔杖；加血量有行为，但不是 CE 的完整强化/学习 |
| `BE_DAMAGE` (1836) | `FIRE`、`LIGHTNING`、`SPARK`、`DRAGONFIRE` | **P :4307、4338；M :4654、4657、4658** | firebolt / lightning 杖；FIRE：dar battlemage、lich、flame turret、flamedancer；SPARK：goblin totem、spark turret、ogre shaman、dar priestess、sentinel、pixie；DRAGONFIRE：dragon |
| `BE_POISON` (1837) | `POISON` | **有 :4375** / 无 | poison 杖；有状态写入，**缺持续毒伤和浓度**，不是完整毒杖实现 |
| `BE_TUNNELING` (1838) | `TUNNELING` | **有 :4567** / 无 | tunneling 杖；正常路径在加入墙格前已中断，分支挖不到墙 |
| `BE_BLINKING` (1839) | `BLINKING` | 无 / 无 | blinking 杖；dar blademaster、imp、vampire、winged guardian；CE 另用于 beckoning 内部移动；web 怪物通用施法过滤它 |
| `BE_ENTRANCEMENT` (1840) | `ENTRANCEMENT` | 无 / 无 | entrancement 杖；还缺 entranced 状态与玩家动作联动 |
| `BE_OBSTRUCTION` (1841) | `OBSTRUCTION` | 无 / 无 | obstruction 杖；需要落点力场 DF、强度参数和生命周期 |
| `BE_DISCORD` (1842) | `DISCORD` | **有 :4479 / :4760** | discord 杖；dar battlemage、pixie、vampire、ifrit；**P 写 confused，M 才写 discordant** |
| `BE_CONJURATION` (1843) | `CONJURATION` | **有 :4492** / 无 | conjuration 杖；P 只有 `spawnFloatingText` 和 logger，**没有生成刀刃** |
| `BE_HEALING` (1844) | `HEALING` | **有 :4434 / :4725** | healing 杖；ogre totem、dar priestess、sentinel、unicorn；P 治自己而非命中者，M 固定 25% |
| `BE_HASTE` (1845) | `HASTE` | **有 :4446 / :4734** | haste 杖；goblin totem、ogre shaman、dar priestess；P 固定加速自己 15 回合 |
| `BE_SHIELDING` (1846) | `SHIELDING` | **有 :4498 / :4744** | protection 杖；goblin mystic、unicorn；P 是 telepathy，M 只写 shielded 时长，**不吸收伤害** |

注意 `Bolt.ts` 的部分 CE 行号注释已漂移：本次原表中 lightning/fire 为 GB:70/71，obstruction 为 :76，spiderweb/spark/dragonfire 为 :83/84/85，arrow/dart/vines/whip 为 :86/87/88/89；应以原表行核对。

怪物消费者从 `GC` 的 `monsterCatalog` 实际 `bolts` 列反查，非从描述猜测。原行索引：SHIELDING 1045/1155；HASTE 1047/1078/1088；SPARK 1047/1069/1078/1088/1098/1108；DISTANCE_ATTACK 1055/1094；HEALING 1065/1088/1098/1155；SLOW_2 1065/1090/1108；SPIDERWEB 1067；BLINKING 1086/1114/1131/1143；NEGATION 1088/1108；FIRE 1090/1104/1112/1133；DISCORD 1090/1108/1131/1157；POISON_DART 1100；DRAGONFIRE 1123；BECKONING 1151；ANCIENT_SPIRIT_VINES 1163。这里列初始目录消费者；不把“强化后可能学会”的运行时消费者冒充初始目录项。

### 六个缺口的精确定义

`DOMINATION / ENTRANCEMENT / BLINKING / OBSTRUCTION` 在 web 枚举中有声明，在 Game 中无成员引用、无 case；`POLYMORPH / PLENTY` 连枚举也没有。这六项判断成立。

但 **6 不等于“仅剩六种效果待实现”**。另有 conjuration 纯表现桩、shielding 无防护、tunneling 正常链无挖墙、poison 缺毒伤等机制缺口，以及其余效果的目标/数值/资格差异。不能把“15 个玩家 case”叫作“15 个已完成 CE 效果”：FIRE/LIGHTNING 还是同一个 CE 效果的两种配置。

### 任务书额外六个名字

| 所列名字 | 本仓库 CE 结论 |
|---|---|
| `BE_SWAPPED` | 不在 `enum boltEffects`；CE `src/` 中无这个 token |
| `BE_ENCHANTED` | 同上 |
| `BE_IDENTIFIED` | 同上 |
| `BE_DETECTED` | 同上 |
| `BE_BRIDGED` | 同上 |
| `BE_TRAP_FREE` | 同上 |

**它们不是本版本的 CE `BE_*`，无法给它们分配“卷轴效果”身份。** 换装、附魔、鉴定、探知、桥和探明无陷阱各有其他路径/常量，不能因此创造六条 bolt 映射。22+6 恰好是 28，但本轮无法证明验收方当时具体如何得到 28；只能排除该数字来自当前权威枚举。

### 类型拆分是否造成行为偏差

任务书把 `DISTANCE_ATTACK / POISON_DART` 举成 `BE_DAMAGE` 的拆分，**不正确**：二者为 **`BE_ATTACK`**（GB:86–87）。CE 对前者走 `IC:5136–5144 → attack()`，对伤害魔法走 `IC:5146–5218 → staffDamage()`；dart turret 的致弱是物理攻击能力，不能因为名字有 POISON 就套毒杖。

将 `BE_DAMAGE + flags` 表示为多个 web 成员，本身可以等价；当前偏差来自没有保留共用语义：

- 玩家火/电把 magnitude 直接扣 HP；怪物火/电却走 `CombatSystem.attack` 的命中、防御、怪物 damageString 与 onHit（Game:4603–4609、4673）。CE SPARK/FIRE/DRAGONFIRE 都应按目录 magnitude 调用同一伤害公式。怪物这条简化有既往留形说明，**不能把它当成 CE 对齐**，也不应偷偷随玩家杖轮一并改掉。
- 玩家火伤只有无敌/反射检查，没有 CE `immune_fire` 的伤害豁免；点燃地形和伤害豁免是两件事。怪物选目标处已有 fiery 过滤，仍不等于玩家直伤链已有该检查。
- LIGHTNING 有逐格伤害循环，但自动瞄准后的路径到最近目标即结束；SPARK 的怪物伤害仅向指定目标结算，缺 CE 穿透多个生物。DRAGONFIRE 的 `pathDF=DF_OBSIDIAN` 未接；它并不是仅凭名字就可认定的“范围火伤”（web 枚举注释亦不能作为依据）。
- 电触发不是全缺：`exposeBoltPathToElectricity` 已支持 LIGHTNING/SPARK，玩家/怪物两出口均调用；9c 的电晶体链必须保住。

## §1.3 机制前置盘点

### CE bolt 的逐字段映射

`RH:1862–1875` 为 12 个字段；web `Bolt:59–78` 为 9 个字段。

| CE 字段 | web 状态 | 对效果的阻塞/处理建议 |
|---|---|---|
| `name` | `name` 有；按物品 id 生成翻译名 | 非主要机制阻塞；CE bolt 名与物品名应区别 |
| `description` | 无对应；arcana 的描述是物品说明 | 阻塞施法事件完整文案，不阻塞伤害本体 |
| `abilityDescription` | 无对应 | 强化学习/怪物能力说明用；不能拿名称替代能力定义 |
| `theChar` | `char` 有 | 当前能画轨迹；没有沿整条显示等旗标 |
| `foreColor` | `color` 近似 | 单色 glyph 可留形；不是双颜色照明模型 |
| `backColor` | 无独立载体 | 光照/隐去未知射线细节需另接；不应成为补六效果的强依赖 |
| `boltEffect` | `effect` 有，语义拆分见上 | 缺 POLYMORPH/PLENTY；类型应与配置/命中方式区分 |
| `magnitude` | 同名但量纲混杂 | **硬阻塞**所有按附魔缩放的杖效果，详见公式小节 |
| `pathDF` | 无 | 阻塞沿途蛛网/藤/龙火黑曜石；DF 引擎本身已存在 |
| `targetDF` | 无 | 阻塞蜘蛛网/藤的普通落点 DF；**不是 CE obstruction 的实际目录入口** |
| `forbiddenMonsterFlags` | 无通用字段 | 有底层 behaviorFlags，但缺 bolt 资格表；自动瞄准过滤与命中后免疫须分别实现 |
| `flags` | 无统一载体，零散布尔/硬编码 | 见下一表；影响路径、敌友选择、反射和学习/消魔 |

web 的额外字段：`id` 是 lookup 身份，可保留；`maxRange` 是 web 扩展，注释 0=地图边缘，实际 `computeBoltResult:4180` 以 40 截断，且 `boltPath` 到 target 就停；`piercing` 仅覆盖穿怪；`selfTargeting` 仅把 target 设为施法者坐标。所有 14 条物品配置的 selfTargeting 均为 false，不能据此宣称 blink 有前置支持。

### 十个 CE bolt flags

| CE flag（RH:1849–1860） | web 实际情况 |
|---|---|
| `BF_PASSES_THRU_CREATURES` | 物品 `piercing` 部分表达；路径至 target 截断，怪物 SPARK 无多目标伤害 |
| `BF_HALTS_BEFORE_OBSTRUCTION` | 无；CE 用于 blink / obstruction / conjuration，需区分最后可达格与命中生物格 |
| `BF_TARGET_ALLIES / BF_TARGET_ENEMIES` | MonsterBoltMeta 有；玩家自动目标无对应，所有活且可见格上的怪物按距离排序 |
| `BF_FIERY` | 按 FIRE/DRAGONFIRE 硬编码；火免及命中点燃未完整共享 |
| `BF_NEVER_REFLECTS` | 怪物按 SPARK/FIRE/DRAGONFIRE 硬编码可反；玩家只在火/电伤害分支近似反伤，没有通用反射弹道 |
| `BF_NOT_LEARNABLE` | 无完整载体/学习链；PLENTY、EMPOWERMENT 等禁止学习项不能遗漏 |
| `BF_NOT_NEGATABLE` | 无完整能力剥离链；应随 negation/学习闭环处理 |
| `BF_ELECTRIC` | LIGHTNING/SPARK 的沿途电触发已接，属于部分等价实现 |
| `BF_DISPLAY_CHAR_ALONG_LENGTH` | 无；用于 WHIP 等表现，物品主线不依赖 |

### 路径、落点、移动与地形：需要纠正的依赖

1. **OBSTRUCTION 不依赖“先填 targetDF”。** GB:76 的 obstruction 行 `pathDF=0,targetDF=0`。`IC:5486–5493` 在 `detonateBolt` 内复制 `DF_FORCEFIELD`，按 magnitude 改 probabilityDecrement 后生成；普通 targetDF 是 switch 之后的 `IC:5562–5564`。正确前置为：可选落点/遇阻前停 → 效果落地出口 → 可带参数的 `spawnDungeonFeature` → FORCEFIELD 扩散与消融。它可以复用通用 DF 出口，但不能填一个固定 targetDF 交差。
2. web **不是从零做 DF**：`Map/DungeonFeature.ts:125` 已有 `probabilityDecrement`，`:704` 有 spawn 入口；`TerrainCatalog:537–552` 已有 FORCEFIELD / FORCEFIELD_MELT 和消融晋升。缺的是 **`DF_FORCEFIELD` 目录项**（CE GC:674，SURFACE、100/50、flags=0）及 bolt 落地接线；现只有 `DF_FORCEFIELD_MELT` 等。CE spawn 的末参 false 是不做连通性拒绝，web 调用不能误写成“堵路就取消”，阻障术本来就要堵路。
3. `Bolt:127–131` 的头注讲的是 **SPIDERWEB / ANCIENT_SPIRIT_VINES**，不是 obstruction。两种网/藤 DF 在 web 目录也未实现；龙火 DF_OBSIDIAN 已有目录但 bolt 未调用。把这条注释当阻障术的准确前置说明，会再次误判。
4. **BLINKING 移动施法者，方向目标不等于施法者坐标。** `IC:5635–5647` 检查贴脸障碍、撤去原占位；`:5775–5802` 限距离并在下一障碍/生物之前停；`:5516–5555` 安置 caster、解除束缚、处理潜伏怪占位、触发目的地瞬时地形/拾取/视野。`staffBlinkDistance(E)=2+2E`，循环内部 `blinkDistance=2E+1` 是零基终止索引，不能误读为少一格。需要携带 caster 身份和移动提交结果，不能只写一个目标状态 case。web 同起终点探针返回 `[origin]`，不是移动路径；CE `IC:4162` / `:5587` 拒绝原地发射。
5. **BECKONING 依赖 blink 移动原语。** CE `IC:5076–5089` 是从目标向 caster 反向追踪的第二条 blink，释放俘虏、调整行动等待；web ±2 格跳位会穿过中间障碍、可能越过近邻/重叠，不应作为完成版前置。
6. **TUNNELING 需在墙格处理后决定终止。** web `Game:4191` 在把 WALL/GRANITE 放进 path 前 break，`:4569` 再遍历 path 找墙永远挖不到正常命中的墙。CE `IC:5805–5840` 先 tunnelize、每次成功消耗 magnitude，再停/反射，含不可穿墙与多层障碍；不要只删除 break 让普通法术穿墙。
7. CE `getLineCoordinates(IC:4146…)` 会延伸到图边，并选择能通过目标的路径偏移；web 是固定 Bresenham 线段。除了延伸和碰撞顺序，还有斜角/瞄准边缘差异；需要明确验收用例，不能宣称只改 maxRange 即与 CE 同轨迹。

### forbiddenMonsterFlags 与目标资格

web `Monster.behaviorFlags / hasBehavior` 已存在，状态免疫也存在；因此不是“怪物旗标全缺”。但 `BoltConfig`、`MonsterBoltMeta` 都无完整 forbidden 表，`Monster.ts:110–116` 也记录了这一省略。当前具体情况：

- 怪物 `specificallyValidBoltTarget:118–161` 检查敌友、部分无敌/火免，并对 beckoning 的 IMMOBILE/TURRET 近似拒绝。
- 玩家 `zapBoltFromPlayer:4133–4154` 只按活怪、格可见、距离挑目标；不区分 allies/enemies、IMMOBILE/INANIMATE，也不先确认 open path/怪物可见性。
- `applyStatusToMonster:5665` 只查询 statusImmunities / statusResistTurns；这不是目录中的 MONST_INANIMATE 等效判定。teleport/beckoning 的手写移动根本不经过它。
- CE 的 forbidden 表用于自动目标和怪物选目标（IC:6008；MC:2619），命中效果还各有硬资格（如 IC:5221、5275、5312）。**不能把自动目标禁止旗标简单提升为“所有射线碰到它都立即穿过/无效”**；必须逐效果保留 CE 碰撞终止、反射、免疫顺序。

### magnitude：不是 power 字段的“伤害常量”

CE `itemTable.power` 在这里存的是 **`BOLT_*` 索引**。调用链为：

`IC:7353` 根据物品类别/kind 查 power → 复制 boltCatalog 项 → `:7354–7355` **STAFF 用实例 enchant1 覆盖 magnitude** → `zap/updateBolt/detonateBolt` 使用公式。WAND 不覆盖，保留目录 magnitude（当前九种均 10）。不能把 staffTable.power 直接当附魔，也不能用剩余 charges 当威力。

公式实际定义在 **`PowerTables.c`，不是 Items.c**。以下 E 为正整数附魔等级；固定点输入为 `E*FP_FACTOR`，C 整数除法/查表舍入须保留：

| 效果 | CE 实际公式 / 消费位置 | web 现状 |
|---|---|---|
| 火 / 电伤害 | PT:49–51：lo=`floor((2+E)*3/4)`，hi=`4+floor(5E/2)`，`randClumpedRange(lo,hi,1+floor(E/3))`；IC:5168 | 火杖恒 6，电杖恒 10；自创火/电魔杖为 5/8；无附魔输入 |
| blink | PT:52：`2+2E` | 无移动实现 |
| haste | PT:53：`2+4E` 回合 | P 恒给自己 15 |
| conjuration | PT:54：`floor(3E/2)` 把刀刃 | 配置 3，但无召唤 |
| discord | PT:55：`4E` 回合；IC:5392 与已有状态取 max | P confused 15；M discordant 常量 |
| entrancement | PT:56：`3E` 回合 | 无状态载体/行为 |
| protection | PT:57–59：`130 * fp_pow(1.4固定点,E-2)/FP_FACTOR` | 无吸伤量；CE 是十分之一 HP 单位，CC:1811–1818 消耗 `damage*10`，不能照抄为 130 HP |
| poison | PT:60–69：`5*POW_POISON[clamp(E-2,0,50)]/FP_FACTOR`；IC:5324 → addPoison(duration,1) | 配置 4 → poisoned 12；只挂时长，无浓度/持续伤害 |
| healing | IC:5367 → heal(`E*10`,false)；:4663 后按目标 maxHP 百分比治疗 | P 给自己固定 8 HP；M 25% |
| tunneling | IC:5813 每成功开障碍消耗 1 magnitude | 墙未进入 path，且没有穿墙预算 |
| obstruction | IC:5479–5489：`max(1,75*POW_OBSTRUCTION[min(40,E)-2]/FP_FACTOR)`，查表约 `0.8^E` | 无实现；需测试 E 下界，不能让默认 enchantment=0 进入负索引 |
| slowness 魔杖 | IC:5243：目录 magnitude 10 ×5 = **50** 回合 | P 固定 20；GB:703 说明文字写 30，与代码不一致，应按代码验收 |
| invisibility 魔杖 | IC:5270：目录 magnitude 10 ×15 = **150** 回合 | P 固定 20，并在没打中怪时给自己隐形 |

数值锚点：火/电杖 E=2 时伤害区间 **3–9、clump=1**，E=8 时 **7–24、clump=3**。因此探针的 E=2/E=8 都造成 6 点伤害，不能解释为正确附魔缩放的随机结果：调用链根本没有读取 item.enchantment。

**判定：玩家杖的常量威力是 CE 对齐缺陷。** `Bolt:66` 的“Base damage or magnitude”只描述混合现状，不是 CE 等价证明。已明确登记为旧轮留形的是怪物伤害链（Game:4603–4609、`ai_docs/p4_1b_monster_casting_report.md`），二者须分开记录。无论历史是否有意简化，都不能标作已完成。

### 实例、资源与复杂生物前置

- `Loader:1313–1348` 给杖/魔杖固定 maxCharges、满电、固定 rechargeTurns；杖继承 `Item.enchantment=0`。CE `IC:323–347`：杖初始 2，50% 加 1，再以 15%/10% 尾部增量抽取，enchant1=初始 charges；魔杖按各自 range 抽 charge。**恢复初始充能抽签本身就会移动生成随机流，即使一条新物品也不加。**
- CE 魔杖 range 依次为 teleport 3–5、slow 2–5、polymorph 3–5、negation 4–6、domination 1–2、beckoning 2–4、plenty 1–2、invisibility 3–5、empowerment 1–1，clump 均 1（GB:702–710）。不要统一套 maxCharges=3。
- web `Game:7875` 让 WAND 和 STAFF 都自然回电。CE `TC:2025–2075` 增量充能仅 STAFF/CHARM；杖周期依附魔/智慧、含随机间隔，blink/obstruction 慢一倍。自然回电、充能卷轴、附魔补充次数是三个入口，不能只修 tick。
- web 附魔仅选已装备武器/护甲（Game:4881），充能卷轴随机充一件 wand/staff（:4904）；CE 附魔可选杖/魔杖（IC:7825–7867），杖升 E 与当前次数，魔杖加 range 下限次数；recharging 给 STAFF/CHARM（IC:7904）。这属于真实使用链前置，需独立于新种类入池。
- web `useArcanaItem:4091–4106` 先扣充能、立即亮种类、后选目标；CE 有确认/取消、空充能是否已知、zap 返回 autoID、使用耗时。Game:4121 还固定加 100 tick。应形成“选择 → 确认 → 结算/autoID → 消耗/时间”的一次事务，不能让取消消耗或未知态漏真名。
- **Poison**：`Creature.tickStatuses:160` 仅递减；Game:6164–6196 结算燃烧后调用它，没有毒伤；Monster:953 的回血不查 poison，Player:159/202 倒有中毒停再生。CE CC:1905–1920 同时累加毒时长和浓度，MC:1916–1930 每 tick 扣毒伤。需独立毒状态模型，不能用毒气伤害代替（毒气另为 T_CAUSES_DAMAGE）。
- **Shielding**：Monster:75–92 明说只挂运行时 `shielded` 时长、不挡伤害；Creature:178 直接扣 HP。需要吸收量、衰减、毒伤等绕盾参数、统一伤害入口/所有直接扣血点审计。不能仅补一个 `StatusId`。
- **Conjuration**：`monsters.json:1500` 已有 spectral_blade，且已有盟友/召唤基础；缺按落点、数量、绑定关系、等待 tick 生成刀刃。CE IC:5494–5508 的 `MB_BOUND_TO_LEADER / MB_DOES_NOT_TRACK_LEADER` 不能靠普通 horde 召唤自动获得。
- **Domination**：PT:45–46 为当前血量严格低于 20% 时 100%，否则 `max(0,100*(maxHP-HP)/maxHP)`；IC:5275 拒绝玩家/无生命/无敌。成功要清 discord、释放俘虏、处理随从/携物（MV:728–743），不只是 `isAlly=true`。
- **Entrancement**：Creature:9 无 entranced；CE MV:714–725 让受控怪执行玩家动作的**反方向**，MC:3350 停自主回合，玩家反射中招为 confused（IC:5343），攻击受控目标会解术。不是 confusion 的另一个名字。
- **Polymorph**：IC:4572–4634 包含去盟友/突变、排除 INANIMATE/NO_POLYMORPH/原物种、保留血量比例与已损失量的 max 规则、重设能力/速度/状态、移除携带生物及被抓关系；web 无通用变形入口。
- **Plenty**：IC:5374–5388 调 cloneMonster 后双方当前 HP 向上取半；MC:568–629 复制生物关系/状态、清携物、不复制领袖/俘虏标志，并处理反射克隆玩家。web `trySplitMonster:6680–6768` 是受击分裂专用，有 MA_CLONE_SELF_ON_DEFEND 门、群外缘落点、复制字段子集；可参考但不能直接充当 plenty。
- **Empowerment**：CE MC:547–556 是 maxHP+12、defense/accuracy+10、伤害上下限各增 max(1,原值/10)、学习计数+1、全疗并解部分负面；可多次强化。web 只按敌友把 maxHp 乘 1.3/1.5 并补满，缺学习计数/吸收技能。JSON “每只只能强化一次”也不符 CE。强化数值和尸体学习分别拆轮。
- **Negation**：Game:4960 清全部时长、重推永久旗标状态并杀 diesIfNegated；CE IC:4480–4555 另有 mutation/abilityFlags/bolt 处理和 NEGATABLE_TRAITS。已经存在的是部分效果，缺 wand_of_negation 物品不代表效果全缺；要留意消魔对毒/盾/催眠/强化新增状态的不同规则。

## §1.4 一次性运行探针

使用 esbuild 将本工作树模块临时打包为 `/private/tmp/zz_w0_probe.mjs`、`zz_w0_poison.mjs` 后 Node 执行，finally 删除。场景为全地板 Grid、Player(4,5)、真实 Monster/ItemLoader；通过 Game 原型调用原 `computeBoltResult / applyBoltEffect / zapBoltFromPlayer / tickCreatureStatuses`。仅视觉回调置空；火测试将 ignite 置空以隔离直接伤害，**不据此推论环境火伤**。这是局部管线探针，不是整局玩法或 CE 二进制差分测试。

| 探针输入 | 实际结果 |
|---|---|
| Loader 生成池 | wands=5，staffs=6 |
| 新建 fire 杖实例 | enchantment=0，maxCharges=2 |
| 空场 conjuration | monsters 0 → 0 |
| 空场 shielding | 玩家状态 `{telepathy:25}` |
| (5,5) 放墙，朝 (8,5) tunneling | path=[]，墙不变 |
| 火杖实例 enchantment 分别设 2、8，对 100HP 怪施法 | 两次均扣 6HP |
| 闪电自动瞄准，怪位于 (6,5)/(8,5)，各 100HP | path=[(5,5),(6,5)]；HP=[90,100]，第二只未命中 |
| 玩家和目标各 10HP，healing magnitude=8 | 玩家变 18，目标仍 10 |
| 怪挂 applyShieldStatus(15)，调用 takeDamage(7) | shielded 仍 15，HP 直接减 7 |
| 毒杖命中 100HP 怪后跑 5 次真实 tickCreatureStatuses | poisoned 12 → 7，HP 100 → 100 |
| boltPath 起终点同为 (4,5) | 返回 [(4,5)]，不能作为 blink 位移 |

## §2 分轮方案（主要交付）

### §2.1 切分原则、边界与随机流口径

**26 个独立派发单元**：W-1～W-7 建机制/实例/资源前置，W-8～W-23 收口效果，W-24～W-26 补物品并入池。其中毒、盾、召唤、支配、催眠、变形、克隆各自一轮；强化数值与学习再拆两轮。它们会触及不同的状态、回合、实体身份、伤害或存档闭包，合并会复现 9b 的归因困难。

这是一份针对**杖/魔杖达到可验收 CE 行为**的方案，不要求顺便重写所有怪物 AI/渲染。怪物 BE_DAMAGE 改回 CE 公式、怪物自主 blink、蛛网/藤射线、WHIP 表现分别登记为旁支，不混入主线。必要的共享能力（如护盾吸伤、毒浓度、negation）会影响怪物，必须在相应轮明确列出。

“生成流”一列专指新局/直接下层生成时的 substantive RNG 与候选抽签。标“否”的战斗修复仍可能改变**交互后的 RNG 与下层结果**，不保证整段游玩重放与旧版一致。特别注意：

- W-5 恢复实例充能抽签，**会移动生成流**，即使还没有增加种类。
- W-24～26 改 kind 候选/频率，**会移动生成流**，不能保证只是换物品名；后续条件、抽签上界与重试可能连带地图/怪物改变。
- 只增配置/纯函数、不调用、不入池，可以不动生成流。若提前在 arcana 增新定义，须先排除生成并另审所有全量数组消费者；本方案直接把新 JSON 定义留到最后。
- `Loader:1060–1093` 风味洗牌走 COSMETIC；不能反过来声称“只加风味项必然移 substantive”。现有外观池容量也足够补入这些种类，不必在主线扩外观池。
- 不通过改蓝图 frequency/生成过滤来掩盖法器还不可用；本轮亦不解禁先前禁用的机器。

每轮均应带限定范围的新语义守卫（后续轮新增，本轮没有写），构建及反查所得定向测试。测试红灯分成“旧留形断言需翻正”“意外回归”“预期生成漂移待归因”；不能把影响闭包内所有文件自动当成可改断言的授权。

### §2.2 从生产文件反查测试：方法与本轮实测

任务书给的 `src/test/*.test.ts src/data/*.test.ts` 会漏 `src/engine/**` 的测试。当前递归扫描共有 **111** 个 `*.test.ts`。方法分两层：

1. **R(files)**：对该轮预计改动的生产文件建立反向 import/re-export 闭包，包含 type import、经 harness 的间接引用。派发前用最终文件白名单重跑，列出具体测试路径；新增模块还应把接线的调用方放进 seeds。
2. **S(pattern)**：在闭包和全体测试中搜公开 API、私有桥接调用、数据字段、文件读取与旧行为断言，逐条读命中的断言，划定“可以随 CE 真值翻正”的那一小部分。注释命中只能发现线索，不能证明被测行为。

本轮 TypeScript AST 反查（静态相对模块图；不把动态 import/读文件扫描冒充已覆盖）：

| 生产文件 | 直接引用测试（举完整小集合或代表项） | 反向闭包测试数 |
|---|---|---:|
| `Combat/Bolt.ts` | `data/monsterBolts.test.ts`；`test/p4_1b_monster_casting.test.ts`；`test/p4_3_special_monster_flags.test.ts`；`test/v_2b_9c_effects.test.ts`（直接引用共 4） | 92 |
| `Core/Game.ts` | `engine/Core/startingKit.test.ts`、`snapshotQuantity.test.ts`，及 B-1、P2、P4、scroll、生成/机器等；另有仅经 harness 间接引用者 | 91 |
| `Items/ItemLoader.ts` | `engine/Items/itemFlavors.test.ts`、B-1 三文件、`b_4a_item_generation`、`b_4b_item_placement`、`invented_content_pool` 等 | 93 |
| `Items/Item.ts` | `engine/UI/DetailGenerator.test.ts`、上述快照/鉴定/投掷/物品等 | 93 |
| `data/arcana.json` | `test/blueprint_center.test.ts`、`invented_content_pool.test.ts`、`p1_30_i18n_gate.test.ts`、`v_2b_6_keys.test.ts`（直接引用共 4） | 93 |
| `entities/Monster.ts` | P4 全组、P2、怪物数值/状态/机器等 | 91 |
| `entities/Creature.ts` | `test/armor_model_effect.test.ts`、`f_2c_explosion.test.ts`、`p2_0_seeded_rng.test.ts`、`p2_1_tick_architecture.test.ts`（直接引用共 4） | 93 |
| `Map/DungeonFeature.ts` | `c_4b_dungeon_feature`、`c_8_connectivity`、G-1/G-2、V-2b 机器/9c/9e 等 | 100 |
| `Map/DungeonFeatureCatalog.ts` | `c_4b_dungeon_feature`、`c_4c_promotion`、F-1/F-2a、G-2、V-2b 等 | 101 |

这些是**可能受影响的结构集合**，不是预计必红数，也不是本轮跑过的测试数。Game 的共享范围很大，正是不能仅写“授权 bolt.test.ts”的原因。

复现 R 的内联命令（在 brogue-web；无需落探针脚本）：

```sh
W0_FILES='src/engine/Combat/Bolt.ts src/engine/Core/Game.ts' node --input-type=module <<'JS'
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const walk = d => fs.readdirSync(d, {withFileTypes:true}).flatMap(e =>
  e.isDirectory() ? walk(path.join(d,e.name)) : [path.join(d,e.name)]);
const files = walk('src').filter(f => /\.(ts|vue|json)$/.test(f));
const deps = new Map();
for (const f of files) {
  const s = ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true);
  const imports = [];
  const visit = n => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
        n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) &&
        n.moduleSpecifier.text.startsWith('.')) {
      const p = path.normalize(path.join(path.dirname(f),n.moduleSpecifier.text));
      const resolved = [p,p+'.ts',p+'.vue',p+'.json',p+'/index.ts'].find(x =>
        fs.existsSync(x) && fs.statSync(x).isFile());
      if (resolved) imports.push(resolved);
    }
    ts.forEachChild(n,visit);
  };
  visit(s); deps.set(f,imports);
}
const seen = new Set(process.env.W0_FILES.split(/\s+/));
let changed = true;
while (changed) {
  changed = false;
  for (const [f,ds] of deps) if (!seen.has(f) && ds.some(d => seen.has(d))) {
    seen.add(f); changed = true;
  }
}
console.log([...seen].filter(f => f.endsWith('.test.ts')).sort().join('\n'));
JS
```

S 的环境兼容写法（本机没有 rg）：`find src -name '*.test.ts' -exec grep -lE 'PATTERN' {} +`。正式有 rg 的环境可用 `rg -l 'PATTERN' src -g '*.test.ts'`。下面定义检索组，**每轮表内的 R+S 是该轮反查方法，不是凭测试名猜白名单**：

| S 组 | PATTERN | 本轮文件命中数 / 关键检索结果 |
|---|---|---|
| B：射线 | `Combat/Bolt\|BoltEffect\|getBoltForItem\|zapBoltFromPlayer\|computeBoltResult\|castMonsterBolt` | 6：上述 Bolt 直接 4 项，另有 `p1_28_flag_channel`、`p4_2_monster_summoning` |
| Q：法器资源/身份 | `useArcanaItem\|spawnStaff\|spawnWand\|tickArcanaResources\|rechargeRandomArcana\|enchantEquippedItem\|magicCharDiscoverySuffix\|arcanaFlavor` | 8：`itemFlavors`、B-1 三项、`invented_content_pool`、`p1_37_machine_flag_i18n`、`p4_10_waypoint`、`v_2b_9c_effects` |
| D：地形 | `DungeonFeature\|TerrainCatalog\|Promotion\|FORCEFIELD` | 31；优先 c_4b/c_4c、scroll_effects、9c，再看地图/机器间接影响 |
| C：伤害/状态 | `CombatSystem\|takeDamage\|tickCreatureStatuses\|statusDurations\|tickStatuses` | 17；P2/P4、燃烧/爆炸与状态用例 |
| M：怪物关系 | `entities/Monster\|summonMinions\|trySplitMonster\|isAlly\|leader` | 46；P4-2/3/4/5/6、怪物数值、休眠/盟友/快照 |
| G：生成/物品 | `ItemLoader\|arcana\.json\|terrainFingerprint\|generateDepth\|chooseKind` | 56；b_4a/b_4b、invented_content_pool、blueprint_center、v_2b_6_keys、generation_baseline |
| U：输入 | `InputManager\|engine/Input\|InventoryOverlay\|GameCanvas\|handlePlayerAction` | 38；p1_46_keybindings、B-1、UI/P2、动作消费用例 |

表里的竖线是正则交替（复制时使用普通 `|`）。命中数是静态检索线索，不能作为授权测试数量。还应补搜 JSON/源码 `readFileSync`、快照 fixtures 和 `src/engine/**` 测试；改存储字段必反查 `saveSnapshot/loadSnapshot`。

### §2.3 机制前置七轮

文件简称：B=Bolt.ts，G=Game.ts，L=ItemLoader.ts，I=Item.ts，M=Monster.ts，C=Creature.ts；其完整路径已在上文定义。表内“新 helper”指可以在该轮增加的生产模块，不是本轮新增。

| 轮次 | 范围、完成边界与物品 | 前置 | 移动生成流？ | 预计生产面 → 反查方法 | 预估撞红面 / 必验收点 |
|---|---|---|---|---|---|
| **W-1 身份与配置契约** | 建 CE bolt 类型/效果/旗标/magnitude 语义映射、施法者/命中者/落点/autoID 结果契约；补 POLYMORPH/PLENTY 类型。保留现有路由，不新增 JSON 物品 | W-0 | 否 | B、G、独立映射 helper → R(B,G)+S(B,Q) | Bolt 配置构造的 TS 编译、monsterBolts、P4-1b 已知缺口表；不要偷偷启用怪物 BLINKING/网/藤 |
| **W-2 施法选择与提交** | 已有 11 件 CE 法器：方向/格选择、敌友自动候选、资格过滤、取消；确认后扣电/推进时间，以结果 autoID；保持未知态。若接发现屏 allies 后缀，明确列入本轮 | W-1 | 否 | G、Input.ts、GameCanvas.vue、InventoryOverlay.vue；后缀接线才含 L → R(这些文件)+S(U,Q,B) | B-1a“用一次就亮”、B-1c 后缀恒 0 可能要翻正；p1_46 键位、P2 耗时/锁输入、取消零消耗、已知/未知空杖耗时 |
| **W-3 普通射线轨迹** | 延伸越过瞄准格、CE 线选取/斜角、全层阻挡、穿怪、遇障前停、同起终点；沿途 fire/electric/DF 和落点调用时序。暂不做 blink/tunnel 特殊地形操作 | W-1、W-2 | 否 | B、G；尽量只调用现有 Map 原语 → R(B,G,实际 Map 调用文件)+S(B,D) | 9c 电晶体与实墙截断、P4-1b/3；两只共线怪、空射、贴脸障碍、门/水晶而非仅 WALL；不得重开全部机器 |
| **W-4 通用反射与命中分派** | 射线反射路径、返回 caster/旁人、玩家也能成为命中者；BF_NEVER_REFLECTS、反复反射终止。先保留各效果旧公式 | W-3 | 否；交互 RNG 会变 | B、G、必要的反射 helper；如改 Combat 明列 → R(实际文件)+S(B,C,M) | P4-3 反射/无敌、护甲反射、P4-4 分裂；不要把旧“反伤自己”当弹道完成；物理箭不能自动归伤害魔法 |
| **W-5 法器实例生成模型** | 只修既有种类的 staff E/charges、wand range 抽签、实例保存/旧档兜底；不增种类、不改 frequency。E 与当前次数分离；旧档按原容量给确定性迁移值 | W-1 | **是：新增生成期掷骰** | L、I、G 快照与独立实例 helper → R(L,I,G)+S(Q,G) | B-1a 固定 `?/2` 等夹具、snapshotQuantity、itemFlavors、b_4a/b_4b、机器配发、生成基线；迁移不抽 RNG |
| **W-6 充能生命周期** | WAND 停自然回电；STAFF 依 E/智慧计时、随机间隔，blink/obstruction 特殊周期预留；充能卷轴的 STAFF/CHARM 范围单独接清楚 | W-5 | 否（初始值留 W-5）；交互 RNG 会变 | G、I、资源 helper；必要时 L → R(实际文件)+S(Q,C,G) 并搜 recharging/ringWisdom | P2 客观时间、B-1/快照、scroll_effects/耗电极性；不可按玩家动作数回电，也不可把护符完整重做混入 |
| **W-7 附魔法器入口** | 可选包内杖/魔杖；STAFF 升 E/次数/充能进度，WAND 加 range 下限次数；本轮不重写武器/护甲附魔规则 | W-2、W-5、W-6 | 否 | G、I、InventoryOverlay.vue、所需文案 → R(实际文件)+S(U,Q,G) 并搜 enchant | invented_content_pool 的装备附魔送符文路径、B-1 识别/保存、取消/物品引用稳定性；附魔后公式读取留后续效果轮验证 |

W-1 不必立即把两个大 switch 合并；先建立可携带 caster 的结果，再分轮迁移。每次迁移列出实际改到的怪物分支，避免“复用 helper”暗中变更怪物简化公式。

### §2.4 效果十六轮

本阶段**不新增 arcana 物品、不改生成权重**。缺物品的效果使用显式测试配置/实例验证，再在最后三轮接正常入口；这些测试配置不能进入生成池。

| 轮次 | 范围 / CE 物品 | 前置 | 移动生成流？ | 生产面 → 反查方法 | 预估撞红面 / 必验收点 |
|---|---|---|---|---|---|---|
| **W-8 伤害杖公式** | FIRE/LIGHTNING：E 伤害分布、火免、无敌、命中点燃/分裂；fire/lightning 杖。怪物 BE_DAMAGE 公式另案 | W-4、W-5 | 否 | G、B、独立公式 helper → R(实际文件)+S(B,C) | P4-3 人工 magnitude=20 的旧语义、P4-4 分裂、9c 电路、F-2 燃烧；E=2/3/8 分布与随机次数，不能复用物理 attack |
| **W-9 基础定向状态** | SLOW/HASTE/HEALING/INVISIBILITY/DISCORD：真正命中者、正确时长/百分比、互斥/资格；对应现有 wand/staff，discord 杖待入池 | W-4、W-5 | 否 | G、必要的 C/M 状态入口 → R(实际文件)+S(B,C,Q,M) | P2-2 速度、P4-1b 友军治疗/discord、scroll_effects 共用状态；miss 不给自己加 buff，反射可命中自己 |
| **W-10 毒状态闭环** | POISON：浓度+时长叠加、每客观 tick 毒伤、再生抑制、免疫/死亡/存档；poison 杖 | W-4、W-5 | 否 | C、M、Player.ts、G、毒 helper → R(实际文件)+S(C,M) 并搜 poison/hunger_regen | P2、hunger_regen、MA_POISONS、P4-5/6/怪物状态、G-3 毒气；毒气不得改成毒状态，叠毒/死亡只结算一次 |
| **W-11 传送目标安置** | TELEPORT：合法位置、占位、IMMOBILE、释放俘虏、移动后的地形/视野；teleportation 魔杖 | W-4 | 否 | G、必要的移动 helper/M → R(实际文件)+S(B,M,D,Q) 并搜 teleport/fall/captive | B-1a teleport 使用、C-5 坠落、P4-5 抓取、V-2b-5 俘虏；未找到位置不能把目标放进墙/另一个生物 |
| **W-12 blink 与反向 beckoning** | BLINKING 移 caster、E 距离、遇障前停；BECKONING 复用反向 blink 到 caster 邻近，释放/等待；blinking 杖待入池、beckoning 魔杖已在池 | W-3、W-4、W-5、W-11 的安置原语 | 否 | B、G、移动 helper；怪物 beckoning 若迁移显列 M → R(实际文件)+S(B,M,D,C) | P4-1b 中 BLINKING **仍不经 tryUseBolt**，另测明确的玩家移动；9c 阻挡、C-5/陷阱、P2 时序、近邻不越位、目的地拾取 |
| **W-13 掘地效果** | TUNNELING：按地形逐层开通、E 预算、不可穿墙/反射、路径与地图缓存；tunneling 杖待入池 | W-3、W-4、W-5 | 否 | G、B、掘地 helper；Map 只改必要接口 → R(实际文件)+S(B,D) | c_4a 层模型、c_3 门墙、c_8 连通、p4_10_waypoint、scroll_effects 碎墙；E=2 连墙预算、不可穿墙保护不能删 |
| **W-14 阻障效果** | OBSTRUCTION：补 DF_FORCEFIELD 原行、E 控制扩散、SURFACE 阻路、允许封路、消融；obstruction 杖待入池 | W-3、W-5、W-1 的落点契约；**不强依赖 pathDF 非零** | 否（新增目录项不应自动用于生成） | G、DungeonFeatureCatalog.ts，复用 DungeonFeature/Promotion → R(实际文件及调用方)+S(D,B) | c_4b/c_4c、scroll_effects 现有力场、9c、c_8；不得硬编码固定面积或堵路取消；涉及 Map 必显式跑 drift |
| **W-15 护盾吸伤闭环** | SHIELDING：吸收量、max 值、衰减、覆盖规则、绕盾伤害、保存；protection 杖待入池；清除 player SHIELDING=telepathy 错配 | W-4、W-5、W-10 的毒伤类型 | 否 | C、G、M、Combat.ts、伤害 helper；逐个反查直接 hp 扣减点 → R(实际文件)+S(C,M,B,D) | P4-1b 现有盾状态、所有直接伤害/环境伤害、armor_model、F-2/G-3、P1-24 死亡；不能只改 takeDamage 因为有直接 `hp -=` |
| **W-16 召唤刀刃** | CONJURATION：落点附近 `floor(3E/2)` 把 spectral_blade、合格格、绑定玩家/不追踪、首行动等待与死亡清理；conjuration 杖 | W-3、W-5 | 否；施法时会用 RNG | G、M、召唤 helper；有新增关系字段则含快照 → R(实际文件)+S(M,B,C) | P4-2 horde 召唤、P4-4 分裂计数、P4-3 消魔死亡、V-2b-5、跨层/存档；不凭一条 Blade 飘字验收 |
| **W-17 支配** | DOMINATION 概率、无效目标、成功转队/清 discord、俘虏/携物/leader；domination 魔杖待入池 | W-4、W-9、W-11 | 否 | G、M、阵营 helper/保存 → R(实际文件)+S(M,B) | P4-2 minions、P4-5 抓取/携物、V-2b-5；HP=满/20%/低于20% 三边界，失败不变队 |
| **W-18 催眠动作链** | ENTRANCEMENT：新状态、反向跟随、禁止自主行动、受击解除、反射混乱；entrancement 杖待入池 | W-3、W-4、W-5、W-9 | 否 | C、M、G、statusConfig/文案/保存 → R(实际文件)+S(C,M,U,B) | P2 调度、P4-5/6 攻击关系/抓取、AI 跟踪、落格地形；等待、撞墙、不合法动作、攻击解除不能凭状态图标验收 |
| **W-19 变形** | POLYMORPH：合格物种抽取、非原物种、去盟友/突变、血量公式、能力/速度/状态/携带生物重置；polymorphism 魔杖待入池 | W-4、W-9、W-17 的关系原语 | 否；仅施法抽物种 | G、M、变形 helper/保存；不改 monsters.json 种类数据 → R(实际文件)+S(M,C,B) | monster_stats_effect、P1-28 永久旗标、P4-3/4/5、实体 id/leader/死亡链；用现有 CE 对应物种投影表，不按深度随意 spawn 替换 |
| **W-20 复制** | PLENTY：通用克隆、双方当前 HP 减半、关系/状态保留、携物不复制、俘虏及反射玩家特例；plenty 魔杖待入池 | W-4、W-17；W-19 后复查字段复制 | 否 | G、M、克隆 helper/保存 → R(实际文件)+S(M,C,B) | P4-4 自分裂、P4-2 召唤计数、P1-24 死亡、快照 id 唯一；clone 失败/无落点、奇数 HP；不得复制共享 Map/Set 引用 |
| **W-21 强化数值与计数** | EMPOWERMENT 的 +12/+10/伤害增量、全疗/解状态、重复强化、newPowerCount/totalPowerCount 保存；empowerment 魔杖 | W-4、W-9、W-20 | 否 | G、M、保存/说明 → R(实际文件)+S(M,C,Q) 并搜 empower/mutation | monster_stats_effect、克隆/变形后属性、快照；去掉“只能强化一次”的错误说明；本轮明确尚未完成学习 |
| **W-22 强化后的学习** | 消费待学次数、选择可学尸体能力、排 BF_NOT_LEARNABLE、吸收动作与实际施法/状态通路；同一 empowerment 魔杖收口 | W-21、W-1 元数据、已完成效果的 caster 通用入口；外部依赖见下 | 否 | M、G、学习 helper、必要的尸体/保存字段 → R(实际文件)+S(M,C,B) 并搜 corpse/absorb | P4-1b/2/3/4、P1-24 死亡、尸体被消费一次/读档中断；新学 bolt 必须有可用执行出口，不得只展示学会 |
| **W-23 消魔能力闭环** | NEGATION：状态逐项规则、可消 traits/abilities/bolts、突变、永久状态重推导、die-if-negated；negation 魔杖待入池，已有卷轴/怪物共用路径显列 | W-9～W-10、W-15、W-18～W-22 | 否 | G、M、C、消魔 helper/保存 → R(实际文件)+S(B,C,M,Q) 并搜 negate/NEGATABLE | p1_28 旧“清完重推导”留形、P4-1b/3、scroll_effects、毒/盾/催眠/强化状态；禁止把全清 status 当 CE 规则 |

W-22 的外部依赖必须显式登记：现有 MONSTER_BOLT_TABLE 只登记初始怪物所用种类，学习到的其他可学 bolt 需要新的执行映射；可学的 BLINKING 还依赖怪物专用 blink 调度，可学的 ANCIENT_SPIRIT_VINES 依赖网/藤 DF 旁支。W-12 的玩家 blink 并不自动完成前者。26 轮是本报告可明确划定的杖/魔杖主线，不含这些怪物旁支的实现派发；它们未就绪时，W-22 只能验收可执行能力子集，不能删掉 CE 合法候选来伪造完整学习覆盖，也不能在 W-26 宣称跨子系统全部 CE 对齐。

W-22 是明确的扩展复杂面，所以独立；若后续授权选择暂缓它，必须把 empowerment 标为“数值已对齐、学习未完成”，不能将 W-21 结案当作整个效果完成。怪物既有伤害公式若仍留形，学习到该 bolt 后同样要在效果清单标出限制，不能通过学习绕过该债项。

### §2.5 物品闭环与生成流三轮

每轮只增加已完成效果的物品。加入 JSON 不是完工：还须同时落配置、frequency、魔法极性、发现屏/鉴定、直接构造、正常 useArcana 入口及机器配发测试。**三条自创项继续退池**，不把 staff_of_light 偷换成 protection，也不删除兼容定义。

| 轮次 | 新增物品 / 数据修正 | 前置 | 移动生成流？ | 生产面 → 反查方法 | 预估撞红面 / 收口要求 |
|---|---|---|---|---|---|---|
| **W-24 魔杖目录闭环** | 增 `wand_of_polymorphism`(3)、`wand_of_negation`(3)、`wand_of_domination`(1)、`wand_of_plenty`(2)；empowerment frequency **3→1**；按 CE range/极性接线 | W-1～7、W-11/12、W-17/19/20、W-23 | **是** | arcana.json、B、L、文案/必要 UI → R(实际文件)+S(G,Q,B,U) | b_4a/b_4b、invented_content_pool、B-1 三项、itemFlavors、blueprint_center/v_2b_6_keys、i18n；目标 genWands=9、频率合计22，定义11（含两退池） |
| **W-25 移动/控制杖目录** | 增 `staff_of_tunneling`(10)、`staff_of_blinking`(11)、`staff_of_entrancement`(6)，特别核 blink 回电周期与瞄准 | W-1～7、W-12/13/18、W-24 基线归因完成 | **是** | 同上 → R(实际文件)+S(G,Q,B,U,D) | 同物品/生成组，另 P2/地形/目标 UI；genStaffs 从6到9，定义10（含 light），频率58→85 |
| **W-26 地形/辅助杖目录与总收口** | 增 `staff_of_obstruction`(10)、`staff_of_discord`(10)、`staff_of_protection`(5)；逐项审计全部 21 种正常施法入口 | W-9、W-14/15、W-25；其余效果轮完成 | **是** | 同上 → R(实际文件)+S(G,Q,B,U,D,C) | 生成/机器、B-1、c_4b/c_4c、9c；genStaffs=12，频率110；最终定义共24（21 CE+3退池），生成种类21；旧档、新局和多 seed 获取均覆盖 |

后两轮按依赖效果划分，避免六条杖同时改池、目标、机器供给难以归因。W-24 的四条魔杖都已经在前轮独立验过，届时只做目录/入口/生成，不再顺手实现效果；若入池前还发现效果缺陷，应退回所属效果轮修复。

### §2.6 后续门禁与授权清单建议

- 每次派发先冻结具体生产文件，再运行 R+S 并读断言，给出“预计改义断言”与“只回归不可放宽断言”两份清单。报告中的大闭包不是修改这些测试的授权。
- 所有轮次 `npm run build`；测试用显式文件参数分批执行。W-0 **只执行 build**，上述建议不是本轮已跑测试。
- W-5、W-24～26 必单列 `npm run test:drift`，先记录漂移和原因，再决定重采。W-3/13/14/15 等只要实际触及 `Generator/Map` 也应显列 drift；未改生成的轮次不得因战斗测试红了就重采地图基线。
- `generation_baseline.test.ts` 只记录地形指纹、怪物数/物种、物品数量，**不记录每种法器频率/充能分布**。即使变更抽签后它恰巧绿，也不能据此判定生成未变；新增种类须补种类/频率/充能的独立分布与随机调用守卫。
- 现有 `p4_1b_monster_casting.test.ts` 明确钉住通用施法跳过 BLINKING，以及网/藤已知缺口。W-12 只补玩家 blink/共用移动原语，不应翻掉这些断言来强行塞进普通怪物施法。
- 新效果用例应验证 HP、位置、地形层、实体数、阵营、状态消费和 RNG/时间边界；不能只断言有 case、日志或图标。映射守卫应钉 CE 表行/字段与语义别名，特别保留 `BE_ATTACK ≠ BE_DAMAGE`、`staff_of_fire ≙ STAFF_FIRE`。

## §3 自检与构建

- 起始 `git status --short` 为空，基准提交见文首；没有用户预存改动需要排除。
- 未改任何生产代码、数据、测试、锁文件或任务书；未增加守卫；未提交代码。
- 枚举/表提取和测试反查均用内联脚本。两个临时运行 bundle 均 `zz_` 开头并已删除；没有留下探针脚本。为构建复制的 node_modules 和本轮生成的 dist 也已清除。
- 首次 `npm run build` 因工作树没有 node_modules，报 `vue-tsc: command not found`，不是编译失败。随后从同一基准的本地主工作树复制依赖到本工作树（没有写主工作树，也没有联网安装/改锁文件），重跑 **`npm run build` 退出码 0**：vue-tsc 通过，Vite 801 modules，构建成功。仅有大于 500 kB chunk 的提示。
- 未运行全量或定向 Vitest；局部运行探针的范围/结果见 §1.4，不冒充回归测试。
- 交付自检：`git diff --stat` 为空（没有 tracked 文件修改）；`git status --short --untracked-files=all` 实测只有：

```text
?? brogue-web/ai_docs/reports/w-0-survey.report.md
```

## §4 对验收方估算的明确纠正

1. **“BE_* 15/28，缺13”错误。** CE 是22个效果（含 NONE），web 是24个自有枚举；玩家15个 case折合14个 CE效果。CE 物品使用20种效果，缺玩家 case 的是6种，不能跨口径相减。
2. **“POISON/TELEPORT/CONJURATION/INVISIBILITY/EMPOWERMENT 无实现”作为“无分支”判断全部错误。** Game 的真 case分别在4375/4391/4492/4505/4520。但任务书改口的“全部已实现”仍过头：CONJURATION 仅表现桩，POISON 只有状态时长、没有持续毒伤；其余三项也有 CE 行为差异。正确表述是“五项都有 case，逐项完成度不同”。
3. **“实际仅缺6种”仅在无 case 这个窄口径成立。** 有分支仍缺召唤、吸伤、正常挖墙、毒伤；物品身份另缺10种。机制前置/物品入口/效果行为必须分别计账。
4. **“额外六种 CE BE_* 可能归卷轴”前提错误。** 它们在本仓库 CE 根本不存在；不纳入 bolt 欠账，也不虚构卷轴映射。
5. **“DISTANCE_ATTACK/POISON_DART 是 BE_DAMAGE 拆分”错误。** 二者属于 BE_ATTACK；伤害魔法和物理攻击的命中/伤害链不同。
6. **“OBSTRUCTION 必须等 targetDF”不准确。** CE 该项 targetDF为0，专门 detonate 分支动态生成 FORCEFIELD。真正前置是落点/停步规则、带参数 DF生成与生命周期；现有 DF/消融地基可复用。
7. **“magnitude 查 Items.c 或 staffTable.power”需修正。** 公式在 PowerTables.c；power为BOLT索引，staff施法以实例enchant1覆盖magnitude。现有固定伤害/默认E=0并未实现附魔威力链。
8. **确认正确的旧登记**：web 7+7条定义、24个 BoltEffect、所列3件自创且已退池均成立；但活跃池只有6+5，empowerment频率还错为3。报告没有为了反驳而推翻这些正确事实。
