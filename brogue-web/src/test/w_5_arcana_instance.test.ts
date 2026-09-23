import { afterEach, describe, expect, it, vi } from 'vitest';
import { rollStaffEnchantment, rollWandCharges, WAND_INITIAL_RANGES } from '../engine/Items/ArcanaInstance';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { ItemCategory, type Item } from '../engine/Items/Item';
import { Game, type GameSnapshotItem } from '../engine/Core/Game';
import { Random, rng } from '../engine/Random';
import { createHeadlessGame } from './harness';

afterEach(() => vi.restoreAllMocks());
const bridge = (g: Game) => g as unknown as {
    serializeItem(item: Item): GameSnapshotItem;
    deserializeItem(item: GameSnapshotItem): Item;
    spawnKindById(category: ItemCategory, id: string, pos: { x: number; y: number }, depth: number): Item;
    generateDepth(up: boolean, first: boolean): void;
};
const state = (it: Item) => [it.arcanaInstanceVersion, it.enchantment, it.maxCharges, it.charges];

describe('W-5 CE initial resources, independent E and charges', () => {
    it.each([
        [[50], 2], [[49, 15], 3], [[49, 14, 10], 4],
        [[49, 14, 9, 10], 5], [[0, 0, 0, 0, 0, 99], 7],
    ] as const)('CE staff conditional draws / exact threshold sequence %j -> E=%i', (rolls, e) => {
        const random = new Random(1);
        const draw = vi.spyOn(random, 'randRange');
        for (const r of rolls) draw.mockReturnValueOnce(r);
        expect(rollStaffEnchantment(random)).toBe(e);
        expect(draw.mock.calls).toEqual(rolls.map(() => [0, 99]));
    });

    it('50,000 staff draws follow CE 50% / 42.5% / 6.75% / 0.675%, including tail >5', () => {
        const random = new Random(20260923), counts: Record<number, number> = {};
        for (let n = 0; n < 50000; n++) {
            const e = rollStaffEnchantment(random);
            counts[e] = (counts[e] ?? 0) + 1;
        }
        for (const [e, lo, hi] of [[2, 24000, 26000], [3, 20250, 22250], [4, 3000, 3750], [5, 230, 450]]) {
            expect(counts[e!]!).toBeGreaterThan(lo!);
            expect(counts[e!]!).toBeLessThan(hi!);
        }
        expect(Object.keys(counts).some(e => Number(e) > 5)).toBe(true);
    });

    it.each([
        ['wand_of_teleportation', 3, 5], ['wand_of_slowness', 2, 5],
        ['wand_of_beckoning', 2, 4], ['wand_of_invisibility', 3, 5], ['wand_of_empowerment', 1, 1],
    ] as const)('%s uses its inclusive CE range, endpoints and actual RNG footprint', (id, lo, hi) => {
        expect(WAND_INITIAL_RANGES[id]).toEqual([lo, hi, 1]);
        const random = new Random(111), counts = new Map<number, number>();
        for (let i = 0; i < 10000; i++) {
            const v = rollWandCharges(id, 99, random);
            counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        expect([...counts.keys()].sort()).toEqual(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
        for (const count of counts.values()) expect(Math.abs(count - 10000 / counts.size)).toBeLessThan(250);
        expect(random.randomNumbersGenerated).toBe(lo === hi ? 0 : 10000);
    });

    it('every existing CE staff spawns full with E=capacity; consumption changes current charges only', () => {
        for (const cfg of ItemLoader.genStaffs) {
            const it = ItemLoader.spawnStaff(cfg.id, 4, 5)!;
            expect(it.enchantment).toBeGreaterThanOrEqual(2);
            expect(state(it)).toEqual([1, it.enchantment, it.enchantment, it.enchantment]);
            const e = it.enchantment;
            it.charges!--;
            expect([it.enchantment, it.maxCharges, it.charges]).toEqual([e, e, e - 1]);
            expect([it.rechargeTurns, it.rechargeCounter]).toEqual([cfg.rechargeTurns, 0]);
        }
    });

    it('retired direct constructions remain available with fixed capacity and no initial draw', () => {
        const before = JSON.stringify(rng);
        for (const [id, n] of [['wand_of_fire', 2], ['wand_of_lightning', 2], ['staff_of_light', 4]] as const) {
            const it = id.startsWith('wand') ? ItemLoader.spawnWand(id, 0, 0)! : ItemLoader.spawnStaff(id, 0, 0)!;
            expect([it.maxCharges, it.charges]).toEqual([n, n]);
        }
        expect(JSON.stringify(rng)).toBe(before);
        expect(ItemLoader.spawnStaff('staff_of_blinking', 0, 0)).toBeNull();
        expect(ItemLoader.spawnWand('wand_of_polymorphism', 0, 0)).not.toBeNull(); // W-24 catalog entry
    });

    it('staff pool stays unchanged; W-24 closes the nine CE wand identities/frequencies', () => {
        expect(ItemLoader.genStaffs.map(x => [x.id, x.frequency])).toEqual([
            ['staff_of_fire', 15], ['staff_of_lightning', 15], ['staff_of_poison', 10],
            ['staff_of_healing', 5], ['staff_of_haste', 5], ['staff_of_conjuration', 8],
        ]);
        expect(ItemLoader.genWands.map(x => [x.id, x.frequency])).toEqual([
            ['wand_of_teleportation', 3], ['wand_of_slowness', 3], ['wand_of_polymorphism', 3],
            ['wand_of_negation', 3], ['wand_of_domination', 1], ['wand_of_beckoning', 3],
            ['wand_of_plenty', 2], ['wand_of_invisibility', 3], ['wand_of_empowerment', 1],
        ]);
        expect([ItemLoader.staffs.length, ItemLoader.wands.length]).toEqual([7, 11]);
    });

    it('ordinary generation dispatch uses the same initial draw (not a second roll)', () => {
        const g = bridge(Object.create(Game.prototype));
        for (const id of ['staff_of_poison', 'wand_of_slowness']) {
            rng.seedRandomGenerator(12345);
            const direct = id.startsWith('staff') ? ItemLoader.spawnStaff(id, 3, 4)! : ItemLoader.spawnWand(id, 3, 4)!;
            const after = JSON.stringify(rng);
            rng.seedRandomGenerator(12345);
            const dispatched = g.spawnKindById(id.startsWith('staff') ? ItemCategory.STAFF : ItemCategory.WAND, id, { x: 3, y: 4 }, 12);
            expect(state(dispatched)).toEqual(state(direct));
            expect(JSON.stringify(rng)).toBe(after);
        }
    });
});

describe('W-5 deterministic persistence / migration', () => {
    it('actual deserializer migrates depleted legacy capacities without touching either RNG stream or spawns', () => {
        const g = bridge(Object.create(Game.prototype));
        const source = ItemLoader.spawnStaff('staff_of_lightning', 1, 2)!;
        const saved = g.serializeItem(source);
        delete saved.arcanaInstanceVersion;
        saved.enchantment = 0;
        const before = JSON.stringify(rng);
        vi.spyOn(rng, 'randRange').mockImplementation(() => { throw Error('migration must not draw'); });
        vi.spyOn(rng, 'randPercent').mockImplementation(() => { throw Error('migration must not draw'); });
        vi.spyOn(rng, 'randClumpedRange').mockImplementation(() => { throw Error('migration must not draw'); });
        vi.spyOn(ItemLoader, 'spawnStaff').mockImplementation(() => { throw Error('migration must not spawn'); });
        vi.spyOn(ItemLoader, 'spawnWand').mockImplementation(() => { throw Error('migration must not spawn'); });
        for (const capacity of [2, 3, 4, 8]) for (const charges of [0, 1, capacity]) {
            const it = g.deserializeItem({ ...saved, maxCharges: capacity, charges });
            expect(state(it)).toEqual([1, capacity, capacity, charges]);
            expect(state(g.deserializeItem(g.serializeItem(it)))).toEqual(state(it));
        }
        expect(state(g.deserializeItem({ ...saved, maxCharges: undefined, charges: 0 }))).toEqual([1, 2, 2, 0]);
        for (const cfg of ItemLoader.staffs) {
            expect(state(g.deserializeItem({ ...saved, identityId: cfg.id, maxCharges: undefined, charges: 0 })))
                .toEqual([1, cfg.maxCharges, cfg.maxCharges, 0]);
        }
        // A versioned E is authoritative, including zero; do not infer E from capacity.
        expect(state(g.deserializeItem({ ...saved, arcanaInstanceVersion: 1, enchantment: 0, maxCharges: 8, charges: 1 })))
            .toEqual([1, 0, 8, 1]);
        const wand = { ...saved, category: ItemCategory.WAND, identityId: 'wand_of_teleportation', maxCharges: 4, charges: 0 };
        expect(state(g.deserializeItem(wand))).toEqual([1, 0, 4, 0]);
        expect(state(g.deserializeItem({ ...wand, maxCharges: undefined, charges: undefined }))).toEqual([1, 0, 4, 4]);
        expect(JSON.stringify(rng)).toBe(before);
    });

    it('versioned JSON snapshot preserves independent E, capacity, depletion and unknown-state flags on ground / in pack', () => {
        const game = createHeadlessGame(42);
        const staff = ItemLoader.spawnStaff('staff_of_poison', -1, -1)!;
        Object.assign(staff, { enchantment: 8, maxCharges: 8, charges: 1, rechargeCounter: 17, maxChargesKnown: true });
        game.player.inventory.items.push(staff);
        const wand = ItemLoader.spawnWand('wand_of_slowness', 5, 5)!;
        Object.assign(wand, { charges: 0, timesUsed: 3 });
        game.items.push(wand);
        const saved = JSON.parse(JSON.stringify(game.toSnapshot()));
        expect(game.loadSnapshot(saved)).toBe(true);
        const loadedStaff = game.player.inventory.items.find(i => i.id === staff.id)!;
        const loadedWand = game.items.find(i => i.id === wand.id)!;
        expect(state(loadedStaff)).toEqual([1, 8, 8, 1]);
        expect([loadedStaff.identified, loadedStaff.maxChargesKnown, loadedStaff.rechargeCounter]).toEqual([false, true, 17]);
        expect(state(loadedWand)).toEqual(state(wand));
        expect(loadedWand.timesUsed).toBe(3);
        // Same full loader with unversioned pack/ground entries: original capacity supplies E.
        for (const s of [...saved.player.inventory, ...saved.items]) {
            delete s.arcanaInstanceVersion;
            if (s.category === ItemCategory.STAFF) s.enchantment = 0;
        }
        expect(game.loadSnapshot(saved)).toBe(true);
        expect(state(game.player.inventory.items.find(i => i.id === staff.id)!)).toEqual([1, 8, 8, 1]);
        expect(state(game.items.find(i => i.id === wand.id)!)).toEqual(state(wand));
    });
});

it('W-5 generated results: 10 fixed seeds (W-24 coverage supplements) × D1–26 retain category coverage and obey initial per-kind values', () => {
    const categories = new Set<ItemCategory>(), kinds = new Set<string>();
    for (const seed of [42, 12345, 20250308, 999, 1, 7, 20260914, 20260923, 424242, 20260913]) {
        const game = createHeadlessGame(seed);
        for (let depth = 1; depth <= 26; depth++) {
            if (depth > 1) { game.depth = depth; bridge(game).generateDepth(false, false); }
            for (const it of game.items) {
                categories.add(it.category);
                if (it.category !== ItemCategory.STAFF && it.category !== ItemCategory.WAND) continue;
                const id = (it as any).identityId as string;
                kinds.add(id);
                expect(it.arcanaInstanceVersion).toBe(1);
                expect(it.charges).toBe(it.maxCharges);
                if (it.category === ItemCategory.STAFF) {
                    expect(it.enchantment).toBeGreaterThanOrEqual(2);
                    expect(it.enchantment).toBe(it.maxCharges);
                } else {
                    const [lo, hi] = WAND_INITIAL_RANGES[id]!;
                    expect(it.charges).toBeGreaterThanOrEqual(lo);
                    expect(it.charges).toBeLessThanOrEqual(hi);
                }
            }
        }
    }
    expect([...categories].sort()).toEqual(Object.values(ItemCategory).filter(x => typeof x === 'number').sort());
    expect([...kinds].sort()).toEqual([...ItemLoader.genStaffs, ...ItemLoader.genWands].map(x => x.id).sort());
});
