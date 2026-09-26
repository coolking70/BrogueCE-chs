/**
 * src/engine/Generator/Architect.ts
 * Porting Brogue's procedural dungeon generation logic
 */

import { Grid, TerrainType, DungeonLayer, DCOLS, DROWS } from '../Map/Grid';
import { cellTerrainFlags, cellTerrainMechFlags } from '../Map/DungeonFeature';
import { T_PATHING_BLOCKER, T_OBSTRUCTS_PASSABILITY, TM_IS_SECRET, TM_PROMOTES_WITH_KEY, TM_CONNECTS_LEVEL } from '../Map/TerrainCatalog';
import { DijkstraMap } from '../Map/Pathfinding';
import { lakeDisruptsPassability, terrainAllowsMove } from '../Map/Connectivity';
import { fillLakes, cleanUpLakeBoundaries, buildABridge } from '../Map/LakeSystem';
import {
    removeDiagonalOpenings, finishDoors, finishWalls,
    type DiagonalFinishStats, type DoorFinishStats, type WallFinishStats,
} from '../Map/WallDoorFinish';
import { addLoops, addLoopsToWorkGrid, applyLoopDoorSites, MINIMUM_PATHING_DISTANCE, LOOP_DOOR_PERCENT, DEEPEST_LEVEL } from '../Map/LoopMap';
import { runAutogenerators, type AutoGeneratorRunStats } from '../Map/AutoGenerator';
import { rng } from '../Random';
import { RoomType, ROOM_TYPE_COUNT } from '../../types';
import type { DungeonProfile, Pos } from '../../types';
import * as RoomBuilder from './RoomBuilder';
import { BlueprintEngine, resetMachineCounter } from './BlueprintEngine';
import type { MachineResult, MachineEntityRuntime } from './BlueprintEngine';

/** 每个湖的放置尝试次数。CE Architect.c:2659 `for (k=0; k<20; k++)`。 */
const LAKE_PLACEMENT_ATTEMPTS = 20;

// ---------------------------------------------------------------------------
// C-1：房间剖面与深度曲线（CE carveDungeon，Architect.c:2456-2478）
// ---------------------------------------------------------------------------

/**
 * CE dungeonProfileCatalog（Globals.c:934-947，任务书未给位置、本轮自查）。
 * roomFrequencies 下标 = RoomType（Globals.c:935-943 的注释）：
 *   0 十字房 / 1 对称小十字 / 2 小房间 / 3 圆房 / 4 碎块房 /
 *   5 洞穴 / 6 大洞窟（满层）/ 7 入口房。
 * 机器专用剖面只供 redesignInterior 使用，不经过深度调整。
 */
export const DUNGEON_PROFILE_CATALOG = {
    /** Globals.c:946 `{{2, 1, 1, 1, 7, 1, 0, 0}, 10}` */
    DP_BASIC: { roomFrequencies: [2, 1, 1, 1, 7, 1, 0, 0], corridorChance: 10 } as DungeonProfile,
    /** Globals.c:947 `{{10, 0, 0, 3, 7, 10, 10, 0}, 0}` */
    DP_BASIC_FIRST_ROOM: { roomFrequencies: [10, 0, 0, 3, 7, 10, 10, 0], corridorChance: 0 } as DungeonProfile,
    /** Globals.c:949 */
    DP_GOBLIN_WARREN: { roomFrequencies: [0, 0, 1, 0, 0, 0, 0, 0], corridorChance: 0 } as DungeonProfile,
    /** Globals.c:950 */
    DP_SENTINEL_SANCTUARY: { roomFrequencies: [0, 5, 0, 1, 0, 0, 0, 0], corridorChance: 0 } as DungeonProfile,
} as const;
export type DungeonProfileId = keyof typeof DUNGEON_PROFILE_CATALOG;

/** CE GlobalsBrogue.c:43 amuletLevel；房型曲线在 D26 饱和。 */
const AMULET_LEVEL = 26;

/** CE carveDungeon Architect.c:2473 `attachRooms(grid, &theDP, 35, 35)`。 */
const CE_ROOM_ATTACH_ATTEMPTS = 35;
const CE_MAX_ROOM_COUNT = 35;

/** CE Rogue.h:1157-1158。 */
const CAVE_MIN_WIDTH = 50;
const CAVE_MIN_HEIGHT = 20;

/** CE Rogue.h:1137-1140。 */
const HORIZONTAL_CORRIDOR_MIN_LENGTH = 5;
const HORIZONTAL_CORRIDOR_MAX_LENGTH = 15;
const VERTICAL_CORRIDOR_MIN_LENGTH = 2;
const VERTICAL_CORRIDOR_MAX_LENGTH = 9;

