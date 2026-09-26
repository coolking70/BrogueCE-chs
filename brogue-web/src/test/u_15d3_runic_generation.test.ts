import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Item, ItemCategory } from '../engine/Items/Item';
import { rng } from '../engine/Random';
import { Game } from '../engine/Core/Game';
import { serializeItem, deserializeItem } from '../engine/Core/EntitySnapshot';
import { generateItemDetail } from '../engine/UI/DetailGenerator';
import { machineItemRejections } from '../engine/Items/MachineItemGeneration';

// Independently compiled from this checkout's original CE branches/enums/tables.
// rand_range is an explicit recorded tape; production randPercent stays real.
const golden = JSON.parse(fs.readFileSync('ai_docs/reports/u-15d3-evidence/ce-golden.json', 'utf8'));
const webKind = (name: string) => name === 'plate armor' ? 'plate_mail' : name.replace(/ /g, '_');
const webRunic = (name: string) => name === 'paralysis' ? 'paralyzing' : name;
const runics = [golden.weaponRunics.map(webRunic), golden.armorRunics.map(webRunic)] as string[][];
const roundTrip = (item: Item) => deserializeItem(JSON.parse(JSON.stringify(serializeItem(item))));
const payload = (item: Item) => ({
    kind: item.identityId, e: item.enchantment, cursed: item.isCursed,
    runic: item.runicType, flags: item.flags, vorpal: item.vorpalEnemy,
    quantity: item.quantity, quiver: item.quiverNumber, charges: item.charges,
    strength: item.strengthRequired, known: item.runicKnown, identified: item.identified,
});
afterEach(() => vi.restoreAllMocks());

