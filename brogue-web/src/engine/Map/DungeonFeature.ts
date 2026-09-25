/**
 * src/engine/Map/DungeonFeature.ts — CE 地形特征（dungeon feature）子系统（C-4b）
 *
 * 生成与运行时共用；算法与实例效果通过按 Grid 绑定的端口连接。
 * 三个算法与一个连通性检查，全部照 CE 源码移植（BrogueCE-master/src/brogue/
 * Architect.c，只读）：
 *   - spawnMapDF            Architect.c:3278-3330（扩散波前）
 *   - fillSpawnMap          Architect.c:3208-3276（按 drawPriority 落层）
 *   - spawnDungeonFeature   Architect.c:3359-3495（外壳：GAS 特例 / 连通性
 *     否决 / DFF_CLEAR_* 跨层清理 / subsequentDF 链）
 *   - levelIsDisconnectedWithBlockingMap  Architect.c:3137-3198
 *     （connectCell :3109-3129；cellIsPassableOrDoor :48-55）
 *
 * 复核出的 CE 实现要点（本轮逐条打开核对过）：
 *   1. spawnMapDF 的波前是 **4 向**：`nbDirs`（GlobalsBase.c:38）前 4 项为
 *      {0,-1},{0,1},{-1,0},{1,0}，循环 `dir<4`；8 向是错误实现。
 *   2. 每波结束 `startProb -= probDec`，while 条件 `madeChange && startProb > 0`
 *      在下一波**开始前**检查——衰减到 ≤0 即停，不会以 0% 掷骰。
 *   3. `T_OBSTRUCTS_SURFACE_EFFECTS` 阻挡扩散，但**该格正是 propagationTerrain
 *      时豁免**（Architect.c:3303 的 `||` 右支）；requirePropTerrain 时目标格
 *      还必须**有** propagationTerrain（:3302）。
 *   4. `t > 100` 收敛分支（:3314-3325）：波前值改写为 2、旧格改写为 1、
 *      t 归 2——防止代际计数器无限增大；老格不再作为波源。
 *   5. 种子格无条件先标记；仅当 requirePropTerrain 且种子格自身没有
 *      propagationTerrain 时，结束时把种子格清回 0（:3327-3329）。
 *   6. fillSpawnMap 的覆盖判据是 `旧 drawPriority >= 新 drawPriority`
 *      （数字小=优先级高；`>=` 含相等，CE :3228），superpriority 跳过比较；
 *      `blockedByOtherLayers` 用 `highestPriorityLayer(x,y,skipGas=true)`
 *      （Movement.c:64-80）再比一次；`layer == SURFACE` 且格上有
 *      T_OBSTRUCTS_SURFACE_EFFECTS 时禁止写入（:3230）。未落格的 spawnMap
 *      值清 0——"spawnmap 反映实际建了什么"（:3271），subsequentDF 的
 *      DFF_SUBSEQ_EVERYWHERE 因此只落在真建出来的格上。
 *   7. spawnDungeonFeature：GAS 层不走扩散，直接
 *      `volume += startProbability` 并写 GAS 层（:3384-3386；G-1 起
 *      volume 直接落在 Cell.volume 上，结果对象 `gasVolumeAdded` 仍登记）；
 *      tile=0 是合法
 *      无地形 DF，footprint=原点一格（:3415-3421）；连通性否决条件 =
 *      abortIfBlocking && 无 DFF_PERMIT_BLOCKING && (tile 带
 *      T_PATHING_BLOCKER || DFF_TREAT_AS_BLOCKING)（:3378-3381）；两个
 *      DFF_CLEAR_* 的跨层清理发生在 fill 之后（:3423-3440），作用域是
 *      **fill 后的** blockingMap（fillSpawnMap 会把它改写成实际落点）。
 *
 * 连通性检查为何新写而不复用（任务书 §二.3 的裁决，详见
 * ai_docs/c_4b_dungeon_feature_report.md）：CE 的
 * levelIsDisconnectedWithBlockingMap 是"波及带两侧区域是否在被影响带内部
 * 相触"的**局域**判据（填死整个死角口袋会放行），且 4 向、通行判据含
 * 密门/锁门豁免（cellIsPassableOrDoor）；web 的
 * Connectivity.lakeDisruptsPassability 是"全部干地仍属一个 8 向连通块"的
 * **全局**判据（会否决 CE 放行的死角填埋），BlueprintEngine 的
 * gateSealsOnlyInterior 是"单格门 + machineNumber 豁免"的另一个问题。
 * 三者判据与算法形状都不同，不能互相替代。Connectivity.ts 本轮禁改，
 * 也无需改——新函数放在本文件。
 *
 * U17a: grid-scoped effects execute evacuation, synchronous cell contact,
 * description, alarm, flash/flare and invalidation in CE order. The result is
 * an observation, never a second dispatch queue. Generation passes refresh=false;
 * recursive promotion/subsequent calls inherit the transaction. Catalog gaps
 * still fail explicitly; this round does not activate the five missing families.
 */
import type { Pos } from '../../types';
import { rng } from '../Random';
import { terrainAllowsMove } from './Connectivity';
import {
    DungeonLayer,
    DRAW_PRIORITY,
    Grid,
    TerrainType,
    type Cell,
} from './Grid';
import {
    T_AUTO_DESCENT,
    T_IS_DEEP_WATER,
    T_IS_FIRE,
    T_IS_DF_TRAP,
    T_OBSTRUCTS_EVERYTHING,
    T_LAVA_INSTA_DEATH,
    T_OBSTRUCTS_PASSABILITY,
    T_OBSTRUCTS_SURFACE_EFFECTS,
    T_PATHING_BLOCKER,
    TERRAIN_FLAGS,
    TM_CONNECTS_LEVEL,
    TM_IS_SECRET,
    TM_PROMOTES_WITH_KEY,
} from './TerrainCatalog';
import {
    DFF_ACTIVATE_DORMANT_MONSTER,
    DFF_AGGRAVATES_MONSTERS,
    DFF_BLOCKED_BY_OTHER_LAYERS,
    DFF_CLEAR_LOWER_PRIORITY_TERRAIN,
    DFF_CLEAR_OTHER_TERRAIN,
    DFF_EVACUATE_CREATURES_FIRST,
    DFF_PERMIT_BLOCKING,
    DFF_RESURRECT_ALLY,
    DFF_SUBSEQ_EVERYWHERE,
    DFF_SUPERPRIORITY,
    DFF_TREAT_AS_BLOCKING,
    DUNGEON_FEATURE_CATALOG,
} from './DungeonFeatureCatalog';
import { T_IS_FLAMMABLE, TM_EXPLOSIVE_PROMOTE, type TerrainFlagsEntry } from './TerrainCatalog';
import { DF, type DungeonFeatureEntry } from './DungeonFeatureCatalog';
import { qualifyingNear } from '../Generator/GenerationPlacement';
import { promoteLayersWithMechFlag } from './Promotion';
import { TM_PROMOTES_ON_CREATURE } from './TerrainCatalog';
import { T_OBSTRUCTS_VISION } from './TerrainCatalog';

