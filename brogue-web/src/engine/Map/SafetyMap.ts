/**
 * src/engine/Map/SafetyMap.ts — P4-9：safety map（怪物逃跑寻路）
 *
 * 对照 CE（../BrogueCE-master/src/brogue，只读事实来源）：
 *   - updateSafetyMap            Time.c:1791-1932（两张代价图 + 两次 dijkstraScan
 *                                + 50*v/(50+v) 饱和压缩 / *= -3 取负 / IN_LOOP -10）
 *   - resetDistanceCellInGrid    Time.c:1808-1822（玩家看不见的密门：门本身不安全，
 *                                门后才安全）
 *   - fleeingMonsterAwareOfPlayer Monsters.c:2360-2378（玩家隐身 → 贴脸才算察觉；
 *                                否则看怪物所在格是否在玩家 FOV 内）
 *   - getSafetyMap               Monsters.c:2380-2400（察觉 → 全局实时图并释放快照；
 *                                察觉不到 → 怪物私有快照，只拍一次）
 *   - nextStep(map, loc, NULL, true) Movement.c:1767-1810（8 邻域对角优先、
 *                                严格更陡才换向的下坡；monst=NULL 无阻挡回调，
 *                                阻挡由图上的 30000 值隐式表达）
 *
 * 已知 web 侧取舍（详见 ai_docs/p4_9_safety_map_report.md）：
 *   - CE 常量 PDS_FORBIDDEN=-1 / PDS_OBSTRUCTION=-2（Rogue.h:2782-2783）。
 *     注意 Pathfinding.ts 内部的 30000/29999 是它自己的等价物，两者不同源。
 *   - 楼梯禁入与玩家格修正：已按 CE 字面顺序（Time.c:1833-1843，玩家修正
 *     在前）。P4-9 曾因 web 玩家出生在楼梯上把两段对调（登记的有意偏离），
 *     P1-31 修复进层落位后按回退条件恢复 CE 顺序——见 buildSafetyMap 内注。
 *   - IN_LOOP 无 web 数据源：ctx.isInLoop 由 Game 恒接 false（机制保留、可注入测试）。
 *   - T_SACRED 无 web 地形：谓词恒 false，分支结构保留。
 *   - T_SPONTANEOUSLY_IGNITES（brimstone）无 web 地形，见报告。
 */

import { Grid, TerrainType } from './Grid';
import { DijkstraMap } from './Pathfinding';

/** CE Rogue.h:2782（CE 原文就是 -1，不是 Pathfinding.ts 内部的 29999）。 */
export const CE_PDS_FORBIDDEN = -1;
/** CE Rogue.h:2783。 */
export const CE_PDS_OBSTRUCTION = -2;
/** CE updateSafetyMap 内的字面 30000（Time.c:1805/1838 等）。 */
export const SAFETY_MAX_DISTANCE = 30000;

export function allocShortGrid(width: number, height: number, fill: number): number[][] {
    const grid: number[][] = [];
    for (let x = 0; x < width; x++) {
        grid[x] = new Array<number>(height).fill(fill);
    }
    return grid;
}

export function copyShortGrid(source: number[][]): number[][] {
    return source.map((column) => column.slice());
}

/**
 * 消费方的最小结构面（避免 SafetyMap -> Monster -> Game 的循环依赖）。
 * Monster 满足该结构（state 是数值枚举）。
 */
export interface SafetyMonsterInfo {
    loc: { x: number; y: number };
    hp: number;
    /** CE creatureState（web 的 MonsterState 数值枚举，2 = FLEEING）。 */
    state: number;
    isAlly: boolean;
    hasBehavior(flag: string): boolean;
}

