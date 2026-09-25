/** W-20: CE cloneMonster's placement policy, separate from splitMonster's
 * contiguous-group edge policy. No generation calls or catalog draws. */
import { Monster } from '../../entities/Monster';
import type { Creature } from '../../entities/Creature';
import type { Pos } from '../../types';
import { type PlacementWorld, teleportForbiddenFlags } from '../Movement/CreaturePlacement';
import { cellTerrainFlags } from '../Map/DungeonFeature';
import { TerrainType } from '../Map/Grid';
import { T_DIVIDES_LEVEL, T_HARMFUL_TERRAIN, T_SACRED, T_IS_DF_TRAP,
    T_CAUSES_POISON, T_CAUSES_DAMAGE, T_CAUSES_PARALYSIS, T_CAUSES_CONFUSION,
    T_IS_FIRE, T_OBSTRUCTS_DIAGONAL_MOVEMENT } from '../Map/TerrainCatalog';
import { rng } from '../Random';

export function cloneAvoidedFlags(source: Creature): number {
    const has = (flag: string) => source instanceof Monster && source.hasBehavior(flag);
    let flags = teleportForbiddenFlags(source) | T_HARMFUL_TERRAIN | T_SACRED;
    if (has('MONST_INVULNERABLE')) flags &= ~(T_HARMFUL_TERRAIN | T_IS_DF_TRAP);
    // MONST_TURRET is a composite containing INANIMATE (CE Rogue.h:2093).
    if (has('MONST_INANIMATE') || has('MONST_TURRET')) flags &= ~(T_CAUSES_POISON | T_CAUSES_DAMAGE | T_CAUSES_PARALYSIS | T_CAUSES_CONFUSION);
    if (has('MONST_IMMUNE_TO_FIRE')) flags &= ~T_IS_FIRE;
    if (has('MONST_FLIES')) flags &= ~T_CAUSES_POISON;
    return flags;
}

/** Grid.c:287-360: eight-way path distance, x-major random nearest ties;
 * HAS_PLAYER blocks paths, HAS_MONSTER/HAS_STAIRS only block destinations.
 * Terrain uses info flags, not temporary statuses. If paths fail, scan rings
 * through walls. CE returns INVALID_POS if both searches fail; return null. */
export function cloneLocation(world: Pick<PlacementWorld, 'grid' | 'player' | 'monsters'>, source: Creature): Pos | null {
    const { grid } = world, origin = source.loc;
    if (!grid.isValidPos(origin.x, origin.y)) return null;
    const forbidden = cloneAvoidedFlags(source), blocking = forbidden & T_DIVIDES_LEVEL;
    const flags = (p: Pos) => cellTerrainFlags(grid, p.x, p.y);
    const playerAt = (p: Pos) => world.player.x === p.x && world.player.y === p.y;
    const qualifies = (p: Pos) => grid.isValidPos(p.x, p.y) && !(flags(p) & forbidden)
        && !playerAt(p) && !world.monsters.some(m => !m.isDormant && m.hp > 0 && m.x === p.x && m.y === p.y)
        && !grid.getCell(p.x, p.y)!.layers.some(t => t === TerrainType.STAIRS_UP || t === TerrainType.STAIRS_DOWN);
    if (qualifies(origin)) return { ...origin };
    const distances = Array.from({ length: grid.width }, () => Array<number>(grid.height).fill(Infinity));
    distances[origin.x]![origin.y] = 0;
    const queue = [{ ...origin }];
    for (let i = 0; i < queue.length; i++) {
        const p = queue[i]!;
        for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[-1,1],[1,-1],[1,1]] as const) {
            const q = { x: p.x + dx, y: p.y + dy };
            if (q.x <= 0 || q.y <= 0 || q.x >= grid.width - 1 || q.y >= grid.height - 1
                || distances[q.x]![q.y] !== Infinity || playerAt(q) || (flags(q) & blocking)) continue;
            if (dx && dy && ((flags({ x: q.x, y: p.y }) | flags({ x: p.x, y: q.y })) & T_OBSTRUCTS_DIAGONAL_MOVEMENT)) continue;
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
    if (!candidates.length) for (let r = 1; r < Math.max(grid.width, grid.height); r++) {
        for (let x = origin.x - r; x <= origin.x + r; x++) for (let y = origin.y - r; y <= origin.y + r; y++) {
            if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) === r && qualifies({ x, y })) candidates.push({ x, y });
        }
        if (candidates.length) break;
    }
    return candidates.length ? candidates[rng.randRange(0, candidates.length - 1)]! : null;
}