describe('U15d-3 original CE C oracle equipment lotteries', () => {
    it('maps every CE enum index, including all harmful runics, without holes or reordering', () => {
        expect(ItemLoader.WEAPON_RUNIC_BY_CE_INDEX).toEqual(runics[0]);
        expect(ItemLoader.ARMOR_RUNIC_BY_CE_INDEX).toEqual(runics[1]);
        expect(runics.map(r => r.length)).toEqual([10, 11]);
    });

    for (const category of [0, 1]) it(`${category === 0 ? 'weapon' : 'armor'}: every kind, probability boundary, threshold, pool and ordered RNG request`, () => {
        const seen = new Set<string>();
        for (const row of golden.cases.filter((c: any) => c.request.category === category)) {
            const { request: r, expected: e } = row;
            const kind = webKind(golden.kinds[category === 0 ? 'WEAPON' : 'ARMOR'][r.kind]);
            let cursor = 0;
            const draw = vi.spyOn(rng, 'randRange').mockImplementation((lo, hi) => {
                const call = e.draws[cursor++];
                expect([lo, hi], `${kind} ${r.label} draw ${cursor}`).toEqual(call?.slice(0, 2));
                return call[2];
            });
            const item = (category === 0 ? ItemLoader.spawnWeapon(kind, 0, 0, r.depth) : ItemLoader.spawnArmor(kind, 0, 0, r.depth))!;
            draw.mockRestore();
            expect(cursor, `${kind} ${r.label}`).toBe(e.draws.length);
            expect({ enchantment: item.enchantment, runicIndex: item.runicType ? runics[category]!.indexOf(item.runicType) : -1,
                isCursed: item.isCursed, vorpalIndex: item.vorpalEnemy ? golden.classes.findIndex((c: string[]) => c[0] === item.vorpalEnemy) : -1,
                quantity: item.quantity, quiverNumber: item.quiverNumber ?? 0, charges: item.charges, strength: item.strengthRequired,
            }, `${kind} ${r.label} ${r.tape}`).toEqual({ ...e, draws: undefined });
            expect(item.flags?.includes('ITEM_RUNIC') ?? false).toBe(e.runicIndex >= 0);
            expect(item.identified).toBe(false); expect(item.runicKnown).toBe(false);
            if (item.runicType) seen.add(item.runicType);
        }
        expect([...seen].sort()).toEqual([...runics[category]!].sort());
    });

    it('vorpalEnemy: every ticket at all maxDepth boundaries uses exactly one CE weighted draw', () => {
        for (const { request: r, expected: e } of golden.cases.filter((c: any) => c.request.category < 0)) {
            const draw = vi.spyOn(rng, 'randRange').mockReturnValue(e.draws[0][2]);
            expect(ItemLoader.chooseVorpalEnemy(r.depth)).toBe(golden.classes[e.vorpalIndex][0]);
            expect(draw.mock.calls).toEqual([e.draws[0].slice(0, 2)]);
            draw.mockRestore();
        }
    });

    it('bad pool implies negative enchant and curse; heavy weapons and plate cannot obtain a good runic', () => {
        for (const category of [0, 1]) for (const kind of (category === 0 ? ['broadsword', 'war_pike', 'war_hammer', 'war_axe'] : ['plate_mail'])) {
            const seen = new Set<string>();
            for (let seed = 1; seed <= 600; seed++) {
                rng.seedRandomGenerator(seed);
                const item = (category === 0 ? ItemLoader.spawnWeapon(kind, 0, 0) : ItemLoader.spawnArmor(kind, 0, 0))!;
                if (item.runicType) {
                    expect(runics[category]!.indexOf(item.runicType)).toBeGreaterThanOrEqual(8);
                    expect(item.enchantment).toBeLessThan(0); expect(item.isCursed).toBe(true);
                    seen.add(item.runicType);
                }
            }
            expect([...seen].sort()).toEqual(runics[category]!.slice(8).sort());
        }
    });

    it('ordinary birth → U01 JSON → hidden detail → identification → JSON preserves every generated runic', () => {
        for (const category of [0, 1]) {
            const seen = new Set<string>();
            for (let seed = 1; seed < 5000 && seen.size < runics[category]!.length; seed++) {
                rng.seedRandomGenerator(seed);
                const item = (category === 0 ? ItemLoader.spawnWeapon('dagger', 0, 0, 10) : ItemLoader.spawnArmor('leather_armor', 0, 0, 10))!;
                if (!item.runicType || seen.has(item.runicType)) continue;
                seen.add(item.runicType);
                const restored = roundTrip(item);
                expect(payload(restored)).toEqual(payload(item));
                const detail = () => generateItemDetail(restored, 12).sections.filter(s => s.header?.startsWith('附魔:'));
                expect(detail()).toHaveLength(0);
                ItemLoader.identifyInstance(restored);
                expect(restored.runicKnown).toBe(true); expect(detail(), item.runicType).toHaveLength(1);
                expect(detail()[0]!.lines[0]!.text).toBeTruthy();
                if (category === 0 && item.runicType === 'mercy') expect(detail()[0]!.lines[0]!.text).toContain('50%');
                expect(payload(roundTrip(restored))).toEqual(payload(restored));
            }
            expect([...seen].sort()).toEqual([...runics[category]!].sort());
        }
    });

    it('U05 Q requests retry the same complete birth; category draw, candidates, result and two RNG streams match', () => {
        const api = Object.create(Game.prototype) as any;
        for (const [category, kind] of [['WEAPON', 'dagger'], ['ARMOR', 'leather_armor']] as const) {
            const seen = new Set<string>();
            const make = () => category === 'WEAPON' ? ItemLoader.spawnWeapon(kind, 7, 8, 12)! : ItemLoader.spawnArmor(kind, 7, 8, 12)!;
            for (let seed = 1; seed <= 100; seed++) {
                rng.seedRandomGenerator(seed); const initial = rng.getState();
                const method = category === 'WEAPON' ? 'spawnWeapon' : 'spawnArmor';
                const spy = vi.spyOn(ItemLoader, method);
                const actual = api.spawnBlueprintItem(category, kind, 7, 8, 12, ['MF_REQUIRE_GOOD_RUNIC'], []);
                const calls = spy.mock.calls.length, end = rng.getState(); spy.mockRestore();
                rng.setState(initial);
                let expected: Item, attempts = 0;
                do {
                    // CE pickItemCategory also rolls for an explicit single category.
                    rng.randRange(1, category === 'WEAPON' ? 10 : 8);
                    expected = make(); attempts++;
                } while (machineItemRejections(expected, ['MF_REQUIRE_GOOD_RUNIC'], []).length && attempts < 1002);
                expect(calls).toBe(attempts); expect(payload(actual)).toEqual(payload(expected)); expect(rng.getState()).toEqual(end);
                expect(actual.isCursed).toBe(false); expect(actual.enchantment).toBeGreaterThan(0);
                expect(actual.flags).toContain('ITEM_RUNIC'); seen.add(actual.runicType);
                expect(payload(roundTrip(actual))).toEqual(payload(actual));
                expect(actual.category).toBe(category === 'WEAPON' ? ItemCategory.WEAPON : ItemCategory.ARMOR);
            }
            expect([...seen].sort()).toEqual(runics[category === 'WEAPON' ? 0 : 1]!.slice(0, 8).sort());
        }
    });
});
