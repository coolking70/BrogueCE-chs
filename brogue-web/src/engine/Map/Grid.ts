/**
 * src/engine/Map/Grid.ts
 * Grid and Cell structures reflecting Brogue's 2D map.
 *
 * C-4a-0：迁移 CE 的四层地形模型（结构迁移，行为逐位不变）。
 *
 * CE 事实来源（BrogueCE-master/src/brogue/，只读）：
 * - `Rogue.h:1293-1300` `enum dungeonLayers { NO_LAYER=-1, DUNGEON, LIQUID, GAS,
 *   SURFACE, NUMBER_TERRAIN_LAYERS }` —— 每格四层地形同时存在。
 * - `Movement.c:64-80` `highestPriorityLayer()` —— 遍历四层取 drawPriority
 *   最小者（数字越小优先级越高）；严格 `<` 使同优先级时层序在前者胜出；
 *   全空时返回层 0（DUNGEON 层，该层存 NOTHING，故对外的地形值是 NOTHING）。
 * - `Globals.c:315` `tileCatalog` 第 4 列 drawPriority。
 *
 * 本轮刻意保持"每格只有一层非 NOTHING"：setTerrain = 写归属层 + 清空其余
 * 三层，因此 `terrain` getter 与迁移前的覆盖式赋值逐位等价。
 * C-4a 再把"清空其余三层"换成"只清 CE 会清的"。
 */
import type { Pos } from '../../types';
import { DCOLS, DROWS } from '../../types';
export { DCOLS, DROWS };

