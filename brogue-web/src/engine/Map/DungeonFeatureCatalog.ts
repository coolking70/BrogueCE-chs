/**
 * src/engine/Map/DungeonFeatureCatalog.ts — DF 目录（C-4b）
 *
 * CE `dungeonFeatureCatalog[NUMBER_DUNGEON_FEATURES]` 的 web 投影（数据，
 * 零生产调用点——调用方全部在 C-4c）。逐条从 BrogueCE-master/src/brogue/
 * Globals.c:603-932 抄录，枚举 id 从 Rogue.h:1469-1781 的
 * `enum dungeonFeatureTypes`（DF_GRANITE_COLUMN=1 起）对位。
 *
 * 抄录范围（任务书 §二.1）：不是 219 条全抄，而是——
 *   1. TerrainCatalog.ts 里 31 种地形的 fireType / discoverType / promoteType
 *      字符串指向的 DF（16 个），加上
 *   2. 它们经 subsequentDF 链到的条目（DF_INERT_BRIMSTONE →
 *      DF_BRIMSTONE_FIRE；DF_BRIDGE_FIRE → DF_BRIDGE_FALL →
 *      DF_BRIDGE_FALL_PREP）——**闭包完整，无悬空引用**（测试钉死）。
 *   合计 19 条，每条注明 CE 行号。（F-2a 增补 DF_ASH 至 20 条：
 *   EMBERS 的晋升目标 DF_ASH 的闭包要求。G-1 增 DF_GAS_FIRE、G-2 增
 *   DF_EXPLOSION_FIRE、F-2c 增 DF_BLOAT_EXPLOSION、C-5 增 DF_HOLE_POTION/
 *   DF_HOLE_2/DF_HOLE_DRAIN 至 26 条；C-6 增 DF_GRASS/DF_FOLIAGE 至 28 条
 *   ——runAutogenerators 表 index 3/8 的 DFType，第二起点登记在
 *   c_4b 测试 E2。）
 *
 * tile 归属：CE 条目的 tileType 列若在 web 的 31 个 TerrainType 里有对应物，
 * `tile` 记该成员；**没有的记 null（登记不实现，不为它现造地形）**，
 * CE 目录名保留在 `ceTile` 供后续新增地形的轮次对号。
 * CE tile 本身就是 0（NOTHING）的合法无地形 DF（DF_REPEL_CREATURES /
 * DF_BRIDGE_FIRE）记 `tile = TerrainType.NOTHING`，与 CE 的真值语义一致。
 *
 * 结构体出处：Rogue.h:1886-1902 `typedef struct dungeonFeature`
 * （tile / layer / startProbability / probabilityDecrement / flags /
 * description / lightFlare / flashColor / effectRadius / propagationTerrain /
 * subsequentDF / messageDisplayed——C 位置初始化，尾部省略即 0）。
 * DFF_* 旗标：Rogue.h:1811-1821 `enum dfeatureFlagCatalog`。
 */

import { DungeonLayer, TerrainType } from './Grid';

// ── DFF_* 旗标（CE Rogue.h:1811-1821，逐条行号）────────────────────────────
export const DFF_EVACUATE_CREATURES_FIRST     = 1 << 0;  // :1811 DF 区域内生物先被搬走
export const DFF_SUBSEQ_EVERYWHERE            = 1 << 1;  // :1812 subsequentDF 在每个落点格触发（而非仅原点）
export const DFF_TREAT_AS_BLOCKING            = 1 << 2;  // :1813 无视 tile 旗标，按"会堵路"做连通性否决
export const DFF_PERMIT_BLOCKING              = 1 << 3;  // :1814 豁免连通性否决
export const DFF_ACTIVATE_DORMANT_MONSTER     = 1 << 4;  // :1815 唤醒该格休眠怪（游戏侧，登记未实现）
export const DFF_CLEAR_OTHER_TERRAIN          = 1 << 5;  // :1816 清空落点格其它层
export const DFF_BLOCKED_BY_OTHER_LAYERS      = 1 << 6;  // :1817 任意层有更高优先级地形时不落入该格
export const DFF_SUPERPRIORITY                = 1 << 7;  // :1818 可覆盖更高优先级地形
export const DFF_AGGRAVATES_MONSTERS          = 1 << 8;  // :1819 按 effectRadius 聚怪（游戏侧，登记未实现）
export const DFF_RESURRECT_ALLY               = 1 << 9;  // :1820 复活盟友（游戏侧，登记未实现）
export const DFF_CLEAR_LOWER_PRIORITY_TERRAIN = 1 << 10; // :1821 清空落点格优先级数字更大（更弱）的其它层

/** CE `enum dungeonFeatureTypes`（Rogue.h:1469 起，DF_GRANITE_COLUMN=1）的成员。
 *  只列本轮闭包涉及的 19 个；id 与 CE 逐一对位（测试钉死）。 */
