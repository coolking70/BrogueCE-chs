/**
 * src/engine/Map/LoopMap.ts — C-0：地牢环路（addLoops）+ IN_LOOP 标志
 *
 * CE 对照（../BrogueCE-master/src/brogue，只读事实来源）：
 *   - addLoops            Architect.c:340-396（本文件 loopDoorSiteScan + addLoops）
 *   - digDungeon 的调用点  Architect.c:2897（carveDungeon 之后、grid→pmap 落位之前）
 *   - 门位落位             Architect.c:2898-2906（grid==1→FLOOR；grid==2→
 *                         rand_percent(60) && depth<最深层 ? DOOR : FLOOR）
 *   - analyzeMap 前三步    Architect.c:192-244（IN_LOOP 初始化 + checkLoopiness
 *                         剥离 + auditLoop 泛洪去除多余标记）；chokepoint/chokeMap
 *                         部分（246-336）本轮**显式不做**（属 Phase C 后续）
 *   - checkLoopiness      Architect.c:57-118（cDirs 顺时针扫 8 邻域数串）
 *   - auditLoop           Architect.c:121-136
 *   - PDS_OBSTRUCTION=-2  Rogue.h:2783（与 Pathfinding.ts 内部的 30000 不同源，
 *                         本文件用 CE 字面值，沿用 SafetyMap/WaypointMap 的做法）
 *   - cDirs（顺时针）      GlobalsBase.c:39
 *
 * web 侧取舍（详见 ai_docs/c_0_add_loops_report.md）：
 *   - CE 在 digDungeon 里维护 0/1/2 的短整 grid、最后统一落位；web 的房间
 *     生长直接把地形盖在 Grid 上，故这里先**提取**等价短整 grid（FLOOR→1、
 *     DOOR/OPEN_DOOR→2、其余→0），扫描后只对**新产生的门位**落位——
 *     attachRooms 已落的门（CE 门位语义：代价 1、不算"两侧地板"、本身不是
 *     开门候选）与既有地板一律保持原样，等价于 CE 对 grid==1 原样落 FLOOR。
 *   - CE 门位落位的深度条件是 depthLevel < deepestLevel（40，Architect.c:2903，
 *     C 的 && 短路：最深层不掷骰）；web 最深层是护符层 26（populateLevel：
 *     depth<26 才放下楼梯），条件写作 randPercent(60) && depth < 26，求值
 *     顺序与 CE 相同（先掷骰）。
 *   - analyzeMap 的运行期重算：CE 由地形晋升改变可通行性时置 staleLoopMap
 *    （Time.c:1256 promoteTile / Architect.c:3243 机器挖掘），每玩家回合
 *     检查并重算（Time.c:2554-2556）。web 本轮文件边界内没有地形晋升的
 *     中央挂钩（门的开关不翻转 Grid.isPassable），故只在生成完成后与进层
 *     时各算一次；运行期重算待有晋升挂钩时补（报告登记）。
 */
import { Grid, TerrainType, DCOLS, DROWS, type Cell } from './Grid';
import { DijkstraMap } from './Pathfinding';
import { rng } from '../Random';
import type { Pos } from '../../types';

/** CE Architect.c:2897 `addLoops(grid, 20)` 的字面参数。 */
export const MINIMUM_PATHING_DISTANCE = 20;
/** CE Architect.c:2903 `rand_percent(60)`。 */
export const LOOP_DOOR_PERCENT = 60;
/** web 最深层（护符层，populateLevel 的 depth<26 口径）；对应 CE deepestLevel。 */
export const DEEPEST_LEVEL = 26;
/** CE Rogue.h:2783（本文件自有字面值，不动 Pathfinding.ts 的同名常量）。 */
const CE_PDS_OBSTRUCTION = -2;
/** 扫描用短整 grid 的两个非零值（CE digDungeon 的 grid 语义）。 */
export const WORK_FLOOR = 1;
export const WORK_DOOR_SITE = 2;

