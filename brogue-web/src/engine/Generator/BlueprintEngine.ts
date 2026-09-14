/**
 * src/engine/Generator/BlueprintEngine.ts
 * Data-driven machine blueprint system.
 * Reads from blueprints.json and places machines in the dungeon.
 */

import { Grid, TerrainType, DCOLS, DROWS } from '../Map/Grid';
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
     */
    public buildMachines(): MachineResult[] {
        const results: MachineResult[] = [];

        // Decide how many machines to attempt based on depth
        const maxMachines = Math.min(2 + Math.floor(this.depth / 3), 6);

        for (let attempt = 0; attempt < maxMachines * 3; attempt++) {
            if (results.length >= maxMachines) break;

            const bp = this.selectBlueprint();
            if (!bp) continue;

            const room = this.findSuitableRoom(bp);
            if (!room) continue;

            const result = this.applyBlueprint(bp, room);
            if (result) {
                results.push(result);
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
     * Find a contiguous region of FLOOR tiles that satisfies the blueprint's roomSize constraint.
     * Uses flood-fill from random floor tiles.
     */
    private findSuitableRoom(bp: BlueprintDef): { cells: Pos[]; center: Pos; door: Pos | null } | null {
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

/** Reset the machine number counter (call when generating a new level) */
export function resetMachineCounter() {
    nextMachineNumber = 1;
}