export interface SafetyMapContext {
    grid: Grid;
    playerX: number;
    playerY: number;
    playerLevitating: boolean;
    playerImmuneToFire: boolean;
    /** CE monsterAtLoc（含玩家 FOV 外的全部活怪；web 侧已过滤 hp<=0）。 */
    monsterAt(x: number, y: number): SafetyMonsterInfo | undefined;
    /** CE pmap IN_LOOP 标志。web 无生成期环路数据，Game 恒接 () => false。 */
    isInLoop(x: number, y: number): boolean;
}

/** CE T_SACRED：web 无对应地形，谓词恒 false（分支结构保留）。 */
function isSacred(cell: { terrain: TerrainType }): boolean {
    void cell;
    return false;
}

/** web 的 MonsterState 数值枚举（Monster.ts：ASLEEP/WANDERING/HUNTING/FLEEING）。
 *  用字面量而非 import，避免 SafetyMap → Monster → Game 的循环依赖。 */
const STATE_ASLEEP = 0;
const STATE_FLEEING = 3;

/**
 * CE Time.c:1791 updateSafetyMap 的整图构建。返回新图（不写调用方的图），
 * Game.updateSafetyMap 负责落位并置 updatedSafetyMapThisTurn（CE Time.c:1795
 * 在函数首行置位，语义同）。
 */