export enum TerrainType {
    NOTHING = 0,
    GRANITE,
    FLOOR,
    WALL,
    DOOR,
    OPEN_DOOR,
    WATER_SHALLOW,
    WATER_DEEP,
    CHASM,
    LAVA,
    GRASS,
    FOLIAGE,
    BOG,
    STAIRS_UP,
    STAIRS_DOWN,
    CHARRED_FLOOR,
    SIGN,
    RESET_PLATE,
    TRAP,
    SECRET_DOOR,
    PRESSURE_PLATE,
    LOCKED_DOOR,
    ALTAR,
    WEB,
    BLOOD,
    MUD,
    // C-2 新增（CE Globals.c 目录对应物；只追加在尾部，既有枚举值不变——
    // terrainFingerprint 按数值哈希，中间插值会重排全部既有指纹）：
    CHASM_EDGE,      // CE Globals.c:417 深渊边缘，无旗标可走；随 CHASM 液体使用（本轮 CHASM 不生成）
    OBSIDIAN,        // CE Globals.c:427 黑曜石地面，无旗标可走；硫矿湖的镶边（createWreath）
    BRIDGE,          // CE Globals.c:428 绳桥，T_IS_FLAMMABLE 可走；buildABridge 落在 CHASM 上（本轮真实生成中为 0）
    BRIDGE_EDGE,     // CE Globals.c:430 桥端桩点，可走；buildABridge 落在两端岸格上
    INERT_BRIMSTONE, // CE Globals.c:426 惰性硫矿，T_SPONTANEOUSLY_IGNITES（液态湖体；点火链属 C-4）
    // F-1：CE Globals.c:492 PLAIN_FIRE（十种 T_IS_FIRE 地形中 web 唯一用得上的：
    // 点火链（exposeTileToFire/ignite/igniteForced）落出的火地形）。落 SURFACE
    // 层（CE 火 DF 全在 SURFACE）；drawPriority 10 压制草(60)/网(19)——CE 渲染
    // 口径：门(8)/墙(0)仍盖住火。promoteChance=500（5%/回合概率衰老 → EMBERS）
    // 由 F-2a 接通（TerrainCatalog 条目注释详述）。
    PLAIN_FIRE,
    // F-2a：CE Globals.c:469 EMBERS（余烬）与 :461 ASH（灰烬）——CE 火寿命链
    // PLAIN_FIRE →(promoteChance 500)→ EMBERS →(300)→ ASH 的中间/终点载体，
    // 两者都是 SURFACE 层纯装饰（零旗标：不点燃邻格、不可燃、可通行）。
    // 只追加在尾部（terrainFingerprint 按数值哈希，既有值不变）。
    EMBERS,
    ASH,
    // G-1：CE 气体 tile（Globals.c:502/503/508）——气体迁入 GAS 层后的载体。
    // CE 的气体就是 GAS 层地形：updateVolumetricMedia 搬运的是
    // layers[GAS] + pmap.volume（Rogue.h:1307，unsigned short 0-65535）。
    // 消散档位住在 tile 的 TM_GAS_DISSIPATES(_QUICKLY) 旗标里，可燃性
    // （POISON/CONFUSION 带 T_IS_FLAMMABLE，STEAM 不带）与 fireType
    // DF_GAS_FIRE 也照抄。只追加在尾部（既有枚举值不变）。
    POISON_GAS,
    CONFUSION_GAS,
    STEAM,
    // G-2：CE Globals.c:495 GAS_FIRE（燃气之火）与 :507 METHANE_GAS（沼气）。
    // GAS_FIRE 是十种 T_IS_FIRE 地形之一、落 SURFACE 层（G-1 §八.1 实测：
    // CE Globals.c:741 {GAS_FIRE, SURFACE, 0, 0}）——它是 DF_GAS_FIRE 的
    // 载体：可燃气体被点燃时 CE 把这块火地形铺到 SURFACE、同时 GAS 层体积
    // 清零（Time.c:1361-1368），promoteChance=8000（80%/回合自熄，promoteType=0
    // + VANISHES 即"消失"）。METHANE_GAS 是第六种气体 tile：可燃（ign 100）、
    // TM_EXPLOSIVE_PROMOTE（爆轰链载体）、无消散旗标（永不自散，CE 原样）；
    // 载体 = MUD 的 promoteType DF_METHANE_GAS_PUFF（promoteChance 100，
    // 1%/回合冒气，web MUD 自 C-4a 起携带该数据、此前因缺 tile 缓办）。
    // 只追加在尾部（既有枚举值不变）。
    GAS_FIRE,
    METHANE_GAS,
    // G-3：CE Globals.c:506 PARALYSIS_GAS（麻痹气体）——第七种气体 tile，
    // 全字段照抄（T_IS_FLAMMABLE | T_CAUSES_PARALYSIS、
    // TM_GAS_DISSIPATES_QUICKLY、ign 100、fireType DF_GAS_FIRE，条目见
    // TerrainCatalog）。web 载体 = potion_of_paralysis：CE 喝/扔麻痹药水
    // 都是原地爆出本气云（Items.c:6994/8118 → DF_PARALYSIS_GAS_CLOUD_POTION
    // {PARALYSIS_GAS, GAS, 1000}，Globals.c:778）。只追加在尾部（既有枚举
    // 值不变）。
    PARALYSIS_GAS,
    // F-2c：CE Globals.c:496 GAS_EXPLOSION（爆炸之火）——第八种火地形，
    // 落 SURFACE 层（CE DF 目录 :742 {GAS_EXPLOSION, SURFACE, 60, 17} 的
    // layer 列同证）。它是 DF_EXPLOSION_FIRE（甲烷爆轰圈）与
    // DF_BLOAT_EXPLOSION（bloat 自爆）的载体 tile：瞬时爆炸地形
    // （promoteChance 10000 = 每回合必定晋升，VANISHES_UPON_PROMOTION +
    // promoteType 0 ⇒ 下一晋升趟即消失），flags 带
    // T_CAUSES_EXPLOSIVE_DAMAGE（Rogue.h:1944：瞬时 max(15-20, maxHP/2)、
    // 免疫窗五回合——结算在 Game.resolveExplosionDamage，Time.c:343-353）。
    // 只追加在尾部（既有枚举值不变）。
    GAS_EXPLOSION,
    // C-5：CE Globals.c:442 HOLE 与 :444 HOLE_EDGE（"// surface layer" 注释
    // 块）——下坠药水/pit bloat 的死亡 DF（DF_HOLE_POTION → DF_HOLE_2）铺出
    // 的洞族地形：HOLE 带 T_AUTO_DESCENT（与 CHASM 同族的坠层判据位，
    // Time.c:110 monsterShouldFall 消费），HOLE_EDGE 零旗标（洞口的"半透明
    // 地面"）。两族 tile 的差异只在字形/优先级/镶边文案，玩法语义同 CHASM。
    // 只追加在尾部（既有枚举值不变）。
    HOLE,
    HOLE_EDGE,
    // B-3：三张卷轴（negation/sanctuary/shattering）的载体 tile。
    //   FORCEFIELD / FORCEFIELD_MELT（CE Globals.c:477/478）——crystalize
    //     打碎的墙先变 FORCEFIELD（Items.c:4916 直写 DUNGEON 层），再经
    //     负 promoteChance（-200/-10000，C-4c 扩散型晋升）逐步消融；
    //   CRYSTAL_WALL（CE Globals.c:338）——crystalize 的边界覆写
    //     （Items.c:4928-4929 "boundary walls turn to crystal"）；也是
    //     DF_CRYSTAL_WALL（Globals.c:607，C-6 自动生成器待激活缺口）的载体；
    //   SACRED_GLYPH（CE Globals.c:479）——SCROLL_SANCTUARY 的
    //     DF_SACRED_GLYPHS（Globals.c:676）落在 SURFACE 的圣徽，
    //     T_SACRED 消费点 = SafetyMap.isSacred（B-3 激活）。
    // 只追加在尾部（既有枚举值不变）。
    FORCEFIELD,
    FORCEFIELD_MELT,
    CRYSTAL_WALL,
    SACRED_GLYPH,
    // V-2b-2b：机器蓝图 3/4/5/19/20/23 号（CE GlobalsBrogue.c:198-220/309-331）
    // 的六个地形载体。FUNGUS_FOREST（CE Globals.c:475）不加新枚举——web
    // FOLIAGE 的 flags/mechFlags 与 CE FUNGUS_FOREST 完全一致
    // （T_OBSTRUCTS_VISION|T_IS_FLAMMABLE + STAND_IN_TILE|VANISHES|
    // PROMOTES_ON_STEP），蓝图数据以 TERRAIN_MAP 别名 FOLIAGE 承载。
    // 只追加在尾部（既有枚举值不变）。
    CARPET,             // CE Globals.c:325 可燃地毯（宝库铺装，DUNGEON 层）
    STATUE_INERT,       // CE Globals.c:351 惰性雕像（墙族，BUILD_IN_WALLS 落墙）
    PEDESTAL,           // CE Globals.c:369 石基座（基座大奖的落点）
    STATUE_INERT_DOORWAY, // CE Globals.c:550 门内碎裂雕像（20 号的堵门体）
    WOODEN_BARRICADE,   // CE Globals.c:341 干木栅（19 号的堵门体，可燃）
    TRAP_DOOR_HIDDEN,   // CE Globals.c:379 隐藏陷阱门（23 号，TM_IS_SECRET + T_AUTO_DESCENT）
    // V-2b-3：wired 触发网络的九个地形载体（18/22/24/25/67/68 号蓝图的机器
    // 通货，全部带 TM_IS_WIRED 或属其显隐两态）。只追加在尾部（既有枚举值
    // 不变——terrainFingerprint 按数值哈希）。CE 行号即目录行：
    MACHINE_GLYPH,              // Globals.c:404 机器符文（玩家踏入触发晋升）
    PORTCULLIS_CLOSED,          // Globals.c:339 落下的铁闸（闸门族堵门体）
    WORM_TUNNEL_OUTER_WALL,     // Globals.c:570 蠕虫隧道外墙（"爆炸墙"堵门体）
    WALL_LEVER_HIDDEN,          // Globals.c:347 隐藏墙杆（本 tile 无 WIRED——
                                // CE 显形后的 WALL_LEVER 才带线，web 无该 tile）
    GAS_TRAP_PARALYSIS,         // Globals.c:382 麻痹触发板（已揭示态）
    GAS_TRAP_PARALYSIS_HIDDEN,  // Globals.c:381 麻痹触发板（隐藏态）
    MACHINE_PARALYSIS_VENT_HIDDEN, // Globals.c:383 麻痹喷口（隐藏态）
    MACHINE_METHANE_VENT_HIDDEN,   // Globals.c:398 甲烷喷口（隐藏态）
    PILOT_LIGHT_DORMANT,        // Globals.c:342 休眠点火嘴（墙装火把）
    // V-2b-4：祭坛族轮——CE 七条蓝图（1/2/6/7/15/26/28 号）的七个地形载体。
    // 只追加在尾部（terrainFingerprint 按数值哈希，既有枚举值不变）。
    // FUNGUS_FOREST（CE Globals.c:475）不加新成员——V-2b-2b 已按
    // TERRAIN_MAP 别名到 FOLIAGE（flags/mechFlags 逐位一致），本轮复核结论
    // 见报告 §2。
    ALTAR_CAGE_OPEN,            // Globals.c:364 开底铁笼祭坛（1/2/26 号，取物后笼落）
    ALTAR_CAGE_RETRACTABLE,     // Globals.c:368 可收铁笼（28 号，踏板触发收回）
    COMMUTATION_ALTAR,          // Globals.c:532 置换祭坛（6 号）
    RESURRECTION_ALTAR,         // Globals.c:538 复活祭坛（7 号）
    AMULET_SWITCH,              // Globals.c:529 护符触发板（15 号，护符被拾取即晋升）
    STATUE_INSTACRACK,          // Globals.c:354 即刻开裂雕像（15 号，promoteType 震裂）
    TORCH_WALL,                 // Globals.c:337 墙装火把（15 号，进墙装饰）
    // V-2b-5：休眠唤醒 + horde 接线轮——CE 蓝图 21/29/41/43/50/56/69/70 号的
    // 七个休眠载体地形。只追加在尾部（terrainFingerprint 按数值哈希，既有
    // 枚举值不变）。七条全部照抄 CE Globals.c 第 4 列 drawPriority 与旗标列。
    ALTAR_SWITCH,               // Globals.c:366 祭坛触发板（29/43/50/56 号，
                                // 取物即晋升 DF_ALTAR_INERT + 全机通电）
    MACHINE_TRIGGER_FLOOR,      // Globals.c:361 机器触发地板（21/69/70 号，
                                // TM_PROMOTES_ON_PLAYER_ENTRY：玩家踏入即通电）
    STATUE_DORMANT,             // Globals.c:352 休眠雕像（43/69 号，晋升链
                                // DF_CRACKING_STATUE → STATUE_CRACKING → 震裂）
    WALL_MONSTER_DORMANT,       // Globals.c:357 藏怪墙（50/70 号，promoteType
                                // DF_WALL_SHATTER——与 18/22 号爆炸墙同一条链）
    RAT_TRAP_WALL_DORMANT,      // Globals.c:559 鼠陷阱墙（29 号，promoteType
                                // DF_WALL_CRACK → 链尾 DF_RUBBLE）
    STATUE_DORMANT_DOORWAY,     // Globals.c:551 门内休眠雕像（21 号，
                                // 比 STATUE_DORMANT 多 TM_CONNECTS_LEVEL）
    TURRET_DORMANT,             // Globals.c:356 休眠炮塔（56 号，promoteType
                                // DF_TURRET_EMERGE → tile WALL，web 有载体）
    // V-2b-6：钥匙轮的五个地形载体（10/35/40 号蓝图的通货）。只追加在尾部
    // （terrainFingerprint 按数值哈希，既有枚举值不变）。
    MONSTER_CAGE_OPEN,          // Globals.c:370 开盖铁笼（10 号 Kennel，
                                // DF_MONSTER_CAGE_OPENS 的落点 tile）
    MONSTER_CAGE_CLOSED,        // Globals.c:371 锁闭铁笼（10 号，TM_PROMOTES_
                                // WITH_KEY——钥匙认锁的第二个消费者）
    MACHINE_POISON_GAS_VENT_HIDDEN, // Globals.c:395 隐藏毒气喷口（40 号，
                                // TM_IS_SECRET|TM_IS_WIRED）
    PORTCULLIS_DORMANT,         // Globals.c:340 休眠铁闸（40 号，G_FLOOR 伪装，
                                // promoteType DF_ACTIVATE_PORTCULLIS）
    WALL_LEVER_HIDDEN_DORMANT,  // Globals.c:350 休眠墙杆（40 号，G_WALL 伪装，
                                // promoteType DF_CREATE_LEVER）
    BONES,                      // Globals.c:464 骨头堆（10 号 Kennel 的
                                // DF_BONES 载体，SURFACE 纯装饰）
    // ── V-2b-7：DF 特征系统轮的地形载体（13 条 CE 蓝图 9/11/12/30/33/42/
    //    45/46/47/49/53/55/57 的地形列 + 其 DF 链落点 tile）。19 个新成员，
    //    只追加在尾部（terrainFingerprint 按数值哈希，既有枚举值不变）。
    //    前 12 个是蓝图 feature 的 terrain 列；后 7 个是本轮 DF 目录新条目
    //    的 tile 列（CE 三条链字段/DF 落点强制）。
    COFFIN_CLOSED,              // Globals.c:372 密闭棺木（11 号，可燃、
                                // promoteType DF_COFFIN_BURSTS）
    ALTAR_KEYHOLE,              // Globals.c:363 带孔祭坛（12 号，
                                // TM_PROMOTES_WITH_KEY——钥匙认锁的第三个消费者）
    ALTAR_SWITCH_RETRACTING,    // Globals.c:367 可收祭坛（42 号，
                                // TM_PROMOTES_ON_ITEM_PICKUP）
    BRAZIER,                    // Globals.c:573 仪式火盆（53 号，T_IS_FIRE）
    DEMONIC_STATUE,             // Globals.c:547 恶魔雕像（47 号，墙族堵格体）
    FLAMETHROWER_HIDDEN,        // Globals.c:387 隐藏喷火口（30 号，T_IS_DF_TRAP）
    GAS_TRAP_POISON_HIDDEN,     // Globals.c:377 隐藏毒气板（30 号，T_IS_DF_TRAP）
    MANACLE_L,                  // Globals.c:486 左向镣铐（9 号，零旗标装饰）
    MANACLE_T,                  // Globals.c:484 上向镣铐（9 号，零旗标装饰）
    PORTAL,                     // Globals.c:355 石门（12 号，TM_IS_WIRED）
    SACRIFICE_ALTAR_DORMANT,    // Globals.c:543 休眠献祭祭坛（47 号，
                                // promoteType DF_SACRIFICE_ALTAR——欠账见报告 §3）
    SACRIFICE_CAGE_DORMANT,     // Globals.c:546 休眠献祭铁笼（47 号，堵格）
    // 以上 12 个是本轮蓝图的地形载体；以下 7 个由 DF 目录新条目的 tile
    // 列强制（DF 落点必须有 tile 载体，否则 spawnDungeonFeature 落不出地形）：
    DEAD_GRASS,                 // Globals.c:448 枯草（DF_SMALL_DEAD_GRASS 的
                                // tile；42 号 feature 5 的 EVERYWHERE 载体）
    VOMIT,                      // Globals.c:457 呕吐物（9 号 feature 1 的
                                // terrain 列 + DF_VOMIT 的 tile——同一格两用）
    LUMINESCENT_FUNGUS,         // Globals.c:450 发光菌（DF_LUMINESCENT_FUNGUS
                                // 的 tile；12/33/57 号 DF 列的落点）
    DEAD_FOLIAGE,               // Globals.c:473 枯叶（DF_DEAD_FOLIAGE 的 tile；
                                // promoteType DF_SMALL_DEAD_GRASS）
    RUBBLE,                     // Globals.c:465 碎石堆（DF_TUNNELIZE 的 tile；
                                // 55 号蠕虫隧道的挖掘落点）
    GRAY_FUNGUS,                // Globals.c:449 灰菌（DF_SWAMP 的 tile；
                                // subsequentDF DF_SWAMP_MUD）
    WORM_TUNNEL_MARKER_DORMANT, // Globals.c:568 休眠蠕虫隧道标记（DF_WORM_
                                // TUNNEL_MARKER_DORMANT 的 tile；CE displayChar
                                // 为 0 = 不可见标记，web 记空格）
    BLOODFLOWER_STALK,
    HAVEN_BEDROLL,
    // V-2b-9a：仅登记 9b 蓝图所需载体；均按 Globals.c 目录顺序追加。
    FLOOR_FLOODABLE, CHASM_WITH_HIDDEN_BRIDGE, LAVA_RETRACTABLE,
    MUD_FLOOR, MUD_WALL, MUD_DOORWAY, MARBLE_FLOOR, FLOOD_TRAP,
    ELECTRIC_CRYSTAL_OFF, TURRET_LEVER, HAUNTED_TORCH_DORMANT,
    DARK_FLOOR_DORMANT,
    // V-2b-9b：环境效果链的活动态/落点。它们不能继续以 null DF tile
    // 缓办，否则涨水、塌方、显桥与岩浆退缩都会在 promoteTile 入口停住。
    MACHINE_FLOOD_WATER_DORMANT, MACHINE_FLOOD_WATER_SPREADING,
    MACHINE_COLLAPSE_EDGE_DORMANT, MACHINE_COLLAPSE_EDGE_SPREADING,
    CHASM_WITH_HIDDEN_BRIDGE_ACTIVE, STONE_BRIDGE, LAVA_RETRACTING,
    FLOOD_WATER_SHALLOW, FLOOD_WATER_DEEP,
    MACHINE_CHASM_EDGE, PUDDLE,
    // V-2b-9c: complete mud / darkness / electricity promotion carriers.
    MACHINE_MUD_DORMANT, DARK_FLOOR_DARKENING, DARK_FLOOR, ECTOPLASM, HAUNTED_TORCH_TRANSITIONING, HAUNTED_TORCH, ELECTRIC_CRYSTAL_ON,
}