/** CE nbDirs（GlobalsBase.c:38）前四向：UP/DOWN/LEFT/RIGHT。 */
const NB4: ReadonlyArray<readonly [number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
/** CE enum directions 的四向序（Rogue.h）；NO_DIRECTION = -1。 */
const DIR_UP = 0;
const DIR_DOWN = 1;
const NO_DIRECTION = -1;
/** CE oppositeDirection（Math.c）：UP↔DOWN、LEFT↔RIGHT。 */
const OPPOSITE_DIRECTION = [1, 0, 3, 2];

/**
 * CE Architect.c:1951-1969 insertRoomAt：从 roomMap 的锚格（门位）出发，
 * 把与锚连通的房间格（4 向泛洪）盖到 dungeon 上（值为 1）。CE 是递归实现，
 * 这里用显式栈复刻同一泛洪集（大洞窟上百格，避免深递归）。
 */
function workInsertRoomAt(
    dungeonMap: RoomBuilder.RoomGrid,
    roomMap: RoomBuilder.RoomGrid,
    roomToDungeonX: number,
    roomToDungeonY: number,
    xRoom: number,
    yRoom: number
): void {
    dungeonMap[xRoom + roomToDungeonX]![yRoom + roomToDungeonY] = 1;
    const stack: Pos[] = [{ x: xRoom, y: yRoom }];
    while (stack.length > 0) {
        const p = stack.pop()!;
        for (let dir = 0; dir < 4; dir++) {
            const newX = p.x + NB4[dir]![0]!;
            const newY = p.y + NB4[dir]![1]!;
            if (coordinatesAreInMap(newX, newY)
                && roomMap[newX]![newY]
                && coordinatesAreInMap(newX + roomToDungeonX, newY + roomToDungeonY)
                && dungeonMap[newX + roomToDungeonX]![newY + roomToDungeonY] === 0) {
                dungeonMap[newX + roomToDungeonX]![newY + roomToDungeonY] = 1;
                stack.push({ x: newX, y: newY });
            }
        }
    }
}

function coordinatesAreInMap(x: number, y: number): boolean {
    return x >= 0 && x < DCOLS && y >= 0 && y < DROWS;
}

/**
 * CE Architect.c:2426 的 descentPercent：
 * `clamp(100 * (depthLevel - 1) / (amuletLevel - 1), 0, 100)`，C 整数除法。
 */
export function dungeonDescentPercent(depth: number): number {
    const raw = Math.floor((100 * (depth - 1)) / (AMULET_LEVEL - 1));
    return Math.min(100, Math.max(0, raw));
}

/** CE Architect.c:2425-2434。原地修改（CE 收的是指针，调用方传剖面副本）。 */
export function adjustDungeonProfileForDepth(theProfile: DungeonProfile, depth: number): void {
    const descentPercent = dungeonDescentPercent(depth);
    theProfile.roomFrequencies[0] = (theProfile.roomFrequencies[0] ?? 0) + Math.floor((20 * (100 - descentPercent)) / 100);
    theProfile.roomFrequencies[1] = (theProfile.roomFrequencies[1] ?? 0) + Math.floor((10 * (100 - descentPercent)) / 100);
    theProfile.roomFrequencies[3] = (theProfile.roomFrequencies[3] ?? 0) + Math.floor((7 * (100 - descentPercent)) / 100);
    theProfile.roomFrequencies[5] = (theProfile.roomFrequencies[5] ?? 0) + Math.floor((10 * descentPercent) / 100);
    theProfile.corridorChance += Math.floor((80 * (100 - descentPercent)) / 100);
}

/** CE Architect.c:2436-2448：深度 1 恒入口房；此后大洞窟频率随深度线性上升。 */
export function adjustDungeonFirstRoomProfileForDepth(theProfile: DungeonProfile, depth: number): void {
    const descentPercent = dungeonDescentPercent(depth);
    if (depth === 1) {
        for (let i = 0; i < ROOM_TYPE_COUNT; i++) {
            theProfile.roomFrequencies[i] = 0;
        }
        theProfile.roomFrequencies[7] = 1;
    } else {
        theProfile.roomFrequencies[6] = (theProfile.roomFrequencies[6] ?? 0) + Math.floor((50 * descentPercent) / 100);
    }
}

function cloneDungeonProfile(dp: DungeonProfile): DungeonProfile {
    return { roomFrequencies: dp.roomFrequencies.slice(), corridorChance: dp.corridorChance };
}

/**
 * CE Grid.c:224 randomLocationInGrid：取第 index 个（index 随机）值为
 * validValue 的格。无候选时返回 (-1,-1) 且**不消耗 RNG**（CE 同）。
 */
function randomLocationInGrid(grid: RoomBuilder.RoomGrid, validValue: number): Pos {
    let count = 0;
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            if (grid[x]![y] === validValue) count++;
        }
    }
    if (count <= 0) return { x: -1, y: -1 };
    let index = rng.randRange(0, count - 1);
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            if (grid[x]![y] === validValue) {
                if (index === 0) return { x, y };
                index--;
            }
        }
    }
    return { x: -1, y: -1 }; // 不可达（count 已验证 > 0）
}

/**
 * CE Architect.c:2126-2150 directionOfDoorSite：格 (x,y) 若恰有一个方向 d
 * 使其**对侧**（-d）是地板（值 1），返回 d（门朝 d 开）；多于一个方向或
 * 已占用返回 NO_DIRECTION。
 */
function directionOfDoorSite(grid: RoomBuilder.RoomGrid, x: number, y: number): number {
    if (grid[x]![y]) return NO_DIRECTION;
    let solutionDir = NO_DIRECTION;
    for (let dir = 0; dir < 4; dir++) {
        const newX = x + NB4[dir]![0]!;
        const newY = y + NB4[dir]![1]!;
        const oppX = x - NB4[dir]![0]!;
        const oppY = y - NB4[dir]![1]!;
        if (coordinatesAreInMap(newX, newY) && coordinatesAreInMap(oppX, oppY) && grid[oppX]![oppY] === 1) {
            if (solutionDir !== NO_DIRECTION) {
                return NO_DIRECTION; // 两个方向都能开门 → 不是门位
            }
            solutionDir = dir;
        }
    }
    return solutionDir;
}

export class Architect {
    /** CE placeStairs writes DUNGEON and clears LIQUID/SURFACE, preserving GAS. */
    public static installStair(grid: Grid, p: Pos, type: TerrainType): void {
        grid.setTerrainLayer(p.x,p.y,DungeonLayer.DUNGEON,type);
        grid.setTerrainLayer(p.x,p.y,DungeonLayer.LIQUID,TerrainType.NOTHING);
        grid.setTerrainLayer(p.x,p.y,DungeonLayer.SURFACE,TerrainType.NOTHING);
    }