export function buildSafetyMap(ctx: SafetyMapContext): number[][] {
    const { grid } = ctx;
    const safetyMap = allocShortGrid(grid.width, grid.height, SAFETY_MAX_DISTANCE);
    const playerCostMap = allocShortGrid(grid.width, grid.height, 1);
    const monsterCostMap = allocShortGrid(grid.width, grid.height, 1);

    for (let i = 0; i < grid.width; i++) {
        for (let j = 0; j < grid.height; j++) {
            safetyMap[i]![j] = SAFETY_MAX_DISTANCE;
            playerCostMap[i]![j] = 1; // prophylactic（CE 原注释）
            monsterCostMap[i]![j] = 1;

            const cell = grid.getCell(i, j);
            if (!cell) {
                playerCostMap[i]![j] = CE_PDS_OBSTRUCTION;
                monsterCostMap[i]![j] = CE_PDS_OBSTRUCTION;
                continue;
            }

            // CE：T_OBSTRUCTS_PASSABILITY 且（非密门 或 已按密门发现）。
            // web 近似：!isPassable 且不是 SECRET_DOOR（密门无论发现与否都
            // 落到下方密门分支/普通格，见报告——web 发现后的密门地形不变形）。
            // T_OBSTRUCTS_DIAGONAL_MOVEMENT 的 web 近似：WALL/GRANITE →
            // PDS_OBSTRUCTION，其余 → PDS_FORBIDDEN（与 Pathfinding.ts 自身
            // 代价启发一致）。CHASM 虽 !isPassable，但 CE 里它不挡通行、
            // 走 T_AUTO_DESCENT 分支，故排除在本分支外。
            const blocksPassability =
                !cell.isPassable && cell.terrain !== TerrainType.SECRET_DOOR && cell.terrain !== TerrainType.CHASM;
            if (blocksPassability) {
                const diagonalBlocking = cell.terrain === TerrainType.WALL || cell.terrain === TerrainType.GRANITE;
                playerCostMap[i]![j] = monsterCostMap[i]![j] = diagonalBlocking ? CE_PDS_OBSTRUCTION : CE_PDS_FORBIDDEN;
            } else if (isSacred(cell)) {
                // CE：T_SACRED——玩家可通行，怪物禁入
                playerCostMap[i]![j] = 1;
                monsterCostMap[i]![j] = CE_PDS_FORBIDDEN;
            } else if (cell.terrain === TerrainType.LAVA) {
                // CE T_LAVA_INSTA_DEATH（Time.c:1847-1854）逐字照抄：
                //   monsterCost 禁入；
                //   playerCost = (漂浮 || !免疫火焰) ? 1 : 禁入。
                // 这个条件读起来是反的（直觉应是"免疫 → 可走"），对照下方
                // T_IS_FIRE 分支（Time.c:1869-1875，方向正常）更显突兀。
                // 按项目决策 D1 照抄不修正；笔误分析见报告。
                monsterCostMap[i]![j] = CE_PDS_FORBIDDEN;
                if (ctx.playerLevitating || !ctx.playerImmuneToFire) {
                    playerCostMap[i]![j] = 1;
                } else {
                    playerCostMap[i]![j] = CE_PDS_FORBIDDEN;
                }
            } else {
                // CE：无害怪物占格——沉睡/驻足不动/定点触发/盟友且非逃跑。
                // web 近似：ASLEEP / MONST_TURRET（≈GETS_TURN_ON_ACTIVATION）/
                // isAlly；turnsSpentStationary 无对应计数器（报告登记）。
                const occupant = ctx.monsterAt(i, j);
                if (occupant && occupant.state !== STATE_FLEEING &&
                    (occupant.state === STATE_ASLEEP ||
                        occupant.isAlly ||
                        occupant.hasBehavior('MONST_TURRET'))) {
                    playerCostMap[i]![j] = 1;
                    monsterCostMap[i]![j] = CE_PDS_FORBIDDEN;
                    continue;
                }

                if (cell.terrain === TerrainType.CHASM || cell.terrain === TerrainType.TRAP) {
                    // CE T_AUTO_DESCENT | T_IS_DF_TRAP（Time.c:1864-1868）
                    monsterCostMap[i]![j] = CE_PDS_FORBIDDEN;
                    if (ctx.playerLevitating) {
                        playerCostMap[i]![j] = 1;
                    } else {
                        playerCostMap[i]![j] = CE_PDS_FORBIDDEN;
                    }
                } else if (cell.isBurning) {
                    // CE T_IS_FIRE（Time.c:1869-1875）——方向正常的那条：
                    // 免疫火焰 → 可走，否则禁入
                    monsterCostMap[i]![j] = CE_PDS_FORBIDDEN;
                    if (ctx.playerImmuneToFire) {
                        playerCostMap[i]![j] = 1;
                    } else {
                        playerCostMap[i]![j] = CE_PDS_FORBIDDEN;
                    }
                } else if (cell.terrain === TerrainType.WATER_DEEP) {
                    // CE T_IS_DEEP_WATER | T_SPONTANEOUSLY_IGNITES（brimstone
                    // web 无对应地形）：漂浮 → 1，否则 5；怪物 5
                    if (ctx.playerLevitating) {
                        playerCostMap[i]![j] = 1;
                    } else {
                        playerCostMap[i]![j] = 5;
                    }
                    monsterCostMap[i]![j] = 5;
                } else if (
                    cell.terrain === TerrainType.SECRET_DOOR &&
                    !(cell.isVisible)
                ) {
                    // CE：玩家看不见的密门（Time.c:1884-1893）——对玩家昂贵
                    //（要搜），怪物视作普通地面（怪物知道那是门）
                    playerCostMap[i]![j] = 100;
                    monsterCostMap[i]![j] = 1;
                } else {
                    playerCostMap[i]![j] = 1;
                    monsterCostMap[i]![j] = 1;
                }
            }
        }
    }

    // CE Time.c:1833-1843 的字面顺序：先玩家格修正（safetyMap=0 /
    // playerCost=1 / monsterCost=禁入），后楼梯禁入（rogue.upLoc/downLoc
    // 两格；web 无存储坐标，按地形扫描取得，见报告）。注意这个顺序的
    // 含义：若玩家站在楼梯上，后行的楼梯禁入会把唯一种子的代价打回 -1、
    // 全图退化为平图——CE 靠进层落位保证玩家永不站楼梯（RogueMain.c:
    // 839-869：先置楼梯位再向 4 邻域找无 HAS_STAIRS 的格子），冲突状态
    // 不可达。P4-9 曾因 web 玩家出生在楼梯上（放置偏差）把两段对调，
    // 属登记过的有意偏离；P1-31 修复落位后按其预告的回退条件恢复本
    // CE 顺序（对调状态下的平图语义由 p1_31_35 测试按 CE 原样锁死）。
    safetyMap[ctx.playerX]![ctx.playerY] = 0;
    playerCostMap[ctx.playerX]![ctx.playerY] = 1;
    monsterCostMap[ctx.playerX]![ctx.playerY] = CE_PDS_FORBIDDEN;

    for (let i = 0; i < grid.width; i++) {
        for (let j = 0; j < grid.height; j++) {
            const t = grid.getCell(i, j)?.terrain;
            if (t === TerrainType.STAIRS_UP || t === TerrainType.STAIRS_DOWN) {
                playerCostMap[i]![j] = CE_PDS_FORBIDDEN;
                monsterCostMap[i]![j] = CE_PDS_FORBIDDEN;
            }
        }
    }

    // 第一次扫描：safetyMap = 玩家视角的"接近成本"
    const scanner = new DijkstraMap(grid.width, grid.height);
    scanner.batchScan(safetyMap, playerCostMap, false);

    // CE resetDistanceCellInGrid（Time.c:1808-1822 + 1897-1910）：玩家看不见
    // 的密门本身不安全，门后才安全——把门格的值压回"邻格最小值+1"
    for (let i = 0; i < grid.width; i++) {
        for (let j = 0; j < grid.height; j++) {
            const cell = grid.getCell(i, j);
            if (cell && cell.terrain === TerrainType.SECRET_DOOR && !cell.isVisible) {
                for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                    const nx = i + dx!, ny = j + dy!;
                    if (!grid.isValidPos(nx, ny)) continue;
                    if (safetyMap[i]![j]! > safetyMap[nx]![ny]! + 1) {
                        safetyMap[i]![j] = safetyMap[nx]![ny]! + 1;
                    }
                }
            }
        }
    }

    // ★ 三步数值变换（Time.c:1912-1929）：monsterCost 禁入的格子跳过
    for (let i = 0; i < grid.width; i++) {
        for (let j = 0; j < grid.height; j++) {
            if (monsterCostMap[i]![j]! < 0) continue;
            if (safetyMap[i]![j] === SAFETY_MAX_DISTANCE) {
                safetyMap[i]![j] = 150;
            }
            // 饱和压缩：远处差异被压扁（C 整数除法向零截断，正数域同 floor）
            safetyMap[i]![j] = Math.trunc((50 * safetyMap[i]![j]!) / (50 + safetyMap[i]![j]!));
            // 取负：离玩家越远值越小（"安全度势场"）
            safetyMap[i]![j] = safetyMap[i]![j]! * -3;
            // 环路更安全（有退路）——web 无 IN_LOOP 数据源，Game 恒接 false，机制保留
            if (ctx.isInLoop(i, j)) {
                safetyMap[i]![j] = safetyMap[i]![j]! - 10;
            }
        }
    }

    // 第二次扫描：以变换后的（负）值为种子、按怪物代价传播——
    // " reachable 的最安全地点，按路程打折"
    scanner.batchScan(safetyMap, monsterCostMap, false);
    for (let i = 0; i < grid.width; i++) {
        for (let j = 0; j < grid.height; j++) {
            if (monsterCostMap[i]![j]! < 0) {
                safetyMap[i]![j] = SAFETY_MAX_DISTANCE;
            }
        }
    }

    return safetyMap;
}