export enum LightType {
    NO_LIGHT = 0,
    LIT,
    DARK
}

/**
 * CE `Rogue.h:1293-1300` 的 `enum dungeonLayers` 逐值对应。
 * 顺序照 CE：GAS 在 SURFACE 之前（直觉顺序是错的，CE 就是这样）。
 * NO_LAYER = -1 属于查询失败哨兵，不是存储层，本轮不引入。
 */
export enum DungeonLayer {
    DUNGEON = 0, // 地基层（墙、地板、门等）
    LIQUID,      // 液体层（水、岩浆、深渊、桥面等）
    GAS,         // 气体层——web 的气体走独立 Gas.ts 网格，本层恒空（C-4a 前提）
    SURFACE,     // 表面层（草、网、血等）
    COUNT
}

/**
 * drawPriority 表——CE `Globals.c:315` tileCatalog 第 4 列（数字越小优先级越高）。
 *
 * 逐条出处（CE 目录名 → web 成员）：
 *   NOTHING=CE NOTHING 100；GRANITE 0；FLOOR 95；WALL 0；DOOR 8；OPEN_DOOR 25；
 *   WATER_SHALLOW=CE SHALLOW_WATER 55；WATER_DEEP=CE DEEP_WATER 40；CHASM 40；
 *   LAVA 40；GRASS 60；FOLIAGE 45；STAIRS_UP=CE UP_STAIRS 30；
 *   STAIRS_DOWN=CE DOWN_STAIRS 30；SECRET_DOOR 0；LOCKED_DOOR 15；
 *   ALTAR=CE ALTAR_INERT 17；WEB=CE SPIDERWEB 19；BLOOD=CE RED_BLOOD 80；
 *   MUD 55；CHASM_EDGE 80；OBSIDIAN 50；BRIDGE 45；BRIDGE_EDGE 45；
 *   INERT_BRIMSTONE 40。
 *
 * web 独有地形取最接近的 CE 对应物（依据见报告）：
 *   BOG=55（CE 无 BOG 条目；最接近的是 MUD——CE 的 MUD 用的正是 G_BOG 字形，
 *         语义同为沼泽泥泞液面， prio 55）；
 *   CHARRED_FLOOR=95（CE 无对应物；web 的焦土是 DUNGEON 层对 FLOOR 的替换
 *         而非表面覆盖物，须与 FLOOR 同档才保持"就是地面"的显示/语义）；
 *   SIGN=7（CE 无 sign；最接近的"地面上的人为标记"是 SACRED_GLYPH 7）；
 *   RESET_PLATE=15（对应物 MACHINE_PRESSURE_PLATE 15）；
 *   TRAP=30（CE 可见陷阱 GAS_TRAP_POISON/FLAMETHROWER 等均 30；隐藏态 95 不适用——
 *         web 的 TRAP 恒可见）；
 *   PRESSURE_PLATE=15（对应物 MACHINE_PRESSURE_PLATE 15）；
 *   PLAIN_FIRE=10（CE Globals.c:492 原值；F-1）。
 */