/** CE owns a world, not a return-value event queue. Ports are scoped to a grid;
 * recursion (including promotion during fill) sees the same live transaction. */
export interface DungeonFeatureEffects {
    creatures?(): readonly { loc: Pos; forbiddenTerrain: number }[];
    occupied?(pos: Pos): boolean;
    refreshCell?(pos: Pos): void;
    flavor?(pos: Pos): void;
    instantEffects?(pos: Pos): void;
    burnItems?(pos: Pos): void;
    caughtFire?(pos: Pos): void;
    playerFireOrDescent?(): void;
    describe?(feat: DungeonFeature, origin: Pos): boolean;
    aggravate?(radius: number, origin: Pos): void;
    flare?(kind: string, origin: Pos): void;
    flash?(color: string, radius: number, origin: Pos): void;
    invalidatePathing?(): void;
    invalidateShore?(): void;
    gameHasEnded?(): boolean;
}
export interface DungeonFeatureOptions {
    refreshSideEffects?: boolean;
    effects?: DungeonFeatureEffects;
}
const featureEffects = new WeakMap<Grid, DungeonFeatureEffects>();
type FeatureTransaction = DungeonFeatureOptions & { caughtFire: Pos[] };
const activeOptions = new WeakMap<Grid, FeatureTransaction>();
const displayedMessages = new WeakMap<Grid, Set<DF | DungeonFeature>>();
export function setDungeonFeatureEffects(grid: Grid, effects: DungeonFeatureEffects | null): void {
    if (effects) featureEffects.set(grid, effects);
    else featureEffects.delete(grid);
}
export function resetDFMessageEligibility(grid: Grid): void {
    displayedMessages.delete(grid);
}

function evacuateCreatures(grid: Grid, map: SpawnMap, effects: DungeonFeatureEffects): void {
    // Scan x then y, querying live positions after each relocation. Dormant
    // creatures are absent from HAS_MONSTER in CE and from this port's list.
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) {
        if (!map[y * grid.width + x]) continue;
        const creatures = effects.creatures?.() ?? [];
        const creature = creatures.find(c => c.loc.x === x && c.loc.y === y);
        if (!creature) continue;
        const next = qualifyingNear(grid, { x, y }, (nx, ny) =>
            !map[ny * grid.width + nx]
            && !(cellTerrainFlags(grid, nx, ny) & creature.forbiddenTerrain)
            && !creatures.some(c => c.loc.x === nx && c.loc.y === ny));
        // CE assumes a destination exists. On a fully sealed synthetic map,
        // preserve the entity instead of copying C's uninitialized newLoc.
        if (next) Object.assign(creature.loc, next);
    }
}

function refreshFeatureCell(grid: Grid, pos: Pos, tile: TerrainType, effects: DungeonFeatureEffects): boolean {
    refreshDungeonCellTerrain(grid, pos.x, pos.y);
    effects.refreshCell?.(pos);
    effects.flavor?.(pos);
    if (effects.instantEffects) effects.instantEffects(pos);
    else if (effects.occupied?.(pos)) {
        // Entity-free terrain clients can still supply CE occupancy. The same
        // recursive refresh handles every ON_CREATURE tile, including crystals.
        promoteLayersWithMechFlag(grid, pos.x, pos.y, TM_PROMOTES_ON_CREATURE);
    }
    if (effects.gameHasEnded?.()) return true;
    if (TERRAIN_FLAGS[tile].flags & T_IS_FIRE) effects.burnItems?.(pos);
    return false;
}

/** Compatibility fields for legacy clients; engine rules use the same flags.
 * This refresh applies to all terrain, including a promotion that only erases. */
export function refreshDungeonCellTerrain(grid: Grid, x: number, y: number): void {
    const cell = grid.getCell(x, y);
    if (!cell) return;
    const flags = cellTerrainFlags(grid, x, y);
    cell.isPassable = !(flags & T_OBSTRUCTS_PASSABILITY);
    cell.isOpaque = !!(flags & T_OBSTRUCTS_VISION);
}

/** CE `nbDirs[0..3]`（GlobalsBase.c:38）——4 向正交，顺序逐项一致。 */
const DIRS4: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
];

/**
 * CE `dungeonFeature`（Rogue.h:1886-1902）的字段投影——spawnDungeonFeature
 * 的入参形态（CE 收 `dungeonFeature*`，调用方可传目录条目或改写副本）。
 * tile=NOTHING(0) 是合法的"无地形 DF"；propagationTerrain=NOTHING(0) 表示
 * 无传播地形限制；subsequentDF 走目录解析（CE 0 = 无 → null）。
 */
export interface DungeonFeature {
    /** Stable catalog identity; custom features retain their object identity. */
    catalogId?: DF;
    tile: TerrainType;
    layer: DungeonLayer;
    startProbability: number;
    probabilityDecrement: number;
    flags: number;
    propagationTerrain: TerrainType;
    subsequentDF: DF | null;
    description: string;
    lightFlare: string;
    flashColor: string;
    effectRadius: number;
}

/** spawnMap：CE `char spawnMap[DCOLS][DROWS]`，值 = 代际计数器（≤101，
 *  t>100 收敛分支把它压回 {0,1,2}）。下标 = y * width + x。 */
export type SpawnMap = Uint8Array;

export function createSpawnMap(grid: Grid): SpawnMap {
    return new Uint8Array(grid.width * grid.height);
}

// ── CE 查格谓词（四层旗标按位或；Globals.c:581-597 / Architect.c:40-46）───
// C-4c 起导出：Promotion.ts 的两趟驱动复用同一批 CE 谓词（单份实现，
// 避免两处各抄一份 OR 循环日后漂移）。

/** CE terrainFlags(p)（Globals.c:581）：四层 TERRAIN_FLAGS 的 flags 按位或。 */
export function cellTerrainFlags(grid: Grid, x: number, y: number): number {
    const cell = grid.getCell(x, y);
    if (!cell) return 0;
    return terrainFlagsOfCell(cell);
}

/** Cell-valued form of the same four-layer query; never reads display priority. */
export function terrainFlagsOfCell(cell: Cell): number {
    let f = 0;
    for (let l = 0; l < DungeonLayer.COUNT; l++) {
        f |= TERRAIN_FLAGS[cell.layers[l]!].flags;
    }
    return f;
}

/** CE terrainMechFlags(loc)（Globals.c:590）。
 *
 *  验收方注：执行方原本在这里写成解构读取，为的是绕开
 *  `c_4a_terrain_catalog.test.ts` E 组那条"生产代码零读取点"的静态扫描
 *  （该文件当时不在它的允许修改清单里，它如实申报了）。
 *  **那样做会让留痕断言说谎**——读者确实存在了，断言却仍报"零读者"，
 *  是一次自造的假绿。正确处理是翻转那条留痕（已做，白名单化），
 *  并把扫描正则加固到能捕获解构形态（也已做）。代码恢复直白写法。 */
