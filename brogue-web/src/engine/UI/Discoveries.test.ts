import { afterEach, expect, it } from 'vitest';
import { ItemLoader } from '../Items/ItemLoader';
import { getDiscoveries } from './Discoveries';
import { generateItemDetail } from './DetailGenerator';

const oldKnown = ItemLoader.identifiedItems;
const oldCalls = ItemLoader.callTitles;
afterEach(() => { ItemLoader.identifiedItems = oldKnown; ItemLoader.callTitles = oldCalls; });

it('uses the five CE tables and their row counts without revealing unknown identities', () => {
    ItemLoader.identifiedItems = new Set();
    ItemLoader.callTitles = new Map();
    const groups = getDiscoveries();
    expect(groups.map(g => [g.label, g.rows.length])).toEqual([
        ['scrolls', 14], ['rings', 8], ['potions', 16], ['staffs', 12], ['wands', 9],
    ]);
    const life = groups[2]!.rows[0]!;
    expect(life.known).toBe(false);
    expect(life.name).not.toContain('Life');
    expect(life.description).toBeUndefined();
    expect(life.frequency).toBeUndefined();
    ItemLoader.callTitles.set('potion_of_life', 'test name');
    expect(getDiscoveries()[2]!.rows[0]!.name).toContain('test name');
    ItemLoader.identifiedItems.add('potion_of_life');
    const known = getDiscoveries()[2]!.rows[0]!;
    expect(known.known).toBe(true);
    expect(known.name).toContain('Life');
    expect(known.description).toBeTruthy();
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