export const DRAW_PRIORITY: Record<TerrainType, number> = {
    [TerrainType.NOTHING]: 100,
    [TerrainType.GRANITE]: 0,
    [TerrainType.FLOOR]: 95,
    [TerrainType.WALL]: 0,
    [TerrainType.DOOR]: 8,
    [TerrainType.OPEN_DOOR]: 25,
    [TerrainType.WATER_SHALLOW]: 55,
    [TerrainType.WATER_DEEP]: 40,
    [TerrainType.CHASM]: 40,
    [TerrainType.LAVA]: 40,
    [TerrainType.GRASS]: 60,
    [TerrainType.FOLIAGE]: 45,
    [TerrainType.BOG]: 55,
    [TerrainType.STAIRS_UP]: 30,
    [TerrainType.STAIRS_DOWN]: 30,
    [TerrainType.CHARRED_FLOOR]: 95,
    [TerrainType.SIGN]: 7,
    [TerrainType.RESET_PLATE]: 15,
    [TerrainType.TRAP]: 30,
    [TerrainType.SECRET_DOOR]: 0,
    [TerrainType.PRESSURE_PLATE]: 15,
    [TerrainType.LOCKED_DOOR]: 15,
    [TerrainType.ALTAR]: 17,
    [TerrainType.WEB]: 19,
    [TerrainType.BLOOD]: 80,
    [TerrainType.MUD]: 55,
    [TerrainType.CHASM_EDGE]: 80,
    [TerrainType.OBSIDIAN]: 50,
    [TerrainType.BRIDGE]: 45,
    [TerrainType.BRIDGE_EDGE]: 45,
    [TerrainType.INERT_BRIMSTONE]: 40,
    [TerrainType.PLAIN_FIRE]: 10,
    // F-2a：CE EMBERS 70 / ASH 80（Globals.c:469/461 原值）。两者都是纯装饰
    // 表面层：余烬/灰烬压不住火（10）、草（60）、网（19），但会被血（80）同级
    // 竞争——CE fillSpawnMap 判据（Architect.c:3228）原样生效。
    [TerrainType.EMBERS]: 70,
    [TerrainType.ASH]: 80,
    // G-1：CE 气体 tile 的 drawPriority 全部为 35（Globals.c:502-508 第 4 列）。
    // 气体(35)盖得住地板(95)/草(60)，盖不住网(19)/门(8)——与 CE 渲染口径一致。
    [TerrainType.POISON_GAS]: 35,
    [TerrainType.CONFUSION_GAS]: 35,
    [TerrainType.STEAM]: 35,
    // G-2：GAS_FIRE 10（CE Globals.c:495 第 4 列，与 PLAIN_FIRE 同档——都是
    // 压得住草(60)/网(19)、压不住门(8)/墙(0)的火地形）；METHANE_GAS 35
    // （CE Globals.c:507 第 4 列，气体 tile 同为 35）。
    [TerrainType.GAS_FIRE]: 10,
    [TerrainType.METHANE_GAS]: 35,
    // G-3：PARALYSIS_GAS 35（CE Globals.c:506 第 4 列，气体 tile 同为 35）。
    [TerrainType.PARALYSIS_GAS]: 35,
    // F-2c：GAS_EXPLOSION 10（CE Globals.c:496 第 4 列，与 PLAIN_FIRE/GAS_FIRE
    // 同档的火地形——压得住草(60)/网(19)，压不住门(8)/墙(0)）。
    [TerrainType.GAS_EXPLOSION]: 10,
    // C-5：CE HOLE 9 / HOLE_EDGE 50（Globals.c:442/444 第 4 列）。HOLE 的 9
    // 与火同档（洞是"压得住草/网"的强地形）；HOLE_EDGE 50 与 OBSIDIAN 同档。
    [TerrainType.HOLE]: 9,
    [TerrainType.HOLE_EDGE]: 50,
    // B-3：FORCEFIELD 0 / FORCEFIELD_MELT 0 / CRYSTAL_WALL 0（CE Globals.c:
    // 477/478/338 第 4 列——三者都是墙档强地形）；SACRED_GLYPH 7（:479 第 4 列，
    // 与 web SIGN 借用的正是同一位）。
    [TerrainType.FORCEFIELD]: 0,
    [TerrainType.FORCEFIELD_MELT]: 0,
    [TerrainType.CRYSTAL_WALL]: 0,
    [TerrainType.SACRED_GLYPH]: 7,
    // V-2b-2b：CE 第 4 列原值。CARPET 85（Globals.c:325）；STATUE_INERT 0
    // （:351，墙档）；PEDESTAL 17（:369，与 ALTAR_INERT 同档）；STATUE_INERT_
    // DOORWAY 0（:550）；WOODEN_BARRICADE 8（:341，与 DOOR 同档）；TRAP_DOOR_
    // HIDDEN 95（:379，G_FLOOR 伪装——隐藏态就该看着像地板）。
    [TerrainType.CARPET]: 85,
    [TerrainType.STATUE_INERT]: 0,
    [TerrainType.PEDESTAL]: 17,
    [TerrainType.STATUE_INERT_DOORWAY]: 0,
    [TerrainType.WOODEN_BARRICADE]: 8,
    [TerrainType.TRAP_DOOR_HIDDEN]: 95,
    // V-2b-3：CE 第 4 列原值。MACHINE_GLYPH 42（Globals.c:404）；PORTCULLIS_
    // CLOSED 10（:339）；WORM_TUNNEL_OUTER_WALL 0（:570，墙档）；WALL_LEVER_
    // HIDDEN 0（:347，G_WALL 伪装）；GAS_TRAP_PARALYSIS 30（:382，可见陷阱档
    // ——与 web TRAP 的 30 同源）；GAS_TRAP_PARALYSIS_HIDDEN 95（:381，G_FLOOR
    // 伪装——隐藏态看着像地板）；MACHINE_PARALYSIS_VENT_HIDDEN 95（:383）、
    // MACHINE_METHANE_VENT_HIDDEN 95（:398）同上；PILOT_LIGHT_DORMANT 0
    //（:342，墙档火把）。
    [TerrainType.MACHINE_GLYPH]: 42,
    [TerrainType.PORTCULLIS_CLOSED]: 10,
    [TerrainType.WORM_TUNNEL_OUTER_WALL]: 0,
    [TerrainType.WALL_LEVER_HIDDEN]: 0,
    [TerrainType.GAS_TRAP_PARALYSIS]: 30,
    [TerrainType.GAS_TRAP_PARALYSIS_HIDDEN]: 95,
    [TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN]: 95,
    [TerrainType.MACHINE_METHANE_VENT_HIDDEN]: 95,
    [TerrainType.PILOT_LIGHT_DORMANT]: 0,
    // V-2b-4：CE 第 4 列原值。ALTAR_CAGE_OPEN 17（Globals.c:364，与 ALTAR_INERT
    // 同档）；ALTAR_CAGE_RETRACTABLE 17（:368）；COMMUTATION_ALTAR 17（:532）；
    // RESURRECTION_ALTAR 17（:538）；AMULET_SWITCH 95（:529，G_FLOOR 伪装——它
    // 在视觉上就该是地面）；STATUE_INSTACRACK 0（:354，雕像墙档）；
    // TORCH_WALL 0（:337，G_TORCH 墙档）。
    [TerrainType.ALTAR_CAGE_OPEN]: 17,
    [TerrainType.ALTAR_CAGE_RETRACTABLE]: 17,
    [TerrainType.COMMUTATION_ALTAR]: 17,
    [TerrainType.RESURRECTION_ALTAR]: 17,
    [TerrainType.AMULET_SWITCH]: 95,
    [TerrainType.STATUE_INSTACRACK]: 0,
    [TerrainType.TORCH_WALL]: 0,
    // V-2b-5：CE 第 4 列原值。ALTAR_SWITCH 17（Globals.c:366，与 ALTAR_INERT
    // 同档）；MACHINE_TRIGGER_FLOOR 95（:361，G_FLOOR 伪装——触发地板看着
    // 就是地面）；STATUE_DORMANT 0（:352 雕像墙档）；WALL_MONSTER_DORMANT 0
    // （:357 G_WALL 伪装）；RAT_TRAP_WALL_DORMANT 0（:559 G_WALL 伪装）；
    // STATUE_DORMANT_DOORWAY 0（:551 雕像墙档）；TURRET_DORMANT 0（:356
    // G_WALL 伪装）。六个 0 都是"墙档"——伪装体的存在感就在于看不出区别。
    [TerrainType.ALTAR_SWITCH]: 17,
    [TerrainType.MACHINE_TRIGGER_FLOOR]: 95,
    [TerrainType.STATUE_DORMANT]: 0,
    [TerrainType.WALL_MONSTER_DORMANT]: 0,
    [TerrainType.RAT_TRAP_WALL_DORMANT]: 0,
    [TerrainType.STATUE_DORMANT_DOORWAY]: 0,
    [TerrainType.TURRET_DORMANT]: 0,
    // V-2b-6：CE 第 4 列原值。MONSTER_CAGE_OPEN 17（Globals.c:370，与
    // ALTAR_INERT 同档）；MONSTER_CAGE_CLOSED 17（:371）；MACHINE_POISON_
    // GAS_VENT_HIDDEN 95（:395，G_FLOOR 伪装——隐藏态看着像地板）；
    // PORTCULLIS_DORMANT 95（:340，同 G_FLOOR 伪装口径）；WALL_LEVER_HIDDEN_
    // DORMANT 0（:350，G_WALL 伪装——墙档）。
    [TerrainType.MONSTER_CAGE_OPEN]: 17,
    [TerrainType.MONSTER_CAGE_CLOSED]: 17,
    [TerrainType.MACHINE_POISON_GAS_VENT_HIDDEN]: 95,
    [TerrainType.PORTCULLIS_DORMANT]: 95,
    [TerrainType.WALL_LEVER_HIDDEN_DORMANT]: 0,
    // V-2b-6：BONES 70（Globals.c:464 第 4 列原值——纯装饰表面物，与
    // DEAD_GRASS(75)/BLOOD(80) 同族的"压得住地板"档）。
    [TerrainType.BONES]: 70,
    // V-2b-7：CE 第 4 列原值，逐条 Globals.c 行号：
    //   COFFIN_CLOSED 17（:372，与祭坛族同档的"容器"层高）；
    //   ALTAR_KEYHOLE 17（:363）；ALTAR_SWITCH_RETRACTING 17（:367）；
    //   BRAZIER 0（:573，G_FIRE——火是"墙档"般的强地形，压得住一切）；
    //   DEMONIC_STATUE 0（:547 雕像墙档）；
    //   FLAMETHROWER_HIDDEN 95（:387 G_FLOOR 伪装）；GAS_TRAP_POISON_HIDDEN
    //     95（:377 同伪装）；MANACLE_L/MANACLE_T 20（:486/:484）；
    //   PORTAL 17（:355）；SACRIFICE_ALTAR_DORMANT 17（:543）；
    //   SACRIFICE_CAGE_DORMANT 17（:546）；
    //   DEAD_GRASS 60（:448，与 GRASS 同档）；VOMIT 80（:457，与 BLOOD 同档）；
    //   LUMINESCENT_FUNGUS 60（:450，与 GRASS 同档）；
    //   DEAD_FOLIAGE 45（:473，与 FOLIAGE 同档）；RUBBLE 70（:465，与 BONES
    //     同档）；GRAY_FUNGUS 51（:449）；WORM_TUNNEL_MARKER_DORMANT 100
    //     （:568，与 NOTHING 同档——不可见标记）。
    [TerrainType.COFFIN_CLOSED]: 17,
    [TerrainType.ALTAR_KEYHOLE]: 17,
    [TerrainType.ALTAR_SWITCH_RETRACTING]: 17,
    [TerrainType.BRAZIER]: 0,
    [TerrainType.DEMONIC_STATUE]: 0,
    [TerrainType.FLAMETHROWER_HIDDEN]: 95,
    [TerrainType.GAS_TRAP_POISON_HIDDEN]: 95,
    [TerrainType.MANACLE_L]: 20,
    [TerrainType.MANACLE_T]: 20,
    [TerrainType.PORTAL]: 17,
    [TerrainType.SACRIFICE_ALTAR_DORMANT]: 17,
    [TerrainType.SACRIFICE_CAGE_DORMANT]: 17,
    [TerrainType.DEAD_GRASS]: 60,
    [TerrainType.VOMIT]: 80,
    [TerrainType.LUMINESCENT_FUNGUS]: 60,
    [TerrainType.DEAD_FOLIAGE]: 45,
    [TerrainType.RUBBLE]: 70,
    [TerrainType.GRAY_FUNGUS]: 51,
    [TerrainType.WORM_TUNNEL_MARKER_DORMANT]: 100,
    [TerrainType.BLOODFLOWER_STALK]: 20,
    [TerrainType.HAVEN_BEDROLL]: 50,
    [TerrainType.FLOOR_FLOODABLE]: 95,
    [TerrainType.CHASM_WITH_HIDDEN_BRIDGE]: 40,
    [TerrainType.LAVA_RETRACTABLE]: 40,
    [TerrainType.MUD_FLOOR]: 85,
    [TerrainType.MUD_WALL]: 0,
    [TerrainType.MUD_DOORWAY]: 25,
    [TerrainType.MARBLE_FLOOR]: 85,
    [TerrainType.FLOOD_TRAP]: 58,
    [TerrainType.MACHINE_FLOOD_WATER_DORMANT]: 60,
    [TerrainType.MACHINE_FLOOD_WATER_SPREADING]: 60,
    [TerrainType.MACHINE_COLLAPSE_EDGE_DORMANT]: 95,
    [TerrainType.MACHINE_COLLAPSE_EDGE_SPREADING]: 45,
    [TerrainType.CHASM_WITH_HIDDEN_BRIDGE_ACTIVE]: 40,
    [TerrainType.STONE_BRIDGE]: 20,
    [TerrainType.LAVA_RETRACTING]: 40,
    [TerrainType.FLOOD_WATER_SHALLOW]: 50,
    [TerrainType.FLOOD_WATER_DEEP]: 41,
    [TerrainType.MACHINE_CHASM_EDGE]: 80,
    [TerrainType.PUDDLE]: 80,
    [TerrainType.ELECTRIC_CRYSTAL_OFF]: 0,
    [TerrainType.TURRET_LEVER]: 0,
    [TerrainType.HAUNTED_TORCH_DORMANT]: 0,
    [TerrainType.DARK_FLOOR_DORMANT]: 95,
    [TerrainType.MACHINE_MUD_DORMANT]: 55,
    [TerrainType.DARK_FLOOR_DARKENING]: 95,
    [TerrainType.DARK_FLOOR]: 95,
    [TerrainType.ECTOPLASM]: 70,
    [TerrainType.HAUNTED_TORCH_TRANSITIONING]: 0,
    [TerrainType.HAUNTED_TORCH]: 0,
    [TerrainType.ELECTRIC_CRYSTAL_ON]: 0,
};

