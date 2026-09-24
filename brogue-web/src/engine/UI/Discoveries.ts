import { ItemCategory } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';
import { discoverySuffix, kindIsKnown } from './ItemKnowledge';

export interface DiscoveryRow { id: string; name: string; known: boolean; suffix: number; percentage?: number }
export interface DiscoveryGroup { category: ItemCategory; label: string; rows: DiscoveryRow[] }

// CE table order. Entries absent from the web generation pool are omitted below.
const CE_ORDER: Record<string, string[]> = {
    scrolls: ['scroll_of_enchantment','scroll_of_identify','scroll_of_teleportation','scroll_of_remove_curse','scroll_of_recharging','scroll_of_protect_armor','scroll_of_protect_weapon','scroll_of_sanctuary','scroll_of_magic_mapping','scroll_of_negation','scroll_of_shattering','scroll_of_discord','scroll_of_aggravate_monsters','scroll_of_summon_monsters'],
    rings: ['ring_of_clairvoyance','ring_of_stealth','ring_of_regeneration','ring_of_transference','ring_of_light','ring_of_awareness','ring_of_wisdom','ring_of_reaping'],
    potions: ['potion_of_life','potion_of_strength','potion_of_telepathy','potion_of_levitation','potion_of_detect_magic','potion_of_haste','potion_of_fire_immunity','potion_of_invisibility','potion_of_poison','potion_of_paralysis','potion_of_hallucination','potion_of_confusion','potion_of_incineration','potion_of_darkness','potion_of_descent','potion_of_creeping_death'],
    staffs: ['staff_of_lightning','staff_of_fire','staff_of_poison','staff_of_tunneling','staff_of_blinking','staff_of_entrancement','staff_of_obstruction','staff_of_discord','staff_of_conjuration','staff_of_healing','staff_of_haste','staff_of_protection'],
    wands: ['wand_of_teleportation','wand_of_slowness','wand_of_polymorphism','wand_of_negation','wand_of_domination','wand_of_beckoning','wand_of_plenty','wand_of_invisibility','wand_of_empowerment'],
};

// IO.c printDiscoveries: one denominator per category, containing only unidentified kinds.
export function getDiscoveries(): DiscoveryGroup[] {
    const tables = [
        [ItemCategory.SCROLL, 'scrolls', ItemLoader.genScrolls],
        [ItemCategory.RING, 'rings', ItemLoader.genRings],
        [ItemCategory.POTION, 'potions', ItemLoader.genPotions],
        [ItemCategory.STAFF, 'staffs', ItemLoader.genStaffs],
        [ItemCategory.WAND, 'wands', ItemLoader.genWands],
    ] as const;
    return tables.map(([category, label, entries]) => {
        const byId = new Map(entries.map(entry => [entry.id, entry]));
        const ordered = CE_ORDER[label]!.map(id => byId.get(id)).filter((entry): entry is (typeof entries)[number] => !!entry);
        const totalFrequency = ordered.reduce((sum, entry) => sum + (kindIsKnown(entry.id) ? 0 : entry.frequency ?? 0), 0);
        const rows = ordered.map(entry => {
            const known = kindIsKnown(entry.id);
            const frequency = entry.frequency ?? 0;
            const trueName = 'trueName' in entry ? entry.trueName : entry.name;
            return {
                id: entry.id,
                name: trueName.toUpperCase(),
                known,
                suffix: known ? 0 : discoverySuffix(category, entry.id),
                percentage: !known && frequency > 0 && totalFrequency > 0
                    ? Math.floor(frequency * 100 / totalFrequency) : undefined,
            };
        });
        return { category, label, rows };
    });
}