/** 结构面：Game 满足它（SafetyMap 不 import Game，避免循环）。
 *  hasStatus 的参数收窄到实际消费的 'invisible'：Player.hasStatus 的参数是
 *  StatusId 联合类型，严格函数类型下只有收窄才结构相容。 */
export interface SafetyMapHost {
    grid: Grid;
    player: { loc: { x: number; y: number }; hasStatus(status: 'invisible'): boolean };
    safetyMap: number[][];
    updatedSafetyMapThisTurn: boolean;
    updateSafetyMap(): void;
}

export interface SafetyMapMonster {
    loc: { x: number; y: number };
    /** CE monst->safetyMap 私有快照。 */
    safetySnapshot: number[][] | null;
}

/**
 * CE Monsters.c:2360-2378 fleeingMonsterAwareOfPlayer：玩家隐身 → 相邻
 * （切比雪夫 ≤ 1，CE distanceBetween = max(|dx|,|dy|)，Monsters.c:1587-1589）
 * 才算察觉；否则看"怪物所在格"是否在玩家 FOV 内（IN_FIELD_OF_VIEW）。
 */
export function fleeingMonsterAwareOfPlayer(host: SafetyMapHost, monst: { loc: { x: number; y: number } }): boolean {
    if (host.player.hasStatus('invisible')) {
        return Math.max(Math.abs(monst.loc.x - host.player.loc.x), Math.abs(monst.loc.y - host.player.loc.y)) <= 1;
    }
    return host.grid.getCell(monst.loc.x, monst.loc.y)?.isVisible ?? false;
}

