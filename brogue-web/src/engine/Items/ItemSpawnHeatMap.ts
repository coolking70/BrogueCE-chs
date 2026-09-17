/**
 * src/engine/Items/ItemSpawnHeatMap.ts — B-4b：物品落位热力图。
 *
 * CE `Items.c:463-535`（fillItemSpawnHeatMap / coolHeatMapAt / getItemSpawnLoc）
 * 与 `Items.c:610-633`（populateItems 内的归零 pass）、`Architect.c:171-190`
 * （passableArcCount）、`Architect.c:246-270`（IS_CHOKEPOINT 标记）的逐句移植。
 *
 * CE 模型（Items.c:608-612 注释原文）：
 *   热力图 = 「从上行楼梯到达该格需穿过的门/密门数」的空间偏置。
 *   泛洪从上行梯出发，普通 DOOR +10、SECRET_DOOR +3000，每格取最小值；
 *   选点按 heat 加权（rand_range(1, totalHeat) 后按 i 外 j 内扫描序累减）。
 *   因此密门后的房间被极大偏好——这正是 CE 注释
 *   "This is why there are often several items in well hidden secret rooms."
 *
 * 口径说明（与 web 既有设施的对接）：
 *   - IN_LOOP 用 LoopMap.analyzeLoopMap（CE analyzeMap 步骤 1-3 的既有移植，
 *     passMap = !blocksPathing，TM_IS_SECRET 豁免）；
 *   - IS_CHOKEPOINT 按同一 passMap 口径在本文件重算（CE Architect.c:246-270，
 *     算法与 LoopMap.analyzeChokeMap 步骤 4 逐字同源；后者整体口径是
 *     terrainAllowsMove/canMoveTo 系，服务于机器选址，不在此复用）；
 *   - IS_IN_MACHINE 由调用方注入（Game.populateLevel 的 machineCells，
 *     CE pmap 的 machineNumber != 0）；
 *   - T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER 与泛洪的旗标检查按 CE
 *     cellHasTerrainFlag 语义取**四层并集**（TerrainCatalog.TERRAIN_FLAGS）；
 *   - 泛洪的 isPassableOrSecretDoor（Monsters.c:3672）里 CE 还要求
 *     `!(discoveredTerrainFlagsAtLoc & T_OBSTRUCTS_PASSABILITY)`——生成期
 *     玩家记忆为空、discovered == 当前地形，该条件退化为 TM_IS_SECRET 本身。
 *
 * 确定性：build / coolHeatMapAt / passableArcCount 不消费 RNG；
 * getItemSpawnLoc 每次恰消费 1 次掷骰（CE rand_range(1, totalHeat) 同形）。
 * fillItemSpawnHeatMap 按 CE 保持**递归**形态（展开顺序影响结果，勿改 BFS）。
 */
import { DCOLS, DROWS, DungeonLayer, TerrainType, type Cell, type Grid } from '../Map/Grid';
import {
    TERRAIN_FLAGS,
    T_OBSTRUCTS_ITEMS,
    T_PATHING_BLOCKER,
    T_OBSTRUCTS_PASSABILITY,
    T_IS_DEEP_WATER,
    T_LAVA_INSTA_DEATH,
    T_AUTO_DESCENT,
    TM_IS_SECRET,
    TM_PROMOTES_WITH_KEY,
    TM_CONNECTS_LEVEL,
} from '../Map/TerrainCatalog';
import { analyzeLoopMap, blocksPathing } from '../Map/LoopMap';
import { terrainAllowsMove } from '../Map/Connectivity';
import { rng } from '../Random';
import type { Pos } from '../../types';

/** CE GlobalsBase.c:39 cDirs（顺时针八方向，序与 passableArcCount 的环绕计数绑定）。 */
const CDIRS: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 1], [1, 0], [1, -1],
    [0, -1], [-1, -1], [-1, 0], [-1, 1],
];

/** CE nbDirs（四正方向；泛洪扩散只用它，CE Items.c:473 `dir < 4`）。 */
const NB_DIRS: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 0], [0, -1], [-1, 0],
];

/** CE 泛洪/归零前的全图初值（Items.c:610；"未到达的孤岛"哨兵）。 */
export const HEATMAP_INITIAL = 50000;

