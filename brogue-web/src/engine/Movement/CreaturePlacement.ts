import { DijkstraMap, MAX_DISTANCE } from '../Map/Pathfinding';
/** W-11: destination policy is separate from the displacement commit.
 * CE Monsters.c:650-670,1155-1204; Dijkstra.c:209-255; Grid.c:224-244.
 * No mutation, generation hooks, or player-visibility writes in these queries.
 */
import type { Creature } from '../../entities/Creature';
import { Monster, avoidedFlagsForCaster } from '../../entities/Monster';
import type { Pos } from '../../types';
import { FOVSys } from '../Lighting/FOV';
import { Grid, TerrainType } from '../Map/Grid';
import { cellTerrainFlags, cellTerrainMechFlags } from '../Map/DungeonFeature';
import {
    T_PATHING_BLOCKER, T_DIVIDES_LEVEL, T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION,
    T_LAVA_INSTA_DEATH, T_SPONTANEOUSLY_IGNITES, T_IS_FIRE, T_IS_DEEP_WATER,
    T_AUTO_DESCENT, T_IS_DF_TRAP, TERRAIN_FLAGS, T_OBSTRUCTS_ITEMS, T_OBSTRUCTS_DIAGONAL_MOVEMENT,
    T_HARMFUL_TERRAIN, T_SACRED, TM_ALLOWS_SUBMERGING,
} from '../Map/TerrainCatalog';

export interface PlacementWorld {
    grid: Grid;
    player: Creature;
    monsters: readonly Monster[];
    dormantMonsters?: readonly Monster[];
}

/** Physical safety only: blink/beckoning may intentionally enter hazards,
 * stairs or machines. Caller owns effect immunity, range and destination policy.
 * Dormant living creatures count as occupied too (stronger than CE HAS_MONSTER).
 */
export function canPlaceCreature(world: Pick<PlacementWorld, 'grid' | 'player' | 'monsters' | 'dormantMonsters'>, target: Creature, at: Pos, walkingSecretDoor = false): boolean {
    if (!Number.isInteger(at.x) || !Number.isInteger(at.y) || !world.grid.isValidPos(at.x, at.y)) return false;
    if ((cellTerrainFlags(world.grid, at.x, at.y) & T_OBSTRUCTS_PASSABILITY)
        && !(walkingSecretDoor && world.grid.getCell(at.x, at.y)?.layers.includes(TerrainType.SECRET_DOOR))) return false;
    return ![world.player, ...world.monsters, ...(world.dormantMonsters ?? [])].some(c => c !== target && c.hp > 0
        && c.loc.x === at.x && c.loc.y === at.y);
}

/** CE uses info.flags, NOT temporary levitation/fire immunity statuses. */
export function teleportForbiddenFlags(target: Creature): number {
    const has = (flag: string) => target instanceof Monster && target.hasBehavior(flag);
    let flags = T_PATHING_BLOCKER;
    if (has('MONST_INVULNERABLE')) flags &= ~(T_LAVA_INSTA_DEATH | T_SPONTANEOUSLY_IGNITES | T_IS_FIRE);
    if (has('MONST_IMMUNE_TO_FIRE') || has('MONST_FLIES')) flags &= ~T_LAVA_INSTA_DEATH;
    if (has('MONST_IMMUNE_TO_FIRE')) flags &= ~(T_SPONTANEOUSLY_IGNITES | T_IS_FIRE);
    if (has('MONST_IMMUNE_TO_WATER') || has('MONST_FLIES')) flags &= ~T_IS_DEEP_WATER;
    if (has('MONST_FLIES')) flags &= ~(T_AUTO_DESCENT | T_IS_DF_TRAP);
    return flags;
}

/** Random TELEPORT (respectTerrainAvoidancePreferences=false). x-major order.
 * Four-way path distance > floor(width/2), including unreachable=30000.
 * CE's all-ones fallback occurs BEFORE terrain/map/FOV filtering, never after.
 */