/** CE terrainMechFlags(loc)（Globals.c:590）。 */
export function cellTerrainMechFlags(grid: Grid, x: number, y: number): number {
    const cell = grid.getCell(x, y);
    if (!cell) return 0;
    return terrainMechFlagsOfCell(cell);
}

export function terrainMechFlagsOfCell(cell: Cell): number {
    let f = 0;
    for (let l = 0; l < DungeonLayer.COUNT; l++) {
        f |= TERRAIN_FLAGS[cell.layers[l]!].mechFlags;
    }
    return f;
}

/** U07 / CE Monsters.c:1284: OR immediate burn successors of flammable
 * layers, plus their explosive promotion. No terrain/DF execution or recursion.
 * Keep catalog queries in this module alongside the discovery query. */
export function burnedTerrainFlagsOfCell(cell: Cell): number {
    let flags = 0;
    for (const terrain of cell.layers) {
        const tile = TERRAIN_FLAGS[terrain];
        if (!(tile.flags & T_IS_FLAMMABLE)) continue;
        for (const name of [tile.fireType, ...(tile.mechFlags & TM_EXPLOSIVE_PROMOTE ? [tile.promoteType] : [])]) {
            if (!name) continue;
            const successor = DUNGEON_FEATURE_CATALOG[DF[name as keyof typeof DF]];
            if (!successor || successor.tile === null) throw new Error(`Unknown burn terrain: ${name}`);
            flags |= TERRAIN_FLAGS[successor.tile].flags;
        }
    }
    return flags;
}

/** CE Monsters.c:1259-1311: only secret layers' immediate discovery successors.
 * This is NOT the union of the resulting cell and does not execute discovery.
 * The missing DF tiles below have known CE flags (Globals.c:348/378/380/383/388/396/399);
 * querying their flags does not implement their deferred gameplay (U17).
 */
export function discoveredTerrainFlagsOfCell(cell: Cell): number {
    const missingTileFlags: Readonly<Record<string, number>> = {
        GAS_TRAP_POISON: T_IS_DF_TRAP,
        TRAP_DOOR: T_AUTO_DESCENT,
        FLAMETHROWER: T_IS_DF_TRAP,
        MACHINE_POISON_GAS_VENT_DORMANT: 0,
        MACHINE_METHANE_VENT_DORMANT: 0,
        MACHINE_PARALYSIS_VENT: 0,
        WALL_LEVER: T_OBSTRUCTS_EVERYTHING,
    };
    let flags = 0;
    for (const terrain of cell.layers) {
        const tile = TERRAIN_FLAGS[terrain];
        if (!(tile.mechFlags & TM_IS_SECRET) || !tile.discoverType) continue;
        const id = DF[tile.discoverType as keyof typeof DF];
        const successor = DUNGEON_FEATURE_CATALOG[id];
        if (!successor) throw new Error(`Unknown discovery DF: ${tile.discoverType}`);
        const successorFlags = successor.tile === null
            ? missingTileFlags[successor.ceTile] : TERRAIN_FLAGS[successor.tile].flags;
        if (successorFlags === undefined) throw new Error(`Unknown discovery terrain: ${successor.ceTile}`);
        flags |= successorFlags;
    }
    return flags;
}

/** CE cellHasTerrainType（Architect.c:40-46）：四层任一等于该地形。 */
function cellHasTerrainType(grid: Grid, x: number, y: number, t: TerrainType): boolean {
    const cell = grid.getCell(x, y);
    if (!cell) return false;
    for (let l = 0; l < DungeonLayer.COUNT; l++) {
        if (cell.layers[l] === t) return true;
    }
    return false;
}

/** CE cellHasTerrainFlag（Architect.c:30-33）。 */
function cellHasTerrainFlag(grid: Grid, x: number, y: number, flagMask: number): boolean {
    return (flagMask & cellTerrainFlags(grid, x, y)) !== 0;
}

/** CE cellIsPassableOrDoor（Architect.c:48-55）：无 T_PATHING_BLOCKER 直接过；
 *  否则需同时带 (TM_IS_SECRET | TM_PROMOTES_WITH_KEY | TM_CONNECTS_LEVEL)
 *  与 T_OBSTRUCTS_PASSABILITY——密门/锁门/连通层视为可通行。 */
function cellIsPassableOrDoor(grid: Grid, x: number, y: number): boolean {
    if (!cellHasTerrainFlag(grid, x, y, T_PATHING_BLOCKER)) {
        return true;
    }
    return (
        cellHasTerrainMechFlagMask(grid, x, y,
            TM_IS_SECRET | TM_PROMOTES_WITH_KEY | TM_CONNECTS_LEVEL)
        && cellHasTerrainFlag(grid, x, y, T_OBSTRUCTS_PASSABILITY)
    );
}

function cellHasTerrainMechFlagMask(grid: Grid, x: number, y: number, flagMask: number): boolean {
    return (flagMask & cellTerrainMechFlags(grid, x, y)) !== 0;
}

// ── spawnMapDF（CE Architect.c:3278-3330）─────────────────────────────────

/**
 * 从 (x, y) 起做衰减概率的 4 向扩散波前，把"将被打上地形的格"写进 spawnMap
 * （值 = 代际计数器）。RNG 消耗顺序照 CE：扫描 x 外层 y 内层、dir 0..3，
 * 每个候选格一次 `rng.randPercent(startProb)`（CE rand_percent，Math.c:62）。
 */
export function spawnMapDF(
    grid: Grid,
    x: number,
    y: number,
    propagationTerrain: TerrainType,
    requirePropTerrain: boolean,
    startProb: number,
    probDec: number,
    spawnMap: SpawnMap
): void {
    const W = grid.width;
    const idx = (px: number, py: number): number => py * W + px;

    spawnMap[idx(x, y)] = 1; // CE：spawnMap[x][y] = t = 1
    let t = 1;

    let madeChange = true;
    while (madeChange && startProb > 0) {
        madeChange = false;
        t++;
        for (let i = 0; i < grid.width; i++) {
            for (let j = 0; j < grid.height; j++) {
                if (spawnMap[idx(i, j)] === t - 1) {
                    for (let dir = 0; dir < 4; dir++) {
                        const x2 = i + DIRS4[dir]![0]!;
                        const y2 = j + DIRS4[dir]![1]!;
                        if (grid.isValidPos(x2, y2)
                            && (!requirePropTerrain
                                || (propagationTerrain > 0
                                    && cellHasTerrainType(grid, x2, y2, propagationTerrain)))
                            && (!cellHasTerrainFlag(grid, x2, y2, T_OBSTRUCTS_SURFACE_EFFECTS)
                                || (propagationTerrain > 0
                                    && cellHasTerrainType(grid, x2, y2, propagationTerrain)))
                            && rng.randPercent(startProb)) {
                            spawnMap[idx(x2, y2)] = t;
                            madeChange = true;
                        }
                    }
                }
            }
        }
        startProb -= probDec;
        if (t > 100) {
            // CE :3314-3325 收敛分支：波前 → 2，其余已标记 → 1，t 归 2。
            for (let i = 0; i < grid.width; i++) {
                for (let j = 0; j < grid.height; j++) {
                    const k = idx(i, j);
                    if (spawnMap[k] === t) {
                        spawnMap[k] = 2;
                    } else if (spawnMap[k]! > 0) {
                        spawnMap[k] = 1;
                    }
                }
            }
            t = 2;
        }
    }
    if (requirePropTerrain && !cellHasTerrainType(grid, x, y, propagationTerrain)) {
        spawnMap[idx(x, y)] = 0;
    }
}

