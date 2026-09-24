/**
 * src/entities/Creature.ts
 * Base class for all living things (Player and Monsters)
 */

import type { Entity, Pos } from '../types';
import { Direction } from '../types';

export type StatusId = 'paralyzed' | 'invisible' | 'telepathy' | 'levitating' | 'hallucinating' | 'confused' | 'regenerating' | 'haste' | 'poisoned' | 'slowed' | 'hasted' | 'weakened' | 'flying' | 'immune_fire' | 'discordant' | 'shielded' | 'entranced' | 'nauseous' | 'darkness' | 'magical_fear';
type StatusStackMode = 'refresh' | 'stack';

/**
 * CE 客观时间的周期基准（Time.c:2667 ticksTillUpdateEnvironment += 100）。
 * P2-2 起调度不再使用恒定 100——行动耗时由 Creature.movementSpeed/attackSpeed
 * 决定；本常量仅保留给客观时间门（P2-3 接入）与既有测试引用。
 */
export const TICKS_PER_TURN = 100;

/**
 * CE initializeStatus 给旗标派生状态设的时长（Monsters.c:3913-3920，字面 1000，
 * 源码注释 "won't decrease"）。真正的"不衰减"由 isStatusPermanent 钩子保证
 * （CE updateMonsterStatus 对带旗标者跳过递减，Monsters.c:1852-1856、
 * 1963-1967）；本常量只是载体值，取同字面值便于与 CE 对照。
 * P1-28 起 Monster.syncFlagDerivedStatuses 用它回填 MONST_FLIES /
 * MONST_IMMUNE_TO_FIRE 的派生状态。
 */
export const PERMANENT_STATUS_DURATION = 1000;

// 实体 ID 用模块级单调递增计数器：ID 只需唯一、不需随机。
// 若用 RNG 生成，每创建一个实体就消耗一次玩法随机数，会严重污染 SUBSTANTIVE 流。
// 读档路径必须调用 ensureEntityIdAbove 把计数器推到存档最大 id 之上，
// 否则读档后新建实体会与存档实体撞号（见 Game.loadSnapshot）。
let nextEntityId = 1;

