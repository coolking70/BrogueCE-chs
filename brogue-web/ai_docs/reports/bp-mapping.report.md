# 蓝图权威映射报告

## 1. 结论与口径纠正

本工作树实际是 **80 条 Web 蓝图**，不是任务书的 78 条。9d 已在原有 78 条之后追加 `reward_goblin_warren` / `reward_sentinel_sanctuary`（CE 13/14）。本轮保留全部条目及原顺序。

逐 feature 核验后，**69 个不同 CE 编号 / 71** 有可辨认的 Web 实现条目；**11 条为 Web 自创/早期简化替身**。这是“原型身份覆盖”，包含留形偏差、零频和隔离条目，不等于 69 条全部逐字/玩法完成。不能把下述差异条目因不全等而判成自创。

新增 `ceBlueprintId` 57 处，其中 46 个数字、11 个 null；为这 11 条补 `ceOrigin`。既有 23 个数字已逐 feature 复核，**全部编号正确，未改写**。CE 52 的唯一所有者保持 `key_electric_crystals`，避免 `blueprintQualifies` 的 `=== 52` 过滤误伤。

缺项只有：

| CE | 原表位置 | 缺失理由 |
|---:|---|---|
| 8 | GlobalsBrogue.c:233–238 | 无房间、size=[0,0] 的外包永久物品奖励：四种 WEAPON/ARMOR/STAFF/CHARM 替代 feature 均带 OUTSOURCE_ITEM_TO_MACHINE 与 BUILD_ANYWHERE_ON_LEVEL。全表没有该结构；两个自创奖励房也不实现它。 |
| 48 | GlobalsBrogue.c:495–498 | CE 自己在 name 中写 `// DISABLED. (Not fun enough.)`，frequency=0；Web 没有其祭坛/eldritch totem 双 glyph-circle feature。 |

CE 13/14 已覆盖；CE 15/43 是两条合法且不同的蓝图。零频不代表自创，退池也不代表“没有这条 CE 身份”；CE 18/52/55 的既有资格过滤和 65/66 的现状全部保留。

## 2. 核验方法与粗统计为什么不可靠

核验基准 Git HEAD：`a23fbcf6af1584b3b07b686a19346e60dfeb5dcf`；CE 原表 SHA-256：`e8903aede4fad21b7823ccc547cf4219c76e87e061543188d8d90141cebffa1e`。

权威输入：[GlobalsBrogue.c](../../../BrogueCE-master/src/variants/GlobalsBrogue.c)、[Rogue.h](../../../BrogueCE-master/src/brogue/Rogue.h)、[Architect.c](../../../BrogueCE-master/src/brogue/Architect.c)。从 `{0}` 后按顺序解析 71 个初始化器，按括号深度拆列，保留实际 C 行号；不是按相似名字批准映射。

逐条核对 depthRange / roomSize / frequency / BP flags、dungeonProfile、声明 featureCt、实际初始化行数；逐 feature 核对 DF、terrain、layer、数量区间、最低数量、itemCategory、itemKind、monsterKind、personalSpace、hordeFlags、itemFlags、feature flags。全表 Web 共 **297 个 feature**：69 个 CE 身份下 **277 个**，11 个自创条目下 **20 个**；CE 71 条共 **285 个显式 feature 初始化行**。包括缺项 CE 8/48、CE 19 被删分支和 CE 24 超出 featureCt 的尾行，都检查了，没有因 Web 无对应行而跳过。

规范化只用于比较，不改数据：旗标按集合比对；CE 0/缺省与 Web 无值按字段语义区分；无物品的 itemKind 0/-1 无生成作用；物品类别非零且 kind=-1 表示随机种类。CE layer=0 在 terrain 非零时是 DUNGEON，terrain=0 时不执行地形层写入；CE 42/F1 的非零 SURFACE 原列也核对保留。Web 缺失 layer **没有**冒充显式 DUNGEON，相应差异列为 L。

已确认的别名：ALTAR_INERT → ALTAR（CE 32 保留原字符串也由同一 TERRAIN_MAP 解析）、KEY_DOOR → iron_key、KEY_CAGE → cage_key、KEY_PORTAL → crystal_orb、SCROLL_ENCHANTING → scroll_of_enchantment、SCROLL_TELEPORT → scroll_of_teleportation、SCROLL_SHATTERING → scroll_of_shattering、POTION_LICHEN → potion_of_creeping_death，其余具名药水为 potion_of_*；MK_GOBLIN_CHIEFTAN → goblin_warlord、MK_GUARDIAN → stone_guardian、MK_WARDEN_OF_YENDOR → Warden_of_Yendor，其余实际怪物为去 MK_ 后小写。**MK_SENTINEL 没有消费端别名，不能按字符串规范化吞掉错误。**

