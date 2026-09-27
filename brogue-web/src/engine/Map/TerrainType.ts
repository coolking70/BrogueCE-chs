/** Terrain identities shared by Grid and TerrainCatalog; no runtime dependencies. */
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
    // 的六个地形载体。U19f 在枚举尾部补回独立 FUNGUS_FOREST；既有 ID 不变。
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
    // FUNGUS_FOREST 的历史别名于 U19f 替换为独立 CE 载体。
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
    MACHINE_GLYPH_INACTIVE, STENCH_SMOKE_GAS,
    // U08: append only; preserve existing generation fingerprints.
    ANCIENT_SPIRIT_VINES, ANCIENT_SPIRIT_GRASS,
    DUNGEON_PORTAL, // CE deepest-level stair; append preserves existing IDs.
    ITEM_FIRE, // U17a: burnItem direct successor, CE Globals.c:498. Append only.
    // U17b: append only; existing terrain IDs are snapshot/fingerprint identities.
    TRAMPLED_FOLIAGE, ACTIVE_BRIMSTONE, BRIMSTONE_FIRE, OPEN_IRON_DOOR_INERT, BRIDGE_FALLING,
    // U17c: CE trigger carriers; append to preserve saved terrain IDs.
    MACHINE_PRESSURE_PLATE_USED, TRAP_DOOR, WALL_LEVER, WALL_LEVER_PULLED, MACHINE_TRIGGER_FLOOR_REPEATING,
    // U17d: CE vent, pilot and trap carriers; append-only IDs.
    MACHINE_METHANE_VENT_DORMANT, MACHINE_METHANE_VENT, PILOT_LIGHT, MACHINE_PARALYSIS_VENT, MACHINE_POISON_GAS_VENT_DORMANT, MACHINE_POISON_GAS_VENT, GAS_TRAP_POISON, FLAMETHROWER,
    // U17e: CE altar and pipe carriers, append-only saved IDs.
    ALTAR_CAGE_CLOSED, COMMUTATION_ALTAR_INERT, PIPE_GLOWING, RESURRECTION_ALTAR_INERT, SACRIFICE_ALTAR, PIPE_INERT, SACRIFICE_LAVA,
    // U17f: append-only final DF carriers; FLOOR_FLOODABLE already exists.
    RAT_TRAP_WALL_CRACKING, STATUE_CRACKING, COFFIN_OPEN, WORM_TUNNEL_MARKER_ACTIVE, PORTAL_LIGHT,
    // U19f: CE autoGen closure carriers; append-only saved terrain identities.
    FUNGUS_FOREST, TRAMPLED_FUNGUS_FOREST, SUNLIGHT_POOL, DARKNESS_PATCH, DEEP_WATER_ALGAE_WELL, DEEP_WATER_ALGAE_1, DEEP_WATER_ALGAE_2, NET_TRAP, NET_TRAP_HIDDEN, NETTING, ALARM_TRAP, ALARM_TRAP_HIDDEN, GAS_TRAP_CONFUSION, GAS_TRAP_CONFUSION_HIDDEN, FLOOD_TRAP_HIDDEN, STEAM_VENT, DEWAR_CAUSTIC_GAS, DEWAR_CONFUSION_GAS, DEWAR_PARALYSIS_GAS, DEWAR_METHANE_GAS, BROKEN_GLASS,

    LICHEN, // X2g: CE native terrain; append to preserve existing IDs.
    DARKNESS_CLOUD, // X2g: CE native terrain; append to preserve existing IDs.
    ROT_GAS, // X2g: CE native terrain; append to preserve existing IDs.
}
