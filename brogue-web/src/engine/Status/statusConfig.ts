import type { StatusId } from '../../entities/Creature';

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
    telepathy: { id: 'telepathy', label: '心灵感应', color: '#67e8f9', isDebuff: false },
    levitating: { id: 'levitating', label: '漂浮', color: '#bfdbfe', isDebuff: false },
    hallucinating: { id: 'hallucinating', label: '幻觉', color: '#f0abfc', isDebuff: true },
    confused: { id: 'confused', label: '混乱', color: '#c4b5fd', isDebuff: true },
    regenerating: { id: 'regenerating', label: '再生', color: '#86efac', isDebuff: false },
    haste: { id: 'haste', label: '急行', color: '#fde047', isDebuff: false },
    hasted: { id: 'hasted', label: '急速', color: '#fde047', isDebuff: false },
    poisoned: { id: 'poisoned', label: '中毒', color: '#65a30d', isDebuff: true },
    slowed: { id: 'slowed', label: '缓慢', color: '#d6d3d1', isDebuff: true },
    weakened: { id: 'weakened', label: '虚弱', color: '#a8a29e', isDebuff: true },
    flying: { id: 'flying', label: '飞行', color: '#bae6fd', isDebuff: false },
    immune_fire: { id: 'immune_fire', label: '火焰免疫', color: '#fca5a5', isDebuff: false },
    // CE discordColor（GlobalsBrogue.c）：discordBlast 的 "unsettling purple radiation"
    discordant: { id: 'discordant', label: '不和', color: '#c084fc', isDebuff: true },
    // F-2b：CE STATUS_BURNING（Rogue.h:2000）。载体与申报见文件头 BurningStatusId 注释。
    burning: { id: 'burning', label: '燃烧', color: '#fb923c', isDebuff: true }
};

