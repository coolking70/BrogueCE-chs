import type { Item } from '../Items/Item';
import type { Player } from '../../entities/Player';
import { effectiveRingEnchant } from '../Items/RingBonuses';
import { itemKnowledge } from './ItemKnowledge';

/** A detached, knowledge-filtered view of the current equipment. No live Items. */
export interface KnownEquipment {
    readonly damage?: string;
    readonly armor?: number;
    readonly strengthRequired: number;
    readonly enchantment: number;
    readonly assumed: boolean;
}

/** CE itemDetails inputs. Missing context means omit the contextual paragraph,
 * never guess HP, nutrition, ownership, equipment, or historical information. */
export interface ItemDetailContext {
    readonly strength: number;
    readonly hp?: number;
    readonly maxHp?: number;
    readonly nutrition?: number;
    readonly maxNutrition?: number;
    readonly carried?: boolean;
    readonly equipped?: boolean;
    readonly weapon?: KnownEquipment | null;
    readonly armor?: KnownEquipment | null;
    readonly apparentRingBonuses?: Readonly<Record<string, number>>;
    readonly currentTurn?: number;
    /** R6: newest first, observed uses only; do not infer from recharge timers. */
    readonly knownStaffUses?: readonly number[];
    /** Explicit opt-in only; being in a replay does not imply omniscience. */
    readonly omniscient?: boolean;
}

function knownEquipment(item: Item | null): KnownEquipment | null {
    if (!item) return null;
    const known = itemKnowledge(item).instanceKnown;
    return Object.freeze({ damage: item.damage, armor: item.armor,
        strengthRequired: item.strengthRequired ?? 0,
        enchantment: known ? item.enchantment : 0, assumed: !known });
}

/** UI adapter uses existing public state only; no Game import or mutations. */
export function createItemDetailContext(
    world: { readonly player: Player; readonly absoluteTurnNumber: number }, item: Item,
): ItemDetailContext {
    const p = world.player;
    const bonuses: Record<string, number> = {};
    for (const ring of [p.ringLeft, p.ringRight]) {
        if (!ring?.identityId || !itemKnowledge(ring).kindKnown) continue;
        // CE apparentRingBonus: a known kind uses effectiveRingEnchant, including
        // a worn ring's observable negative effect and the unidentified + cap.
        bonuses[ring.identityId] = (bonuses[ring.identityId] ?? 0) + effectiveRingEnchant(ring);
    }
    return Object.freeze({ strength: p.effectiveStrength, hp: p.hp, maxHp: p.maxHp,
        nutrition: p.nutrition, maxNutrition: p.maxNutrition,
        carried: p.inventory.items.some(i => i.id === item.id),
        equipped: [p.equippedWeapon, p.equippedArmor, p.ringLeft, p.ringRight].some(i => i?.id === item.id),
        weapon: knownEquipment(p.equippedWeapon), armor: knownEquipment(p.equippedArmor),
        apparentRingBonuses: Object.freeze(bonuses), currentTurn: world.absoluteTurnNumber });
}