### 2.1 重算任务书的 67 / 54

| 方法（当前 80 条，CE 侧按不同编号计数） | 实测 | 不能作为权威的原因 |
|---|---:|---|
| 严格 name 字符串相等，只问是否存在 | **58/71** | 11 个合法身份改过/缩短过名字；15/43 同名允许一条 Web 数据被计两次。匹配到的不同 name 只有 57 个。 |
| depthRange + roomSize + 原始 BP flags 集合相等，CE 常量取真实值 | **53/71** | 忽略 frequency/features，且漏掉 category 补旗标、范围投影、漏旗标的合法身份。 |
| 再加 frequency 的头行四元组全等 | **52/71** | CE 10 的频率 8≠12 被再排除，仍不是 feature 身份核验。 |
| 逐 feature 认定来源、逐项登记偏差 | **69/71** | 本报告/永久守卫采用此口径。 |

name 漏掉的 11 个合法编号为 **36、38、39、44、58–64**：36 只少句末句号；38/39/44 缩写了叙述；58–64 只保留主题短名。67 恰好等于“本轮实际覆盖 69 减去 9d 的 13/14”，与 78 条旧总数相容，但没有验收方原脚本，**不能断言它就是 67 的产生路径**；可以确定它不是当前文件的严格 name 匹配结果。

按真实常量的三字段匹配，除真缺的 8/48，还漏 **26、27、28、35、40、55、58–66、71** 共 16 个身份。前五条由 `category=key_guard` 补 BP_ADOPT_ITEM；55 缺 MAXIMIZE；后十条是 DEEPEST_LEVEL 投影。相反，三字段又无法区分 **1/2、6/7、9/10、16/20、67/68** 这五对原型。故“匹配数”不是一对一映射，也不是完成度。

常量还需纠正：CE `AMULET_LEVEL=26`，**`DEEPEST_LEVEL=40`**（GlobalsBrogue.c:43–44）。Web 有十条投影为 26/25，但 CE 67–70 仍保留 40。若粗脚本把所有 DEEPEST_LEVEL 一律换成 26，三字段结果变 **59/71**，同时误漏 67–70；本次没有一种明确的上述口径重现 54。任务书所称“差 13 条”不能直接解释为 13 个未实现 CE 原型。

## 3. 映射全表（按 Web 原顺序）

feature 数列为 **Web 数 / CE 声明 featureCt / CE 显式初始化数**。F 为从 0 开始的 feature 下标；“一致”表示在上述别名/缺省表示规范化后，本轮检查的头行及全部 feature 列一致，不宣称其引擎机制已完整。偏差代码见 §5。

