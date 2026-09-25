/**
 * src/engine/Map/AutoGenerator.ts — CE runAutogenerators（C-6）
 *
 * CE 事实来源（BrogueCE-master/src/brogue/，只读）：
 * - `autoGenerator` 结构体：Rogue.h:2754-2772（terrain / layer / DFType /
 *   machine / requiredDungeonFoundationType / requiredLiquidFoundationType /
 *   minDepth / maxDepth / frequency / minNumberIntercept / minNumberSlope /
 *   maxNumber；minNumberIntercept/Slope 实为 ×100 的定点数）。
 * - 表本体：`Globals.c:50` 只有 `const autoGenerator *autoGeneratorCatalog`
 *   指针声明（variant-specific）。brogue 变体的实际表是
 *   **variants/GlobalsBrogue.c:111-171** `autoGeneratorCatalog_Brogue`（49 条），
 *   条目数在 GlobalsBrogue.c:1047 `numberAutogenerators`，指针赋值在
 *   GlobalsBrogue.c:1072（initializeBrogueVariant）。RapidBrogue/BulletBrogue
 *   各有自己的表（同构不同参）。
 * - 本体：Architect.c:1782-1860 `runAutogenerators(boolean buildAreaMachines)`。
 * - digDungeon 调用点：Architect.c:2933（false，fillLakes 之后 /
 *   removeDiagonalOpenings 之前）与 Architect.c:2952（true，addMachines 之后 /
 *   cleanUpLakeBoundaries 之前）。
 * - 落点原语：Architect.c:3822-3845 `randomMatchingLocation`（本轮恒以
 *   terrainType=-1 调用）。
 *
 * ★ CE 上游事实（授权反驳条款下的本轮发现）★
 *   CE 循环是 `for (AG=1; AG<numberAutogenerators; AG++)`——**从下标 1 起**。
 *   brogue 表下标 0（DF_GRANITE_COLUMN，GlobalsBrogue.c:114）因此**永不执行**；
 *   RapidBrogue/BulletBrogue 同病（表首同为真实条目、无占位）。全 CE 源码
 *   grep 确认 DF_GRANITE_COLUMN 无其他触发点。这是上游的结构性死条目——
 *   按 D1（一律按 CE），web 原样保留该条目为 `carrier: 'dead-index0'`、
 *   循环从 1 起。**激活轮注意：若未来上游修了，本表下标 0 要单独翻转。**
 *
 * 载体盘点（C-6 本轮裁决，逐条理由见各 entry 的 note；盘点规则见
 * SESSION_HANDOFF「这一轮做了会不会是空壳？」）：
 *   - 接（carrier 'wired'）：下标 3（DF_GRASS）、8（DF_FOLIAGE）——两者的
 *     DF tile（GRASS/FOLIAGE）web 已有，DF 目录条目 C-6 补齐，传播/优先级/
 *     连通性语义由 DungeonFeature.ts 的 C-4b 移植承载。
 *     T-1 增补：下标 1（DF_CRYSTAL_WALL，DF 条目本轮补齐）、
 *     33（直接铺 CRYSTAL_WALL 地形）——tile 均为 B-3 迁入的 CRYSTAL_WALL。
 *   - 不接：'no-tile'（CE tile web 无对应物，含全部陷阱 tile——web 的通用
 *     TRAP 是自创语义、不同源，不得冒充）；'no-machine'（历史登记；
 *     V-2b-9e-2 已接完本表 13 条 MT_*）；'c7-light'
 *    （DF_SUNLIGHT/DF_DARKNESS/TORCH_WALL 依赖光照目录，C-7 明确不做）；
 *     'dead-index0'（上游死条目，见上）。
 *   - 未接条目在循环里**先于任何 RNG 消耗**跳过：自动生成器是无条件掷骰的
 *     系统，先选点再发现"没有载体"就是 C-4c 硫矿式的空转链（每层白掷几百
 *     个随机数、什么也不产生）。
 */
import type { Pos } from '../../types';
import { rng } from '../Random';
import {
    DungeonLayer,
    DRAW_PRIORITY,
    Grid,
    TerrainType,
} from './Grid';
import { TERRAIN_FLAGS, T_OBSTRUCTS_ITEMS, T_PATHING_BLOCKER } from './TerrainCatalog';
import { DF } from './DungeonFeatureCatalog';
import {
    cellTerrainFlags,
    createSpawnMap,
    catalogFeature,
    levelIsDisconnectedWithBlockingMap,
    spawnDungeonFeature,
} from './DungeonFeature';

/** 未接条目的登记类别（测试把 wired 集合与全表钉死，见 c_6 测试）。 */
export type AutoGeneratorCarrier =
    | 'wired'        // C-6 已接：全链有载体
    | 'no-tile'      // CE 引用的 tile web 没有（登记；激活轮随新地形翻正）
    | 'no-machine'   // CE MT_* 机器 web 无对应物（登记）
    | 'c7-light'     // 依赖光照目录（C-7 明确不做）
    | 'dead-index0'; // CE 上游死条目：runAutogenerators 从下标 1 起，本条永不执行