/**
 * 归属层表——每种地形写入哪一层。
 *
 * CE 写入点依据（逐条）：
 * - DUNGEON 层：Architect.c:844/848（花岗岩）、2495（FLOOR，湖底铺垫）、
 *   2511（GRANITE 补洞）、2753（finishDoors：DOOR/FLOOR/SECRET_DOOR）、
 *   2903（门）；3721（DOWN_STAIRS）。陷阱类 DF 目录全为 DUNGEON
 *   （Globals.c:625-631）；MACHINE_PRESSURE_PLATE_USED DF 为 DUNGEON
 *   （Globals.c:815 附近）。
 * - LIQUID 层：fillLake Architect.c:2561 `layers[LIQUID] = liquid`
 *   （DEEP_WATER/CHASM/LAVA/INERT_BRIMSTONE 湖体）；createWreath
 *   Architect.c:2698 `layers[LIQUID] = shallowLiquid`（浅水镶边——注意
 *   CHASM_EDGE 与 OBSIDIAN 作为 lakeType 的 shallow 产物同样进 LIQUID）；
 *   绳桥 Architect.c:2831/2863 `layers[LIQUID] = BRIDGE`；MUD 由 DF 目录
 *   两条 `{MUD, LIQUID, ...}`（Globals.c:892/905）落入 LIQUID。
 * - SURFACE 层：GRASS/DEAD_GRASS/FOLIAGE DF 目录（Globals.c:610-614）；
 *   RED_BLOOD 等 DF（Globals.c:640 附近）；SPIDERWEB DF 两条
 *   （Globals.c:681-682 附近，均 SURFACE）；ASH DF（SURFACE）；
 *   BRIDGE_EDGE Architect.c:2833-2834/2865-2866 `layers[SURFACE]`。
 * - GAS 层：本轮恒空（web 气体走独立 Gas.ts 网格，不在层内）。
 *
 * 与任务书归属表的两处分歧（以 CE 为准，详见报告）：
 *   CHASM_EDGE → LIQUID（任务书写了 SURFACE；CE DF 目录
 *   `{CHASM_EDGE, LIQUID, 100, 100, 0}` + createWreath 写 LIQUID）；
 *   OBSIDIAN → LIQUID（同上：liquidType case 3 的 shallow=OBSIDIAN，
 *   createWreath 把 shallow 写进 LIQUID）。
 * web 自造地形的归属（CE 无对应写入点，按语义归类）：
 *   BOG → LIQUID（沼泽液面，同 MUD）；CHARRED_FLOOR/SIGN/RESET_PLATE →
 *   DUNGEON（对 FLOOR 的就地替换，与 FLOOR 同层）。
 *   PLAIN_FIRE → SURFACE（CE DF_PLAIN_FIRE {PLAIN_FIRE, SURFACE, 0, 0}，
 *   Globals.c:740；F-0 §3.2：十种火 DF 无一例外落 SURFACE——F-1）。
 */
