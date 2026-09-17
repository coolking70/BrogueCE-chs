/**
 * src/engine/Lighting/LightMap.ts
 * Manages dynamic lighting overlays for the grid.
 *
 * C-7 起同时承载 CE 的引擎侧光照管线（Light.c 全族）：
 * - `paintLight`（Light.c:54-116）：把一个 lightSource 按径向衰减泼进光网格，
 *   遮挡 = T_OBSTRUCTS_VISION（cell.isOpaque）+ 可选的生物遮挡。
 * - `clearLighting` + 查询（lightAt / lightSumAt / inShadowAt）对应
 *   `updateLighting`（Light.c:208-240）的清零与 IS_IN_SHADOW 语义；
 *   Game.updateVision 负责按 CE 顺序调用（先地形光、再矿灯）。
 *
 * 与 CE 的两处口径差（详见 ai_docs/c_7_lighting_report.md）：
 * 1. 确定性化：CE 每次绘制从主 RNG 抽光半径抖动与颜色抖动（Light.c:69-72）；
 *    web 不抽——光照在层间 generateDepth 里也会跑，走主流会移动生成期
 *    RNG 流（generation_baseline 红线）。半径取 randomRange 中点（均匀分布
 *    期望的 floor），颜色取基础三分量（rand 通道留给渲染轮的 cosmetic 闪烁）。
 * 2. fp_sqrt 用实数 sqrt + 四舍五入近似（CE Math.c:224 的定点二分，误差
 *    <1/65536，仅影响衰减曲线末位）。
 */

import { Grid } from '../Map/Grid';
import { ColorUtils } from '../Map/Color';
import type { RGBA } from '../Map/Color';
import {
    FP_FACTOR,
    type CeLightColor,
    type LightSourceDef,
} from '../Map/LightCatalog';

export interface LightCell {
    color: RGBA;           // The accumulated light color on this cell
    intensity: number;     // 0-100% how brightly lit it is
}

/** CE `tmap[x][y].light[3]`（Rogue.h:2495 一族）：三通道累积光强。 */
export interface LightChannels {
    r: number;
    g: number;
    b: number;
}

export interface PaintLightParams {
    /** 要泼的光（目录条目或动态构造的矿灯）。 */
    light: LightSourceDef;
    /** 光源位置。 */
    x: number;
    y: number;
    /**
     * 覆盖半径（单位 0.01 格）。省略时取 light.radius 上下界中点——
     * CE 是 randClump 随机抽取（clump=1 即均匀分布），确定性口径取期望。
     */
    radiusHundredths?: number;
    /** CE isMinersLight：矿灯不做圆形截断、且不驱散 IS_IN_SHADOW。 */
    isMinersLight?: boolean;
    /** CE maintainShadows：泼光但不驱散阴影（矿灯/心灵感应光为 true）。 */
    maintainShadows?: boolean;
    /**
     * 生物遮挡谓词（CE getFOVMask 的 HAS_MONSTER|HAS_PLAYER 参数：
     * Light.c:85 passThroughCreatures ? 0 : 该旗标）。遮挡格自身被照亮、
     * 但截断传播。省略 = 不做生物遮挡。
     */
    hasCreatureAt?: (x: number, y: number) => boolean;
}

export class LightMap {
    private grid: Grid;
    private lightCells: LightCell[][];

    /** CE tmap.light：三通道累积光强（可含负值——黑暗类光是负分量）。 */
    private lightGrid: LightChannels[][];
    /** CE pmap.flags & IS_IN_SHADOW：true = 尚无正色光驱散。 */
    private shadowGrid: boolean[][];

    constructor(grid: Grid) {
        this.grid = grid;
        this.lightCells = [];
        this.lightGrid = [];
        this.shadowGrid = [];
        this.initCells();
    }

