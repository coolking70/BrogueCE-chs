/** W-18: CE PowerTables.c:56; Movement.c:674-725; Monsters.c:3726-3900. */
import type { Grid } from '../Map/Grid';
import { TerrainType } from '../Map/Grid';
import type { Pos } from '../../types';
import { cellTerrainFlags } from '../Map/DungeonFeature';
import { T_OBSTRUCTS_DIAGONAL_MOVEMENT, T_OBSTRUCTS_PASSABILITY } from '../Map/TerrainCatalog';

export function staffEntrancementDuration(enchantment: number): number {
    return Math.trunc(Math.trunc(enchantment * 65536) * 3 / 65536);
}

// CE nbDirs order, also used by randValidDirectionFrom(false).
export const ENTRANCEMENT_DIRECTIONS = [
    [0,-1], [0,1], [-1,0], [1,0], [-1,-1], [-1,1], [1,-1], [1,1],
] as const;

export function entrancementDiagonalBlocked(grid: Grid, from: Pos, to: Pos): boolean {
    return from.x !== to.x && from.y !== to.y
        && !!((cellTerrainFlags(grid, from.x, to.y) | cellTerrainFlags(grid, to.x, from.y)) & T_OBSTRUCTS_DIAGONAL_MOVEMENT);
}

export function entrancementPassable(grid: Grid, at: Pos, allowSecret = true): boolean {
    const cell = grid.getCell(at.x, at.y);
    return !!cell && (!(cellTerrainFlags(grid, at.x, at.y) & T_OBSTRUCTS_PASSABILITY)
        || (allowSecret && cell.layers.includes(TerrainType.SECRET_DOOR)));
}