| Web id | ceBlueprintId | CE 源行 | feature 数 | 核验结果或 null 理由 |
|---|---:|---|---|---|
| `reward_library` | null | — | 3/—/— | web 自创：最接近 CE 3 药水/卷轴宝库；本条是 3 个 feature 的卷轴加告示牌小房，depth/size/frequency/flags 均不同，无 CE 3 的地毯、替代奖励、菌林和雕像。 |
| `reward_consumables` | null | — | 3/—/— | web 自创：最接近 CE 3 药水/卷轴宝库；本条仅 3 个 feature，同时供应药水和卷轴，无 CE 的二选一、地毯、菌林和雕像，depth/size/frequency/flags 均不同。 |
| `reward_treasure_room` | 3 | 198–205 | 6/6/6 | 一致 |
| `reward_pedestal_permanent` | 4 | 206–213 | 6/6/6 | I |
| `reward_pedestal_consumable` | 5 | 214–220 | 5/5/5 | I |
| `reward_kennel` | 10 | 247–253 | 5/4/5 | C10、F10、I |
| `reward_commutation` | 6 | 221–226 | 4/4/4 | D |
| `reward_mixed_library` | 1 | 183–190 | 6/6/6 | I |
| `reward_single_category_library` | 2 | 191–197 | 5/5/5 | I |
| `reward_resurrection_altar` | 7 | 227–232 | 4/4/4 | D |
| `reward_statuary` | 15 | 289–294 | 4/4/4 | D |
| `vestibule_locked` | 16 | 298–300 | 1/1/1 | L、I |
| `vestibule_secret_door` | 17 | 301–303 | 1/1/1 | L |
| `vestibule_flammable_barricade` | 19 | 309–313 | 2/3/3 | A19 |
| `vestibule_statue_doorway` | 20 | 314–317 | 2/2/2 | 一致 |
| `vestibule_pit_trap_field` | 23 | 327–331 | 3/3/3 | 一致 |
| `vestibule_secret_lever` | 18 | 304–308 | 3/3/3 | 一致 |
| `vestibule_throwing_tutorial` | 22 | 322–326 | 3/3/3 | D |
| `vestibule_beckoning_obstacle` | 24 | 332–337 | 3/3/4 | C24 |
| `vestibule_guardian_obstacle` | 25 | 338–343 | 4/4/4 | 一致 |
| `vestibule_flammable` | null | — | 1/—/— | web 自创：最接近 CE 19 易燃路障前厅；本条只有 GRASS 6–12 格，无堵门木栅和外置点火物，depth/size/frequency/flags 均不同。 |
| `vestibule_guardian` | null | — | 1/—/— | web 自创：最接近 CE 25 守卫前厅；本条只有 _depth_appropriate_ 随机怪，无守卫二选一和符文，depth/size/frequency/flags 均不同。 |
| `vestibule_pit_traps` | null | — | 1/—/— | web 自创：最接近 CE 23 坑洞陷阱前厅；本条是 TRAP/fire 3–6 格，无门/密门二选一及 TRAP_DOOR_HIDDEN，depth/size/frequency/flags 均不同。 |
| `key_rat_trap` | null | — | 2/—/— | web 自创：最接近 CE 29 鼠陷阱；本条直接生成 3–6 只 rat 和本房钥匙，无领养祭坛、麻痹气口和休眠鼠墙，depth/size/frequency/flags 均不同。 |
| `key_fire_trap` | null | — | 2/—/— | web 自创：最接近 CE 32 火陷阱房；本条仅 GRASS 与 TRAP/fire，无领养祭坛、FLAMETHROWER_HIDDEN、大水池及水怪，depth/size/flags 不同。 |
| `key_flood_trap` | null | — | 2/—/— | web 自创：最接近 CE 31 涨水房；本条只直接铺浅水和深水，无可淹地板、开关祭坛、水池 DF 及水怪，depth/size/frequency/flags 均不同。 |
| `key_poison_gas` | 40 | 436–444 | 7/7/7 | B、E40 |
| `key_pit_trap` | 35 | 399–403 | 3/3/3 | B |
| `key_web_room` | null | — | 2/—/— | web 自创：最接近 CE 37 蛛网攀爬房；本条只铺 WEB 并生成 _spider_，无领养祭坛、深渊及隐藏桥 DF，depth/size/frequency/flags 均不同。 |
| `key_lava_moat` | null | — | 1/—/— | web 自创：最接近 CE 38 岩浆护城河房；本条只有 LAVA 8–20 格，无领养开关祭坛、回缩岩浆、逃生物品和拉杆，depth/size/frequency/flags 均不同。 |
| `key_boss` | null | — | 2/—/— | web 自创：最接近 CE 57 首领密室；本条生成 _depth_boss_ 加 _depth_appropriate_ 护卫，无领养携物 horde、骨堆 DF、密门及发光菌，depth/size/frequency/flags 均不同。 |
| `key_secret_room` | 27 | 356–359 | 2/2/2 | B、L、I |
| `key_nested_library` | 26 | 347–355 | 7/7/7 | B、I |
| `key_throwing_tutorial_cage` | 28 | 360–363 | 2/2/2 | B、D |
| `trap_paralysis_revealed` | 67 | 600–603 | 2/2/2 | 一致 |
| `trap_paralysis_hidden` | 68 | 604–607 | 2/2/2 | 一致 |
| `vestibule_statue_monster` | 21 | 318–321 | 2/2/2 | 一致 |
| `key_rat_trap_dormant` | 29 | 364–368 | 3/3/3 | 一致 |
| `key_explosive_trap` | 41 | 445–451 | 5/5/5 | 一致 |
| `key_statuary` | 43 | 460–463 | 2/2/2 | 一致 |
| `key_worm_trap` | 50 | 505–508 | 2/2/2 | 一致 |
| `key_turret_trap` | 56 | 545–548 | 2/2/2 | 一致 |
| `area_trick_statue` | 69 | 608–612 | 3/3/3 | 一致 |
| `area_worm` | 70 | 613–616 | 2/2/2 | 一致 |
| `reward_chained_allies` | 9 | 239–246 | 6/5/6 | C9 |
| `reward_vampire_lair` | 11 | 254–259 | 4/4/4 | I |
| `reward_legendary_ally` | 12 | 260–263 | 2/2/2 | I |
| `key_fun_with_fire` | 30 | 369–376 | 6/6/6 | 一致 |
| `key_thief_area` | 33 | 390–393 | 2/2/2 | 一致 |
| `key_burning_grass` | 42 | 452–459 | 6/6/6 | 一致 |
| `key_guardian_gauntlet` | 45 | 470–477 | 6/6/6 | 一致 |
| `key_guardian_corridor` | 46 | 478–486 | 7/7/7 | 一致 |
| `key_sacrifice_altar` | 47 | 487–494 | 6/6/6 | 一致 |
| `key_beckoning_obstacle` | 49 | 499–504 | 4/4/4 | 一致 |
| `key_zombie_crypt` | 53 | 521–530 | 8/8/8 | 一致 |
| `key_worm_tunnels` | 55 | 537–544 | 6/6/6 | B55 |
| `key_boss_secret_room` | 57 | 549–553 | 3/3/3 | 一致 |
| `ce_58_bloodwort` | 58 | 557–560 | 2/2/2 | Z |
| `ce_59_shrine` | 59 | 561–565 | 3/3/3 | Z |
| `ce_60_idyll` | 60 | 566–569 | 2/2/2 | Z |
| `ce_61_swamp` | 61 | 570–573 | 2/2/2 | Z |
| `ce_62_camp` | 62 | 574–579 | 4/4/4 | Z |
| `ce_63_remnant` | 63 | 580–583 | 2/2/2 | Z |
| `ce_64_dismal` | 64 | 584–588 | 3/3/3 | Z |
| `ce_71_sentinels` | 71 | 617–620 | 2/2/2 | Z、E71 |
| `ce_31_environment` | 31 | 377–382 | 4/4/4 | E31 |
| `ce_34_environment` | 34 | 394–398 | 3/3/3 | 一致 |
| `ce_36_environment` | 36 | 404–412 | 7/9/7 | C36 |
| `ce_37_environment` | 37 | 413–419 | 5/7/5 | C37 |
| `ce_38_environment` | 38 | 420–428 | 7/7/7 | 一致 |
| `ce_39_environment` | 39 | 429–435 | 5/5/5 | E39 |
| `ce_44_environment` | 44 | 464–469 | 4/4/4 | E44 |
| `ce_65_environment` | 65 | 589–594 | 4/4/4 | Z |
| `ce_66_environment` | 66 | 595–599 | 3/3/3 | Z |
| `key_fire_trap_room` | 32 | 383–389 | 5/5/5 | 一致 |
| `key_mud_pit` | 51 | 509–513 | 3/3/3 | 一致 |
| `key_electric_crystals` | 52 | 514–520 | 5/5/5 | 一致 |
| `key_haunted_house` | 54 | 531–536 | 4/4/4 | 一致 |
| `reward_goblin_warren` | 13 | 264–274 | 9/9/9 | 一致 |
| `reward_sentinel_sanctuary` | 14 | 275–286 | 10/10/10 | 一致 |

