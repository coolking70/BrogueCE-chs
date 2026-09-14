/**
 * src/engine/Settings.ts — 显示设置（P2-6）
 *
 * 只管"显示观感"（地图缩放模式、侧栏宽度模式），不碰任何玩法状态。
 * 两项默认值即 P2-5 的现状行为：等比缩放 + 固定 340px 侧栏。
 * 老玩家不打开设置时观感必须完全不变。
 *
 * 持久化沿用项目的版本化键名惯例（brogue-web-save-v1 / brogue-web-replay-v1）。
 * localStorage 在 headless 测试环境不存在，所有存取都包 try/catch 回退默认值。
 */
import { reactive, watch } from 'vue';

/** 地图缩放模式：uniform = 等比缩放居中（web 现状）；stretch = 拉伸铺满（CE tiles.c:782-803 口径）。 */
export type MapScaleMode = 'uniform' | 'stretch';

/** 侧栏宽度模式：fixed = 固定 340px（web 现状）；proportional = 按容器宽度百分比（CE 口径，20%）。 */
export type SidebarWidthMode = 'fixed' | 'proportional';

export interface DisplaySettings {
    mapScaleMode: MapScaleMode;
    sidebarWidthMode: SidebarWidthMode;
}

export const DISPLAY_SETTINGS_KEY = 'brogue-web-display-v1';

/** 固定模式下的侧栏宽度（= P2-5 之前的现状值，Sidebar.vue 原 CSS）。 */
export const SIDEBAR_FIXED_WIDTH = 340;

/**
 * 按比例模式的基准：CE 侧栏是同一张字符网格的左 20 列
 * （STAT_BAR_WIDTH = 20，COLS = 100），恒占 20% 宽度。
 */
export const SIDEBAR_PROPORTION = 0.2;

/**
 * 按比例模式的下限。CE 的侧栏文字随字符网格一起缩放，比例再小也读得出；
 * web 的侧栏是 DOM 文本，字号不随宽度变，窄窗口下若按 20% 硬算
 * （1024px 窗 → 205px）内容会挤成一团。取 272px：扣掉两侧 1.5rem 内边距后
 * 内容区仍有 224px（14rem），HP 行（标签 20 + 间距 + 数值 45）之外血条和
 * 日志文本还能正常排版；落在提示词建议的 260-280px 区间中段。
 */
export const SIDEBAR_MIN_WIDTH = 272;

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
    mapScaleMode: 'uniform',
    sidebarWidthMode: 'fixed',
};

export function isMapScaleMode(v: unknown): v is MapScaleMode {
    return v === 'uniform' || v === 'stretch';
}

export function isSidebarWidthMode(v: unknown): v is SidebarWidthMode {
    return v === 'fixed' || v === 'proportional';
}

/** 从 localStorage 读取；缺失、损坏或字段非法时逐字段回退默认值。 */
export function loadDisplaySettings(): DisplaySettings {
    try {
        const raw = window.localStorage.getItem(DISPLAY_SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_DISPLAY_SETTINGS };
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return {
            mapScaleMode: isMapScaleMode(parsed.mapScaleMode)
                ? parsed.mapScaleMode
                : DEFAULT_DISPLAY_SETTINGS.mapScaleMode,
            sidebarWidthMode: isSidebarWidthMode(parsed.sidebarWidthMode)
                ? parsed.sidebarWidthMode
                : DEFAULT_DISPLAY_SETTINGS.sidebarWidthMode,
        };
    } catch {
        return { ...DEFAULT_DISPLAY_SETTINGS };
    }
}

export function saveDisplaySettings(settings: DisplaySettings): void {
    try {
        window.localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // headless / 隐私模式下无 localStorage：设置仅本次会话有效
    }
}

/**
 * 全局响应式设置。组件直接读它，任何变更即时生效（无需刷新页面）；
 * 变更经模块级 watch 自动持久化。
 */
export const displaySettings = reactive<DisplaySettings>(loadDisplaySettings());

// 同步 flush：设置变更频率极低（用户点选），同步写让 localStorage 与
// store 严格一致——变更后立刻关页也不丢，测试也无需等微任务。
watch(displaySettings, () => {
    saveDisplaySettings({ ...displaySettings });
}, { flush: 'sync' });

/**
 * 侧栏宽度：按比例模式 = max(最小宽度, 容器宽 × 20%)，四舍五入到整像素。
 * 容器宽指 app-layout（100vw）的宽度，即 window.innerWidth。
 */
export function computeSidebarWidth(containerWidth: number, mode: SidebarWidthMode): number {
    if (mode === 'proportional') {
        return Math.max(SIDEBAR_MIN_WIDTH, Math.round(containerWidth * SIDEBAR_PROPORTION));
    }
    return SIDEBAR_FIXED_WIDTH;
}
