/** W-16: CE PowerTables.c:54, Items.c:5494-5514, Grid.c:287-360.
 * Dedicated to conjuration; P4-2 horde placement and P4-4 cloning are unchanged.
 */
import type { Pos } from '../../types';
import type { PlacementWorld } from '../Movement/CreaturePlacement';
import { type Grid, TerrainType } from '../Map/Grid';
import { cellTerrainFlags } from '../Map/DungeonFeature';
import { T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_DIAGONAL_MOVEMENT,
    T_IS_FIRE, T_CAUSES_EXPLOSIVE_DAMAGE, T_SACRED, T_SPONTANEOUSLY_IGNITES } from '../Map/TerrainCatalog';
import { rng } from '../Random';

export function staffBladeCount(enchantment: number): number {
    // CE receives a nonnegative enchantment in 16-bit fixed point.
    return Number.isFinite(enchantment) ? Math.max(0, Math.trunc(Math.trunc(enchantment * 65536) * 3 / 2 / 65536)) : 0;
}

export const BLADE_DIRECTIONS = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[-1,1],[1,-1],[1,1]] as const;
// avoidedFlagsForMonster(INANIMATE | FLIES), excluding SPONTANEOUSLY_IGNITES
// for the detonation only. Flying blades may occupy water, lava, pits and traps.
const SPAWN_FORBIDDEN = T_OBSTRUCTS_PASSABILITY | T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE | T_SACRED;
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
const stairs = (grid: Grid, p: Pos) => grid.getCell(p.x, p.y)?.layers.some(t => t === TerrainType.STAIRS_UP || t === TerrainType.STAIRS_DOWN);

export function bladeDiagonalBlocked(grid: Grid, from: Pos, to: Pos): boolean {
    return from.x !== to.x && from.y !== to.y && !!((cellTerrainFlags(grid, to.x, from.y)
        | cellTerrainFlags(grid, from.x, to.y)) & T_OBSTRUCTS_DIAGONAL_MOVEMENT);
}

/** Origin first (no draw); otherwise uniformly pick nearest path-distance ties,
 * x-major. Creatures/stairs forbid destinations but only the player blocks paths.
 * Dormant monsters do not carry CE HAS_MONSTER and intentionally do not occupy.
 */
export function bladeSpawnLocation(world: Pick<PlacementWorld, 'grid' | 'player' | 'monsters' | 'dormantMonsters'>, origin: Pos): Pos | null {
    const { grid } = world;
    if (!grid.isValidPos(origin.x, origin.y)) return null;
    const qualifies = (p: Pos) => grid.isValidPos(p.x, p.y)
        && !(cellTerrainFlags(grid, p.x, p.y) & SPAWN_FORBIDDEN) && !stairs(grid, p)
        && !same(world.player.loc, p) && !world.monsters.some(m => m.hp > 0 && !m.isDormant && same(m.loc, p));
    if (qualifies(origin)) return { ...origin };
    const distances = Array.from({ length: grid.width }, () => Array<number>(grid.height).fill(Infinity));
    distances[origin.x]![origin.y] = 0;
    const queue = [{ ...origin }];
    for (let i = 0; i < queue.length; i++) {
        const p = queue[i]!;
        for (const [dx, dy] of BLADE_DIRECTIONS) {
            const q = { x: p.x + dx, y: p.y + dy };
            if (!grid.isValidPos(q.x, q.y) || distances[q.x]![q.y] !== Infinity
                || same(world.player.loc, q) || (cellTerrainFlags(grid, q.x, q.y) & T_OBSTRUCTS_PASSABILITY)
                || bladeDiagonalBlocked(grid, p, q)) continue;
            distances[q.x]![q.y] = distances[p.x]![p.y]! + 1;
            queue.push(q);
        }
    }
    let best = Infinity, candidates: Pos[] = [];
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) {
        const d = distances[x]![y]!;
        if (!Number.isFinite(d) || d > best || !qualifies({ x, y })) continue;
        if (d < best) { best = d; candidates = []; }
        candidates.push({ x, y });
    }
    // CE fallback only when there are no reachable qualifying cells.
    if (!candidates.length) for (let r = 1; r < Math.max(grid.width, grid.height); r++) {
        for (let x = origin.x - r; x <= origin.x + r; x++) for (let y = origin.y - r; y <= origin.y + r; y++) {
            if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) === r && qualifies({ x, y })) candidates.push({ x, y });
        }
        if (candidates.length) break;
    }
    return candidates.length ? candidates[rng.randRange(0, candidates.length - 1)]! : null;
}

/** Blade movement avoids brimstone too (the spawn-only exemption ends here). */
export function bladeAvoids(grid: Grid, p: Pos): boolean {
    return !grid.isValidPos(p.x, p.y) || !!(cellTerrainFlags(grid, p.x, p.y)
        & (SPAWN_FORBIDDEN | T_SPONTANEOUSLY_IGNITES)) || !!stairs(grid, p);
}

/** CE moveMonsterPassivelyTowards directional preference/fallback (MC:1525).
 * Occupancy/terrain checks belong to canStep, and never move onto the enemy.
 */
export function bladeStepToward(from: Pos, target: Pos, canStep: (p: Pos) => boolean): Pos | null {
    const dx = Math.sign(target.x - from.x), dy = Math.sign(target.y - from.y);
    const ax = Math.abs(target.x - from.x), ay = Math.abs(target.y - from.y);
    const at = (x: number, y: number) => ({ x: from.x + x, y: from.y + y });
    if (dx && dy) {
        const preferred = ax > ay && rng.randRange(0, ax) > ay ? at(dx, 0)
            : ax < ay && rng.randRange(0, ay) > ax ? at(0, dy) : null;
        if (preferred && canStep(preferred)) return preferred;
    }
    const first = at(dx, dy);
    if (canStep(first)) return first;
    if (Math.max(ax, ay) <= 1 && (!dx || !dy)) return null;
    const fallback = ax < ay ? [[0,dy],[dx,0],[-1,dy],[1,dy]] : [[dx,0],[0,dy],[dx,-1],[dx,1]];
    return fallback.map(([x,y]) => at(x!, y!)).find(canStep) ?? null;
}
