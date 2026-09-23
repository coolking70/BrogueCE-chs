/**
 * src/engine/Map/WaypointMap.ts — P4-10：waypoint 游荡导航
 *
 * CE 里 WANDERING 怪物不是随机乱走：朝最近的可疑 waypoint 走，到了再换下一个，
 * 因此它们沿走廊/房间有目的地巡逻。本文件是 CE waypoint 系统的 web 端口。
 *
 * 对照 CE（../BrogueCE-master/src/brogue，只读事实来源）：
 *   - WAYPOINT_SIGHT_RADIUS=10 / MAX_WAYPOINT_COUNT=40     Rogue.h:1151-1152
 *   - setUpWaypoints()      Architect.c:3033-3070（贪心集合覆盖：T_OBSTRUCTS_SCENT
 *     格预标已覆盖 + shuffleList 消耗 RNG + 每挑一点用 WAYPOINT_SIGHT_RADIUS 的
 *     FOV（同样以 T_OBSTRUCTS_SCENT 为遮挡）标覆盖 + 对全部 waypoint refreshWaypoint）
 *   - refreshWaypoint(i)    Architect.c:3014-3031（populateGenericCostMap + 沉睡/
 *     MONST_IMMOBILE/MB_CAPTIVE 怪格 PDS_FORBIDDEN + fill 30000 + 种子 0 +
 *     dijkstraScan(map, cost, true)）
 *   - dijkstraScan 第三参   Dijkstra.c:202 `boolean useDiagonals` —— true = 8 向
 *     松弛。safety map（P4-9）两次扫描都是 false（4 向），waypoint 是 true：
 *     CE 原文如此，非笔误（Architect.c:3030 vs Time.c:1905/1929）。
 *   - 滚动刷新              Time.c:2710-2714（客观时间块内每 100 tick 恰好重算
 *     一个 waypoint；建图时才全算。ticker 先 ++ 再取模——首刷是 1 号不是 0 号）
 *   - isValidWanderDestination / closestWaypointIndex / chooseNewWanderDestination
 *     Monsters.c:1206-1251（visited 检查 + wpDistance>=0 + nextStep!=NO_DIRECTION；
 *     closest 的初始上限是 DCOLS/2；choose 先随机清两个 visited 再标记当前目标，
 *     全灭时清空重试）
 *   - 游荡消费              Monsters.c:3602-3615（nextStep(map, loc, monst, false)
 *     ——第四参 false = 正向对角优先级，dir 0..7 升序扫描、严格下坡才换向，
 *     与 safety map 的 (,,NULL,true) 相反）
 *   - 兜底随机               randValidDirectionFrom(monst, x, y, true) Movement.c:674
 *
 * 已知 web 侧取舍（详见 ai_docs/p4_10_waypoint_report.md）：
 *   - waypointAlreadyVisited 惰性初始化：CE Monsters.c:128-129 在 initializeMonster
 *     （生成期！）给每只怪消耗 MAX_WAYPOINT_COUNT 次 rand_range(0,1)；web 若照搬
 *     会把生成期 RNG 流移动约 40×怪数 次、打红 generation_baseline（任务书禁改
 *     基线）。改在玩法期首次触碰 waypoint 系统时消费同分布的 40 次种子掷骰，
 *     行为分布等价、仅 RNG 流位置不同（web 的生成流本就与 CE 不同源）。
 *   - CE nextStep 的 monsterAvoids / blocker(canPass/teammates/enemies) /
 *     diagonalBlocked 在 web 无对应机制，按"液体限定 + 活怪占格 + 玩家格"近似
 *     （占格阻挡比 CE 更保守：web 的 tryMoveTo 不会像 CE moveMonster 那样
 *     处理穿过/交换，不挡会叠怪）。
 *   - CE 游荡分支的逃险地形（mapToSafeTerrain）、囚徒领袖接近、邻敌攻击等
 *     子行为 web 无对应，不在本轮范围（CE Monsters.c:3547-3599）。
 *   - CE 距离域内 30000 也满足 `wpDistance >= 0`（isValid 的这条检查很弱），
 *     靠 nextStep 的严格下坡兜底——照抄，不做"聪明"的修正。
 */

