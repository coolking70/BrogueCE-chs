import { DCOLS, type Grid } from './Grid';

/** CE IS_IN_MACHINE (Rogue.h:1113). Blueprint interiors are construction
 * geometry, not membership: external features add numbered cells, while
 * BP_NO_INTERIOR_FLAG clears non-wired cells (Architect.c:1488,1691-1699).
 * This detached projection consumes no RNG and never writes the grid.
 */
export function collectMachineCells(grid: Grid): Set<number> {
    const cells = new Set<number>();
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            if (grid.getCell(x, y)!.machineNumber !== 0) cells.add(y * DCOLS + x);
        }
    }
    return cells;
}

/** A redundant snapshot projection must agree with its authoritative cells.
 * Reject inconsistent/old saves; do not silently repair a different world.
 */
export function machineCellsMatchGrid(
    cells: unknown,
    grid: readonly { x: number; y: number; machineNumber?: number }[],
): boolean {
    if (!Array.isArray(cells)) return false;
    const expected = new Set(grid.filter(c => c.machineNumber !== 0).map(c => c.y * DCOLS + c.x));
    return cells.length === expected.size && new Set(cells).size === cells.length
        && cells.every(c => Number.isInteger(c) && expected.has(c));
}