/** CE `autoGenerator`（Rogue.h:2754-2772）的 web 投影。 */
export interface AutoGeneratorEntry {
    /** GlobalsBrogue.c 表行号（抄录出处）。 */
    readonly ceLine: number;
    /** CE 表下标（0..48；CE 循环从 1 起，0 是死条目）。 */
    readonly index: number;
    /** CE terrain 列的 web 对应地形；null = CE 有此 tile 而 web 没有（登记）。 */
    readonly terrain: TerrainType | null;
    /** CE terrain 目录名（'0' = 无）。 */
    readonly ceTerrain: string;
    /** CE layer 列（terrain 为 0 的条目 CE 存 0 = DUNGEON，照抄）。 */
    readonly layer: DungeonLayer;
    /** CE DFType 列：web DF 目录已抄录的成员；null = 未抄录（登记）。 */
    readonly df: import('./DungeonFeatureCatalog').DF | null;
    /** CE DFType 目录名（'0' = 无）。 */
    readonly ceDf: string;
    /** CE DF 枚举 id（Rogue.h:1469 起；激活轮对号用，0 = 无）。 */
    readonly ceDfId: number;
    /** CE machineTypes 数值（Rogue.h:2668 起）；0 = 无。 */
    readonly machine: number;
    /** CE machine 目录名（'0' = 无）。 */
    readonly ceMachine: string;
    /** CE requiredDungeonFoundationType（对 layers[DUNGEON] 的落点要求）。 */
    readonly requiredDungeonFoundationType: TerrainType;
    /** CE requiredLiquidFoundationType（对 layers[LIQUID] 的落点要求）。 */
    readonly requiredLiquidFoundationType: TerrainType;
    readonly minDepth: number;
    readonly maxDepth: number;
    /** 追加概率（rand_percent 的百分数；0 = 只用数量公式）。 */
    readonly frequency: number;
    /** ×100 定点截距。 */
    readonly minNumberIntercept: number;
    /** ×100 定点斜率。 */
    readonly minNumberSlope: number;
    readonly maxNumber: number;
    readonly carrier: AutoGeneratorCarrier;
    /** 裁决理由（报告载体盘点表的逐条依据）。 */
    readonly note: string;
}

// 便于书写：CE 表的 0（无）在 terrain/DF/machine 列一律落成显式字段值。
const DUNGEON = DungeonLayer.DUNGEON;
const FLOOR = TerrainType.FLOOR;
const NOTHING = TerrainType.NOTHING;

/** CE MT_* 数值（Rogue.h:2668-2753 逐个数出；激活轮须对 Rogue.h 重核）。 */
const MT = {
    MT_BLOODFLOWER_AREA: 58,
    MT_SHRINE_AREA: 59,
    MT_IDYLL_AREA: 60,
    MT_SWAMP_AREA: 61,
    MT_CAMP_AREA: 62,
    MT_REMNANT_AREA: 63,
    MT_DISMAL_AREA: 64,
    MT_BRIDGE_TURRET_AREA: 65,
    MT_LAKE_PATH_TURRET_AREA: 66,
    MT_PARALYSIS_TRAP_AREA: 67,
    MT_PARALYSIS_TRAP_HIDDEN_AREA: 68,
    MT_TRICK_STATUE_AREA: 69,
    MT_WORM_AREA: 70,
    MT_SENTINEL_AREA: 71,
} as const;

/**
 * brogue 变体自动生成器目录（GlobalsBrogue.c:114-170 逐行抄录；行号即
 * ceLine）。49 条，与 CE `numberAutogenerators` 一致。CE 位置初始化、
 * 尾部省略即 0——本表把省略显式写成零值（项目约定）。
 */