    private initCells() {
        this.lightCells = [];
        this.lightGrid = [];
        this.shadowGrid = [];
        for (let x = 0; x < this.grid.width; x++) {
            this.lightCells[x] = [];
            this.lightGrid[x] = [];
            this.shadowGrid[x] = [];
            for (let y = 0; y < this.grid.height; y++) {
                this.lightCells[x]![y] = {
                    color: { r: 0, g: 0, b: 0 },
                    intensity: 0
                };
                this.lightGrid[x]![y] = { r: 0, g: 0, b: 0 };
                this.shadowGrid[x]![y] = true;
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

    // ═══════════════════════ CE 引擎侧光照管线（C-7）═══════════════════════

    /**
     * CE updateLighting 开场（Light.c:216-226）：光清零、全图置 IS_IN_SHADOW。
     * 之后按 CE 顺序泼光：全部发光地形 → 生物光 → 矿灯（Game.updateVision）。
     */
    public clearLighting() {
        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                const ch = this.lightGrid[x]![y]!;
                ch.r = 0; ch.g = 0; ch.b = 0;
                this.shadowGrid[x]![y] = true;
            }
        }
    }

    /** 原始三通道（可负——playerInDarkness 用原值比较，Light.c:283-287）。 */
    public lightAt(x: number, y: number): LightChannels | null {
        if (!this.grid.isValidPos(x, y)) return null;
        return this.lightGrid[x]![y]!;
    }

    /** VISIBLE 阈值口径（Movement.c:2584-2586：每通道 max(0,·) 后求和）。 */
    public lightSumAt(x: number, y: number): number {
        const ch = this.lightAt(x, y);
        if (!ch) return 0;
        return Math.max(0, ch.r) + Math.max(0, ch.g) + Math.max(0, ch.b);
    }

    /** CE `pmap.flags & IS_IN_SHADOW`（泼正色光时驱散，Light.c:97-99）。 */
    public inShadowAt(x: number, y: number): boolean {
        if (!this.grid.isValidPos(x, y)) return true;
        return this.shadowGrid[x]![y]!;
    }

    /**
     * CE paintLight（Light.c:54-116）。返回"是否泼到了玩家 FOV 内的格子"
     * 的 CE 语义在 web 无消费者，省略返回值。
     */
    public paintLight(params: PaintLightParams): void {
        const { light, x, y } = params;
        const isMinersLight = params.isMinersLight ?? false;
        const maintainShadows = params.maintainShadows ?? false;

        // Light.c:67 radius = randClump(lightRadius) * FP_FACTOR / 100 ——
        // 确定性口径：取上下界中点（均匀分布期望的 floor）。
        const radiusHundredths = params.radiusHundredths ??
            Math.floor((light.radius.lowerBound + light.radius.upperBound) / 2);
        const radius = Math.trunc((radiusHundredths * FP_FACTOR) / 100);
        // Light.c:68 radiusRounded = fp_round(radius)（四舍五入到整格）
        const radiusRounded = Math.floor((radius + FP_FACTOR / 2) / FP_FACTOR);
        if (radiusRounded < 1) {
            // 半径不足一格：CE 仍会把原点格照亮（无条件加法在掩码之外）。
            this.addChannelsAt(x, y, light.color);
            if (!maintainShadows &&
                (light.color.red + light.color.green + light.color.blue) > 0 &&
                this.grid.isValidPos(x, y)) {
                this.shadowGrid[x]![y] = false;
            }
            return;
        }

        // Light.c:70-72 颜色抖动抽取——确定性化：直接用基础三分量。
        const colorComponents = light.color;

        // Light.c:74 dispelShadows：矿灯/维持阴影的光不驱散 IS_IN_SHADOW。
        const dispelShadows = !maintainShadows &&
            (colorComponents.red + colorComponents.green + colorComponents.blue) > 0;

        const fadeToPercent = light.radialFadeToPercent;

        // Light.c:83 getFOVMask：圆形截断（非矿灯）+ 生物遮挡。
        const mask = this.buildLightMask(
            x, y, radiusRounded,
            !isMinersLight,
            light.passThroughCreatures ? undefined : params.hasCreatureAt
        );

        // Light.c:97-114：按衰减给掩码内格子加光。
        for (let i = Math.max(0, x - radiusRounded); i < this.grid.width && i < x + radiusRounded; i++) {
            for (let j = Math.max(0, y - radiusRounded); j < this.grid.height && j < y + radiusRounded; j++) {
                if (!mask[i - (x - radiusRounded)]![j - (y - radiusRounded)]) continue;
                const d2 = (i - x) * (i - x) + (j - y) * (j - y);
                // lightMultiplier = 100 - (100-fade) * fp_sqrt(d2*FP) / radius。
                // CE fp_sqrt 的量纲：输入 fixpt 值 u = d2（即 d2*FP 的整数形），
                // 输出 √d2 * FP（Math.c:224 的 SQUARE_ROOTS 表即
                // √k*65536，k=u>>16）——等价于 round(√d2)*FP。
                const sqrtFixpt = Math.round(Math.sqrt(d2) * FP_FACTOR);
                const lightMultiplier = 100 - Math.trunc(
                    ((100 - fadeToPercent) * sqrtFixpt) / radius
                );
                const ch = this.lightGrid[i]![j]!;
                ch.r += Math.trunc((colorComponents.red * lightMultiplier) / 100);
                ch.g += Math.trunc((colorComponents.green * lightMultiplier) / 100);
                ch.b += Math.trunc((colorComponents.blue * lightMultiplier) / 100);
                if (dispelShadows) {
                    this.shadowGrid[i]![j] = false;
                }
            }
        }

        // Light.c:116-119：原点格无条件整份加光（掩码命中则叠加为两份——CE 原样）。
        this.addChannelsAt(x, y, colorComponents);
        if (dispelShadows && this.grid.isValidPos(x, y)) {
            this.shadowGrid[x]![y] = false;
        }
    }

    private addChannelsAt(x: number, y: number, c: CeLightColor): void {
        if (!this.grid.isValidPos(x, y)) return;
        const ch = this.lightGrid[x]![y]!;
        ch.r += c.red;
        ch.g += c.green;
        ch.b += c.blue;
    }

    /**
     * 光照用 FOV 掩码（CE getFOVMask，FOV.c）：以 (x,y) 为原点、radius 为
     * 半径（整格）、8 象限递归阴影投射；遮挡 = cell.isOpaque
     * （T_OBSTRUCTS_VISION）+ 可选生物遮挡；circular=false 时不做距离截断
     * （CE 矿灯即如此——Light.c:85 末参 !isMinersLight）。
     * 返回局部 bbox 网格（尺寸 2R×2R，下标 [i-(x-R)][j-(y-R)]）。
     *
     * 遮挡谓词刻意不进 FOVSys.computeFOVMask（那是 P4-8 的气息掩码、本轮
     * 禁改 FOV.ts）：圆形截断与生物遮挡是光照特有参数，就地实现。
     */
    private buildLightMask(
        cx: number, cy: number, radius: number, circular: boolean,
        hasCreatureAt?: (x: number, y: number) => boolean
    ): boolean[][] {
        const size = radius * 2;
        const mask: boolean[][] = [];
        for (let i = 0; i < size; i++) {
            mask[i] = new Array<boolean>(size).fill(false);
        }
        const inBBox = (mx: number, my: number): boolean =>
            mx >= cx - radius && mx < cx + radius && my >= cy - radius && my < cy + radius;
        const mark = (mx: number, my: number): void => {
            if (this.grid.isValidPos(mx, my) && inBBox(mx, my)) {
                mask[mx - (cx - radius)]![my - (cy - radius)] = true;
            }
        };
        const blockedAt = (mx: number, my: number): boolean => {
            const cell = this.grid.getCell(mx, my);
            if (cell && cell.isOpaque) return true;
            if (hasCreatureAt && hasCreatureAt(mx, my)) return true;
            return false;
        };

        mark(cx, cy); // 原点恒被照亮

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
            this.castLightMask(mask, mark, blockedAt, cx, cy, radius, circular,
                1, 1.0, 0.0, oct.xx, oct.xy, oct.yx, oct.yy);
        }
        return mask;
    }