特别复核同名陷阱：CE 15 = `reward_statuary`，freq 0、size [35,40]、PURGE/OPEN，F0 护符开关、F2 Warden 休眠雕像，共 4 个 feature；CE 43 = `key_statuary`，freq 10、size [35,90]、ADOPT/NO_INTERIOR，F0 领养开关、F1 雕像 horde，共 2 个 feature。其余 category、DF、怪物及 flags 差异进一步排除了同名误认。

## 4. B 轮输入：全部 null 且 frequency > 0 的条目

以下 **11 条、frequency 合计 68**，未退池也未调整任何生成字段。frequency>0 只表示数据有权重，**不保证当前候选过滤实际允许被抽中**；B 轮仍需检查 category/领养过滤，不能用此表冒充活跃机器实测。

| id | freq | depth | size | 最接近 CE | 自创判据 |
|---|---:|---|---|---:|---|
| `reward_library` | 8 | [3,15] | [12,30] | 3 | web 自创：最接近 CE 3 药水/卷轴宝库；本条是 3 个 feature 的卷轴加告示牌小房，depth/size/frequency/flags 均不同，无 CE 3 的地毯、替代奖励、菌林和雕像。 |
| `reward_consumables` | 10 | [2,12] | [8,20] | 3 | web 自创：最接近 CE 3 药水/卷轴宝库；本条仅 3 个 feature，同时供应药水和卷轴，无 CE 的二选一、地毯、菌林和雕像，depth/size/frequency/flags 均不同。 |
| `vestibule_flammable` | 6 | [3,12] | [8,18] | 19 | web 自创：最接近 CE 19 易燃路障前厅；本条只有 GRASS 6–12 格，无堵门木栅和外置点火物，depth/size/frequency/flags 均不同。 |
| `vestibule_guardian` | 7 | [6,20] | [10,25] | 25 | web 自创：最接近 CE 25 守卫前厅；本条只有 _depth_appropriate_ 随机怪，无守卫二选一和符文，depth/size/frequency/flags 均不同。 |
| `vestibule_pit_traps` | 5 | [4,15] | [8,20] | 23 | web 自创：最接近 CE 23 坑洞陷阱前厅；本条是 TRAP/fire 3–6 格，无门/密门二选一及 TRAP_DOOR_HIDDEN，depth/size/frequency/flags 均不同。 |
| `key_rat_trap` | 8 | [2,8] | [8,18] | 29 | web 自创：最接近 CE 29 鼠陷阱；本条直接生成 3–6 只 rat 和本房钥匙，无领养祭坛、麻痹气口和休眠鼠墙，depth/size/frequency/flags 均不同。 |
| `key_fire_trap` | 6 | [5,15] | [10,25] | 32 | web 自创：最接近 CE 32 火陷阱房；本条仅 GRASS 与 TRAP/fire，无领养祭坛、FLAMETHROWER_HIDDEN、大水池及水怪，depth/size/flags 不同。 |
| `key_flood_trap` | 5 | [4,12] | [10,20] | 31 | web 自创：最接近 CE 31 涨水房；本条只直接铺浅水和深水，无可淹地板、开关祭坛、水池 DF 及水怪，depth/size/frequency/flags 均不同。 |
| `key_web_room` | 6 | [4,14] | [8,20] | 37 | web 自创：最接近 CE 37 蛛网攀爬房；本条只铺 WEB 并生成 _spider_，无领养祭坛、深渊及隐藏桥 DF，depth/size/frequency/flags 均不同。 |
| `key_lava_moat` | 4 | [8,20] | [12,30] | 38 | web 自创：最接近 CE 38 岩浆护城河房；本条只有 LAVA 8–20 格，无领养开关祭坛、回缩岩浆、逃生物品和拉杆，depth/size/frequency/flags 均不同。 |
| `key_boss` | 3 | [10,26] | [15,35] | 57 | web 自创：最接近 CE 57 首领密室；本条生成 _depth_boss_ 加 _depth_appropriate_ 护卫，无领养携物 horde、骨堆 DF、密门及发光菌，depth/size/frequency/flags 均不同。 |