// ── fillSpawnMap（CE Architect.c:3208-3276）───────────────────────────────

export interface FillSpawnMapOutcome {
    /** CE 返回值：是否真的建了至少一格。 */
    accomplishedSomething: boolean;
    /** CAUGHT_FIRE_THIS_TURN 登记（CE :3235-3238）：新地形是火、被覆盖层
     *  不是火的格。web 无对应格旗标，交 C-4c/游戏循环消费。 */
    caughtFireCells: Pos[];
    /** rogue.staleLoopMap 登记（CE :3240-3244）：T_PATHING_BLOCKER 归属变化。 */
    pathingChanged: boolean;
}

/**
 * 按 spawnMap 落层写地形。判据（CE :3223-3233，与顺序一致）：
 *   spawnMap 已标记 && 该层尚不是目标地形 && (superpriority || 旧优先级数字
 *   >= 新优先级数字) && !(SURFACE 层 && 格带 T_OBSTRUCTS_SURFACE_EFFECTS)
 *   && (!blockedByOtherLayers || 最高优先层(skipGas) 的优先级数字 >= 新的)。
 * 未落格的 spawnMap 值清 0（CE :3271）。
 */
export function fillSpawnMap(
    grid: Grid,
    layer: DungeonLayer,
    surfaceTileType: TerrainType,
    spawnMap: SpawnMap,
    blockedByOtherLayers: boolean,
    superpriority: boolean,
    onBuiltCell?: (pos: Pos, caughtFire: boolean) => void | boolean
): FillSpawnMapOutcome {
    const W = grid.width;
    const idx = (px: number, py: number): number => py * W + px;
    let accomplishedSomething = false;
    const caughtFireCells: Pos[] = [];
    let pathingChanged = false;

    const newPrio = DRAW_PRIORITY[surfaceTileType];
    const newFlags = TERRAIN_FLAGS[surfaceTileType].flags;

    for (let i = 0; i < grid.width; i++) {
        for (let j = 0; j < grid.height; j++) {
            const cell = grid.getCell(i, j);
            if (!cell) {
                spawnMap[idx(i, j)] = 0;
                continue;
            }
            const oldTile = cell.layers[layer]!;
            const oldFlags = TERRAIN_FLAGS[oldTile].flags;
            if (
                // spawnMap 已标记，
                spawnMap[idx(i, j)]
                // 且该层还不是目标地形，
                && oldTile !== surfaceTileType
                // 且旧地形的优先级数字更大或相等（除非 superpriority），
                && (superpriority || DRAW_PRIORITY[oldTile] >= newPrio)
                // 且不会往被禁止的 SURFACE 层里画，
                && !(layer === DungeonLayer.SURFACE
                    && cellHasTerrainFlag(grid, i, j, T_OBSTRUCTS_SURFACE_EFFECTS))
                // 且（如要求）不违反该格最高优先层的优先级。
                && (!blockedByOtherLayers
                    || DRAW_PRIORITY[cell.layers[grid.highestPriorityLayer(i, j, true)]!] >= newPrio)
            ) {
                if ((newFlags & T_IS_FIRE) && !(oldFlags & T_IS_FIRE)) {
                    caughtFireCells.push({ x: i, y: j });
                }
                if ((oldFlags & T_PATHING_BLOCKER) !== (newFlags & T_PATHING_BLOCKER)) {
                    pathingChanged = true;
                }
                // 落层！（Grid.ts setTerrainLayer：只写该层，不动其他层。）
                grid.setTerrainLayer(i, j, layer, surfaceTileType);
                accomplishedSomething = true;
                // CE fillSpawnMap :3248-3258: contact may recurse before
                // the next cell is filled. Fire registration is not refresh-gated.
                if (onBuiltCell?.({ x: i, y: j }, !!(newFlags & T_IS_FIRE) && !(oldFlags & T_IS_FIRE)) === true) {
                    return { accomplishedSomething, caughtFireCells, pathingChanged };
                }
            } else {
                spawnMap[idx(i, j)] = 0; // spawnmap 反映实际建了什么（CE :3271）
            }
        }
    }
    return { accomplishedSomething, caughtFireCells, pathingChanged };
}

// ── levelIsDisconnectedWithBlockingMap（CE Architect.c:3137-3198）─────────

/**
 * CE :3109-3129 connectCell 的迭代版（泛洪结果与递归序无关）。
 * blockingMap 为 null 时忽略阻断（CE 传 NULL 的展开相位）。
 */
function floodConnect(
    grid: Grid,
    startX: number,
    startY: number,
    zoneLabel: number,
    blockingMap: SpawnMap | null,
    zoneMap: Int16Array
): number {
    const W = grid.width;
    const idx = (px: number, py: number): number => py * W + px;
    let size = 0;
    const stack: number[] = [idx(startX, startY)];
    zoneMap[idx(startX, startY)] = zoneLabel;
    while (stack.length > 0) {
        const k = stack.pop()!;
        const cx = k % W;
        const cy = Math.floor(k / W);
        size++;
        for (let dir = 0; dir < 4; dir++) {
            const nx = cx + DIRS4[dir]![0]!;
            const ny = cy + DIRS4[dir]![1]!;
            if (!grid.isValidPos(nx, ny)) continue;
            const nk = idx(nx, ny);
            if (zoneMap[nk] !== 0) continue;
            if (blockingMap && blockingMap[nk]) continue;
            if (!cellIsPassableOrDoor(grid, nx, ny)) continue;
            zoneMap[nk] = zoneLabel;
            stack.push(nk);
        }
    }
    return size;
}

