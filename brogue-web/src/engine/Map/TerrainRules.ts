/** U18a: caller-specific terrain contracts. These queries neither move creatures
 * nor mutate terrain, knowledge, occupancy or RNG. See u-18a.report.md.
 * Cell.isPassable/isOpaque remain legacy projections for unmigrated callers.
 */
import type { Cell } from './Grid';
import { terrainFlagsOfCell, terrainMechFlagsOfCell, discoveredTerrainFlagsOfCell } from './DungeonFeature';
import {
    T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION, T_OBSTRUCTS_SCENT,
    T_OBSTRUCTS_DIAGONAL_MOVEMENT, T_PATHING_BLOCKER, TM_IS_SECRET,
    T_SACRED, T_LAVA_INSTA_DEATH, T_AUTO_DESCENT, T_IS_DF_TRAP, T_IS_FIRE,
    T_IS_DEEP_WATER, T_SPONTANEOUSLY_IGNITES,
} from './TerrainCatalog';

export function terrainBlocksMovement(cell: Cell): boolean {
    return !!(terrainFlagsOfCell(cell) & T_OBSTRUCTS_PASSABILITY);
}

/** Optical opacity, not a movement/flight permission. Not yet wired to lighting. */
export function terrainBlocksVision(cell: Cell): boolean {
    return !!(terrainFlagsOfCell(cell) & T_OBSTRUCTS_VISION);
}

export function terrainBlocksScent(cell: Cell): boolean {
    return !!(terrainFlagsOfCell(cell) & T_OBSTRUCTS_SCENT);
}

/** CE Monsters.c:3672; actual terrain, NOT the remembered-knowledge variant. */
export function terrainPassableOrSecretDoor(cell: Cell): boolean {
    return !terrainBlocksMovement(cell) || (
        !!(terrainMechFlagsOfCell(cell) & TM_IS_SECRET)
        && !(discoveredTerrainFlagsOfCell(cell) & T_OBSTRUCTS_PASSABILITY)
    );
}

/** CE Movement.c:2017 populateGenericCostMap; costs use CE -2/-1, not 30000. */
export function genericPathCost(cell: Cell): number {
    const flags = terrainFlagsOfCell(cell);
    if (!terrainPassableOrSecretDoor(cell)) {
        return flags & T_OBSTRUCTS_DIAGONAL_MOVEMENT ? -2 : -1;
    }
    return flags & (T_PATHING_BLOCKER & ~T_OBSTRUCTS_PASSABILITY) ? -1 : 1;
}

/** Time.c:1864-1871/1891-1899: currently outside FOV, not "unexplored". */
export function isUnseenPassableSecretDoor(cell: Cell): boolean {
    return !cell.isVisible && terrainBlocksMovement(cell) && terrainPassableOrSecretDoor(cell);
}

export interface SafetyTerrainContext {
    playerLevitating: boolean;
    playerImmuneToFire: boolean;
    /** Caller owns sleeping/stationary/activation/ally AND not fleeing. */
    harmlessOccupant: boolean;
}

/** CE Time.c:1807-1876, in branch order. Pair = [player cost, monster cost].
 * Source/stair overrides and the two scans belong to buildSafetyMap.
 */
export function safetyTerrainCosts(cell: Cell, ctx: SafetyTerrainContext): readonly [number, number] {
    const flags = terrainFlagsOfCell(cell);
    if (!terrainPassableOrSecretDoor(cell)) {
        const cost = flags & T_OBSTRUCTS_DIAGONAL_MOVEMENT ? -2 : -1;
        return [cost, cost];
    }
    if (flags & T_SACRED) return [1, -1];
    // CE's literal !fire-immunity condition is intentional here.
    if (flags & T_LAVA_INSTA_DEATH) return [ctx.playerLevitating || !ctx.playerImmuneToFire ? 1 : -1, -1];
    if (ctx.harmlessOccupant) return [1, -1];
    if (flags & (T_AUTO_DESCENT | T_IS_DF_TRAP)) return [ctx.playerLevitating ? 1 : -1, -1];
    if (flags & T_IS_FIRE) return [ctx.playerImmuneToFire ? 1 : -1, -1];
    if (flags & (T_IS_DEEP_WATER | T_SPONTANEOUSLY_IGNITES)) return [ctx.playerLevitating ? 1 : 5, 5];
    if (isUnseenPassableSecretDoor(cell)) return [100, 1];
    return [1, 1];
}
