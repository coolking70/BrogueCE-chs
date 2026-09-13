/**
 * src/engine/Lighting/LightMap.ts
 * Manages dynamic lighting overlays for the grid.
 */

import { Grid } from '../Map/Grid';
import { ColorUtils } from '../Map/Color';
import type { RGBA } from '../Map/Color';

export interface LightCell {
    color: RGBA;           // The accumulated light color on this cell
    intensity: number;     // 0-100% how brightly lit it is
}

export class LightMap {
    private grid: Grid;
    private lightCells: LightCell[][];

    constructor(grid: Grid) {
        this.grid = grid;
        this.lightCells = [];
        this.initCells();
    }

    private initCells() {
        this.lightCells = [];
        for (let x = 0; x < this.grid.width; x++) {
            this.lightCells[x] = [];
            for (let y = 0; y < this.grid.height; y++) {
                this.lightCells[x]![y] = {
                    color: { r: 0, g: 0, b: 0 },
                    intensity: 0
                };
            }
        }
    }

    /** Reset the light map to ambient darkness */
    public clear() {
        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                const c = this.lightCells[x]![y]!;
                c.color = { r: 0, g: 0, b: 0 };
                c.intensity = 0;
            }
        }
    }

    public getLight(x: number, y: number): LightCell | null {
        if (!this.grid.isValidPos(x, y)) return null;
        return this.lightCells[x]![y]!;
    }

    /**
     * Casts a light source outwards from (originX, originY).
     * Similar to symmetric shadowcasting, but calculates attenuation.
     */
    public addLight(originX: number, originY: number, radius: number, lightColorHex: string | number, maxIntensity: number) {
        const lightColor = ColorUtils.hexToRGB(lightColorHex);
        const visited = new Set<string>();

        const applyLightOnce = (x: number, y: number, percent: number) => {
            const key = `${x},${y}`;
            if (visited.has(key)) return;
            visited.add(key);
            this.applyLightTo(x, y, lightColor, percent);
        };

        // Center point is fully lit
        applyLightOnce(originX, originY, maxIntensity);

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
            this.castLightRay(originX, originY, radius, 1, 1.0, 0.0, oct.xx, oct.xy, oct.yx, oct.yy, maxIntensity, applyLightOnce);
        }
    }

    private applyLightTo(x: number, y: number, sourceColor: RGBA, percent: number) {
        const cell = this.lightCells[x]?.[y];
        if (!cell) return;

        // Additive blend the new light source onto the existing light
        cell.color = ColorUtils.add(cell.color, sourceColor, percent);
        cell.intensity = Math.min(100, cell.intensity + percent);
    }

    private castLightRay(cx: number, cy: number, radius: number, row: number, startSlope: number, endSlope: number, xx: number, xy: number, yx: number, yy: number, maxIntensity: number, applyLightOnce: (x: number, y: number, percent: number) => void) {
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

                // Circular attenuation based on squared distance
                const distanceSquared = dx * dx + dy * dy;
                const radiusSquared = radius * radius;

                if (distanceSquared <= radiusSquared) {
                    // Quadratic falloff for a much smoother, natural lighting curve
                    const distRatio = Math.sqrt(distanceSquared) / radius;
                    const falloff = Math.max(0, 1.0 - (distRatio * distRatio));
                    const appliedIntensity = Math.floor(maxIntensity * falloff);

                    if (appliedIntensity > 0) {
                        applyLightOnce(mapX, mapY, appliedIntensity);
                    }
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
                    this.castLightRay(cx, cy, radius, i + 1, startSlope, lSlope, xx, xy, yx, yy, maxIntensity, applyLightOnce);
                    nextStartSlope = rSlope;
                }
            }
            if (blocked) break;
        }
    }
}