    /** CE prepareForStairs (:3654): torches flank the open mouth; expose and
     * protect every neighboring wall. Only DUNGEON is written here. */
    public static prepareStairLoc(grid: Grid, p: Pos): void {
        for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]] as const) {
            if (!(cellTerrainFlags(grid, p.x+dx, p.y+dy) & T_OBSTRUCTS_PASSABILITY)) {
                grid.setTerrainLayer(p.x-dy, p.y-dx, DungeonLayer.DUNGEON, TerrainType.TORCH_WALL);
                grid.setTerrainLayer(p.x+dy, p.y+dx, DungeonLayer.DUNGEON, TerrainType.TORCH_WALL);
                break;
            }
        }
        for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) {
            if (!dx && !dy) continue;
            const x=p.x+dx, y=p.y+dy;
            if (grid.getCell(x,y)!.layers[DungeonLayer.DUNGEON] === TerrainType.GRANITE) {
                grid.setTerrainLayer(x,y,DungeonLayer.DUNGEON,TerrainType.WALL);
            }
            if (cellTerrainFlags(grid,x,y) & T_OBSTRUCTS_PASSABILITY) grid.impregnableCells.add(y*grid.width+x);
        }
    }

    public grid: Grid;
    public machines: Array<{ door: Pos, center: Pos }> = [];
    // V-2b-1：删除 web 自创的 trapVaults / cages 数组——声明后从未 push，
    // Game.populateLevel 里消费它们的两个循环是死代码，已连带删除（详见
    // ai_docs/reports/v-2b-1.report.md §1.3）。
    // V-2b-4：删除 web 自创的 altars 数组——同样是"只 push、无人读"的死数组
    // （它的唯一消费者是 Game.ts 的自创祭坛组取物塌陷，本轮已按用户裁决拆除）。
    // machines 虽无消费者，但由 generateLevel 真实填充（legacy 观测面），
    // 归钥匙轮处置，本轮不动。
    public machineResults: MachineResult[] = [];
    /** C-0：本轮 generateTerrain 里 addLoops 开出的门位落位坐标（raster 序）。
     *  仅供测试/观测（真实环路存在性断言的锚点），不参与任何生成决策。 */
    public loopDoorSites: Pos[] = [];
    /** C-0：addLoops 扫描时的短整 work grid（1=地板 2=门位 0=墙，湖泊之前
     *  的真实拓扑快照）。仅供测试/观测，不参与任何生成决策。 */
    public loopWorkGrid: number[][] | null = null;

    /** P1-29 湖泊闸门的进程级累计（供测试/报告观测"20 次尝试全失败被跳过"
     *  的频率）。仅在 placeGatedLakeBlob 里递增。 */
    public static lakeGateStats = { placed: 0, skipped: 0 };

    /** C-1 观测：本层 designRandomRoom 的房型抽取计数（下标=RoomType，
     *  含首房间那次抽取）。仅供测试/报告观测，不参与任何生成决策。 */
    public roomTypeDraws: number[] = new Array(ROOM_TYPE_COUNT).fill(0);
    /** C-1 观测：本层首房间的房型（designRandomRoom 的 doorSites=null 调用）。
     *  CE 语义：深度 1 恒为 RoomType.ENTRANCE_ROOM。仅供观测。 */
    public firstRoomType: number = -1;
    /** C-1 观测：本层 attachRooms 成功落位的房间数（不含首房间）。仅供观测。 */
    public roomsBuilt: number = 0;
    /** C-1 观测：本层经走廊（attachHallwayTo）落位的房间数。仅供观测。 */
    public hallwayRoomsBuilt: number = 0;

    /** C-3 观测：本层 removeDiagonalOpenings 的统计（generateTerrain 重置）。
     *  仅供测试/报告观测，不参与任何生成决策。 */
    public diagonalFinishStats: DiagonalFinishStats = { passes: 0, removed: 0 };
    /** C-3 观测：本层 finishDoors 的统计（generateLevel 重置）。仅供观测。 */
    public doorFinishStats: DoorFinishStats | null = null;
    /** C-3 观测：本层两次 finishWalls 调用的实参与计数（generateTerrain 重置，
     *  下标 0 = 第 5 步 false、下标 1 = 第 14 步 true）。仅供观测——
     *  实参写反的对抗断言打在这里。 */
    public finishWallsCalls: WallFinishStats[] = [];

    // C-6 观测：本层两趟 runAutogenerators 的统计（generateTerrain 重置；
    // 下两者仅供测试/报告观测，不参与任何生成决策）。
    // nonMachine = CE digDungeon 第 7 步（fillLakes 后）、machine = 第 10 步
    //（机器阶段后）。machine 趟本轮应恒为空统计（机器条目全无载体，登记见
    // AutoGenerator.ts）——翻红即"无载体条目被接成空转链"。
    public autogenNonMachine: AutoGeneratorRunStats | null = null;
    public autogenMachine: AutoGeneratorRunStats | null = null;

    constructor(grid: Grid = new Grid(DCOLS, DROWS), private machineEntities?: MachineEntityRuntime) {
        this.grid = grid;
    }

    /** CE Architect.c:734-854. Mutates both terrain and the caller's interior.
     * Dynamic orphan storage avoids CE's unchecked pos[20] stack overflow. */
    public redesignInterior(interior: Set<number>, origin: Pos, profile: DungeonProfileId): void {
        const key = (x: number, y: number): number => y * DCOLS + x;
        const work = RoomBuilder.createEmptyRoomGrid();
        const orphans: Pos[] = [];
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                if (interior.has(key(x, y))) {
                    work[x]![y] = x === origin.x && y === origin.y ? 1 : 0;
                } else {
                    // CE cellIsPassableOrDoor (:48-55), using all four layers.
                    const flags = cellTerrainFlags(this.grid, x, y);
                    const passable = !(flags & T_PATHING_BLOCKER)
                        || !!((flags & T_OBSTRUCTS_PASSABILITY)
                            && (cellTerrainMechFlags(this.grid, x, y)
                                & (TM_IS_SECRET | TM_PROMOTES_WITH_KEY | TM_CONNECTS_LEVEL)));
                    work[x]![y] = passable ? 1 : -1;
                    if (!passable) continue;
                    for (const [dx, dy] of NB4) {
                        const nx = x + dx, ny = y + dy;
                        if (coordinatesAreInMap(nx, ny) && interior.has(key(nx, ny))
                            && (nx !== origin.x || ny !== origin.y)) {
                            orphans.push({ x: nx, y: ny });
                            // CE :759-763: record the interior neighbor, but shield
                            // THIS exterior cell; only the first neighbor is recorded.
                            work[x]![y] = -1;
                            break;
                        }
                    }
                }
            }
        }
        this.attachRooms(work, DUNGEON_PROFILE_CATALOG[profile], 40, 40);

        const scanner = new DijkstraMap(DCOLS, DROWS);
        const pathing = RoomBuilder.createEmptyRoomGrid();
        const costs = RoomBuilder.createEmptyRoomGrid();
        for (const orphan of orphans) {
            for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
                const inside = interior.has(key(x, y));
                pathing[x]![y] = inside && work[x]![y]! > 0 ? 0 : 30000;
                costs[x]![y] = inside ? 1 : -2; // CE PDS_OBSTRUCTION
            }
            scanner.batchScan(pathing, costs, false);
            let { x, y } = orphan;
            while (pathing[x]![y]! > 0) {
                const next = NB4.map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
                    .find(p => coordinatesAreInMap(p.x, p.y) && pathing[p.x]![p.y]! < pathing[x]![y]!);
                // CE brogueAssert(dir < 4); do not loop forever on invalid interiors.
                if (!next) throw new Error(`redesignInterior: unreachable orphan (${x},${y})`);
                work[x]![y] = 1;
                ({ x, y } = next);
            }
        }
        addLoopsToWorkGrid(work, 10);
        for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
            if (!interior.has(key(x, y))) continue;
            const value = work[x]![y]!;
            if (value >= 0) {
                this.grid.setTerrainLayer(x, y, DungeonLayer.SURFACE, TerrainType.NOTHING);
                this.grid.setTerrainLayer(x, y, DungeonLayer.GAS, TerrainType.NOTHING);
            }
            if (value === 0) {
                this.grid.setTerrainLayer(x, y, DungeonLayer.DUNGEON, TerrainType.GRANITE);
                interior.delete(key(x, y));
            } else if (value >= 1) {
                this.grid.setTerrainLayer(x, y, DungeonLayer.DUNGEON, TerrainType.FLOOR);
            }
        }
    }

    /**
     * 生成步骤 0-3：重置画布、carveDungeon（首房间 + attachRooms）、
     * grid→地形落位、addLoops 环路、环境叠加（含 P1-29 湖泊连通性闸门）。
     * C-2 起叠加阶段末尾依次执行 fillLakes（四类液体 + 镶边）、
     * cleanUpLakeBoundaries、while(buildABridge())——见
     * designEnvironmentOvelays 头注与 src/engine/Map/LakeSystem.ts。
     * 返回时**全部干地必然属同一个连通块**——这是湖泊闸门
     * 的合同，测试可直接对本阶段断言连通性（p1_29_lake_connectivity.test.ts）。
     * （岩浆/硫矿按 canMoveTo 口径可走，只会扩大干地集合；清理阶段带
     * "不可降低可走性"守卫，见 LakeSystem.ts 头注。）
     * 注意：步骤 5 的机器阶段（buildMachines）可能在此之后切断连通
     *（BlueprintEngine 的锁门/特征水深水不受本闸门约束，属独立缺陷，
     * 见 ai_docs/p1_29_lake_connectivity_report.md），不属于本合同范围。
     */
    public generateTerrain(depth: number): Grid {
        // Reset the grid
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                this.grid.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
            }
        }
        this.loopDoorSites = [];
        this.loopWorkGrid = null;
        this.roomTypeDraws = new Array(ROOM_TYPE_COUNT).fill(0);
        this.firstRoomType = -1;
        this.roomsBuilt = 0;
        this.hallwayRoomsBuilt = 0;
        this.autogenNonMachine = null;
        this.autogenMachine = null;

        // 1-2. carveDungeon（CE Architect.c:2456-2478）：首房间（深度剖面
        // 调整后的 DP_BASIC_FIRST_ROOM）+ attachRooms（DP_BASIC + 深度调整，
        // attempts=35, maxRoomCount=35）。产出 CE digDungeon 语义的短整
        // work grid（0 花岗岩 / 1 地板 / 2 门位）。
        const work = this.carveDungeon(depth);

        // 2.9 grid→地形落位（CE digDungeon Architect.c:2898-2905）：
        // 1→FLOOR；2→rand_percent(60) 且非最深层 ? DOOR : FLOOR。
        // CE 的落位在 addLoops 之后统一做；web 的 addLoops 消费 Grid 地形
        //（C-0 结构），故这里先落位——门位在 extractWorkGrid 里仍映射回 2，
        // 对 addLoops 的语义与 CE 等价（代价 1、不是候选）。
        this.translateWorkGridToTerrain(work, depth);

        // 2.95 C-0：地牢环路（CE digDungeon 第 3 步，Architect.c:2897
        // `addLoops(grid, 20)`）。新门位按 CE Architect.c:2900-2904 落成
        // DOOR/FLOOR（attachRooms 已落的门有同一落位规则，见上）。
        const loop = addLoops(this.grid, MINIMUM_PATHING_DISTANCE);
        this.loopWorkGrid = loop.work;
        this.loopDoorSites = applyLoopDoorSites(this.grid, loop.newSites, depth);

        // 2.97 C-3：finishWalls(false)（CE digDungeon 第 5 步，Architect.c:2909，
        // 湖泊之前只查四正暴露）。CE 的调用在 grid→地形落位之后、designLakes
        // 之前；web 的 addLoops 消费 Grid 地形（C-0 结构）故落在门位落位之后，
        // 相对湖泊阶段的位置与 CE 一致。
        this.diagonalFinishStats = { passes: 0, removed: 0 };
        this.doorFinishStats = null;
        this.finishWallsCalls = [];
        this.finishWallsCalls.push(finishWalls(this.grid, false));

        // 3. Generate Lakes and Foliage overlays
        this.designEnvironmentOvelays(depth);

        return this.grid;
    }

    /**
     * CE carveDungeon（Architect.c:2456-2478）的移植：在短整 work grid 上
     * 凿出首房间与 attachRooms 的房间/走廊，返回 0/1/2 网格。
     */
    private carveDungeon(depth: number): RoomBuilder.RoomGrid {
        const work = RoomBuilder.createEmptyRoomGrid();

        const theDP = cloneDungeonProfile(DUNGEON_PROFILE_CATALOG.DP_BASIC);
        adjustDungeonProfileForDepth(theDP, depth);
        const theFirstRoomDP = cloneDungeonProfile(DUNGEON_PROFILE_CATALOG.DP_BASIC_FIRST_ROOM);
        adjustDungeonFirstRoomProfileForDepth(theFirstRoomDP, depth);

        // CE Architect.c:2465：首房间直接画进 grid（无 doorSites、无走廊）。
        this.designRandomRoom(work, false, null, theFirstRoomDP.roomFrequencies);

        // web 合同适配（非 CE 内容）：Game.ts 把 D1 玩家出生点与上楼梯钉在
        // 画布中心 (DCOLS/2, DROWS/2)（Game.ts:424 与 populateLevel 的
        // "Default vestibule"），而 CE 的入口房在底部中央、不覆盖该点
        //（CE 自己把 D1 上楼梯锚在 (DCOLS-1)/2-1, DROWS-2，RogueMain.c:246）。
        // 中心凿 3×3 前厅 + 3 格宽走廊接到入口房顶部，保证中心是连通地板、
        // 且出生点 8 邻域可走（1 宽走廊会让玩家开局卡在瓶颈格，
        // p4_7/monster_stats_effect 的接敌场景在窄井里无法成立）。
        if (depth === 1) {
            const cx = Math.floor(DCOLS / 2);
            const cy = Math.floor(DROWS / 2);
            for (let x = cx - 1; x <= cx + 1; x++) {
                for (let y = cy - 1; y <= Math.min(cy + 1, DROWS - 3); y++) {
                    work[x]![y] = 1;
                }
                for (let y = cy + 2; y < DROWS - 2; y++) {
                    if (work[x]![y] === 1) break; // 已接到入口房
                    work[x]![y] = 1;
                }
            }
        }

        this.attachRooms(work, theDP, CE_ROOM_ATTACH_ATTEMPTS, CE_MAX_ROOM_COUNT);
        return work;
    }

    /** CE digDungeon Architect.c:2898-2905：work grid → 地形落位。 */
    private translateWorkGridToTerrain(work: RoomBuilder.RoomGrid, depth: number): void {
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                if (work[x]![y] === 1) {
                    this.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
                } else if (work[x]![y] === 2) {
                    // CE：rand_percent(60) && depthLevel < deepestLevel ? DOOR : FLOOR
                    //（C 的 && 短路：先掷骰）。非最深层口径同 LoopMap.applyLoopDoorSites。
                    const asDoor = rng.randPercent(LOOP_DOOR_PERCENT) && depth < DEEPEST_LEVEL;
                    if (asDoor) {
                        this.grid.setTerrain(x, y, TerrainType.DOOR, '+', 0xaa8844);
                    } else {
                        this.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
                    }
                }
            }
        }
    }

    public generateLevel(depth: number): Grid {
        this.generateTerrain(depth);

        // 4. Place terrain traps/secret doors based on depth
        if (depth >= 3) {
            this.placeTraps(depth);
        }

        // 5. Build machines via data-driven BlueprintEngine
        resetMachineCounter();
        const bpEngine = new BlueprintEngine(this.grid, depth, undefined, this.machineEntities);
        this.machineResults = bpEngine.buildMachines();

        // Backward-compat: populate legacy arrays from machine results
        // V-2b-4：altars 数组及其填充块（依赖 MachineResult.altarGroupId）已随
        // 自创祭坛组子系统一并拆除——CE 无祭坛分组概念（Rogue.h 零命中）。
        for (const mr of this.machineResults) {
            if (mr.needsKey && mr.door) {
                this.machines.push({ door: mr.door, center: mr.center });
            }
        }

        // C-6：runAutogenerators(true)——CE digDungeon 第 10 步
        //（Architect.c:2952：addMachines 之后、cleanUpLakeBoundaries 之前；
        // web 的湖泊清理/架桥因 Game.ts 禁改已前移，C-2 头注登记在案，
        // 故本趟落在机器阶段之后、finishDoors 之前，相对机器的位置与 CE 一致）。
        // V-2b-8：本趟通过同一个 BlueprintEngine 强制建造已接线的 MT_* 蓝图；
        // 正 bp 不走 reward 抽签或配额，成功结果并入生产 machineResults。
        const flattenAutogen = (r: MachineResult): MachineResult[] =>
            [r, ...r.subMachines.flatMap(flattenAutogen)];
        this.autogenMachine = runAutogenerators(this.grid, depth, true, undefined, machine => {
            const built = bpEngine.buildAMachine(machine, [], null, null);
            if (!built) return false;
            this.machineResults.push(...flattenAutogen(built));
            return true;
        }, (x, y) => bpEngine.hasPendingOccupant(x, y));

        // C-3：finishDoors（CE digDungeon 第 13 步，Architect.c:2971）——
        // 孤儿门移除 + 密门升级。机器内部的门由 Cell.machineNumber 豁免
        //（CE 2738-2739 `machineNumber == 0` 同款；BlueprintEngine 落位时写入）。
        this.doorFinishStats = finishDoors(this.grid, depth);

        // C-3：finishWalls(true)（CE digDungeon 第 14 步，Architect.c:2974：
        // 含对角暴露的最终墙面收尾）。
        this.finishWallsCalls.push(finishWalls(this.grid, true));

        return this.grid;
    }

    /** Scatter traps, secret doors, and pressure plates across floor tiles. */
    private placeTraps(depth: number) {
        // Collect all walkable floor tiles (far from entrance/exit)
        const floorTiles: { x: number, y: number }[] = [];
        for (let x = 2; x < DCOLS - 2; x++) {
            for (let y = 2; y < DROWS - 2; y++) {
                const c = this.grid.getCell(x, y);
                if (c && c.terrain === TerrainType.FLOOR) {
                    floorTiles.push({ x, y });
                }
            }
        }

        if (floorTiles.length === 0) return;

        // Shuffle floor tiles
        for (let i = floorTiles.length - 1; i > 0; i--) {
            const j = rng.randRange(0, i);
            const tmp = floorTiles[i]!;
            floorTiles[i] = floorTiles[j]!;
            floorTiles[j] = tmp;
        }

        const trapTypes: Array<'poison_gas' | 'teleport' | 'fire'> = ['poison_gas', 'teleport', 'fire'];
        const trapCount = Math.min(Math.floor(depth / 2) + 1, 5);

        // Place traps
        for (let i = 0; i < trapCount && i < floorTiles.length; i++) {
            const tile = floorTiles[i]!;
            this.grid.setTerrain(tile.x, tile.y, TerrainType.TRAP, '^', 0x884400);
            const cell = this.grid.getCell(tile.x, tile.y);
            if (cell) {
                cell.trapType = trapTypes[i % trapTypes.length]!;
                cell.isPassable = true; // Traps are walkable
            }
        }

        // Place secret doors (depth 4+): replace a WALL adjacent to FLOOR on both sides
        if (depth >= 4) {
            const secretDoorCount = Math.min(Math.floor((depth - 2) / 2), 3);
            let placed = 0;
            for (let attempt = 0; attempt < 200 && placed < secretDoorCount; attempt++) {
                const rx = rng.randRange(1, DCOLS - 2);
                const ry = rng.randRange(1, DROWS - 2);
                const cell = this.grid.getCell(rx, ry);
                if (cell?.terrain !== TerrainType.WALL) continue;

                // Check that there is a FLOOR on two opposite sides (horizontal or vertical)
                const left = this.grid.getCell(rx - 1, ry)?.terrain === TerrainType.FLOOR;
                const right = this.grid.getCell(rx + 1, ry)?.terrain === TerrainType.FLOOR;
                const up = this.grid.getCell(rx, ry - 1)?.terrain === TerrainType.FLOOR;
                const down = this.grid.getCell(rx, ry + 1)?.terrain === TerrainType.FLOOR;

                if ((left && right) || (up && down)) {
                    this.grid.setTerrain(rx, ry, TerrainType.SECRET_DOOR, '#', 0x555555);
                    placed++;
                }
            }
        }

        // Place pressure plate (depth 5+): triggers adjacent traps
        if (depth >= 5 && floorTiles.length > trapCount) {
            const plateIdx = trapCount; // Use next floor tile after traps
            const tile = floorTiles[plateIdx]!;
            this.grid.setTerrain(tile.x, tile.y, TerrainType.PRESSURE_PLATE, '_', 0x446644);
            const cell = this.grid.getCell(tile.x, tile.y);
            if (cell) cell.isPassable = true;
        }
    }

    /**
     * CE attachRooms（Architect.c:2367-2423）的移植：在超空间 roomMap 里
     * 造房间（按 corridorChance 决定是否接走廊），把 roomMap 在全图洗牌序
     * 的每个位置上"滑动"，直到 doorSites 对得上既有地板的墙格（唯一门位
     * 方向 + 3×3 光环净空），落位并把门格标成 2。
     * roomsBuilt 从 0 计（CE 同，不含首房间），至多 maxRoomCount、至多
     * attempts 次尝试；最后 5 次尝试不接走廊（CE `roomsAttempted <= attempts - 5`）。
     */
    private attachRooms(work: RoomBuilder.RoomGrid, dp: DungeonProfile, attempts: number, maxRoomCount: number): void {
        // CE fillSequentialList + shuffleList（Math.c:66/83，Fisher-Yates）。
        const sCoord: number[] = [];
        for (let v = 0; v < DCOLS * DROWS; v++) sCoord.push(v);
        rng.shuffleList(sCoord);

        const roomMap = RoomBuilder.createEmptyRoomGrid();
        let roomsBuilt = 0;
        for (let roomsAttempted = 0; roomsBuilt < maxRoomCount && roomsAttempted < attempts; roomsAttempted++) {
            // Build a room in hyperspace.
            for (let x = 0; x < DCOLS; x++) roomMap[x]!.fill(0);
            const doorSites: Pos[] = [];
            for (let d = 0; d < 4; d++) doorSites.push({ x: -1, y: -1 });
            const attachHallway = roomsAttempted <= attempts - 5 && rng.randPercent(dp.corridorChance);
            this.designRandomRoom(roomMap, attachHallway, doorSites, dp.roomFrequencies);

            // Slide hyperspace across real space until the room matches up with a wall.
            for (let i = 0; i < DCOLS * DROWS; i++) {
                const x = Math.floor(sCoord[i]! / DROWS);
                const y = sCoord[i]! % DROWS;
                const dir = directionOfDoorSite(work, x, y);
                if (dir === NO_DIRECTION) continue;
                const oppDir = OPPOSITE_DIRECTION[dir]!;
                if (doorSites[oppDir]!.x === -1) continue;
                const offX = x - doorSites[oppDir]!.x;
                const offY = y - doorSites[oppDir]!.y;
                if (!this.workRoomFitsAt(work, roomMap, offX, offY)) continue;

                // Room fits here.
                workInsertRoomAt(work, roomMap, offX, offY, doorSites[oppDir]!.x, doorSites[oppDir]!.y);
                work[x]![y] = 2; // Door site.
                roomsBuilt++;
                if (attachHallway) this.hallwayRoomsBuilt++;
                break;
            }
        }
        this.roomsBuilt = roomsBuilt;
    }

    /**
     * CE designRandomRoom（Architect.c:2274-2316）的移植：按频率加权抽房型
     * 并画到 grid 上；doorSites 非 null 时计算四个方向的候选门位，必要时
     * （attachHallway）接一条走廊并把门位搬到走廊末端。
     */
    private designRandomRoom(grid: RoomBuilder.RoomGrid, attachHallway: boolean, doorSites: Pos[] | null, roomTypeFrequencies: number[]): void {
        let sum = 0;
        for (let i = 0; i < ROOM_TYPE_COUNT; i++) {
            sum += roomTypeFrequencies[i] ?? 0;
        }
        let randIndex = rng.randRange(0, sum - 1);
        let i = 0;
        for (; i < ROOM_TYPE_COUNT; i++) {
            const frequency = roomTypeFrequencies[i] ?? 0;
            if (randIndex < frequency) {
                break; // "i" is our room type.
            }
            randIndex -= frequency;
        }
        if (i < ROOM_TYPE_COUNT) {
            this.roomTypeDraws[i] = (this.roomTypeDraws[i] ?? 0) + 1;
            if (doorSites === null) this.firstRoomType = i;
        }
        switch (i) {
            case RoomType.CROSS_ROOM:
                RoomBuilder.designCrossRoom(grid);
                break;
            case RoomType.SMALL_SYMMETRICAL_CROSS_ROOM:
                RoomBuilder.designSymmetricalCrossRoom(grid);
                break;
            case RoomType.SMALL_ROOM:
                RoomBuilder.designSmallRoom(grid);
                break;
            case RoomType.CIRCULAR_ROOM:
                RoomBuilder.designCircularRoom(grid);
                break;
            case RoomType.CHUNKY_ROOM:
                RoomBuilder.designChunkyRoom(grid);
                break;
            case RoomType.CAVE:
                // CE Architect.c:2301-2312：洞穴房三选一（紧凑 / 南北长大 /
                // 东西长大）。
                switch (rng.randRange(0, 2)) {
                    case 0:
                        RoomBuilder.designCavern(grid, 3, 12, 4, 8); // Compact cave room.
                        break;
                    case 1:
                        RoomBuilder.designCavern(grid, 3, 12, 15, DROWS - 2); // Large north-south cave room.
                        break;
                    default:
                        RoomBuilder.designCavern(grid, 20, DROWS - 2, 4, 8); // Large east-west cave room.
                        break;
                }
                break;
            case RoomType.CAVERN:
                RoomBuilder.designCavern(grid, CAVE_MIN_WIDTH, DCOLS - 2, CAVE_MIN_HEIGHT, DROWS - 2);
                break;
            case RoomType.ENTRANCE_ROOM:
                RoomBuilder.designEntranceRoom(grid);
                break;
            default:
                break;
        }

        if (doorSites) {
            this.chooseRandomDoorSites(grid, doorSites);
            if (attachHallway) {
                let dir = rng.randRange(0, 3);
                for (let k = 0; doorSites[dir]!.x === -1 && k < 3; k++) {
                    dir = (dir + 1) % 4; // Each room will have at least 2 valid directions for doors.
                }
                this.attachHallwayTo(grid, doorSites);
            }
        }
    }

    /**
     * CE chooseRandomDoorSites（Architect.c:2152-2205）：对房间的每个空格
     * 判定唯一门位方向，再向房间外射线 10 格确认不与房间自身相交；然后
     * 每个方向用 randomLocationInGrid 抽一个门位（无候选的方向不消耗 RNG）。
     */
    private chooseRandomDoorSites(roomMap: RoomBuilder.RoomGrid, doorSites: Pos[]): void {
        const scratch = RoomBuilder.createEmptyRoomGrid();
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                scratch[x]![y] = roomMap[x]![y]!;
            }
        }

        for (let i = 0; i < DCOLS; i++) {
            for (let j = 0; j < DROWS; j++) {
                if (scratch[i]![j]) continue;
                const dir = directionOfDoorSite(roomMap, i, j);
                if (dir === NO_DIRECTION) continue;
                // Trace a ray 10 spaces outward to make sure it doesn't intersect the room.
                let newX = i + NB4[dir]![0]!;
                let newY = j + NB4[dir]![1]!;
                let doorSiteFailed = false;
                for (let k = 0; k < 10 && coordinatesAreInMap(newX, newY) && !doorSiteFailed; k++) {
                    if (scratch[newX]![newY]) {
                        doorSiteFailed = true;
                    }
                    newX += NB4[dir]![0]!;
                    newY += NB4[dir]![1]!;
                }
                if (!doorSiteFailed) {
                    scratch[i]![j] = dir + 2; // 不与 0/1 冲突
                }
            }
        }

        for (let dir = 0; dir < 4; dir++) {
            doorSites[dir] = randomLocationInGrid(scratch, dir + 2);
        }
    }

    /**
     * CE attachHallwayTo（Architect.c:2207-2272）：从房间的一个门位向外
     * 凿一条直走廊（横 5-15 / 竖 2-9），再把门位搬到走廊末端（15% 概率
     * 允许斜向出口——即四个方向都尝试指到末端格的邻格）。
     */
    private attachHallwayTo(grid: RoomBuilder.RoomGrid, doorSites: Pos[]): void {
        const dirs = [0, 1, 2, 3];
        rng.shuffleList(dirs);
        let dir = NO_DIRECTION;
        let i = 0;
        for (; i < 4; i++) {
            dir = dirs[i]!;
            const ds = doorSites[dir]!;
            if (ds.x !== -1 && ds.y !== -1
                && coordinatesAreInMap(
                    ds.x + NB4[dir]![0]! * HORIZONTAL_CORRIDOR_MAX_LENGTH,
                    ds.y + NB4[dir]![1]! * VERTICAL_CORRIDOR_MAX_LENGTH)) {
                break; // That's our direction!
            }
        }
        if (i === 4) {
            return; // No valid direction for hallways.
        }

        let length: number;
        if (dir === DIR_UP || dir === DIR_DOWN) {
            length = rng.randRange(VERTICAL_CORRIDOR_MIN_LENGTH, VERTICAL_CORRIDOR_MAX_LENGTH);
        } else {
            length = rng.randRange(HORIZONTAL_CORRIDOR_MIN_LENGTH, HORIZONTAL_CORRIDOR_MAX_LENGTH);
        }

        let x = doorSites[dir]!.x;
        let y = doorSites[dir]!.y;
        for (let k = 0; k < length; k++) {
            if (coordinatesAreInMap(x, y)) {
                grid[x]![y] = 1;
            }
            x += NB4[dir]![0]!;
            y += NB4[dir]![1]!;
        }
        // Now (x, y) points at the last interior cell of the hallway.
        x = Math.min(Math.max(x - NB4[dir]![0]!, 0), DCOLS - 1);
        y = Math.min(Math.max(y - NB4[dir]![1]!, 0), DROWS - 1);
        const allowObliqueHallwayExit = rng.randPercent(15);
        for (let dir2 = 0; dir2 < 4; dir2++) {
            const newX = x + NB4[dir2]![0]!;
            const newY = y + NB4[dir2]![1]!;
            if ((dir2 !== dir && !allowObliqueHallwayExit)
                || !coordinatesAreInMap(newX, newY)
                || grid[newX]![newY]) {
                doorSites[dir2] = { x: -1, y: -1 };
            } else {
                doorSites[dir2] = { x: newX, y: newY };
            }
        }
    }

    /**
     * CE roomFitsAt（Architect.c:2318-2344）：房间每个格子的 3×3 邻域
     * （含对角）都必须在图内且是花岗岩（work==0）——房间之间永远隔着
     * 至少一圈墙，门位格（2）同样挤占邻域。
     */
    private workRoomFitsAt(work: RoomBuilder.RoomGrid, roomMap: RoomBuilder.RoomGrid, roomToWorkX: number, roomToWorkY: number): boolean {
        for (let xRoom = 0; xRoom < DCOLS; xRoom++) {
            for (let yRoom = 0; yRoom < DROWS; yRoom++) {
                if (!roomMap[xRoom]![yRoom]) continue;
                const xDungeon = xRoom + roomToWorkX;
                const yDungeon = yRoom + roomToWorkY;
                for (let i = xDungeon - 1; i <= xDungeon + 1; i++) {
                    for (let j = yDungeon - 1; j <= yDungeon + 1; j++) {
                        if (!coordinatesAreInMap(i, j) || (work[i]![j] ?? 0) > 0) {
                            return false;
                        }
                    }
                }
            }
        }
        return true;
    }

    /**
     * 环境叠加层（C-2 后的管线）：
     * 1. 浅水/草/树/泥/网等**可踏入**叠加层照 web 原样直铺（web 自创内容，
     *    C-6 runAutogenerators 落地前的对应物）——但跳过 lakeMap 成员格，
     *    保持"液体优先"与既有行为一致（此前深水先落地、后续叠加层只盖
     *    FLOOR，效果相同）。
     * 2. 深水（唯一不可踏入的叠加层）经 P1-29 闸门选址后**不再直接落地**，
     *    而是记入 lakeMap——对应 CE designLakes 只标记 lakeMap 的语义
     *    （Architect.c:2674-2681 复制进 lakeMap，不动 LIQUID 层）。
     * 3. fillLakes（CE 2709-2730）：逐连通组件 liquidType 抽四类液体之一
     *    （本轮 CHASM 候选剔除，见 LakeSystem 头注），fillLake(±4) 灌注并
     *    合并邻近湖，createWreath 镶边。
     * 4. cleanUpLakeBoundaries（CE 1856-1912）打通相邻同类湖。
     * 5. while (buildABridge())（CE 2786-2876）架桥。CHASM 本轮不生成 →
     *    恒无处可架，但 RNG 消耗与 CE 一致。
     *
     * 与 CE digDungeon（2926-2966）的顺序差异：CE 的清理与架桥在
     * addMachines 之后；web 的机器阶段在 Game.generateLevel 里位于
     * generateTerrain 之后（Game.ts 本轮禁改，无法交错）——机器格不受
     * 本轮两个阶段影响的行为由 machineNumber/选址闸门各自保证。
     * removeDiagonalOpenings（C-3）在 fillLakes → runAutogenerators(false)（C-6）
     * 之后、cleanUpLakeBoundaries 之前执行（CE 第 7→8 步位置）；
     * finishDoors / finishWalls(true)（C-3）在 generateLevel 的机器阶段与
     * runAutogenerators(true)（C-6）之后（CE 第 10→13/14 步位置），见上。
     */
    private designEnvironmentOvelays(depth: number) {
        const lakeMap = new Set<number>();

        const overlays = [
            { type: TerrainType.WATER_SHALLOW, count: rng.randRange(1, 4), char: '~', color: 0x3366cc, name: 'shallow water' },
            { type: TerrainType.WATER_DEEP, count: rng.randRange(0, 2), char: '~', color: 0x1133aa, name: 'deep water' },
            { type: TerrainType.GRASS, count: rng.randRange(2, 6), char: '"', color: 0x33aa33, name: 'grass' },
            { type: TerrainType.FOLIAGE, count: rng.randRange(1, 3), char: '♠', color: 0x228822, name: 'foliage' }
        ];

        if (depth >= 3) {
            overlays.push({ type: TerrainType.MUD, count: rng.randRange(0, 2), char: '~', color: 0x664422, name: 'mud' });
        }
        if (depth >= 4) {
            overlays.push({ type: TerrainType.WEB, count: rng.randRange(0, Math.floor(depth / 3)), char: '\\', color: 0xcccccc, name: 'spider web' });
        }

        for (const overlay of overlays) {
            // P1-29：不可踏入的叠加层（canMoveTo 口径，现役仅深水）会隔断移动，
            // 放置前必须过 CE 的连通性闸门；可踏入的（浅水/草/树/泥/网）不用。
            // C-2：闸门通过的深水不直接落地，记入 lakeMap 待 fillLakes 统一灌注。
            const gated = !terrainAllowsMove(overlay.type);
            for (let i = 0; i < overlay.count; i++) {
                // Generate a random organic shape
                const blobMap = RoomBuilder.createEmptyRoomGrid();
                const scaleW = rng.randRange(8, 20);
                const scaleH = rng.randRange(6, 15);

                const blob = RoomBuilder.createBlobOnGrid(blobMap, 5, 4, 4, scaleW, scaleH, 50, "ffffftttt", "ffffttttt");

                if (gated) {
                    this.placeGatedLakeBlob(blobMap, blob, overlay, lakeMap);
                    continue;
                }

                // Find a random floor spot to center it on
                for (let attempt = 0; attempt < 10; attempt++) {
                    const cx = rng.randRange(1, DCOLS - blob.width - 2);
                    const cy = rng.randRange(1, DROWS - blob.height - 2);
                    const centerKey = (cy + Math.floor(blob.height / 2)) * DCOLS + cx + Math.floor(blob.width / 2);

                    if (lakeMap.has(centerKey)) continue; // 湖格不再是 FLOOR（此前由"深水已落地"间接保证）
                    if (this.grid.getCell(cx + Math.floor(blob.width / 2), cy + Math.floor(blob.height / 2))?.terrain === TerrainType.FLOOR) {
                        // Stamp the blob
                        for (let bx = 0; bx < blob.width; bx++) {
                            for (let by = 0; by < blob.height; by++) {
                                // Important: We only overwrite FLOOR with these environmental patches
                                // We don't want water digging through walls or replacing doors.
                                if (blobMap[blob.minX + bx]![blob.minY + by] === 1) {
                                    const gx = cx + bx;
                                    const gy = cy + by;
                                    if (lakeMap.has(gy * DCOLS + gx)) continue; // 同上
                                    if (this.grid.isValidPos(gx, gy) && this.grid.getCell(gx, gy)?.terrain === TerrainType.FLOOR) {
                                        this.grid.setTerrain(gx, gy, overlay.type, overlay.char, overlay.color);
                                    }
                                }
                            }
                        }
                        break; // Successful stamp
                    }
                }
            }
        }

        // C-2：CE digDungeon 湖泊后四步中的三步（第四步 runAutogenerators
        // 属 C-6，已在本函数上方接线）。
        fillLakes(this.grid, lakeMap, depth);

        // C-6：runAutogenerators(false)——CE digDungeon 第 7 步
        //（Architect.c:2933：fillLakes 之后、removeDiagonalOpenings 之前）。
        // 非机器条目（草/树/装饰 DF 等）；未接条目在 AutoGenerator 内先于
        // 任何 RNG 消耗跳过（载体盘点见 AutoGenerator.ts 头注）。
        this.autogenNonMachine = runAutogenerators(this.grid, depth, false);

        // C-3：removeDiagonalOpenings（CE digDungeon 第 8 步，Architect.c:2936：
        // fillLakes 之后、addMachines/cleanUpLakeBoundaries 之前；web 的机器
        // 阶段在 Game.generateLevel，清理与架桥受 Game.ts 禁改约束已在
        // 机器前执行——相对湖泊的位置与 CE 一致）。
        this.diagonalFinishStats = removeDiagonalOpenings(this.grid);
        cleanUpLakeBoundaries(this.grid);
        while (buildABridge(this.grid, depth)) {
            // 桥数可从 BRIDGE 地形计数观测；本轮 CHASM 不生成，此处恒不进入。
        }
    }

    /**
     * P1-29：CE designLakes（Architect.c:2638-2688）的放置语义。
     * 每个湖最多 LAKE_PLACEMENT_ATTEMPTS 次随机选址（Architect.c:2659
     * `for (k=0; k<20; k++)`）；每次先算出"真正会被盖上去的格子集"
     * （blob 命中 ∧ 目标格是 FLOOR，与落地盖章完全同一子集规则），
     * 假想放置后用 lakeDisruptsPassability（Architect.c:2588）验证干地
     * 仍连通，通过才落地；不通过换位重试，次数用尽就**跳过这个湖**
     * （CE 语义：不硬塞）。返回是否放置成功。
     *
     * C-2：lakeMap 非 null 时改为 CE designLakes 的完整语义——成功只把
     * 候选格**记入 lakeMap**（CE 2674-2681 `lakeMap[...] = true`，不碰
     * LIQUID 层），液体由 LakeSystem.fillLakes 统一灌注；且已收进 lakeMap
     * 的格子在本格验证时视作阻断（CE lakeFloodFill 2578 `!lakeMap[...]`），
     * 与"先落地的深水不可走"逐格等价。3 参调用（既有测试契约）保持原
     * 行为：成功直接落地 overlay 地形。
     */
    private placeGatedLakeBlob(
        blobMap: RoomBuilder.RoomGrid,
        blob: { minX: number, minY: number, width: number, height: number },
        overlay: { type: TerrainType, char: string, color: number },
        lakeMap?: Set<number>
    ): boolean {
        for (let attempt = 0; attempt < LAKE_PLACEMENT_ATTEMPTS; attempt++) {
            const cx = rng.randRange(1, DCOLS - blob.width - 2);
            const cy = rng.randRange(1, DROWS - blob.height - 2);

            const candidate: Pos[] = [];
            for (let bx = 0; bx < blob.width; bx++) {
                for (let by = 0; by < blob.height; by++) {
                    if (blobMap[blob.minX + bx]![blob.minY + by] !== 1) continue;
                    const gx = cx + bx;
                    const gy = cy + by;
                    if (this.grid.isValidPos(gx, gy) && this.grid.getCell(gx, gy)?.terrain === TerrainType.FLOOR) {
                        candidate.push({ x: gx, y: gy });
                    }
                }
            }
            if (candidate.length === 0) continue; // 盖不到任何地板，等于没放

            // 候选湖 + 已收录的湖（CE lakeMap）都视作阻断物参与连通性验证。
            const blocked = new Set<number>(lakeMap);
            for (const p of candidate) blocked.add(p.y * this.grid.width + p.x);
            if (lakeDisruptsPassability(this.grid, (x, y) => blocked.has(y * this.grid.width + x))) {
                continue; // 会切断关卡，换位重试
            }

            if (lakeMap) {
                for (const p of candidate) lakeMap.add(p.y * this.grid.width + p.x);
            } else {
                for (const p of candidate) {
                    this.grid.setTerrain(p.x, p.y, overlay.type, overlay.char, overlay.color);
                }
            }
            Architect.lakeGateStats.placed++;
            return true;
        }
        Architect.lakeGateStats.skipped++;
        return false;
    }
}
