/**
 * src/engine/Lighting/FOV.ts
 * Implements Field of View calculation (Recursive Shadowcasting typically used in roguelikes)
 */

import { Grid, type Cell } from '../Map/Grid';

export class FOVSys {
    private grid: Grid;

    constructor(grid: Grid) {
        this.grid = grid;
    }

    /**
     * P4-8：CE getFOVMask 的 web 等价——按自定义遮挡谓词计算全图视野掩码，
     * 供气味图（ScentMap.update）等使用。只写返回的掩码数组，绝不触碰
     * cell.isVisible / isExplored / hasMemory，现有视野行为（computeFOV）
     * 不受影响。半径给足够大（≥ 地图对角线）时等价于"无圆形截断"，
     * 对应 CE 以 T_OBSTRUCTS_SCENT 为唯一遮挡的整图 FOV（Time.c:770-771）。
     */
    public computeFOVMask(originX: number, originY: number, radius: number,
        blocks: (cell: Cell) => boolean): boolean[][] {
        const mask: boolean[][] = [];
        for (let x = 0; x < this.grid.width; x++) {
            mask[x] = new Array<boolean>(this.grid.height).fill(false);
        }
        if (this.grid.isValidPos(originX, originY)) {
            mask[originX]![originY] = true;
        }
        // 与 computeFOV 相同的 8 象限对称递归阴影投射（结构复制自下方 castLight，
        // 刻意不复用：遮挡判定换成 blocks 谓词、输出写掩码，保证不动现有视野路径）
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
            this.castLightMask(mask, originX, originY, radius, 1, 1.0, 0.0,
                oct.xx, oct.xy, oct.yx, oct.yy, blocks);
        }
        return mask;
    }

    private castLightMask(mask: boolean[][], cx: number, cy: number, radius: number,
        row: number, startSlope: number, endSlope: number,
        xx: number, xy: number, yx: number, yy: number,
        blocks: (cell: Cell) => boolean) {
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
                    mask[mapX]![mapY] = true;
                }

                const cell = this.grid.getCell(mapX, mapY);
                if (blocked) {
                    if (cell && blocks(cell)) {
                        nextStartSlope = rSlope;
                    } else {
                        blocked = false;
                        startSlope = nextStartSlope;
                    }
                } else if (cell && blocks(cell) && i < radius) {
                    blocked = true;
                    this.castLightMask(mask, cx, cy, radius, i + 1, startSlope, lSlope, xx, xy, yx, yy, blocks);
                    nextStartSlope = rSlope;
                }
            }
            if (blocked) break;
        }
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