## 5. 既存错误与留形偏差（本轮全部只登记）

### 5.1 新确认的错列/漏抄及应交 B 轮复核项

| 代码 | 位置 | Web → CE 真值 | 影响/证据 |
|---|---|---|---|
| E31 | CE 31/F1，:380 | personalSpace **3 → 5**；漏 `MF_NOT_IN_HALLWAY` | 改变祭坛落位与占位密度；9b 报告声称逐字，但当前这两列不等，未找到针对这两处的留形登记。 |
| E39 | CE 39/F0，:431 | personalSpace **3 → 2** | 岩浆区域祭坛间距错；不是 CE 38/F0（也为 2）的合理别名。 |
| E44 | CE 44/F3，:469 | personalSpace **1 → 2** | 符文 EVERYWHERE 的占位间距错。 |
| E40 | CE 40/F0–F4，:438–442 | 五条 personalSpace 全部 **1 → 2** | 祭坛、气口、逃生陷阱、传送卷轴、下降药水均错；F5/F6 的 1 正确，不能整条统一替换。 |
| E71 | CE 71/F0，:619 | monsterId **MK_SENTINEL → sentinel** | `monsters.json` 只有 sentinel，`Game.resolveBlueprintMonster` :1074 按 id 精确查找，无 MK_ 去前缀；当前会取不到怪物数据，不能以“机器建了/雕像铺了”证明哨兵实化。 |
| F10 | CE 10 头行，:248 | frequency **8 → 12** | 犬舍已改成 CE 10 结构但权重仍为 8；未找到将 12 故意改 8 的登记。保留本轮起始值。 |
| B55 | CE 55 头行，:538 | 漏 `BP_MAXIMIZE_INTERIOR` | 不是 category 推导旗标。9d 报告“旧表无 MAXIMIZE”仅描述 Web 现状；CE 55 原文已有这一位。补回会改变空间扩张，留 B 轮；55 当前仍被原过滤隔离。 |

这里的“新确认”指本轮从原列证明存在差异；未找到历史理由不等于能证明作者当时一定无意。报告不伪造溯源归因。

### 5.2 C 自身 featureCt 与初始化行数不等，必须按消费范围解释

CE `blueprint.feature[20]` 为固定数组，未初始化尾部补零（Rogue.h:2657–2666）；Architect.c:1294–1327 的替代分支扫描和建造循环都只走 `< featureCount`。

