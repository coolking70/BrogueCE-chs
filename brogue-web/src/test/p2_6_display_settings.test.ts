/// <reference types="node" />
/**
 * src/test/p2_6_display_settings.test.ts — P2-6：显示设置（地图缩放模式 + 侧栏宽度模式）
 *
 * A. 默认值 = P2-5 现状（验收 2/6）：两项默认 uniform/fixed；等比布局与
 *    测试内**独立复算**的 P2-5 公式逐字段一致（不是拿函数跟自己比）；
 *    多档容器宽下右/下缘绝不溢出、放得下时 scale ≤ 1 且居中。
 * B. 拉伸模式 = CE 口径（验收 3）：地图恰好铺满容器（右缘 = 容器宽、
 *    下缘 = 容器高，容差 ≤1px）、x/y 缩放比可以不同、允许放大；
 *    并用 tiles.c:782-803 的整除公式做参考实现对照（两者都无缝铺满）。
 * C. 指针映射（验收 7）：stretch 下 x/y 缩放不同时 toLocal 仍把鼠标点
 *    映射回正确格子——用真实 PIXI Container 复刻 GameCanvas 的
 *    `toLocal(e.global)` → `Math.floor(local / TILE_SIZE)` 路径。
 * D. 侧栏按比例（验收 4）：宽 = 容器宽 × 20%（CE STAT_BAR_WIDTH/COLS），
 *    不低于最小宽度 272px；窄窗口（1024/1300）下最小宽度生效。
 * E. 持久化（验收 5）：写入 localStorage 版本化键；重置模块缓存后
 *    重新读取（模拟重开页面）保持；损坏/非法值逐字段回退默认值。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Container, Point } from 'pixi.js';

import { DCOLS, DROWS } from '../types';

let computeMapLayout: (
    w: number,
    h: number,
    mode?: 'uniform' | 'stretch',
) => { scale: number; scaleX: number; scaleY: number; offsetX: number; offsetY: number };
let TILE_SIZE: number;
const MAP_W = DCOLS * 16; // 79 × 16 = 1264
const MAP_H = DROWS * 16; // 29 × 16 = 464

beforeAll(async () => {
    // GameCanvas.vue 的模块依赖在加载期访问 window，headless 下先 stub 再动态导入
    vi.stubGlobal('window', {
        addEventListener: () => {},
        removeEventListener: () => {},
    });
    const mod: any = await import('../components/GameCanvas.vue');
    computeMapLayout = mod.computeMapLayout;
    TILE_SIZE = mod.TILE_SIZE;
});

// ---------- localStorage stub ----------
interface StorageLike {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
}

function makeStorage(): StorageLike {
    const map = new Map<string, string>();
    return {
        getItem: (k) => (map.has(k) ? map.get(k)! : null),
        setItem: (k, v) => {
            map.set(k, String(v));
        },
        removeItem: (k) => {
            map.delete(k);
        },
    };
}

/**
 * 重置模块缓存后以给定 storage 重新导入 Settings（模拟"页面重开"）。
 * 不传 = 新建空 storage；显式传 null = window 上连 localStorage 都没有。
 */
async function freshSettings(storage?: StorageLike | null) {
    vi.resetModules();
    const store = storage ?? makeStorage();
    vi.stubGlobal('window', storage === null ? {} : { localStorage: store });
    const mod: any = await import('../engine/Settings');
    return { mod, store };
}