export const AUTO_GENERATOR_CATALOG: readonly AutoGeneratorEntry[] = [
    // ---- Ordinary features of the dungeon（GlobalsBrogue.c:113-127）----
    {
        ceLine: 114, index: 0, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: 'DF_GRANITE_COLUMN', ceDfId: 1, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 1, maxDepth: 40, frequency: 60, minNumberIntercept: 100, minNumberSlope: 0, maxNumber: 4,
        carrier: 'dead-index0',
        note: 'CE 循环从 AG=1 起，表首的 granite column 永不执行（三变体同病；DF_GRANITE_COLUMN 全源码无其他触发点）。按 CE 原样保留为死条目——接了它反而违背 CE。',
    },
    {
        ceLine: 115, index: 1, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: DF.DF_CRYSTAL_WALL, ceDf: 'DF_CRYSTAL_WALL', ceDfId: 2, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: TerrainType.WALL, requiredLiquidFoundationType: NOTHING,
        minDepth: 14, maxDepth: 40, frequency: 15, minNumberIntercept: -325, minNumberSlope: 25, maxNumber: 5,
        carrier: 'wired',
        note: 'T-1 接线：DF 落 CRYSTAL_WALL tile（Globals.c:607 {CRYSTAL_WALL, DUNGEON, 200, 50, DFF_CLEAR_OTHER_TERRAIN}）——tile B-3 迁入、DF 条目 T-1 补入目录，跨层清理语义 C-4b 已实现。',
    },
    {
        ceLine: 116, index: 2, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: 'DF_LUMINESCENT_FUNGUS', ceDfId: 3, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 7, maxDepth: 40, frequency: 15, minNumberIntercept: -300, minNumberSlope: 70, maxNumber: 14,
        carrier: 'no-tile',
        note: 'DF 落 LUMINESCENT_FUNGUS tile（Globals.c:608）——web 无该地形（发光菌类还牵光照，C-7 范围）。',
    },
    {
        ceLine: 117, index: 3, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: DF.DF_GRASS, ceDf: 'DF_GRASS', ceDfId: 4, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 0, maxDepth: 10, frequency: 0, minNumberIntercept: 1000, minNumberSlope: -80, maxNumber: 10,
        carrier: 'wired',
        note: 'DF_GRASS（Globals.c:609 {GRASS, SURFACE, 75, 5, DFF_BLOCKED_BY_OTHER_LAYERS}）——tile GRASS web 已有，DF 条目 C-6 补入目录。C-6 接入。',
    },
    {
        ceLine: 118, index: 4, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: 'DF_DEAD_GRASS', ceDfId: 5, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 4, maxDepth: 9, frequency: 0, minNumberIntercept: -200, minNumberSlope: 80, maxNumber: 10,
        carrier: 'no-tile',
        note: 'DF 落 DEAD_GRASS tile（Globals.c:610，还有 subsequentDF DF_DEAD_FOLIAGE）——web 无该地形。',
    },
    {
        ceLine: 119, index: 5, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: 'DF_DEAD_GRASS', ceDfId: 5, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 9, maxDepth: 14, frequency: 0, minNumberIntercept: 1200, minNumberSlope: -80, maxNumber: 10,
        carrier: 'no-tile',
        note: '同上（DEAD_GRASS 第二深度段）。',
    },
    {
        ceLine: 120, index: 6, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: 'DF_BONES', ceDfId: 6, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 12, maxDepth: 39, frequency: 30, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 4,
        carrier: 'no-tile',
        note: 'DF 落 BONES tile（Globals.c:611）——web 无该地形（纯 SURFACE 装饰）。',
    },
    {
        ceLine: 121, index: 7, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: 'DF_RUBBLE', ceDfId: 7, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 0, maxDepth: 39, frequency: 30, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 4,
        carrier: 'no-tile',
        note: 'DF 落 RUBBLE tile（Globals.c:612）——web 无该地形。',
    },
    {
        ceLine: 122, index: 8, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: DF.DF_FOLIAGE, ceDf: 'DF_FOLIAGE', ceDfId: 8, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 0, maxDepth: 8, frequency: 15, minNumberIntercept: 1000, minNumberSlope: -333, maxNumber: 10,
        carrier: 'wired',
        note: 'DF_FOLIAGE（Globals.c:613 {FOLIAGE, SURFACE, 100, 33, DFF_BLOCKED_BY_OTHER_LAYERS}）——tile FOLIAGE web 已有，DF 条目 C-6 补入目录。C-6 接入。',
    },
    {
        ceLine: 123, index: 9, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: 'DF_FUNGUS_FOREST', ceDfId: 9, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 13, maxDepth: 40, frequency: 30, minNumberIntercept: -600, minNumberSlope: 50, maxNumber: 12,
        carrier: 'no-tile',
        note: 'DF 落 FUNGUS_FOREST tile（Globals.c:614）——web 无该地形。',
    },
    {
        ceLine: 124, index: 10, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: 'DF_BUILD_ALGAE_WELL', ceDfId: 77, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: TerrainType.WATER_DEEP,
        minDepth: 10, maxDepth: 40, frequency: 50, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 2,
        carrier: 'no-tile',
        note: '藻井链（DEEP_WATER_ALGAE_WELL/ALGAE_1/ALGAE_2，Globals.c:712-714，带发光）——web 无全部三种 tile；光照部分属 C-7。',
    },
    {
        ceLine: 125, index: 11, terrain: null, ceTerrain: 'STATUE_INERT', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: TerrainType.WALL, requiredLiquidFoundationType: NOTHING,
        minDepth: 6, maxDepth: 39, frequency: 5, minNumberIntercept: -100, minNumberSlope: 35, maxNumber: 3,
        carrier: 'no-tile',
        note: '直接铺 STATUE_INERT 地形（墙基座）——web 无该地形。',
    },
    {
        ceLine: 126, index: 12, terrain: null, ceTerrain: 'STATUE_INERT', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 10, maxDepth: 39, frequency: 50, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 3,
        carrier: 'no-tile',
        note: '同上（地板基座段）。',
    },
    {
        ceLine: 127, index: 13, terrain: null, ceTerrain: 'TORCH_WALL', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: TerrainType.WALL, requiredLiquidFoundationType: NOTHING,
        minDepth: 6, maxDepth: 39, frequency: 5, minNumberIntercept: -200, minNumberSlope: 70, maxNumber: 12,
        carrier: 'c7-light',
        note: '直接铺 TORCH_WALL 地形——火把的光照是它的全部玩法语义，C-7 光照目录不做。',
    },
    // ---- Pre-revealed traps（GlobalsBrogue.c:129-136）----
    {
        ceLine: 130, index: 14, terrain: null, ceTerrain: 'GAS_TRAP_POISON', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 2, maxDepth: 4, frequency: 20, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 1,
        carrier: 'no-tile',
        note: 'CE 陷阱是独立 tile（T_IS_DF_TRAP + fireType/ discoverType 链，显隐两态）。web 的通用 TRAP+trapType 是自创语义（teleport 等 CE 无），不同源——不得冒充载体。激活轮需按 CE tile 目录逐个落地。',
    },
    {
        ceLine: 131, index: 15, terrain: null, ceTerrain: 'NET_TRAP', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 2, maxDepth: 5, frequency: 20, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 1,
        carrier: 'no-tile',
        note: '同上（NET_TRAP tile 无）。',
    },
    {
        ceLine: 132, index: 16, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_PARALYSIS_TRAP_AREA, ceMachine: 'MT_PARALYSIS_TRAP_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 2, maxDepth: 6, frequency: 20, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 1,
        carrier: 'wired',
        note: 'V-2b-9e-2：CE 67 区域蓝图由 buildAMachine 强制建造；frequency=0 保留，不进入抽签。',
    },
    {
        ceLine: 133, index: 17, terrain: null, ceTerrain: 'ALARM_TRAP', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 4, maxDepth: 7, frequency: 20, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 1,
        carrier: 'no-tile',
        note: 'ALARM_TRAP tile 无。',
    },
    {
        ceLine: 134, index: 18, terrain: null, ceTerrain: 'GAS_TRAP_CONFUSION', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 2, maxDepth: 10, frequency: 20, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 1,
        carrier: 'no-tile',
        note: 'GAS_TRAP_CONFUSION tile 无。',
    },
    {
        ceLine: 135, index: 19, terrain: null, ceTerrain: 'FLAMETHROWER', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 4, maxDepth: 12, frequency: 20, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 1,
        carrier: 'no-tile',
        note: 'FLAMETHROWER tile 无（火陷阱；火链本身 F/G 已收口，但 tile 不在）。',
    },
    {
        ceLine: 136, index: 20, terrain: null, ceTerrain: 'FLOOD_TRAP', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 10, maxDepth: 14, frequency: 20, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 1,
        carrier: 'no-tile',
        note: 'FLOOD_TRAP tile 无（灌水链 FLOOD_WATER_* 也无）。',
    },
    // ---- Hidden traps（GlobalsBrogue.c:138-151）----
    {
        ceLine: 139, index: 21, terrain: null, ceTerrain: 'GAS_TRAP_POISON_HIDDEN', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 5, maxDepth: 39, frequency: 20, minNumberIntercept: 100, minNumberSlope: 0, maxNumber: 3,
        carrier: 'no-tile',
        note: '隐藏态陷阱 tile（TM_IS_SECRET）无。',
    },
    {
        ceLine: 140, index: 22, terrain: null, ceTerrain: 'NET_TRAP_HIDDEN', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 6, maxDepth: 39, frequency: 20, minNumberIntercept: 100, minNumberSlope: 0, maxNumber: 3,
        carrier: 'no-tile',
        note: '同上。',
    },
    {
        ceLine: 141, index: 23, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_PARALYSIS_TRAP_HIDDEN_AREA, ceMachine: 'MT_PARALYSIS_TRAP_HIDDEN_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 7, maxDepth: 39, frequency: 20, minNumberIntercept: 100, minNumberSlope: 0, maxNumber: 3,
        carrier: 'wired',
        note: 'V-2b-9e-2：CE 68 区域蓝图由 buildAMachine 强制建造；frequency=0 保留，不进入抽签。',
    },
    {
        ceLine: 142, index: 24, terrain: null, ceTerrain: 'ALARM_TRAP_HIDDEN', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 8, maxDepth: 39, frequency: 20, minNumberIntercept: 100, minNumberSlope: 0, maxNumber: 2,
        carrier: 'no-tile',
        note: '隐藏态 tile 无。',
    },
    {
        ceLine: 143, index: 25, terrain: TerrainType.TRAP_DOOR_HIDDEN, ceTerrain: 'TRAP_DOOR_HIDDEN', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 9, maxDepth: 39, frequency: 20, minNumberIntercept: 100, minNumberSlope: 0, maxNumber: 2,
        carrier: 'wired',
        note: 'U17c: CE hidden trapdoor; search → DF_SHOW_TRAPDOOR and existing fall consumers.',
    },
    {
        ceLine: 144, index: 26, terrain: null, ceTerrain: 'GAS_TRAP_CONFUSION_HIDDEN', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 11, maxDepth: 39, frequency: 20, minNumberIntercept: 100, minNumberSlope: 0, maxNumber: 3,
        carrier: 'no-tile',
        note: '隐藏态 tile 无。',
    },
    {
        ceLine: 145, index: 27, terrain: null, ceTerrain: 'FLAMETHROWER_HIDDEN', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 13, maxDepth: 39, frequency: 20, minNumberIntercept: 100, minNumberSlope: 0, maxNumber: 3,
        carrier: 'no-tile',
        note: '隐藏态 tile 无。',
    },
    {
        ceLine: 146, index: 28, terrain: null, ceTerrain: 'FLOOD_TRAP_HIDDEN', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 15, maxDepth: 39, frequency: 20, minNumberIntercept: 100, minNumberSlope: 0, maxNumber: 3,
        carrier: 'no-tile',
        note: '隐藏态 tile 无。',
    },
    {
        ceLine: 147, index: 29, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_SWAMP_AREA, ceMachine: 'MT_SWAMP_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 1, maxDepth: 39, frequency: 30, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 2,
        carrier: 'wired',
        note: 'CE 机器（沼泽布景；web 有 BOG tile 但 MT_SWAMP_AREA 是整机蓝图，BlueprintEngine 不同源）。',
    },
    {
        ceLine: 148, index: 30, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: 'DF_SUNLIGHT', ceDfId: 11, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 0, maxDepth: 5, frequency: 15, minNumberIntercept: 500, minNumberSlope: -150, maxNumber: 10,
        carrier: 'c7-light',
        note: 'DF 落 SUNLIGHT_POOL（Globals.c:618 {SUNLIGHT_POOL, LIQUID, 65, 6}）——光斑液体，tile 无且光照属 C-7。',
    },
    {
        ceLine: 149, index: 31, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: 'DF_DARKNESS', ceDfId: 12, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 1, maxDepth: 15, frequency: 15, minNumberIntercept: 500, minNumberSlope: -50, maxNumber: 10,
        carrier: 'c7-light',
        note: 'DF 落 DARKNESS_PATCH（Globals.c:619）——同上，C-7。',
    },
    {
        ceLine: 150, index: 32, terrain: null, ceTerrain: 'STEAM_VENT', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 16, maxDepth: 39, frequency: 30, minNumberIntercept: 100, minNumberSlope: 0, maxNumber: 3,
        carrier: 'no-tile',
        note: 'STEAM_VENT tile 无（蒸汽孔洞周期喷汽；G 链气体机制已收口，但 tile 不在）。',
    },
    {
        ceLine: 151, index: 33, terrain: TerrainType.CRYSTAL_WALL, ceTerrain: 'CRYSTAL_WALL', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: TerrainType.WALL, requiredLiquidFoundationType: NOTHING,
        minDepth: 40, maxDepth: 40, frequency: 100, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 600,
        carrier: 'wired',
        note: 'T-1 接线：最深层直接铺 CRYSTAL_WALL 地形——tile B-3 迁入（TERRAIN_HOME_LAYER DUNGEON，Globals.c:338）。',
    },
    // ---- Dewars（GlobalsBrogue.c:153-157）----
    // 四条同构：铺 DEWAR_*_GAS 地形 + 同点 spawn DF_CARPET_AREA（地毯）。
    {
        ceLine: 154, index: 34, terrain: null, ceTerrain: 'DEWAR_CAUSTIC_GAS', layer: DUNGEON,
        df: null, ceDf: 'DF_CARPET_AREA', ceDfId: 76, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 8, maxDepth: 39, frequency: 2, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 2,
        carrier: 'no-tile',
        note: 'DEWAR_CAUSTIC_GAS tile 无（玻璃容器，promoteType DF_DEWAR_CAUSTIC 爆毒气）。气体机制 G 链已有，容器 tile 与 CARPET 地毯 tile 无。',
    },
    {
        ceLine: 155, index: 35, terrain: null, ceTerrain: 'DEWAR_CONFUSION_GAS', layer: DUNGEON,
        df: null, ceDf: 'DF_CARPET_AREA', ceDfId: 76, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 8, maxDepth: 39, frequency: 2, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 2,
        carrier: 'no-tile',
        note: '同上（混乱气 dewar）。',
    },
    {
        ceLine: 156, index: 36, terrain: null, ceTerrain: 'DEWAR_PARALYSIS_GAS', layer: DUNGEON,
        df: null, ceDf: 'DF_CARPET_AREA', ceDfId: 76, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 8, maxDepth: 39, frequency: 2, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 2,
        carrier: 'no-tile',
        note: '同上（麻痹气 dewar）。',
    },
    {
        ceLine: 157, index: 37, terrain: null, ceTerrain: 'DEWAR_METHANE_GAS', layer: DUNGEON,
        df: null, ceDf: 'DF_CARPET_AREA', ceDfId: 76, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 8, maxDepth: 39, frequency: 2, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 2,
        carrier: 'no-tile',
        note: '同上（甲烷 dewar）。',
    },
    // ---- Flavor machines（GlobalsBrogue.c:159-170）----
    {
        ceLine: 160, index: 38, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: 'DF_LUMINESCENT_FUNGUS', ceDfId: 3, machine: 0, ceMachine: '0',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 40, maxDepth: 40, frequency: 100, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 200,
        carrier: 'no-tile',
        note: '最深层菌类灯海（maxNumber 200）——tile 无，且光照属 C-7。',
    },
    {
        ceLine: 161, index: 39, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_BLOODFLOWER_AREA, ceMachine: 'MT_BLOODFLOWER_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 1, maxDepth: 30, frequency: 25, minNumberIntercept: 140, minNumberSlope: -10, maxNumber: 3,
        carrier: 'wired',
        note: 'CE 机器（血花圃）。',
    },
    {
        ceLine: 162, index: 40, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_SHRINE_AREA, ceMachine: 'MT_SHRINE_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 5, maxDepth: 26, frequency: 7, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 1,
        carrier: 'wired',
        note: 'CE 机器（神龛）。',
    },
    {
        ceLine: 163, index: 41, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_IDYLL_AREA, ceMachine: 'MT_IDYLL_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 1, maxDepth: 5, frequency: 15, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 1,
        carrier: 'wired',
        note: 'CE 机器（田园布景）。',
    },
    {
        ceLine: 164, index: 42, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_REMNANT_AREA, ceMachine: 'MT_REMNANT_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 10, maxDepth: 40, frequency: 15, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 2,
        carrier: 'wired',
        note: 'CE 机器（遗迹布景）。',
    },
    {
        ceLine: 165, index: 43, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_DISMAL_AREA, ceMachine: 'MT_DISMAL_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 7, maxDepth: 40, frequency: 12, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 5,
        carrier: 'wired',
        note: 'CE 机器（阴郁布景）。',
    },
    {
        ceLine: 166, index: 44, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_BRIDGE_TURRET_AREA, ceMachine: 'MT_BRIDGE_TURRET_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 5, maxDepth: 39, frequency: 6, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 2,
        carrier: 'wired',
        note: 'V-2b-9e-2：CE 65 区域蓝图由 buildAMachine 强制建造；frequency=0 保留，不进入抽签。',
    },
    {
        ceLine: 167, index: 45, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_LAKE_PATH_TURRET_AREA, ceMachine: 'MT_LAKE_PATH_TURRET_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 5, maxDepth: 39, frequency: 6, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 2,
        carrier: 'wired',
        note: 'V-2b-9e-2：CE 66 强制路径已接；U04 楼梯合同完成后恢复 autoGen，蓝图 frequency=0 保留（强制入口）。',
    },
    {
        ceLine: 168, index: 46, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_TRICK_STATUE_AREA, ceMachine: 'MT_TRICK_STATUE_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 6, maxDepth: 39, frequency: 15, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 3,
        carrier: 'wired',
        note: 'V-2b-9e-2：CE 69 区域蓝图由 buildAMachine 强制建造；frequency=0 保留，不进入抽签。',
    },
    {
        ceLine: 169, index: 47, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_SENTINEL_AREA, ceMachine: 'MT_SENTINEL_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 12, maxDepth: 39, frequency: 10, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 2,
        carrier: 'wired',
        note: 'CE 机器（守望者圣所外围）。',
    },
    {
        ceLine: 170, index: 48, terrain: null, ceTerrain: '0', layer: DUNGEON,
        df: null, ceDf: '0', ceDfId: 0, machine: MT.MT_WORM_AREA, ceMachine: 'MT_WORM_AREA',
        requiredDungeonFoundationType: FLOOR, requiredLiquidFoundationType: NOTHING,
        minDepth: 12, maxDepth: 39, frequency: 12, minNumberIntercept: 0, minNumberSlope: 0, maxNumber: 3,
        carrier: 'wired',
        note: 'V-2b-9e-2：CE 70 区域蓝图由 buildAMachine 强制建造；frequency=0 保留，不进入抽签。',
    },
];