function inMap(x: number, y: number): boolean {
    return x >= 0 && x < DCOLS && y >= 0 && y < DROWS;
}

/** CE cellHasTerrainFlag 的四层并集（Rogue.h 旗标位）。 */
function cellTerrainFlagUnion(cell: Cell): number {
    let flags = 0;
    for (const t of cell.layers) {
        if (t === TerrainType.NOTHING) continue;
        flags |= TERRAIN_FLAGS[t].flags;
    }
    return flags;
}

/** CE cellHasTMFlag 的四层并集。 */
function cellMechFlagUnion(cell: Cell): number {
    let flags = 0;
    for (const t of cell.layers) {
        if (t === TerrainType.NOTHING) continue;
        flags |= TERRAIN_FLAGS[t].mechFlags;
    }
    return flags;
}

/**
 * CE Monsters.c:3672 isPassableOrSecretDoor（生成期口径，见文件头）：
 * 不挡通行，或（TM_IS_SECRET 且未揭示为阻挡——生成期恒未揭示）。
 */
function isPassableOrSecretDoor(cell: Cell): boolean {
    if (!cell) return false;
    if ((cellTerrainFlagUnion(cell) & T_OBSTRUCTS_PASSABILITY) === 0) return true;
    return (cellMechFlagUnion(cell) & TM_IS_SECRET) !== 0;
}

/** CE Architect.c:48 cellIsPassableOrDoor（passableArcCount 的邻格判据）。 */
function cellIsPassableOrDoor(cell: Cell): boolean {
    if (!cell) return false;
    if ((cellTerrainFlagUnion(cell) & T_PATHING_BLOCKER) === 0) return true;
    const mech = cellMechFlagUnion(cell);
    return (mech & (TM_IS_SECRET | TM_PROMOTES_WITH_KEY | TM_CONNECTS_LEVEL)) !== 0
        && (cellTerrainFlagUnion(cell) & T_OBSTRUCTS_PASSABILITY) !== 0;
}

/**
 * CE Architect.c:171 passableArcCount：绕格一周数 8 邻域
 * 「可通行(或门)↔阻挡」的跳变次数 / 2。
 * 0=四周全通，1=贴墙，2=走廊，3=T 形口，4=十字口。
 */
export function passableArcCount(grid: Grid, x: number, y: number): number {
    let arcCount = 0;
    for (let dir = 0; dir < 8; dir++) {
        const oldX = x + CDIRS[(dir + 7) % 8]![0]!;
        const oldY = y + CDIRS[(dir + 7) % 8]![1]!;
        const newX = x + CDIRS[dir]![0]!;
        const newY = y + CDIRS[dir]![1]!;
        const newPass = inMap(newX, newY) && !!grid.getCell(newX, newY) && cellIsPassableOrDoor(grid.getCell(newX, newY)!);
        const oldPass = inMap(oldX, oldY) && !!grid.getCell(oldX, oldY) && cellIsPassableOrDoor(grid.getCell(oldX, oldY)!);
        if (newPass !== oldPass) arcCount++;
    }
    return arcCount / 2; // 入墙一次出墙一次，各计了一次
}

/** 零 pass 的格排除项（CE Items.c:613-618 的 pmap 旗标半边）。 */
export interface HeatMapExclusions {
    /** CE IS_IN_MACHINE：本层机器格（y * DCOLS + x）。 */
    machineCells: Set<number>;
}

/**
 * CE Items.c:463-482 fillItemSpawnHeatMap —— 递归泛洪（照抄递归形态）。
 * 起始 heat 由调用方给（populateItems 用 5）；途经 DUNGEON 层 DOOR +10、
 * SECRET_DOOR +3000；每格取最小值；四正方向扩散；邻格须非
 * (深水|岩浆|深渊) 且 isPassableOrSecretDoor 且当前 heat 更小。
 */
