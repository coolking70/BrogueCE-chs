import type { Cell, Grid } from '../Map/Grid';
import { cosmeticDraw, displayRandom } from '../Lighting/CosmeticLight';
import { CE_COLORS, CE_DEPTH_COLORS, TERRAIN_COLOR_NAMES, type TerrainColor } from './TerrainColorCatalog';
import { CE_AMULET_LEVEL } from '../Map/LightCatalog';

/** IO.c bakeTerrainColors: eight stable per-cell values, not fresh noise per draw. */
const values = new WeakMap<Cell, number[]>();
const clocks = new WeakMap<Grid, number>();

export function terrainColor(name: string, depth: number): TerrainColor {
    const pair = CE_DEPTH_COLORS[name];
    if (!pair) return CE_COLORS[name]!;
    const a = CE_COLORS[pair[0]]!, b = CE_COLORS[pair[1]]!;
    const weight = Math.max(0, Math.min(100, Math.trunc(depth * 100 / CE_AMULET_LEVEL)));
    return a.map((v, i) => i === 7 ? +(!!v || !!b[i])
        : Math.trunc((v * (100 - weight) + b[i]! * weight) / 100)) as unknown as TerrainColor;
}

export function terrainRandomValues(cell: Cell, grid?: Grid): readonly number[] | undefined {
    if (!cell.isVisible) return undefined;
    let result = values.get(cell);
    if (!result) {
        result = cosmeticDraw(random => Array.from({ length: 8 }, () => random.randRange(0, 1000)), displayRandom(grid ?? cell));
        values.set(cell, result);
    }
    return result;
}

export function bakeTerrainColor(name: string, depth: number, vals: readonly number[], back: boolean): string {
    const c = terrainColor(name, depth);
    const shared = Math.trunc(c[6] * vals[back ? 7 : 6]! / 1000);
    const offset = back ? 3 : 0;
    return '#' + c.slice(0, 3).map((v, i) => {
        const channel = v + Math.trunc(c[i + 3]! * vals[offset + i]! / 1000) + shared;
        return Math.trunc(Math.max(0, Math.min(100, channel)) * 255 / 100).toString(16).padStart(2, '0');
    }).join('');
}

/** IO.c shuffleTerrainColors(3): a bounded random walk only for visible dancers.
 * Browser idle cadence is cosmetic; memory and simulation light never change. */
export function tickTerrainColors(grid: Grid, deltaMs: number, depth: number): boolean {
    const elapsed = (clocks.get(grid) ?? 0) + Math.max(0, deltaMs);
    clocks.set(grid, elapsed % 50);
    if (elapsed < 50) return false;
    return cosmeticDraw(random => {
        let changed = false;
        for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) {
            const cell = grid.getCell(x, y)!;
            if (!cell.isVisible || !cell.layers.some(t => TERRAIN_COLOR_NAMES[t].some(name => name && terrainColor(name, depth)[7]))) continue;
            if (random.randRange(1, 100) > 3) continue;
            const vals = terrainRandomValues(cell, grid)! as number[];
            for (let i = 0; i < 8; i++) vals[i] = Math.max(0, Math.min(1000, vals[i]! + random.randRange(-600, 600)));
            changed = true;
        }
        return changed;
    }, displayRandom(grid));
}
