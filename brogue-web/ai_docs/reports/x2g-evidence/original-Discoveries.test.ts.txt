import { afterEach, expect, it } from 'vitest';
import { ItemLoader } from '../Items/ItemLoader';
import { getDiscoveries } from './Discoveries';
import { generateItemDetail } from './DetailGenerator';

const oldKnown = ItemLoader.identifiedItems;
const oldCalls = ItemLoader.callTitles;
afterEach(() => { ItemLoader.identifiedItems = oldKnown; ItemLoader.callTitles = oldCalls; });

it('shows true names for the five CE tables and omits missing web kinds', () => {
    ItemLoader.identifiedItems = new Set();
    ItemLoader.callTitles = new Map();
    const groups = getDiscoveries();
    expect(groups.map(g => [g.label, g.rows.length])).toEqual([
        ['scrolls', 13], ['rings', 8], ['potions', 15], ['staffs', 12], ['wands', 9],
    ]);
    const life = groups[2]!.rows[0]!;
    expect(life.known).toBe(false);
    expect(life.name).toBe('POTION OF LIFE');
    expect(life.percentage).toBeUndefined();
    ItemLoader.callTitles.set('potion_of_life', 'test name');
    expect(getDiscoveries()[2]!.rows[0]!.name).toBe('POTION OF LIFE');
    ItemLoader.identifiedItems.add('potion_of_life');
    const known = getDiscoveries()[2]!.rows[0]!;
    expect(known.known).toBe(true);
    expect(known.name).toBe('POTION OF LIFE');
});

it('uses integer-truncated percentages among unidentified kinds only', () => {
    ItemLoader.identifiedItems = new Set();
    const initial = getDiscoveries();
    expect(initial[1]!.rows.map(row => row.percentage)).toEqual([12, 12, 12, 12, 12, 12, 12, 12]);
    expect(initial[0]!.rows[0]!.percentage).toBeUndefined(); // zero-frequency enchanting
    expect(initial[0]!.rows[1]!.percentage).toBe(20); // 30 / 143, truncated
    ItemLoader.identifiedItems.add('ring_of_clairvoyance');
    expect(getDiscoveries()[1]!.rows.map(row => row.percentage)).toEqual([undefined, 14, 14, 14, 14, 14, 14, 14]);
});

it('capacity knowledge does not expose a hidden staff enchantment through blink distance', () => {
    ItemLoader.identifiedItems = new Set(['staff_of_blinking']);
    const staff = ItemLoader.spawnStaff('staff_of_blinking', 0, 0)!;
    staff.identified = false;
    staff.maxChargesKnown = true;
    staff.enchantment = 2;
    const first = JSON.stringify(generateItemDetail(staff, 12));
    staff.enchantment = 4;
    expect(JSON.stringify(generateItemDetail(staff, 12))).toBe(first);
    expect(first).not.toContain('最多瞬移');
});
