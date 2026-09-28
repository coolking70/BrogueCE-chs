/**
 * src/ui/layout.ts — FE-1 响应式布局模式（纯显示层，不碰任何玩法状态）。
 *
 * 三种模式按**视口尺寸**判定（不看 UA）：
 *  - desktop：宽 ≥ 1024 且 高 ≥ 600 —— 与 v0.1.0 现状完全一致（地图 + 右侧侧栏）；
 *  - portrait：其余且 宽 ≤ 高 —— 上状态条 / 中地图 / 下消息 + 命令栏；
 *  - landscape：其余且 宽 > 高 —— 地图全屏，左侧命令栏，右下方向键。
 *
 * CSS 侧用同一断点：`@media (max-width: 1023px), (max-height: 599px)`。
 */
import { reactive } from 'vue';

export type LayoutMode = 'desktop' | 'portrait' | 'landscape';

export const DESKTOP_MIN_WIDTH = 1024;
export const DESKTOP_MIN_HEIGHT = 600;

export function computeLayoutMode(width: number, height: number): LayoutMode {
    if (width >= DESKTOP_MIN_WIDTH && height >= DESKTOP_MIN_HEIGHT) return 'desktop';
    return width <= height ? 'portrait' : 'landscape';
}

export interface ViewportState {
    width: number;
    height: number;
    mode: LayoutMode;
    /** 粗指针（触屏为主）设备：桌面尺寸下也显示触控命令栏。 */
    coarsePointer: boolean;
}

const hasWindow = typeof window !== 'undefined';

function readCoarse(): boolean {
    try {
        return hasWindow && typeof window.matchMedia === 'function'
            && window.matchMedia('(pointer: coarse)').matches;
    } catch {
        return false;
    }
}

export const viewport = reactive<ViewportState>({
    width: hasWindow ? window.innerWidth : 1280,
    height: hasWindow ? window.innerHeight : 800,
    mode: hasWindow ? computeLayoutMode(window.innerWidth, window.innerHeight) : 'desktop',
    coarsePointer: readCoarse(),
});

let listening = false;

/** 挂一次全局 resize 监听（App 挂载时调用；重复调用无副作用）。 */
export function startViewportTracking(): void {
    if (!hasWindow || listening) return;
    listening = true;
    const update = () => {
        viewport.width = window.innerWidth;
        viewport.height = window.innerHeight;
        viewport.mode = computeLayoutMode(viewport.width, viewport.height);
        viewport.coarsePointer = readCoarse();
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    update();
}
