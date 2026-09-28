/**
 * src/ui/mapCamera.ts — FE-1 小屏地图相机（纯函数 + 纯 UI 状态）。
 *
 * 桌面仍由 GameCanvas.computeMapLayout 决定（等比/拉伸，P2-6 口径不变）。
 * 只有当那个结果"过小"（每格 < MIN_READABLE_TILE_PX）时才切入跟随模式：
 * 以用户缩放级给出每格像素，视口以玩家为中心并夹在地图边界内，
 * 用户拖动产生的平移叠加在跟随中心上。
 *
 * 相机状态（缩放级、平移量）是纯显示状态：不进存档、不进录像、不碰 rng。
 */
import { reactive, watch } from 'vue';

export const MIN_READABLE_TILE_PX = 12;
export const MAX_TILE_PX = 40;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;
export const CAMERA_SETTINGS_KEY = 'brogue-web-camera-v1';

export interface BaseLayout {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
}

export interface CameraLayout extends BaseLayout {
    /** true = 处于跟随模式（地图大于视口，可平移） */
    follow: boolean;
    /** 夹紧后实际生效的平移量（写回状态，防止平移"越界累积"） */
    panX: number;
    panY: number;
}

/** 默认每格像素：约 24 列 / 18 行可见（取较小者），夹在 [12, 22]。 */
export function defaultTilePx(viewW: number, viewH: number): number {
    return Math.max(MIN_READABLE_TILE_PX, Math.min(22, viewW / 24, viewH / 18));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 一个轴：地图比视口小就居中；否则以 focus 为中心 + pan，夹在 [view - map, 0]。 */
function axis(view: number, mapPx: number, focusPx: number, pan: number): { offset: number; pan: number } {
    if (mapPx <= view) return { offset: (view - mapPx) / 2, pan: 0 };
    const centered = view / 2 - focusPx;
    const offset = clamp(centered + pan, view - mapPx, 0);
    return { offset, pan: offset - centered };
}

/**
 * @param base    computeMapLayout 的结果
 * @param cols/rows/tile  地图格数与逻辑格边长（TILE_SIZE）
 * @param focus   跟随中心（玩家格坐标）
 */
export function computeMapCamera(
    viewW: number,
    viewH: number,
    base: BaseLayout,
    cols: number,
    rows: number,
    tile: number,
    focus: { x: number; y: number },
    zoom: number,
    pan: { x: number; y: number },
): CameraLayout {
    const baseTilePx = Math.min(base.scaleX, base.scaleY) * tile;
    if (viewW <= 0 || viewH <= 0 || baseTilePx >= MIN_READABLE_TILE_PX) {
        return { ...base, follow: false, panX: 0, panY: 0 };
    }
    const tilePx = clamp(defaultTilePx(viewW, viewH) * clamp(zoom, MIN_ZOOM, MAX_ZOOM), baseTilePx, MAX_TILE_PX);
    if (tilePx <= baseTilePx + 1e-6) {
        return { ...base, follow: false, panX: 0, panY: 0 };
    }
    const scale = tilePx / tile;
    const x = axis(viewW, cols * tilePx, (focus.x + 0.5) * tilePx, pan.x);
    const y = axis(viewH, rows * tilePx, (focus.y + 0.5) * tilePx, pan.y);
    return { scaleX: scale, scaleY: scale, offsetX: x.offset, offsetY: y.offset, follow: true, panX: x.pan, panY: y.pan };
}

export interface CameraState {
    zoom: number;
    panX: number;
    panY: number;
    /** 最近一次布局是否处于跟随模式（供 UI 决定是否显示缩放钮） */
    follow: boolean;
}

function loadZoom(): number {
    try {
        const raw = window.localStorage.getItem(CAMERA_SETTINGS_KEY);
        const z = raw ? Number(JSON.parse(raw).zoom) : 1;
        return Number.isFinite(z) ? clamp(z, MIN_ZOOM, MAX_ZOOM) : 1;
    } catch {
        return 1;
    }
}

export const cameraState = reactive<CameraState>({ zoom: loadZoom(), panX: 0, panY: 0, follow: false });

watch(() => cameraState.zoom, (zoom) => {
    try {
        window.localStorage.setItem(CAMERA_SETTINGS_KEY, JSON.stringify({ zoom }));
    } catch {
        // headless / 隐私模式：仅本次会话有效
    }
});

export function zoomBy(factor: number): void {
    cameraState.zoom = clamp(cameraState.zoom * factor, MIN_ZOOM, MAX_ZOOM);
}

export function recenterCamera(): void {
    cameraState.panX = 0;
    cameraState.panY = 0;
}
