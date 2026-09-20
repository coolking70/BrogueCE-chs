/**
 * src/engine/Generator/BlueprintEngine.ts
 * Data-driven machine blueprint system.
 * Reads from blueprints.json and places machines in the dungeon.
 *
 * P1-33：机器选址对齐 CE——锁门/特征地形只落在"堵住后恰好封死一个死角"
 * 的割点上（CE buildAMachine 的 BP_ROOM 分支，Architect.c:1080-1095：
 * IS_GATE_SITE ∧ !IS_IN_MACHINE ∧ roomSize[0] ≤ chokeMap ≤ roomSize[1]），
 * 不再把 LOCKED_DOOR 放进任意连通块（旧 findSuitableRoom 的门可能卡在
 * 通往关卡其余部分的唯一通路上，切断下楼梯——P1-33 的病灶）。
 * 修复前基线（15 种子 × D1-D26）：1920 台机器、坏层 5 个。
 */

import { Grid, TerrainType, DungeonLayer, DCOLS, DROWS, type Cell } from '../Map/Grid';
import { analyzeChokeMap, analyzeLoopMap, CE_GATE_CANDIDATE_CAP, type ChokeAnalysis } from '../Map/LoopMap';
import { terrainAllowsMove, DIRS8 } from '../Map/Connectivity';
import { DijkstraMap, MAX_DISTANCE } from '../Map/Pathfinding';
import { allocShortGrid } from '../Map/SafetyMap';
// V-2b-2a：feature 落位资格判定（CE cellIsFeatureCandidate）所需的四组判据——
// 走廊计数、地形旗标位、四层旗标并集、阻断否决两口子（C-8 落地）。
import { passableArcCount } from '../Items/ItemSpawnHeatMap';
import {
    T_OBSTRUCTS_ITEMS,
    T_OBSTRUCTS_PASSABILITY,
    T_PATHING_BLOCKER,
    isPathingBlocker,
    TERRAIN_FLAGS,
    TM_IS_WIRED,
    TM_IS_CIRCUIT_BREAKER,
} from '../Map/TerrainCatalog';
import {
    cellTerrainFlags,
    cellTerrainMechFlags,
    createSpawnMap,
    levelIsDisconnectedOnMovementGraph,
    levelIsDisconnectedWithBlockingMap,
} from '../Map/DungeonFeature';
import { rng } from '../Random';
import type { Pos } from '../../types';
import blueprintData from '../../data/blueprints.json';

/** 格键（CE pmap 的 DCOLS×DROWS 线性下标；与 backupLevel/impregnableCells 同一口径）。 */
const cellKey = (x: number, y: number): number => y * DCOLS + x;

/**
 * V-2b-2a：Q 族物品资格旗标（CE Architect.c:1506-1509 的 generateItem 重掷
 * 条件）。随 MF_GENERATE_ITEM 指令下传；**消费点在 Game.spawnBlueprintItem
 * （物品实化处，Game.ts 不在本轮授权清单）**——CE 的「不合格即重掷、
 * failsafe 1000」过滤循环登记为边界外缺口（报告 §2）。
 */
const ITEM_QUALIFIER_FLAGS: readonly string[] = [
    'MF_NO_THROWING_WEAPONS',
    'MF_REQUIRE_GOOD_RUNIC',
    'MF_REQUIRE_HEAVY_WEAPON',
];

// ----- Type definitions -----

export interface FeatureDef {
    terrain?: string;
    /**
     * V-2b-2b：CE machineFeature.layer 列（Rogue.h:2699 一带——feature 地形
     * 写入的目标层，GlobalsBrogue.c 蓝图表第 3 列）。省略时走旧行为
     * （setTerrain 按地形归属层整格覆写）；给出时按 CE :1443
     * `pmap[featX][featY].layers[layer] = terrain` 做**纯层写入**——不清其他层
     * （3 号的 SURFACE 菌林因此与 DUNGEON 地毯同格共存，CE 字面行为）。
     */
    layer?: 'DUNGEON' | 'LIQUID' | 'GAS' | 'SURFACE';
    trapType?: string;
    itemCategory?: string;
    itemId?: string;
    monsterId?: string;
    hordeId?: string;
    instanceCount: [number, number];
    /**
     * V-1c：CE machineFeature.minimumInstanceCount（Rogue.h:2714 一带）的
     * web 载体——本 feature 实际落位实例数达不到它时整机失败回滚
     * （CE Architect.c:1676-1687）。V-2b-1 起全表显式化：有忠实 CE 对应物
     * 的 feature 按 CE minInsts 原值（逐条核对均恰等于 instanceCount[0]），
     * web 自创 feature 取 instanceCount[0] 并显式写出（隐式变显式，行为零变化）。
     */
    minimumInstanceCount?: number;
    personalSpace?: number;
    flags: string[];
    signText?: string;
}

export interface BlueprintDef {
    id: string;
    name: string;
    depthRange: [number, number];
    roomSize: [number, number];
    frequency: number;
    category: string;
    flags: string[];
    doorTerrain?: string;
    features: FeatureDef[];
}

/** Result of building a machine, consumed by Game.ts populateLevel */
export interface MachineResult {
    blueprintId: string;
    category: string;
    machineNumber: number;
    cells: Pos[];           // All cells belonging to this machine
    center: Pos;
    door: Pos | null;
    /** Items to spawn: { category, id?, pos }
     *  V-2b-2a：itemQualifiers = Q 族资格旗标（CE Architect.c:1506-1509），
     *  随 feature 下传；消费点 Game.spawnBlueprintItem（边界外，见头注）。 */
    itemSpawns: Array<{ category: string; id?: string; pos: Pos; isAltar?: boolean; itemQualifiers?: string[] }>;
    /** Monsters to spawn: { monsterId, pos, isAlly?, isCaged? } */
    monsterSpawns: Array<{ monsterId: string; pos: Pos; isAlly?: boolean; isCaged?: boolean }>;
    /** Whether a key is needed (for LOCKED_DOOR) */
    needsKey: boolean;
    /** Altar group ID if any */
    altarGroupId: number | null;
    /**
     * V-1c：递归子机器（MF_OUTSOURCE_ITEM_TO_MACHINE / MF_BUILD_VESTIBULE
     * 建立的领养/前厅机器）。CE 把子机器的产物并进父机器的 spawnedItems /
     * spawnedMonsters 缓冲（Architect.c:1555-1567），父机器失败时一并释放；
     * web 的等价物是把子 MachineResult 挂在这里——父机器 applyBlueprint 失败
     * 返回 null 时整个对象被丢弃，子机器不产生任何孤儿；成功时由
     * buildMachines 扁平化后交给 Game.populateLevel（钥匙/物品/怪物逐台消费）。
     */
    subMachines: MachineResult[];
}

// ----- Terrain string→enum map -----

/** V-2b-2b：FeatureDef.layer（CE machineFeature.layer 列）→ web 层枚举。 */
const FEATURE_LAYER_MAP: Record<string, DungeonLayer | undefined> = {
    DUNGEON: DungeonLayer.DUNGEON,
    LIQUID: DungeonLayer.LIQUID,
    GAS: DungeonLayer.GAS,
    SURFACE: DungeonLayer.SURFACE,
};

const TERRAIN_MAP: Record<string, TerrainType> = {
    FLOOR: TerrainType.FLOOR,
    WALL: TerrainType.WALL,
    GRANITE: TerrainType.GRANITE,
    DOOR: TerrainType.DOOR,
    OPEN_DOOR: TerrainType.OPEN_DOOR,
    WATER_SHALLOW: TerrainType.WATER_SHALLOW,
    WATER_DEEP: TerrainType.WATER_DEEP,
    CHASM: TerrainType.CHASM,
    LAVA: TerrainType.LAVA,
    GRASS: TerrainType.GRASS,
    FOLIAGE: TerrainType.FOLIAGE,
    BOG: TerrainType.BOG,
    CHARRED_FLOOR: TerrainType.CHARRED_FLOOR,
    SIGN: TerrainType.SIGN,
    TRAP: TerrainType.TRAP,
    PRESSURE_PLATE: TerrainType.PRESSURE_PLATE,
    ALTAR: TerrainType.ALTAR,
    LOCKED_DOOR: TerrainType.LOCKED_DOOR,
    WEB: TerrainType.WEB,
    BLOOD: TerrainType.BLOOD,
    MUD: TerrainType.MUD,
    // V-2b-2b：机器蓝图 3/4/5/19/20/23 号的地形载体。FUNGUS_FOREST 按任务书
    // §1 别名到 FOLIAGE（两者 flags/mechFlags 逐位一致，缺的只有 promote
    // 目标 DF_TRAMPLED_FUNGUS_FOREST 的专属载体与 FUNGUS_FOREST_LIGHT——
    // 任务书明示"可缺省"）。
    CARPET: TerrainType.CARPET,
    STATUE_INERT: TerrainType.STATUE_INERT,
    PEDESTAL: TerrainType.PEDESTAL,
    FUNGUS_FOREST: TerrainType.FOLIAGE,
    STATUE_INERT_DOORWAY: TerrainType.STATUE_INERT_DOORWAY,
    WOODEN_BARRICADE: TerrainType.WOODEN_BARRICADE,
    TRAP_DOOR_HIDDEN: TerrainType.TRAP_DOOR_HIDDEN,
    // V-2b-3：wired 触发网络的九个载体（18/22/24/25/67/68 号蓝图的通货）。
    MACHINE_GLYPH: TerrainType.MACHINE_GLYPH,
    PORTCULLIS_CLOSED: TerrainType.PORTCULLIS_CLOSED,
    WORM_TUNNEL_OUTER_WALL: TerrainType.WORM_TUNNEL_OUTER_WALL,
    WALL_LEVER_HIDDEN: TerrainType.WALL_LEVER_HIDDEN,
    GAS_TRAP_PARALYSIS: TerrainType.GAS_TRAP_PARALYSIS,
    GAS_TRAP_PARALYSIS_HIDDEN: TerrainType.GAS_TRAP_PARALYSIS_HIDDEN,
    MACHINE_PARALYSIS_VENT_HIDDEN: TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN,
    MACHINE_METHANE_VENT_HIDDEN: TerrainType.MACHINE_METHANE_VENT_HIDDEN,
    PILOT_LIGHT_DORMANT: TerrainType.PILOT_LIGHT_DORMANT,
    // CE MACHINE_PRESSURE_PLATE（Globals.c:402）→ web PRESSURE_PLATE 别名。
    // 逐字段比对（任务书 §7.3 交本轮裁定的那条）：CE 行 flags = T_IS_DF_TRAP；
    // mechFlags = VANISHES_UPON_PROMOTION | PROMOTES_ON_STEP | IS_WIRED |
    // LIST_IN_SIDEBAR | VISUALLY_DISTINCT；ign 0；fireType 0；discoverType 0；
    // promoteType DF_MACHINE_PRESSURE_PLATE_USED；promoteChance 0；
    // drawPriority 15。web PRESSURE_PLATE（TerrainCatalog.ts 该条）七字段
    // 逐一相等——作别名，不新增第二个枚举成员。
    MACHINE_PRESSURE_PLATE: TerrainType.PRESSURE_PLATE,
};

