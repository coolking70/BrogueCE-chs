/**
 * src/entities/Creature.ts
 * Base class for all living things (Player and Monsters)
 */

import type { Entity, Pos } from '../types';
import { Direction } from '../types';

export type StatusId = 'paralyzed' | 'invisible' | 'telepathy' | 'levitating' | 'hallucinating' | 'confused' | 'regenerating' | 'haste' | 'poisoned' | 'slowed' | 'hasted' | 'weakened' | 'flying' | 'immune_fire' | 'discordant';
type StatusStackMode = 'refresh' | 'stack';

/**
 * P2-1 的恒定速度口径：所有 tick 赋值一律用它，不读真实 moveSpeed/attackSpeed
 * （CE 的 movementSpeed/attackSpeed 与地形 movementDuration 留待 P2-2 接入）。
 * 100 也是 CE 客观时间的周期基准（Time.c:2667 ticksTillUpdateEnvironment += 100）。
 */
export const TICKS_PER_TURN = 100;

// 实体 ID 用模块级单调递增计数器：ID 只需唯一、不需随机。
// 若用 RNG 生成，每创建一个实体就消耗一次玩法随机数，会严重污染 SUBSTANTIVE 流。
// 读档路径必须调用 ensureEntityIdAbove 把计数器推到存档最大 id 之上，
// 否则读档后新建实体会与存档实体撞号（见 Game.loadSnapshot）。
let nextEntityId = 1;

export function allocateEntityId(): number {
    return nextEntityId++;
}

export function ensureEntityIdAbove(maxInUseId: number): void {
    if (nextEntityId <= maxInUseId) {
        nextEntityId = maxInUseId + 1;
    }
}

export class Creature implements Entity {
    public id: number;
    public loc: Pos;
    public hp: number;
    public maxHp: number;
    public name: string;
    public color: number;
    public char: string;
    public statusDurations: Partial<Record<StatusId, number>>;
    public statusImmunities: Set<StatusId>;
    /**
     * CE creature->ticksUntilTurn（Rogue.h:2192）：距下次可行动的剩余 tick。
     * 初始 0 是 CE 玩家的口径（Time.c:2602 首次结算时累加）；怪物在自身
     * 构造器里按 Monsters.c:116 覆写为满速值（本轮恒 TICKS_PER_TURN）。
     */
    public ticksUntilTurn: number;

    constructor(x: number, y: number, name: string, char: string, color: number) {
        this.id = allocateEntityId();
        this.loc = { x, y };
        this.name = name;
        this.char = char;
        this.color = color;
        this.hp = 10;
        this.maxHp = 10;
        this.statusDurations = {};
        this.statusImmunities = new Set<StatusId>();
        this.ticksUntilTurn = 0;
    }

    get x(): number { return this.loc.x; }
    get y(): number { return this.loc.y; }

    public hasStatus(id: StatusId): boolean {
        return (this.statusDurations[id] ?? 0) > 0;
    }

    public getStatusDuration(id: StatusId): number {
        return this.statusDurations[id] ?? 0;
    }

    public setStatusDuration(id: StatusId, duration: number) {
        if (duration > 0) {
            this.statusDurations[id] = duration;
        } else {
            delete this.statusDurations[id];
        }
    }

    public applyStatus(id: StatusId, duration: number, stackMode: StatusStackMode = 'refresh'): boolean {
        if (duration <= 0 || this.statusImmunities.has(id)) return false;
        const current = this.statusDurations[id] ?? 0;
        const next = stackMode === 'stack' ? current + duration : Math.max(current, duration);
        if (next === current) return false;
        this.statusDurations[id] = next;
        return true;
    }

    public tickStatuses(): StatusId[] {
        const expired: StatusId[] = [];
        const entries = Object.entries(this.statusDurations) as Array<[StatusId, number]>;
        for (const [id, turns] of entries) {
            const next = turns - 1;
            if (next <= 0) {
                delete this.statusDurations[id];
                expired.push(id);
            } else {
                this.statusDurations[id] = next;
            }
        }
        return expired;
    }

    public move(_dir: Direction) {
        // Implement movement logic
    }

    public takeDamage(amount: number) {
        this.hp -= amount;
        if (this.hp <= 0) {
            this.die();
        }
    }

    protected die() {
        // Handle death
        this.char = '%';
        this.color = 0x880000;
    }
}
