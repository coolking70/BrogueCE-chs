import { ItemCategory, type Item } from './Item';
import { WAND_INITIAL_RANGES } from './ArcanaInstance';

/** Only existing CE wand ranges have an enchanting increment. Retired invented
 * wands have no CE lower bound; don't invent one from their legacy capacity.
 */
export function canEnchantArcana(item: Item): boolean {
    if (!Number.isInteger(item.charges) || item.charges! < 0) return false;
    if (item.category === ItemCategory.STAFF) {
        return Number.isInteger(item.enchantment) && item.enchantment > 0;
    }
    return item.category === ItemCategory.WAND
        && !!WAND_INITIAL_RANGES[(item as Item & { identityId?: string }).identityId ?? ''];
}

/** CE Items.c:7860-7867 (ordinary scroll power = 1). No RNG, discovery or effects.
 * CE uses enchant1 itself as staff capacity. W-5 stores that capacity separately;
 * synchronize it to the new E without filling the existing charge deficit.
 */
export function enchantArcana(item: Item): boolean {
    if (!canEnchantArcana(item)) return false;
    if (item.category === ItemCategory.STAFF) {
        item.enchantment++;
        item.maxCharges = item.enchantment;
        item.charges!++;
        // This is 500/new E, NOT the 5000/new E recurring recharge duration.
        item.staffRechargeRemaining = Math.floor(500 / item.enchantment);
    } else {
        const id = (item as Item & { identityId: string }).identityId;
        item.charges! += WAND_INITIAL_RANGES[id]![0];
        // Wand maxCharges remains its initial count, not a cap on added uses.
    }
    item.isCursed = false; // Items.c:7892, common post-enchantment uncurse.
    return true;
}
