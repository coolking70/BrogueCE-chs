import { Item, ItemCategory } from './Item';

const duplicateCategories = new Set([
    ItemCategory.STAFF, ItemCategory.WAND, ItemCategory.POTION, ItemCategory.SCROLL,
    ItemCategory.RING, ItemCategory.WEAPON, ItemCategory.ARMOR, ItemCategory.CHARM,
]);
const throwingKinds = new Set(['dart', 'incendiary_dart', 'javelin']);

/** CE Architect.c:441-453 and 1506-1510. Identity comes from construction, never names. */
export function machineItemRejections(item: Item, qualifiers: readonly string[], previous: readonly Item[]): string[] {
    const reasons: string[] = [];
    if (item.isCursed) reasons.push('cursed');
    if (qualifiers.includes('MF_REQUIRE_GOOD_RUNIC') && !item.runicType && !item.flags?.includes('ITEM_RUNIC')) reasons.push('runic');
    if (qualifiers.includes('MF_NO_THROWING_WEAPONS') && item.category === ItemCategory.WEAPON && item.quantity > 1) reasons.push('throwing');
    if (qualifiers.includes('MF_REQUIRE_HEAVY_WEAPON') && !(item.category === ItemCategory.WEAPON
        && !throwingKinds.has(item.identityId ?? '') && (item.strengthRequired ?? 0) > 15 && item.enchantment > 0)) reasons.push('heavy');
    const kind = item.identityId ?? item.consumableId;
    if (kind && duplicateCategories.has(item.category) && previous.some(prior => prior.category === item.category
        && (prior.identityId ?? prior.consumableId) === kind)) reasons.push('duplicate');
    return reasons;
}

/** CE generates first, then checks failsafe AFTER replacing: 1 + 1001 candidates.
 * Exhaustion retains the last candidate, even if rejected; it is not machine failure.
 * A null loader result is a web-only invalid request, propagated without retrying it.
 */
export function generateQualifiedMachineItem(generate: () => Item | null, qualifiers: readonly string[], previous: readonly Item[]): Item | null {
    let item = generate();
    let failsafe = 1000;
    while (item && machineItemRejections(item, qualifiers, previous).length) {
        item = generate();
        if (failsafe <= 0) break;
        failsafe--;
    }
    return item;
}