function fillItemSpawnHeatMap(
    heat: Uint16Array,
    grid: Grid,
    heatLevel: number,
    x: number,
    y: number
): void {
    const cell = grid.getCell(x, y);
    if (cell && cell.layers[DungeonLayer.DUNGEON] === TerrainType.DOOR) {
        heatLevel += 10;
    } else if (cell && cell.layers[DungeonLayer.DUNGEON] === TerrainType.SECRET_DOOR) {
        heatLevel += 3000;
    }
    const idx = y * DCOLS + x;
    if (heat[idx]! > heatLevel) {
        heat[idx] = heatLevel;
    }
    for (let dir = 0; dir < 4; dir++) {
        const nx = x + NB_DIRS[dir]![0]!;
        const ny = y + NB_DIRS[dir]![1]!;
        if (!inMap(nx, ny)) continue;
        const neighbor = grid.getCell(nx, ny);
        if (!neighbor) continue;
        const nFlags = cellTerrainFlagUnion(neighbor);
        if (nFlags & (T_IS_DEEP_WATER | T_LAVA_INSTA_DEATH | T_AUTO_DESCENT)) continue;
        if (!isPassableOrSecretDoor(neighbor)) continue;
        if (heatLevel < heat[ny * DCOLS + nx]!) {
            fillItemSpawnHeatMap(heat, grid, heatLevel, nx, ny);
        }
    }
}

/**
 * CE Architect.c:246-270 IS_CHOKEPOINT 标记（passMap 用 CE 口径
 * blocksPathing，与 analyzeLoopMap 同源）：内部格、可通行、不在环上，
 * 绕格一周第 3 次跳变时若上下皆墙或左右皆墙（夹缝）→ 割点。
 */
function markChokepoints(grid: Grid, loop: boolean[][]): boolean[][] {
    const passMap: boolean[][] = [];
    for (let x = 0; x < DCOLS; x++) {
        passMap[x] = new Array<boolean>(DROWS);
        for (let y = 0; y < DROWS; y++) {
            const cell = grid.getCell(x, y);
            passMap[x]![y] = !!cell && !blocksPathing(cell);
        }
    }
    const chokepoint: boolean[][] = [];
    for (let x = 0; x < DCOLS; x++) chokepoint[x] = new Array<boolean>(DROWS).fill(false);
    for (let i = 1; i < DCOLS - 1; i++) {
        for (let j = 1; j < DROWS - 1; j++) {
            if (!passMap[i]![j] || loop[i]![j]) continue;
            let arcCount = 0;
            for (let dir = 0; dir < 8; dir++) {
                const oldX = i + CDIRS[(dir + 7) % 8]![0]!;
                const oldY = j + CDIRS[(dir + 7) % 8]![1]!;
                const newX = i + CDIRS[dir]![0]!;
                const newY = j + CDIRS[dir]![1]!;
                const newPass = inMap(newX, newY) && passMap[newX]![newY];
                const oldPass = inMap(oldX, oldY) && passMap[oldX]![oldY];
                if (newPass !== oldPass) {
                    if (++arcCount > 2) {
                        if ((!passMap[i - 1]![j] && !passMap[i + 1]![j])
                            || (!passMap[i]![j - 1] && !passMap[i]![j + 1])) {
                            chokepoint[i]![j] = true;
                        }
                        break;
                    }
                }
            }
        }
    }
    return chokepoint;
}

/**
 * 「玩家可达」8 向洪泛（canMoveTo 镜像 ∪ SECRET_DOOR，与 c_3 连通性闸门同口径）。
 * 仅服务于下方 build 的失败保护（见该处注释），不参与 heat 值计算。
 */
function playerReachableFrom(grid: Grid, start: Pos): boolean[] {
    const result = new Array<boolean>(DCOLS * DROWS).fill(false);
    const seen = new Uint8Array(DCOLS * DROWS);
    if (!inMap(start.x, start.y)) return result;
    const passable = (x: number, y: number): boolean => {
        const cell = grid.getCell(x, y);
        if (!cell) return false;
        return terrainAllowsMove(cell.terrain) || cell.terrain === TerrainType.SECRET_DOOR;
    };
    if (!passable(start.x, start.y)) return result;
    const queue: number[] = [start.y * DCOLS + start.x];
    seen[start.y * DCOLS + start.x] = 1;
    for (let h = 0; h < queue.length; h++) {
        const idx = queue[h]!;
        const x = idx % DCOLS;
        const y = (idx - x) / DCOLS;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (!dx && !dy) continue;
                const nx = x + dx!;
                const ny = y + dy!;
                if (!inMap(nx, ny)) continue;
                const nIdx = ny * DCOLS + nx;
                if (seen[nIdx] || !passable(nx, ny)) continue;
                seen[nIdx] = 1;
                queue.push(nIdx);
            }
        }
    }
    for (let i = 0; i < seen.length; i++) result[i] = seen[i] === 1;
    return result;
}