import { DCOLS, Grid, TerrainType } from './Grid';
import { DijkstraMap, MAX_DISTANCE } from './Pathfinding';
import { obstructsScent } from './Scent';
import { allocShortGrid } from './SafetyMap';
import { rng } from '../Random';

/** CE Rogue.h:1151。 */
export const WAYPOINT_SIGHT_RADIUS = 10;
/** CE Rogue.h:1152。 */
export const MAX_WAYPOINT_COUNT = 40;

/** CE Rogue.h:2782 PDS_FORBIDDEN（refreshWaypoint 代价图约定，同 SafetyMap）。 */
export const WP_PDS_FORBIDDEN = -1;
/** CE Rogue.h:2783 PDS_OBSTRUCTION。 */
export const WP_PDS_OBSTRUCTION = -2;

/** web MonsterState 数值（Monster.ts：ASLEEP=0/WANDERING=1/HUNTING=2/FLEEING=3）。
 *  用字面量而非 import，避免 WaypointMap → Monster → Game 的循环依赖。 */
const STATE_ASLEEP = 0;

/**
 * waypoint 系统消费的怪物结构面。web Monster 满足它（state 是数值枚举）；
 * targetWaypointIndex / waypointAlreadyVisited 由本系统读写。
 */
export interface WaypointMonster {
    loc: { x: number; y: number };
    hp: number;
    state: number;
    isCaged: boolean;
    targetWaypointIndex: number;
    waypointAlreadyVisited: boolean[] | null;
    hasBehavior(flag: string): boolean;
}

/**
 * 宿主环境结构面（Game 满足它；避免 WaypointMap → Game 循环依赖，同 SafetyMap 先例）。
 */
export interface WaypointContext {
    grid: Grid;
    /** 参与代价图叠加/游荡阻挡的怪物集合（调用方过滤尸体）。 */
    monsters: ReadonlyArray<WaypointMonster>;
    /** CE getFOVMask(grid, x, y, WAYPOINT_SIGHT_RADIUS*FP_FACTOR, T_OBSTRUCTS_SCENT, 0, false)
     *  的 web 等价：Game 绑定 fov.computeFOVMask(x, y, 10, obstructsScent)。 */
    computeWaypointFOV(x: number, y: number): boolean[][];
    /** 活怪占格查询（CE monsterAtLoc，web 已过滤 hp<=0）。 */
    isOccupiedByMonster(x: number, y: number): boolean;
    playerLoc: { x: number; y: number };
}

/** CE nbDirs（GlobalsBase.c:38）：N S W E NW SW NE SE——与 nextStep 的 dir 序一致。 */
const NB_DIRS: ReadonlyArray<readonly [number, number]> =
    [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];

/** Random.ts 的内部状态面（字段私有、本轮禁改该文件；只读快照经结构化访问）。 */
interface RngInternals {
    rngStates: Array<{ a: number; b: number; c: number; d: number }>;
    currentRNG: number;
    randomNumbersGenerated: number;
}

/**
 * CE RogueMain.c:691-707 + 733-735 的流隔离复刻。CE 逐层生成时：
 *   oldSeed = rand_64bits()（从主流抽 2 个 ranval）；
 *   seedRandomGenerator(levels[d].levelSeed)（每层的专属种子，初始化期抽取）；
 *   ……digDungeon → initializeLevel → setUpWaypoints → shuffleTerrainColors……
 *   seedRandomGenerator(oldSeed)（生成完毕，主流从 levelSeed 流切回）。
 * 因此生成段（含 setUpWaypoints 的 shuffleList，DCOLS*DROWS-1 次抽取）消耗的
 * 是被丢弃的 levelSeed 流，不移动后续生成决策与玩法期共用的主流。
 * web 的 rng 是单流结构且 Random.ts 本轮禁改，故用状态快照/恢复达到同一
 * 可观察性质：waypoint 构建对主流是零抽取（web 也没有 levelSeed 基础设施，
 * CE 的 oldSeed 抽取/重播种本身不复刻——那会移动基线流，超出本轮范围）。
 */