| 代码 | CE | 声明 / 显式 / Web | 结论 |
|---|---:|---|---|
| C9 | 9 | 5 / 6 / 6 | Web 多执行 CE 未消费的 F5 前厅 feature（:246）；前五条列值全等。不能把第六行看成 CE 活跃需求，也不能因差异否认 CE 9 来源。 |
| C10 | 10 | 4 / 5 / 5 | Web 多执行 CE 未消费的 F4 TORCH_WALL（:253）；这是数量消费差异，另有上面的频率和 itemFlags 差异。 |
| C24 | 24 | 3 / 4 / 3 | Web 恰好保留 CE 实际消费的 F0–F2；CE F3 glyph（:337）不被消费。**不应为了凑初始化行数而补入第四条。** |
| C36 | 36 | 9 / 7 / 7 | CE 的 F7/F8 为 C 隐式全零 feature，Web 未显式序列化；七条实写 feature 所有列一致。登记计数口径，勿称 Web 漏了两个有内容的 feature。 |
| C37 | 37 | 7 / 5 / 5 | 同上，CE F5/F6 隐式全零；五条实写 feature 所有列一致。 |

### 5.3 已登记或可解释的差异，以及仍未补回的列

- **A19**：CE 19 三个 feature，Web 只保留木栅和焚化药水；删除 F1 INCENDIARY_DART，Web F1 对应 CE F2，去掉药水 `MF_ALTERNATIVE`。这是 [2b 报告 §3](v-2b-2b.report.md) 的明确方案 2（当时飞镖点燃未接线）。核验时按实际分支对齐，没有把药水与被删飞镖硬比。
- **B**：CE 26/27/28/35/40 的 JSON 原始 flags 缺 BP_ADOPT_ITEM；`effectiveBpFlags` 由 `category=key_guard` 补齐，属于现有表示方式。四元组“原字段相等”仍计为不等，但不能判成自创。其余 BP flags 在报告列出的 B55 之外都通过集合核对。
- **Z**：CE 58–64/66/71 的 [1,40] 投影为 [1,26]；65 的 [1,39] 投影为 [1,25]。67–70 保留 40，不能把全表统一归一化成 26。65/66 的 frequency=0 **也是 CE 原值**，不是本轮擅自退池。
- **D**：遗漏 DF 五处：CE 6/F2 :225 `DF_MAGIC_PIPING`；7/F2 :231 `DF_MACHINE_FLOOR_TRIGGER_REPEATING`；15/F0 :291 `DF_LUMINESCENT_FUNGUS`；22/F0 :324 与 28/F1 :363 `DF_MEDIUM_HOLE`。4 轮报告 §3 登记前几条“FeatureDef 当时无 DF 列”，压力板也有早期留形；现在有 featureDF 载体，但这些原条目尚未回填。缺列不是“DF=0”的原文。补 DF 会消耗生成随机数，留 B 轮。
- **L**：CE 16/F0 :300、17/F0 :303、27/F0/F1 :358–359 缺显式 layer=DUNGEON。当前引擎对无 layer 走 `setTerrain`，显式 layer 走 `setTerrainLayer`；目标地形虽同，清其他层的语义不同，不能当成纯格式差异擅补。
- **I**：18 个 feature 的非零 CE itemFlags 列未保留，精确清单如下。早期报告登记过类型没有该列（1/2/4/5 等）；当前 FeatureDef 虽已有 `itemFlags`，这些旧数据仍缺列，且当前引擎无该字段消费。特定 key 绑定由既有 KEY/category/MF_* 管线负责，不能把它推断为全部 ITEM_* 行为等价。