/** 已接条目的表下标；V-2b-9e-2 包含全部 13 条 MT_*，见 c_6 目录守卫。 */
export const WIRED_AUTOGENERATOR_INDEXES: readonly number[] = AUTO_GENERATOR_CATALOG
    .filter(e => e.carrier === 'wired')
    .map(e => e.index);

/** U04 restores CE66 after final-layer stair placement and the CE retry loop.
 * Keep the registry for explicit future carrier retirement; no other pool changes. */
export const RETIRED_AUTOGENERATOR_MACHINES: ReadonlySet<number> = new Set();

// ---------------------------------------------------------------------------
// randomMatchingLocation（CE Architect.c:3822-3845，terrainType=-1 形态）
// ---------------------------------------------------------------------------

/**
 * CE randomMatchingLocation 的 terrainType=-1 形态（runAutogenerators 的
 * 唯一用法，Architect.c:1811）：拒绝采样至多 500 次，要求——
 *   1. layers[DUNGEON] == requiredDungeonFoundationType；
 *   2. layers[LIQUID] == requiredLiquidFoundationType（NOTHING=0 也是真约束：
 *      拒绝任何带液体的格，CE `liquidType >= 0` 对 0 成立）；
 *   3. 格无占用。CE 检查 HAS_PLAYER|HAS_MONSTER|HAS_STAIRS|HAS_ITEM|
 *      IS_IN_MACHINE 五个 pmap flags；这些在 CE 的 digDungeon 期恒空
 *      （生物/物品/楼梯都在 dig 之后落位），web 的生成期等价占用只有
 *      机器格（Cell.machineNumber），照此投影。
 *   4. 若 foundation tile 自身不带 T_OBSTRUCTS_ITEMS（如 FLOOR），则拒绝
 *      四层旗标并集带 T_OBSTRUCTS_ITEMS 的格（墙内不得长草）；foundation
 *      是 WALL 时该检查被 CE 的 `terrainType < 0 && !(...)` 跳过。
 * 返回 null = 500 次全败（CE 返回 false，调用方跳过本次实例）。
 * 注意 CE 的越界细节：第 500 次抽出的坐标即使合法也返回 false（do-while
 * 先自增再判断）——照抄，不要"修"。
 */