/**
 * CE levelIsDisconnectedWithBlockingMap（Architect.c:3137-3198）的逐相位移植：
 *   1. 以"贴着 blockingMap 的可通行格"为种子做 4 向分区（阻断生效）；
 *   2. 令各区漫进 blockingMap 里（阻断豁免，CE 传 NULL）；
 *   3. 两区相触 ⟹ 该 DF 足迹会切断关卡。返回 0 = 不断；!countRegionSize 时
 *      相触返回 1；countRegionSize 时返回相触区对中较小者的格数。
 * 通行判据是 cellIsPassableOrDoor（含密门/锁门豁免），不是 web 的
 * terrainAllowsMove——差异见文件头。
 */
export function levelIsDisconnectedWithBlockingMap(
    grid: Grid,
    blockingMap: SpawnMap,
    countRegionSize: boolean
): number {
    const W = grid.width;
    const H = grid.height;
    const idx = (px: number, py: number): number => py * W + px;
    const zoneMap = new Int16Array(W * H);
    const zoneSizes: number[] = [];

    // 相位 1：贴阻断带的可通行格为种子成区（CE :3149-3162）。
    for (let i = 1; i < W - 1; i++) {
        for (let j = 1; j < H - 1; j++) {
            const k = idx(i, j);
            if (cellIsPassableOrDoor(grid, i, j) && zoneMap[k] === 0 && !blockingMap[k]) {
                let borders = false;
                for (let dir = 0; dir < 4; dir++) {
                    const nx = i + DIRS4[dir]![0]!;
                    const ny = j + DIRS4[dir]![1]!;
                    if (nx >= 0 && ny >= 0 && nx < W && ny < H && blockingMap[idx(nx, ny)]) {
                        borders = true;
                        break;
                    }
                }
                if (borders) {
                    zoneSizes.push(floodConnect(grid, i, j, zoneSizes.length + 1, blockingMap, zoneMap));
                }
            }
        }
    }

    // 相位 2：各区漫进阻断带（阻断豁免；CE :3164-3177，单趟扫描）。
    for (let i = 1; i < W - 1; i++) {
        for (let j = 1; j < H - 1; j++) {
            const k = idx(i, j);
            if (blockingMap[k] && zoneMap[k] === 0 && cellIsPassableOrDoor(grid, i, j)) {
                for (let dir = 0; dir < 4; dir++) {
                    const nx = i + DIRS4[dir]![0]!;
                    const ny = j + DIRS4[dir]![1]!;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    const borderingZone = zoneMap[idx(nx, ny)]!;
                    if (borderingZone !== 0) {
                        floodConnect(grid, i, j, borderingZone, null, zoneMap);
                        break;
                    }
                }
            }
        }
    }

    // 相位 3：两区相触即切断（CE :3179-3197）。
    let smallestQualifyingZoneSize = 10000;
    for (let i = 1; i < W - 1; i++) {
        for (let j = 1; j < H - 1; j++) {
            const k = idx(i, j);
            if (zoneMap[k] !== 0) {
                for (let dir = 0; dir < 4; dir++) {
                    const nx = i + DIRS4[dir]![0]!;
                    const ny = j + DIRS4[dir]![1]!;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    const borderingZone = zoneMap[idx(nx, ny)]!;
                    if (zoneMap[k] !== borderingZone && borderingZone !== 0) {
                        if (!countRegionSize) {
                            return 1;
                        }
                        smallestQualifyingZoneSize = Math.min(smallestQualifyingZoneSize, zoneSizes[zoneMap[k]! - 1]!);
                        smallestQualifyingZoneSize = Math.min(smallestQualifyingZoneSize, zoneSizes[borderingZone - 1]!);
                        break;
                    }
                }
            }
        }
    }
    return smallestQualifyingZoneSize < 10000 ? smallestQualifyingZoneSize : 0;
}

// ── levelIsDisconnectedOnMovementGraph（C-8）──────────────────────────────

/** CE nbDirs（GlobalsBase.c:38）八向全序；web 移动无对角穿墙限制，分区、
 *  蔓延与相触判定都按 8 向。 */
const DIRS8: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/**
 * C-8：levelIsDisconnectedWithBlockingMap 的 **web 移动图同形变体**。
 *
 * 为什么需要第二个口径（C-8 诊断结论，seed12/D25 类坏层的根因，30 seed
 * × D1-D26 扫描唯一坏层）：CE 判据在「cellIsPassableOrDoor 图」（CHASM/
 * LAVA/TRAP 算阻挡）上评估；web 的移动图（canMoveTo 镜像 ∪ SECRET_DOOR，
 * P1-29/T12 口径）把 CHASM/LAVA 视作可走。DF 足迹与这类地形合围出的切断，
 * 在 CE 图里"远侧本是孤岛、不贴带、不成 zone"，相位 1 无种子、相位 3 无
 * 相触，于是放行——seed12/D25 的 DF_CRYSTAL_WALL 7 格足迹在 web 图上把
 * 808 格干地切成 436/367（上/下行楼梯分居两块，卡死局），CE 判据返回 0。
 *
 * 算法与 CE 三相位逐一同形（Architect.c:3149-3197），差异只有两处，与
 * P1-29 湖泊闸门同一裁决先例（4 向 CE 判据 → 8 向 web 移动图）：
 *   1. 通行判据 = terrainAllowsMove ∪ SECRET_DOOR（canMoveTo 镜像口径）；
 *   2. 分区、漫带、相触全部 8 向。
 *
 * 纯泛洪，**零 RNG 消耗**；只在 CE 判据与 web 图结论之外**加严**（两查
 * 并列，任一判切断即否决），不影响任何既有放行结果。
 */
