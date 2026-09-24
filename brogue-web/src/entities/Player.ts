/**
 * src/entities/Player.ts
 * Player specific logic
 */

import { Creature, type StatusId } from './Creature';
import { Direction } from '../types';
import { Inventory } from '../engine/Items/Inventory';
import { Item, ItemCategory } from '../engine/Items/Item';
import { rng } from '../engine/Random';

// Hunger/regen constants aligned with Brogue CE (Rogue.h:1123-1127)
export const TURNS_FOR_FULL_REGEN = 300; // Rogue.h:1123
export const STOMACH_SIZE = 2150; // Rogue.h:1124
export const HUNGER_THRESHOLD = STOMACH_SIZE - 1800; // 350, Rogue.h:1125
export const WEAK_THRESHOLD = 150; // Rogue.h:1126
export const FAINT_THRESHOLD = 50; // Rogue.h:1127

export type HungerState = 'normal' | 'hungry' | 'weak' | 'faint' | 'starving';

export class Player extends Creature {
    public inventory: Inventory;
    public equippedWeapon: Item | null = null;
    public equippedArmor: Item | null = null;
    /**
     * B-1b：戒指双槽（CE rogue.ringLeft/ringRight，Rogue.h:2461-2462；装备分配
     * Items.c:8560-8566——左槽优先、双占时 equipItem 返回 false）。原单槽
     * equippedRing 删除；U01 存档直接保存双槽 ID，不迁移单槽旧档。
     */
    public ringLeft: Item | null = null;
    public ringRight: Item | null = null;
    public strength: number = 12;
    public lastMoveDirection: Direction | null = null;

    // Hunger Mechanics
    public nutrition: number = STOMACH_SIZE;
    public maxNutrition: number = STOMACH_SIZE;
    public hungerState: HungerState = 'normal';
    private hungerTransition: HungerState | null = null;
    /** Fractional HP carried between turns so maxHp/300 regen keeps full precision. */
    public regenCarry: number = 0; // persisted; poison pauses rather than discards the fraction

    // Temporary status immunities from charm_of_protection
    public temporaryImmunities: Partial<Record<StatusId, number>> = {};

    constructor(x: number, y: number) {
        super(x, y, 'Player', '@', 0xFFFFFF);
        this.maxHp = 30;
        this.hp = 30;
        this.inventory = new Inventory();
    }

    public snapshotHungerTransition(): HungerState | null { return this.hungerTransition; }
    public restoreHungerTransition(value: HungerState | null): void { this.hungerTransition = value; }

    /** Tick down temporary immunities, returns list of expired ones. */
    public tickTemporaryImmunities(): StatusId[] {
        const expired: StatusId[] = [];
        for (const [id, turns] of Object.entries(this.temporaryImmunities) as [StatusId, number][]) {
            const next = turns - 1;
            if (next <= 0) {
                delete this.temporaryImmunities[id];
                expired.push(id);
            } else {
                this.temporaryImmunities[id] = next;
            }
        }
        return expired;
    }

    /** Grant a temporary immunity for a given status for N turns. */
    public grantTemporaryImmunity(id: StatusId, turns: number) {
        const existing = this.temporaryImmunities[id] ?? 0;
        this.temporaryImmunities[id] = Math.max(existing, turns);
    }


    public equip(item: Item): boolean {
        if (item.category === ItemCategory.WEAPON) {
            this.equippedWeapon = item;
            return true;
        } else if (item.category === ItemCategory.ARMOR) {
            this.equippedArmor = item;
            return true;
        } else if (item.category === ItemCategory.RING) {
            // CE Items.c:8560-8566：左槽优先；双占时拒绝（"no available ring slot"）
            if (this.ringLeft && this.ringRight) return false;
            if (this.ringLeft) {
                this.ringRight = item;
            } else {
                this.ringLeft = item;
            }
            return true;
        }
        return false;
    }

    public unequip(item: Item) {
        if (this.equippedWeapon?.id === item.id) this.equippedWeapon = null;
        if (this.equippedArmor?.id === item.id) this.equippedArmor = null;
        if (this.ringLeft?.id === item.id) this.ringLeft = null;
        if (this.ringRight?.id === item.id) this.ringRight = null;
    }

    /** 两枚戴着的戒指（护甲/武器另行），供遍历熟悉度与戒指效果的调用方使用。 */
    public rings(): Item[] {
        const out: Item[] = [];
        if (this.ringLeft) out.push(this.ringLeft);
        if (this.ringRight) out.push(this.ringRight);
        return out;
    }

    /** Hunger state entered this turn, or null if unchanged. Consumed once by the caller. */
    public consumeHungerTransition(): HungerState | null {
        const transition = this.hungerTransition;
        this.hungerTransition = null;
        return transition;
    }

