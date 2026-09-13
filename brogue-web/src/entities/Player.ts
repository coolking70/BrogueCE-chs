/**
 * src/entities/Player.ts
 * Player specific logic
 */

import { Creature, type StatusId } from './Creature';
import { Direction } from '../types';
import { Inventory } from '../engine/Items/Inventory';
import { Item, ItemCategory } from '../engine/Items/Item';

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
    public equippedRing: Item | null = null;
    public strength: number = 12;
    public lastMoveDirection: Direction | null = null;

    // Hunger Mechanics
    public nutrition: number = STOMACH_SIZE;
    public maxNutrition: number = STOMACH_SIZE;
    public hungerState: HungerState = 'normal';
    private hungerTransition: HungerState | null = null;
    /** Fractional HP carried between turns so maxHp/300 regen keeps full precision. */
    private regenCarry: number = 0;

    // Temporary status immunities from charm_of_protection
    public temporaryImmunities: Partial<Record<StatusId, number>> = {};

    constructor(x: number, y: number) {
        super(x, y, 'Player', '@', 0xFFFFFF);
        this.maxHp = 30;
        this.hp = 30;
        this.inventory = new Inventory();
    }

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
            this.equippedRing = item;
            return true;
        }
        return false;
    }

    public unequip(item: Item) {
        if (this.equippedWeapon?.id === item.id) this.equippedWeapon = null;
        if (this.equippedArmor?.id === item.id) this.equippedArmor = null;
        if (this.equippedRing?.id === item.id) this.equippedRing = null;
    }

    /** Hunger state entered this turn, or null if unchanged. Consumed once by the caller. */
    public consumeHungerTransition(): HungerState | null {
        const transition = this.hungerTransition;
        this.hungerTransition = null;
        return transition;
    }

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