const TERRAIN_VISUALS: Record<string, { char: string; color: number }> = {
    GRASS: { char: '"', color: 0x33aa33 },
    FOLIAGE: { char: '♠', color: 0x228822 },
    BOG: { char: '~', color: 0x556633 },
    WATER_SHALLOW: { char: '~', color: 0x3366cc },
    WATER_DEEP: { char: '~', color: 0x1133aa },
    LAVA: { char: '~', color: 0xff4400 },
    WEB: { char: '\\', color: 0xcccccc },
    BLOOD: { char: '%', color: 0x880000 },
    MUD: { char: '~', color: 0x664422 },
    TRAP: { char: '^', color: 0x884400 },
    PRESSURE_PLATE: { char: '_', color: 0x446644 },
    SIGN: { char: '!', color: 0xddddaa },
    ALTAR: { char: 'A', color: 0xccccff },
    LOCKED_DOOR: { char: '+', color: 0xdd9933 },
    OPEN_DOOR: { char: "'", color: 0xaa8844 },
    // V-2b-2b：字形取 CE platformdependent.c 的 displayGlyph 映射
    //（G_CARPET '·'、G_BARRICADE '#'、G_STATUE/G_CRACKED_STATUE 'ß'、
    // G_PEDESTAL '|'、TRAP_DOOR_HIDDEN 用 G_FLOOR '.'——伪装成地板）；
    // 颜色取 CE 目录 foreColor 列的 0-100 值 ×2.55 折算（web 单色渲染，
    // CE 的 backColor 无载体）：CARPET fore {23,30,38}→0x3b4d61；STATUE 系
    // fore = wallBackColor（中灰）→0x6e6e6e；PEDESTAL fore = altarForeColor
    // →0xccccff；BARRICADE fore = doorForeColor {70,35,15}→0xb35926；
    // TRAP_DOOR_HIDDEN 沿用 web FLOOR 惯用 '.' + 0x888888（伪装口径）。
    CARPET: { char: '·', color: 0x3b4d61 },
    STATUE_INERT: { char: 'ß', color: 0x6e6e6e },
    PEDESTAL: { char: '|', color: 0xccccff },
    FUNGUS_FOREST: { char: '♠', color: 0x228822 },
    STATUE_INERT_DOORWAY: { char: 'ß', color: 0x6e6e6e },
    WOODEN_BARRICADE: { char: '#', color: 0xb35926 },
    TRAP_DOOR_HIDDEN: { char: '.', color: 0x888888 },
    // V-2b-3：字形照 platformdependent.c 的 displayGlyph（G_MAGIC_GLYPH
    // U_FOUR_DOTS 0x2237='∷'、G_TRAP U_DIAMOND 0x25c7='◊'、G_PORTCULLIS/
    // G_TORCH/G_WALL '#'）；颜色取 CE foreColor ×2.55：glyphColor {20,5,5}
    // →0x330d0d；gray→0x6e6e6e（同 STATUE 折算）；wallForeColor {7,7,7}
    // →0x121212；torchLightColor {75,38,15}→0xbf6126；GAS_TRAP_PARALYSIS 的
    // pink 取近似折算 0xdd66aa（CE pink 结构在变体色表，无精确源）；三个
    // G_FLOOR 伪装的隐藏态沿用 web 伪装口径 '.' + 0x888888。
    MACHINE_GLYPH: { char: '∷', color: 0x330d0d },
    PORTCULLIS_CLOSED: { char: '#', color: 0x6e6e6e },
    WORM_TUNNEL_OUTER_WALL: { char: '#', color: 0x121212 },
    WALL_LEVER_HIDDEN: { char: '#', color: 0x121212 },
    GAS_TRAP_PARALYSIS: { char: '◊', color: 0xdd66aa },
    GAS_TRAP_PARALYSIS_HIDDEN: { char: '.', color: 0x888888 },
    MACHINE_PARALYSIS_VENT_HIDDEN: { char: '.', color: 0x888888 },
    MACHINE_METHANE_VENT_HIDDEN: { char: '.', color: 0x888888 },
    PILOT_LIGHT_DORMANT: { char: '#', color: 0xbf6126 },
};

// ----- Engine -----

let nextMachineNumber = 1;

/**
 * V-1c：跨层奖励房配额计数器。CE rogue.rewardRoomsGenerated（Rogue.h:2504
 * "// to meter the number of reward machines"）：开局清零（RogueMain.c:292）、
 * 每建成一台奖励机器 +1（Architect.c:1772）、配额公式按它抑制后续层数量。
 * 它是 **run 级全局**而非每层状态——web 侧必须进存档快照（Game.toSnapshot /
 * loadSnapshot），否则读档后配额重新计数、奖励房再次泛滥。
 */
let rewardRoomsGenerated = 0;

/** CE RogueMain.c:292 `rogue.rewardRoomsGenerated = 0`（开局清零）。 */
export function resetRewardRoomsGenerated(): void {
    rewardRoomsGenerated = 0;
}

/** 存档快照读口（Game.toSnapshot）。 */
export function getRewardRoomsGenerated(): number {
    return rewardRoomsGenerated;
}

/** 存档恢复写口（Game.loadSnapshot）。 */
export function setRewardRoomsGenerated(n: number): void {
    rewardRoomsGenerated = n;
}

// ---------------------------------------------------------------------------
// V-1c：抽签资格过滤与顶层配额（CE blueprintQualifies / addMachines）
// ---------------------------------------------------------------------------

/** CE variants/GlobalsBrogue.c:1026-1029（Brogue 变体常量，已逐字核对）。 */
const MACHINES_PER_LEVEL_SUPPRESSION_MULTIPLIER = 4;
const MACHINES_PER_LEVEL_SUPPRESSION_OFFSET = 2;
const MACHINES_PER_LEVEL_INCREASE_FACTOR = 1;
const MAX_LEVEL_FOR_BONUS_MACHINES = 2;
/** CE GlobalsBrogue.c:1030 `.deepestLevelForMachines = AMULET_LEVEL`。 */
const DEEPEST_LEVEL_FOR_MACHINES = 26;

export const BP_ADOPT_ITEM = 'BP_ADOPT_ITEM';
export const BP_VESTIBULE = 'BP_VESTIBULE';
export const BP_REWARD = 'BP_REWARD';
// V-2b-2b：蓝图级内部改造旗标（CE Rogue.h:2640-2654 的 Fl(2)/Fl(4)/Fl(5)/
// Fl(6)/Fl(8)/Fl(13)；消费点 = applyBlueprint 开头的 prepareInterior 段与
// 尾部的 NO_INTERIOR_FLAG 段， Architect.c:858-945 / :1691-1702）。
// BP_MAXIMIZE_INTERIOR / BP_REDESIGN_INTERIOR 本轮不做（任务书 §2/§7）。
export const BP_OPEN_INTERIOR = 'BP_OPEN_INTERIOR';
export const BP_PURGE_PATHING_BLOCKERS = 'BP_PURGE_PATHING_BLOCKERS';
export const BP_PURGE_LIQUIDS = 'BP_PURGE_LIQUIDS';
export const BP_SURROUND_WITH_WALLS = 'BP_SURROUND_WITH_WALLS';
export const BP_IMPREGNABLE = 'BP_IMPREGNABLE';
export const BP_NO_INTERIOR_FLAG = 'BP_NO_INTERIOR_FLAG';

/** V-1c：findGateRoom 的三态结果（见该方法头注）。 */
type GateSelection =
    | { kind: 'room'; cells: Pos[]; center: Pos; door: Pos }
    | { kind: 'noCandidates' }
    | { kind: 'retry' };

/** V-1c：整层可变格状态快照（CE p->levelBackup 的 web 形态，见 backupLevel）。
 *  V-2b-2a：随层快照扩展到 IMPREGNABLE 格集（CE 的 copyMap 连 pmap.flags
 *  一起备份/恢复，Architect.c:1222/:1578/:1681）。 */
type LevelBackup = {
    cells: Array<{
        layers: TerrainType[]; char: string; color: number;
        isPassable: boolean; isOpaque: boolean;
        machineNumber: number; trapType: Cell['trapType']; altarGroupId: number | null;
    }>;
    impregnable: number[];
};

/**
 * web `category` 字段 ↔ CE BP_* 旗标的映射（本轮开始消费 category——
 * V-0 查明它此前无任何生产消费者）。
 *
 * 对应关系核对（CE blueprintCatalog_Brogue，variants/GlobalsBrogue.c）：
 *   - CE 前厅机器带 BP_VESTIBULE（:299 一带 9 条），只能由 MF_BUILD_VESTIBULE
 *     递归建立 → web category "vestibule"；
 *   - CE 领养/守卫机器带 BP_ADOPT_ITEM（:348 一带 16 条），只能由
 *     MF_OUTSOURCE_ITEM_TO_MACHINE 递归建立 → web category "key_guard"；
 *   - CE 奖励机器带 BP_REWARD（:214 一带），顶层配额抽签的
 *     requiredMachineFlags 就是它 → web category "reward"（web 数据里
 *     5 条 reward_* 蓝图的 flags 数组也确实带着 BP_REWARD 字符串）；
 *   - CE 无 "thematic" 对应位：CE 的风味机器走 autoGeneratorCatalog 的
 *     MT_* 条目（如 MT_SWAMP_AREA），与顶层抽签完全无关——web 的
 *     area_* 蓝图是该机制的 web 自创替身，映射为空集（无资格位），
 *     因此它们不再被顶层抽中（D2：自创内容退池留形）。
 */
const CATEGORY_TO_BP_FLAGS: Record<string, readonly string[]> = {
    reward: [BP_REWARD],
    vestibule: [BP_VESTIBULE],
    key_guard: [BP_ADOPT_ITEM],
    thematic: [],
};

/** 蓝图的有效 BP 旗标集 = flags 数组 ∪ category 映射。 */
function effectiveBpFlags(bp: BlueprintDef): Set<string> {
    // V-2a：blueprints.json 是静态数据，派生集合按蓝图对象缓存。D2 型
    // 空转层（如 seed100/D2）会把 chooseBP 烧 37 万次 × 20 蓝图 × 每次
    // new Set —— 纯派生数据的 WeakMap 缓存不触及任何 RNG/选址语义。
    let s = EFFECTIVE_BP_FLAGS_CACHE.get(bp);
    if (!s) {
        s = new Set(bp.flags);
        for (const f of CATEGORY_TO_BP_FLAGS[bp.category] ?? []) s.add(f);
        EFFECTIVE_BP_FLAGS_CACHE.set(bp, s);
    }
    return s;
}

const EFFECTIVE_BP_FLAGS_CACHE = new WeakMap<BlueprintDef, Set<string>>();

/**
 * V-1c：CE blueprintQualifies（Architect.c:455-468）的直译。
 * requiredFlags 是 CE requiredMachineFlags 位串的 web 形态（字符串数组）：
 *   - 深度区间必须覆盖当前层；
 *   - 蓝图必须拥有全部被要求的旗标（CE `~flags & required`）；
 *   - BP_ADOPT_ITEM / BP_VESTIBULE **只有在被显式要求时**才可被选中
 *     （CE 的两条 NOT-unless-required 守卫）——所以顶层抽签（只要求
 *     BP_REWARD）永远抽不到前厅/守卫蓝图，它们只能由递归建立。
 */
export function blueprintQualifies(
    bp: BlueprintDef,
    depth: number,
    requiredFlags: readonly string[]
): boolean {
    if (bp.depthRange[0] > depth || bp.depthRange[1] < depth) return false;
    const eff = effectiveBpFlags(bp);
    for (const r of requiredFlags) {
        if (!eff.has(r)) return false;
    }
    if (eff.has(BP_ADOPT_ITEM) && !requiredFlags.includes(BP_ADOPT_ITEM)) return false;
    if (eff.has(BP_VESTIBULE) && !requiredFlags.includes(BP_VESTIBULE)) return false;
    return true;
}

export class BlueprintEngine {
    private grid: Grid;
    private depth: number;
    private blueprints: BlueprintDef[];
    /**
     * V-2a：findGateRoom 的 chokeMap 分析缓存。web 的 analyzeChokeMap 每次
     * 全图重算，而机器建造的失败重试（failsafe 10 × 递归 10 × 顶层 50）在
     * 失败路径上网格恒被 restoreLevel 恢复到与上次分析一致的状态——CE 的
     * 对应物（Architect.c:1063-1101 的 chokeMap/gateCandidates）本就是
     * 每层预计算的缓存，这里补齐同等粒度：失败重试共享一份分析，只在
     * 机器建成（网格真变异）后失效。语义零变化，纯性能（seed31337/D2
     * 实测 554s → 消除嵌套重试的 10×10 倍全图重算）。
     */
    private gateAnalysisCache: ChokeAnalysis | null = null;
    /**
     * V-2a：findGateRoom 的门位候选列表缓存（键 = roomSize 区间）。CE 的
     * gateCandidates[50]（Architect.c:1063-1101）同样只在网格变异后重收集。
     * 候选集为空时（如 D2 型层：唯一深度合格的守卫蓝图在本层无割点），
     * 失败重试的每次全图光栅扫描都是确定性空转——seed100/D2 实测 40 万次
     * 领养调用全数空转。缓存后 RNG 消耗逐位不变（候选列表内容相同、
     * randRange 照常掷骰），失效时机与 gateAnalysisCache 一致。
     */
    private gateCandidatesCache: Map<string, Pos[]> = new Map();
    /**
     * V-2b-2a：MF_IMPREGNABLE（CE Architect.c:1491-1493 `pmap.flags |=
     * IMPREGNABLE`）的 web 载体。CE 的位住在 pmap.flags 上、随整图备份/回滚
     * （copyMap）；web 的 Cell（Grid.ts，不在本轮授权清单）无该位，以引擎级
     * 格键集合承载，随 backupLevel/restoreLevel 一同快照回滚，语义等价。
     * **读口：isImpregnable(x,y)。现有唯一潜在消费者是 crystalizeFromPlayer
     * （Game.ts:4918 的 IMPREGNABLE 守卫，web 无隧道怪/挖墙攻击，此前登记
     * "该位恒 0"）——接线归隧道轮；本轮交付置位/回滚/读口。**
     */
    private impregnableCells: Set<number> = new Set();
    /**
     * V-2b-2a：CE 的 IN_LOOP（pmap 旗标，analyzeMap 于建层时预计算、机器
     * 阶段按陈旧快照消费——CE 不在机器建造中重算）。web 以 analyzeLoopMap
     * （C-0 的 CE 口径移植）懒算一份快照，失效点与 gateAnalysisCache 相同
     * （机器建成 / 失败回滚）。唯一消费者：cellIsFeatureCandidate 第 6 步的
     * MF_BUILD_ANYWHERE_ON_LEVEL+MF_GENERATE_ITEM 排除（零载体旗标）。
     */
    private loopMapCache: boolean[][] | null = null;

