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
 *   EMBERS 的晋升目标 DF_ASH 的闭包要求。）
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
    DF_BRIMSTONE_FIRE              = 104, // :1596
    DF_BRIDGE_FIRE                 = 105, // :1597
    DF_EMBERS                      = 107, // :1599
    DF_OBSIDIAN                    = 109, // :1601
    DF_POISON_GAS_CLOUD            = 125, // :1620
    DF_MACHINE_PRESSURE_PLATE_USED = 154, // :1663
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
 * DF 目录（CE Globals.c:603-932 中本轮闭包涉及的 19 条）。
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

    // {STEAM, GAS, 15, 0, 0} —— 水上点火的水汽积聚（GAS 层 volume 特例）
    [DF.DF_STEAM_ACCUMULATION]: {
        id: DF.DF_STEAM_ACCUMULATION, ceLine: 666, ceTile: 'STEAM', tile: null,
        layer: DungeonLayer.GAS, startProbability: 15, probabilityDecrement: 0,
        flags: 0, cePropagationTerrain: '', propagationTerrain: null, subsequentDF: null,
        description: '', lightFlare: '', flashColor: '', effectRadius: 0,
    },

    // {METHANE_GAS, GAS, 2, 0, 0} —— 泥沼晋升的沼气一缕
    [DF.DF_METHANE_GAS_PUFF]: {
        id: DF.DF_METHANE_GAS_PUFF, ceLine: 667, ceTile: 'METHANE_GAS', tile: null,
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
    //（TRAP 的 T_IS_DF_TRAP fireType；GAS 层 volume 特例）
    [DF.DF_POISON_GAS_CLOUD]: {
        id: DF.DF_POISON_GAS_CLOUD, ceLine: 770, ceTile: 'POISON_GAS', tile: null,
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
};

/** 本轮登记"CE 有 tileType 而 web 没有地形"的目录条目 id 清单
 *  （新增地形轮次的输入；测试钉死，新地形落地后逐一翻正）。
 *  F-2a 翻正：DF_PLAIN_FIRE（PLAIN_FIRE 地形 F-1 已有）、DF_EMBERS /
 *  DF_ASH（EMBERS/ASH 地形本轮新增）摘除，11 → 9。 */
export const DF_MISSING_TILES: readonly DF[] = [
    DF.DF_STEAM_ACCUMULATION,      // STEAM
    DF.DF_METHANE_GAS_PUFF,        // METHANE_GAS
    DF.DF_POISON_GAS_CLOUD,        // POISON_GAS
    DF.DF_TRAMPLED_FOLIAGE,        // TRAMPLED_FOLIAGE
    DF.DF_ACTIVE_BRIMSTONE,        // ACTIVE_BRIMSTONE
    DF.DF_BRIMSTONE_FIRE,          // BRIMSTONE_FIRE
    DF.DF_OPEN_IRON_DOOR_INERT,    // OPEN_IRON_DOOR_INERT
    DF.DF_BRIDGE_FALL_PREP,        // BRIDGE_FALLING
    DF.DF_MACHINE_PRESSURE_PLATE_USED, // MACHINE_PRESSURE_PLATE_USED
];