export function levelIsDisconnectedOnMovementGraph(
    grid: Grid,
    blockingMap: SpawnMap
): boolean {
    const W = grid.width;
    const H = grid.height;
    const idx = (px: number, py: number): number => py * W + px;
    const movementPassable = (px: number, py: number): boolean => {
        const c = grid.getCell(px, py);
        return !!c && (terrainAllowsMove(c.terrain) || c.terrain === TerrainType.SECRET_DOOR);
    };
    const zoneMap = new Int16Array(W * H);

    /** 8 向泛洪。waiveBand=true 时无视阻断带（CE 相位 2 传 NULL 的对应），
     *  但已标号格永不重标。返回本区格数。 */
    const flood = (sx: number, sy: number, label: number, waiveBand: boolean): number => {
        let size = 0;
        const stack: number[] = [idx(sx, sy)];
        zoneMap[idx(sx, sy)] = label;
        while (stack.length > 0) {
            const k = stack.pop()!;
            const cx = k % W;
            const cy = Math.floor(k / W);
            size++;
            for (const [dx, dy] of DIRS8) {
                const nx = cx + dx!;
                const ny = cy + dy!;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const nk = idx(nx, ny);
                if (zoneMap[nk] !== 0) continue;
                if (!waiveBand && blockingMap[nk]) continue;
                if (!movementPassable(nx, ny)) continue;
                zoneMap[nk] = label;
                stack.push(nk);
            }
        }
        return size;
    };

    // 相位 1：贴阻断带的可通行格为种子成区（阻断生效；CE :3149-3162）。
    let zoneCount = 0;
    for (let i = 1; i < W - 1; i++) {
        for (let j = 1; j < H - 1; j++) {
            const k = idx(i, j);
            if (zoneMap[k] !== 0 || blockingMap[k] || !movementPassable(i, j)) continue;
            let borders = false;
            for (const [dx, dy] of DIRS8) {
                const nx = i + dx!;
                const ny = j + dy!;
                if (nx >= 0 && ny >= 0 && nx < W && ny < H && blockingMap[idx(nx, ny)]) {
                    borders = true;
                    break;
                }
            }
            if (borders) {
                zoneCount++;
                flood(i, j, zoneCount, false);
            }
        }
    }

    // 相位 2：各区漫进阻断带里本次会被改写成阻挡的可走格（阻断豁免；
    // CE :3164-3177 单趟扫描，带内已是墙的格不成员——它们不是新切断源）。
    for (let i = 1; i < W - 1; i++) {
        for (let j = 1; j < H - 1; j++) {
            const k = idx(i, j);
            if (!blockingMap[k] || zoneMap[k] !== 0 || !movementPassable(i, j)) continue;
            for (const [dx, dy] of DIRS8) {
                const nx = i + dx!;
                const ny = j + dy!;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const borderingZone = zoneMap[idx(nx, ny)]!;
                if (borderingZone !== 0) {
                    flood(i, j, borderingZone, true);
                    break;
                }
            }
        }
    }

    // 相位 3：不同区 8 向相触即切断（CE :3179-3197）。
    for (let i = 1; i < W - 1; i++) {
        for (let j = 1; j < H - 1; j++) {
            const k = idx(i, j);
            const zone = zoneMap[k]!;
            if (zone === 0) continue;
            for (const [dx, dy] of DIRS8) {
                const nx = i + dx!;
                const ny = j + dy!;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const borderingZone = zoneMap[idx(nx, ny)]!;
                if (borderingZone !== 0 && borderingZone !== zone) {
                    return true;
                }
            }
        }
    }
    return false;
}

// ── 目录条目 → 算法入参（缺 tile 的登记条目在此响亮失败）─────────────────

/** 把目录条目转成 spawnDungeonFeature 入参。tile 登记（null）的条目抛错——
 *  CE 对这些 DF 的行为在 web 无忠实语义可给，静默跳过会让 C-4c 接出
 *  "永不触发的晋升链"，故按项目授权反驳条款拒绝并点名缺的 tile。 */
/**
 * CE Movement.c:2437 discover(x, y)：每个带 TM_IS_SECRET 的层先清为 FLOOR/NOTHING，
 * 再在原点 spawn 其 discoverType DF（abortIfBlocking=false）。web 目录尚缺后继 tile 的秘密层
 * 保持原状（不伪造揭示），返回是否至少揭示了一层。供魔法测绘等调用方共用（U23）。
 */
/** 单个地形的 mechFlags（供需要逐层读取的调用方，如 U23 记忆 rememberedTMFlags；受 C-4c 读者白名单约束）。 */
export function terrainMechFlags(t: TerrainType): number {
    return TERRAIN_FLAGS[t].mechFlags;
}

export function discoverSecretsAt(grid: Grid, x: number, y: number): boolean {
    const cell = grid.getCell(x, y);
    if (!cell) return false;
    let revealed = false;
    for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
        const entry: TerrainFlagsEntry = TERRAIN_FLAGS[cell.layers[layer]!];
        if (!(entry.mechFlags & TM_IS_SECRET) || !entry.discoverType) continue;
        const id: DF | undefined = DF[entry.discoverType as keyof typeof DF];
        if (id === undefined || DUNGEON_FEATURE_CATALOG[id]?.tile == null) continue; // tile absent from web catalog
        grid.setTerrainLayer(x, y, layer, layer === DungeonLayer.DUNGEON ? TerrainType.FLOOR : TerrainType.NOTHING);
        spawnDungeonFeature(grid, x, y, catalogFeature(id), false);
        revealed = true;
    }
    return revealed;
}

export function catalogFeature(df: DF): DungeonFeature {
    const entry: DungeonFeatureEntry | undefined = DUNGEON_FEATURE_CATALOG[df];
    if (!entry) {
        throw new Error(`DUNGEON_FEATURE_CATALOG 缺 DF#${df}（本轮闭包未抄录该条目）`);
    }
    if (entry.tile === null) {
        throw new Error(
            `DF#${df}（${entry.ceTile}）引用了 web 尚不存在的 tileType，登记未实现（C-4b 目录）；`
            + `新增该地形后在本轮报告的缺 tile 清单对号翻转`
        );
    }
    return {
        catalogId: df,
        tile: entry.tile,
        layer: entry.layer,
        startProbability: entry.startProbability,
        probabilityDecrement: entry.probabilityDecrement,
        flags: entry.flags,
        propagationTerrain: entry.propagationTerrain ?? TerrainType.NOTHING,
        subsequentDF: entry.subsequentDF,
        description: entry.description,
        lightFlare: entry.lightFlare,
        flashColor: entry.flashColor,
        effectRadius: entry.effectRadius,
    };
}

// ── spawnDungeonFeature（CE Architect.c:3359-3495）────────────────────────

/**
 * V-2b-5：休眠怪唤醒者（CE Architect.c:3487-3496 的 `dormantMonsters` 遍历）。
 *
 * **为什么是回调而不是直接实现**：CE 的那段代码遍历的是全局链表
 * `dormantMonsters`，并对每只怪调 `toggleMonsterDormancy`——而 web 的休眠表
 * 与 `toggleMonsterDormancy` 都住在 `Game`（怪物列表 `Game.monsters` /
 * `Game.dormantMonsters` 是实例状态，不是模块状态）。`spawnDungeonFeature`
 * 不 import Game，因此把"谁被唤醒"这一步以回调出栈。
 *
 * **为什么按 Grid 登记**：调用点分散在 `Game`（六处 DF 直落）与
 * `Promotion.promoteTile`（晋升链落 DF，正是雕像唤醒的实际路径）。加形参
 * 要改遍所有调用点（Promotion.ts 还不在授权清单内），而模块级单例回调在
 * 测试里会跨 Game 实例串线（后建的 Game 把先建的顶掉）。`spawnDungeonFeature`
 * 本来就带着 `grid`，按 Grid 键控既无生命周期歧义（Grid 随层新建、旧层
 * 随 levels 缓存一起活着），也不会串实例。Game 在每次 `this.grid` 换新时
 * 重登记。
 *
 * @param origin     DF 的原点格（CE 条件的 `monst->loc == (x,y)` 半边）。
 * @param builtCells fill 之后的实际落点集（CE 条件的 `blockingMap` 半边）。
 */
export type DormantAwakener = (origin: Pos, builtCells: readonly Pos[]) => void;