export function teleportCandidates(world: PlacementWorld, target: Creature, respectTerrainAvoidancePreferences = false): Pos[] {
    const { grid } = world;
    const forbidden = teleportForbiddenFlags(target);
    const destinationFlags = respectTerrainAvoidancePreferences
        ? target instanceof Monster ? avoidedFlagsForCaster(target) : forbidden | T_HARMFUL_TERRAIN | T_SACRED
        : forbidden;
    const blocking = forbidden & T_DIVIDES_LEVEL;
    const distances = Array.from({ length: grid.width }, () => new Array<number>(grid.height).fill(30000));
    const costs = Array.from({ length: grid.width }, () => new Array<boolean>(grid.height).fill(false));
    for (let x = 1; x < grid.width - 1; x++) for (let y = 1; y < grid.height - 1; y++) {
        const cell = grid.getCell(x, y)!;
        const stationary = world.monsters.some(m => !m.isDormant && m.hp > 0 && m.loc.x === x && m.loc.y === y
            && (m.hasBehavior('MONST_IMMUNE_TO_WEAPONS') || m.hasBehavior('MONST_INVULNERABLE'))
            && (m.hasBehavior('MONST_IMMOBILE') || m.hasBehavior('MONST_GETS_TURN_ON_ACTIVATION')));
        // The current catalog's only passable-on-discovery secret is SECRET_DOOR.
        costs[x]![y] = !stationary && (cell.layers.includes(TerrainType.SECRET_DOOR)
            || !(cellTerrainFlags(grid, x, y) & (blocking | T_OBSTRUCTS_PASSABILITY)));
    }
    const queue: Pos[] = [{ ...target.loc }];
    distances[target.loc.x]![target.loc.y] = 0;
    for (let i = 0; i < queue.length; i++) {
        const p = queue[i]!;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
            const x = p.x + dx, y = p.y + dy;
            if (!costs[x]?.[y] || distances[x]![y]! !== 30000) continue;
            distances[x]![y] = distances[p.x]![p.y]! + 1;
            queue.push({ x, y });
        }
    }
    const threshold = Math.floor(grid.width / 2);
    const hasFarCell = distances.some(column => column.some(d => d > threshold));
    const fov = new FOVSys(grid).computeFOVMask(target.loc.x, target.loc.y, grid.width,
        cell => cell.layers.some(t => (TERRAIN_FLAGS[t].flags & T_OBSTRUCTS_VISION) !== 0));
    const result: Pos[] = [];
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) {
        if (hasFarCell && distances[x]![y]! <= threshold) continue;
        const cell = grid.getCell(x, y)!;
        if (fov[x]?.[y] || (target.loc.x === x && target.loc.y === y)
            || cell.machineNumber !== 0
            || cell.layers.includes(TerrainType.STAIRS_UP) || cell.layers.includes(TerrainType.STAIRS_DOWN) || cell.layers.includes(TerrainType.DUNGEON_PORTAL)
            || (cellTerrainFlags(grid, x, y) & destinationFlags)
            || (respectTerrainAvoidancePreferences && target instanceof Monster && target.hasBehavior('MONST_RESTRICTED_TO_LIQUID')
                && !(cellTerrainMechFlags(grid, x, y) & TM_ALLOWS_SUBMERGING))
            || !canPlaceCreature(world, target, { x, y })) continue;
        result.push({ x, y });
    }
    return result;
}


/** CE makeMonsterDropItem -> getQualifyingPathLocNear (Monsters.c:4074;
 * Grid.c:287-360). Query only; caller chooses uniformly among x-major ties.
 * Does not reject other monsters or machines: neither is a forbidden map flag.
 */
export function captiveItemDropCandidates(world: Pick<PlacementWorld, 'grid' | 'player' | 'monsters'>, origin: Pos, items: readonly { loc: Pos }[]): Pos[] {
    const { grid } = world;
    const flags = (x: number, y: number) => cellTerrainFlags(grid, x, y);
    const qualifies = (x: number, y: number) => {
        const cell = grid.getCell(x, y);
        return !!cell && !(flags(x, y) & T_OBSTRUCTS_ITEMS)
            && !(world.player.loc.x === x && world.player.loc.y === y)
            && !cell.layers.includes(TerrainType.STAIRS_UP) && !cell.layers.includes(TerrainType.STAIRS_DOWN) && !cell.layers.includes(TerrainType.DUNGEON_PORTAL)
            && !items.some(item => item.loc.x === x && item.loc.y === y);
    };
    return qualifyingPathCandidates(grid, origin, T_DIVIDES_LEVEL, T_OBSTRUCTS_ITEMS,
        (x, y) => !qualifies(x, y));
}

/** Grid.c:287, hallwaysAllowed=true. Origin gets cost 1 even if blocked;
 * destination restrictions do not block traversal. Only OBSTRUCTION blocks
 * diagonal corners. A pathless result falls back to the nearest square ring. */
export function qualifyingPathCandidates(grid: Grid, origin: Pos, blocking: number,
    forbidden: number, forbiddenMap: (x: number, y: number) => boolean): Pos[] {
    if (!grid.isValidPos(origin.x, origin.y)) return [];
    const flags = (x: number, y: number) => cellTerrainFlags(grid, x, y);
    const valid = (x: number, y: number) => !(flags(x, y) & forbidden) && !forbiddenMap(x, y);
    if (!(flags(origin.x, origin.y) & blocking) && valid(origin.x, origin.y)) return [{ ...origin }];
    const distances = Array.from({ length: grid.width }, () => new Array<number>(grid.height).fill(MAX_DISTANCE));
    const costs = Array.from({ length: grid.width }, () => new Array<number>(grid.height).fill(1));
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) {
        if (flags(x, y) & blocking) costs[x]![y] = -1;
        if ((blocking & (T_OBSTRUCTS_DIAGONAL_MOVEMENT | T_OBSTRUCTS_PASSABILITY))
            && (flags(x, y) & T_OBSTRUCTS_DIAGONAL_MOVEMENT)) costs[x]![y] = -2;
    }
    distances[origin.x]![origin.y] = costs[origin.x]![origin.y] = 1;
    new DijkstraMap(grid.width, grid.height).batchScan(distances, costs, true);
    let best = MAX_DISTANCE;
    let result: Pos[] = [];
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) {
        const distance = distances[x]![y]!;
        if (distance <= 0 || distance >= MAX_DISTANCE || distance > best || !valid(x, y)) continue;
        if (distance < best) { best = distance; result = []; }
        result.push({ x, y });
    }
    if (result.length) return result;
    for (let radius = 0; radius < Math.max(grid.width, grid.height); radius++) {
        for (let x = origin.x - radius; x <= origin.x + radius; x++) for (let y = origin.y - radius; y <= origin.y + radius; y++) {
            if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) !== radius
                || !grid.isValidPos(x, y) || (flags(x, y) & blocking) || !valid(x, y)) continue;
            result.push({ x, y });
        }
        if (result.length) return result;
    }
    return [];
}