/** CE Architect.c:344 `dirCoords[2][2] = {{1,0},{0,1}}`——只试水平、垂直两种门。 */
const DIR_COORDS: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1]];
/** CE GlobalsBase.c:39 cDirs——顺时针（down, SE, right, NE, up, NW, left, SW）。 */
const CDIRS: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1],
];
/** CE GlobalsBase.c:38 nbDirs——auditLoop 泛洪用。 */
const NB_DIRS: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1],
];

function inMap(x: number, y: number): boolean {
    // CE Rogue.h:1241 coordinatesAreInMap：含边界的全图判定
    return x >= 0 && x < DCOLS && y >= 0 && y < DROWS;
}

/**
 * 从 web Grid 提取 CE digDungeon 语义的短整 grid：
 *   FLOOR → 1（地板）；DOOR/OPEN_DOOR → 2（门位）；其余 → 0（墙/花岗岩）。
 * 调用时机（generateTerrain：attachRooms 之后、湖泊之前）此时尚不存在
 * 密门/机器门/湖/楼梯/陷阱，映射表穷尽了可能出现的地形。
 * 门位取 2 的原因：CE 的 addLoops 在 carveDungeon 产出的 grid 上跑，carveDungeon
 * 已把房间门标记为 2（Architect.c:2411）——2 在代价图里等价 1（可通行），
 * 但 `grid[...] == 1` 的"两侧地板"检查与 `!grid[x][y]` 的候选检查都把 2 排除
 * （Architect.c:363/371-372）。web 已落的 attachRooms 门正是这个语义。
 */
export function extractWorkGrid(grid: Grid): number[][] {
    const work: number[][] = [];
    for (let x = 0; x < DCOLS; x++) {
        work[x] = new Array<number>(DROWS).fill(0);
        for (let y = 0; y < DROWS; y++) {
            const t = grid.getCell(x, y)?.terrain;
            if (t === TerrainType.FLOOR) work[x]![y] = WORK_FLOOR;
            else if (t === TerrainType.DOOR || t === TerrainType.OPEN_DOOR) work[x]![y] = WORK_DOOR_SITE;
        }
    }
    return work;
}

/**
 * CE Architect.c:360-389 的扫描主体（不含 RNG——候选顺序由 order 注入，
 * 便于对抗性测试在真实关卡 grid 上逐位对比错误实现）。
 * 候选：非地板格（work==0）且某正交方向两侧都是严格地板（work==1）；
 * 从一侧 dijkstraScan（4 向、代价图），另一侧距离 > minimumPathingDistance
 * 才开门：work[x][y]=2 且**同步 costMap[x][y]=1**（Architect.c:378-379，
 * 漏掉同步 = 后续候选用过时距离，门数偏多）。
 */
export function loopDoorSiteScan(work: number[][], order: number[], minimumPathingDistance: number): void {
    // CE Architect.c:356-358：costMap 从 grid 派生——0→PDS_OBSTRUCTION，[1,30000]→1
    const costMap: number[][] = [];
    for (let x = 0; x < DCOLS; x++) {
        costMap[x] = new Array<number>(DROWS);
        for (let y = 0; y < DROWS; y++) {
            costMap[x]![y] = work[x]![y] === 0 ? CE_PDS_OBSTRUCTION : 1;
        }
    }

    const scanner = new DijkstraMap(DCOLS, DROWS);
    const pathMap: number[][] = [];
    for (let x = 0; x < DCOLS; x++) pathMap[x] = new Array<number>(DROWS).fill(30000);

    for (let i = 0; i < order.length; i++) {
        // CE Architect.c:361-362：x = sCoord[i]/DROWS（列主序展平）
        const x = Math.floor(order[i]! / DROWS);
        const y = order[i]! % DROWS;
        if (work[x]![y] !== 0) continue; // 只考虑非地板格（门位 2 也不是候选）
        for (let d = 0; d <= 1; d++) {
            const dx = DIR_COORDS[d]![0]!;
            const dy = DIR_COORDS[d]![1]!;
            const newX = x + dx, oppX = x - dx;
            const newY = y + dy, oppY = y - dy;
            if (inMap(newX, newY) && inMap(oppX, oppY)
                && work[newX]![newY] === WORK_FLOOR && work[oppX]![oppY] === WORK_FLOOR) {
                // CE Architect.c:374-376：fillGrid(pathMap, 30000)、单种子、dijkstraScan
                for (let px = 0; px < DCOLS; px++) pathMap[px]!.fill(30000);
                pathMap[newX]![newY] = 0;
                scanner.batchScan(pathMap, costMap, false);
                if (pathMap[oppX]![oppY]! > minimumPathingDistance) {
                    work[x]![y] = WORK_DOOR_SITE; // 门位（不是地板）
                    costMap[x]![y] = 1;           // 代价图同步更新（影响后续候选）
                    break;
                }
            }
        }
    }
}