const dormantAwakeners = new WeakMap<Grid, DormantAwakener>();

/** 按网格注册/注销休眠唤醒者（`null` = 注销）。Game 在建层/读档/建测试房后调用。 */
export function setDormantAwakener(grid: Grid, fn: DormantAwakener | null): void {
    if (fn) dormantAwakeners.set(grid, fn);
    else dormantAwakeners.delete(grid);
}

const allyResurrectors = new WeakMap<Grid, (origin: Pos) => boolean>();
export function setAllyResurrector(grid: Grid, fn: ((origin: Pos) => boolean) | null): void {
    if (fn) allyResurrectors.set(grid, fn);
    else allyResurrectors.delete(grid);
}

export interface SpawnFeatureResult {
    /** CE 返回值：false 仅当被连通性否决；"因优先级一格没建"仍算成功
     *  （CE :3410 注释）。 */
    succeeded: boolean;
    /** 实际落层的格（fill 后 blockingMap 的非零集；CE :3409 注释——fill 会
     *  把 spawnMap 改写成实际落点）。 */
    builtCells: Pos[];
    caughtFireCells: Pos[];
    pathingChanged: boolean;
    /** GAS 特例的 volume 增量（CE :3385 `pmap.volume += startProbability`；
     *  G-1 起同时直接累加进 Cell.volume——此字段保留为返回值审计口径）。 */
    gasVolumeAdded: number;
    /** DFF_EVACUATE_CREATURES_FIRST 置位（evacuateCreatures 已执行；此字段仅供审计）。 */
    evacuationRequired: boolean;
    /** CE description 审计值；已在事务起点按可见性与每回合资格派发。 */
    message: string | null;
    /** DFF_AGGRAVATES_MONSTERS && effectRadius 时的已执行的聚怪半径（审计）。 */
    aggravateRadius: number | null;
    /** CE :3481-3485：tile 带 T_IS_DEEP_WATER | T_LAVA_INSTA_DEATH |
     *  T_AUTO_DESCENT 时 CE 会置 updatedMapToShoreThisTurn = false。 */
    touchesShoreMap: boolean;
}

/**
 * 生成一个地形特征。GAS 层走 volume 累加特例；其余层走
 * spawnMapDF →（需要时）连通性否决 → fillSpawnMap → DFF_CLEAR_* 跨层清理
 * → subsequentDF 链（DFF_SUBSEQ_EVERYWHERE 时逐实际落点递归）。
 */
export function spawnDungeonFeature(
    grid: Grid,
    x: number,
    y: number,
    feat: DungeonFeature,
    abortIfBlocking: boolean,
    options?: DungeonFeatureOptions | ((pos: Pos) => void)
): SpawnFeatureResult {
    const previous = activeOptions.get(grid);
    const requested = typeof options === 'function' ? {} : options;
    const inherited: DungeonFeatureOptions = previous ?? {};
    const transaction = {
        refreshSideEffects: requested?.refreshSideEffects ?? inherited.refreshSideEffects ?? true,
        effects: { ...featureEffects.get(grid), ...inherited.effects, ...requested?.effects },
        caughtFire: previous?.caughtFire ?? [],
    };
    activeOptions.set(grid, transaction);
    try {
        const firstFire = transaction.caughtFire.length;
        const result = executeDungeonFeature(grid, x, y, feat, abortIfBlocking,
            transaction.refreshSideEffects, transaction.effects, typeof options === 'function' ? options : undefined);
        // Retain the audit/standalone-environment contract across descendants.
        result.caughtFireCells = transaction.caughtFire.slice(firstFire);
        return result;
    } finally {
        if (previous) activeOptions.set(grid, previous);
        else activeOptions.delete(grid);
    }
}

