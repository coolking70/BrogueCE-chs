import { Grid, DCOLS, DROWS } from '../Map/Grid';
import { T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION, T_PATHING_BLOCKER } from '../Map/TerrainCatalog';
import { terrainFlagsOfCell } from '../Map/DungeonFeature';
import type { Pos } from '../../types';

/**
 * CE Architect.c:1344–1351 / Movement.c:2714–2878, with forbiddenFlags=0
 * and cautiousOnWalls=false. Machine sight uses CE's integer-slope scan, not
 * the gameplay FOV's half-cell floating-point shadowcasting. Blocking cells
 * themselves are included. Passable sight means PB occlusion, not a flood fill:
 * doors pass it, secrets and hazards block it, and walls may be feature sites.
 * No visibility/memory writes and no RNG consumption.
 */
export function computeMachineView(grid: Grid, origin: Pos, passable: boolean): boolean[][] {
    const mask = passable ? T_PATHING_BLOCKER : T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION;
    const radius = Math.max(DCOLS, DROWS);
    const granularity = 32768; // CE LOS_SLOPE_GRANULARITY, Rogue.h:176.
    const view = Array.from({ length: grid.width }, () => Array<boolean>(grid.height).fill(false));
    const transform = (column: number, row: number, octant: number): Pos => {
        switch (octant) {
            case 1: return { x: origin.x + column, y: origin.y + row };
            case 2: return { x: origin.x + column, y: origin.y - row };
            case 3: return { x: origin.x - row, y: origin.y + column };
            case 4: return { x: origin.x + row, y: origin.y + column };
            case 5: return { x: origin.x - column, y: origin.y - row };
            case 6: return { x: origin.x - column, y: origin.y + row };
            case 7: return { x: origin.x + row, y: origin.y - column };
            default: return { x: origin.x - row, y: origin.y - column };
        }
    };
    const blocked = (p: Pos): boolean => !!(terrainFlagsOfCell(grid.getCell(p.x, p.y)!) & mask);
    const scan = (octant: number, column: number, start: number, end: number): void => {
        if (column >= radius) return;
        let nextStart = start;
        // C integer division truncates toward zero, including negative slopes.
        const a = Math.trunc((-granularity / 2 + 1 + start * column) / granularity);
        const b = Math.trunc((-granularity / 2 + 1 + end * column) / granularity);
        let first = Math.min(a, b);
        const last = Math.max(a, b);
        if (column * column + last * last >= radius * radius) return;
        if (column * column + first * first >= radius * radius) {
            // Integer-radius specialization of CE -fp_sqrt(r²-c²)/FP_FACTOR.
            first = -Math.floor(Math.sqrt(radius * radius - column * column));
        }
        const initial = transform(column, first, octant);
        let lit = grid.isValidPos(initial.x, initial.y) && !blocked(initial);
        for (let row = first; row <= last; row++) {
            const p = transform(column, row, octant);
            if (!grid.isValidPos(p.x, p.y)) continue;
            const obstruction = blocked(p);
            view[p.x]![p.y] = true;
            if (!obstruction && !lit) {
                nextStart = Math.trunc((granularity * row - granularity / 2) / (column * 2 + 1)) * 2;
                lit = true;
            } else if (obstruction && lit) {
                const nextEnd = Math.trunc((granularity * row - granularity / 2) / (column * 2 - 1)) * 2;
                if (nextStart <= nextEnd) scan(octant, column + 1, nextStart, nextEnd);
                lit = false;
            }
        }
        if (lit && nextStart <= end) scan(octant, column + 1, nextStart, end);
    };
    for (let octant = 1; octant <= 8; octant++) scan(octant, 1, -granularity, 0);
    // getFOVMask excludes the origin; buildAMachine explicitly includes it.
    if (grid.isValidPos(origin.x, origin.y)) view[origin.x]![origin.y] = true;
    return view;
}