/**
 * CE Architect.c:340-347 + 360-389 的 addLoops 整体：洗牌全图顺序（消费
 * DCOLS*DROWS-1 次 rand_range，与 CE shuffleList 相同的 Fisher-Yates），
 * 扫描开门。返回 work grid 与**本轮新开**的门位坐标（raster 序）。
 * extractWorkGrid 会把 attachRooms 已落的门标成 2（CE 门位语义），它们不是
 * 本轮开的——CE 在 digDungeon 里对全部门位（含房间门位）统一掷骰落位
 * （Architect.c:2898-2905），但 web 的 attachRooms 已有自己的等价落位
 * （rand_percent(40) 的门/开/地板逻辑），按任务书"web 已有等价逻辑就复用"
 * 的口径，已落的门**不再重掷**，只落新门位。
 */
export function addLoops(
    grid: Grid,
    minimumPathingDistance: number = MINIMUM_PATHING_DISTANCE
): { work: number[][]; newSites: Pos[] } {
    const work = extractWorkGrid(grid);
    const preexisting = new Set<number>();
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            if (work[x]![y] === WORK_DOOR_SITE) preexisting.add(y * DCOLS + x);
        }
    }
    const order: number[] = [];
    for (let v = 0; v < DCOLS * DROWS; v++) order.push(v); // CE fillSequentialList
    rng.shuffleList(order);                                // CE shuffleList（Fisher-Yates）
    loopDoorSiteScan(work, order, minimumPathingDistance);
    const newSites: Pos[] = [];
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            if (work[x]![y] === WORK_DOOR_SITE && !preexisting.has(y * DCOLS + x)) {
                newSites.push({ x, y });
            }
        }
    }
    return { work, newSites };
}

/**
 * CE Architect.c:2900-2904 的门位落位（只处理 addLoops 新开的门位；既有
 * 地形原样保留）。逐格 randPercent(60) && depth<最深层 ? DOOR : FLOOR，
 * 求值顺序与 CE 的 && 短路一致（先掷骰）。返回落位坐标（raster 序），
 * 供测试/观测。
 */
export function applyLoopDoorSites(grid: Grid, sites: Pos[], depth: number): Pos[] {
    const placed: Pos[] = [];
    for (const s of sites) {
        const asDoor = rng.randPercent(LOOP_DOOR_PERCENT) && depth < DEEPEST_LEVEL;
        if (asDoor) {
            grid.setTerrain(s.x, s.y, TerrainType.DOOR, '+', 0xaa8844);
        } else {
            grid.setTerrain(s.x, s.y, TerrainType.FLOOR, '.', 0x888888);
        }
        placed.push({ x: s.x, y: s.y });
    }
    return placed;
}

