import type { Creature, StatusId } from '../../entities/Creature';

/**
 * F-2b：键联合扩入 'burning'。CE STATUS_BURNING（Rogue.h:2000）的载体走
 * Game.ts 的 statusDurations 逃生舱键（'burning' 不在 StatusId 联合——
 * src/entities 本轮禁改，任务书 §三 明示申报不擅自动）；本条目仅供
 * Sidebar 的 Record<string> 视角把该键显示成"燃烧"，与既有标签同为
 * 硬编码中文（statusConfig 无 t() 调用，不经 i18n gate）。
 */
export type BurningStatusId = StatusId | 'burning';

export interface StatusConfigEntry {
    id: BurningStatusId;
    label: string;
    color: string;
    isDebuff: boolean;
}

export const STATUS_CONFIG: Record<BurningStatusId, StatusConfigEntry> = {
    paralyzed: { id: 'paralyzed', label: '麻痹', color: '#fca5a5', isDebuff: true },
    invisible: { id: 'invisible', label: '隐形', color: '#93c5fd', isDebuff: false },
    shielded: { id: 'shielded', label: '护盾', color: '#fde68a', isDebuff: false },
    telepathy: { id: 'telepathy', label: '心灵感应', color: '#67e8f9', isDebuff: false },
    levitating: { id: 'levitating', label: '漂浮', color: '#bfdbfe', isDebuff: false },
    hallucinating: { id: 'hallucinating', label: '幻觉', color: '#f0abfc', isDebuff: true },
    confused: { id: 'confused', label: '混乱', color: '#c4b5fd', isDebuff: true },
    entranced: { id: 'entranced', label: '催眠', color: '#fde047', isDebuff: true },
    regenerating: { id: 'regenerating', label: '再生', color: '#86efac', isDebuff: false },
    haste: { id: 'haste', label: '急行', color: '#fde047', isDebuff: false },
    hasted: { id: 'hasted', label: '急速', color: '#fde047', isDebuff: false },
    poisoned: { id: 'poisoned', label: '中毒', color: '#65a30d', isDebuff: true },
    slowed: { id: 'slowed', label: '缓慢', color: '#d6d3d1', isDebuff: true },
    weakened: { id: 'weakened', label: '虚弱', color: '#a8a29e', isDebuff: true },
    nauseous: { id: 'nauseous', label: '恶心', color: '#b7a26b', isDebuff: true },
    darkness: { id: 'darkness', label: '黑暗', color: '#94a3b8', isDebuff: true },
    magical_fear: { id: 'magical_fear', label: '魔法恐惧', color: '#fca5a5', isDebuff: true },
    flying: { id: 'flying', label: '飞行', color: '#bae6fd', isDebuff: false },
    immune_fire: { id: 'immune_fire', label: '火焰免疫', color: '#fca5a5', isDebuff: false },
    // CE discordColor（GlobalsBrogue.c）：discordBlast 的 "unsettling purple radiation"
    discordant: { id: 'discordant', label: '不和', color: '#c084fc', isDebuff: true },
    // F-2b：CE STATUS_BURNING（Rogue.h:2000）。载体与申报见文件头 BurningStatusId 注释。
    burning: { id: 'burning', label: '燃烧', color: '#fb923c', isDebuff: true }
};

/**
 * UI-1 第 5 条：CE statusEffectCatalog 中显示名为**空串**的状态
 * （Globals.c:1794-1821）：STATUS_EXPLOSION_IMMUNITY / STATUS_NUTRITION /
 * STATUS_ENTERS_LEVEL_IN / STATUS_ENRAGED——CE 有意不在侧栏显示它们
 * （IO.c:4823 的 `statusEffectCatalog[i].name[0]` 门）。
 *
 * ⚠️ 路线图 P1-47 原登记「explosion_immunity 显示裸键名 → 补中文标签」
 * 方向是反的：按 CE 的正确处置是**不显示**。
 *
 * web 侧核对（2026-09-18）：statusDurations 的逃生舱键里只有
 * 'explosion_immunity' 命中本表——'burning' 在 CE 有名（"Burning"），
 * nutrition 不进 statusDurations（走专门的饥饿部件，CE 同款，IO.c:4786），
 * enters_level_in / enraged 两个键 web 尚无写入点。
 */
export const CE_EMPTY_NAME_STATUSES: ReadonlySet<string> = new Set(['explosion_immunity']);

/**
 * CE IO.c:4823 `name[0]` 门的 web 等价：false = 侧栏不得显示该状态。
 * 未登记进 STATUS_CONFIG 的键仍返回 true（保持既有「未知键裸显」的
 * 调试可见性，CE 无此情形、不作收缩）。
 */
export function isSidebarVisibleStatus(id: string): boolean {
    return !CE_EMPTY_NAME_STATUSES.has(id);
}

/** Shared visible status presentation for sidebar and creature details. */
export function creatureStatusRows(creature: Creature, visible = isSidebarVisibleStatus) {
    return Object.entries(creature.statusDurations)
        .filter(([id, turns]) => (turns ?? 0) > 0 && visible(id))
        .map(([id, turns]) => {
            const meta = STATUS_CONFIG[id as BurningStatusId] ?? { label: id, color: '#dbeafe' };
            const maximum = (creature.maxStatus as Record<string, number>)[id];
            return { id, color: meta.color,
                label: id === 'weakened' ? `${meta.label} -${creature.weaknessAmount}` : meta.label,
                value: id === 'shielded' ? `${turns / 10} HP` : maximum ? `${turns}/${maximum}` : `${turns}`,
                fraction: maximum ? Math.max(0, Math.min(1, turns / maximum)) : 1 };
        });
}