    constructor(grid: Grid, depth: number, blueprints?: BlueprintDef[]) {
        this.grid = grid;
        this.depth = depth;
        this.blueprints = blueprints ?? (blueprintData as BlueprintDef[]);
    }

    /**
     * Main entry point: build all machines for the current level.
     * Returns an array of MachineResult for Game.ts to populate with items/monsters.
     *
     * V-1c：本方法改为 CE addMachines（Architect.c:1742-1776）的直译——
     * 顶层只建奖励机器（requiredMachineFlags = BP_REWARD 的抽签），数量由
     * 跨层配额公式给出（"约每 4 层 1 间" + 前 2 层 40% 加成），不再是 web
     * 自创的每层 min(2+⌊depth/3⌋, 6) 台全类别同池抽。CE 的另两个顶层调用
     * ——Bullet Brogue 的 L1 兵器库与 D26 的 MT_AMULET_AREA——在 web 数据
     * 无对应蓝图（D2 退池留形，归 V-2 数据轮）。
     *
     * P1-33 选址合同不变：每次建造尝试仍走 findGateRoom 的 chokepoint 门位
     * （CE Architect.c:1080-1095）+ gateSealsOnlyInterior 误封否决。
     */
    public buildMachines(): MachineResult[] {
        // 奖励房配额（CE Architect.c:1757-1766）：
        //   保底 while——"try to build at least one every four levels on average"；
        //   加成 while——前 2 层且一间未建时 40%，此后固定 15%，逐次掷骰累加。
        let machineCount = 0;
        while (this.depth <= DEEPEST_LEVEL_FOR_MACHINES
            && (rewardRoomsGenerated + machineCount) * MACHINES_PER_LEVEL_SUPPRESSION_MULTIPLIER
            + MACHINES_PER_LEVEL_SUPPRESSION_OFFSET
            < this.depth * MACHINES_PER_LEVEL_INCREASE_FACTOR) {
            machineCount++;
        }
        let randomMachineFactor = (this.depth <= MAX_LEVEL_FOR_BONUS_MACHINES
            && (rewardRoomsGenerated + machineCount) === 0 ? 40 : 15);
        while (rng.randPercent(Math.max(randomMachineFactor, 15 * MACHINES_PER_LEVEL_INCREASE_FACTOR))
            && machineCount < 100) {
            randomMachineFactor = 15;
            machineCount++;
        }

        const results: MachineResult[] = [];
        // CE Architect.c:1768-1775：failsafe 50 次抽签建造，建成才核销配额。
        // 子机器深扁平化输出（CE 把子孙机器的产物逐级并入顶层缓冲——
        // :1555-1567 的合并是递归生效的：子机器的 spawnedItems 已含其
        // 自己的子机器产物；web 用深展开等价）。
        const flatten = (r: MachineResult): MachineResult[] =>
            [r, ...r.subMachines.flatMap(flatten)];
        for (let failsafe = 50; machineCount > 0 && failsafe > 0; failsafe--) {
            const built = this.buildAMachine([BP_REWARD], null, null);
            if (built) {
                machineCount--;
                rewardRoomsGenerated++;
                results.push(...flatten(built));
            }
        }
        return results;
    }

    /**
     * V-1c：CE buildAMachine（Architect.c:984-1734）的 web 形态。
     *
     * @param requiredFlags CE requiredMachineFlags（web 字符串数组形态）；
     *                      顶层配额传 [BP_REWARD]，递归领养/前厅各传其位。
     * @param adoptiveItem  待领养物品指令（CE adoptiveItem，仅递归领养非 null）。
     * @param origin        前厅机器的落位锚点（CE originX/Y，门位坐标）。
     * @returns 建成的父机器（子机器挂 subMachines）；失败返回 null（已回滚）。
     *
     * 循环结构逐字对齐 CE 的 do-while：failsafe 初值 10、先减后判（至多 9 次
     * 尝试）；每次尝试重掷蓝图（chooseBP）；BP_ROOM 无合格门位 → 立即放弃
     * （CE :1108-1122，不烧剩余 failsafe）；内部扩展失败/门位误封 → tryAgain
     * 换蓝图重来（CE :1099 与 P1-33 的 web 必要守卫）。**point of no return**
     * 在选址成功之后（CE :1222 copyMap(pmap, levelBackup)）：此后任何失败
     * （递归子机器 10 次全败、feature 实例数不达 minimumInstanceCount）都
     * 恢复备份并返回 null（CE :1576-1583 / :1676-1687）。
     */
    private buildAMachine(
        requiredFlags: readonly string[],
        adoptiveItem: MachineResult['itemSpawns'][number] | null,
        origin: Pos | null
    ): MachineResult | null {
        let failsafe = 10;
        do {
            failsafe--;
            if (failsafe <= 0) return null; // CE :1004-1026：10 次尝试用尽

            // chooseBP（CE :1028-1061）：资格过滤 + 频率加权抽签，每次尝试重掷。
            const eligible = this.blueprints.filter(bp => blueprintQualifies(bp, this.depth, requiredFlags));
            let totalFreq = 0;
            for (const bp of eligible) totalFreq += bp.frequency;
            if (totalFreq <= 0) return null; // CE :1040-1052：目录里没有合格蓝图

            let roll = rng.randRange(1, totalFreq);
            let bp = eligible[eligible.length - 1]!;
            for (const b of eligible) {
                roll -= b.frequency;
                if (roll <= 0) { bp = b; break; }
            }

            const effFlags = effectiveBpFlags(bp);
            let room: { cells: Pos[]; center: Pos; door: Pos | null };
            if (effFlags.has(BP_VESTIBULE)) {
                // CE :1120-1140：前厅机器必须有传入落位，填充失败立即放弃整机
                //（不设 tryAgain——CE 字面行为）。origin 的 ≤0 哨位判定同
                // CE :988 chooseLocation 的字面口径。
                if (!origin || origin.x <= 0 || origin.y <= 0) return null;
                const interior = this.fillVestibuleInterior(bp, origin);
                if (!interior) return null;
                room = { cells: interior, center: origin, door: origin };
            } else {
                // BP_ROOM（web 全部非前厅蓝图的形态，CE :1080-1118）。
                // retry 即 CE 的 tryAgain：continue 回到 do 顶（failsafe 先减，
                // 与 CE while(tryAgain) 的迭代语义逐字一致）换蓝图重试。
                const analysis = this.getGateAnalysis();
                const sel = this.findGateRoom(bp, analysis);
                if (sel.kind === 'retry') continue;
                if (sel.kind === 'noCandidates') return null;
                room = { cells: sel.cells, center: sel.center, door: sel.door };
            }

            // —— point of no return（CE :1222）：备份整层，动手。 ——
            const backup = this.backupLevel();
            const result = this.applyBlueprint(bp, room, { adoptiveItem });
            if (result) return result;
            this.restoreLevel(backup); // CE :1578/:1681 copyMap(p->levelBackup, pmap)
        } while (true);
    }