/**
 * CE T_PATHING_BLOCKER（Rogue.h:1948）&& !TM_IS_SECRET 的 web 地形近似，
 * 用于 IN_LOOP 初始化（analyzeMap 第 1 步，Architect.c:200-212）：
 *   - GRANITE/WALL/LOCKED_DOOR → T_OBSTRUCTS_PASSABILITY（密门豁免，单独列）
 *   - SECRET_DOOR → TM_IS_SECRET 豁免 → 不阻挡（可开后通行，环分析视作通路）
 *   - WATER_DEEP → T_IS_DEEP_WATER；CHASM → T_AUTO_DESCENT；
 *     LAVA → T_LAVA_INSTA_DEATH；TRAP → T_IS_DF_TRAP；燃烧中 → T_IS_FIRE
 *   - 门（CE 的门不挡通行）、浅水、草/树/泥/网/楼梯/祭坛等 → 不阻挡
 */
export function blocksPathing(cell: Cell): boolean {
    if (cell.isBurning) return true; // T_IS_FIRE
    switch (cell.terrain) {
        case TerrainType.GRANITE:
        case TerrainType.WALL:
        case TerrainType.LOCKED_DOOR:
        case TerrainType.WATER_DEEP:
        case TerrainType.CHASM:
        case TerrainType.LAVA:
        case TerrainType.TRAP:
        case TerrainType.NOTHING: // 图外/未凿开；生成层上不存在，防御性归阻挡
            return true;
        default:
            return false; // 含 SECRET_DOOR（TM_IS_SECRET 豁免）
    }
}

/**
 * CE Architect.c:57-118 checkLoopiness：对单个 IN_LOOP 格判"它是否真的连着
 * 两条不同通路"。从顺时针第一个非环邻居起扫满一圈（cDirs），数环邻居构成的
 * 连续串；多于一段 → 确在环上（保留）；恰好一段且长度 ≤4 → 只是环边的
 * 附属格，剥掉 IN_LOOP 并让 8 邻域复查。返回是否剥掉。
 */
function checkLoopinessCell(loop: boolean[][], x: number, y: number): boolean {
    if (!loop[x]![y]) return false;

    // 找一个非环邻居作起点（CE 66-73）
    let sdir = 8;
    for (let d = 0; d < 8; d++) {
        const nx = x + CDIRS[d]![0]!;
        const ny = y + CDIRS[d]![1]!;
        if (!inMap(nx, ny) || !loop[nx]![ny]) {
            sdir = d;
            break;
        }
    }
    if (sdir === 8) return false; // 全邻居都在环上 → 保持 loopy（CE 74-76）

    // 从该邻居起顺时针扫一圈，数连续串（CE 80-104）
    let numStrings = 0;
    let maxStringLength = 0;
    let currentStringLength = 0;
    let inString = false;
    for (let k = 0; k < 8; k++) {
        const dir = (sdir + k) % 8;
        const nx = x + CDIRS[dir]![0]!;
        const ny = y + CDIRS[dir]![1]!;
        if (inMap(nx, ny) && loop[nx]![ny]) {
            currentStringLength++;
            if (!inString) {
                if (numStrings > 0) return false; // 第二段串 → 确在环上（CE 88-89）
                numStrings++;
                inString = true;
            }
        } else if (inString) {
            if (currentStringLength > maxStringLength) maxStringLength = currentStringLength;
            currentStringLength = 0;
            inString = false;
        }
    }
    if (inString && currentStringLength > maxStringLength) maxStringLength = currentStringLength;

    if (numStrings === 1 && maxStringLength <= 4) {
        loop[x]![y] = false; // 剥掉（CE 105-106）
        return true;
    }
    return false;
}

/**
 * CE Architect.c:57-118 + analyzeMap 第 2 步（214-218）：对全图逐格跑
 * checkLoopiness，剥离步之后 8 邻域立即复查（递归语义）。CE 是递归实现，
 * 这里用显式栈复刻同一 DFS 次序（邻居按 dir 7→0 逆序入栈、0→7 出栈），
 * 避免大开阔区的深递归。
 */