export enum DF {
    DF_CRYSTAL_WALL                = 2,   // :1471（T-1：autoGenerator 表 index 1
                                          // 的 DFType，Globals.c:607 目录行；
                                          // tile CRYSTAL_WALL B-3 已迁）
    DF_SHOW_DOOR                   = 13,  // Rogue.h:1484
    DF_REPEL_CREATURES             = 40,  // :1515
    DF_ASH                         = 49,  // :1524（F-2a：EMBERS promoteType 的载体）
    DF_STEAM_ACCUMULATION          = 43,  // :1518
    DF_METHANE_GAS_PUFF            = 44,  // :1519
    DF_TRAMPLED_FOLIAGE            = 61,  // :1542
    DF_ACTIVE_BRIMSTONE            = 66,  // :1549
    DF_INERT_BRIMSTONE             = 67,  // :1550
    DF_OPEN_DOOR                   = 81,  // :1571
    DF_CLOSED_DOOR                 = 82,  // :1572
    DF_OPEN_IRON_DOOR_INERT        = 83,  // :1573
    DF_BRIDGE_FALL_PREP            = 98,  // :1589
    DF_BRIDGE_FALL                 = 99,  // :1590
    DF_PLAIN_FIRE                  = 100, // :1592
    DF_GAS_FIRE                    = 101, // :1593（G-1：气体 tile 的 fireType 引用它；
                                          // tile GAS_FIRE 已于 G-2 迁移接线）
    DF_EXPLOSION_FIRE              = 102, // :1594（G-2：METHANE_GAS.promoteType 引用它；
                                          // 载体 tile GAS_EXPLOSION 已于 F-2c 迁移接线）
    DF_BLOAT_EXPLOSION             = 35,  // :1508（F-2c：bloat 的 MA_DF_ON_DEATH DFType，
                                          // Globals.c:1084 monsterCatalog 引用它）
    DF_BRIMSTONE_FIRE              = 104, // :1596
    DF_BRIDGE_FIRE                 = 105, // :1597
    DF_EMBERS                      = 107, // :1599
    DF_OBSIDIAN                    = 109, // :1601
    DF_POISON_GAS_CLOUD            = 125, // :1620
    DF_MACHINE_PRESSURE_PLATE_USED = 154, // :1663
    // V-2b-2b：TRAP_DOOR_HIDDEN.discoverType 与 WOODEN_BARRICADE.fireType 的
    // 载体（CE Globals.c:628 / :627 / :825；本文件按 project_conventions
    // "接地形链 → DungeonFeatureCatalog 默认进清单"的默认规则扩入，
    // 任务书 §6 未列，报告已申报）。
    DF_SHOW_TRAPDOOR_HALO          = 16,  // :1487
    DF_SHOW_TRAPDOOR               = 17,  // :1488
    DF_WOODEN_BARRICADE_BURN       = 156, // :1669
    DF_HOLE_2                      = 115, // :1608（C-5：DF_HOLE_POTION 的 subsequentDF，
                                          // Globals.c:782 目录行引用它；tile HOLE 已同轮迁移）
    DF_HOLE_DRAIN                  = 116, // :1609（C-5：HOLE.promoteType 的载体，
                                          // Globals.c:442 目录行引用它）
    DF_HOLE_POTION                 = 135, // :1632（C-5：POTION_DESCENT 的药水 DF
                                          // 与 pit bloat 的死亡 DFType，Globals.c:1039）
    DF_GRASS                       = 4,   // :1473（C-6：autoGenerator 表 index 3
                                          // 的 DFType，Globals.c:609 目录行；
                                          // tile GRASS 同轮已具备）
    DF_FOLIAGE                     = 8,   // :1477（C-6：表 index 8 的 DFType，
                                          // Globals.c:613；tile FOLIAGE 同轮已具备）
    DF_FORCEFIELD_MELT             = 52,  // :1527（B-3：FORCEFIELD.promoteType
                                          // 的载体，Globals.c:675 目录行）
    DF_SACRED_GLYPHS               = 53,  // :1528（B-3：SCROLL_SANCTUARY 的 DF，
                                          // Items.c:7942 → Globals.c:676 目录行）
    DF_SHATTERING_SPELL            = 56,  // :1531（B-3：crystalize 每个命中格的
                                          // DF，Items.c:4917 → Globals.c:679 目录行）
    // ── V-2b-3：wired 触发网络的载体 DF（九个新地形 carrier 的
    // promoteType/discoverType 引用 + 其 subsequentDF 链尾）。id 与 CE 枚举
    // 逐一对位（Rogue.h 实测行号 + 脚本数序 + 目录锚点校准三重核对）：
    DF_RUBBLE                      = 7,   // Rogue.h:1476（DF_WALL_SHATTER 的链尾）
    DF_SHOW_PARALYSIS_GAS_TRAP     = 15,  // :1486（GAS_TRAP_PARALYSIS_HIDDEN.
                                          // discoverType，Globals.c:626 目录行）
    DF_INACTIVE_GLYPH              = 89,  // :1579（MACHINE_GLYPH.promoteType，
                                          // Globals.c:726 目录行）
    DF_REVEAL_LEVER                = 95,  // :1585（WALL_LEVER_HIDDEN.
                                          // discoverType，Globals.c:732 目录行）
    DF_MEDIUM_HOLE                 = 152, // :1661（22 号蓝图 feature 的 DF 列，
                                          // GlobalsBrogue.c:324 → Globals.c:813）
    DF_OPEN_PORTCULLIS             = 177, // :1702（PORTCULLIS_CLOSED.promoteType，
                                          // Globals.c:854）
    DF_SHOW_METHANE_VENT           = 179, // :1706（MACHINE_METHANE_VENT_HIDDEN.
                                          // discoverType，Globals.c:858）
    DF_METHANE_VENT_OPEN           = 180, // :1707（MACHINE_METHANE_VENT_HIDDEN.
                                          // promoteType，Globals.c:859）
    DF_VENT_SPEW_METHANE           = 181, // :1708（DF_METHANE_VENT_OPEN 的链尾，
                                          // Globals.c:860）
    DF_PILOT_LIGHT                 = 182, // :1709（PILOT_LIGHT_DORMANT.promoteType，
                                          // Globals.c:861）
    DF_DISCOVER_PARALYSIS_VENT     = 183, // :1712（MACHINE_PARALYSIS_VENT_HIDDEN.
                                          // discoverType，Globals.c:864）
    DF_PARALYSIS_VENT_SPEW         = 184, // :1713（MACHINE_PARALYSIS_VENT_HIDDEN.
                                          // promoteType，Globals.c:865）
    DF_REVEAL_PARALYSIS_VENT_SILENTLY = 185, // :1714（DF_PARALYSIS_VENT_SPEW 的
                                          // 链尾，Globals.c:866）
    DF_WALL_SHATTER                = 215, // :1772（WORM_TUNNEL_OUTER_WALL.
                                          // promoteType，Globals.c:924）
    // ── V-2b-4：祭坛族轮。八条新条目 id 与 CE 枚举逐一对位
    //    （Rogue.h 实测行号 + 枚举脚本数序 + 目录锚点校准三重核对）：
    //    三条是蓝图 feature 的 **DF 列**（6/7/15 号蓝图的 DF 列在 web 无载体
    //    ——FeatureDef 没有 df 列，属 V-2b-7 范围；同 DF_MEDIUM_HOLE 先例，
    //    登记为无消费者的数据起点）；五条是新地形三链字段
    //   （promoteType/discoverType）自动拉入闭包的载体。
    DF_LUMINESCENT_FUNGUS          = 3,   // Rogue.h:1472（15 号蓝图
                                          // AMULET_SWITCH feature 的 DF 列，
                                          // GlobalsBrogue.c:291 → Globals.c:608）
    DF_ITEM_CAGE_CLOSE             = 85,  // :1575（ALTAR_CAGE_OPEN.
                                          // promoteType，Globals.c:722）
    DF_ALTAR_COMMUTE               = 140, // :1641（COMMUTATION_ALTAR.
                                          // promoteType，Globals.c:793）
    DF_MAGIC_PIPING                = 141, // :1642（6 号蓝图 COMMUTATION_ALTAR
                                          // feature 的 DF 列，GlobalsBrogue.c:225
                                          // → Globals.c:794）
    DF_ALTAR_RESURRECT             = 143, // :1646（RESURRECTION_ALTAR.
                                          // promoteType，Globals.c:798）
    DF_MACHINE_FLOOR_TRIGGER_REPEATING = 144, // :1647（7 号蓝图 RESURRECTION_
                                          // ALTAR feature 的 DF 列，
                                          // GlobalsBrogue.c:231 → Globals.c:799）
    DF_CAGE_DISAPPEARS             = 151, // :1660（ALTAR_CAGE_RETRACTABLE.
                                          // promoteType，Globals.c:812）
    DF_STATUE_SHATTER              = 188, // :1721（STATUE_INSTACRACK.
                                          // discoverType，Globals.c:873）
}

/** 目录条目 = CE 结构体的 web 投影（messageDisplayed 除外——它依赖玩家
 *  视野，属游戏侧状态，本轮登记不实现，见 DungeonFeature.ts 头表）。 */
export interface DungeonFeatureEntry {
    /** CE 枚举 id（= 目录下标）。 */
    readonly id: DF;
    /** Globals.c 目录行号（抄录出处）。 */
    readonly ceLine: number;
    /** CE tileType 目录名。'NOTHING' = CE tile 0（合法的无地形 DF）。 */
    readonly ceTile: string;
    /** web 对应地形；null = CE 有此 tileType 而 web 31 地形没有（登记不实现）。 */
    readonly tile: TerrainType | null;
    /** CE layer 列（tile 无关条目照抄 CE 原值，如 DF_REPEL_CREATURES 的 GAS）。 */
    readonly layer: DungeonLayer;
    readonly startProbability: number;
    readonly probabilityDecrement: number;
    /** DFF_* 并集。 */
    readonly flags: number;
    /** CE propagationTerrain 列的目录名（'' = 0 = 无）。 */
    readonly cePropagationTerrain: string;
    /** propagationTerrain 的 web 对应；null = CE 有此 tileType 而 web 没有（登记）。 */
    readonly propagationTerrain: TerrainType | null;
    /** subsequentDF 列（CE 0 = 无 → null）。 */
    readonly subsequentDF: DF | null;
    /** CE description 列（消息门控属游戏侧，本轮只登记）。 */
    readonly description: string;
    /** CE lightFlare 列的枚举名（'' = 0；光效登记未实现）。 */
    readonly lightFlare: string;
    /** CE flashColor 列（'' = 0；光效登记未实现）。 */
    readonly flashColor: string;
    /** CE effectRadius 列。 */
    readonly effectRadius: number;
}