    private castLightMask(
        mask: boolean[][],
        mark: (mx: number, my: number) => void,
        blockedAt: (mx: number, my: number) => boolean,
        cx: number, cy: number, radius: number, circular: boolean,
        row: number, startSlope: number, endSlope: number,
        xx: number, xy: number, yx: number, yy: number
    ): void {
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

                if (!circular) {
                    mark(mapX, mapY);
                } else {
                    const distanceSquared = dx * dx + dy * dy;
                    if (distanceSquared <= radius * radius) {
                        mark(mapX, mapY);
                    }
                }

                if (blocked) {
                    if (blockedAt(mapX, mapY)) {
                        nextStartSlope = rSlope;
                    } else {
                        blocked = false;
                        startSlope = nextStartSlope;
                    }
                } else if (blockedAt(mapX, mapY) && i < radius) {
                    blocked = true;
                    this.castLightMask(mask, mark, blockedAt, cx, cy, radius, circular,
                        i + 1, startSlope, lSlope, xx, xy, yx, yy);
                    nextStartSlope = rSlope;
                }
            }
            if (blocked) break;
        }
    }

    /**
     * 渲染馈送：把引擎光网格折算进渲染用的 lightCells（GameCanvas 消费
     * getLight 的 {color, intensity} 接口在禁改文件里，格式不变）。
     * intensity = clamp(sum / 7.65)（sum = 三通道 max(0,·) 之和，满强度
     * 765 对应 100%）；color = 通道值 clamp 0-255 后归一。
     */
    public fillRenderFromLighting() {
        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                const ch = this.lightGrid[x]![y]!;
                const sum = Math.max(0, ch.r) + Math.max(0, ch.g) + Math.max(0, ch.b);
                const cell = this.lightCells[x]![y]!;
                cell.color = {
                    r: Math.max(0, Math.min(255, Math.round(ch.r))),
                    g: Math.max(0, Math.min(255, Math.round(ch.g))),
                    b: Math.max(0, Math.min(255, Math.round(ch.b)))
                };
                cell.intensity = Math.max(0, Math.min(100, Math.round(sum / 7.65)));
            }
        }
    }

    // ═══════════════════════ 旧渲染馈送接口（保留）═══════════════════════

    /**
     * Casts a light source outwards from (originX, originY).
     * Similar to symmetric shadowcasting, but calculates attenuation.
     *
     * C-7 起 web 的实际光照走 paintLight/updateVision 管线；本方法不再有
     * 生产调用点（旧"玩家火把 addLight(player, 8, '#ffccaa')"已被矿灯
     * 管线取代），保留为公开 API 供调试/回退。
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