export function randomMatchingLocation(
    grid: Grid,
    requiredDungeonFoundationType: TerrainType,
    requiredLiquidFoundationType: TerrainType,
    // V-2b-9e：机器期的物品/怪物尚为指令，调用者提供占用投影。
    // acceptLastAttempt 对应 CE 区域调用忽略 false、继续用最后坐标；
    // autoGen 保持默认的 null 失败语义，旧调用的 RNG/结果不变。
    options: { isOccupied?: (x: number, y: number) => boolean; acceptLastAttempt?: boolean } = {}
): Pos | null {
    const foundationObstructsItems =
        (TERRAIN_FLAGS[requiredDungeonFoundationType].flags & T_OBSTRUCTS_ITEMS) !== 0;
    let failsafeCount = 0;
    let x = 0;
    let y = 0;
    do {
        failsafeCount++;
        x = rng.randRange(0, grid.width - 1);
        y = rng.randRange(0, grid.height - 1);
        const cell = grid.getCell(x, y)!;
        const rejected =
            cell.layers[DungeonLayer.DUNGEON] !== requiredDungeonFoundationType
            || cell.layers[DungeonLayer.LIQUID] !== requiredLiquidFoundationType
            || cell.machineNumber !== 0
            || (options.isOccupied?.(x, y) ?? false)
            || (!foundationObstructsItems
                && (cellTerrainFlags(grid, x, y) & T_OBSTRUCTS_ITEMS) !== 0);
        if (!rejected) break;
    } while (failsafeCount < 500);
    if (failsafeCount >= 500 && !options.acceptLastAttempt) {
        return null;
    }
    return { x, y };
}