/** IDs belong to one run; call only after discarding the previous world's references. */
export function resetEntityIds(): void {
    nextEntityId = 1;
}

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
    /** CE creature.poisonAmount: damage per objective poison tick. */
    public poisonAmount = 0;
    /** CE creature.weaknessAmount, independent of the weakened countdown. */
    public weaknessAmount = 0;
    /** U14a subset of CE maxStatus; other states retain their existing carriers. */
    public maxStatus: Partial<Record<'weakened' | 'nauseous' | 'darkness' | 'magical_fear', number>> = {};
    /** CE maxStatus[SHIELDED], in tenths of HP; determines decay, not a cap. */
    public maxShield = 0;
    /**
     * CE creature->ticksUntilTurn（Rogue.h:2192）：距下次可行动的剩余 tick。
     * 初始 0 是 CE 玩家的口径（Time.c:2604 首次结算时累加）；怪物在自身
     * 构造器里按 Monsters.c:116 覆写为 info.movementSpeed（P2-2 起为真实值）。
     */
    public ticksUntilTurn: number;

    // ---- P4-5：CE bookkeepingFlags 里与近战特殊能力相关的两位 ----
    // Combat.c:1212-1237（attack() 内 MA_SEIZES 分支）用这两个布尔位互相
    // 协调"谁抓着谁"；CE 是位掩码里的两个 flag（MB_SEIZED/MB_SEIZING），
    // web 直接拆成两个具名布尔字段，语义与命名一一对应，不新造抽象。
    /** CE bookkeepingFlags & MB_SEIZED：本对象被某个 MA_SEIZES 攻击者抓住，
     *  移动前必须先确认抓它的怪物是否还活着挨着自己（Movement.c:1267-1297）。 */
    public seized: boolean = false;
    /** CE bookkeepingFlags & MB_SEIZING：本对象正抓着某个猎物。 */
    public seizing: boolean = false;

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
    public hasAlteredSpeeds(): boolean {
        return this.movementSpeed !== this.infoMovementSpeed || this.attackSpeed !== this.infoAttackSpeed;
    }

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
        if (id === 'weakened' && duration <= 0) this.weaknessAmount = 0;
        if (id === 'shielded') this.maxShield = Math.max(0, duration);
        if (id === 'poisoned') this.poisonAmount = duration > 0 && this.hasStatus(id) ? Math.max(1, this.poisonAmount) : duration > 0 ? 1 : 0;
        if (duration > 0) {
            this.statusDurations[id] = duration;
        } else {
            delete this.statusDurations[id];
        }
    }

    public applyStatus(id: StatusId, duration: number, stackMode: StatusStackMode = 'refresh'): boolean {
        if (id === 'weakened') return this.weaken(duration);
        if (id === 'shielded') return this.applyShield(duration);
        if (id === 'poisoned') return this.addPoison(duration, 1);
        if (duration <= 0 || this.statusImmunities.has(id)) return false;
        const current = this.statusDurations[id] ?? 0;
        const next = stackMode === 'stack' ? current + duration : Math.max(current, duration);
        if (id === 'darkness') this.maxStatus.darkness = Math.max(this.maxStatus.darkness ?? 0, duration);
        if (id === 'nauseous' || id === 'magical_fear') this.maxStatus[id] = next;
        if (next === current) return false;
        this.statusDurations[id] = next;
        this.refreshSpeeds();
        return true;
    }

    /** CE Items.c:4558: each dose adds a layer even when the timer is unchanged. */
    public weaken(duration: number): boolean {
        if (duration <= 0 || this.statusImmunities.has('weakened')) return false;
        const before = this.weaknessAmount;
        this.weaknessAmount = Math.min(10, before + 1);
        const current = this.getStatusDuration('weakened');
        this.statusDurations.weakened = Math.max(current, duration);
        this.maxStatus.weakened = Math.max(this.maxStatus.weakened ?? 0, duration);
        return before !== this.weaknessAmount || current !== this.statusDurations.weakened;
    }

    /** CE attack/moralAttack: fear ends on the next objective tick. */
    public shortenMagicalFear(): void {
        if (this.hasStatus('magical_fear')) this.setStatusDuration('magical_fear', 1);
    }

    /** CE Items.c:4664 heal. Panacea reduces selected countdowns to ONE,
     * not zero; slow keeps its cached speed until the normal expiration tick.
     * Burning, paralysis, discord, entrancement and beneficial states survive. */
    public heal(percent: number, panacea = false): number {
        const before = this.hp;
        this.hp = Math.min(this.maxHp, this.hp + Math.trunc(percent * this.maxHp / 100));
        if (panacea) {
            for (const id of ['hallucinating', 'confused', 'slowed', 'nauseous'] as const) {
                if (this.getStatusDuration(id) > 1) this.setStatusDuration(id, 1);
            }
            // CE deliberately leaves WEAKENED == 1 intact.
            if (this.getStatusDuration('weakened') > 1) this.setStatusDuration('weakened', 0);
            if (this.hasStatus('darkness')) this.setStatusDuration('darkness', 0);
            if (this.hasStatus('poisoned')) this.setStatusDuration('poisoned', 0);
        }
        return this.hp - before;
    }

    public canBePoisoned(): boolean {
        return this.hp > 0 && !this.statusImmunities.has('poisoned');
    }

    /** CE Combat.c:1905-1920: additive duration AND concentration; no instant damage.
     * Keep the existing web poison immunity extension. A zero concentration increment
     * (lichen-style exposure) establishes one dose but never raises existing doses. */
    public addPoison(duration: number, concentration = 1): boolean {
        if (duration <= 0 || !this.canBePoisoned()) return false;
        const oldDuration = this.getStatusDuration('poisoned');
        this.poisonAmount = Math.max(1, (oldDuration > 0 ? Math.max(1, this.poisonAmount) : 0) + concentration);
        this.statusDurations.poisoned = oldDuration + duration;
        return true;
    }

    /** Legacy saves had only a countdown; migrate without RNG. */
    public restorePoison(amount?: number): void {
        this.poisonAmount = this.hasStatus('poisoned') ? Math.max(1, Math.trunc(amount ?? 1)) : 0;
    }

    /** CE Items.c:5405-5408: stronger of current/new, then ALWAYS reset max. */
    public applyShield(tenths: number): boolean {
        const previous = this.getStatusDuration('shielded');
        const next = Math.max(previous, Math.trunc(tenths));
        const changed = previous !== next || this.maxShield !== next;
        this.setStatusDuration('shielded', next);
        return changed;
    }

    /** Old 'shielded' was a countdown with no absorption amount. Discard it
     * when maxShield is absent; inventing HP from those turns would be unsafe. */
    public restoreShield(maxShield?: number): void {
        const current = this.getStatusDuration('shielded');
        if (maxShield === undefined || !Number.isFinite(maxShield) || maxShield <= 0 || !Number.isFinite(current) || current <= 0) {
            this.setStatusDuration('shielded', 0);
        } else {
            this.statusDurations.shielded = Math.trunc(current);
            this.maxShield = Math.max(this.statusDurations.shielded, Math.trunc(maxShield));
        }
    }

    /** CE Combat.c:1811-1819. Only reduces the shield and returns HP damage:
     * callers keep their own immunity, attribution and death ordering. */
    public absorbShieldDamage(amount: number): number {
        const shield = this.getStatusDuration('shielded');
        if (amount <= 0 || shield <= 0) return amount;
        if (shield > amount * 10) {
            this.statusDurations.shielded = shield - amount * 10;
            return 0;
        }
        this.setStatusDuration('shielded', 0);
        return amount - Math.ceil(shield / 10);
    }

    /**
     * 旗标派生的永久状态不随回合衰减。CE updateMonsterStatus 只在生物不带
     * 对应旗标时才递减 STATUS_LEVITATING / STATUS_IMMUNE_TO_FIRE
     * （Monsters.c:1852-1856、1963-1967），Monster 覆写本钩子复刻该条款。
     */
    protected isStatusPermanent(_id: StatusId): boolean { return false; }

    public tickStatuses(): StatusId[] {
        const expired: StatusId[] = [];
        const entries = Object.entries(this.statusDurations) as Array<[StatusId, number]>;
        for (const [id, turns] of entries) {
            if (this.isStatusPermanent(id)) continue;
            // CE Time.c:2310 / Monsters.c:1958: integer division; a max below
            // 20 really has zero decay. Damage alone does not reduce maxShield.
            const next = turns - (id === 'shielded' ? Math.floor(this.maxShield / 20) : 1);
            if (next <= 0) {
                this.setStatusDuration(id, 0);
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

    public takeDamage(amount: number, ignoresProtectionShield = false) {
        this.hp -= ignoresProtectionShield ? amount : this.absorbShieldDamage(amount);
        if (this.hp <= 0) {
            this.die();
        }
    }

    protected die() {
        // P1-24 死亡收口：CE killCreature 最后把 currentHP 归零（Combat.c:2042），
        // 并靠 MB_IS_DYING|MB_HAS_DIED 位幂等（Combat.c:1938-1941）。web 没有
        // bookkeeping 位，hp<=0 本身就是"已死"判据——triggerDeathFeatures、
        // playerTurnEnded 清扫、takeTurn 早退、checkEntity 消息闸全部以此为
        // 准，归零后这些下游恰好各结算一次。此前只改外观不归零，深水/熔岩
        // 分支（applyEnvironmentalEffects 把 die() 当唯一致死手段）杀死的
        // 怪物满血赖在 this.monsters 里，死亡消息每回合重播。
        this.hp = 0;
        this.char = '%';
        this.color = 0x880000;
    }
}