    /**
     * 锁门验证（P1-33，web 侧必要、CE 无对应步骤）：假想把门格堵上
     * （8 向泛洪绕开门格），若泛洪未达的可走格里还有"不属于本机器内部、
     * 也不属于既有机器"的格子，说明这把锁会夹带封死别处（8 向移动下
     * 割点覆盖不了的夹带口袋——seed31337/D12 的坏层成因），否决该门位。
     * 语义与 P1-29 湖泊闸门一致：放置前证明不切断。泛洪自然穿过未上锁
     * 的既有机器（普通地板可走）；既有锁门机器内部不可达但其格
     * machineNumber≠0，豁免。
     */
    private gateSealsOnlyInterior(gate: Pos, interiorCells: Pos[]): boolean {
        const interior = new Set(interiorCells.map(p => p.y * DCOLS + p.x));
        const walkable = (x: number, y: number): boolean => {
            const cell = this.grid.getCell(x, y);
            return !!cell && terrainAllowsMove(cell.terrain);
        };

        // 种子：门外第一个可走、非机器、非本机器内部的格
        let seed = -1;
        outer:
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                if (x === gate.x && y === gate.y) continue;
                if (interior.has(y * DCOLS + x)) continue;
                if ((this.grid.getCell(x, y)?.machineNumber ?? 0) !== 0) continue;
                if (walkable(x, y)) {
                    seed = y * DCOLS + x;
                    break outer;
                }
            }
        }
        if (seed < 0) return false; // 找不到门外世界，无法验证 → 拒绝

        const seen = new Set<number>([seed]);
        const stack: number[] = [seed];
        while (stack.length > 0) {
            const k = stack.pop()!;
            const x = k % DCOLS, y = Math.floor(k / DCOLS);
            for (const [dx, dy] of DIRS8) {
                const nx = x + dx!, ny = y + dy!;
                if (nx < 0 || nx >= DCOLS || ny < 0 || ny >= DROWS) continue;
                if (nx === gate.x && ny === gate.y) continue; // 假想堵门
                const nk = ny * DCOLS + nx;
                if (seen.has(nk) || !walkable(nx, ny)) continue;
                seen.add(nk);
                stack.push(nk);
            }
        }

        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const k = y * DCOLS + x;
                if (seen.has(k) || interior.has(k)) continue;
                if ((this.grid.getCell(x, y)?.machineNumber ?? 0) !== 0) continue;
                if (walkable(x, y)) return false; // 会被这把锁误封的格子
            }
        }
        return true;
    }

    /**
     * P1-33：CE buildAMachine BP_ROOM 分支（Architect.c:1080-1147）的选址。
     * 候选门 = IS_GATE_SITE ∧ 未属机器 ∧ chokeMap ∈ 蓝图 roomSize 区间
     * （即"堵住这格只封死一个 roomSize 大小的死角"），光栅序收集、上限
     * CE_GATE_CANDIDATE_CAP（CE gateCandidates[50]），随机取一为门（gate），
     * 再从门出发把内部按 chokeMap 扩展出来（CE addTileToMachineInteriorAndIterate）。
     * 返回 cells=内部、door=门格、center=宝藏落点（内部中距质心最近且非门格）。
     * 无候选或内部扩展撞上其他机器 → null（CE 返回 false 换蓝图重试）。
     */
    /**
     * V-1c：选址结果三分（对应 CE buildAMachine 的三种走向）：
     *   room         — 选址成功，可以动手（过了 point of no return 的门槛）；
     *   noCandidates — 无合格门位，立即放弃整机（CE :1108-1122 return false，
     *                  不烧剩余 failsafe）；
     *   retry        — 内部扩展失败（CE addTileToMachineInteriorAndIterate
     *                  false → tryAgain）或 web 必要的误封否决拦截（P1-33），
     *                  换蓝图重试。
     */
    private findGateRoom(
        bp: BlueprintDef,
        analysis: ChokeAnalysis
    ): GateSelection {
        // V-2a：候选列表缓存（gateCandidatesCache 头注）——键为 roomSize
        // 区间；缓存生命周期内无机器建成，machineNumber 过滤结果不变。
        const candKey = `${bp.roomSize[0]}-${bp.roomSize[1]}`;
        let candidates = this.gateCandidatesCache.get(candKey);
        if (!candidates) {
            candidates = [];
            for (let x = 0; x < DCOLS && candidates.length < CE_GATE_CANDIDATE_CAP; x++) {
                for (let y = 0; y < DROWS && candidates.length < CE_GATE_CANDIDATE_CAP; y++) {
                    if (!analysis.gateSite[x]![y]) continue;
                    if ((this.grid.getCell(x, y)?.machineNumber ?? 0) !== 0) continue; // CE !IS_IN_MACHINE
                    const choke = analysis.chokeMap[x]![y]!;
                    if (choke < bp.roomSize[0] || choke > bp.roomSize[1]) continue;
                    candidates.push({ x, y });
                }
            }
            this.gateCandidatesCache.set(candKey, candidates);
        }
        if (candidates.length === 0) return { kind: 'noCandidates' }; // CE 1108-1122：无合格门位，放弃该蓝图

        const gate = candidates[rng.randRange(0, candidates.length - 1)]!;
        const cells = mapMachineInterior(this.grid, analysis, gate);
        if (!cells) return { kind: 'retry' };
        if (!this.gateSealsOnlyInterior(gate, cells)) return { kind: 'retry' }; // 会误封别处 → 弃用该门位

        // center：内部格中距质心最近者，排除门格（门格可能被 doorTerrain 写成
        // LOCKED_DOOR；blueprint_center 的合同是 center/door 同属 cells、互不重合、
        // center 可通行——内部格都来自 passMap（terrainAllowsMove 口径），可通行
        // 天然成立）。
        let cx = 0, cy = 0;
        let n = 0;
        for (const p of cells) {
            if (p.x === gate.x && p.y === gate.y) continue;
            cx += p.x; cy += p.y; n++;
        }
        if (n === 0) return { kind: 'retry' }; // 内部只有门格一格：无宝藏落点，换位重试
        cx = Math.round(cx / n);
        cy = Math.round(cy / n);
        let center: Pos = cells[0]!.x === gate.x && cells[0]!.y === gate.y ? cells[1]! : cells[0]!;
        let bestDist = Infinity;
        for (const p of cells) {
            if (p.x === gate.x && p.y === gate.y) continue;
            const d = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
            if (d < bestDist) {
                bestDist = d;
                center = p;
            }
        }

        return { kind: 'room', cells, center, door: gate };
    }

    /**
     * V-2a：chokeMap 分析缓存取口（见 gateAnalysisCache 头注）。
     */
    private getGateAnalysis(): ChokeAnalysis {
        if (!this.gateAnalysisCache) {
            this.gateAnalysisCache = analyzeChokeMap(this.grid);
        }
        return this.gateAnalysisCache;
    }

    /**
     * Find a contiguous region of FLOOR tiles that satisfies the blueprint's roomSize constraint.
     * Uses flood-fill from random floor tiles.
     *
     * P1-33 起**不再是生产选址路径**（buildMachines 改走 findGateRoom）：任意
     * BFS 连通块上的"门"可能落在唯一通路上，切断关卡（本轮病灶，坏层 5/390）。
     * 保留本体是因为 blueprint_center.test.ts 用例 a) 以它钉"center 属于 region"
     * 的选点合同，且该合同对 findGateRoom 的 center 选点同样生效；P1-33 的
     * 对抗性测试也以它作"旧选址会切层"的对照实现（public 仅为可测）。
     */
    public findSuitableRoom(bp: BlueprintDef): { cells: Pos[]; center: Pos; door: Pos | null } | null {
        // Collect all non-machine floor tiles
        const candidates: Pos[] = [];
        for (let x = 2; x < DCOLS - 2; x++) {
            for (let y = 2; y < DROWS - 2; y++) {
                const cell = this.grid.getCell(x, y);
                if (cell && cell.terrain === TerrainType.FLOOR && cell.machineNumber === 0) {
                    candidates.push({ x, y });
                }
            }
        }
        rng.shuffleList(candidates);

        // Try up to 20 seeds
        for (let i = 0; i < Math.min(20, candidates.length); i++) {
            const seed = candidates[i]!;
            const region = this.floodFillRoom(seed, bp.roomSize[1]);

            if (region.length >= bp.roomSize[0] && region.length <= bp.roomSize[1]) {
                // Center: region 内距质心最近的格子。算术质心不保证属于 region
                //（L 形、环形等非凸房间会落在墙上），而 Game.ts 把 center 用作
                // machine 宝藏的落点，必须是玩家能站上去的格子。
                // 取"离质心最近的 region 格"保持"尽量居中"的意图；
                // 距离相同（平方欧氏）时保留 flood-fill 序中最先出现者，确定性成立。
                let cx = 0, cy = 0;
                for (const p of region) { cx += p.x; cy += p.y; }
                cx = Math.round(cx / region.length);
                cy = Math.round(cy / region.length);

                let center: Pos = region[0]!;
                let bestDist = Infinity;
                for (const p of region) {
                    const d = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
                    if (d < bestDist) {
                        bestDist = d;
                        center = p;
                    }
                }

                // Find door candidate (a cell adjacent to a wall).
                // center 不作为门格：门地形（LOCKED_DOOR/DOOR）若盖在 center 上，
                // 会把 Game.ts 之后放在 center 的宝藏封进不可通行格。
                let doorPos: Pos | null = null;
                for (const p of region) {
                    if ((p.x !== center.x || p.y !== center.y) && this.hasAdjacentWall(p.x, p.y)) {
                        doorPos = p;
                        break;
                    }
                }

                return { cells: region, center, door: doorPos };
            }
        }

        return null;
    }

    /** Flood-fill from seed to find contiguous floor tiles (non-machined), up to maxSize */
    private floodFillRoom(seed: Pos, maxSize: number): Pos[] {
        const visited = new Set<string>();
        const queue: Pos[] = [seed];
        const result: Pos[] = [];

        while (queue.length > 0 && result.length < maxSize) {
            const p = queue.shift()!;
            const key = `${p.x},${p.y}`;
            if (visited.has(key)) continue;
            visited.add(key);

            const cell = this.grid.getCell(p.x, p.y);
            if (!cell || cell.terrain !== TerrainType.FLOOR || cell.machineNumber !== 0) continue;

            result.push(p);

            // 4-directional expansion
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = p.x + dx!;
                const ny = p.y + dy!;
                if (this.grid.isValidPos(nx, ny) && !visited.has(`${nx},${ny}`)) {
                    queue.push({ x: nx, y: ny });
                }
            }
        }

        return result;
    }

    private hasAdjacentWall(x: number, y: number): boolean {
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const cell = this.grid.getCell(x + dx!, y + dy!);
            if (cell && (cell.terrain === TerrainType.WALL || cell.terrain === TerrainType.GRANITE)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Apply a blueprint to a found room region.
     * Marks cells, places terrain features, and returns spawn instructions.
     *
     * V-1c：返回值可为 null = 建造失败（调用方 buildAMachine 已在选址成功时
     * 备份整层，失败后负责恢复——CE :1576-1583 / :1676-1687 的两处回滚）。
     * 新增 ctx.adoptiveItem：递归领养时父机器交来的物品指令（CE adoptiveItem）。
     */
    private applyBlueprint(
        bp: BlueprintDef,
        room: { cells: Pos[]; center: Pos; door: Pos | null },
        ctx: { adoptiveItem?: MachineResult['itemSpawns'][number] | null } = {}
    ): MachineResult | null {
        const machineNum = nextMachineNumber++;
        const flags = new Set(bp.flags);
        const effFlags = effectiveBpFlags(bp);
        const subMachines: MachineResult[] = [];

        // V-2b-2b：CE p->interior 的 web 可变形态——初始 = 选址产出的内部格
        //（集合迭代序 = room.cells 原序，非改造机器的后续 RNG 序逐位不变）。
        // 机器 origin（CE originX/Y）：BP_ROOM = 门位格；前厅 = 传入落位。
        const interior = new Set<number>(room.cells.map(p => cellKey(p.x, p.y)));
        const origin: Pos = room.door ?? room.center;
        const posOf = (k: number): Pos => ({ x: k % DCOLS, y: Math.floor(k / DCOLS) });
        // CE IS_GATE_SITE 的 web 判据（BP_SURROUND_WITH_WALLS / BP_IMPREGNABLE
        // 的豁免位，CE Architect.c:912/:919/:942/:949）：分析快照的 gateSite
        // 并上机器自己的 origin——前厅机器的 origin（父机器门位格）在重算的
        // 分析里不保证仍是 gateSite，而"门位不补墙/不加固"正是这两个豁免的
        // 存在目的（漏了机器会被自己的墙封死，任务书 §8.3 点名）。
        // 惰性取分析：不带这两个旗标的机器不做全图分析。
        let gateAnalysis: ChokeAnalysis | null = null;
        const isGateSite = (x: number, y: number): boolean => {
            if (x === origin.x && y === origin.y) return true;
            gateAnalysis ??= this.getGateAnalysis();
            return gateAnalysis.gateSite[x]![y]!;
        };

        // 1. prepareInteriorWithMachineFlags（CE Architect.c:858-945）逐段直译，
        //    段序照 CE：OPEN → PURGE_INTERIOR → PURGE_PATHING_BLOCKERS →
        //    PURGE_LIQUIDS → SURROUND_WITH_WALLS →（REDESIGN 本轮不做）→
        //    IMPREGNABLE。全段零 RNG。**先于 machineNumber 标记**（CE :1225
        //    先于 :1231——OPEN 的扩张判据与 SURROUND 的邻格 machineNumber
        //    检查都依赖该顺序）。
        if (flags.has(BP_OPEN_INTERIOR)) {
            this.expandMachineInterior(interior, 4); // CE :864-865（MAXIMIZE=1 本轮不做）
        }

        // CE :869-881：清空内部——DUNGEON 层 FLOOR、其余层 NOTHING
        //（setTerrain 的 writeTerrainHome 语义恰为此）。
        if (flags.has('BP_PURGE_INTERIOR')) {
            for (const k of interior) {
                const p = posOf(k);
                this.grid.setTerrain(p.x, p.y, TerrainType.FLOOR, '.', 0x888888);
            }
        }

        // CE :882-896：逐层清掉带 T_PATHING_BLOCKER 的地形（"不许有陷阱"）。
        if (flags.has(BP_PURGE_PATHING_BLOCKERS)) {
            for (const k of interior) {
                const p = posOf(k);
                const cell = this.grid.getCell(p.x, p.y)!;
                for (let l = 0; l < DungeonLayer.COUNT; l++) {
                    if (isPathingBlocker(cell.layers[l]!)) {
                        this.grid.setTerrainLayer(p.x, p.y, l as DungeonLayer,
                            l === DungeonLayer.DUNGEON ? TerrainType.FLOOR : TerrainType.NOTHING);
                    }
                }
            }
        }

        // CE :897-907：清掉内部的液体层。
        if (flags.has(BP_PURGE_LIQUIDS)) {
            for (const k of interior) {
                const p = posOf(k);
                this.grid.setTerrainLayer(p.x, p.y, DungeonLayer.LIQUID, TerrainType.NOTHING);
            }
        }

        // CE :908-932：给 interior 外圈的"可通行但阻断寻路"的格补墙。
        // 四重豁免照抄：邻格是 gate 位、邻格属其他机器、邻格挡通行、
        // 内格自己是 gate 位（整格跳过）。
        if (flags.has(BP_SURROUND_WITH_WALLS)) {
            for (const k of interior) {
                const p = posOf(k);
                if (isGateSite(p.x, p.y)) continue;
                for (const [dx, dy] of DIRS8) {
                    const nx = p.x + dx!, ny = p.y + dy!;
                    if (!this.grid.isValidPos(nx, ny)) continue; // CE coordinatesAreInMap
                    if (interior.has(cellKey(nx, ny))) continue;
                    if ((cellTerrainFlags(this.grid, nx, ny) & T_OBSTRUCTS_PASSABILITY) !== 0) continue;
                    if (isGateSite(nx, ny)) continue;
                    if ((this.grid.getCell(nx, ny)?.machineNumber ?? 0) !== 0) continue;
                    if ((cellTerrainFlags(this.grid, nx, ny) & T_PATHING_BLOCKER) === 0) continue;
                    this.grid.setTerrain(nx, ny, TerrainType.WALL, '#', 0x555566);
                }
            }
        }

        // CE :938-958：interior（gate 位豁免）与其全部图内、非 interior、
        // 非 gate 位邻格打上不可挖掘标记。
        if (flags.has(BP_IMPREGNABLE)) {
            for (const k of interior) {
                const p = posOf(k);
                if (isGateSite(p.x, p.y)) continue;
                this.impregnableCells.add(k);
                for (const [dx, dy] of DIRS8) {
                    const nx = p.x + dx!, ny = p.y + dy!;
                    if (!this.grid.isValidPos(nx, ny)) continue;
                    if (interior.has(cellKey(nx, ny))) continue;
                    if (isGateSite(nx, ny)) continue;
                    this.impregnableCells.add(cellKey(nx, ny));
                }
            }
        }

        // 2. Mark all cells as belonging to this machine（CE :1231-1249；
        //    V-2b-2b 起移到 prepareInterior 之后。CE 同块里的 SECRET_DOOR→
        //    DOOR 改判 web 尚无载体，登记为缺口——见报告"与预设不符之处"；
        //    wired 地形清除一步 V-2b-3 已补，见下）。
        for (const k of interior) {
            const cell = this.grid.getCell(k % DCOLS, Math.floor(k / DCOLS));
            if (!cell) continue;
            cell.machineNumber = machineNum;
            // CE :1244-1250（"Clear wired tiles in case we stole them from
            // another machine"）：机器内部既有的带电格一律剪线清层
            // （DUNGEON→FLOOR、其余→NOTHING）。本步在 feature 落位**之前**
            // ——机器自己的 wired 载体（压力板/符文/喷口……）随后才铺，不受
            // 影响；清的是选址吞并前就在格上的旧 wired 地形（web 的生成期
            // 压力板 Architect.ts、或未来的生成期载体）。V-2b-3 起 web 有
            // wired 载体，该分支从结构性不可达变为真实可达，按 CE 字面补上。
            for (let l = 0; l < DungeonLayer.COUNT; l++) {
                const layer = l as DungeonLayer;
                if (TERRAIN_FLAGS[cell.layers[layer]!].mechFlags
                    & (TM_IS_WIRED | TM_IS_CIRCUIT_BREAKER)) {
                    this.grid.setTerrainLayer(
                        cell.x, cell.y, layer,
                        layer === DungeonLayer.DUNGEON ? TerrainType.FLOOR : TerrainType.NOTHING
                    );
                }
            }
        }
        // V-2a：machineNumber 是 findGateRoom 候选过滤（!IS_IN_MACHINE）的
        // 依据——本步起机器标号上网格，门位候选缓存就此失效。**analysis
        // 缓存不在此失效**（失效点在本方法尾部）：chokeMap/gateSite 是地形
        // 派生物，CE 的对应物本就是每层预计算、机器阶段不重算
        // （Architect.c:1063-1101），递归子机器沿用父选址时的分析正是该
        // 语义；把它也提前失效会让子机器的分析耦合进父机器地形，选址结果
        // 与重捕获基线分叉（seed31337/D2 实证）。
        this.gateCandidatesCache.clear();

        // 3. Place door terrain
        let doorPos: Pos | null = room.door;
        const needsKey = bp.doorTerrain === 'LOCKED_DOOR';
        if (bp.doorTerrain && doorPos) {
            const terrainType = TERRAIN_MAP[bp.doorTerrain];
            const visual = TERRAIN_VISUALS[bp.doorTerrain];
            if (terrainType !== undefined && visual) {
                this.grid.setTerrain(doorPos.x, doorPos.y, terrainType, visual.char, visual.color);
            }
        }

        // 4. Process features
        const itemSpawns: MachineResult['itemSpawns'] = [];
        const monsterSpawns: MachineResult['monsterSpawns'] = [];
        let altarGroupId: number | null = null;

        // Shuffle room cells for feature placement
        // V-2b-2b：候选域 = （可能经 OPEN_INTERIOR 扩张后的）interior。
        // 集合迭代序 = room.cells 原序（无改造时逐位同旧实现）。
        const availableCells: Pos[] = [];
        for (const k of interior) availableCells.push(posOf(k));
        rng.shuffleList(availableCells);
        const usedCells = new Set<number>();
        // center 保留给宝藏：feature 地形（如 key_flood_trap 的 WATER_DEEP、
        // key_lava_moat 的 LAVA）与 feature 物品都不得落在 center 上，
        // 否则 Game.ts 之后放在 center 的宝藏会躺进不可通行格。
        // （V-2b-2a：键统一为 cellKey——findFeaturePosition 现按 cellKey 查询。）
        usedCells.add(cellKey(room.center.x, room.center.y));
        // door 同理：doorPos 已在上一步（若 bp.doorTerrain 存在）写成门地形
        // （常见 LOCKED_DOOR，不可通行），但此刻仍留在 availableCells 里，
        // 若不排除，findFeaturePosition 可能把 MF_GENERATE_ITEM（_random_good_/
        // KEY 等）feature 的坐标选到它头上，物品就直接躺进了刚铺好的门格
        // （玩家永远拿不到）。P1-20：24 件高价值物品落在 LOCKED_DOOR 上的根因。
        if (doorPos) {
            usedCells.add(cellKey(doorPos.x, doorPos.y));
        }

        // V-1b：MF_ALTERNATIVE / MF_ALTERNATIVE_2 —— CE Architect.c:1291-1318
        // 直译（alternativeFlags[2] = {MF_ALTERNATIVE, MF_ALTERNATIVE_2}，
        // Architect.c:997）。在 feature 构建循环之前一次性决定：对每个替代
        // 集合，先把带旗标的 feature 全部标记 skip 并计数 totalFreq；集合
        // 非空时掷**一次** rand_range(1, totalFreq)，按顺序数到第 randIndex
        // 个时 un-skip（只建这一个，其余不建；被选中者随后照常按自身
        // instanceCount 全建）。两个集合独立，各消耗一次掷骰（集合为空则
        // 一次也不掷）。注意 CE 的两轮是串行覆盖：带双旗标的 feature 即使
        // 在第一轮被选中，第二轮的 skip 标记也会把它重新标掉（随后可能
        // 再次被选中）——这是 CE 循环结构的字面行为，不是 bug。
        // 当前 blueprints.json 无任何带这两旗标的 feature（totalFreq 恒 0、
        // 零掷骰），生成流逐位不变；V-2 数据落地后此机制防止替代集合
        // 全部同时生成（CE 基座大奖=附魔卷轴或生命药水二选一）。
        const skipFeature: boolean[] = bp.features.map(() => false);
        for (let j = 0; j <= 1; j++) {
            const altFlag = j === 0 ? 'MF_ALTERNATIVE' : 'MF_ALTERNATIVE_2';
            let totalFreq = 0;
            for (let i = 0; i < bp.features.length; i++) {
                if (bp.features[i]!.flags.includes(altFlag)) {
                    skipFeature[i] = true;
                    totalFreq++;
                }
            }
            if (totalFreq > 0) {
                let randIndex = rng.randRange(1, totalFreq);
                for (let i = 0; i < bp.features.length; i++) {
                    if (bp.features[i]!.flags.includes(altFlag)) {
                        if (randIndex === 1) {
                            skipFeature[i] = false; // 这一 alternative 被建，其余不建
                            break;
                        }
                        randIndex--;
                    }
                }
            }
        }

        // V-2b-2a：CE p->interior 的 web 形态——机器内部（V-2b-2b 起 =
        // 可经 BP_OPEN_INTERIOR 扩张后的 interior 集合本体），cellIsFeature-
        // Candidate 第 4/7 步的 interior 判据以它为准。
        const interiorSet = interior;

        for (const [feat, feature] of bp.features.entries()) {
            if (skipFeature[feat]) continue; // CE Architect.c:1329：未被选中的替代 feature 整条跳过
            const fFlags = new Set(feature.flags);
            const minInstances = feature.minimumInstanceCount ?? feature.instanceCount[0];
            // V-2b-2a（CE :1387-1394）：MF_EVERYWHERE → 铺满所有合格格，且
            // **不掷 instanceCount**（CE 的 rand_range 只在非 EVERYWHERE 分支，
            // :1393）。CE :1387 的 `& ~MF_BUILD_AT_ORIGIN` 屏蔽在现行位定义下
            // 语义空转：MF_EVERYWHERE = Fl(15) 独立位（Rogue.h:2600），不含
            // BUILD_AT_ORIGIN 位，`flags & MF_EVERYWHERE & ~MF_BUILD_AT_ORIGIN`
            // 恒等于 `flags & MF_EVERYWHERE`——按位直译即只测 EVERYWHERE。
            const everywhere = fFlags.has('MF_EVERYWHERE');
            // V-2b-2a（CE :1360-1670）：MF_REPEAT_UNTIL_NO_PROGRESS 真循环——
            // 反复「重掷 instanceCount → 落位」直到一轮的落位数达不到 minimum
            // （此时 min 检查被 REPEAT 豁免，CE :1675）。旧 web 只把它当 min
            // 豁免。非 REPEAT 恰走一轮、恰掷一次，与旧实现逐位一致。
            const repeatUntilNoProgress = fFlags.has('MF_REPEAT_UNTIL_NO_PROGRESS');
            let placed = 0;                  // CE instance：do-while 最后一轮的落位数
            let struck = new Set<number>();  // CE candidates[][] strike：本轮已尝试/
                                             // 已否决的格（CE :1431-1432），本轮不再
                                             // 回头；下轮候选重建后复位（CE :1364 重扫）
            let roundPlaced = 0;             // 本轮落位数（CE for 循环里的 instance）
            // CE :1399 的 qualifyingTileCount 预算：候选表每轮重算、每次拾取
            // 无条件 -1、归零即出循环（:1431-1432）。对非 BATO 候选域，web 的
            // struck 递缩已给出同构终止；BATO 的候选表只含 origin
            // （cellIsFeatureCandidate 第 3 步对 BATO 仅 origin 合格 → qTC=1），
            // 故每轮恰一次拾取——instanceCount ≥ 2 的 BATO feature 也只落一实例
            // （CE 字面行为；生产 BATO 全为 [1,1]，零流影响）。这个预算同时
            // 防住 EVERYWHERE+BATO 的死循环。
            let picksLeft = fFlags.has('MF_BUILD_AT_ORIGIN') ? 1 : Number.POSITIVE_INFINITY;
            // V-2b-3（V-2b-2b 验收登记的 failsafe）：REPEAT 循环的迭代上界。
            // 「REPEAT + reqSpace 0」组合理论不终止（不占格 → 候选不缩减 →
            // 每轮落满 → 条件恒真）；CE 全部 10 条 REPEAT feature 的 reqSpace
            // 逐条为 1 且 CE 循环本身无上界（Architect.c:1360-1687 之间无
            // failsafe 计数），故这是 web 侧纯防御、CE 无对应值可抄——量级取
            // CE failsafe 惯用的 1000（generateItem 重掷 Architect.c:1506 等）。
            // 可达路径上零行为变化（真实 REPEAT 数据循环 ≤ 数轮），超限即显式
            // 抛错并携带蓝图 id / feature 序号 / 轮数，替代"静默挂死到 worker
            // OOM"的无诊断故障形态。
            let repeatRounds = 0;
            do {
                roundPlaced = 0;
                struck = new Set<number>(); // CE :1362-1377：候选表每轮重建——
                                            // 上轮被 strike 的非 occupied 格重新可试
                if (fFlags.has('MF_BUILD_AT_ORIGIN')) picksLeft = 1;
                // CE :1393：每轮重掷 instanceCount。非 REPEAT 首轮掷一次，位置
                // 与旧 web 的单掷逐位一致；EVERYWHERE 不掷（CE :1387-1389）。
                const count = everywhere
                    ? Number.POSITIVE_INFINITY
                    : rng.randRange(feature.instanceCount[0], feature.instanceCount[1]);
                // CE :1399 for 循环：instance 只在落位成功时前进（:1478）；
                // 候选耗尽或 count 个成功即止。阻断否决失败的实例不前进。
                while (roundPlaced < count && picksLeft > 0) {
                    picksLeft--; // CE :1431-1432：每次拾取无条件消耗预算
                    // Find a placement position
                    // V-2a：origin = 机器落位锚点（CE originX/Y）——BP_ROOM 机器是
                    // 门位格（CE :1100-1101 的 gateCandidates 抽中的 gate），前厅
                    // 机器 center/door 同格即 origin。MF_BUILD_AT_ORIGIN 的 feature
                    // 以它为唯一定点。
                    const pos = this.findFeaturePosition(
                        availableCells, usedCells, struck,
                        room.door ?? room.center, feature, fFlags,
                        effFlags, machineNum, interiorSet
                    );
                    if (!pos) break; // CE qualifyingTileCount == 0：候选耗尽
                    // CE :1430-1432：候选先 strike 再尝试——成败与否本轮不再选它
                    struck.add(cellKey(pos.x, pos.y));

                    // CE :1434：DFSucceeded 恒真——web 的 feature 无 featureDF
                    // 载体（CE :1437-1440 的 spawnDungeonFeature 分支登记缺口，
                    // 含其 abortIfBlocking=!MF_PERMIT_BLOCKING 语义）。
                    let terrainSucceeded = true;

                    // Place terrain（CE :1443-1456：先否决后落格）
                    if (feature.terrain) {
                        const terrainType = TERRAIN_MAP[feature.terrain];
                        const visual = TERRAIN_VISUALS[feature.terrain];
                        if (terrainType !== undefined) {
                            // V-2b-2a（CE :1444-1452）：阻断否决——无
                            // MF_PERMIT_BLOCKING 且（地形带 T_PATHING_BLOCKER 或
                            // feature 带 MF_TREAT_AS_BLOCKING）时，假想堵住本格
                            // 做连通性判定，切断即放弃该实例（不落格、不算数）。
                            if (!fFlags.has('MF_PERMIT_BLOCKING')
                                && (isPathingBlocker(terrainType) || fFlags.has('MF_TREAT_AS_BLOCKING'))) {
                                const blockingMap = createSpawnMap(this.grid);
                                blockingMap[cellKey(pos.x, pos.y)] = 1;
                                // 守卫口径：CE :1451 单查 levelIsDisconnectedWithBlockingMap；
                                // web 按 C-8 既有惯例（spawnDungeonFeature 的 DF 落位
                                // 守卫，DungeonFeature.ts「两查并列加严」）并列 web
                                // 移动图判据——web 的 CHASM/LAVA 可走性使 CE 单查有
                                // 盲区（key_lava_moat 正是载体），两查皆纯泛洪零 RNG。
                                terrainSucceeded =
                                    levelIsDisconnectedWithBlockingMap(this.grid, blockingMap, false) === 0
                                    && !levelIsDisconnectedOnMovementGraph(this.grid, blockingMap);
                            }
                            if (terrainSucceeded) {
                                const ch = visual?.char ?? '.';
                                const col = visual?.color ?? 0x888888;
                                const homeLayer = FEATURE_LAYER_MAP[feature.layer ?? ''];
                                if (homeLayer !== undefined) {
                                    // V-2b-2b（CE :1443）：feature 带 layer 列 → 纯层写入，
                                    // 不清其他层（地毯上的菌林，两层共存）。字形/颜色仅在
                                    // 写入层成为有效地形时刷新（被更高优先层压住时不动）。
                                    this.grid.setTerrainLayer(pos.x, pos.y, homeLayer, terrainType);
                                    const wcell = this.grid.getCell(pos.x, pos.y);
                                    if (wcell && wcell.terrain === terrainType) {
                                        wcell.char = ch;
                                        wcell.color = col;
                                    }
                                } else {
                                    this.grid.setTerrain(pos.x, pos.y, terrainType, ch, col);
                                }

                                // Handle trap type
                                if (feature.terrain === 'TRAP' && feature.trapType) {
                                    const cell = this.grid.getCell(pos.x, pos.y);
                                    if (cell) {
                                        cell.trapType = feature.trapType as any;
                                        cell.isPassable = true;
                                    }
                                }

                                // Handle sign text
                                if (feature.terrain === 'SIGN' && feature.signText) {
                                    // Sign text is stored as a property in the cell
                                    // For now, the sign inspection system reads adjacent signs
                                }

                                // Handle altar group
                                if (fFlags.has('MF_ALTAR_GROUP')) {
                                    if (altarGroupId === null) {
                                        altarGroupId = this.depth * 100 + rng.randRange(1, 99);
                                    }
                                    const cell = this.grid.getCell(pos.x, pos.y);
                                    if (cell) cell.altarGroupId = altarGroupId;
                                }
                            }
                        }
                    }

                    // CE :1461-1470：只有落位成功才清 personal space、记 occupied、
                    // 前进 instance。CE 的 occupied 区 = 边长 2ps−1 的方形
                    // （ps=1 仅本格、ps=2 为 3×3）；**ps=0 时占位循环 range 为空、
                    // 一格都不占**。V-2b-2b 起落格写入 usedCells 随 personalSpace
                    // 条件化——ps=0 的 feature（3/4/5 号的 CARPET）不占据落格，
                    // 后续 feature 可复用同格（CE 字面行为；旧 web 无条件占格，
                    // 曾使地毯铺满后整个内部再无候选）。
                    if (terrainSucceeded) {
                        if (feature.personalSpace && feature.personalSpace > 0) {
                            usedCells.add(cellKey(pos.x, pos.y));
                            this.markPersonalSpace(pos, feature.personalSpace, usedCells);
                        }
                        roundPlaced++; // CE :1478 instance++

                        // CE :1486-1488：feature 格并入机器（BUILD_IN_WALLS /
                        // BUILD_ANYWHERE 的格在 room.cells 之外，machineNumber
                        // 在此刻补写；IS_IN_ROOM/AREA 之分 web 无载体，machineNumber
                        // 即 IS_IN_MACHINE 的 web 等价物）。
                        const fcell = this.grid.getCell(pos.x, pos.y);
                        if (fcell && fcell.machineNumber === 0) fcell.machineNumber = machineNum;

                        // V-2b-2a（CE :1491-1493）：MF_IMPREGNABLE → 不可挖掘标记
                        if (fFlags.has('MF_IMPREGNABLE')) {
                            this.impregnableCells.add(cellKey(pos.x, pos.y));
                        }

                        // Generate item spawn instructions.
                        // V-1c（CE :1495-1541）：领养优先——BP_ADOPT_ITEM 机器的
                        // MF_ADOPT_ITEM feature 消耗父机器交来的物品（只领一次，
                        // CE :1503 "can be adopted only once"），不再自产；自产物
                        // 带 MF_OUTSOURCE_ITEM_TO_MACHINE 时不落本机（CE :1533-1539
                        // 非外包才 placeItemAt），指令交由下面的递归块交给子机器。
                        // V-2b-2a：CE 的物品生成在 :1482 DFSucceeded&&terrainSucceeded
                        // 守卫内（:1495 起）——否决失败的实例连物品都不产，web 同构。
                        let theItem: MachineResult['itemSpawns'][number] | null = null;
                        if (ctx.adoptiveItem && fFlags.has('MF_ADOPT_ITEM') && effFlags.has(BP_ADOPT_ITEM)) {
                            theItem = { ...ctx.adoptiveItem, pos: { x: pos.x, y: pos.y } };
                            itemSpawns.push(theItem);
                            ctx.adoptiveItem = null;
                        } else if (fFlags.has('MF_GENERATE_ITEM') && feature.itemCategory) {
                            // V-2b-2a（CE :1506-1509）：Q 族资格旗标随指令下传；
                            // 消费点在 Game.spawnBlueprintItem（物品实化处）——
                            // CE 的「不合格重掷、failsafe 1000」过滤循环因 Game.ts
                            // 不在本轮授权清单而登记为边界外缺口（报告 §2）。
                            const itemQualifiers = ITEM_QUALIFIER_FLAGS.filter(f => fFlags.has(f));
                            theItem = {
                                category: feature.itemCategory,
                                id: feature.itemId,
                                pos: { x: pos.x, y: pos.y },
                                isAltar: fFlags.has('MF_ALTAR'),
                                itemQualifiers: itemQualifiers.length > 0 ? itemQualifiers : undefined
                            };
                            if (!fFlags.has('MF_OUTSOURCE_ITEM_TO_MACHINE')) {
                                itemSpawns.push(theItem);
                            }
                        }

                        // V-1c：递归外包 / 前厅（CE :1543-1575，结构逐字）——
                        // 10 次重试建子机器；任一次成功即把子机器并入本机器
                        // （CE :1555-1567 并入 spawnedItems/Monsters 缓冲的 web 等价），
                        // 10 次全败 → 整机失败（CE :1576-1583，备份由 buildAMachine 恢复）。
                        // CE 每次重试前把领养物品从地面/背包摘链的注释（:1546-1551）在
                        // web 结构性成立：物品指令不在网格上，失败的子机器结果整体丢弃，
                        // 无"留在地上"的残骸可摘。
                        if (fFlags.has('MF_OUTSOURCE_ITEM_TO_MACHINE') || fFlags.has('MF_BUILD_VESTIBULE')) {
                            let success = false;
                            for (let i = 10; i > 0; i--) {
                                if (fFlags.has('MF_OUTSOURCE_ITEM_TO_MACHINE') && theItem) {
                                    const sub = this.buildAMachine([BP_ADOPT_ITEM], theItem, null);
                                    if (sub) { subMachines.push(sub); success = true; }
                                } else if (fFlags.has('MF_BUILD_VESTIBULE')) {
                                    const sub = this.buildAMachine([BP_VESTIBULE], null, { x: pos.x, y: pos.y });
                                    if (sub) { subMachines.push(sub); success = true; }
                                }
                                if (success) break;
                            }
                            if (!success) return null;
                        }
                        theItem = null;

                        // Generate monster spawn instructions.
                        // V-2b-3（CE Architect.c:1601 `if (feature->monsterID)`）：
                        // CE 的 monsterID 分支**只看列值非零**，不要求任何 feature
                        // 旗标（同函数的 horde 分支才看 MF_GENERATE_HORDE）。旧 web
                        // 要求 MF_GENERATE_MONSTER ∧ monsterId——现有 7 条数据两者
                        // 皆有（行为零变化），但 24/25 号的图腾/守卫 feature 按 CE
                        // 数据不带该旗标，旧条件会漏生成。照 CE 改为只看 monsterId。
                        if (feature.monsterId) {
                            monsterSpawns.push({
                                monsterId: feature.monsterId,
                                pos: { x: pos.x, y: pos.y },
                                isAlly: fFlags.has('MF_MONSTER_IS_ALLY'),
                                isCaged: fFlags.has('MF_MONSTER_IS_CAGED')
                            });
                        }
                    }
                }

                placed = roundPlaced; // CE：instance 每轮由 for 重置归零（:1399），
                                      // min 检查只看最后一轮（:1675）
                if (repeatUntilNoProgress) {
                    repeatRounds++;
                    if (repeatRounds > 1000) {
                        throw new Error(
                            `MF_REPEAT_UNTIL_NO_PROGRESS failsafe：蓝图 "${bp.id}" 的 feature #${feat} 已循环 ${repeatRounds} 轮仍持续落位——候选域不缩减（reqSpace=0 或 instanceCount 异常），疑似死循环。V-2b-3 failsafe（CE 无此机制，量级 1000）。`
                        );
                    }
                }
            } while (repeatUntilNoProgress && roundPlaced >= minInstances);

            // V-1c：CE :1675-1687——本 feature（最后一轮）实际落位数达不到
            // minimumInstanceCount（web 缺省 = instanceCount[0]，见 FeatureDef 注）
            // → 整机失败（备份由 buildAMachine 恢复）。web 今天的失败源是
            // findFeaturePosition 找不到可落格（房间太小/格子被占光）与
            // V-2b-2a 的阻断否决（CE :1444-1452）。REPEAT 豁免（CE :1675）。
            if (placed < minInstances && !repeatUntilNoProgress) {
                return null;
            }
        }

        // 5. 机器旗标（P1-37）：本方法第 1 步已把 room.cells 全部写入
        // cell.machineNumber（web 的 IS_IN_MACHINE 等价物，CE Rogue.h:1113，
        // 楼梯 Architect.c:3712/3738、随机物品 3597、漫游怪群 3543 的落点
        // 回避它）。P1-33 曾在此把机器内部裸 FLOOR 整体改判 CHARRED_FLOOR，
        // 让它们退出 Game.populateLevel 的 `terrain === FLOOR` 牌堆——那是
        // Game.ts 禁改轮次的权宜：玩家会看到宝库一片"烧焦的地面"，且
        // Gas.updateFires 的焦土长草（Gas.ts:128）作用在宝库地板上、每格
        // 每回合白白消耗 RNG。现在 populateLevel 直接按 machineNumber 排除
        // 机器格，地板恢复普通 FLOOR，本步骤不再改判任何地形。

        // 内容牌堆回避的另一半在 Game.populateLevel（棋盘同源：按
        // machineNumber≠0 排除），两处必须同进同退。

        // V-2a：机器建成 = 网格真变异（地形/门/feature 都落了），chokeMap
        // 分析缓存在此失效（与重捕获基线的行为对齐：建成后的下一次选址
        // 重算 analysis；失败路径 restoreLevel 恢复到缓存收集态，无需失效）。
        // V-2b-2a：IN_LOOP 陈旧快照同点失效（CE 建层期预计算的对应生命周期）。
        this.gateAnalysisCache = null;
        this.loopMapCache = null;

        // V-2b-2b（CE Architect.c:1691-1702）：BP_NO_INTERIOR_FLAG——机器
        // 建成后把非 wired 格的机器标记摘掉（IS_IN_MACHINE + machineNumber
        // 一并清零）。23 号用它：陷阱区不算机器内，CE 的楼梯/物品/怪群
        // 落点（回避 IS_IN_MACHINE）可以在其中正常落。wired 判据照抄：
        // 格上地形带 TM_IS_WIRED | TM_IS_CIRCUIT_BREAKER 机械旗标者保留。
        if (flags.has(BP_NO_INTERIOR_FLAG)) {
            for (let x = 0; x < DCOLS; x++) {
                for (let y = 0; y < DROWS; y++) {
                    const cell = this.grid.getCell(x, y);
                    if (!cell || cell.machineNumber !== machineNum) continue;
                    if ((cellTerrainMechFlags(this.grid, x, y) & (TM_IS_WIRED | TM_IS_CIRCUIT_BREAKER)) !== 0) continue;
                    cell.machineNumber = 0;
                }
            }
        }

        return {
            blueprintId: bp.id,
            category: bp.category,
            machineNumber: machineNum,
            // V-2b-2b：cells = 最终机器内部（可能经 OPEN_INTERIOR 扩张），
            // 与 availableCells 的集合迭代序一致（无改造时逐位同 room.cells）。
            cells: availableCells,
            center: room.center,
            door: doorPos,
            itemSpawns,
            monsterSpawns,
            needsKey,
            altarGroupId,
            subMachines
        };
    }

    /**
     * V-1c：CE fillInteriorForVestibuleMachine（Architect.c:674-730）的直译。
     * 前厅机器从门位（origin）出发：Dijkstra 扫距（机器格与不可通行格为禁地，
     * 4 向——CE dijkstraScan(..., false)），目标尺寸 rand_range(roomSize)，
     * 按"距离 = k"的外壳序（sCols/sRows 洗牌）收集内部格。
     *
     * 与 CE 的两处留形差异（当前数据下皆结构性不可达，激活轮需重核）：
     *   - CE :706-710 的 HAS_ITEM 中止：机器阶段物品尚为指令、不在网格上，
     *     web 无从触发；
 *   - cost 口径用 web 的 PDS_FORBIDDEN 约定（Game.findQualifyingPathLocNear
 *     同款：!isPassable ∪ LAVA ∪ WATER_DEEP ∪ TRAP），非 CE
 *     populateGenericCostMap 的逐地形代价——P1-33 已登记的同族偏差。
 * CE :715-723 的 BP_TREAT_AS_BLOCKING / BP_REQUIRE_BLOCKING 连通性复核
 * **本轮刻意未接线**：levelIsDisconnectedWithBlockingMap 属 DF 子系统，
 * 生产引用受 c_4b F1 留痕扫描器白名单钉死（本轮授权清单不含该测试），
 * 且当前数据零载体、检查结构性不可达——接线留给激活轮，届时按该测试
 * 标题预告的流程扩白名单。
 */
    private fillVestibuleInterior(bp: BlueprintDef, origin: Pos): Pos[] | null {
        const goal = rng.randRange(bp.roomSize[0], bp.roomSize[1]);

        const dist = allocShortGrid(DCOLS, DROWS, MAX_DISTANCE);
        const cost = allocShortGrid(DCOLS, DROWS, 1);
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const cell = this.grid.getCell(x, y);
                const forbidden = !cell || !cell.isPassable
                    || cell.layers.includes(TerrainType.LAVA)
                    || cell.layers.includes(TerrainType.WATER_DEEP)
                    || cell.layers.includes(TerrainType.TRAP)
                    || cell.machineNumber !== 0; // CE :680-684：不得吞并既有机器
                if (forbidden) cost[x]![y] = -1; // web PDS_FORBIDDEN 约定
            }
        }
        dist[origin.x]![origin.y] = 0; // CE :681
        cost[origin.x]![origin.y] = 1; // CE :688
        const scanner = new DijkstraMap(DCOLS, DROWS);
        scanner.batchScan(dist, cost, false); // CE dijkstraScan(distanceMap, costMap, false)

        // CE :692-704：距离外壳序 + 洗牌的列/行序。
        const sCols: number[] = [];
        for (let v = 0; v < DCOLS; v++) sCols.push(v);
        rng.shuffleList(sCols);
        const sRows: number[] = [];
        for (let v = 0; v < DROWS; v++) sRows.push(v);
        rng.shuffleList(sRows);

        const cells: Pos[] = [];
        for (let k = 0; k < 1000 && cells.length < goal; k++) {
            for (const x of sCols) {
                for (const y of sRows) {
                    if (cells.length >= goal) break;
                    if (dist[x]![y] === k) {
                        cells.push({ x, y });
                        // CE :706-710 的 HAS_ITEM 中止在 web 结构性不可达（见头注）。
                    }
                }
            }
        }
        // CE :715-723 的 BP_TREAT_AS_BLOCKING / BP_REQUIRE_BLOCKING 复核
        // 本轮未接线（原因见头注）——激活轮补上。
        return cells;
    }

    /**
     * V-2b-2b：CE expandMachineInterior（Architect.c:607-674）的直译——
     * BP_OPEN_INTERIOR（minimumInteriorNeighbors=4）与 BP_MAXIMIZE_INTERIOR
     * （=1，本轮无载体）共用的内部扩张器。反复扫描直到不动点：
     *   候选格（CE :615-617）= 1..边界内、自己是 T_PATHING_BLOCKER（墙/水/
     *   陷阱等阻断寻路的地形）、machineNumber == 0（不得吞并其他机器——
     *   本机标记尚未写上，applyBlueprint 的段序保证）；
     *   资格（:619-630）= 8 邻中"interior 且非阻断"的开邻数 ≥ 参量；
     *   收缩检查（:631-641）= 8 邻中"非 interior 且（可通行或属其他机器）"
     *   的外敞邻数必须为 0（扩张结果不许撞见外部世界）；
     *   吞并（:643-657）= 收入 interior、逐层清掉 T_PATHING_BLOCKER 层
     *   （DUNGEON 层 → FLOOR）、花岗岩邻墙改 WALL。
     * 收尾（:666-674）：interior 内的 DOOR / SECRET_DOOR 改 FLOOR
     * （CE 注释：密门会搅乱距离图、且机器内部藏密门不好玩）。
     * 层级写入口用 Grid.setTerrainLayer（CE `layers[layer] = …` 的逐层语义；
     * 该入口的调用点白名单在 c_4a_0_layer_model.test.ts，本轮已按其自带
     * 指示扩入本文件）。
     */
    private expandMachineInterior(interior: Set<number>, minimumInteriorNeighbors: number): void {
        const inMapInner = (x: number, y: number): boolean =>
            x >= 1 && y >= 1 && x < DCOLS - 1 && y < DROWS - 1; // CE 循环域 1..DCOLS-2 / 1..DROWS-2
        const cellIsBlocker = (x: number, y: number): boolean =>
            (cellTerrainFlags(this.grid, x, y) & T_PATHING_BLOCKER) !== 0;

        let madeChange = true;
        while (madeChange) {
            madeChange = false;
            for (let x = 1; x < DCOLS - 1; x++) {
                for (let y = 1; y < DROWS - 1; y++) {
                    const k = cellKey(x, y);
                    if (!cellIsBlocker(x, y) || (this.grid.getCell(x, y)?.machineNumber ?? 0) !== 0) continue;

                    // 开邻计数：interior 且非 T_PATHING_BLOCKER。
                    let nbcount = 0;
                    for (const [dx, dy] of DIRS8) {
                        const nx = x + dx!, ny = y + dy!;
                        if (!this.grid.isValidPos(nx, ny)) continue;
                        if (interior.has(cellKey(nx, ny)) && !cellIsBlocker(nx, ny)) nbcount++;
                    }
                    if (nbcount < minimumInteriorNeighbors) continue;

                    // 外敞邻检查：非 interior 且（可通行 或 属其他机器）→ 不得扩张。
                    let exteriorOpen = false;
                    for (const [dx, dy] of DIRS8) {
                        const nx = x + dx!, ny = y + dy!;
                        if (!this.grid.isValidPos(nx, ny)) continue;
                        if (interior.has(cellKey(nx, ny))) continue;
                        if ((cellTerrainFlags(this.grid, nx, ny) & T_OBSTRUCTS_PASSABILITY) === 0
                            || (this.grid.getCell(nx, ny)?.machineNumber ?? 0) !== 0) {
                            exteriorOpen = true;
                            break;
                        }
                    }
                    if (exteriorOpen) continue;

                    // 吞并本格。
                    madeChange = true;
                    interior.add(k);
                    const cell = this.grid.getCell(x, y)!;
                    for (let l = 0; l < DungeonLayer.COUNT; l++) {
                        if (isPathingBlocker(cell.layers[l]!)) {
                            this.grid.setTerrainLayer(x, y, l as DungeonLayer,
                                l === DungeonLayer.DUNGEON ? TerrainType.FLOOR : TerrainType.NOTHING);
                        }
                    }
                    for (const [dx, dy] of DIRS8) {
                        const nx = x + dx!, ny = y + dy!;
                        if (!this.grid.isValidPos(nx, ny)) continue;
                        if (this.grid.getCell(nx, ny)!.layers[DungeonLayer.DUNGEON] === TerrainType.GRANITE) {
                            this.grid.setTerrainLayer(nx, ny, DungeonLayer.DUNGEON, TerrainType.WALL);
                        }
                    }
                }
            }
        }

        // 收尾：interior 内的门与密门清成 FLOOR（CE :666-674）。
        for (const k of interior) {
            const x = k % DCOLS, y = Math.floor(k / DCOLS);
            if (!inMapInner(x, y)) continue;
            const t = this.grid.getCell(x, y)!.layers[DungeonLayer.DUNGEON]!;
            if (t === TerrainType.DOOR || t === TerrainType.SECRET_DOOR) {
                this.grid.setTerrainLayer(x, y, DungeonLayer.DUNGEON, TerrainType.FLOOR);
            }
        }
    }

    /**
     * V-1c：CE copyMap(pmap, p->levelBackup)（Architect.c:1222，point of no
     * return）的 web 形态——快照整层全部格子的可变状态。恢复时逐格写回，
     * 语义等价 CE 的整图 memcpy。机器阶段的改动面（setTerrain 写
     * layers/char/color/isPassable/isOpaque；applyBlueprint 另写
     * machineNumber/trapType/altarGroupId）是这里的快照子集；其余字段
     * （探索/视野/气味等）在生成期无人写入，一并快照只为省去取舍错误。
     */
    private backupLevel(): LevelBackup {
        const snap: LevelBackup['cells'] = [];
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const c = this.grid.getCell(x, y)!;
                snap.push({
                    layers: [...c.layers],
                    char: c.char,
                    color: c.color,
                    isPassable: c.isPassable,
                    isOpaque: c.isOpaque,
                    machineNumber: c.machineNumber,
                    trapType: c.trapType,
                    altarGroupId: c.altarGroupId
                });
            }
        }
        // V-2b-2a：IMPREGNABLE 位随整图备份（CE copyMap 连 pmap.flags 一起复制）。
        return { cells: snap, impregnable: [...this.impregnableCells] };
    }

    /** CE copyMap(p->levelBackup, pmap)（:1578/:1681）的 web 形态。 */
    private restoreLevel(snap: LevelBackup): void {
        let i = 0;
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const c = this.grid.getCell(x, y)!;
                const s = snap.cells[i++]!;
                c.layers = [...s.layers];
                c.char = s.char;
                c.color = s.color;
                c.isPassable = s.isPassable;
                c.isOpaque = s.isOpaque;
                c.machineNumber = s.machineNumber;
                c.trapType = s.trapType;
                c.altarGroupId = s.altarGroupId;
            }
        }
        this.impregnableCells = new Set(snap.impregnable);
        // V-2b-2a：IN_LOOP 快照若在失败机器的落位期间懒算过，网格已恢复到
        // 收集态，必须作废（gateAnalysisCache 无此问题——它只在选址期、
        // point of no return 之前收集）。
        this.loopMapCache = null;
    }

    /**
     * Find a cell for placing a feature, respecting flags and personal space.
     * V-2b-1：center 形参删除——NEAR_ORIGIN 的距离基准改为 origin 后，
     * 本方法不再需要机器 center（CE cellIsFeatureCandidate 同样只收 originX/Y，
     * Architect.c:490-497）。
     *
     * V-2b-2a：CE cellIsFeatureCandidate（Architect.c:492-588）的资格判定整体
     * 接入（私有 cellIsFeatureCandidate，七步顺序照抄）。候选域按旗标分三路：
     *   - MF_BUILD_IN_WALLS / MF_BUILD_ANYWHERE_ON_LEVEL：全图光栅扫描
     *     （CE :1362-1377 的 DCOLS×DROWS 扫描序），均匀随机取一（CE :1413
     *     rand_range(1, qualifyingTileCount) 的 web 等价）；
     *   - 其余：机器 interior 域（web 的 availableCells = 预洗牌的 room.cells），
     *     逐格过全判；NEAR/FAR_ORIGIN 沿用 V-2b-1 登记的曼哈顿留形近似
     *     （最近/最远），不改 NEAR_ORIGIN 既有行为。
     */
    private findFeaturePosition(
        available: Pos[],
        used: Set<number>,
        struck: Set<number>,
        origin: Pos,
        _feature: FeatureDef,
        fFlags: Set<string>,
        bpFlags: ReadonlySet<string>,
        machineNum: number,
        interior: Set<number>
    ): Pos | null {
        if (fFlags.has('MF_BUILD_AT_ORIGIN')) {
            // V-2a（CE Architect.c:520-522 / :1404-1407）：MF_BUILD_AT_ORIGIN 的
            // feature 恒落在机器 origin（=门位）——候选资格函数在 personalSpace/
            // occupied 检查之前就直接放行 origin，因此这里也无视 usedCells。
            // reward 蓝图的前厅递归 feature 与 vestibule_locked 的锁门/钥匙
            // feature 都靠它钉在门位上。
            // V-2b-2a：NOT_IN_HALLWAY / NOT_ON_LEVEL_PERIMETER 两步**先于**
            // origin 检查（CE :504-516，源码注释明言该顺序有语义）——走廊或
            // 边界上的 origin 使 BUILD_AT_ORIGIN feature 无落格（min 检查随后
            // 整机失败；CE 注释「an area machine will fail altogether」）。
            return this.cellIsFeatureCandidate(origin.x, origin.y, origin, interior, machineNum, fFlags, bpFlags)
                ? origin
                : null;
        }

        if (fFlags.has('MF_BUILD_IN_WALLS') || fFlags.has('MF_BUILD_ANYWHERE_ON_LEVEL')) {
            // CE :1362-1377：全图候选扫描（x 外层 y 内层），随机取一。
            // occupied/struck 在扫描处排除——CE 的 occupied 检查在
            // cellIsFeatureCandidate :527，两处口径一致（used = occupied）。
            const candidates: Pos[] = [];
            for (let x = 0; x < DCOLS; x++) {
                for (let y = 0; y < DROWS; y++) {
                    const k = cellKey(x, y);
                    if (used.has(k) || struck.has(k)) continue;
                    if (this.cellIsFeatureCandidate(x, y, origin, interior, machineNum, fFlags, bpFlags)) {
                        candidates.push({ x, y });
                    }
                }
            }
            if (candidates.length === 0) return null;
            return candidates[rng.randRange(0, candidates.length - 1)]!;
        }

        if (fFlags.has('MF_NEAR_ORIGIN') || fFlags.has('MF_FAR_FROM_ORIGIN')) {
            // V-2b-1：距离基准从 center 改为 origin（CE Architect.c:1336-1341 的
            // distance25 界与 :1343-1349 的 viewMask 都以 originX/originY 为源，
            // :1257 calculateDistances 也是从 origin 起算——ORIGIN 系旗标全部
            // 以 origin 为基准，无一例外）。web 用曼哈顿距离近似 CE 的路径
            // 距离分位界（已知留形偏差，P1-33 同族）；基准点必须同。
            // 对 BP_ROOM 机器这是行为变化（前厅机器 center==origin，不受影响）。
            // V-2b-2a：FAR_FROM_ORIGIN（CE :1340-1341，distanceBound[0] =
            // distance75）取同一近似的镜像——最远未用格。CE 的 25/75 分位界
            // 需要 interior 路径距离直方图（:1257-1288），web 无该设施，登记
            // 留形缺口（与 NEAR 同族，不单独建距离图）。
            const near = fFlags.has('MF_NEAR_ORIGIN');
            let best: Pos | null = null;
            let bestDist = near ? Infinity : -1;
            for (const p of available) {
                const k = cellKey(p.x, p.y);
                if (used.has(k) || struck.has(k)) continue;
                if (!this.cellIsFeatureCandidate(p.x, p.y, origin, interior, machineNum, fFlags, bpFlags)) continue;
                const d = Math.abs(p.x - origin.x) + Math.abs(p.y - origin.y);
                if (near ? d < bestDist : d > bestDist) {
                    bestDist = d;
                    best = p;
                }
            }
            return best;
        }

        // Default: pick first unused cell (already shuffled)
        for (const p of available) {
            const k = cellKey(p.x, p.y);
            if (used.has(k) || struck.has(k)) continue;
            if (this.cellIsFeatureCandidate(p.x, p.y, origin, interior, machineNum, fFlags, bpFlags)) {
                return p;
            }
        }
        return null;
    }

    /**
     * V-2b-2a：CE cellIsFeatureCandidate（Architect.c:492-588）的逐句移植。
     * 七步顺序照抄——顺序本身有语义（CE :504-506 注释：NOT_IN_HALLWAY 先于
     * origin 检查，area machine 的 origin 落在走廊而必须建在 origin 的 feature
     * 又不许走廊时，整台机器失败）。
     *
     * web 缺失判据的处置（报告 §1 详）：
     *   - passableArcCount：web 有（ItemSpawnHeatMap.ts:113，CE :171 逐句移植，
     *     含 cellIsPassableOrDoor 的密门/锁门豁免）——直接用；
     *   - IN_LOOP：web 有 CE 口径移植 analyzeLoopMap（LoopMap.ts:359，C-0）——
     *     引擎内懒算一份陈旧快照（CE 的 pmap IN_LOOP 同为建层期预计算、机器
     *     阶段不重算），失效点与 chokeMap 分析缓存一致；
     *   - IS_CHOKEPOINT：用 analyzeChokeMap 的 chokepoint（web 既有的
     *     IS_CHOKEPOINT 等价物，gateSite 同源；其 passMap 口径是
     *     terrainAllowsMove 而非 CE 的 T_PATHING_BLOCKER，已知留形）；
     *   - viewMap（IN_VIEW_OF_ORIGIN 族，CE :531-535）：web 无载体无实现，
     *     生产数据零旗标——登记缺口，不假装有；
     *   - distanceMap 界（CE :537-557）：web 无 interior 路径距离设施，NEAR/
     *     FAR 以曼哈顿最近/最远选格近似（V-2b-1 留形），界折叠进选格策略，
     *     不在候选判定里。
     */
    private cellIsFeatureCandidate(
        x: number,
        y: number,
        origin: Pos,
        interior: Set<number>,
        machineNum: number,
        fFlags: Set<string>,
        bpFlags: ReadonlySet<string>
    ): boolean {
        const cell = this.grid.getCell(x, y);
        if (!cell) return false;

        // 1.（CE :504-510）不许走廊——检查先于 origin 检查（顺序有语义）。
        if (fFlags.has('MF_NOT_IN_HALLWAY') && passableArcCount(this.grid, x, y) > 1) {
            return false;
        }

        // 2.（CE :512-516）不许层边界。
        if (fFlags.has('MF_NOT_ON_LEVEL_PERIMETER')
            && (x === 0 || x === DCOLS - 1 || y === 0 || y === DROWS - 1)) {
            return false;
        }

        // 3.（CE :518-524）BUILD_AT_ORIGIN：origin 恒合格（反之仅 origin）；
        //    BP_ROOM 的 origin（=门口）对其余 feature 不是候选。
        if (fFlags.has('MF_BUILD_AT_ORIGIN')) {
            return x === origin.x && y === origin.y;
        } else if (bpFlags.has('BP_ROOM') && x === origin.x && y === origin.y) {
            return false;
        }

        // （CE :526-529 occupied——web 的 used/struck 由调用方先行排除，口径
        // 一致：usedCells = center/door 预留 + personalSpace + 已落格。）
        // （CE :531-535 viewMap 与 :537-557 distance 界——见方法头注的处置。）

        // 4.（CE :558-575）MF_BUILD_IN_WALLS：墙、非 interior、machineNumber
        //    为 0 或本机，且四正方向之一是 interior（非 origin），或
        //    BUILD_ANYWHERE 下非 T_PATHING_BLOCKER 且 machineNumber==0。
        if (fFlags.has('MF_BUILD_IN_WALLS')) {
            if (!interior.has(cellKey(x, y))
                && (cell.machineNumber === 0 || cell.machineNumber === machineNum)
                && (cellTerrainFlags(this.grid, x, y) & T_OBSTRUCTS_PASSABILITY) !== 0) {
                for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                    const nx = x + dx!;
                    const ny = y + dy!;
                    if (nx < 0 || ny < 0 || nx >= DCOLS || ny >= DROWS) continue;
                    const nCell = this.grid.getCell(nx, ny);
                    if (!nCell) continue;
                    const nInterior = interior.has(cellKey(nx, ny))
                        && !(nx === origin.x && ny === origin.y);
                    const nAnywhere = fFlags.has('MF_BUILD_ANYWHERE_ON_LEVEL')
                        && (cellTerrainFlags(this.grid, nx, ny) & T_PATHING_BLOCKER) === 0
                        && nCell.machineNumber === 0;
                    if (nInterior || nAnywhere) return true;
                }
            }
            return false;
        }

        // 5.（CE :575-576）未明令不得建在墙里。
        if ((cellTerrainFlags(this.grid, x, y) & T_OBSTRUCTS_PASSABILITY) !== 0) {
            return false;
        }

        // 6.（CE :577-583）MF_BUILD_ANYWHERE_ON_LEVEL：带 MF_GENERATE_ITEM 时
        //    额外排除 T_OBSTRUCTS_ITEMS|T_PATHING_BLOCKER 与
        //    IS_CHOKEPOINT|IN_LOOP|IS_IN_MACHINE；否则只要求不在机器内。
        if (fFlags.has('MF_BUILD_ANYWHERE_ON_LEVEL')) {
            if (fFlags.has('MF_GENERATE_ITEM')
                && ((cellTerrainFlags(this.grid, x, y) & (T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER)) !== 0
                    || this.getGateAnalysis().chokepoint[x]![y]!
                    || this.getLoopMap()[x]![y]!
                    || cell.machineNumber !== 0)) {
                return false;
            }
            return cell.machineNumber === 0;
        }

        // 7.（CE :584-585）interior 恒合格。
        return interior.has(cellKey(x, y));
    }

    /** V-2b-2a：IN_LOOP 陈旧快照的懒算口（见 loopMapCache 头注）。 */
    private getLoopMap(): boolean[][] {
        if (!this.loopMapCache) {
            this.loopMapCache = analyzeLoopMap(this.grid);
        }
        return this.loopMapCache;
    }

    /**
     * V-2b-2a：MF_IMPREGNABLE 置位格的读口（impregnableCells 头注）。隧道/
     * 挖墙轮接线 crystalizeFromPlayer 的守卫与未来的 tunneling 怪时用它。
     */
    public isImpregnable(x: number, y: number): boolean {
        return this.impregnableCells.has(cellKey(x, y));
    }

    /**
     * Mark cells within radius as used so subsequent features stay away.
     * V-2b-1：边长口径对齐 CE（Architect.c:1459-1470，循环范围
     * `featX-ps+1 .. featX+ps-1`，边长 2ps−1——"0 means nothing gets cleared,
     * 1 means only the tile itself, and 2 means the 3x3 grid centered on it"）。
     * 旧 web 口径 `-r..r`（边长 2r+1）把 ps=2 清成 5×5、ps=1 清出 3×3 邻域。
     * 中心格不在此补：applyBlueprint 已先于本调用把落格加进 usedCells
     * （CE 是在同一循环里连中心一起 occupied，两边等价）。
     */
    private markPersonalSpace(center: Pos, radius: number, used: Set<number>) {
        for (let dx = -(radius - 1); dx <= radius - 1; dx++) {
            for (let dy = -(radius - 1); dy <= radius - 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                // V-2b-2a：CE :1468 coordinatesAreInMap 守卫——cellKey 是数字
                // 线性键，出界格（如 x=-1）会与邻行末列碰撞，必须显式剔除。
                const nx = center.x + dx;
                const ny = center.y + dy;
                if (nx < 0 || ny < 0 || nx >= DCOLS || ny >= DROWS) continue;
                used.add(cellKey(nx, ny)); // V-2b-2a：键统一 cellKey
            }
        }
    }
}