// ---------------------------------------------------------------------------
// runAutogenerators（CE Architect.c:1782-1860）
// ---------------------------------------------------------------------------

/** 单条目实测统计（报告"实际生成数随深度分布"的数据来源）。 */
export interface AutoGeneratorEntryStat {
    /** CE 表下标。 */
    index: number;
    /** 数量公式 + frequency 追加后的应建数（可为负，CE 原样）。 */
    count: number;
    /** 实际落地数（DF succeeded 或 terrain 写入；选点失败不计）。 */
    built: number;
    /** 500 次选点全败的次数。 */
    locationMisses: number;
}

export interface AutoGeneratorRunStats {
    buildAreaMachines: boolean;
    depth: number;
    /** 仅含 count != 0 的条目（未接条目因先跳过而天然不在内）。 */
    entries: AutoGeneratorEntryStat[];
    totalBuilt: number;
}

/**
 * CE runAutogenerators 的逐行移植。CE 与 web 的两处结构差（均已登记）：
 *   1. 未接条目在**任何 RNG 消耗之前**跳过（CE 无此分支——CE 全表可用；
 *      这是载体盘点的落地形态，见文件头）。
 *   2. 机器条目无 buildAMachine 可调（web 无 CE 机器系统）：全表现在没有
 *      carrier='wired' 的机器条目，本函数里的机器分支只为表保真与测试
 *      合成目录而存在（真实目录下统计 machineAttempts 恒 0）。
 *
 * 调用位置（CE digDungeon Architect.c:2933/2952）：buildAreaMachines=false
 * 在 fillLakes 之后、removeDiagonalOpenings 之前；=true 在 addMachines 之后、
 * cleanUpLakeBoundaries 之前。web 的对应接线见 Generator/Architect.ts
 * （web 的湖泊清理/架桥因 Game.ts 禁改已前移，C-2 头注登记在案）。
 */