function isolateRngDuring(fn: () => void): void {
    const internals = rng as unknown as RngInternals;
    const savedStates = internals.rngStates.map((s) => ({ ...s }));
    const savedCurrent = internals.currentRNG;
    const savedCounter = internals.randomNumbersGenerated;
    try {
        fn();
    } finally {
        for (let i = 0; i < savedStates.length; i++) {
            internals.rngStates[i] = savedStates[i]!;
        }
        internals.currentRNG = savedCurrent;
        internals.randomNumbersGenerated = savedCounter;
    }
}

export class WaypointSystem {
    /** CE rogue.wpCoordinates[0..wpCount-1]。 */
    public coordinates: Array<{ x: number; y: number }> = [];
    /** CE rogue.wpCount。 */
    public count: number = 0;
    /** CE rogue.wpRefreshTicker。 */
    public refreshTicker: number = 0;
    /** CE rogue.wpDistance[i]（每 waypoint 一张距离图，30000=不可达）。 */
    public distanceMaps: number[][][] = [];
    /** 建图时的覆盖图（CE setUpWaypoints 的局部 char grid；导出仅供测试观察）。 */
    public coverage: boolean[][] | null = null;

    private scanner: DijkstraMap | null = null;

    /**
     * CE Architect.c:3033 setUpWaypoints。调用时机（CE RogueMain.c:707/771、
     * Items.c:5558）：所有生成决策完成之后 / 重访恢复之后 / 地形剧变之后。
     *
     * RNG 流隔离（CE RogueMain.c:691-707 + 733-735 的语义复刻，见
     * isolateRngDuring 内注）：CE 在进层时把主流重播种到该层专属 levelSeed
     * 上跑全部生成（含本函数的 shuffleList），完成后恢复玩法流——shuffle
     * 的抽取不落在后续玩法流上。W-13：运行期掘地（Items.c:5558）没有
     * 进层那层隔离；duringPlay=true 时直接消费洗牌随机数，默认调用仍
     * 保持原有生成/重访隔离，不能把进层规则泛化到所有重建。
     */
    public setUpWaypoints(ctx: WaypointContext, duringPlay = false): void {
        if (duringPlay) this.setUpWaypointsInner(ctx);
        else isolateRngDuring(() => {
            this.setUpWaypointsInner(ctx);
        });
    }

    private setUpWaypointsInner(ctx: WaypointContext): void {
        const { grid } = ctx;
        this.coordinates = [];
        this.count = 0;
        this.refreshTicker = 0;

        // Architect.c:3035-3042：T_OBSTRUCTS_SCENT 格（web 近似 obstructsScent）
        // 预标为已覆盖——它们永不成为 waypoint。
        const covered: boolean[][] = [];
        for (let x = 0; x < grid.width; x++) {
            covered[x] = new Array<boolean>(grid.height);
            for (let y = 0; y < grid.height; y++) {
                const cell = grid.getCell(x, y);
                covered[x]![y] = !cell || obstructsScent(cell);
            }
        }

        // Architect.c:3043-3044：fillSequentialList + shuffleList（消耗 RNG，
        // DCOLS*DROWS-1 次randRange；确定性来自种子）。
        const order: number[] = [];
        for (let i = 0; i < grid.width * grid.height; i++) order.push(i);
        rng.shuffleList(order);

        // Architect.c:3045-3056：贪心集合覆盖——按打乱顺序扫，挑未覆盖格当
        // waypoint，用 WAYPOINT_SIGHT_RADIUS 的 FOV 把周围标成已覆盖。
        for (let i = 0; i < order.length && this.count < MAX_WAYPOINT_COUNT; i++) {
            const s = order[i]!;
            const x = Math.floor(s / grid.height); // CE sCoord[i]/DROWS（x 为主序）
            const y = s % grid.height;
            if (!covered[x]![y]) {
                const mask = ctx.computeWaypointFOV(x, y);
                for (let mx = 0; mx < grid.width; mx++) {
                    for (let my = 0; my < grid.height; my++) {
                        if (mask[mx]![my]) covered[mx]![my] = true;
                    }
                }
                covered[x]![y] = true;
                this.coordinates[this.count++] = { x, y };
            }
        }
        this.coverage = covered;

        // Architect.c:3059-3061：建图时对每个 waypoint 全量刷新。
        this.distanceMaps = [];
        for (let i = 0; i < this.count; i++) {
            this.refreshWaypoint(i, ctx);
        }
    }