/**
 * CE addTileToMachineInteriorAndIterate（Architect.c:404-434）的移植：
 * 从门格出发把机器内部映射出来。扩展约束（CE 417-421）：
 *   chokeMap[邻] <= chokeMap[当前]——只往"被堵住后同样封死"的方向长，
 *   因此内部恰好是门后那块死角，绝不会漫进通往关卡其余部分的通路
 * （通路格的 chokeMap 是整片外侧区域的大小或 30000，恒大于门的死角值）。
 * CE 的中止条件里 HAS_ITEM 一支在 web 不成立（机器阶段物品尚未落地，
 * 只有 MachineResult 指令），"触及其他机器即放弃"一支对应 machineNumber
 * ——web 已建机器的门格在新鲜分析里不是 IS_GATE_SITE（已从 passMap 剔除），
 * 故 CE 的"非门位机器格"豁免不会出现，统一为"触及任何机器格即放弃"。
 * CE 递归实现，这里用显式栈：扩展集是"沿非递增 chokeMap 路径可达格"，
 * 与遍历序无关，中止判定（存在已达格邻接机器格）同样是阶独立的。
 * 返回内部格列表（含门格）；撞机器返回 null。
 */
export function mapMachineInterior(
    grid: Grid,
    analysis: ChokeAnalysis,
    gate: Pos
): Pos[] | null {
    const key = (x: number, y: number): number => y * DCOLS + x;
    const interior = new Set<number>([key(gate.x, gate.y)]);
    const stack: Pos[] = [{ x: gate.x, y: gate.y }];
    while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = cur.x + dx!;
            const ny = cur.y + dy!;
            if (nx < 0 || nx >= DCOLS || ny < 0 || ny >= DROWS) continue;
            if ((grid.getCell(nx, ny)?.machineNumber ?? 0) !== 0) return null; // CE 410-414
            const nk = key(nx, ny);
            if (interior.has(nk)) continue;
            if (analysis.chokeMap[nx]![ny]! <= analysis.chokeMap[cur.x]![cur.y]!) {
                interior.add(nk); // CE 417-421
                stack.push({ x: nx, y: ny });
            }
        }
    }
    return [...interior].map(k => ({ x: k % DCOLS, y: Math.floor(k / DCOLS) }));
}

/** Reset the machine number counter (call when generating a new level) */
export function resetMachineCounter() {
    nextMachineNumber = 1;
}
