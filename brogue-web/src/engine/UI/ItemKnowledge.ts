import { ItemCategory, type Item } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';

export function kindIsKnown(kindId: string | undefined): boolean {
    return !kindId || ItemLoader.identifiedItems.has(kindId);
}

/** Shared presentation gates for inventory details and the discovery table. */
export function itemKnowledge(item: Item) {
    const kindId = item.consumableId ?? item.identityId;
    return {
        kindId,
        kindKnown: kindIsKnown(kindId),
        instanceKnown: item.isIdentified,
        polarityKnown: ItemLoader.isPolarityRevealed(kindId),
        capacityKnown: item.isIdentified || item.maxChargesKnown,
        runicKnown: item.runicKnown,
    };
}

export function discoverySuffix(category: ItemCategory, kindId: string): number {
    return ItemLoader.magicCharDiscoverySuffix({ category, identityId: kindId, consumableId: kindId } as Item);
}
