import { ItemCategory, type Item } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';

export function kindIsKnown(kindId: string | undefined): boolean {
    return !kindId || ItemLoader.identifiedItems.has(kindId);
}

/** Shared presentation gates for inventory details and the discovery table. */
export function itemKnowledge(item: Item, context: { readonly equipped?: boolean; readonly omniscient?: boolean } = {}) {
    const kindId = item.consumableId ?? item.identityId;
    const flavored = [ItemCategory.POTION, ItemCategory.SCROLL, ItemCategory.STAFF, ItemCategory.WAND, ItemCategory.RING].includes(item.category);
    const equipment = [ItemCategory.WEAPON, ItemCategory.ARMOR, ItemCategory.RING].includes(item.category);
    const arcana = item.category === ItemCategory.STAFF || item.category === ItemCategory.WAND;
    const instanceKnown = !!context.omniscient || item.isIdentified;
    return {
        kindId,
        kindKnown: !!context.omniscient || !flavored || kindIsKnown(kindId),
        instanceKnown,
        polarityKnown: ItemLoader.isPolarityRevealed(kindId),
        magicDetected: item.magicDetected,
        capacityKnown: arcana && (instanceKnown || item.maxChargesKnown),
        // CE WAND's MAX_CHARGES_KNOWN reveals remaining uses, unlike STAFF.
        chargesKnown: arcana && (instanceKnown || (item.category === ItemCategory.WAND && item.maxChargesKnown)),
        runicKnown: (item.category === ItemCategory.WEAPON || item.category === ItemCategory.ARMOR)
            && (!!context.omniscient || item.runicKnown),
        curseKnown: equipment && (instanceKnown || item.magicDetected || !!context.equipped),
    };
}

export function discoverySuffix(category: ItemCategory, kindId: string): number {
    return ItemLoader.magicCharDiscoverySuffix({ category, identityId: kindId, consumableId: kindId } as Item);
}