function executeDungeonFeature(
    grid: Grid, x: number, y: number, feat: DungeonFeature, abortIfBlocking: boolean,
    refresh: boolean, effects: DungeonFeatureEffects, onBuiltCell?: (pos: Pos) => void,
): SpawnFeatureResult {
    const result: SpawnFeatureResult = {
        succeeded: false,
        builtCells: [],
        caughtFireCells: [],
        pathingChanged: false,
        gasVolumeAdded: 0,
        evacuationRequired: false,
        message: feat.description || null,
        aggravateRadius: null,
        touchesShoreMap: false,
    };

    if ((feat.flags & DFF_RESURRECT_ALLY) && !allyResurrectors.get(grid)?.({ x, y })) return result;

    // CE description precedes the blocking veto and is independent of refresh.
    // During construction no cell is visible, so describe returns false.
    const seen = displayedMessages.get(grid) ?? new Set<DF | DungeonFeature>();
    displayedMessages.set(grid, seen);
    const messageKey = feat.catalogId ?? feat;
    if (feat.description && !seen.has(messageKey) && effects.describe?.(feat, { x, y })) {
        seen.add(messageKey);
    }
    const W = grid.width;
    const idx = (px: number, py: number): number => py * W + px;
    const blockingMap = createSpawnMap(grid); // CE :3375 zeroOutGrid

    // CE :3377-3381：是否按"会堵路"处理。
    const blocking = !!(
        abortIfBlocking
        && !(feat.flags & DFF_PERMIT_BLOCKING)
        && ((TERRAIN_FLAGS[feat.tile].flags & T_PATHING_BLOCKER)
            || (feat.flags & DFF_TREAT_AS_BLOCKING))
    );

    if (feat.tile !== TerrainType.NOTHING) {
        if (feat.layer === DungeonLayer.GAS) {
            // CE :3384-3386：GAS 层特例——不扩散，volume 累加，仅原点，
            // 类型无条件换型（`volume += startProb; layers[GAS] = tile`）。
            // G-1 起 Cell.volume 存在，体积直接落在格上（不再是只登记）；
            // gasVolumeAdded 保留为返回值口径（测试与调用方审计用）。
            // CE 的 volume 是 unsigned short 回绕；web 钳制在 65535
            // （触顶需单格 ≥4 支 dewar 叠加，偏离登记报告）。
            const cell = grid.getCell(x, y);
            if (cell) {
                cell.volume = Math.min(65535, cell.volume + feat.startProbability);
                grid.setTerrainLayer(x, y, DungeonLayer.GAS, feat.tile);
            }
            if (refresh) effects.refreshCell?.({ x, y });
            result.gasVolumeAdded = feat.startProbability;
            result.succeeded = true;
        } else {
            spawnMapDF(
                grid,
                x, y,
                feat.propagationTerrain,
                feat.propagationTerrain !== TerrainType.NOTHING,
                feat.startProbability,
                feat.probabilityDecrement,
                blockingMap
            );

            // C-8：连通性否决 = CE 判据 与 web 移动图判据 **并列加严**——
            // 任一判切断即放弃本次放置（两查都是纯泛洪，零 RNG 消耗；
            // 未切断的层上行为与判定成本之外零差异，生成基线不受影响）。
            // CE 单查的盲区（CHASM/LAVA 在 web 图可走导致的"孤岛不贴带"）
            // 见 levelIsDisconnectedOnMovementGraph 头注。
            if (!blocking
                || (levelIsDisconnectedWithBlockingMap(grid, blockingMap, false) === 0
                    && !levelIsDisconnectedOnMovementGraph(grid, blockingMap))) {
                if (feat.flags & DFF_EVACUATE_CREATURES_FIRST) {
                    result.evacuationRequired = true;
                    evacuateCreatures(grid, blockingMap, effects);
                }
                const fill = fillSpawnMap(
                    grid,
                    feat.layer,
                    feat.tile,
                    blockingMap,
                    !!(feat.flags & DFF_BLOCKED_BY_OTHER_LAYERS),
                    !!(feat.flags & DFF_SUPERPRIORITY),
                    (pos, caughtFire) => {
                        if (caughtFire) {
                            activeOptions.get(grid)!.caughtFire.push(pos);
                            effects.caughtFire?.(pos);
                        }
                        onBuiltCell?.(pos);
                        return refresh && refreshFeatureCell(grid, pos, feat.tile, effects);
                    }
                ); // CE :3409 注释：fill 会把 spawnMap 改写成实际落点
                result.caughtFireCells = fill.caughtFireCells;
                result.pathingChanged = fill.pathingChanged;
                if (fill.pathingChanged) effects.invalidatePathing?.();
                result.succeeded = true; // CE :3410：只有堵了关卡才算失败
            } else {
                result.succeeded = false;
            }
        }
    } else {
        // CE :3415-3421：无地形 DF——footprint = 原点一格，自动成功。
        blockingMap[idx(x, y)] = 1;
        result.succeeded = true;
        if (feat.flags & DFF_EVACUATE_CREATURES_FIRST) {
            result.evacuationRequired = true;
            evacuateCreatures(grid, blockingMap, effects);
        }
    }

    if (result.succeeded) {
        // 实际落点 = fill（或无地形分支）之后的 blockingMap 非零集；
        // SUBSEQ_EVERYWHERE 遍历的正是它（CE :3469-3476），无地形 DF 也含原点。
        for (let i = 0; i < grid.width; i++) {
            for (let j = 0; j < grid.height; j++) {
                if (blockingMap[idx(i, j)]) {
                    result.builtCells.push({ x: i, y: j });
                }
            }
        }
    }

    if (result.succeeded
        && (feat.flags & (DFF_CLEAR_LOWER_PRIORITY_TERRAIN | DFF_CLEAR_OTHER_TERRAIN))) {
        // CE :3423-3440：跨层清理，作用域是 fill 后的 blockingMap；
        // CLEAR_LOWER 保留优先级数字 ≤ 新 tile 的层（更强的地形不动）。
        for (let i = 0; i < grid.width; i++) {
            for (let j = 0; j < grid.height; j++) {
                if (!blockingMap[idx(i, j)]) continue;
                const cell = grid.getCell(i, j)!;
                for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
                    if (layer === feat.layer || layer === DungeonLayer.GAS) continue;
                    if (feat.flags & DFF_CLEAR_LOWER_PRIORITY_TERRAIN) {
                        if (DRAW_PRIORITY[cell.layers[layer]!] <= DRAW_PRIORITY[feat.tile]) {
                            continue;
                        }
                    }
                    grid.setTerrainLayer(
                        i, j,
                        layer,
                        layer === DungeonLayer.DUNGEON ? TerrainType.FLOOR : TerrainType.NOTHING
                    );
                }
            }
        }
    }

    if (result.succeeded) {
        if ((feat.flags & DFF_AGGRAVATES_MONSTERS) && feat.effectRadius) {
            result.aggravateRadius = feat.effectRadius;
            effects.aggravate?.(feat.effectRadius, { x, y });
        }
        if (refresh && feat.flashColor && feat.effectRadius) effects.flash?.(feat.flashColor, feat.effectRadius, { x, y });
        if (refresh && feat.lightFlare) effects.flare?.(feat.lightFlare, { x, y });
        result.touchesShoreMap = !!(
            feat.tile
            && (TERRAIN_FLAGS[feat.tile].flags
                & (T_IS_DEEP_WATER | T_LAVA_INSTA_DEATH | T_AUTO_DESCENT))
        );
    }

    // CE performs this even when connectivity rejected the DF.
    if (refresh && (TERRAIN_FLAGS[feat.tile].flags & (T_IS_FIRE | T_AUTO_DESCENT))) {
        effects.playerFireOrDescent?.();
    }
    if (effects.gameHasEnded?.()) return result;

    if (result.succeeded && feat.subsequentDF) {
        // CE :3467-3480：subsequentDF 经目录解析（缺 tile 的登记条目在此抛错）。
        const sub = catalogFeature(feat.subsequentDF);
        if (feat.flags & DFF_SUBSEQ_EVERYWHERE) {
            for (const p of result.builtCells) {
                spawnDungeonFeature(grid, p.x, p.y, sub, abortIfBlocking);
            }
        } else {
            spawnDungeonFeature(grid, x, y, sub, abortIfBlocking);
        }
    }

    if (result.succeeded && result.touchesShoreMap) effects.invalidateShore?.();

    // CE :3487-3496「awaken dormant creatures?」——**在 subsequentDF 链之后**
    //（CE 的第二个 `if (succeeded)` 块内部：subseqDF(:3468-3480) → 岸图
    // (:3481-3485) → 唤醒(:3487-3496)），顺序不得前移。
    //
    // CE 的条件是 `monst->loc.x == x && monst->loc.y == y || blockingMap[...]`
    // —— **原文的两个析取项都要**：前半句覆盖「DF 原点那一只」，后半句覆盖
    // 「DF 铺开的整片」。只实现前半句时，`STATUE_DORMANT {3,5}` 那种一次
    // 多格的雕像群只会活一个。
    //
    // 后半句的落点集用 `result.builtCells`（= fill 之后的 blockingMap 非零集，
    // 与本文件「CE :3409 注释：fill 会把 spawnMap 改写成实际落点」同一口径）。
    // 前半句必须**另传原点**：startProbability=0 的 DF（如 CE :679 的
    // DF_SHATTERING_SPELL）在 CE 里 blockingMap[x][y] 也不会被置位，
    // 只靠 builtCells 会漏掉原点那一只。
    //
    // web 侧没有 `dormantMonsters` 链表（它归 Game：怪物状态与 monsters 链表
    // 都在那儿），故此处以回调出栈；**未注册回调时本步静默跳过**（等价于
    // V-2b-5 之前的行为）。
    if (result.succeeded && (feat.flags & DFF_ACTIVATE_DORMANT_MONSTER)) {
        dormantAwakeners.get(grid)?.({ x, y }, result.builtCells);
    }

    return result;
}