// ── A. 默认值 = P2-5 现状 ────────────────────────────────────────────────────
describe('P2-6 A: 默认值与等比模式 = P2-5 现状（验收 2/6）', () => {
    it('A1 从未设置过时：两项默认 uniform / fixed', async () => {
        const { mod } = await freshSettings(null); // window 上连 localStorage 都没有
        expect(mod.displaySettings.mapScaleMode).toBe('uniform');
        expect(mod.displaySettings.sidebarWidthMode).toBe('fixed');
    });

    it('A2 不传 mode 与显式 uniform 的结果逐字段一致', () => {
        for (const [w, h] of [[640, 900], [1260, 900], [2220, 700], [1264, 464]] as const) {
            const legacy = computeMapLayout(w, h);
            const uniform = computeMapLayout(w, h, 'uniform');
            expect(legacy).toEqual(uniform);
        }
    });

    it('A3 独立复算 P2-5 公式：不溢出、scale ≤ 1、放得下时恰好居中', () => {
        // 期望值在测试内按 P2-5 公式独立重算，不调用被测函数
        const expected = (w: number, h: number) => {
            const s = Math.min(1, w / MAP_W, h / MAP_H);
            return {
                scale: s,
                scaleX: s,
                scaleY: s,
                offsetX: Math.max(0, (w - MAP_W * s) / 2),
                offsetY: Math.max(0, (h - MAP_H * s) / 2),
            };
        };
        for (const contW of [640, 940, 1100, 1260, 1264, 1460, 1580, 2220]) {
            for (const contH of [400, 464, 700, 900]) {
                const got = computeMapLayout(contW, contH);
                expect(got).toEqual(expected(contW, contH));
                // 不变量：右/下缘绝不溢出容器（P2-5 的核心验收，保持不变）
                const right = got.offsetX + MAP_W * got.scaleX;
                const bottom = got.offsetY + MAP_H * got.scaleY;
                expect(right, `宽 ${contW} 右缘溢出`).toBeLessThanOrEqual(contW + 0.001);
                expect(bottom, `高 ${contH} 下缘溢出`).toBeLessThanOrEqual(contH + 0.001);
                expect(got.scale).toBeGreaterThan(0);
                expect(got.scale).toBeLessThanOrEqual(1);
            }
        }
        // 放得下时不放大且居中
        const fit = computeMapLayout(2220, 900);
        expect(fit.scale).toBe(1);
        expect(fit.offsetX).toBeCloseTo((2220 - MAP_W) / 2, 6);
        expect(fit.offsetY).toBeCloseTo((900 - MAP_H) / 2, 6);
    });

    it('A4 默认设置驱动布局：结果与不带 mode 参数（P2-5 语义）完全一致', async () => {
        const { mod } = await freshSettings(null);
        for (const [w, h] of [[640, 900], [1260, 900], [2220, 900]] as const) {
            expect(computeMapLayout(w, h, mod.displaySettings.mapScaleMode))
                .toEqual(computeMapLayout(w, h));
        }
    });
});

// ── B. 拉伸模式 = CE 口径 ────────────────────────────────────────────────────
describe('P2-6 B: 拉伸铺满模式（验收 3 + CE tiles.c:782-803 对照）', () => {
    it('B1 中等容器：恰好铺满（右缘 = 容器宽、下缘 = 容器高，≤1px），x/y 缩放不同', () => {
        const { scaleX, scaleY, offsetX, offsetY } = computeMapLayout(1260, 900, 'stretch');
        expect(offsetX).toBe(0);
        expect(offsetY).toBe(0);
        const right = offsetX + MAP_W * scaleX;
        const bottom = offsetY + MAP_H * scaleY;
        expect(right).toBeGreaterThanOrEqual(1260 - 1);
        expect(right).toBeLessThanOrEqual(1260 + 1);
        expect(bottom).toBeGreaterThanOrEqual(900 - 1);
        expect(bottom).toBeLessThanOrEqual(900 + 1);
        // 容器长宽比 ≠ 地图长宽比 → 两方向缩放比必须不同（这正是拉伸的定义）
        expect(scaleX).not.toBeCloseTo(scaleY, 3);
    });

    it('B2 大窗允许放大（CE 无 scale 上限），铺满不缩水', () => {
        const { scaleX, scaleY, offsetX, offsetY } = computeMapLayout(2528, 800, 'stretch');
        expect(scaleX).toBeGreaterThan(1);
        expect(scaleY).toBeGreaterThan(1);
        expect(offsetX).toBe(0);
        expect(offsetY).toBe(0);
        expect(offsetX + MAP_W * scaleX).toBeCloseTo(2528, 6);
        expect(offsetY + MAP_H * scaleY).toBeCloseTo(800, 6);
    });

    it('B3 同一容器：等比留黑边（offset > 0），拉伸 offset = 0 铺满', () => {
        // 2000×600：横向放得下、纵向放不下 → 等比由高度限制，横向留黑边
        const uniform = computeMapLayout(2000, 600);
        expect(uniform.offsetY).toBeGreaterThan(0);
        const stretch = computeMapLayout(2000, 600, 'stretch');
        expect(stretch.offsetX).toBe(0);
        expect(stretch.offsetY).toBe(0);
        expect(stretch.scaleY).toBeGreaterThan(uniform.scaleY); // 拉伸把高度方向撑满
    });

    it('B4 CE 整除公式参考实现对照：两者都恰好铺满、无 1px 缝隙', () => {
        // tiles.c:782-803 的参考实现：整除把余数摊到各格，最右格右缘 = outputWidth
        const ceLastRight = (output: number, n: number) => {
            let acc = 0;
            for (let x = 0; x < n; x++) acc += Math.floor(((x + 1) * output) / n) - Math.floor((x * output) / n);
            return acc; // 各格宽度之和
        };
        expect(ceLastRight(1260, DCOLS)).toBe(1260); // CE：x 方向恰好铺满
        expect(ceLastRight(900, DROWS)).toBe(900);   // CE：y 方向恰好铺满
        // web 的连续缩放与 CE 达成同一效果：右/下缘同样严丝合缝
        const { scaleX, scaleY } = computeMapLayout(1260, 900, 'stretch');
        expect(MAP_W * scaleX).toBeCloseTo(1260, 6);
        expect(MAP_H * scaleY).toBeCloseTo(900, 6);
    });
});