    /**
     * 客观时间块调用（每 100 tick 一次；CE decrementPlayerStatus 的营养段，
     * Time.c:2213-2220——营养递减与 checkNutrition 都在客观块内）：
     * 营养 -1 并更新饥饿档位、记录跨档。
     * CE 守卫照搬：麻痹时不耗营养；携带任意护符（AMULET）时仅 20% 概率消耗
     * （Time.c:2214-2219，无护符短路不掷骰）。
     */
    public tickNutrition(): HungerState {
        this.hungerTransition = null;

        if (!this.hasStatus('paralyzed')) {
            if (this.nutrition > 0) {
                const hasAmulet = this.inventory.items.some(i => i.category === ItemCategory.AMULET);
                if (!hasAmulet || rng.randPercent(20)) {
                    this.nutrition -= 1;
                }
            }
        }

        const prevState = this.hungerState;
        const nextState = this.computeHungerState();
        if (nextState !== prevState) {
            this.hungerTransition = nextState;
        }
        this.hungerState = nextState;
        return nextState;
    }

    /**
     * 主观收尾调用（每玩家动作一次；CE Time.c:2523-2541 playerTurnEnded 的
     * do 循环段）：饥饿伤害与回血都是每玩家动作结算，不随客观块加倍。
     * 返回 'starving' 表示本动作发生了饥饿扣血（供 lastDamageSource 归因）。
     */
    public recoverPerTurn(suppressRegen = false): HungerState {
        if (this.hp <= 0) return 'normal';
        // Starvation: nutrition exhausted, 1 HP lost per turn (Time.c:2525-2530)
        if (this.nutrition <= 0) {
            this.hp -= 1;
            return 'starving';
        }

        // Regeneration: full pool in TURNS_FOR_FULL_REGEN turns; halted while poisoned
        // and while already at full HP (Time.c:2531-2541)
        if (this.hp < this.maxHp && !this.hasStatus('poisoned') && !suppressRegen) {
            this.regenCarry += this.regenRatePerTurn();
            if (this.regenCarry >= 1) {
                const wholeHp = Math.floor(this.regenCarry);
                this.hp = Math.min(this.maxHp, this.hp + wholeHp);
                this.regenCarry -= wholeHp;
                if (this.hp >= this.maxHp) {
                    this.regenCarry = 0;
                }
            }
        }

        return 'normal';
    }

    /**
     * @deprecated P2-3 起引擎侧拆分为 tickNutrition（客观）+ recoverPerTurn（主观）。
     * 本方法仅供既有测试（hunger_regen.test.ts 对裸 Player 的直接调用）保持原语义，
     * 引擎代码不得再调用。
     */
    public updateNutrition(): HungerState {
        this.hungerTransition = null;

        // No nutrition below zero; starvation damage is handled instead (Time.c:2215-2218)
        if (this.nutrition > 0) {
            this.nutrition -= 1;
        }

        const prevState = this.hungerState;
        const nextState = this.computeHungerState();
        if (nextState !== prevState) {
            this.hungerTransition = nextState;
        }
        this.hungerState = nextState;

        // Starvation: nutrition exhausted, 1 HP lost per turn (Time.c:2525-2530)
        if (this.nutrition <= 0) {
            this.hp -= 1;
            return 'starving';
        }

        // Regeneration: full pool in TURNS_FOR_FULL_REGEN turns; halted while poisoned
        // and while already at full HP (Time.c:2531-2541)
        if (this.hp < this.maxHp && !this.hasStatus('poisoned')) {
            this.regenCarry += this.regenRatePerTurn();
            if (this.regenCarry >= 1) {
                const wholeHp = Math.floor(this.regenCarry);
                this.hp = Math.min(this.maxHp, this.hp + wholeHp);
                this.regenCarry -= wholeHp;
                if (this.hp >= this.maxHp) {
                    this.regenCarry = 0;
                }
            }
        }

        return 'normal';
    }

    /** maxHp / TURNS_FOR_FULL_REGEN HP per turn, so a full pool always takes 300 turns (Items.c:8735-8750). */
    private regenRatePerTurn(): number {
        const base = this.maxHp / TURNS_FOR_FULL_REGEN;
        // Web-only status kept as an aura, preserving its former 0.6x healing-time speedup
        return this.hasStatus('regenerating') ? base / 0.6 : base;
    }

    /** Thresholds are display/warning tiers only (IO.c:4785-4793); they never gate regen. */
    private computeHungerState(): HungerState {
        if (this.nutrition <= 0) return 'starving';
        if (this.nutrition <= FAINT_THRESHOLD) return 'faint';
        if (this.nutrition <= WEAK_THRESHOLD) return 'weak';
        if (this.nutrition <= HUNGER_THRESHOLD) return 'hungry';
        return 'normal';
    }
}