/**
 * CE Monsters.c:2380-2400 getSafetyMap：察觉 → 释放私有快照（CE freeGrid）、
 * 惰性重算全局图并返回实时图；察觉不到 → 只拍一次快照并永远用它——
 * "察觉不到玩家的逃跑者按它最后知道的局面继续逃"，不隔墙感知玩家新位置。
 */
export function getSafetyMapForMonster(host: SafetyMapHost, monst: SafetyMapMonster): number[][] {
    if (fleeingMonsterAwareOfPlayer(host, monst)) {
        monst.safetySnapshot = null; // CE：释放怪物私有快照
        if (!host.updatedSafetyMapThisTurn) {
            host.updateSafetyMap();
        }
        return host.safetyMap;
    } else {
        if (!monst.safetySnapshot) {
            if (!host.updatedSafetyMapThisTurn) {
                host.updateSafetyMap();
            }
            monst.safetySnapshot = copyShortGrid(host.safetyMap);
        }
        return monst.safetySnapshot;
    }
}

/** CE nbDirs（GlobalsBase.c:38）：N S W E NW SW NE SE。 */
const NB_DIRS: ReadonlyArray<readonly [number, number]> =
    [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];

/**
 * CE Movement.c:1767 nextStep(distanceMap, loc, NULL, true)：8 邻域从
 * dir=7（SE）逆序扫描，(当前格 − 邻格) 必须严格大于已找到的最大降幅才换向，
 * 即"并列取先、对角优先"。monst=NULL ⇒ 无阻挡回调，阻挡由图上的
 * 30000 值隐式表达；knownToPlayerAsPassableOrSecretDoor（Monsters.c:3677）
 * 的 web 近似 = 可通行或密门（web 全知，无玩家知识开关，见报告）。
 * 返回方向 [dx,dy]；无下坡路返回 null（CE 的 NO_DIRECTION/-1）。
 */
export function safetyNextStep(map: number[][], grid: Grid, x: number, y: number): readonly [number, number] | null {
    const current = map[x]?.[y];
    if (current === undefined) return null;
    let bestScore = 0;
    let bestDir = -1;
    for (let dir = NB_DIRS.length - 1; dir >= 0; dir--) {
        const nx = x + NB_DIRS[dir]![0]!;
        const ny = y + NB_DIRS[dir]![1]!;
        if (!grid.isValidPos(nx, ny)) continue;
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        // CE knownToPlayerAsPassableOrSecretDoor（web 近似口径）
        if (!cell.isPassable && cell.terrain !== TerrainType.SECRET_DOOR) continue;
        const score = current - map[nx]![ny]!;
        if (score > bestScore) {
            bestScore = score;
            bestDir = dir;
        }
    }
    return bestDir >= 0 ? NB_DIRS[bestDir]! : null;
}