| CE / feature | CE 行 | Web itemFlags | CE itemFlags（全部非零位） |
|---|---:|---|---|
| 1/F2 | 187 | 缺省 | ITEM_IS_KEY / ITEM_KIND_AUTO_ID / ITEM_PLAYER_AVOIDS |
| 1/F3 | 188 | 缺省 | ITEM_IS_KEY / ITEM_KIND_AUTO_ID / ITEM_PLAYER_AVOIDS |
| 1/F4 | 189 | 缺省 | ITEM_IS_KEY / ITEM_KIND_AUTO_ID / ITEM_MAX_CHARGES_KNOWN / ITEM_PLAYER_AVOIDS |
| 2/F2 | 195 | 缺省 | ITEM_IS_KEY / ITEM_KIND_AUTO_ID / ITEM_MAX_CHARGES_KNOWN / ITEM_PLAYER_AVOIDS |
| 2/F3 | 196 | 缺省 | ITEM_IS_KEY / ITEM_KIND_AUTO_ID / ITEM_MAX_CHARGES_KNOWN / ITEM_PLAYER_AVOIDS |
| 4/F2 | 210 | 缺省 | ITEM_IDENTIFIED |
| 4/F3 | 211 | 缺省 | ITEM_IDENTIFIED |
| 4/F4 | 212 | 缺省 | ITEM_KIND_AUTO_ID / ITEM_MAX_CHARGES_KNOWN |
| 5/F2 | 218 | 缺省 | ITEM_KIND_AUTO_ID |
| 5/F3 | 219 | 缺省 | ITEM_KIND_AUTO_ID |
| 10/F1 | 250 | 缺省 | ITEM_IS_KEY / ITEM_PLAYER_AVOIDS |
| 11/F2 | 258 | 缺省 | ITEM_IS_KEY / ITEM_PLAYER_AVOIDS |
| 12/F0 | 262 | 缺省 | ITEM_IS_KEY / ITEM_PLAYER_AVOIDS |
| 16/F0 | 300 | 缺省 | ITEM_IS_KEY / ITEM_PLAYER_AVOIDS |
| 26/F3 | 352 | 缺省 | ITEM_IS_KEY / ITEM_KIND_AUTO_ID / ITEM_PLAYER_AVOIDS |
| 26/F4 | 353 | 缺省 | ITEM_IS_KEY / ITEM_KIND_AUTO_ID / ITEM_MAX_CHARGES_KNOWN / ITEM_PLAYER_AVOIDS |
| 26/F5 | 354 | 缺省 | ITEM_IS_KEY / ITEM_MAX_CHARGES_KNOWN / ITEM_PLAYER_AVOIDS |
| 27/F0 | 358 | 缺省 | ITEM_PLAYER_AVOIDS |

已登记的底层载体别名仍保留：FUNGUS_FOREST→FOLIAGE；MACHINE_PRESSURE_PLATE→PRESSURE_PLATE；V-2b-8/9d 已登记的 HAY/JUNK/URINE 等 DF tile 替身。这些是 feature 所引用载体的既有语义债，不是本轮改写蓝图列。本轮范围是蓝图全列身份核验，没有扩大为全部地形/DF 目录和交互系统审计。

除上列差异、合法别名/缺省表示外，277 个对应 feature 的 **DF、terrain、layer、区间/最低数、物品类别/种类、怪物、间距、horde/item/feature flags** 均完成对比；尤其数量区间、最低数量、hordeFlags 没有额外未登记差异。当前头行四元组全等是 52 条，其余 17 条为五条 category 补位、CE 10 频率、CE 55 缺位、十条深度投影。

## 6. 永久守卫及翻红条件

新增 [blueprint_ce_coverage.test.ts](../../src/test/blueprint_ce_coverage.test.ts)，不读取 name 建立映射。

| 守卫 | 会翻红的实现/数据缺陷 |
|---|---|
| 显式 CE 集合全等 | 删除/错标已覆盖编号，或新增未经审计的编号；CE 8/48 的缺失理由直接写在清单旁。 |
| CE 所有者唯一 | 新增条目复用旧 CE 号，包括把两个 statuary 认领为同一号；null 不参与唯一性。 |
| null 必须带理由 | 自创条目缺 ceOrigin，或写空串/全空白/非字符串。 |
| 字段存在、值合法 | 新 Web 蓝图忘记 ceBlueprintId、写 undefined、0、72、小数或数字字符串；明确只允许 null 或 1–71 整数。 |
| 额外：80 个 Web id → CE id/null 全等 | 单纯集合和唯一性抓不到的“15↔43、52↔43 编号互换”、错误 null 归类、重复 Web id。用 tuple 数组比对，避免 Object.fromEntries 吞掉重复 id。 |

同文件 13 个内存反例用例调用同一断言函数，证明它们拒绝缺字段、五种非法值、重复认领、三种空理由、漏 CE 13、15/43 与 52/43 互换；不修改 JSON 做反向验证。加 5 个生产表正向用例，共 **18 例**。

9c 的 mud/haunted 消息绑定在原来的醒来状态断言上，darkness 消息绑定在原来的光强下降断言上；其他范围、可达性、库存和存活断言原样保留。三处无条件 stdout 已移除。

## 7. 零生成流自检与最终复跑

**这是最终状态下的运行结果，不是中途快照。**

全部数据/源码/测试编辑完成后，冻结 `src` 的 **180 个文件**，再执行以下最终命令。全部通过后仅补录本报告结果；没有跑无文件参数的全量 Vitest。