export const TERRAIN_HOME_LAYER: Record<TerrainType, DungeonLayer> = {
    [TerrainType.NOTHING]: DungeonLayer.DUNGEON,
    [TerrainType.GRANITE]: DungeonLayer.DUNGEON,
    [TerrainType.FLOOR]: DungeonLayer.DUNGEON,
    [TerrainType.WALL]: DungeonLayer.DUNGEON,
    [TerrainType.DOOR]: DungeonLayer.DUNGEON,
    [TerrainType.OPEN_DOOR]: DungeonLayer.DUNGEON,
    [TerrainType.WATER_SHALLOW]: DungeonLayer.LIQUID,
    [TerrainType.WATER_DEEP]: DungeonLayer.LIQUID,
    [TerrainType.CHASM]: DungeonLayer.LIQUID,
    [TerrainType.LAVA]: DungeonLayer.LIQUID,
    [TerrainType.GRASS]: DungeonLayer.SURFACE,
    [TerrainType.FOLIAGE]: DungeonLayer.SURFACE,
    [TerrainType.BOG]: DungeonLayer.LIQUID,
    [TerrainType.STAIRS_UP]: DungeonLayer.DUNGEON,
    [TerrainType.STAIRS_DOWN]: DungeonLayer.DUNGEON,
    [TerrainType.CHARRED_FLOOR]: DungeonLayer.DUNGEON,
    [TerrainType.SIGN]: DungeonLayer.DUNGEON,
    [TerrainType.RESET_PLATE]: DungeonLayer.DUNGEON,
    [TerrainType.TRAP]: DungeonLayer.DUNGEON,
    [TerrainType.SECRET_DOOR]: DungeonLayer.DUNGEON,
    [TerrainType.PRESSURE_PLATE]: DungeonLayer.DUNGEON,
    [TerrainType.LOCKED_DOOR]: DungeonLayer.DUNGEON,
    [TerrainType.ALTAR]: DungeonLayer.DUNGEON,
    [TerrainType.WEB]: DungeonLayer.SURFACE,
    [TerrainType.BLOOD]: DungeonLayer.SURFACE,
    [TerrainType.MUD]: DungeonLayer.LIQUID,
    [TerrainType.CHASM_EDGE]: DungeonLayer.LIQUID,
    [TerrainType.OBSIDIAN]: DungeonLayer.LIQUID,
    [TerrainType.BRIDGE]: DungeonLayer.LIQUID,
    [TerrainType.BRIDGE_EDGE]: DungeonLayer.SURFACE,
    [TerrainType.INERT_BRIMSTONE]: DungeonLayer.LIQUID,
    [TerrainType.PLAIN_FIRE]: DungeonLayer.SURFACE,
    // F-2a：DF_EMBERS {EMBERS, SURFACE}（Globals.c:747）、
    // DF_ASH {ASH, SURFACE}（Globals.c:672，执行方逐字段复核）。
    [TerrainType.EMBERS]: DungeonLayer.SURFACE,
    [TerrainType.ASH]: DungeonLayer.SURFACE,
    // G-1：CE 气体 tile 归 GAS 层（Globals.c:502-508 全组在 "// gas layer"
    // 注释块下；DF 目录的气体条目 layer 列同为 GAS，如 DF_POISON_GAS_CLOUD
    // {POISON_GAS, GAS, …}）。
    [TerrainType.POISON_GAS]: DungeonLayer.GAS,
    [TerrainType.CONFUSION_GAS]: DungeonLayer.GAS,
    [TerrainType.STEAM]: DungeonLayer.GAS,
    // G-2：GAS_FIRE → SURFACE（CE Globals.c:741 {GAS_FIRE, SURFACE, 0, 0}，
    // DF 目录的 layer 列同证；G-1 §八.1 实测翻正——它是火地形不是气体）；
    // METHANE_GAS → GAS（CE Globals.c:507，"// gas layer" 注释块内）。
    [TerrainType.GAS_FIRE]: DungeonLayer.SURFACE,
    [TerrainType.METHANE_GAS]: DungeonLayer.GAS,
    // G-3：PARALYSIS_GAS → GAS（CE Globals.c:506，"// gas layer" 注释块内；
    // DF_PARALYSIS_GAS_CLOUD_POTION 的 layer 列同证，Globals.c:778）。
    [TerrainType.PARALYSIS_GAS]: DungeonLayer.GAS,
    // F-2c：GAS_EXPLOSION → SURFACE（CE DF 目录 :742 {GAS_EXPLOSION, SURFACE,
    // 60, 17} 与 :654 {GAS_EXPLOSION, SURFACE, 350, 100} 的 layer 列同证；
    // tile 本体在 Globals.c:496 "// fire tiles" 注释块——它是火地形不是气体）。
    [TerrainType.GAS_EXPLOSION]: DungeonLayer.SURFACE,
    // C-5：HOLE / HOLE_EDGE → SURFACE（CE DF 目录 :756 {HOLE, SURFACE, 200, 100}
    // 与 :782 {HOLE_EDGE, SURFACE, 300, 100, …} 的 layer 列同证；tile 本体在
    // Globals.c:442/444 的 "// surface layer" 注释块）。
    [TerrainType.HOLE]: DungeonLayer.SURFACE,
    [TerrainType.HOLE_EDGE]: DungeonLayer.SURFACE,
    // B-3：FORCEFIELD / FORCEFIELD_MELT / SACRED_GLYPH → SURFACE、
    // CRYSTAL_WALL → DUNGEON（CE DF 目录 layer 列同证：:674 {FORCEFIELD,
    // SURFACE}、:675 {FORCEFIELD_MELT, SURFACE}、:676 {SACRED_GLYPH, SURFACE}、
    // :607 {CRYSTAL_WALL, DUNGEON}）。注意 crystalize（Items.c:4916/4929）把
    // FORCEFIELD/CRYSTAL_WALL 直写 DUNGEON 层，不走 setTerrain 归属——
    // 那是调用点的 CE 字面行为，与本表（setTerrain 的归属）并行不悖。
    [TerrainType.FORCEFIELD]: DungeonLayer.SURFACE,
    [TerrainType.FORCEFIELD_MELT]: DungeonLayer.SURFACE,
    [TerrainType.CRYSTAL_WALL]: DungeonLayer.DUNGEON,
    [TerrainType.SACRED_GLYPH]: DungeonLayer.SURFACE,
    // V-2b-2b：六条机器蓝图的 feature layer 列即 CE 的落层依据
    //（GlobalsBrogue.c:201/209/216 等的 `terrain, layer` 两列全为 DUNGEON，
    // CARPET 另有 DF 目录 :709 {CARPET, DUNGEON, …} 同证）。
    [TerrainType.CARPET]: DungeonLayer.DUNGEON,
    [TerrainType.STATUE_INERT]: DungeonLayer.DUNGEON,
    [TerrainType.PEDESTAL]: DungeonLayer.DUNGEON,
    [TerrainType.STATUE_INERT_DOORWAY]: DungeonLayer.DUNGEON,
    [TerrainType.WOODEN_BARRICADE]: DungeonLayer.DUNGEON,
    [TerrainType.TRAP_DOOR_HIDDEN]: DungeonLayer.DUNGEON,
    // V-2b-3：九个 wired 载体全落 DUNGEON 层——CE 蓝图 feature 的 layer 列
    // 全为 DUNGEON（GlobalsBrogue.c:307/311/314 等逐行），且它们 DF 链的
    // 产物条目（DF_INACTIVE_GLYPH {MACHINE_GLYPH_INACTIVE, DUNGEON}、
    // DF_OPEN_PORTCULLIS {PORTCULLIS_DORMANT, DUNGEON}、DF_REVEAL_LEVER
    // {WALL_LEVER, DUNGEON}、DF_SHOW_PARALYSIS_GAS_TRAP {GAS_TRAP_PARALYSIS,
    // DUNGEON}、DF_DISCOVER_PARALYSIS_VENT {MACHINE_PARALYSIS_VENT, DUNGEON}
    // 等，Globals.c 逐条）layer 列同证。
    [TerrainType.MACHINE_GLYPH]: DungeonLayer.DUNGEON,
    [TerrainType.PORTCULLIS_CLOSED]: DungeonLayer.DUNGEON,
    [TerrainType.WORM_TUNNEL_OUTER_WALL]: DungeonLayer.DUNGEON,
    [TerrainType.WALL_LEVER_HIDDEN]: DungeonLayer.DUNGEON,
    [TerrainType.GAS_TRAP_PARALYSIS]: DungeonLayer.DUNGEON,
    [TerrainType.GAS_TRAP_PARALYSIS_HIDDEN]: DungeonLayer.DUNGEON,
    [TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN]: DungeonLayer.DUNGEON,
    [TerrainType.MACHINE_METHANE_VENT_HIDDEN]: DungeonLayer.DUNGEON,
    [TerrainType.PILOT_LIGHT_DORMANT]: DungeonLayer.DUNGEON,
    // V-2b-4：七条祭坛族地形全落 DUNGEON 层——CE 蓝图 feature 的 layer 列
    // 逐条为 DUNGEON（GlobalsBrogue.c:187-190/195-197/225/231/291-294/352-354/
    // 362），且三链字段指向的 DF 条目 layer 列同证
    //（DF_ITEM_CAGE_CLOSE {ALTAR_CAGE_CLOSED, DUNGEON} :722、
    //  DF_ALTAR_COMMUTE {COMMUTATION_ALTAR_INERT, DUNGEON} :793、
    //  DF_ALTAR_RESURRECT {RESURRECTION_ALTAR_INERT, DUNGEON} :798）。
    [TerrainType.ALTAR_CAGE_OPEN]: DungeonLayer.DUNGEON,
    [TerrainType.ALTAR_CAGE_RETRACTABLE]: DungeonLayer.DUNGEON,
    [TerrainType.COMMUTATION_ALTAR]: DungeonLayer.DUNGEON,
    [TerrainType.RESURRECTION_ALTAR]: DungeonLayer.DUNGEON,
    [TerrainType.AMULET_SWITCH]: DungeonLayer.DUNGEON,
    [TerrainType.STATUE_INSTACRACK]: DungeonLayer.DUNGEON,
    [TerrainType.TORCH_WALL]: DungeonLayer.DUNGEON,
    // V-2b-5：七条休眠载体全落 DUNGEON 层——CE 蓝图 feature 的 layer 列逐条
    // 为 DUNGEON（GlobalsBrogue.c:320-321/366-368/445-449/460-463/505-508/
    // 545-548/608-616），且三链字段指向的四个新 DF 条目
    // （DF_ALTAR_INERT {ALTAR_INERT, DUNGEON} :723、
    //  DF_WALL_CRACK {RAT_TRAP_WALL_CRACKING, DUNGEON} :818、
    //  DF_CRACKING_STATUE {STATUE_CRACKING, DUNGEON} :872、
    //  DF_TURRET_EMERGE {WALL, DUNGEON} :876）layer 列同证。
    [TerrainType.ALTAR_SWITCH]: DungeonLayer.DUNGEON,
    [TerrainType.MACHINE_TRIGGER_FLOOR]: DungeonLayer.DUNGEON,
    [TerrainType.STATUE_DORMANT]: DungeonLayer.DUNGEON,
    [TerrainType.WALL_MONSTER_DORMANT]: DungeonLayer.DUNGEON,
    [TerrainType.RAT_TRAP_WALL_DORMANT]: DungeonLayer.DUNGEON,
    [TerrainType.STATUE_DORMANT_DOORWAY]: DungeonLayer.DUNGEON,
    [TerrainType.TURRET_DORMANT]: DungeonLayer.DUNGEON,
    // V-2b-6：五条钥匙轮载体全落 DUNGEON 层——CE 蓝图 feature 的 layer 列
    // 逐条为 DUNGEON（GlobalsBrogue.c:250/251/300/340/350/371/395/436-441），
    // 且晋升 DF 条目（DF_MONSTER_CAGE_OPENS {MONSTER_CAGE_OPEN, DUNGEON}
    // :927、DF_CREATE_LEVER {WALL_LEVER_HIDDEN, DUNGEON} :734、
    // DF_ACTIVATE_PORTCULLIS {PORTCULLIS_CLOSED, DUNGEON} :853、
    // DF_SHOW_POISON_GAS_VENT {MACHINE_POISON_GAS_VENT_DORMANT, DUNGEON}
    // :851、DF_POISON_GAS_VENT_OPEN {MACHINE_POISON_GAS_VENT, DUNGEON} :852）
    // layer 列同证。
    [TerrainType.MONSTER_CAGE_OPEN]: DungeonLayer.DUNGEON,
    [TerrainType.MONSTER_CAGE_CLOSED]: DungeonLayer.DUNGEON,
    [TerrainType.MACHINE_POISON_GAS_VENT_HIDDEN]: DungeonLayer.DUNGEON,
    [TerrainType.PORTCULLIS_DORMANT]: DungeonLayer.DUNGEON,
    [TerrainType.WALL_LEVER_HIDDEN_DORMANT]: DungeonLayer.DUNGEON,
    // V-2b-6：BONES → SURFACE（CE DF 目录 :611 {BONES, SURFACE, 75, 23, 0}
    // 的 layer 列同证——骨头堆是表面覆盖物）。
    [TerrainType.BONES]: DungeonLayer.SURFACE,
    // V-2b-7：19 条新载体的归属层。依据逐条：
    //   DUNGEON —— CE 蓝图 feature 的 layer 列（GlobalsBrogue.c:82-92/197-206/
    //     218-223/280-286/298-303/306-312/315-322/327-334/349-357 的 `terrain,
    //     layer` 两列）：COFFIN_CLOSED（11 号列 0 = DUNGEON）、ALTAR_KEYHOLE /
    //     PORTAL（12 号 DUNGEON）、ALTAR_SWITCH_RETRACTING（42 号 DUNGEON）、
    //     BRAZIER（53 号 DUNGEON）、DEMONIC_STATUE / SACRIFICE_ALTAR_DORMANT /
    //     SACRIFICE_CAGE_DORMANT（47 号 DUNGEON）、FLAMETHROWER_HIDDEN /
    //     GAS_TRAP_POISON_HIDDEN（30 号 DUNGEON）。
    [TerrainType.COFFIN_CLOSED]: DungeonLayer.DUNGEON,
    [TerrainType.ALTAR_KEYHOLE]: DungeonLayer.DUNGEON,
    [TerrainType.ALTAR_SWITCH_RETRACTING]: DungeonLayer.DUNGEON,
    [TerrainType.BRAZIER]: DungeonLayer.DUNGEON,
    [TerrainType.DEMONIC_STATUE]: DungeonLayer.DUNGEON,
    [TerrainType.FLAMETHROWER_HIDDEN]: DungeonLayer.DUNGEON,
    [TerrainType.GAS_TRAP_POISON_HIDDEN]: DungeonLayer.DUNGEON,
    [TerrainType.PORTAL]: DungeonLayer.DUNGEON,
    [TerrainType.SACRIFICE_ALTAR_DORMANT]: DungeonLayer.DUNGEON,
    [TerrainType.SACRIFICE_CAGE_DORMANT]: DungeonLayer.DUNGEON,
    //   SURFACE —— 9 号蓝图把两条镣铐与呕吐物写在 SURFACE 列
    //     （GlobalsBrogue.c:69-74 `{DF_AMBIENT_BLOOD, MANACLE_T, SURFACE, …}`
    //     / `{0, VOMIT, SURFACE, …}`），五条 DF 落点同证
    //     （DF_SMALL_DEAD_GRASS {DEAD_GRASS, SURFACE, 75, 75} :689、
    //      DF_DEAD_FOLIAGE {DEAD_FOLIAGE, SURFACE, 50, 30} :615、
    //      DF_TUNNELIZE {RUBBLE, SURFACE, 45, 23} :678、
    //      DF_SWAMP {GRAY_FUNGUS, SURFACE, 80, 50} :904、
    //      DF_LUMINESCENT_FUNGUS {LUMINESCENT_FUNGUS, SURFACE, 60, 8} :608）。
    [TerrainType.MANACLE_L]: DungeonLayer.SURFACE,
    [TerrainType.MANACLE_T]: DungeonLayer.SURFACE,
    [TerrainType.VOMIT]: DungeonLayer.SURFACE,
    [TerrainType.LUMINESCENT_FUNGUS]: DungeonLayer.SURFACE,
    [TerrainType.DEAD_FOLIAGE]: DungeonLayer.SURFACE,
    [TerrainType.RUBBLE]: DungeonLayer.SURFACE,
    [TerrainType.GRAY_FUNGUS]: DungeonLayer.SURFACE,
    [TerrainType.DEAD_GRASS]: DungeonLayer.SURFACE,
    //   LIQUID —— CE DF 目录 :879 `{WORM_TUNNEL_MARKER_DORMANT, LIQUID, 5, 5,
    //     0, "", 0, 0, GRANITE}` 的 layer 列同证（55 号蠕虫隧道标记）。
    [TerrainType.WORM_TUNNEL_MARKER_DORMANT]: DungeonLayer.LIQUID,
    [TerrainType.BLOODFLOWER_STALK]: DungeonLayer.SURFACE,
    [TerrainType.HAVEN_BEDROLL]: DungeonLayer.SURFACE,
    [TerrainType.FLOOR_FLOODABLE]: DungeonLayer.DUNGEON,
    [TerrainType.CHASM_WITH_HIDDEN_BRIDGE]: DungeonLayer.LIQUID,
    [TerrainType.LAVA_RETRACTABLE]: DungeonLayer.LIQUID,
    [TerrainType.MUD_FLOOR]: DungeonLayer.DUNGEON,
    [TerrainType.MUD_WALL]: DungeonLayer.DUNGEON,
    [TerrainType.MUD_DOORWAY]: DungeonLayer.DUNGEON,
    [TerrainType.MARBLE_FLOOR]: DungeonLayer.DUNGEON,
    [TerrainType.FLOOD_TRAP]: DungeonLayer.DUNGEON,
    [TerrainType.MACHINE_FLOOD_WATER_DORMANT]: DungeonLayer.LIQUID,
    [TerrainType.MACHINE_FLOOD_WATER_SPREADING]: DungeonLayer.LIQUID,
    [TerrainType.MACHINE_COLLAPSE_EDGE_DORMANT]: DungeonLayer.LIQUID,
    [TerrainType.MACHINE_COLLAPSE_EDGE_SPREADING]: DungeonLayer.LIQUID,
    [TerrainType.CHASM_WITH_HIDDEN_BRIDGE_ACTIVE]: DungeonLayer.LIQUID,
    [TerrainType.STONE_BRIDGE]: DungeonLayer.LIQUID,
    [TerrainType.LAVA_RETRACTING]: DungeonLayer.LIQUID,
    [TerrainType.FLOOD_WATER_SHALLOW]: DungeonLayer.SURFACE,
    [TerrainType.FLOOD_WATER_DEEP]: DungeonLayer.SURFACE,
    [TerrainType.MACHINE_CHASM_EDGE]: DungeonLayer.LIQUID,
    [TerrainType.PUDDLE]: DungeonLayer.SURFACE,
    [TerrainType.ELECTRIC_CRYSTAL_OFF]: DungeonLayer.DUNGEON,
    [TerrainType.TURRET_LEVER]: DungeonLayer.DUNGEON,
    [TerrainType.HAUNTED_TORCH_DORMANT]: DungeonLayer.DUNGEON,
    [TerrainType.DARK_FLOOR_DORMANT]: DungeonLayer.DUNGEON,
    [TerrainType.MACHINE_MUD_DORMANT]: DungeonLayer.LIQUID,
    [TerrainType.DARK_FLOOR_DARKENING]: DungeonLayer.DUNGEON,
    [TerrainType.DARK_FLOOR]: DungeonLayer.DUNGEON,
    [TerrainType.ECTOPLASM]: DungeonLayer.SURFACE,
    [TerrainType.HAUNTED_TORCH_TRANSITIONING]: DungeonLayer.DUNGEON,
    [TerrainType.HAUNTED_TORCH]: DungeonLayer.DUNGEON,
    [TerrainType.ELECTRIC_CRYSTAL_ON]: DungeonLayer.DUNGEON,
};