export function runAutogenerators(
    grid: Grid,
    depth: number,
    buildAreaMachines: boolean,
    catalog: readonly AutoGeneratorEntry[] = AUTO_GENERATOR_CATALOG,
    buildMachine?: (machine: number) => boolean
): AutoGeneratorRunStats {
    const stats: AutoGeneratorRunStats = {
        buildAreaMachines,
        depth,
        entries: [],
        totalBuilt: 0,
    };

    // CE `for (AG=1; AG<gameConst->numberAutogenerators; AG++)`——从 1 起，
    // 下标 0 是死条目（文件头 ★）。
    for (let ag = 1; ag < catalog.length; ag++) {
        const gen = catalog[ag]!;

        // CE `(gen->machine > 0 == buildAreaMachines)`：C 关系优先级高于相等，
        // 即两趟分流——false 趟跑非机器条目，true 趟只跑机器条目。
        if ((gen.machine > 0) !== buildAreaMachines) {
            continue;
        }

        // web 载体登记：未接条目先跳过（不得消耗 RNG 制造空转链）。
        if (gen.carrier !== 'wired' || RETIRED_AUTOGENERATOR_MACHINES.has(gen.machine)) {
            continue;
        }

        // CE：深度窗口含两端。
        if (depth < gen.minDepth || depth > gen.maxDepth) {
            continue;
        }

        // CE：`count = min((minNumberIntercept + depthLevel * minNumberSlope) / 100,
        // maxNumber)`——C 整数除法向零截断；count 可为负（CE 原样，负数即
        // for 循环不执行）。
        let count = Math.min(
            Math.trunc((gen.minNumberIntercept + depth * gen.minNumberSlope) / 100),
            gen.maxNumber
        );
        // CE：`while (rand_percent(frequency) && count < maxNumber) count++`——
        // 掷骰在前、封顶判断在后（每次迭代都掷一次骰，哪怕 count 已满）；
        // 不得改写成 if，也不得调换操作数顺序（RNG 消耗序随之改变）。
        while (rng.randPercent(gen.frequency) && count < gen.maxNumber) {
            count++;
        }

        const stat: AutoGeneratorEntryStat = {
            index: ag,
            count,
            built: 0,
            locationMisses: 0,
        };

        for (let i = 0; i < count; i++) {
            const loc = randomMatchingLocation(
                grid,
                gen.requiredDungeonFoundationType,
                gen.requiredLiquidFoundationType
            );
            if (loc) {
                let builtThisInstance = false;
                // CE：DF 无条件先落（spawnDungeonFeature(..., false, true)——
                // refreshCell=false 属游戏侧（web 签名无此参），abortIfBlocking=true）。
                if (gen.df !== null) {
                    const result = spawnDungeonFeature(grid, loc.x, loc.y, catalogFeature(gen.df), true, { refreshSideEffects: false });
                    if (result.succeeded) {
                        builtThisInstance = true;
                    }
                }
                // CE：terrain 分支——带 drawPriority 门槛与单格连通性否决。
                // T-1 激活记录：本分支此前是留形（真实目录无 wired terrain 条目），
                // T-1 接线 index 33 时已逐字符重核 CE Architect.c——drawPriority
                // 门槛（:1824-1825）、T_PATHING_BLOCKER 连通性否决（:1830-1831）、
                // `layers[gen->layer] = gen->terrain`（:1834）三段与本实现逐条一致。
                if (gen.terrain !== null) {
                    const cell = grid.getCell(loc.x, loc.y)!;
                    const currentTerrain = cell.layers[gen.layer]!;
                    if (DRAW_PRIORITY[currentTerrain] >= DRAW_PRIORITY[gen.terrain]) {
                        if (!((TERRAIN_FLAGS[gen.terrain].flags & T_PATHING_BLOCKER) !== 0)
                            || levelIsDisconnectedWithBlockingMap(
                                grid, singleCellBlockingMap(grid, loc), false) === 0) {
                            grid.setTerrainLayer(loc.x, loc.y, gen.layer, gen.terrain);
                            builtThisInstance = true;
                        }
                    }
                }
                if (builtThisInstance) {
                    stat.built++;
                }
            } else {
                stat.locationMisses++;
            }

            // CE：机器尝试在选点 if 之外（机器自找位置）。
            if (gen.machine > 0) {
                // CE：buildAMachine(gen->machine, -1, -1, 0, NULL, NULL, NULL)。
                if (buildMachine?.(gen.machine)) {
                    stat.built++;
                }
            }
        }
        if (count !== 0) {
            stats.entries.push(stat);
            stats.totalBuilt += stat.built;
        }
    }
    return stats;
}

/** CE `zeroOutGrid(grid); grid[x][y] = true;` 的等价物（单格阻断图）。 */
function singleCellBlockingMap(grid: Grid, loc: Pos): ReturnType<typeof createSpawnMap> {
    const m = createSpawnMap(grid);
    m[loc.y * grid.width + loc.x] = 1;
    return m;
}
