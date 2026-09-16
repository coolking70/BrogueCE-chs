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
    DF_GAS_FIRE                    = 101, // :1593（G-1：气体 tile 的 fireType 引用它；
                                          // tile GAS_FIRE 已于 G-2 迁移接线）
    DF_EXPLOSION_FIRE              = 102, // :1594（G-2：METHANE_GAS.promoteType 引用它；
                                          // 载体 tile GAS_EXPLOSION 未迁移，登记 F-2c）
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
 * DF 目录（CE Globals.c:603-932 中本轮闭包涉及的条目；C-4b 19 条、
 * F-2a 增 DF_ASH 至 20、G-1 增 DF_GAS_FIRE 至 21、G-2 增 DF_EXPLOSION_FIRE
 * 至 22 并给 4 条 GAS 层 DF / 燃气火 DF 填上 tile）。
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
    // tile GAS_EXPLOSION 未迁移（爆炸地形归 F-2c），条目登记 tile=null、
    // 爆轰落地走 promoteTile 的整链缓办——届时填 tile 后爆炸圈自动成形。
    // start=60/decr=17 是 CE 原值的衰减扩散波前（c_4c C1 闸门：非 GAS
    // 扩散条目 probDec>0，本条 17 ✓）。
    [DF.DF_EXPLOSION_FIRE]: {
        id: DF.DF_EXPLOSION_FIRE, ceLine: 742, ceTile: 'GAS_EXPLOSION', tile: null,
        layer: DungeonLayer.SURFACE, startProbability: 60, probabilityDecrement: 17,
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
};

/** 登记"CE 有 tileType 而 web 没有地形"的目录条目 id 清单
 *  （新增地形轮次的输入；测试钉死，新地形落地后逐一翻正）。
 *  F-2a 翻正：DF_PLAIN_FIRE（PLAIN_FIRE 地形 F-1 已有）、DF_EMBERS /
 *  DF_ASH（EMBERS/ASH 地形本轮新增）摘除，11 → 9。
 *  G-1 增补：DF_GAS_FIRE（GAS_FIRE tile 未迁移）入列，9 → 10。
 *  G-2 翻正：DF_STEAM_ACCUMULATION / DF_METHANE_GAS_PUFF /
 *  DF_POISON_GAS_CLOUD / DF_GAS_FIRE 四条接线摘除（10 → 6）；
 *  增补 DF_EXPLOSION_FIRE（GAS_EXPLOSION tile 未迁移，登记 F-2c），
 *  6 → 7。注：ROT_GAS / STENCH_SMOKE_GAS / PARALYSIS_GAS / DARKNESS_CLOUD /
 *  HEALING_CLOUD 的 DF（及 dewar×4、喷口、药水云等 24 条 GAS 目录的其余）
 *  本轮**未入目录**——载体盘点后无 web 载体的气体只登记不迁移（报告
 *  载体盘点表），故不在本清单。 */
export const DF_MISSING_TILES: readonly DF[] = [
    DF.DF_EXPLOSION_FIRE,          // GAS_EXPLOSION（tile 未迁移，登记 F-2c）
    DF.DF_TRAMPLED_FOLIAGE,        // TRAMPLED_FOLIAGE
    DF.DF_ACTIVE_BRIMSTONE,        // ACTIVE_BRIMSTONE
    DF.DF_BRIMSTONE_FIRE,          // BRIMSTONE_FIRE
    DF.DF_OPEN_IRON_DOOR_INERT,    // OPEN_IRON_DOOR_INERT
    DF.DF_BRIDGE_FALL_PREP,        // BRIDGE_FALLING
    DF.DF_MACHINE_PRESSURE_PLATE_USED, // MACHINE_PRESSURE_PLATE_USED
];