function stripNonLoopyCells(loop: boolean[][]): void {
    const stack: Array<[number, number]> = [];
    for (let x = DCOLS - 1; x >= 0; x--) {
        for (let y = DROWS - 1; y >= 0; y--) stack.push([x, y]);
    }
    while (stack.length > 0) {
        const [x, y] = stack.pop()!;
        if (!checkLoopinessCell(loop, x, y)) continue;
        for (let d = 7; d >= 0; d--) {
            const nx = x + CDIRS[d]![0]!;
            const ny = y + CDIRS[d]![1]!;
            if (inMap(nx, ny)) stack.push([nx, ny]); // CE 108-114 的递归复查
        }
    }
}

/**
 * CE Architect.c:121-136 auditLoop：从 (0,0) 对"不在环上"的格子 8 向泛洪
 * （标记进 grid），供去除多余标记时判定"邻格是否通向非环区域"。
 */
function auditLoopFlood(loop: boolean[][]): boolean[][] {
    const flooded: boolean[][] = [];
    for (let x = 0; x < DCOLS; x++) flooded[x] = new Array<boolean>(DROWS).fill(false);
    const stack: Array<[number, number]> = [[0, 0]];
    while (stack.length > 0) {
        const [x, y] = stack.pop()!;
        if (flooded[x]![y] || loop[x]![y]) continue; // CE 123-125：!grid && !IN_LOOP 才进
        flooded[x]![y] = true;
        for (const [dx, dy] of NB_DIRS) {
            const nx = x + dx!, ny = y + dy!;
            if (inMap(nx, ny) && !flooded[nx]![ny] && !loop[nx]![ny]) stack.push([nx, ny]);
        }
    }
    return flooded;
}

/** 全 false 的 IN_LOOP 图（Game 字段初始化用）。 */
export function emptyLoopMap(): boolean[][] {
    const m: boolean[][] = [];
    for (let x = 0; x < DCOLS; x++) m[x] = new Array<boolean>(DROWS).fill(false);
    return m;
}

/**
 * CE Architect.c:192-244 analyzeMap 的 IN_LOOP 三步（chokepoint/chokeMap
 * 部分——246-336——本轮显式不做，calculateChokeMap 分支留痕跳过）：
 *   1) 初始化：阻挡格清 IN_LOOP，其余置 IN_LOOP（200-212）；
 *   2) 逐格 checkLoopiness 剥离"其实不在环上"的标记（214-218）；
 *   3) auditLoop(0,0) 泛洪 + 去除"四周无非环邻格"的多余标记（220-244）。
 * 返回逐格 IN_LOOP 布尔图。确定性：纯函数，不消费 RNG。
 */
export function analyzeLoopMap(grid: Grid): boolean[][] {
    const loop: boolean[][] = [];
    for (let x = 0; x < DCOLS; x++) {
        loop[x] = new Array<boolean>(DROWS);
        for (let y = 0; y < DROWS; y++) {
            const cell = grid.getCell(x, y);
            loop[x]![y] = !!cell && !blocksPathing(cell); // 步骤 1
        }
    }

    stripNonLoopyCells(loop); // 步骤 2

    // 步骤 3：auditLoop(0, 0, grid)（CE 221-222）+ 去除多余标记（224-244）
    const flooded = auditLoopFlood(loop);
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            if (!loop[x]![y]) continue;
            let survives = false;
            for (const [dx, dy] of NB_DIRS) {
                const nx = x + dx!, ny = y + dy!;
                if (inMap(nx, ny) && !flooded[nx]![ny] && !loop[nx]![ny]) {
                    survives = true;
                    break;
                }
            }
            if (!survives) {
                flooded[x]![y] = true; // CE 239：grid[i][j] = true
                loop[x]![y] = false;
            }
        }
    }
    return loop;
}
