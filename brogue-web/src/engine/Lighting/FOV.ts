/**
 * src/engine/Lighting/FOV.ts
 * Implements Field of View calculation (Recursive Shadowcasting typically used in roguelikes)
 */

import { Grid } from '../Map/Grid';

export class FOVSys {
    private grid: Grid;

    constructor(grid: Grid) {
        this.grid = grid;
    }

    /**
     * computeFOV
     * Marks cells in `grid` as `isVisible = true` if they are in sight of `origin`
     * within `radius`. It also sets `hasMemory = true` for seen cells.
     */
    public computeFOV(originX: number, originY: number, radius: number) {
        // Clear old FOV
        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                const cell = this.grid.getCell(x, y);
                if (cell) {
                    cell.isVisible = false;
                }
            }
        }

        // The origin is always visible
        this.markVisible(originX, originY);

        // Symmetric Recursive Shadowcasting across 8 octants
        const octants = [
            { xx: 1, xy: 0, yx: 0, yy: 1 },
            { xx: 0, xy: 1, yx: 1, yy: 0 },
            { xx: 0, xy: -1, yx: 1, yy: 0 },
            { xx: -1, xy: 0, yx: 0, yy: 1 },
            { xx: -1, xy: 0, yx: 0, yy: -1 },
            { xx: 0, xy: -1, yx: -1, yy: 0 },
            { xx: 0, xy: 1, yx: -1, yy: 0 },
            { xx: 1, xy: 0, yx: 0, yy: -1 }
        ];

        for (const oct of octants) {
            this.castLight(originX, originY, radius, 1, 1.0, 0.0, oct.xx, oct.xy, oct.yx, oct.yy);
        }
    }

    private castLight(cx: number, cy: number, radius: number, row: number, startSlope: number, endSlope: number, xx: number, xy: number, yx: number, yy: number) {
        if (startSlope < endSlope) return;

        let nextStartSlope = startSlope;
        for (let i = row; i <= radius; i++) {
            let blocked = false;
            for (let dx = -i, dy = -i; dx <= 0; dx++) {
                const lSlope = (dx - 0.5) / (dy + 0.5);
                const rSlope = (dx + 0.5) / (dy - 0.5);
                if (startSlope < rSlope) continue;
                if (endSlope > lSlope) break;

                const mapX = cx + dx * xx + dy * xy;
                const mapY = cy + dx * yx + dy * yy;

                if (!this.grid.isValidPos(mapX, mapY)) continue;

                const distanceSquared = dx * dx + dy * dy;
                if (distanceSquared <= radius * radius) {
                    this.markVisible(mapX, mapY);
                }

                if (blocked) {
                    if (this.grid.getCell(mapX, mapY)?.isOpaque) {
                        nextStartSlope = rSlope;
                    } else {
                        blocked = false;
                        startSlope = nextStartSlope;
                    }
                } else if (this.grid.getCell(mapX, mapY)?.isOpaque && i < radius) {
                    blocked = true;
                    this.castLight(cx, cy, radius, i + 1, startSlope, lSlope, xx, xy, yx, yy);
                    nextStartSlope = rSlope;
                }
            }
            if (blocked) break;
        }
    }

    private markVisible(x: number, y: number) {
        const cell = this.grid.getCell(x, y);
        if (cell) {
            cell.isVisible = true;
            cell.isExplored = true;
            cell.hasMemory = true;
        }
    }
}