// ── C. 指针映射在拉伸模式下仍成立 ────────────────────────────────────────────
describe('P2-6 C: 拉伸模式下指针 → 格子映射（验收 7）', () => {
    /** 复刻 GameCanvas 指针路径：图层设 position+scale，toLocal 后 floor(/TILE)。 */
    function mapPointerToCell(
        layout: ReturnType<typeof computeMapLayout>,
        globalX: number,
        globalY: number,
    ): { x: number; y: number } {
        const layer = new Container();
        layer.position.set(layout.offsetX, layout.offsetY);
        layer.scale.set(layout.scaleX, layout.scaleY);
        const local = layer.toLocal(new Point(globalX, globalY));
        return { x: Math.floor(local.x / TILE_SIZE), y: Math.floor(local.y / TILE_SIZE) };
    }

    it('C1 stretch（x/y 缩放不同、无偏移）：格子中心点映射回原格子', () => {
        const layout = computeMapLayout(1260, 900, 'stretch');
        expect(layout.scaleX).not.toBeCloseTo(layout.scaleY, 3); // 确保测的是非等比
        for (const [cx, cy] of [[0, 0], [39, 14], [52, 17], [78, 28]] as const) {
            const gx = layout.offsetX + (cx + 0.5) * TILE_SIZE * layout.scaleX;
            const gy = layout.offsetY + (cy + 0.5) * TILE_SIZE * layout.scaleY;
            expect(mapPointerToCell(layout, gx, gy), `格子 (${cx},${cy}) 中心`).toEqual({ x: cx, y: cy });
        }
    });

    it('C2 uniform（含居中偏移）：映射不受本轮改动影响', () => {
        const layout = computeMapLayout(2220, 900); // scale = 1，有居中偏移
        for (const [cx, cy] of [[0, 0], [40, 15], [78, 28]] as const) {
            const gx = layout.offsetX + (cx + 0.5) * TILE_SIZE * layout.scaleX;
            const gy = layout.offsetY + (cy + 0.5) * TILE_SIZE * layout.scaleY;
            expect(mapPointerToCell(layout, gx, gy), `格子 (${cx},${cy}) 中心`).toEqual({ x: cx, y: cy });
        }
    });
});

// ── D. 侧栏按比例模式 ────────────────────────────────────────────────────────
describe('P2-6 D: 侧栏宽度模式（验收 4）', () => {
    let computeSidebarWidth: (w: number, mode: 'fixed' | 'proportional') => number;
    let SIDEBAR_MIN_WIDTH: number;

    beforeAll(async () => {
        const { mod } = await freshSettings(null);
        computeSidebarWidth = mod.computeSidebarWidth;
        SIDEBAR_MIN_WIDTH = mod.SIDEBAR_MIN_WIDTH;
    });

    it('D1 宽窗口：宽度 = 容器宽 × 20%（CE STAT_BAR_WIDTH/COLS 基准）', () => {
        expect(computeSidebarWidth(1920, 'proportional')).toBe(384);
        expect(computeSidebarWidth(1600, 'proportional')).toBe(320);
        // 1360 × 0.2 = 272：比例值与最小宽度恰好重合的边界
        expect(computeSidebarWidth(1360, 'proportional')).toBe(272);
    });

    it('D2 窄窗口：最小宽度生效（对抗"直接乘比例"的错误实现）', () => {
        expect(computeSidebarWidth(1300, 'proportional')).toBe(SIDEBAR_MIN_WIDTH); // 260 < 272
        expect(computeSidebarWidth(1024, 'proportional')).toBe(SIDEBAR_MIN_WIDTH); // 205 < 272
        expect(computeSidebarWidth(800, 'proportional')).toBe(SIDEBAR_MIN_WIDTH);  // 160 < 272
    });

    it('D3 固定模式：任何窗口宽都是 340px（= 现状）', () => {
        expect(computeSidebarWidth(1920, 'fixed')).toBe(340);
        expect(computeSidebarWidth(1024, 'fixed')).toBe(340);
    });

    it('D4 不变量：proportional 永不低于最小宽度，且随容器宽单调不减', () => {
        let prev = 0;
        for (let w = 240; w <= 3000; w += 20) {
            const v = computeSidebarWidth(w, 'proportional');
            expect(v).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH);
            expect(v).toBeGreaterThanOrEqual(prev);
            prev = v;
        }
    });
});