/**
 * 物品落位热力图（CE populateItems 的落位半边）。
 * 用法：build() → 循环 { getItemSpawnLoc() → coolHeatMapAt() }。
 */
export class ItemSpawnHeatMap {
    /** 扁平化 heatMap[i=x][j=y]（CE 二维表的 y*DCOLS+x 折叠）。 */
    private readonly heat: Uint16Array;
    private totalHeat: number = 0;

    private constructor(heat: Uint16Array, totalHeat: number) {
        this.heat = heat;
        this.totalHeat = totalHeat;
    }

    public get currentTotalHeat(): number {
        return this.totalHeat;
    }

    public heatAt(x: number, y: number): number {
        return this.heat[y * DCOLS + x]!;
    }

    /**
     * CE Items.c:608-633：初始化 50000 → 自上行梯泛洪 → 归零 pass
     * （墙/物品阻挡/走廊/割点/环上/机器格 → 0；50000 孤岛 → 0 且该格改 WALL）
     * → 累加 totalHeat。
     *
     * 归零 pass 的失败保护会把孤岛格**写入网格**（CE 同款："due to a bug that
     * created occasional isolated one-cell islands"）——这是 build 唯一的
     * 网格变异，纯函数性由此打破（CE 同样如此）。
     *
     * **改墙判据的一处 web 口径修正（偏离 CE 字面，登记报告）**：CE 对
     * heat==50000（4 向泛洪不可达）的格一律改墙；web 的合法地形存在
     * 「8 向对角可达、4 向不可达」的凹格（web 移动是 8 向，P1-29 口径），
     * 一律改墙会把玩家走得到的地板封死、留下嵌在墙里的 TRAP/LAVA 孤格
     * （实测 seed777/D25：628 格级连通性破坏，c_3 T12 抓到）。故 heat 值
     * 仍按 CE 4 向泛洪逐字计算（分布不变），仅**改墙动作**收窄为
     * 「8 向玩家口径（canMoveTo ∪ SECRET_DOOR）也不可达」的真孤岛——
     * CE 失败保护「封生成 bug 孤岛」的意图保留，字面行为按 web 几何修正。
     */
    public static build(
        grid: Grid,
        upstairs: Pos,
        exclusions: HeatMapExclusions
    ): ItemSpawnHeatMap {
        const heat = new Uint16Array(DCOLS * DROWS).fill(HEATMAP_INITIAL);
        if (inMap(upstairs.x, upstairs.y)) {
            fillItemSpawnHeatMap(heat, grid, 5, upstairs.x, upstairs.y);
        }

        const loop = analyzeLoopMap(grid);
        const chokepoint = markChokepoints(grid, loop);
        // 玩家 8 向可达集（改墙复核用；上行梯不可达时退化返回全 false——
        // 此时连主区域都到不了，按 CE 语义整层已是病态，失败保护照常工作）。
        const playerReachable = playerReachableFrom(grid, upstairs);

        let totalHeat = 0;
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const idx = y * DCOLS + x;
                const cell = grid.getCell(x, y);
                const blocked =
                    !cell
                    || (cellTerrainFlagUnion(cell) & (T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER)) !== 0
                    || chokepoint[x]![y]
                    || loop[x]![y]
                    || exclusions.machineCells.has(idx)
                    || passableArcCount(grid, x, y) > 1;
                if (blocked) {
                    heat[idx] = 0;
                } else if (heat[idx] === HEATMAP_INITIAL) {
                    // CE Items.c:620-624 失败保护：泛洪未到达的孤岛 → 改墙。
                    // 改墙前按 web 8 向玩家口径复核（见方法头注）。
                    heat[idx] = 0;
                    if (!playerReachable[idx]) {
                        grid.setTerrain(x, y, TerrainType.WALL, '#', 0x888888);
                    }
                }
                totalHeat += heat[idx]!;
            }
        }
        return new ItemSpawnHeatMap(heat, totalHeat);
    }

    /**
     * CE Items.c:507-535 getItemSpawnLoc：rand_range(1, totalHeat) 后按
     * **i 外层（x）、j 内层（y）** 的扫描序累减——heat 越高越易被选中；
     * 同 heat 并列时的取谁由扫描序决定（对抗③的打击面）。
     * totalHeat 耗尽（返回 null）在 CE 是 assert 级病态，调用方按无格处理。
     */
    public getItemSpawnLoc(): Pos | null {
        if (this.totalHeat <= 0) return null;
        let randIndex = rng.randRange(1, this.totalHeat);
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const currentHeat = this.heat[y * DCOLS + x]!;
                if (randIndex <= currentHeat) {
                    return { x, y };
                }
                randIndex -= currentHeat;
            }
        }
        return null; // CE brogueAssert(0)：不应到达
    }

    /**
     * CE Items.c:484-505 coolHeatMapAt：选中格归零并扣 totalHeat；
     * k,l ∈ [-5,5] 邻域内 heat **恰等于** currentHeat 的格子（同热区）
     * 降为 max(1, heat/10)，并同步扣 totalHeat（对抗②的打击面）。
     */
    public coolHeatMapAt(x: number, y: number): void {
        const idx = y * DCOLS + x;
        const currentHeat = this.heat[idx]!;
        if (currentHeat === 0) return;
        this.totalHeat -= currentHeat;
        this.heat[idx] = 0;
        for (let k = -5; k <= 5; k++) {
            for (let l = -5; l <= 5; l++) {
                const nx = x + k;
                const ny = y + l;
                if (!inMap(nx, ny)) continue;
                const nIdx = ny * DCOLS + nx;
                if (this.heat[nIdx] === currentHeat) {
                    const newHeat = Math.max(1, Math.floor(this.heat[nIdx]! / 10));
                    this.heat[nIdx] = newHeat;
                    this.totalHeat -= currentHeat - newHeat;
                }
            }
        }
    }
}