    /**
     * CE Architect.c:3014 refreshWaypoint：单张 waypoint 距离图。
     * 代价图 = populateGenericCostMap（Movement.c:2017）+ 沉睡/不可移动/被囚禁
     * 怪格禁入（Architect.c:3019-3026，只降级当前可通行格，CE `cost >= 0` 守卫）。
     * dijkstraScan 第三参 true = useDiagonals（8 向松弛）——Dijkstra.c:202。
     */
    public refreshWaypoint(index: number, ctx: WaypointContext): void {
        const { grid } = ctx;
        if (index < 0 || index >= this.count) return;
        const wp = this.coordinates[index]!;
        if (!this.distanceMaps[index]) {
            this.distanceMaps[index] = allocShortGrid(grid.width, grid.height, MAX_DISTANCE);
        }
        const distance = this.distanceMaps[index]!;
        const cost = allocShortGrid(grid.width, grid.height, 1);

        for (let x = 0; x < grid.width; x++) {
            for (let y = 0; y < grid.height; y++) {
                const cell = grid.getCell(x, y);
                if (!cell) {
                    cost[x]![y] = WP_PDS_OBSTRUCTION;
                    continue;
                }
                if (!cell.isPassable && cell.terrain !== TerrainType.SECRET_DOOR) {
                    // CE：T_OBSTRUCTS_PASSABILITY（非未发现密门）——按对角阻挡
                    // 分 OBSTRUCTION/FORBIDDEN；web 以 WALL/GRANITE 近似对角阻挡
                    //（Pathfinding.ts/SafetyMap 同口径，CHASM 不在此列：
                    // CE 里它可通行、走 T_PATHING_BLOCKER 的另一分支）。
                    const diagonalBlocking =
                        cell.terrain === TerrainType.WALL || cell.terrain === TerrainType.GRANITE;
                    cost[x]![y] = diagonalBlocking ? WP_PDS_OBSTRUCTION : WP_PDS_FORBIDDEN;
                } else if (
                    cell.terrain === TerrainType.LAVA ||
                    cell.terrain === TerrainType.CHASM ||
                    cell.terrain === TerrainType.TRAP ||
                    cell.terrain === TerrainType.WATER_DEEP ||
                    cell.isBurning
                ) {
                    // CE：T_PATHING_BLOCKER 的非通行部分（AUTO_DESCENT/DF_TRAP/
                    // LAVA/DEEP_WATER/FIRE/SPONTANEOUS_IGNITES）→ FORBIDDEN。
                    // 注意 populateGenericCostMap 与 updateSafetyMap 不同：
                    // 深水/岩浆/火一律禁入，没有"5 格代价"的档位。
                    cost[x]![y] = WP_PDS_FORBIDDEN;
                } else {
                    cost[x]![y] = 1;
                }
            }
        }

        // Architect.c:3019-3026：沉睡/不可移动/被囚禁的怪物所在格 → 禁入
        //（waypoint 巡逻不穿睡觉的怪；活跃怪可以穿——与 safety map 的
        // "无害怪"口径不同，这里只看三种状态，不看玩家可见性）。
        for (const m of ctx.monsters) {
            if (m.hp <= 0) continue;
            const cellCost = cost[m.loc.x]?.[m.loc.y];
            if (
                (m.state === STATE_ASLEEP || m.hasBehavior('MONST_IMMOBILE') || m.isCaged) &&
                cellCost !== undefined && cellCost >= 0
            ) {
                cost[m.loc.x]![m.loc.y] = WP_PDS_FORBIDDEN;
            }
        }

        // Architect.c:3027-3030：fill 30000 + 源点 0 + dijkstraScan(,,true)。
        for (let x = 0; x < grid.width; x++) {
            for (let y = 0; y < grid.height; y++) {
                distance[x]![y] = MAX_DISTANCE;
            }
        }
        distance[wp.x]![wp.y] = 0;
        if (!this.scanner || this.scanner.width !== grid.width || this.scanner.height !== grid.height) {
            this.scanner = new DijkstraMap(grid.width, grid.height);
        }
        this.scanner.batchScan(distance, cost, true);
    }

