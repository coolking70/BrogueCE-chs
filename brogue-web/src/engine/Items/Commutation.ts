import { ItemCategory, type Item } from './Item';
import { ItemLoader } from './ItemLoader';
import { charmRechargeDelay, isCharmKind } from './CharmModel';

/** CE Rogue.h CAN_BE_SWAPPED excludes wands (despite dead wand branches in Items.c).
 * Throwing stacks share a quiver number and cannot be commuted. */
export function itemIsSwappable(item: Item): boolean {
    return [ItemCategory.WEAPON, ItemCategory.ARMOR, ItemCategory.STAFF,
        ItemCategory.CHARM, ItemCategory.RING].includes(item.category) && !item.quiverNumber;
}

export function enchantLevelKnown(item: Item): boolean {
    return item.isIdentified || (item.category === ItemCategory.STAFF && item.maxChargesKnown);
}

/** CE Items.c:1097-1150. Apply an absolute exchanged level to the existing Item
 * resources/knowledge model. false means the floor item shatters. No RNG. */
export function swapItemToEnchantLevel(item: Item, level: number, known: boolean): boolean {
    if ((item.category === ItemCategory.STAFF && level < 2)
        || (item.category === ItemCategory.CHARM && level < 1)) return false;
    if (item.category === ItemCategory.STAFF) {
        item.maxCharges = level;
        item.charges = Math.min(item.charges ?? 0, level);
    }
    if (item.category === ItemCategory.CHARM && isCharmKind(item.identityId)) {
        const percent = Math.trunc((item.cooldownRemaining ?? 0) * 100
            / charmRechargeDelay(item.identityId, item.enchantment));
        item.cooldownTurns = charmRechargeDelay(item.identityId, level);
        item.cooldownRemaining = Math.trunc(percent * item.cooldownTurns / 100);
    }
    item.identified = known;
    if (known) {
        if (item.category === ItemCategory.STAFF) item.maxChargesKnown = true;
    } else {
        item.maxChargesKnown = false;
        item.canBeIdentified = true;
        if (item.category === ItemCategory.WEAPON) item.charges = ItemLoader.WEAPON_KILLS_TO_AUTO_ID;
        if (item.category === ItemCategory.ARMOR) item.charges = ItemLoader.ARMOR_DELAY_TO_AUTO_ID;
        if (item.category === ItemCategory.RING) item.charges = ItemLoader.RING_DELAY_TO_AUTO_ID;
    }
    item.enchantment = level;
    // CE checkForDisenchantment: beneficial runes fade at E <= 0; harmful ones persist.
    const badRunes = item.category === ItemCategory.WEAPON ? ['mercy', 'plenty']
        : item.category === ItemCategory.ARMOR ? ['burden', 'vulnerability', 'immolation'] : [];
    if (level <= 0 && item.runicType && !badRunes.includes(item.runicType)) {
        item.runicType = undefined;
        item.runicKnown = false;
        item.flags = item.flags?.filter(f => !['ITEM_RUNIC', 'ITEM_RUNIC_HINTED', 'ITEM_RUNIC_IDENTIFIED'].includes(f));
    }
    if (level >= 0) item.isCursed = false;
    return true;
}