// ── E. 持久化 ────────────────────────────────────────────────────────────────
describe('P2-6 E: localStorage 持久化（验收 5）', () => {
    it('E1 变更写入版本化键；重置模块后重读保持（模拟重开页面）', async () => {
        const { mod, store } = await freshSettings();
        const KEY = mod.DISPLAY_SETTINGS_KEY;
        expect(KEY).toBe('brogue-web-display-v1'); // 沿用项目版本化键名惯例

        mod.displaySettings.mapScaleMode = 'stretch';
        mod.displaySettings.sidebarWidthMode = 'proportional';

        expect(JSON.parse(store.getItem(KEY)!)).toEqual({
            mapScaleMode: 'stretch',
            sidebarWidthMode: 'proportional',
        });

        // 模拟页面重开：同一 storage、全新模块实例
        const again = await freshSettings(store);
        expect(again.mod.displaySettings.mapScaleMode).toBe('stretch');
        expect(again.mod.displaySettings.sidebarWidthMode).toBe('proportional');
    });

    it('E2 存档损坏（非法 JSON）：回退默认值，不抛异常', async () => {
        const store = makeStorage();
        store.setItem('brogue-web-display-v1', '{not json');
        const { mod } = await freshSettings(store);
        expect(mod.displaySettings.mapScaleMode).toBe('uniform');
        expect(mod.displaySettings.sidebarWidthMode).toBe('fixed');
    });

    it('E3 字段值非法：非法字段回退默认，合法字段保留（逐字段容错）', async () => {
        const store = makeStorage();
        store.setItem(
            'brogue-web-display-v1',
            JSON.stringify({ mapScaleMode: 'bogus', sidebarWidthMode: 'proportional' }),
        );
        const { mod } = await freshSettings(store);
        expect(mod.displaySettings.mapScaleMode).toBe('uniform');
        expect(mod.displaySettings.sidebarWidthMode).toBe('proportional');
    });
});

// ── F. 源码守卫：设置变更必须接到同一条布局重算路径 ──────────────────────────
describe('P2-6 F: 源码守卫（设置 → 即时生效接线）', () => {
    it('F1 GameCanvas：computeMapLayout 吃设置值，且 watch 模式切换触发 applyLayout', () => {
        const src = readFileSync(new URL('../components/GameCanvas.vue', import.meta.url), 'utf8');
        // 布局计算必须使用当前设置（第三参），否则切换模式不会生效
        expect(src).toMatch(/computeMapLayout\(\s*el\.clientWidth,\s*el\.clientHeight,\s*displaySettings\.mapScaleMode/);
        // 模式切换不改变容器尺寸，ResizeObserver 不会触发，必须显式 watch
        expect(src).toMatch(/watch\(\(\) => displaySettings\.mapScaleMode/);
        // 不得退回 window 视口口径（P2-4 E4 的守卫，本轮不得破坏）
        expect(src).not.toMatch(/window\.innerWidth|window\.innerHeight/);
    });

    it('F2 Sidebar：宽度必须经 computeSidebarWidth 按设置驱动', () => {
        const src = readFileSync(new URL('../components/Sidebar.vue', import.meta.url), 'utf8');
        expect(src).toMatch(/computeSidebarWidth\(/);
        expect(src).toMatch(/displaySettings\.sidebarWidthMode/);
        // 固定 340px 不再写死在 CSS 里（否则按比例模式会被 CSS 覆盖或打架）
        expect(src).not.toMatch(/\.sidebar\s*\{[^}]*width:\s*340px/);
    });
});
