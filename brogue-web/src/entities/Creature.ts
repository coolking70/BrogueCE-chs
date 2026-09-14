/**
 * src/entities/Creature.ts
 * Base class for all living things (Player and Monsters)
 */

import type { Entity, Pos } from '../types';
import { Direction } from '../types';

export type StatusId = 'paralyzed' | 'invisible' | 'telepathy' | 'levitating' | 'hallucinating' | 'confused' | 'regenerating' | 'haste' | 'poisoned' | 'slowed' | 'hasted' | 'weakened' | 'flying' | 'immune_fire' | 'discordant';
type StatusStackMode = 'refresh' | 'stack';

/**
 * CE 客观时间的周期基准（Time.c:2667 ticksTillUpdateEnvironment += 100）。
 * P2-2 起调度不再使用恒定 100——行动耗时由 Creature.movementSpeed/attackSpeed
 * 决定；本常量仅保留给客观时间门（P2-3 接入）与既有测试引用。
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
     * 初始 0 是 CE 玩家的口径（Time.c:2604 首次结算时累加）；怪物在自身
     * 构造器里按 Monsters.c:116 覆写为 info.movementSpeed（P2-2 起为真实值）。
     */
    public ticksUntilTurn: number;

    // ---- P2-2 真实速度（CE creature->movementSpeed / ->attackSpeed）----
    // 语义注意：speed 是"行动一次要花多少 tick"，值越小越快（Time.c:2451 起
    // 的推进循环按剩余 tick 排序）。CE info 基准：玩家恒 100/100，怪物来自
    // monsterCatalog（web 侧 monsters.json 的 moveSpeed/attackSpeed）。
    /** 当前移动耗时（tick）。haste 减半 / slowed 翻倍（Items.c:4637-4660）。 */
    public movementSpeed: number = 100;
    /** 当前攻击/施法耗时（tick）。 */
    public attackSpeed: number = 100;

    /** info 基准移动速度；Player 的 info 恒 100，Monster 取 monsters.json。 */
    protected get infoMovementSpeed(): number { return 100; }
    /** info 基准攻击速度。 */
    protected get infoAttackSpeed(): number { return 100; }

    /**
     * CE Items.c:4637-4660（slow/haste 对当前速度的改写）与 Time.c:2261-2273
     * （状态结束恢复 info 原值）：当前速度永远由 info 基准 + haste/slowed 状态
     * 推导，幂等。任何状态增删（applyStatus/tickStatuses）或基准变更（突变、
     * 存档还原）后重算一次即可，无需在施加点逐处赋值。
     * CE 的 haste/slow 互斥（互相清对方状态位）由施加方负责；web 侧当前
     * 不存在同时施加的路径，推导时 haste 优先仅作兜底。
     */
    public refreshSpeeds(): void {
        let move = this.infoMovementSpeed;
        let atk = this.infoAttackSpeed;
        if (this.hasStatus('haste') || this.hasStatus('hasted')) {
            move = Math.floor(move / 2);
            atk = Math.floor(atk / 2);
        } else if (this.hasStatus('slowed')) {
            move = move * 2;
            atk = atk * 2;
        }
        this.movementSpeed = move;
        this.attackSpeed = atk;
    }

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
        this.refreshSpeeds();
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
        if (expired.length > 0) this.refreshSpeeds();
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
