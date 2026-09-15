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

import { Grid, TerrainType, DCOLS, DROWS } from '../Map/Grid';
import { analyzeChokeMap, CE_GATE_CANDIDATE_CAP, type ChokeAnalysis } from '../Map/LoopMap';
import { terrainAllowsMove, DIRS8 } from '../Map/Connectivity';
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

export class BlueprintEngine {
    private grid: Grid;
    private depth: number;
    private blueprints: BlueprintDef[];

    constructor(grid: Grid, depth: number) {
        this.grid = grid;
        this.depth = depth;
        this.blueprints = blueprintData as BlueprintDef[];
    }

    /**
     * Main entry point: build all machines for the current level.
     * Returns an array of MachineResult for Game.ts to populate with items/monsters.
     *
     * P1-33 选址（CE Architect.c:1080-1095）：每次尝试先 analyzeChokeMap，
     * 只从 IS_GATE_SITE 割点里挑"被封区域大小落在蓝图 roomSize 区间"的格子
     * 当门。CE 在 buildAMachine 的每次尝试里都重跑 analyzeMap(true)；web 在
     * "尝试失败不改地形"的前提下缓存（地形未变 ⇒ 分析逐位相同，等价且省算），
     * 建成一台即失效。
     */
    public buildMachines(): MachineResult[] {
        const results: MachineResult[] = [];
        let analysis: ChokeAnalysis | null = null;

        // Decide how many machines to attempt based on depth
        const maxMachines = Math.min(2 + Math.floor(this.depth / 3), 6);

        for (let attempt = 0; attempt < maxMachines * 3; attempt++) {
            if (results.length >= maxMachines) break;

            const bp = this.selectBlueprint();
            if (!bp) continue;

            if (!analysis) analysis = analyzeChokeMap(this.grid);

            const room = this.findGateRoom(bp, analysis);
            if (!room) continue;

            const result = this.applyBlueprint(bp, room);
            if (result) {
                results.push(result);
                analysis = null; // 地形已变，下一台重新分析
            }
        }

        return results;
    }

    /** Select a blueprint appropriate for the current depth using weighted random */
    private selectBlueprint(): BlueprintDef | null {
        const eligible = this.blueprints.filter(bp =>
            this.depth >= bp.depthRange[0] && this.depth <= bp.depthRange[1]
        );
        if (eligible.length === 0) return null;

        let totalFreq = 0;
        for (const bp of eligible) totalFreq += bp.frequency;

        let roll = rng.randRange(1, totalFreq);
        for (const bp of eligible) {
            roll -= bp.frequency;
            if (roll <= 0) return bp;
        }
        return eligible[eligible.length - 1]!;
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
    private findGateRoom(
        bp: BlueprintDef,
        analysis: ChokeAnalysis
    ): { cells: Pos[]; center: Pos; door: Pos } | null {
        const candidates: Pos[] = [];
        for (let x = 0; x < DCOLS && candidates.length < CE_GATE_CANDIDATE_CAP; x++) {
            for (let y = 0; y < DROWS && candidates.length < CE_GATE_CANDIDATE_CAP; y++) {
                if (!analysis.gateSite[x]![y]) continue;
                if ((this.grid.getCell(x, y)?.machineNumber ?? 0) !== 0) continue; // CE !IS_IN_MACHINE
                const choke = analysis.chokeMap[x]![y]!;
                if (choke < bp.roomSize[0] || choke > bp.roomSize[1]) continue;
                candidates.push({ x, y });
            }
        }
        if (candidates.length === 0) return null; // CE 1108-1122：无合格门位，放弃该蓝图

        const gate = candidates[rng.randRange(0, candidates.length - 1)]!;
        const cells = mapMachineInterior(this.grid, analysis, gate);
        if (!cells) return null;
        if (!this.gateSealsOnlyInterior(gate, cells)) return null; // 会误封别处 → 弃用该门位

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
        if (n === 0) return null; // 内部只有门格一格：无宝藏落点
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

        return { cells, center, door: gate };
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
     */
    private applyBlueprint(
        bp: BlueprintDef,
        room: { cells: Pos[]; center: Pos; door: Pos | null }
    ): MachineResult | null {
        const machineNum = nextMachineNumber++;
        const flags = new Set(bp.flags);

        // 1. Mark all cells as belonging to this machine
        for (const p of room.cells) {
            const cell = this.grid.getCell(p.x, p.y);
            if (cell) cell.machineNumber = machineNum;
        }

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

        for (const feature of bp.features) {
            const count = rng.randRange(feature.instanceCount[0], feature.instanceCount[1]);
            const fFlags = new Set(feature.flags);

            for (let inst = 0; inst < count; inst++) {
                // Find a placement position
                const pos = this.findFeaturePosition(availableCells, usedCells, room.center, feature, fFlags);
                if (!pos) break;

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

                // Generate item spawn instructions
                if (fFlags.has('MF_GENERATE_ITEM') && feature.itemCategory) {
                    itemSpawns.push({
                        category: feature.itemCategory,
                        id: feature.itemId,
                        pos: { x: pos.x, y: pos.y },
                        isAltar: fFlags.has('MF_ALTAR')
                    });
                }

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
            altarGroupId
        };
    }

    /** Find a cell for placing a feature, respecting flags and personal space */
    private findFeaturePosition(
        available: Pos[],
        used: Set<string>,
        center: Pos,
        _feature: FeatureDef,
        fFlags: Set<string>
    ): Pos | null {
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