/**
 * T_IS_FIRE 旗标载体集合（CE Globals.c 目录里带 T_IS_FIRE 的 tile 的 web 投影）。
 *
 * 用途：Cell.isBurning 派生 getter 的判据集。放在本文件（而非从 TerrainCatalog
 * 引入）是因为依赖方向只能是 TerrainCatalog → Grid（属性表按枚举键控），
 * 反向 import 会成环——数据因此在此登记一份，由 c_4a_terrain_catalog 的
 * 恒等断言与 TERRAIN_FLAGS 的旗标载体集合双向锁死（漏登记/多登记都翻红，
 * 失败信息指向本注释）。
 *
 * 现有载体（CE 行号）：PLAIN_FIRE（Globals.c:492，F-1 引入）、
 * GAS_FIRE（Globals.c:495，G-2 引入——DF_GAS_FIRE 的载体，燃气烧完地上留火）、
 * GAS_EXPLOSION（Globals.c:496，F-2c 引入——DF_EXPLOSION_FIRE/DF_BLOAT_EXPLOSION
 * 的载体，瞬时爆炸地形，T_CAUSES_EXPLOSIVE_DAMAGE 在手）、
 * BRAZIER（Globals.c:573，V-2b-7 引入——53 号 Zombie crypt 的仪式火盆，
 * 唯一带 T_OBSTRUCTS_PASSABILITY 的火地形：它是"烧着的堵格体"）。
 * CE 其余五种火地形（BRIMSTONE_FIRE /
 * FLAMEDANCER_FIRE / DART_EXPLOSION / ITEM_FIRE / CREATURE_FIRE）
 * web 尚无——后续轮次落地时随目录条目在此补行。
 */
export const FIRE_TERRAIN_TYPES: readonly TerrainType[] = [
    TerrainType.PLAIN_FIRE,
    TerrainType.GAS_FIRE,
    TerrainType.GAS_EXPLOSION,
    TerrainType.BRAZIER
];

/** CE Movement.c:64-80 的纯数据版：对一层快照取最高优先层。 */
export function highestPriorityLayerOf(layers: readonly TerrainType[], skipGas: boolean = false): DungeonLayer {
    let bestPriority = 10000;
    let best = DungeonLayer.DUNGEON;
    for (let tt = 0; tt < DungeonLayer.COUNT; tt++) {
        if (tt === DungeonLayer.GAS && skipGas) {
            continue;
        }
        const t = layers[tt]!;
        // 注意 `layers[tt] &&`：CE 以"非零"判层非空，NOTHING=0 恰为空层哨兵
        if (t !== TerrainType.NOTHING && DRAW_PRIORITY[t] < bestPriority) {
            bestPriority = DRAW_PRIORITY[t];
            best = tt as DungeonLayer;
        }
    }
    return best;
}

/**
 * 跨层清除的干跑计数（仅测试消费，生产代码零读取点）。
 *
 * setTerrain 每次清掉"其他层里非 NOTHING 的内容"时记一笔
 * (被清的层, 被清的地形, 新写入的地形)。本轮"每格只有一层非空"，
 * 这些事件就是 C-4a 放开清空后会出现分歧的位置与规模的实测来源。
 */
export interface CrossLayerClearStat {
    layer: DungeonLayer;
    from: TerrainType;
    to: TerrainType;
    count: number;
}

const crossLayerClearCounts = new Map<string, number>();

function recordCrossLayerClear(layer: DungeonLayer, from: TerrainType, to: TerrainType): void {
    const key = `${layer}:${from}:${to}`;
    crossLayerClearCounts.set(key, (crossLayerClearCounts.get(key) ?? 0) + 1);
}

/** 聚合视图（测试与测量报告用）；生产代码不得调用。 */
export function getCrossLayerClearStats(): CrossLayerClearStat[] {
    const out: CrossLayerClearStat[] = [];
    for (const [key, count] of crossLayerClearCounts) {
        const [layer, from, to] = key.split(':').map(Number) as [DungeonLayer, TerrainType, TerrainType];
        out.push({ layer, from, to, count });
    }
    return out.sort((a, b) =>
        a.layer - b.layer || a.from - b.from || a.to - b.to
    );
}

/** 清零计数（测试隔离用）。 */
export function resetCrossLayerClearStats(): void {
    crossLayerClearCounts.clear();
}

/** 把 t 写进它的归属层并清空其余三层（不动 char/color/启发式）。 */
function writeTerrainHome(cell: Cell, t: TerrainType): void {
    const home = TERRAIN_HOME_LAYER[t];
    for (let l = 0; l < DungeonLayer.COUNT; l++) {
        cell.layers[l] = l === home ? t : TerrainType.NOTHING;
    }
}

/**
 * Represents a single tile on the map.
 */
export class Cell {
    public x: number;
    public y: number;

    // C-4a-0：四层地形（CE Rogue.h pmap.cells 的 layers[NUMBER_TERRAIN_LAYERS]）。
    // 不变量（本轮）：至多一层非 NOTHING；terrain 的读写都经由下方访问器。
    public layers: TerrainType[] = [
        TerrainType.NOTHING,
        TerrainType.NOTHING,
        TerrainType.NOTHING,
        TerrainType.NOTHING
    ];

    public char: string = ' ';
    public color: number = 0x000000;

    /**
     * G-1：CE pmap 的 volume 字段（Rogue.h:1307 `unsigned short volume`，
     * 0-65535）——GAS 层的体积量纲。CE 的"气有多少"住在 volume，"是什么气"
     * 住在 layers[GAS]；updateVolumetricMedia（Time.c:1383-1479）搬运的就是
     * 这一对。写入口：Gas.addGas / DungeonFeature 的 GAS 分支（Architect.c:3384
     * `volume += startProbability`）；promoteTile 的 vanish 在 GAS 层连 volume
     * 一起清（Time.c:1262-1264）。
     * 注：CE 是 uint16 回绕语义，web 用普通 number + 写入口 65535 钳制
     * （回绕只在单格 ≥4 支 dewar 叠加时才可能触到，钳制偏离已登记报告）。
     */
    public volume: number = 0;

