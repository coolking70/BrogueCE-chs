/**
 * src/entities/Player.ts
 * Player specific logic
 */

import { Creature, type StatusId } from './Creature';
import { Direction } from '../types';
import { Inventory } from '../engine/Items/Inventory';
import { Item, ItemCategory } from '../engine/Items/Item';

export class Player extends Creature {
    public inventory: Inventory;
    public equippedWeapon: Item | null = null;
    public equippedArmor: Item | null = null;
    public equippedRing: Item | null = null;
    public strength: number = 12;
    public lastMoveDirection: Direction | null = null;

    // Hunger Mechanics
    public nutrition: number = 12000;
    public maxNutrition: number = 12000;
    private turnsSinceLastHeal: number = 0;

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

    public updateNutrition() {
        this.nutrition -= 1;

        // Healing logic based on nutrition
        this.turnsSinceLastHeal++;

        let healThreshold = 0;
        if (this.nutrition > 6000) {
            healThreshold = 10; // Satiated - heal every 10 turns
        } else if (this.nutrition > 2000) {
            healThreshold = 25; // Hungry - heal every 25 turns
        } else if (this.nutrition <= 0) {
            // Starving!
            if (this.turnsSinceLastHeal >= 10) {
                this.hp -= 1;
                this.turnsSinceLastHeal = 0;
                return 'starving';
            }
        }

        if (this.hasStatus('regenerating')) {
            healThreshold = Math.max(6, Math.floor(healThreshold * 0.6));
        }

        if (healThreshold > 0 && this.turnsSinceLastHeal >= healThreshold) {
            if (this.hp < this.maxHp) {
                this.hp += 1;
            }
            this.turnsSinceLastHeal = 0;
        }

        return 'normal';
    }
}
