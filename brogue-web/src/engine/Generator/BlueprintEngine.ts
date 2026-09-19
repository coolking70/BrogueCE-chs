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

import { Grid, TerrainType, DCOLS, DROWS, type Cell } from '../Map/Grid';
import { analyzeChokeMap, CE_GATE_CANDIDATE_CAP, type ChokeAnalysis } from '../Map/LoopMap';
import { terrainAllowsMove, DIRS8 } from '../Map/Connectivity';
import { DijkstraMap, MAX_DISTANCE } from '../Map/Pathfinding';
import { allocShortGrid } from '../Map/SafetyMap';
import { rng } from '../Random';
import type { Pos } from '../../types';
import blueprintData from '../../data/blueprints.json';

// ----- Type definitions -----

export interface FeatureDef {
    terrain?: string;
    trapType?: string;
    itemCategory?: string;
    itemId?: string;
    monsterId?: string;
    hordeId?: string;
    instanceCount: [number, number];
    /**
     * V-1c：CE machineFeature.minimumInstanceCount（Rogue.h:2714 一带）的
     * web 载体——本 feature 实际落位实例数达不到它时整机失败回滚
     * （CE Architect.c:1676-1687）。V-2a 起（前厅递归 / 锁门钥匙 / 基座
     * 大奖等新增 feature）按 CE 原值显式给出；既有 feature 仍缺省取
     * instanceCount[0]（web 的 [min,max] 掷骰区间下沿即"至少要建几个"的
     * 自然读法），全表显式化归 V-2b。
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
    /** Items to spawn: { category, id?, pos } */
    itemSpawns: Array<{ category: string; id?: string; pos: Pos; isAltar?: boolean }>;
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

/** V-1c：findGateRoom 的三态结果（见该方法头注）。 */
type GateSelection =
    | { kind: 'room'; cells: Pos[]; center: Pos; door: Pos }
    | { kind: 'noCandidates' }
    | { kind: 'retry' };

/** V-1c：整层可变格状态快照（CE p->levelBackup 的 web 形态，见 backupLevel）。 */
type LevelBackup = Array<{
    layers: TerrainType[]; char: string; color: number;
    isPassable: boolean; isOpaque: boolean;
    machineNumber: number; trapType: Cell['trapType']; altarGroupId: number | null;
}>;

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

        // 1. Mark all cells as belonging to this machine
        for (const p of room.cells) {
            const cell = this.grid.getCell(p.x, p.y);
            if (cell) cell.machineNumber = machineNum;
        }
        // V-2a：machineNumber 是 findGateRoom 候选过滤（!IS_IN_MACHINE）的
        // 依据——本步起机器标号上网格，门位候选缓存就此失效。**analysis
        // 缓存不在此失效**（失效点在本方法尾部）：chokeMap/gateSite 是地形
        // 派生物，CE 的对应物本就是每层预计算、机器阶段不重算
        // （Architect.c:1063-1101），递归子机器沿用父选址时的分析正是该
        // 语义；把它也提前失效会让子机器的分析耦合进父机器地形，选址结果
        // 与重捕获基线分叉（seed31337/D2 实证）。
        this.gateCandidatesCache.clear();