    /**
     * 有效地形 = 最高优先层的地形（CE Movement.c:64 highestPriorityLayer 语义：
     * drawPriority 最小者；同优先级先遇到的层胜；全空返回 NOTHING）。
     *
     * G-1 起固定 skipGas=true（跳过 GAS 层）。依据（CE 调用面逐点复核）：
     * CE 里"含气体的 effectively terrain"只服务显示/风味/记忆
     * （tileFlavor/tileText Movement.c:106/113、storeMemories Movement.c:2569、
     * 药瓶 "into" 文案 Items.c:7030）与 respiration 判定（Time.c:69）；
     * 玩法逻辑（通行/寻路/伤害/AI）全部走 cellHasTerrainFlag 的四层旗标并集，
     * 从不消费含气的 effective terrain。web 的 .terrain 读者（寻路/安全图/
     * 生成器/落位）对应的正是 CE 的旗标并集世界——若让气体(prio 35)参与
     * getter 竞争，"毒气盖着的岩浆"会被当成毒气放行。web 渲染与悬浮提示
     * 不经本 getter 取气（渲染走 gasGrid 覆盖层；hover 在 Game 侧单独优先
     * GAS 层，对齐 CE tileText 语义）。
     */
    get terrain(): TerrainType {
        return this.layers[highestPriorityLayerOf(this.layers, true)]!;
    }

    set terrain(t: TerrainType) {
        writeTerrainHome(this, t);
    }

    // Flags for state
    public isExplored: boolean = false;
    public isVisible: boolean = false;
    public hasMemory: boolean = false; // Does the player remember this tile

    // Light
    public light: LightType = LightType.NO_LIGHT;

    // Movement & Sight blocking
    public isPassable: boolean = false;
    public isOpaque: boolean = false;

    // Environmental states
    /**
     * F-2a：CE pmap.exposedToFire（Time.c:1308/1317-1319）——本回合内该格
     * 已被 exposeTileToFire 尝试点燃的次数；≥12 时拒绝再暴露（每格每回合
     * 12 次封顶）。每回合火段开始时清零（Time.c:1598-1603）。
     * 不设为 getter：它就是 CE 的可变格状态，由 Promotion.runFireUpdate 独占读写。
     */
    public exposedToFire: number = 0;

    /**
     * 燃烧判据：本格跨层挂着 T_IS_FIRE 地形（CE 语义：cellHasTerrainFlag
     * (T_IS_FIRE) 的四层并集，Globals.c:581-597）。F-2a 起为纯派生 getter——
     * 火地形经 CE 的 DF 生成管线（按优先级落层的填充步 + 晋升原语）落地与
     * 衰老，不再存在"另一个事实来源"，镜像脱钩一类 bug 从结构上消失。
     *
     * 载体集合见 FIRE_TERRAIN_TYPES（本文件尾部）：c_4a 的恒等断言把
     * "该集合"与"TERRAIN_FLAGS 里带 T_IS_FIRE 旗标的地形集合"双向锁死，
     * 新火地形落地时漏改会当场翻红。
     */
    get isBurning(): boolean {
        for (const t of FIRE_TERRAIN_TYPES) {
            if (this.layers.includes(t)) return true;
        }
        return false;
    }

    // Trap metadata (for TRAP and PRESSURE_PLATE terrain)
    public trapType: 'poison_gas' | 'teleport' | 'fire' | null = null;
    // Whether a SECRET_DOOR has been discovered
    public isDiscovered: boolean = false;

    // P1-42：CE SEARCHED_FROM_HERE（Rogue.h:1090）——玩家站在本格时已做过
    // 一次低强度自动搜索；同一格不重复触发（CE Time.c:2544-2549 的
    // "only once per tile"）。CE 是 pmap flags 位、随层新建，web 是 Cell
    // 字段、随 Grid 新建，生命周期一致。仅由 Game 的自动搜索读写。
    public autoSearched: boolean = false;

    // Machine zone tracking (0 = no machine)
    public machineNumber: number = 0;

    /**
     * V-2b-3：CE pmap.flags 的 IS_POWERED 位（Rogue.h:1113 一带，消费点
     * Time.c:1186-1191/:1271-1286）——wired 机器激活期的瞬时"通电"标记。
     * 生命周期极短：promoteTile 的 wired 分支给本格置位 → activateMachine
     * 沿机器置位/逐层晋升 → 返回后**全图清零**（CE :1280-1285"Power fades
     * from the map immediately after we finish"）。它同时是 activateMachine
     * ⇄ promoteTile 相互递归的防无限闸（先置位再递归，CE :1277）。
     * 仅由 Promotion 的 wired 分支读写。
     */
    public isPowered: boolean = false;

    /**
     * V-2b-5：CE `pmap.flags & HAS_DORMANT_MONSTER`（Rogue.h:1105 一族的 pmap
     * 位旗标；读写点 Monsters.c:4165/4206 的 toggleMonsterDormancy 两个方向）。
     *
     * 语义：**休眠怪不占格**——CE 把休眠怪从 `monsters` 链表摘到
     * `dormantMonsters`，并清 HAS_MONSTER 改置本旗标；因此 HAS_MONSTER 的读取
     * 者（`monsterAtLoc`、寻路占用、落位资格）天然看不见它。
     *
     * web 的 HAS_MONSTER 等价物是 `Game.getMonsterAt`（按 this.monsters 现场
     * 查找），故本旗标在 web **不承担判据职责**，只作为"该格有休眠怪"的
     * 可查询事实保留（CE 的 pmap 位就是这么用的：连"是否有休眠怪"的查询都
     * 允许按格问）。真正的排斥由 `Game.dormantMonsters` 与 `this.monsters`
     * 两张表互斥保证——与 CE 的两条链表一一对应。
     */
    public hasDormantMonster: boolean = false;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }
}

/**
 * The 2D Dungeon Map Grid
 */
export class Grid {
    public readonly width: number;
    public readonly height: number;
    private cells: Cell[][];

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.cells = this.initializeGrid(width, height);
    }

    private initializeGrid(w: number, h: number): Cell[][] {
        const grid: Cell[][] = [];
        for (let x = 0; x < w; x++) {
            grid[x] = [];
            for (let y = 0; y < h; y++) {
                grid[x]![y] = new Cell(x, y);
            }
        }
        return grid;
    }

    public getCell(x: number, y: number): Cell | null {
        if (!this.isValidPos(x, y)) {
            return null;
        }
        return this.cells[x]?.[y] ?? null;
    }

    public getCellPos(pos: Pos): Cell | null {
        return this.getCell(pos.x, pos.y);
    }

    public isValidPos(x: number, y: number): boolean {
        return x >= 0 && x < this.width && y >= 0 && y < this.height;
    }

    /**
     * CE Movement.c:64 `highestPriorityLayer` 的 Grid 入口。
     * 返回层索引（不是地形）；全空时返回 DUNGEON 层（CE 的 best=0 初始化），
     * 此时该层存 NOTHING——要拿地形值请读 `cell.terrain`。
     */
    public highestPriorityLayer(x: number, y: number, skipGas: boolean = false): DungeonLayer {
        const cell = this.getCell(x, y);
        if (!cell) return DungeonLayer.DUNGEON;
        return highestPriorityLayerOf(cell.layers, skipGas);
    }

    /**
     * 层感知写入口（C-4a-0 新增，本轮生产代码零调用点，仅测试行使；
     * C-4a 起由生成器/环境系统接管）。只写该层，不动其他层，
     * 也不动 char/color。
     * AI-1：通行/遮挡派生位随层写刷新（此前只在 setTerrain 重算）。晋升链
     * （Promotion 的 VANISHES 清层与 DF 落格都走本入口）把 DOOR 晋升成
     * OPEN_DOOR 时 isOpaque 残留 true，obstructsScent（Scent.ts 的
     * T_OBSTRUCTS_SCENT 近似）继续把开着的门当遮挡物，updateScent 掩码
     * 穿不过门洞。推导口径与 setTerrain 相同；黑名单成员（WALL/GRANITE/
     * DOOR/SECRET_DOOR）home 层都是 DUNGEON，SURFACE/GAS 层写入时
     * effective 不变、派生位因此中性。
     */
    public setTerrainLayer(x: number, y: number, layer: DungeonLayer, terrain: TerrainType): void {
        const cell = this.getCell(x, y);
        if (cell) {
            cell.layers[layer] = terrain;
            const effective = cell.terrain;
            cell.isPassable = (
                effective !== TerrainType.WALL &&
                effective !== TerrainType.GRANITE &&
                effective !== TerrainType.CHASM &&
                effective !== TerrainType.SECRET_DOOR
            );
            cell.isOpaque = (
                effective === TerrainType.WALL ||
                effective === TerrainType.GRANITE ||
                effective === TerrainType.DOOR ||
                effective === TerrainType.SECRET_DOOR
            );
        }
    }

    public setTerrain(x: number, y: number, terrain: TerrainType, char: string = ' ', color: number = 0xFFFFFF) {
        const cell = this.getCell(x, y);
        if (cell) {
            // 干跑测量：新写入地形的归属层之外若存有非 NOTHING 内容，逐层记一笔。
            const home = TERRAIN_HOME_LAYER[terrain];
            for (let l = 0; l < DungeonLayer.COUNT; l++) {
                if (l === home) continue;
                const old = cell.layers[l]!;
                if (old !== TerrainType.NOTHING) {
                    recordCrossLayerClear(l as DungeonLayer, old, terrain);
                }
            }
            writeTerrainHome(cell, terrain);
            cell.char = char;
            cell.color = color;
            // Basic heuristics for passability / opacity.
            // （本轮行为不变：getter 恒等于写入值；对 getter 求值是为 C-4a 预留形状）
            const effective = cell.terrain;
            cell.isPassable = (
                effective !== TerrainType.WALL &&
                effective !== TerrainType.GRANITE &&
                effective !== TerrainType.CHASM &&
                effective !== TerrainType.SECRET_DOOR
            );
            cell.isOpaque = (
                effective === TerrainType.WALL ||
                effective === TerrainType.GRANITE ||
                effective === TerrainType.DOOR ||
                effective === TerrainType.SECRET_DOOR
            );
        }
    }
}
