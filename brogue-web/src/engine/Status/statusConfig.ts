import type { StatusId } from '../../entities/Creature';

export interface StatusConfigEntry {
    id: StatusId;
    label: string;
    color: string;
    isDebuff: boolean;
}

export const STATUS_CONFIG: Record<StatusId, StatusConfigEntry> = {
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
    immune_fire: { id: 'immune_fire', label: '火焰免疫', color: '#fca5a5', isDebuff: false }
};