export interface RandomMatchingLocationOptions {
    /** CE dungeonType：要求 layers[DUNGEON] === 该地形（-1 = 任意）。 */
    dungeonType: TerrainType | -1;
    /** CE liquidType：要求 layers[LIQUID] === 该地形（-1 = 任意）。 */
    liquidType: TerrainType | -1;
    /** CE HAS_PLAYER / HAS_MONSTER / HAS_STAIRS / HAS_ITEM 的占用查询。 */
    isOccupied: (x: number, y: number) => boolean;
    /** CE IS_IN_MACHINE。 */
    isMachineCell: (x: number, y: number) => boolean;
}

/**
 * CE Architect.c:3822 randomMatchingLocation 的拒绝式采样移植
 * （populateItems 只用它给食物/力量药水落位，Items.c:729-734）：
 * 均匀掷 (x,y)，拒绝 DUNGEON/LIQUID 层不匹配、被占用、机器格、
 * 四层旗标含 T_OBSTRUCTS_ITEMS 的格；500 次失败返回 null（CE 同数）。
 * 每次尝试恰消耗 2 次掷骰（x、y 各一次），与 CE 同形。
 */
export function randomMatchingLocation(
    grid: Grid,
    options: RandomMatchingLocationOptions
): Pos | null {
    const { dungeonType, liquidType, isOccupied, isMachineCell } = options;
    for (let failsafe = 0; failsafe < 500; failsafe++) {
        const x = rng.randRange(0, DCOLS - 1);
        const y = rng.randRange(0, DROWS - 1);
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        if (dungeonType >= 0 && cell.layers[DungeonLayer.DUNGEON] !== dungeonType) continue;
        if (liquidType >= 0 && cell.layers[DungeonLayer.LIQUID] !== liquidType) continue;
        if (isOccupied(x, y)) continue;
        if (isMachineCell(x, y)) continue;
        if (cellTerrainFlagUnion(cell) & T_OBSTRUCTS_ITEMS) continue;
        return { x, y };
    }
    return null;
}