/**
 * DF 目录（CE Globals.c:603-932 中本轮闭包涉及的条目；C-4b 19 条、
 * F-2a 增 DF_ASH 至 20、G-1 增 DF_GAS_FIRE 至 21、G-2 增 DF_EXPLOSION_FIRE
 * 至 22 并给 4 条 GAS 层 DF / 燃气火 DF 填上 tile、F-2c 增 DF_BLOAT_EXPLOSION
 * 至 23 并给 DF_EXPLOSION_FIRE 填上 tile——GAS_EXPLOSION 地形同轮落地）。
 * 其后 C-5/C-6/B-3 的增补见各条目注释（现 31 条）；T-1 增 DF_CRYSTAL_WALL
 * 至 32——CRYSTAL_WALL 地形 B-3 已迁，本轮接通 autoGenerator 表 index 1。
 *
 * 字段序照 CE 目录行注释（Globals.c:604）：
 *   tileType / layer / start / decr / fl / txt / flare / fCol / fRad /
 *   propTerrain / subseqDF。C 位置初始化，尾部省略即 0——本表把省略
 *   显式写成零值（项目约定：省略字段不序列化成 null/undefined）。
 */
export const DUNGEON_FEATURE_CATALOG: Readonly<Partial<Record<DF, DungeonFeatureEntry>>> = {
    // {DOOR, DUNGEON, 0, 0, 0, "", GENERIC_FLASH_LIGHT} —— 密门搜索显形
    [DF.DF_SHOW_DOOR]: {
        id: DF.DF_SHOW_DOOR, ceLine: 624, ceTile: 'DOOR', tile: TerrainType.DOOR,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },
    // V-2b-2b：搜索显形族两条（TRAP_DOOR_HIDDEN 的 discoverType 引用
    // DF_SHOW_TRAPDOOR；CE Globals.c:627/:628 逐字）+ 木栅点燃条
    //（WOODEN_BARRICADE.fireType，Globals.c:825 逐字）。
    [DF.DF_SHOW_TRAPDOOR_HALO]: {
        id: DF.DF_SHOW_TRAPDOOR_HALO, ceLine: 627, ceTile: 'CHASM_EDGE', tile: TerrainType.CHASM_EDGE,
        layer: DungeonLayer.LIQUID, startProbability: 100, probabilityDecrement: 100,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },
    [DF.DF_SHOW_TRAPDOOR]: {
        id: DF.DF_SHOW_TRAPDOOR, ceLine: 628, ceTile: 'TRAP_DOOR', tile: null,
        layer: DungeonLayer.LIQUID, startProbability: 0, probabilityDecrement: 0,
        flags: DFF_CLEAR_OTHER_TERRAIN, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: DF.DF_SHOW_TRAPDOOR_HALO,
        description: '', lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },
    [DF.DF_WOODEN_BARRICADE_BURN]: {
        id: DF.DF_WOODEN_BARRICADE_BURN, ceLine: 825, ceTile: 'PLAIN_FIRE', tile: TerrainType.PLAIN_FIRE,
        layer: DungeonLayer.SURFACE, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: 'flames quickly consume the wooden barricade.', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {NOTHING, GAS, 0, 0, DFF_EVACUATE_CREATURES_FIRST} —— 无地形 DF：楼梯
    // 踩上时"驱离生物"。tile=0 合法（CE :3415 无地形分支）。
    [DF.DF_REPEL_CREATURES]: {
        id: DF.DF_REPEL_CREATURES, ceLine: 663, ceTile: 'NOTHING', tile: TerrainType.NOTHING,
        layer: DungeonLayer.GAS, startProbability: 0, probabilityDecrement: 0,
        flags: DFF_EVACUATE_CREATURES_FIRST, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null, description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {STEAM, GAS, 15, 0, 0} —— 水上点火的水汽积聚（GAS 层 volume 特例）。
    // G-2 接线：tile STEAM 已迁（G-1）。CE 蒸汽源：深水 chanceToIgnite=100
    // 被火段点燃 → promoteTile(LIQUID, useFireDF) 走到本 DF → 每回合 +15
    // 体积的持续蒸汽（web 自创的"30% 冒 325"一次性分支同轮退役）。
    [DF.DF_STEAM_ACCUMULATION]: {
        id: DF.DF_STEAM_ACCUMULATION, ceLine: 666, ceTile: 'STEAM', tile: TerrainType.STEAM,
        layer: DungeonLayer.GAS, startProbability: 15, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {METHANE_GAS, GAS, 2, 0, 0} —— 泥沼晋升的沼气一缕。
    // G-2 接线：tile METHANE_GAS 随本轮迁入；载体 = MUD.promoteType
    // （promoteChance 100，1%/回合）——CE Globals.c:415 原数据，链条真实行走。
    [DF.DF_METHANE_GAS_PUFF]: {
        id: DF.DF_METHANE_GAS_PUFF, ceLine: 667, ceTile: 'METHANE_GAS', tile: TerrainType.METHANE_GAS,
        layer: DungeonLayer.GAS, startProbability: 2, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {ASH, SURFACE, 0, 0, 0} —— 灰烬（EMBERS promoteChance=300 的衰老落点；
    // F-2a 随 EMBERS 地形一起落地，tile 完整）
    [DF.DF_ASH]: {
        id: DF.DF_ASH, ceLine: 672, ceTile: 'ASH', tile: TerrainType.ASH,
        layer: DungeonLayer.SURFACE, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {TRAMPLED_FOLIAGE, SURFACE, 0, 0, 0} —— 踩过的灌木丛
    [DF.DF_TRAMPLED_FOLIAGE]: {
        id: DF.DF_TRAMPLED_FOLIAGE, ceLine: 688, ceTile: 'TRAMPLED_FOLIAGE', tile: null,
        layer: DungeonLayer.SURFACE, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {ACTIVE_BRIMSTONE, LIQUID, 0, 0, 0} —— 硫矿湖活性化
    [DF.DF_ACTIVE_BRIMSTONE]: {
        id: DF.DF_ACTIVE_BRIMSTONE, ceLine: 695, ceTile: 'ACTIVE_BRIMSTONE', tile: null,
        layer: DungeonLayer.LIQUID, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {INERT_BRIMSTONE, LIQUID, 0, 0, 0, "", 0, 0, 0, 0, DF_BRIMSTONE_FIRE}
    [DF.DF_INERT_BRIMSTONE]: {
        id: DF.DF_INERT_BRIMSTONE, ceLine: 696, ceTile: 'INERT_BRIMSTONE',
        tile: TerrainType.INERT_BRIMSTONE,
        layer: DungeonLayer.LIQUID, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: DF.DF_BRIMSTONE_FIRE,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {OPEN_DOOR, DUNGEON, 0, 0, 0} —— 门晋升（踩开）
    [DF.DF_OPEN_DOOR]: {
        id: DF.DF_OPEN_DOOR, ceLine: 718, ceTile: 'OPEN_DOOR', tile: TerrainType.OPEN_DOOR,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {DOOR, DUNGEON, 0, 0, 0} —— 开门回关（随机晋升）
    [DF.DF_CLOSED_DOOR]: {
        id: DF.DF_CLOSED_DOOR, ceLine: 719, ceTile: 'DOOR', tile: TerrainType.DOOR,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {OPEN_IRON_DOOR_INERT, DUNGEON, 0, 0, 0, "", GENERIC_FLASH_LIGHT}
    // —— 锁门用钥匙后的惰性铁门（web 尚无此 tile，登记）
    [DF.DF_OPEN_IRON_DOOR_INERT]: {
        id: DF.DF_OPEN_IRON_DOOR_INERT, ceLine: 720, ceTile: 'OPEN_IRON_DOOR_INERT', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {BRIDGE_FALLING, LIQUID, 200, 100, 0, "", 0, 0, 0, BRIDGE}
    // —— 桥燃后沿绳桥蔓延的坠落段（propagationTerrain=BRIDGE；
    //    BRIDGE_FALLING tile web 没有，登记）
    [DF.DF_BRIDGE_FALL_PREP]: {
        id: DF.DF_BRIDGE_FALL_PREP, ceLine: 736, ceTile: 'BRIDGE_FALLING', tile: null,
        layer: DungeonLayer.LIQUID, startProbability: 200, probabilityDecrement: 100,
        flags: 0, cePropagationTerrain: 'BRIDGE', propagationTerrain: TerrainType.BRIDGE,
        subsequentDF: null, description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {CHASM, LIQUID, 0, 0, 0, "", GENERIC_FLASH_LIGHT, 0, 0, 0, DF_BRIDGE_FALL_PREP}
    [DF.DF_BRIDGE_FALL]: {
        id: DF.DF_BRIDGE_FALL, ceLine: 737, ceTile: 'CHASM', tile: TerrainType.CHASM,
        layer: DungeonLayer.LIQUID, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: DF.DF_BRIDGE_FALL_PREP,
        description: '', lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {PLAIN_FIRE, SURFACE, 0, 0, 0} —— 平火（F-2a：tile 翻正 PLAIN_FIRE；
    // 点火链 promoteTile(useFireDF) 的落点。start=0：单点、零 RNG——
    // CE spawnMapDF 的 while(startProb>0) 不执行，符合 probDec 约定）
    [DF.DF_PLAIN_FIRE]: {
        id: DF.DF_PLAIN_FIRE, ceLine: 740, ceTile: 'PLAIN_FIRE', tile: TerrainType.PLAIN_FIRE,
        layer: DungeonLayer.SURFACE, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {GAS_FIRE, SURFACE, 0, 0, 0} —— 燃气之火（G-1 新增条目：POISON_GAS/
    // CONFUSION_GAS 的 fireType 引用它；GAS_FIRE 是十种 T_IS_FIRE 地形之一
    // （Globals.c:495，SURFACE 层——注意**不是** GAS 层，F-0 §3.2 表未记
    // layer 列，G-1 实测翻正）。G-2 接线：tile GAS_FIRE 已迁——燃气点燃时
    // promoteTile 走到本 DF，火地形落 SURFACE（"燃气烧完地上留火"），
    // GAS 层体积清零的怪癖（Time.c:1361-1368）+ promoteChance 8000 的
    // 80%/回合自熄完整成形；G-1 时代的缺 tile 缓办随之退役。
    [DF.DF_GAS_FIRE]: {
        id: DF.DF_GAS_FIRE, ceLine: 741, ceTile: 'GAS_FIRE', tile: TerrainType.GAS_FIRE,
        layer: DungeonLayer.SURFACE, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {GAS_EXPLOSION, SURFACE, 60, 17, 0} —— 甲烷爆轰圈（G-2 新增条目：
    // METHANE_GAS 的 promoteType 引用它；TM_EXPLOSIVE_PROMOTE 格被点燃且
    // 8 邻全为 T_IS_FIRE|T_OBSTRUCTS_GAS|TM_EXPLOSIVE_PROMOTE 时走爆轰）。
    // F-2c 接线：tile GAS_EXPLOSION 已迁（Globals.c:496），爆炸圈经既有
    // spawnMapDF（60/17 概率衰减波前）→ fillSpawnMap 自动成形——G-2 预测
    // 成立，DF_MISSING_TILES 同步摘除。
    [DF.DF_EXPLOSION_FIRE]: {
        id: DF.DF_EXPLOSION_FIRE, ceLine: 742, ceTile: 'GAS_EXPLOSION',
        tile: TerrainType.GAS_EXPLOSION,
        layer: DungeonLayer.SURFACE, startProbability: 60, probabilityDecrement: 17,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {GAS_EXPLOSION, SURFACE, 350, 100, 0, "", EXPLOSION_FLARE_LIGHT} ——
    // bloat 自爆（F-2c 新增条目：monsterCatalog 里 explosive bloat 的 DFType
    // 引用它，Globals.c:1084；killCreature 经 MA_DF_ON_DEATH 播出，
    // Combat.c:1965-1967，refreshCell=true——落到生物脚下当场结算爆炸伤害）。
    // 与 DF_EXPLOSION_FIRE 同 tile 不同参数：350/100 的波前更大（bloat 的
    // 爆炸半径明显大于甲烷爆轰）。description 为空（CE 如此）；光效
    // EXPLOSION_FLARE_LIGHT web 无对应列，登记不迁移。
    [DF.DF_BLOAT_EXPLOSION]: {
        id: DF.DF_BLOAT_EXPLOSION, ceLine: 654, ceTile: 'GAS_EXPLOSION',
        tile: TerrainType.GAS_EXPLOSION,
        layer: DungeonLayer.SURFACE, startProbability: 350, probabilityDecrement: 100,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: 'EXPLOSION_FLARE_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {BRIMSTONE_FIRE, SURFACE, 0, 0, 0} —— 硫矿火（web 无此 tile，登记）
    [DF.DF_BRIMSTONE_FIRE]: {
        id: DF.DF_BRIMSTONE_FIRE, ceLine: 744, ceTile: 'BRIMSTONE_FIRE', tile: null,
        layer: DungeonLayer.SURFACE, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {0, 0, 0, 0, 0, "the rope bridge snaps…", FALLEN_TORCH_FLASH_LIGHT, 0, 0, 0,
    //  DF_BRIDGE_FALL} —— 桥燃消息 + 链到坠落；CE tile=0（合法无地形 DF）
    [DF.DF_BRIDGE_FIRE]: {
        id: DF.DF_BRIDGE_FIRE, ceLine: 745, ceTile: 'NOTHING', tile: TerrainType.NOTHING,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: DF.DF_BRIDGE_FALL,
        description: 'the rope bridge snaps from the heat and plunges into the chasm!',
        lightFlare: 'FALLEN_TORCH_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {EMBERS, SURFACE, 0, 0, 0} —— 余烬（F-2a：tile 翻正 EMBERS；PLAIN_FIRE
    // promoteChance=500 的衰老落点、门/密门/锁门 fireType 的烧毁产物）
    [DF.DF_EMBERS]: {
        id: DF.DF_EMBERS, ceLine: 747, ceTile: 'EMBERS', tile: TerrainType.EMBERS,
        layer: DungeonLayer.SURFACE, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {OBSIDIAN, SURFACE, 0, 0, DFF_CLEAR_LOWER_PRIORITY_TERRAIN} —— 岩浆冷却
    [DF.DF_OBSIDIAN]: {
        id: DF.DF_OBSIDIAN, ceLine: 749, ceTile: 'OBSIDIAN', tile: TerrainType.OBSIDIAN,
        layer: DungeonLayer.SURFACE, startProbability: 0, probabilityDecrement: 0,
        flags: DFF_CLEAR_LOWER_PRIORITY_TERRAIN,
        cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {POISON_GAS, GAS, 1000, 0, 0, "a cloud of caustic gas…"} —— 陷阱毒气
    //（TRAP 的 T_IS_DF_TRAP fireType；GAS 层 volume 特例）。
    // G-2 接线：tile POISON_GAS 已迁（G-1）。web 的毒气陷阱调用点
    // （Game.triggerTrap）今日仍直呼 addGas(1000)（G-1 折算后的同量口径，
    // 体积结果与本 DF 逐位等价）；改走 DF 生成家族属调用方接线，本轮裁定
    // 不动（i18n 消息归并问题，登记报告）。
    [DF.DF_POISON_GAS_CLOUD]: {
        id: DF.DF_POISON_GAS_CLOUD, ceLine: 770, ceTile: 'POISON_GAS', tile: TerrainType.POISON_GAS,
        layer: DungeonLayer.GAS, startProbability: 1000, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: 'a cloud of caustic gas sprays upward from the floor!',
        lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {MACHINE_PRESSURE_PLATE_USED, DUNGEON, 0, 0, 0} —— 用过的机器压力板
    //（web 的 RESET_PLATE 是自创物、非此 tile，登记不冒认）
    [DF.DF_MACHINE_PRESSURE_PLATE_USED]: {
        id: DF.DF_MACHINE_PRESSURE_PLATE_USED, ceLine: 815, ceTile: 'MACHINE_PRESSURE_PLATE_USED',
        tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // ── C-5：洞族三条（下坠药水 / pit bloat 的坠落载体）────────────────────

    // {HOLE, SURFACE, 200, 100, 0} —— 洞本体（DF_HOLE_POTION 的 subsequentDF；
    // HOLE tile 带 T_AUTO_DESCENT，站上去的生物回合末坠落）。
    [DF.DF_HOLE_2]: {
        id: DF.DF_HOLE_2, ceLine: 756, ceTile: 'HOLE', tile: TerrainType.HOLE,
        layer: DungeonLayer.SURFACE, startProbability: 200, probabilityDecrement: 100,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {HOLE_EDGE, SURFACE, 0, 0, 0} —— 洞合拢（HOLE.promoteChance=-1000 的
    // 晋升落点：洞自行回填成 HOLE_EDGE，随后由 VANISHES_UPON_PROMOTION 消退）。
    [DF.DF_HOLE_DRAIN]: {
        id: DF.DF_HOLE_DRAIN, ceLine: 757, ceTile: 'HOLE_EDGE', tile: TerrainType.HOLE_EDGE,
        layer: DungeonLayer.SURFACE, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {HOLE_EDGE, SURFACE, 300, 100, 0, "", 0, &darkBlue, 3, 0, DF_HOLE_2} ——
    // 下坠药水（Items.c:8097 POTION_DESCENT）与 pit bloat 死亡 DFType
    // （Globals.c:1039 monsterCatalog）共用：先铺 HOLE_EDGE 波前（300/100），
    // 再经 subsequentDF 在原点落 HOLE。effectRadius 3 是 &darkBlue 光效的
    // 视觉列（G-3 同款裁定：web 无光效列，登记不迁移）。调用点两处以
    // abortIfBlocking=false 传入（CE refreshCell=true, abortIfBlocking=false
    // ——洞允许切断关卡，靠 promoteChance 负值自行合拢）。
    [DF.DF_HOLE_POTION]: {
        id: DF.DF_HOLE_POTION, ceLine: 782, ceTile: 'HOLE_EDGE', tile: TerrainType.HOLE_EDGE,
        layer: DungeonLayer.SURFACE, startProbability: 300, probabilityDecrement: 100,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: DF.DF_HOLE_2,
        description: '', lightFlare: '', flashColor: 'darkBlue', effectRadius: 3,
    },

    // {GRASS, SURFACE, 75, 5, DFF_BLOCKED_BY_OTHER_LAYERS} —— 草地扩散（C-6：
    // runAutogenerators 表 index 3 的 DFType，深度 1-10，数量 = (1000-80d)/100，
    // frequency 0 纯公式）。tile GRASS web 已有（SURFACE 层）。
    [DF.DF_GRASS]: {
        id: DF.DF_GRASS, ceLine: 609, ceTile: 'GRASS', tile: TerrainType.GRASS,
        layer: DungeonLayer.SURFACE, startProbability: 75, probabilityDecrement: 5,
        flags: DFF_BLOCKED_BY_OTHER_LAYERS, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null, description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {FOLIAGE, SURFACE, 100, 33, (DFF_BLOCKED_BY_OTHER_LAYERS)} —— 树丛扩散
    //（C-6：表 index 8 的 DFType，深度 1-8，数量 = (1000-333d)/100 再叠加
    // frequency 15 追加）。tile FOLIAGE web 已有（SURFACE 层）。
    [DF.DF_FOLIAGE]: {
        id: DF.DF_FOLIAGE, ceLine: 613, ceTile: 'FOLIAGE', tile: TerrainType.FOLIAGE,
        layer: DungeonLayer.SURFACE, startProbability: 100, probabilityDecrement: 33,
        flags: DFF_BLOCKED_BY_OTHER_LAYERS, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null, description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {CRYSTAL_WALL, DUNGEON, 200, 50, DFF_CLEAR_OTHER_TERRAIN} —— 水晶墙扩散
    //（T-1：runAutogenerators 表 index 1 的 DFType，深度 14-40，数量 =
    // (-325+25d)/100 再叠加 frequency 15 追加）。tile CRYSTAL_WALL B-3 已迁
    //（Globals.c:338）；DFF_CLEAR_OTHER_TERRAIN 的跨层清理 C-4b 已实现
    //（DungeonFeature.ts 对应 CE Architect.c:3423-3440），非半残接线。
    [DF.DF_CRYSTAL_WALL]: {
        id: DF.DF_CRYSTAL_WALL, ceLine: 607, ceTile: 'CRYSTAL_WALL', tile: TerrainType.CRYSTAL_WALL,
        layer: DungeonLayer.DUNGEON, startProbability: 200, probabilityDecrement: 50,
        flags: DFF_CLEAR_OTHER_TERRAIN, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null, description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // ── B-3：三张卷轴（negation/sanctuary/shattering）的 DF ────────────────

    // {FORCEFIELD_MELT, SURFACE, 0, 0, 0} —— 消融中的水晶（B-3：FORCEFIELD
    // tile 的 promoteType 载体；start=0 → 原点一格、零 RNG）。FORCEFIELD_MELT
    // tile 同轮已迁（Globals.c:478）。
    [DF.DF_FORCEFIELD_MELT]: {
        id: DF.DF_FORCEFIELD_MELT, ceLine: 675, ceTile: 'FORCEFIELD_MELT',
        tile: TerrainType.FORCEFIELD_MELT,
        layer: DungeonLayer.SURFACE, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {SACRED_GLYPH, SURFACE, 100, 100, 0, "", EMPOWERMENT_LIGHT} —— 圣徽
    //（B-3：SCROLL_SANCTUARY 落在玩家脚下，Items.c:7941-7943 五参形态
    // spawnDungeonFeature(x, y, feat, refreshCell=true, abortIfBlocking=false)）。
    // start=100/decr=100：spawnMapDF 十字波前——中心格无条件 + 4 正邻各掷一次
    // rand_percent(100)（必中），共 5 格圣徽（CE 的 "forming glyphS" 即此）。
    // EMPOWERMENT_LIGHT 光效列 web 无对应（登记不迁移）。tile SACRED_GLYPH
    // 同轮已迁（Globals.c:479）。
    [DF.DF_SACRED_GLYPHS]: {
        id: DF.DF_SACRED_GLYPHS, ceLine: 676, ceTile: 'SACRED_GLYPH',
        tile: TerrainType.SACRED_GLYPH,
        layer: DungeonLayer.SURFACE, startProbability: 100, probabilityDecrement: 100,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: 'EMPOWERMENT_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {RUBBLE, SURFACE, 0, 0, DFF_ACTIVATE_DORMANT_MONSTER} —— 碎石（B-3：
    // crystalize 在每个命中格 spawned，Items.c:4917）。CE 行号按 DF 枚举
    // （Rogue.h:1531 DF_SHATTERING_SPELL=56）对齐目录表推得 :679——上下行
    // :677 DF_LICHEN_GROW / :678 DF_TUNNELIZE 双重锚定。start=0 → 只标记
    // 原点格；tile RUBBLE web 无对应地形 → tile null 登记（入
    // DF_MISSING_TILES，留待 RUBBLE 地形落地的轮次翻正）；唤醒休眠怪旗标
    // 同属游戏侧登记未实现。
    [DF.DF_SHATTERING_SPELL]: {
        id: DF.DF_SHATTERING_SPELL, ceLine: 679, ceTile: 'RUBBLE', tile: null,
        layer: DungeonLayer.SURFACE, startProbability: 0, probabilityDecrement: 0,
        flags: DFF_ACTIVATE_DORMANT_MONSTER, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null, description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // ── V-2b-3：wired 触发网络的载体 DF（14 条；九个新地形 carrier 的
    //    promoteType/discoverType 引用 + 链尾。Globals.c 目录行已用
    //    "枚举序 = 目录序、{0} 占 index 0"的解析脚本逐条对位，并以 web
    //    既有的 8 个 ceLine 锚点校准过解析器）────────────────────────────

    // {RUBBLE, SURFACE, 45, 23, 0} —— 碎石（DF_WALL_SHATTER 的链尾落点；
    // :612 目录行）。tile RUBBLE web 无（与 DF_SHATTERING_SPELL 同缺）。
    [DF.DF_RUBBLE]: {
        id: DF.DF_RUBBLE, ceLine: 612, ceTile: 'RUBBLE', tile: null,
        layer: DungeonLayer.SURFACE, startProbability: 45, probabilityDecrement: 23,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null, description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {GAS_TRAP_PARALYSIS, DUNGEON, 0, 0, 0, "", GENERIC_FLASH_LIGHT}（:626）
    // —— 麻痹触发板显形（GAS_TRAP_PARALYSIS_HIDDEN.discoverType）。
    // tile GAS_TRAP_PARALYSIS 本轮已随载体迁入！
    [DF.DF_SHOW_PARALYSIS_GAS_TRAP]: {
        id: DF.DF_SHOW_PARALYSIS_GAS_TRAP, ceLine: 626, ceTile: 'GAS_TRAP_PARALYSIS',
        tile: TerrainType.GAS_TRAP_PARALYSIS,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {MACHINE_GLYPH_INACTIVE, DUNGEON, 0, 0, 0}（:726）—— 发亮符文
    //（MACHINE_GLYPH.promoteType 的落点；tile MACHINE_GLYPH_INACTIVE web 无，
    // 登记——glyph 通电后自身变色的视觉链留后续轮次，wired 激活不受影响：
    // promoteTile 的 wired 分支在缓办之外照常执行，CE :1271 无前置守卫）。
    [DF.DF_INACTIVE_GLYPH]: {
        id: DF.DF_INACTIVE_GLYPH, ceLine: 726, ceTile: 'MACHINE_GLYPH_INACTIVE', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {WALL_LEVER, DUNGEON, 0, 0, 0, "you notice a lever…", GENERIC_FLASH_LIGHT}
    //（:732）—— 墙杆显形（WALL_LEVER_HIDDEN.discoverType）。tile WALL_LEVER
    // web 无（带 TM_IS_WIRED 的那半条链，登记"激活轮需重核"）。
    [DF.DF_REVEAL_LEVER]: {
        id: DF.DF_REVEAL_LEVER, ceLine: 732, ceTile: 'WALL_LEVER', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: 'you notice a lever hidden behind a loose stone in the wall.',
        lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {TRAP_DOOR, LIQUID, 225, 100, (DFF_CLEAR_OTHER_TERRAIN | DFF_SUBSEQ_EVERYWHERE),
    // "", 0, 0, 0, 0, DF_SHOW_TRAPDOOR_HALO}（:813）—— 中洞（22 号蓝图 feature
    // 的 DF 列：板被掷中物品踩压时把自身格与波前格炸成 TRAP_DOOR 洞；tile
    // TRAP_DOOR web 无——与 DF_SHOW_TRAPDOOR 同缺，登记）。链尾
    // DF_SHOW_TRAPDOOR_HALO 已在目录（V-2b-2b）。
    [DF.DF_MEDIUM_HOLE]: {
        id: DF.DF_MEDIUM_HOLE, ceLine: 813, ceTile: 'TRAP_DOOR', tile: null,
        layer: DungeonLayer.LIQUID, startProbability: 225, probabilityDecrement: 100,
        flags: DFF_CLEAR_OTHER_TERRAIN | DFF_SUBSEQ_EVERYWHERE,
        cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: DF.DF_SHOW_TRAPDOOR_HALO,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {PORTCULLIS_DORMANT, DUNGEON, 0, 0, 0, "the portcullis slowly rises…",
    // GENERIC_FLASH_LIGHT}（:854）—— 铁闸升起（PORTCULLIS_CLOSED.promoteType；
    // tile PORTCULLIS_DORMANT web 无，登记——闸门打开的落点地形）。
    [DF.DF_OPEN_PORTCULLIS]: {
        id: DF.DF_OPEN_PORTCULLIS, ceLine: 854, ceTile: 'PORTCULLIS_DORMANT', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: 'the portcullis slowly rises from the ground into a slot in the ceiling.',
        lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {MACHINE_METHANE_VENT_DORMANT, DUNGEON, 0, 0, 0, "you notice an inactive
    // gas vent…", GENERIC_FLASH_LIGHT}（:858）—— 甲烷喷口显形。
    [DF.DF_SHOW_METHANE_VENT]: {
        id: DF.DF_SHOW_METHANE_VENT, ceLine: 858, ceTile: 'MACHINE_METHANE_VENT_DORMANT', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: 'you notice an inactive gas vent hidden in a crevice of the floor.',
        lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {MACHINE_METHANE_VENT, DUNGEON, 0, 0, 0, "explosive methane gas starts
    // wafting…", 0, 0, 0, 0, DF_VENT_SPEW_METHANE}（:859）—— 甲烷喷口开启
    //（MACHINE_METHANE_VENT_HIDDEN.promoteType）；tile MACHINE_METHANE_VENT
    // web 无（开启态喷口的驻留地形，登记）。
    [DF.DF_METHANE_VENT_OPEN]: {
        id: DF.DF_METHANE_VENT_OPEN, ceLine: 859, ceTile: 'MACHINE_METHANE_VENT', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: DF.DF_VENT_SPEW_METHANE,
        description: 'explosive methane gas starts wafting out of hidden vents in the floor!',
        lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {METHANE_GAS, GAS, 60, 0, 0}（:860）—— 甲烷波前（60%/格/环 掷骰扩散，
    // decr=0 由 madeChange 自然终止；tile METHANE_GAS G-2 已迁——链真实
    // 行走，41 号接线后即产沼气）。
    [DF.DF_VENT_SPEW_METHANE]: {
        id: DF.DF_VENT_SPEW_METHANE, ceLine: 860, ceTile: 'METHANE_GAS', tile: TerrainType.METHANE_GAS,
        layer: DungeonLayer.GAS, startProbability: 60, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {PILOT_LIGHT, DUNGEON, 0, 0, 0, "a torch falls from its mount…",
    // FALLEN_TORCH_FLASH_LIGHT}（:861）—— 火嘴点燃（PILOT_LIGHT_DORMANT.
    // promoteType；tile PILOT_LIGHT web 无，登记）。
    [DF.DF_PILOT_LIGHT]: {
        id: DF.DF_PILOT_LIGHT, ceLine: 861, ceTile: 'PILOT_LIGHT', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: 'a torch falls from its mount and lies sputtering on the floor.',
        lightFlare: 'FALLEN_TORCH_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {MACHINE_PARALYSIS_VENT, DUNGEON, 0, 0, 0, "you notice an inactive gas
    // vent…", GENERIC_FLASH_LIGHT}（:864）—— 麻痹喷口显形。
    [DF.DF_DISCOVER_PARALYSIS_VENT]: {
        id: DF.DF_DISCOVER_PARALYSIS_VENT, ceLine: 864, ceTile: 'MACHINE_PARALYSIS_VENT', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: 'you notice an inactive gas vent hidden in a crevice of the floor.',
        lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {PARALYSIS_GAS, GAS, 350, 0, 0, "paralytic gas sprays upward…", 0, 0, 0, 0,
    // DF_REVEAL_PARALYSIS_VENT_SILENTLY}（:865）—— 麻痹气波前（350 折算
    // rand_percent 满 100%——全连通区灌满后由 madeChange 终止；tile
    // PARALYSIS_GAS G-3 已迁：67/68 号的机器 payoff 真实行走）。
    [DF.DF_PARALYSIS_VENT_SPEW]: {
        id: DF.DF_PARALYSIS_VENT_SPEW, ceLine: 865, ceTile: 'PARALYSIS_GAS', tile: TerrainType.PARALYSIS_GAS,
        layer: DungeonLayer.GAS, startProbability: 350, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: DF.DF_REVEAL_PARALYSIS_VENT_SILENTLY,
        description: 'paralytic gas sprays upward from hidden vents in the floor!',
        lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {MACHINE_PARALYSIS_VENT, DUNGEON, 0, 0, 0}（:866）—— 喷口无声显形
    //（DF_PARALYSIS_VENT_SPEW 的链尾：喷气的同时把隐藏喷口变成可见喷口；
    // tile MACHINE_PARALYSIS_VENT web 无，登记）。
    [DF.DF_REVEAL_PARALYSIS_VENT_SILENTLY]: {
        id: DF.DF_REVEAL_PARALYSIS_VENT_SILENTLY, ceLine: 866, ceTile: 'MACHINE_PARALYSIS_VENT', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {RUBBLE, SURFACE, 120, 100, DFF_ACTIVATE_DORMANT_MONSTER, "the nearby
    // wall explodes in a shower of stone fragments!", 0, &darkGray, 3, 0,
    // DF_RUBBLE}（:924）—— 墙爆（WORM_TUNNEL_OUTER_WALL.promoteType：18/22
    // 号"爆炸墙"的 payoff，碎石波前 + 每个落点链 DF_RUBBLE 唤醒蠕虫；
    // tile RUBBLE web 无——碎石落点登记，唤醒旗标同属游戏侧登记）。
    [DF.DF_WALL_SHATTER]: {
        id: DF.DF_WALL_SHATTER, ceLine: 924, ceTile: 'RUBBLE', tile: null,
        layer: DungeonLayer.SURFACE, startProbability: 120, probabilityDecrement: 100,
        flags: DFF_ACTIVATE_DORMANT_MONSTER, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: DF.DF_RUBBLE,
        description: 'the nearby wall explodes in a shower of stone fragments!',
        lightFlare: '', flashColor: 'darkGray', effectRadius: 3,
    },

    // ══ V-2b-4：祭坛族轮的八条（CE Globals.c 目录行逐字）════════════════════
    // CE 目录行已用"枚举序 = 目录序、{0} 占 index 0"的解析脚本对位，
    // 并以 web 既有 15 个 ceLine 锚点（DF_SHOW_DOOR :624、DF_LEVER :632 …）
    // 校准过解析器。逐字段钉死见 v_2b_4_altars.test.ts B 组。

    // {LUMINESCENT_FUNGUS, SURFACE, 60, 8, DFF_BLOCKED_BY_OTHER_LAYERS}（:608）
    // —— 15 号蓝图 AMULET_SWITCH feature 的 DF 列（GlobalsBrogue.c:291）。
    // tile LUMINESCENT_FUNGUS 是 CE 的地面发光菌毯；web 把 FUNGUS_FOREST
    // 别名到 FOLIAGE 后没有该 tile 的独立载体，故 tile 留 null 登记
    //（与 DF_TRAMPLED_FOLIAGE 同缺）。
    [DF.DF_LUMINESCENT_FUNGUS]: {
        id: DF.DF_LUMINESCENT_FUNGUS, ceLine: 608, ceTile: 'LUMINESCENT_FUNGUS', tile: null,
        layer: DungeonLayer.SURFACE, startProbability: 60, probabilityDecrement: 8,
        flags: DFF_BLOCKED_BY_OTHER_LAYERS, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null, description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {ALTAR_CAGE_CLOSED, DUNGEON, 0, 0, DFF_EVACUATE_CREATURES_FIRST,
    //  "the cages lower to cover the altars.", GENERIC_FLASH_LIGHT}（:722）
    // —— ALTAR_CAGE_OPEN.promoteType（1/2/26 号"取物后笼子落下"）。
    // tile ALTAR_CAGE_CLOSED web 无（本轮只迁开态），登记。
    [DF.DF_ITEM_CAGE_CLOSE]: {
        id: DF.DF_ITEM_CAGE_CLOSE, ceLine: 722, ceTile: 'ALTAR_CAGE_CLOSED', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: DFF_EVACUATE_CREATURES_FIRST, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null, description: 'the cages lower to cover the altars.',
        lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {COMMUTATION_ALTAR_INERT, DUNGEON, 0, 0, 0, "the items on the two altars
    //  flash with a brilliant light!", SCROLL_ENCHANTMENT_LIGHT}（:793）
    // —— COMMUTATION_ALTAR.promoteType（6 号置换完成后的惰性态）。
    // tile COMMUTATION_ALTAR_INERT web 无（只迁活化态），登记。
    [DF.DF_ALTAR_COMMUTE]: {
        id: DF.DF_ALTAR_COMMUTE, ceLine: 793, ceTile: 'COMMUTATION_ALTAR_INERT', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null,
        description: 'the items on the two altars flash with a brilliant light!',
        lightFlare: 'SCROLL_ENCHANTMENT_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {PIPE_GLOWING, SURFACE, 90, 60, 0}（:794）—— 6 号蓝图 COMMUTATION_ALTAR
    // feature 的 DF 列（GlobalsBrogue.c:225，置换祭坛之间的发光管道）。
    // tile PIPE_GLOWING web 无（33 号蓝图链未落地），登记；无后续链。
    [DF.DF_MAGIC_PIPING]: {
        id: DF.DF_MAGIC_PIPING, ceLine: 794, ceTile: 'PIPE_GLOWING', tile: null,
        layer: DungeonLayer.SURFACE, startProbability: 90, probabilityDecrement: 60,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null, description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {RESURRECTION_ALTAR_INERT, DUNGEON, 0, 0, DFF_RESURRECT_ALLY,
    //  "An old friend emerges from a bloom of sacred light!", EMPOWERMENT_LIGHT}
    // （:798）—— RESURRECTION_ALTAR.promoteType（7 号复活完成后的惰性态）。
    // DFF_RESURRECT_ALLY（Rogue.h:1820）在 web 属游戏侧登记未实现。
    [DF.DF_ALTAR_RESURRECT]: {
        id: DF.DF_ALTAR_RESURRECT, ceLine: 798, ceTile: 'RESURRECTION_ALTAR_INERT', tile: null,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: DFF_RESURRECT_ALLY, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null,
        description: 'An old friend emerges from a bloom of sacred light!',
        lightFlare: 'EMPOWERMENT_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {MACHINE_TRIGGER_FLOOR_REPEATING, LIQUID, 300, 100, DFF_SUPERPRIORITY,
    //  "", 0, 0, 0, CARPET}（:799）—— 7 号蓝图 RESURRECTION_ALTAR feature 的
    // DF 列（GlobalsBrogue.c:231）。**layer = LIQUID** 是本条的特点（可重复
    // 触发的机器地板陷阱），propTerrain = CARPET。tile MACHINE_TRIGGER_
    // FLOOR_REPEATING web 无，登记。
    [DF.DF_MACHINE_FLOOR_TRIGGER_REPEATING]: {
        id: DF.DF_MACHINE_FLOOR_TRIGGER_REPEATING, ceLine: 799,
        ceTile: 'MACHINE_TRIGGER_FLOOR_REPEATING', tile: null,
        layer: DungeonLayer.LIQUID, startProbability: 300, probabilityDecrement: 100,
        flags: DFF_SUPERPRIORITY, cePropagationTerrain: 'CARPET', propagationTerrain: TerrainType.CARPET,
        subsequentDF: null, description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {ALTAR_INERT, DUNGEON, 0, 0, 0, "the cage lifts off of the altar.",
    //  GENERIC_FLASH_LIGHT}（:812）—— ALTAR_CAGE_RETRACTABLE.promoteType
    //（28 号：踏板被掷中 → 笼子升起，露出祭坛上的钥匙）。tile ALTAR_INERT
    // 在 web 就是 TerrainType.ALTAR（TerrainCatalog :362 条），tile 完整。
    [DF.DF_CAGE_DISAPPEARS]: {
        id: DF.DF_CAGE_DISAPPEARS, ceLine: 812, ceTile: 'ALTAR_INERT', tile: TerrainType.ALTAR,
        layer: DungeonLayer.DUNGEON, startProbability: 0, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: null, description: 'the cage lifts off of the altar.',
        lightFlare: 'GENERIC_FLASH_LIGHT', flashColor: '', effectRadius: 0,
    },

    // {RUBBLE, SURFACE, 120, 100, DFF_ACTIVATE_DORMANT_MONSTER,
    //  "the statue shatters!", 0, &darkGray, 3, 0, DF_RUBBLE}（:873）
    // —— STATUE_INSTACRACK.discoverType（15 号：护符被取走后雕像震裂，
    // 藏在其下的 Warden of Yendor 苏醒）。tile RUBBLE web 无（与
    // DF_WALL_SHATTER / DF_SHATTERING_SPELL 同缺，登记）；链尾 DF_RUBBLE
    // 已在目录（V-2b-3 引入），无悬空引用。
    [DF.DF_STATUE_SHATTER]: {
        id: DF.DF_STATUE_SHATTER, ceLine: 873, ceTile: 'RUBBLE', tile: null,
        layer: DungeonLayer.SURFACE, startProbability: 120, probabilityDecrement: 100,
        flags: DFF_ACTIVATE_DORMANT_MONSTER, cePropagationTerrain: '', propagationTerrain: null,
        subsequentDF: DF.DF_RUBBLE,
        description: 'the statue shatters!',
        lightFlare: '', flashColor: 'darkGray', effectRadius: 3,
    },
};

/** 登记"CE 有 tileType 而 web 没有地形"的目录条目 id 清单
 *  （新增地形轮次的输入；测试钉死，新地形落地后逐一翻正）。
 *  F-2a 翻正：DF_PLAIN_FIRE（PLAIN_FIRE 地形 F-1 已有）、DF_EMBERS /
 *  DF_ASH（EMBERS/ASH 地形本轮新增）摘除，11 → 9。
 *  G-1 增补：DF_GAS_FIRE（GAS_FIRE tile 未迁移）入列，9 → 10。
 *  G-2 翻正：DF_STEAM_ACCUMULATION / DF_METHANE_GAS_PUFF /
 *  DF_POISON_GAS_CLOUD / DF_GAS_FIRE 四条接线摘除（10 → 6）；
 *  增补 DF_EXPLOSION_FIRE（GAS_EXPLOSION tile 未迁移，登记 F-2c），
 *  6 → 7。F-2c 翻正：DF_EXPLOSION_FIRE（GAS_EXPLOSION 地形本轮新增）
 *  摘除、同轮接线的 DF_BLOAT_EXPLOSION 直接带完整 tile 入目录不入列，
 *  7 → 6。V-2b-2b 增补：DF_SHOW_TRAPDOOR（TRAP_DOOR tile web 无——
 *  23 号蓝图 TRAP_DOOR_HIDDEN 显形链的载体），6 → 7。
 *  V-2b-3 增补 11 条（8 → 19，见下方分节注）。V-2b-4 增补 7 条
 * （19 → 26，祭坛族轮八条新条目里无 web tile 的七条）。
 *  注：ROT_GAS / STENCH_SMOKE_GAS / PARALYSIS_GAS / DARKNESS_CLOUD /
 *  HEALING_CLOUD 的 DF（及 dewar×4、喷口、药水云等 24 条 GAS 目录的其余）
 *  本轮**未入目录**——载体盘点后无 web 载体的气体只登记不迁移（报告
 *  载体盘点表），故不在本清单。 */
export const DF_MISSING_TILES: readonly DF[] = [
    DF.DF_TRAMPLED_FOLIAGE,        // TRAMPLED_FOLIAGE
    DF.DF_ACTIVE_BRIMSTONE,        // ACTIVE_BRIMSTONE
    DF.DF_BRIMSTONE_FIRE,          // BRIMSTONE_FIRE
    DF.DF_OPEN_IRON_DOOR_INERT,    // OPEN_IRON_DOOR_INERT
    DF.DF_BRIDGE_FALL_PREP,        // BRIDGE_FALLING
    DF.DF_MACHINE_PRESSURE_PLATE_USED, // MACHINE_PRESSURE_PLATE_USED
    DF.DF_SHATTERING_SPELL,        // RUBBLE（B-3：crystalize 的碎石 tile，web 无）
    DF.DF_SHOW_TRAPDOOR,           // TRAP_DOOR（V-2b-2b：搜索显形族 tile，web 无
                                   // 该地形——显形链接线轮随新地形落地摘除）
    // ── V-2b-3 增补（11 条，8 → 19）：wired 载体 DF 链里 web 尚无 tile 的
    //    环节；链上 tile 已齐的三条（DF_SHOW_PARALYSIS_GAS_TRAP →
    //    GAS_TRAP_PARALYSIS、DF_VENT_SPEW_METHANE → METHANE_GAS、
    //    DF_PARALYSIS_VENT_SPEW → PARALYSIS_GAS）不入列。
    DF.DF_RUBBLE,                  // RUBBLE（同 DF_SHATTERING_SPELL 所缺）
    DF.DF_INACTIVE_GLYPH,          // MACHINE_GLYPH_INACTIVE（通电符文的变色体）
    DF.DF_REVEAL_LEVER,            // WALL_LEVER（显形后的带线墙杆——18 号激活
                                   // 链的载体，激活轮随新地形落地重核）
    DF.DF_MEDIUM_HOLE,             // TRAP_DOOR（同 DF_SHOW_TRAPDOOR 所缺）
    DF.DF_OPEN_PORTCULLIS,         // PORTCULLIS_DORMANT（闸门升起的落点）
    DF.DF_SHOW_METHANE_VENT,       // MACHINE_METHANE_VENT_DORMANT（显形体）
    DF.DF_METHANE_VENT_OPEN,       // MACHINE_METHANE_VENT（开启态喷口驻留体）
    DF.DF_PILOT_LIGHT,             // PILOT_LIGHT（火嘴落地的火把）
    DF.DF_DISCOVER_PARALYSIS_VENT, // MACHINE_PARALYSIS_VENT（显形体）
    DF.DF_REVEAL_PARALYSIS_VENT_SILENTLY, // MACHINE_PARALYSIS_VENT（同上）
    DF.DF_WALL_SHATTER,            // RUBBLE（同上；爆炸墙的波前落点）
    // ── V-2b-4 增补（7 条，19 → 26）：祭坛族轮的八条新目录条目里，web 尚无
    //    对应 tile 的七条；唯一带完整 tile 的是 DF_CAGE_DISAPPEARS
    //   （tile ALTAR_INERT = web 既有 TerrainType.ALTAR），故不入列。
    //    三条来自蓝图 feature 的 DF 列（6/7/15 号，web 的 FeatureDef 无 df
    //    列——V-2b-7 接上后应随蓝图数据自动入闭包并摘除），五条来自新地形
    //    三链字段。逐字段见 v_2b_4_altars.test.ts B 组。
    DF.DF_LUMINESCENT_FUNGUS,      // LUMINESCENT_FUNGUS（15 号 AMULET_SWITCH 的 DF 列）
    DF.DF_ITEM_CAGE_CLOSE,         // ALTAR_CAGE_CLOSED（笼子落下态，web 只迁开态）
    DF.DF_ALTAR_COMMUTE,           // COMMUTATION_ALTAR_INERT（置换完成后的惰性态）
    DF.DF_MAGIC_PIPING,            // PIPE_GLOWING（6 号 COMMUTATION_ALTAR 的 DF 列）
    DF.DF_ALTAR_RESURRECT,         // RESURRECTION_ALTAR_INERT（复活完成后的惰性态）
    DF.DF_MACHINE_FLOOR_TRIGGER_REPEATING, // MACHINE_TRIGGER_FLOOR_REPEATING
                                   // （7 号 RESURRECTION_ALTAR 的 DF 列）
    DF.DF_STATUE_SHATTER,          // RUBBLE（同 DF_WALL_SHATTER 所缺）
];
