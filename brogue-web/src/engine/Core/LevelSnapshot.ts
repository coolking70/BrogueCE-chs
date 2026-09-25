/** U03: map state is copied directly, never replayed as terrain/gas effects. */
import { Grid, type Cell, type TerrainType } from '../Map/Grid';
import { copyFields } from './EntitySnapshot';

export const CELL_FIELDS = [
    'x', 'y', 'layers', 'char', 'color', 'volume', 'isExplored', 'isVisible',
    'hasMemory', 'rememberedTerrain', 'rememberedAppearance', 'rememberedLayers', 'rememberedItem', 'rememberedItemCategory',
    'isMagicMapped', 'rememberedTerrainFlags', 'rememberedTMFlags', 'knownTrapFree', 'rememberedFlags',
    'light', 'isPassable', 'isOpaque', 'exposedToFire', 'trapType',
    'isDiscovered', 'autoSearched', 'machineNumber', 'isPowered', 'hasDormantMonster',
] as const satisfies readonly (keyof Cell)[];

// Optional in the TS shape only so old negative fixtures can express a missing
// layers field. The whole-run loader rejects it; there is no legacy migration.
export type CellSnapshot = Omit<Pick<Cell, typeof CELL_FIELDS[number]>, 'layers' | 'machineNumber'> & {
    layers?: TerrainType[];
    machineNumber?: number;
    terrain: TerrainType;
    isBurning: boolean;
};

export function snapshotGrid(grid: Grid): CellSnapshot[] {
    const cells: CellSnapshot[] = [];
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) {
        const cell = grid.getCell(x, y)!;
        cells.push({ ...copyFields(cell, CELL_FIELDS), terrain: cell.terrain, isBurning: cell.isBurning });
    }
    return cells;
}

export function restoreGrid(width: number, height: number, cells: readonly CellSnapshot[], impregnable: number[]): Grid {
    const grid = new Grid(width, height);
    grid.impregnableCells = new Set(impregnable);
    for (const saved of cells) {
        if (!saved.layers || saved.layers.length !== 4) throw new Error('Missing terrain layers');
        const cell = grid.getCell(saved.x, saved.y);
        if (!cell) throw new Error('Invalid cell position');
        Object.assign(cell, copyFields(saved as Cell, CELL_FIELDS));
    }
    return grid;
}
