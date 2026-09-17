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
 *  7 → 6。注：ROT_GAS / STENCH_SMOKE_GAS / PARALYSIS_GAS / DARKNESS_CLOUD /
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
];