| 必跑命令 | 最终结果 |
|---|---|
| `npx vitest run src/test/blueprint_ce_coverage.test.ts` | PASS，18/18，0.112s |
| `npx vitest run src/test/v_2b_9c_effects.test.ts` | PASS，10/10，1.25s；三条原 stdout 未再打印，断言未削弱 |
| `npm run test:drift` | **PASS，1/1**，12.96s；4 seed × D1–D26 共 **104 层、416 个比较字段零差异** |
| `npm run build` | **PASS，exit 0**；vue-tsc 类型检查通过、Vite 打包通过；仅既有 >500kB chunk 提示 |

额外最终回归（同一条显式列出八个文件的 `npx vitest run`，`--maxWorkers=2`）：**8 文件、85/85 用例、0 失败/跳过，70.12s**。

| 文件（src/test） | 最终通过用例 | 文件耗时（秒） |
|---|---:|---:|
| `c_6_autogenerators.test.ts` | 17 | 5.005 |
| `invented_content_pool.test.ts` | 7 | 62.234 |
| `v_1a_blueprint_items.test.ts` | 8 | 24.331 |
| `v_1c_machine_structure.test.ts` | 12 | 10.483 |
| `v_2b_2b_blueprints.test.ts` | 24 | 25.209 |
| `v_2b_8_autogen.test.ts` | 2 | 8.072 |
| `v_2b_9b_environment.test.ts` | 4 | 0.008 |
| `v_2b_9d_dungeon_profile.test.ts` | 11 | 1.915 |

合计 **11 文件、114 用例全部通过**，另有 build 通过。覆盖/9c/drift 的实际命令均附 `--reporter=default --reporter=json --outputFile=/tmp/bp-final-<组名>.json`；drift 另附 `--maxWorkers=1`。八文件批次的精确文件列表就是上表。原始结果为 `/tmp/bp-final-{coverage,9c,drift,regression}.json`，日志为 `/tmp/bp-final-{drift,regression,build}.log`。

复跑前 `/tmp/bp-final-src-before.json`、复跑后 `/tmp/bp-final-src-after.json` 的文件集合、逐文件 SHA-256 及清单字节**完全相同**，两份清单 SHA-256 均为：

```
389958704fae279a7df4a5ca883c29b3c0a3dc31c29515d7e7721de21d3b0964
```

基线 `src/test/fixtures/generation_baseline.json` 在 **Git HEAD、任务开始、最终复跑前、最终复跑后** 的 SHA-256 均为：

```
5105c219395fc0bc4230b47f2dd5ff9e3e2945389e1a119f483af1fa9f159c0b
```

**确未重捕获、未写入基线。** 结构检查还逐条证明：新 JSON 保留旧 80 条的所有已有键及值（含全部生成字段和原有 23 个编号），新增键集合只可能为 `{ceBlueprintId, ceOrigin}`，CE 52 所有者仍唯一且正确。初始 src 清单与最终清单相比，只涉及本轮列出的两个既有文件和一个新测试；`git diff --exit-code` 确认引擎、类型、CE 源树及基线零改动，`git diff --check` 通过。


## 8. 改动范围申报

持久改动仅四个文件：

- `src/data/blueprints.json`：只新增 ceBlueprintId / ceOrigin；原有 80 条顺序、原有键值、features、频率、大小、深度和旗标全部不变。
- `src/test/blueprint_ce_coverage.test.ts`：任务 §2.2 指定新增守卫。
- `src/test/v_2b_9c_effects.test.ts`：仅任务 §3 的三个 stdout 改断言消息。
- 本报告：任务 §7 指定产物（不在 §4 的代码清单里，但报告本身已明确授权）。

**清单外持久改动：无。引擎、类型、BrogueCE-master、package/lock、generation_baseline.json 均未改。** 任务书中的 `src/types.ts` 实际不存在；BlueprintDef 在明确禁改的 `src/engine/Generator/BlueprintEngine.ts`，原声明仍是 `ceBlueprintId?: number`。本轮遵守禁改，守卫以本地 unknown 元数据类型校验 null/ceOrigin；生产侧旧类型未完整表达新元数据，列为后续类型债，不以另建无消费者类型文件掩盖。最终构建结果另列。

运行依赖从原工作区复制到本工作树的忽略目录 node_modules，未安装/更新依赖。审计解析脚本、全量列差异、初始/最终 SHA 清单和测试日志放在 `/tmp/bp-*`；它们不是仓库交付文件。首次沙箱内 npx 因 macOS `SecItemCopyMatching failed -50` 崩溃，正常权限后运行；开发阶段 build 发现测试用 Object.hasOwn 超出项目 lib 目标，已仅改为 hasOwnProperty.call。下面的最终结果不使用这些中途运行。