        // 2. Purge interior if requested
        if (flags.has('BP_PURGE_INTERIOR')) {
            for (const p of room.cells) {
                this.grid.setTerrain(p.x, p.y, TerrainType.FLOOR, '.', 0x888888);
            }
        }

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
        const availableCells = [...room.cells];
        rng.shuffleList(availableCells);
        const usedCells = new Set<string>();
        // center 保留给宝藏：feature 地形（如 key_flood_trap 的 WATER_DEEP、
        // key_lava_moat 的 LAVA）与 feature 物品都不得落在 center 上，
        // 否则 Game.ts 之后放在 center 的宝藏会躺进不可通行格。
        usedCells.add(`${room.center.x},${room.center.y}`);
        // door 同理：doorPos 已在上一步（若 bp.doorTerrain 存在）写成门地形
        // （常见 LOCKED_DOOR，不可通行），但此刻仍留在 availableCells 里，
        // 若不排除，findFeaturePosition 可能把 MF_GENERATE_ITEM（_random_good_/
        // KEY 等）feature 的坐标选到它头上，物品就直接躺进了刚铺好的门格
        // （玩家永远拿不到）。P1-20：24 件高价值物品落在 LOCKED_DOOR 上的根因。
        if (doorPos) {
            usedCells.add(`${doorPos.x},${doorPos.y}`);
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

        for (const [feat, feature] of bp.features.entries()) {
            if (skipFeature[feat]) continue; // CE Architect.c:1329：未被选中的替代 feature 整条跳过
            const count = rng.randRange(feature.instanceCount[0], feature.instanceCount[1]);
            const fFlags = new Set(feature.flags);
            let placed = 0;

            for (let inst = 0; inst < count; inst++) {
                // Find a placement position
                // V-2a：origin = 机器落位锚点（CE originX/Y）——BP_ROOM 机器是
                // 门位格（CE :1100-1101 的 gateCandidates 抽中的 gate），前厅
                // 机器 center/door 同格即 origin。MF_BUILD_AT_ORIGIN 的 feature
                // 以它为唯一定点。
                const pos = this.findFeaturePosition(
                    availableCells, usedCells, room.center,
                    room.door ?? room.center, feature, fFlags
                );
                if (!pos) break;
                placed++;

                usedCells.add(`${pos.x},${pos.y}`);

                // Mark personal space
                if (feature.personalSpace && feature.personalSpace > 0) {
                    this.markPersonalSpace(pos, feature.personalSpace, usedCells);
                }

                // Place terrain
                if (feature.terrain) {
                    const terrainType = TERRAIN_MAP[feature.terrain];
                    const visual = TERRAIN_VISUALS[feature.terrain];
                    if (terrainType !== undefined) {
                        const ch = visual?.char ?? '.';
                        const col = visual?.color ?? 0x888888;
                        this.grid.setTerrain(pos.x, pos.y, terrainType, ch, col);

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

                // Generate item spawn instructions.
                // V-1c（CE :1495-1541）：领养优先——BP_ADOPT_ITEM 机器的
                // MF_ADOPT_ITEM feature 消耗父机器交来的物品（只领一次，
                // CE :1503 "can be adopted only once"），不再自产；自产物
                // 带 MF_OUTSOURCE_ITEM_TO_MACHINE 时不落本机（CE :1533-1539
                // 非外包才 placeItemAt），指令交由下面的递归块交给子机器。
                let theItem: MachineResult['itemSpawns'][number] | null = null;
                if (ctx.adoptiveItem && fFlags.has('MF_ADOPT_ITEM') && effFlags.has(BP_ADOPT_ITEM)) {
                    theItem = { ...ctx.adoptiveItem, pos: { x: pos.x, y: pos.y } };
                    itemSpawns.push(theItem);
                    ctx.adoptiveItem = null;
                } else if (fFlags.has('MF_GENERATE_ITEM') && feature.itemCategory) {
                    theItem = {
                        category: feature.itemCategory,
                        id: feature.itemId,
                        pos: { x: pos.x, y: pos.y },
                        isAltar: fFlags.has('MF_ALTAR')
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

                // Generate monster spawn instructions
                if (fFlags.has('MF_GENERATE_MONSTER') && feature.monsterId) {
                    monsterSpawns.push({
                        monsterId: feature.monsterId,
                        pos: { x: pos.x, y: pos.y },
                        isAlly: fFlags.has('MF_MONSTER_IS_ALLY'),
                        isCaged: fFlags.has('MF_MONSTER_IS_CAGED')
                    });
                }
            }

            // V-1c：CE :1676-1687——本 feature 实际落位数达不到
            // minimumInstanceCount（web 缺省 = instanceCount[0]，见 FeatureDef 注）
            // → 整机失败（备份由 buildAMachine 恢复）。web 今天的失败源是
            // findFeaturePosition 找不到可落格（房间太小/格子被占光）。
            const minInstances = feature.minimumInstanceCount ?? feature.instanceCount[0];
            if (placed < minInstances && !fFlags.has('MF_REPEAT_UNTIL_NO_PROGRESS')) {
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
        this.gateAnalysisCache = null;

        return {
            blueprintId: bp.id,
            category: bp.category,
            machineNumber: machineNum,
            cells: room.cells,
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
     * V-1c：CE copyMap(pmap, p->levelBackup)（Architect.c:1222，point of no
     * return）的 web 形态——快照整层全部格子的可变状态。恢复时逐格写回，
     * 语义等价 CE 的整图 memcpy。机器阶段的改动面（setTerrain 写
     * layers/char/color/isPassable/isOpaque；applyBlueprint 另写
     * machineNumber/trapType/altarGroupId）是这里的快照子集；其余字段
     * （探索/视野/气味等）在生成期无人写入，一并快照只为省去取舍错误。
     */
    private backupLevel(): LevelBackup {
        const snap: LevelBackup = [];
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
        return snap;
    }

    /** CE copyMap(p->levelBackup, pmap)（:1578/:1681）的 web 形态。 */
    private restoreLevel(snap: LevelBackup): void {
        let i = 0;
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const c = this.grid.getCell(x, y)!;
                const s = snap[i++]!;
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
    }

    /** Find a cell for placing a feature, respecting flags and personal space */
    private findFeaturePosition(
        available: Pos[],
        used: Set<string>,
        center: Pos,
        origin: Pos,
        _feature: FeatureDef,
        fFlags: Set<string>
    ): Pos | null {
        // V-2a（CE Architect.c:520-522 / :1404-1407）：MF_BUILD_AT_ORIGIN 的
        // feature 恒落在机器 origin（=门位）——候选资格函数在 personalSpace/
        // occupied 检查之前就直接放行 origin，因此这里也无视 usedCells。
        // reward 蓝图的前厅递归 feature 与 vestibule_locked 的锁门/钥匙
        // feature 都靠它钉在门位上。
        if (fFlags.has('MF_BUILD_AT_ORIGIN')) {
            return origin;
        }

        if (fFlags.has('MF_NEAR_ORIGIN')) {
            // Pick the closest unused cell to center
            let best: Pos | null = null;
            let bestDist = Infinity;
            for (const p of available) {
                if (used.has(`${p.x},${p.y}`)) continue;
                const d = Math.abs(p.x - center.x) + Math.abs(p.y - center.y);
                if (d < bestDist) {
                    bestDist = d;
                    best = p;
                }
            }
            return best;
        }

        // Default: pick first unused cell (already shuffled)
        for (const p of available) {
            if (!used.has(`${p.x},${p.y}`)) {
                return p;
            }
        }
        return null;
    }

    /** Mark cells within radius as used so subsequent features stay away */
    private markPersonalSpace(center: Pos, radius: number, used: Set<string>) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (dx === 0 && dy === 0) continue;
                used.add(`${center.x + dx},${center.y + dy}`);
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