    /**
     * CE Time.c:2710-2714 滚动刷新：每 100 tick 客观块恰好重算一个 waypoint。
     * ticker 先 ++ 再取模——玩法期第一次刷新的是 1 号（0 号建图时刚算过）。
     * "每回合全算"是本轮点名要抓的错误实现，测试用计数器锁死。
     */
    public rollingRefresh(ctx: WaypointContext): void {
        if (this.count === 0) return; // CE 无此守卫（CE 恒有 waypoint）；web 的 test 模式小地图可能为 0
        this.refreshTicker++;
        if (this.refreshTicker >= this.count) this.refreshTicker = 0;
        this.refreshWaypoint(this.refreshTicker, ctx);
    }

    /**
     * Monsters.c:128-129 的惰性版：CE 在 initializeMonster（生成期）为每只怪
     * 消耗 MAX_WAYPOINT_COUNT 次 rand_range(0,1)（≈50% 巡检点初始已访问均衡）。
     * web 改为玩法期首次触碰 waypoint 系统时一次性消费（文件头注"取舍"节）。
     */
    public ensureVisitedInitialized(monst: WaypointMonster): void {
        if (!monst.waypointAlreadyVisited) {
            const arr: boolean[] = new Array<boolean>(MAX_WAYPOINT_COUNT);
            for (let i = 0; i < MAX_WAYPOINT_COUNT; i++) {
                arr[i] = rng.randRange(0, 1) === 1;
            }
            monst.waypointAlreadyVisited = arr;
        }
    }

    /**
     * CE Monsters.c:1206 isValidWanderDestination：目标合法 = 索引有效 + 未访问
     * + wpDistance >= 0（30000 亦过——CE 原文如此）+ 存在下坡步。
     */
    public isValidWanderDestination(monst: WaypointMonster, wpIndex: number, ctx: WaypointContext): boolean {
        if (wpIndex < 0 || wpIndex >= this.count) return false;
        this.ensureVisitedInitialized(monst);
        if (monst.waypointAlreadyVisited![wpIndex]) return false;
        const d = this.distanceMaps[wpIndex]?.[monst.loc.x]?.[monst.loc.y];
        if (d === undefined || d < 0) return false;
        return this.nextStep(wpIndex, monst, ctx) !== null;
    }

