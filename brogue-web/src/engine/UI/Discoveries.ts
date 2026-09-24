import { ItemCategory } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';
import { discoverySuffix, kindIsKnown } from './ItemKnowledge';

export interface DiscoveryRow { id: string; name: string; known: boolean; suffix: number; frequency?: number; description?: string }
export interface DiscoveryGroup { category: ItemCategory; label: string; rows: DiscoveryRow[]; known: number }

const CE_ORDER: Record<string, string[]> = {
    scrolls: ['scroll_of_enchantment','scroll_of_identify','scroll_of_teleportation','scroll_of_remove_curse','scroll_of_recharging','scroll_of_protect_armor','scroll_of_protect_weapon','scroll_of_sanctuary','scroll_of_magic_mapping','scroll_of_negation','scroll_of_shattering','scroll_of_discord','scroll_of_aggravate_monsters','scroll_of_summon_monsters'],
    rings: ['ring_of_clairvoyance','ring_of_stealth','ring_of_regeneration','ring_of_transference','ring_of_light','ring_of_awareness','ring_of_wisdom','ring_of_reaping'],
    potions: ['potion_of_life','potion_of_strength','potion_of_telepathy','potion_of_levitation','potion_of_detect_magic','potion_of_haste','potion_of_fire_immunity','potion_of_invisibility','potion_of_caustic_gas','potion_of_paralysis','potion_of_hallucination','potion_of_confusion','potion_of_incineration','potion_of_darkness','potion_of_descent','potion_of_creeping_death'],
    staffs: ['staff_of_lightning','staff_of_fire','staff_of_poison','staff_of_tunneling','staff_of_blinking','staff_of_entrancement','staff_of_obstruction','staff_of_discord','staff_of_conjuration','staff_of_healing','staff_of_haste','staff_of_protection'],
    wands: ['wand_of_teleportation','wand_of_slowness','wand_of_polymorphism','wand_of_negation','wand_of_domination','wand_of_beckoning','wand_of_plenty','wand_of_invisibility','wand_of_empowerment'],
};

// CE IO.c:4380-4393: scroll/ring | potion | staff/wand, each in table order.
export function getDiscoveries(): DiscoveryGroup[] {
    const tables = [
        [ItemCategory.SCROLL, 'scrolls', ItemLoader.scrolls],
        [ItemCategory.RING, 'rings', ItemLoader.rings],
        [ItemCategory.POTION, 'potions', ItemLoader.potions],
        [ItemCategory.STAFF, 'staffs', ItemLoader.staffs],
        [ItemCategory.WAND, 'wands', ItemLoader.wands],
    ] as const;
    return tables.map(([category, label, entries]) => {
        const rows = CE_ORDER[label]!.map(id => {
            const entry = entries.find(e => e.id === id);
            const known = !!entry && kindIsKnown(id);
            const called = !known && ItemLoader.callTitles.get(id);
            let appearance = '';
            if (category === ItemCategory.POTION) appearance = ItemLoader.potionFlavorMap.get(id)?.name ?? '';
            else if (category === ItemCategory.SCROLL) appearance = ItemLoader.scrollFlavorMap.get(id) ?? '';
            else appearance = ItemLoader.arcanaFlavorMap.get(id) ?? '';
            const trueName = entry && ('trueName' in entry ? entry.trueName : entry.name);
            return {
                id,
                name: known && trueName ? (ItemLoader.translateName(trueName) || trueName) : called ? `${appearance} (${called})` : appearance || '???',
                known,
                suffix: known ? 0 : entry ? discoverySuffix(category, id) : 0,
                frequency: known ? entry?.frequency : undefined,
                description: known ? (entry as { description?: string } | undefined)?.description : undefined,
            };
        });
        return { category, label, rows, known: rows.filter(row => row.known).length };
    });
}
