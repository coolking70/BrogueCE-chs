import { ItemCategory as C, type Item } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';
import { itemKnowledge } from './ItemKnowledge';
import type { ItemDetailContext } from './ItemDetailContext';
import type { DetailSection } from './DetailGenerator';
import { detailText } from './ItemDetailText';

/** One catalogue path for fresh and restored instances; KEY currently lacks an
 * identityId, so its existing localized name is the fallback lookup. */
export function itemDetailCatalog(item: Item) {
    const tables = {
        [C.WEAPON]: ItemLoader.weapons, [C.ARMOR]: ItemLoader.armors,
        [C.POTION]: ItemLoader.potions, [C.SCROLL]: ItemLoader.scrolls,
        [C.FOOD]: ItemLoader.food, [C.STAFF]: ItemLoader.staffs,
        [C.WAND]: ItemLoader.wands, [C.RING]: ItemLoader.rings,
        [C.CHARM]: ItemLoader.charms, [C.KEY]: ItemLoader.keys, [C.AMULET]: ItemLoader.amulets,
    };
    const rows = tables[item.category as keyof typeof tables];
    const id = item.consumableId ?? item.identityId;
    return rows?.find(row => id ? row.id === id
        : ItemLoader.translateName('trueName' in row ? row.trueName : row.name) === item.name);
}

export function itemIntro(item: Item, ctx: ItemDetailContext): DetailSection[] {
    const k = itemKnowledge(item, ctx), rows: DetailSection[] = [];
    const add = (text: string) => { if (text) rows.push({ lines: [{ text, color: '#aaaacc' }] }); };
    const catalog = itemDetailCatalog(item);
    if (!k.kindKnown) {
        const id = k.kindId ?? '';
        let flavor = item.category === C.POTION ? ItemLoader.potionFlavorMap.get(id)?.name
            : item.category === C.SCROLL ? ItemLoader.scrollFlavorMap.get(id)
            : ItemLoader.arcanaFlavorMap.get(id);
        // The web flavor maps store complete display names for these two
        // categories; CE's intro interpolates the color/title alone.
        if (item.category === C.POTION) flavor = flavor?.replace(/药水$| Potion$/i, '');
        if (item.category === C.SCROLL) flavor = flavor?.replace(/^题为「(.*)」的卷轴$/, '$1');
        // Never substitute item.name/description here: those carry true identity.
        add(detailText('unknown.' + C[item.category].toLowerCase(), { flavor: flavor ?? detailText('unknown.material') }));
    } else if (item.category === C.GOLD) {
        add(detailText('gold', { count: item.quantity }));
    } else if (item.category === C.GEM) {
        add(detailText('gem'));
    } else if (item.category === C.AMULET) {
        add(detailText('amulet'));
    } else {
        const id = catalog?.id ?? k.kindId;
        const description = id ? detailText('intro.' + id) : '';
        add(description || catalog?.description || item.description || detailText('generic.' + C[item.category].toLowerCase()));
    }
    if (ctx.carried && (item.originDepth ?? 0) > 0) {
        add(detailText(item.category !== C.KEY && item.flags?.includes('ITEM_IS_KEY') ? 'origin.vault' : 'origin.floor', { depth: item.originDepth! }));
    }
    if (item.category === C.POTION && k.kindKnown && k.kindId === 'potion_of_life' && ctx.maxHp && ctx.maxHp > 0) {
        add(detailText('life', { percent: Math.trunc((ctx.maxHp + 10) * 100 / ctx.maxHp) - 100 }));
    }
    if (item.category === C.FOOD && ctx.nutrition !== undefined && ctx.maxNutrition !== undefined) {
        const power = ItemLoader.food.find(f => f.id === item.consumableId)?.nutrition;
        if (power !== undefined) add(detailText(ctx.maxNutrition - ctx.nutrition >= power ? 'food.hungry' : 'food.full'));
    }
    // A detected instance can show its observed polarity, but the global kind
    // discovery must not inspect another wand's hidden remaining charges.
    if (k.magicDetected || k.polarityKnown) {
        const polarity = k.magicDetected ? ItemLoader.itemMagicPolarity(item) : ItemLoader.kindPolarity(k.kindId);
        if (polarity) add(detailText(polarity > 0 ? 'magic.good' : 'magic.bad'));
    }
    return rows;
}

export function itemEquipmentState(item: Item, ctx: ItemDetailContext): DetailSection[] {
    if (![C.WEAPON, C.ARMOR, C.RING].includes(item.category)) return [];
    const k = itemKnowledge(item, ctx), lines = [];
    if (ctx.equipped) {
        lines.push({ text: detailText('equipped.' + C[item.category].toLowerCase()) });
        if (item.isCursed) lines.push({ text: detailText('curse.equipped'), color: '#ff4444' });
    } else if (k.curseKnown && item.isCursed) {
        lines.push({ text: detailText('curse.known'), color: '#ff4444' });
    }
    return lines.length ? [{ lines }] : [];
}