    /**
     * CE Movement.c:1767 nextStep(distanceMap, loc, monst, false) 的 web 端口：
     * preferDiagonals=false → dir 0..7 升序扫描、(当前-邻) 严格大于已找到的最大
     * 降幅才换向（并列取先、正交优先）。monst 提供 → 阻挡回调生效（web 近似见
     * isBlockedFor）；diagonalBlocked web 无对应判定，省略（P4-8/P4-9 同口径）。
     * 返回 [dx,dy]；无下坡路返回 null（CE NO_DIRECTION）。
     */
    public nextStep(wpIndex: number, monst: WaypointMonster, ctx: WaypointContext): readonly [number, number] | null {
        const map = this.distanceMaps[wpIndex];
        if (!map) return null;
        const x = monst.loc.x;
        const y = monst.loc.y;
        const current = map[x]?.[y];
        if (current === undefined) return null;

        let bestScore = 0;
        let bestDir = -1;
        for (let dir = 0; dir < NB_DIRS.length; dir++) {
            const nx = x + NB_DIRS[dir]![0]!;
            const ny = y + NB_DIRS[dir]![1]!;
            if (!ctx.grid.isValidPos(nx, ny)) continue;
            const cell = ctx.grid.getCell(nx, ny);
            if (!cell) continue;
            // CE knownToPlayerAsPassableOrSecretDoor（web 口径同 P4-9：可通行或密门）
            if (!cell.isPassable && cell.terrain !== TerrainType.SECRET_DOOR) continue;
            if (this.isBlockedFor(monst, nx, ny, cell, ctx)) continue;
            const score = current - map[nx]![ny]!;
            if (score > bestScore) {
                bestScore = score;
                bestDir = dir;
            }
        }
        return bestDir >= 0 ? NB_DIRS[bestDir]! : null;
    }

    /** CE monsterAvoids + blocker 判定的 web 近似（文件头注"取舍"节）。 */
    private isBlockedFor(
        monst: WaypointMonster,
        nx: number,
        ny: number,
        cell: { terrain: TerrainType },
        ctx: WaypointContext
    ): boolean {
        if (monst.hasBehavior('MONST_RESTRICTED_TO_LIQUID')) {
            const liquid =
                cell.terrain === TerrainType.WATER_SHALLOW || cell.terrain === TerrainType.WATER_DEEP;
            if (!liquid) return true;
        }
        if (ctx.isOccupiedByMonster(nx, ny)) return true;
        if (ctx.playerLoc.x === nx && ctx.playerLoc.y === ny) return true;
        return false;
    }

    /**
     * CE Monsters.c:1214 closestWaypointIndex：合法且距离 < DCOLS/2 的最小者。
     * web 的 DCOLS=79（CE=100），上限随 web 地图尺寸取 39——结构等价（"半张
     * 地图宽以内"），非逐字照抄，报告登记。
     */
    public closestWaypointIndex(monst: WaypointMonster, ctx: WaypointContext): number {
        let closestDistance = Math.floor(DCOLS / 2);
        let closestIndex = -1;
        for (let i = 0; i < this.count; i++) {
            if (this.isValidWanderDestination(monst, i, ctx)) {
                const d = this.distanceMaps[i]![monst.loc.x]![monst.loc.y]!;
                if (d < closestDistance) {
                    closestDistance = d;
                    closestIndex = i;
                }
            }
        }
        return closestIndex;
    }

    /**
     * CE Monsters.c:1230 chooseNewWanderDestination：随机清两个 visited（≈50%
     * 巡检点均衡的自稳机制）→ 标记当前目标已访问 → 取 closestWaypointIndex →
     * 全灭则清空 visited 重试一次。wpCount==0 时 CE 是 brogueAssert（assert 关闭
     * 后 rand_range(0,-1) 未定义行为），web 显式守卫返回 -1。
     */
    public chooseNewWanderDestination(monst: WaypointMonster, ctx: WaypointContext): void {
        if (this.count === 0) {
            monst.targetWaypointIndex = -1;
            return;
        }
        this.ensureVisitedInitialized(monst);
        const visited = monst.waypointAlreadyVisited!;
        visited[rng.randRange(0, this.count - 1)] = false;
        visited[rng.randRange(0, this.count - 1)] = false;
        // CE 无上界检查（C 定长数组 MAX_WAYPOINT_COUNT 安全；web 定长 40 同）。
        if (monst.targetWaypointIndex >= 0) {
            visited[monst.targetWaypointIndex] = true;
        }
        monst.targetWaypointIndex = this.closestWaypointIndex(monst, ctx);
        if (monst.targetWaypointIndex === -1) {
            for (let i = 0; i < this.count; i++) {
                visited[i] = false;
            }
            monst.targetWaypointIndex = this.closestWaypointIndex(monst, ctx);
        }
    }
}
