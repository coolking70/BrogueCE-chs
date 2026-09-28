/** CE Architect.c:2982-3008. Full terrain knowledge, no creatures or RNG. */
import type { Grid } from './Grid';
import { cellTerrainFlags, cellTerrainMechFlags } from './DungeonFeature';
import { T_OBSTRUCTS_PASSABILITY,
    T_OBSTRUCTS_DIAGONAL_MOVEMENT, T_LAVA_INSTA_DEATH, T_IS_DEEP_WATER,
    T_AUTO_DESCENT, TM_IS_SECRET } from './TerrainCatalog';
import { allocShortGrid, CE_PDS_OBSTRUCTION, CE_PDS_FORBIDDEN, SAFETY_MAX_DISTANCE } from './SafetyMap';
import { DijkstraMap } from './Pathfinding';

export const SHORE_HAZARDS = T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER | T_AUTO_DESCENT;
export function buildMapToShore(grid: Grid): number[][] {
    const distances = allocShortGrid(grid.width, grid.height, SAFETY_MAX_DISTANCE);
    const costs = allocShortGrid(grid.width, grid.height, 1);
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) {
        const flags = cellTerrainFlags(grid, x, y);
        if (flags & T_OBSTRUCTS_PASSABILITY) {
            costs[x]![y] = flags & T_OBSTRUCTS_DIAGONAL_MOVEMENT ? CE_PDS_OBSTRUCTION : CE_PDS_FORBIDDEN;
        } else if (!(flags & SHORE_HAZARDS) || (cellTerrainMechFlags(grid, x, y) & TM_IS_SECRET)) {
            distances[x]![y] = 0;
        }
    }
    new DijkstraMap(grid.width, grid.height).batchScan(distances, costs, true);
    return distances;
}

/** CE Time.c:2889-2906, including C integer division and unreachable cutoff. */
export function shoreWarning(distance: number, movementSpeed: number, duration: number): 'return' | 'past' | null {
    const required = Math.trunc(distance * movementSpeed / 100);
    const remaining = Math.trunc(duration * 100 / movementSpeed);
    if (required === remaining || required + 1 === remaining) return 'return';
    return required > remaining && required < 10000 ? 'past' : null;
}
