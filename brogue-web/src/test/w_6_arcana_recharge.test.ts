import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game, type GameSnapshotItem } from '../engine/Core/Game';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { equippedWisdomBonus, ringWisdomRechargeIncrement, staffChargeDuration, tickStaffRecharge } from '../engine/Items/ArcanaRecharge';
import { Random, rng } from '../engine/Random';
import { generateItemDetail } from '../engine/UI/DetailGenerator';
import { logger } from '../engine/Systems/Logger';
import { createHeadlessGame } from './harness';

afterEach(() => vi.restoreAllMocks());
const bridge = (g: Game) => g as unknown as {
    tickArcanaResources(): void;
    rechargeStaffsAndCharms(): boolean;
    serializeItem(item: Item): GameSnapshotItem;
    deserializeItem(item: GameSnapshotItem): Item;
};
function staff(e = 3, charges = 0): Item {
    const item = new Item('Test Staff', '\\', 0xffffff, ItemCategory.STAFF);
    Object.assign(item, { arcanaInstanceVersion: 1, identityId: 'staff_of_lightning', enchantment: e, maxCharges: e, charges });
    return item;
}
function ring(e: number, identified = true, id = 'ring_of_wisdom'): Item {
    const item = ItemLoader.spawnRing(id, -1, -1)!;
    Object.assign(item, { enchantment: e, identified });
    return item;
}
function gameWith(...items: Item[]): Game {
    const game = createHeadlessGame(42, 'test');
    game.player.inventory.items = items;
    game.player.ringLeft = game.player.ringRight = null;
    game.monsters = [];
    return game;
}
const wait = (game: Game) => game.handlePlayerAction('wait', undefined, 'system');
const resources = (item: Item) => [item.enchantment, item.maxCharges, item.charges];

describe('W-6 CE E / wisdom / stochastic interval', () => {
    it.each([[2, 2500], [3, 1666], [8, 625]])('E=%i cycle=%i; exact truncated bounds and clump=3', (e, duration) => {
        const item = staff(e);
        item.staffRechargeRemaining = 7;
        const random = { randClumpedRange: vi.fn(() => 1000) };
        expect(staffChargeDuration(item)).toBe(duration);
        expect(tickStaffRecharge(item, 0, random)).toBe(1);
        expect(random.randClumpedRange.mock.calls[0]).toEqual([Math.floor(duration / 3), Math.floor(duration * 5 / 3), 3]);
        expect(item.staffRechargeRemaining).toBe(997); // overshoot is retained
        expect(resources(item)).toEqual([e, e, 1]);
    });

    it.each([[-99, 0], [-10, 0], [-2, 5], [-1, 7], [0, 10], [1, 12], [2, 16], [5, 37], [27, 11925], [99, 11925]])
    ('wisdom %i gives exactly %i recharge points per objective block', (e, n) => {
        expect(ringWisdomRechargeIncrement(e)).toBe(n);
    });

    it('initial 500-point delay is lazy and fixed; recurring intervals consume real substantive clumped RNG', () => {
        const item = staff(3), random = new Random(12345);
        item.rechargeCounter = 999;
        item.rechargeTurns = 1; // neither old ascending field drives the new model
        for (let i = 0; i < 49; i++) tickStaffRecharge(item, 0, random);
        expect([item.charges, item.staffRechargeRemaining, random.randomNumbersGenerated]).toEqual([0, 10, 0]);
        tickStaffRecharge(item, 0, random);
        expect(item.charges).toBe(1);
        expect(random.randomNumbersGenerated).toBe(3);
        expect(item.staffRechargeRemaining).toBeGreaterThanOrEqual(555);
        expect(item.staffRechargeRemaining).toBeLessThanOrEqual(2776);
        const first = item.staffRechargeRemaining;
        for (let i = 0; item.charges === 1 && i < 278; i++) tickStaffRecharge(item, 0, random);
        expect(item.charges).toBe(2);
        expect(random.randomNumbersGenerated).toBe(6);
        expect(item.staffRechargeRemaining).not.toBe(first);
        expect(resources(item)).toEqual([3, 3, 2]);
    });

    it('full staffs freeze their positive timer and draw nothing; depletion resumes that timer', () => {
        const item = staff(3, 3), random = new Random(12);
        item.staffRechargeRemaining = 123;
        for (let i = 0; i < 100; i++) tickStaffRecharge(item, 27, random);
        expect(item.staffRechargeRemaining).toBe(123);
        expect(random.randomNumbersGenerated).toBe(0);
        item.charges!--;
        tickStaffRecharge(item, 0, random);
        expect([item.charges, item.staffRechargeRemaining]).toEqual([2, 113]);
    });

    it('high wisdom can restore several charges; continues settling overshoot after reaching capacity', () => {
        const item = staff(3), random = { randClumpedRange: vi.fn(() => 1000) };
        tickStaffRecharge(item, 27, random);
        expect(resources(item)).toEqual([3, 3, 3]);
        expect(item.staffRechargeRemaining).toBe(575); // 500 - 11925 + 12*1000
        expect(random.randClumpedRange).toHaveBeenCalledTimes(12);
    });

    it('capacity caps charges independently of E; invalid E never gets rewritten or loops', () => {
        const item = staff(8, 1), random = new Random(99);
        item.maxCharges = 2;
        tickStaffRecharge(item, 27, random);
        expect(resources(item)).toEqual([8, 2, 2]);
        item.enchantment = 0; item.charges = 0;
        const before = JSON.stringify(random);
        tickStaffRecharge(item, 27, random);
        expect(resources(item)).toEqual([0, 2, 0]);
        expect(JSON.stringify(random)).toBe(before);
    });

    it('CE normalizes an overlong timer at unusually high E without RNG or changing E/capacity', () => {
        const item = staff(20, 20), random = new Random(23);
        tickStaffRecharge(item, 0, random);
        expect(resources(item)).toEqual([20, 20, 19]);
        expect(item.staffRechargeRemaining).toBe(250);
        expect(random.randomNumbersGenerated).toBe(0);
    });

    it('W-25/26 activate both CE slow-cycle identities', () => {
        for (const id of ['staff_of_blinking', 'staff_of_obstruction']) {
            expect(staffChargeDuration(staff(2), id)).toBe(5000);
            expect(ItemLoader.spawnStaff(id, 0, 0)).not.toBeNull();
        }
    });
});

describe('W-6 real P2 objective-time / inventory integration', () => {
    it('same 200 objective ticks: four haste actions = two normal = one slow; no per-action recharge', () => {
        for (const [status, actions] of [['haste', 4], [null, 2], ['slowed', 1]] as const) {
            const item = staff(), game = gameWith(item);
            item.staffRechargeRemaining = 20;
            if (status) { game.player.applyStatus(status, 30); game.player.refreshSpeeds(); }
            const rolls = vi.spyOn(rng, 'randClumpedRange').mockReturnValue(1000);
            for (let i = 0; i < actions; i++) {
                wait(game);
                if (status === 'haste' && i === 0) expect(item.staffRechargeRemaining).toBe(20);
            }
            expect([item.charges, item.staffRechargeRemaining, game.ticksTillUpdateEnvironment]).toEqual([1, 1000, 100]);
            expect(rolls).toHaveBeenCalledTimes(1);
            rolls.mockRestore();
        }
    });

    it('only equipped wisdom applies; two slots add, unknown positives cap at 1, negatives apply in full', () => {
        const a = ring(4), b = ring(-2, false), spare = ring(27);
        const item = staff(), game = gameWith(item, a, b, spare);
        game.player.ringLeft = a; game.player.ringRight = b;
        wait(game);
        expect(item.staffRechargeRemaining).toBe(484); // +2 -> 16
        game.player.unequip(a);
        wait(game);
        expect(item.staffRechargeRemaining).toBe(479); // -2 -> 5
        a.identified = false;
        game.player.equip(a);
        expect(equippedWisdomBonus(game.player.rings())).toBe(-1);
        wait(game);
        expect(item.staffRechargeRemaining).toBe(472);
        expect(equippedWisdomBonus([ring(8, false)])).toBe(1);
        expect(equippedWisdomBonus([ring(8, true, 'ring_of_regeneration')])).toBe(0);
    });

    it('all WAND kinds stay depleted (including retired ones); ground staffs do not tick; charm legacy cooldown still ticks once', () => {
        const wands = ItemLoader.wands.map(cfg => ItemLoader.spawnWand(cfg.id, 0, 0)!);
        for (const item of wands) Object.assign(item, { charges: 0, rechargeTurns: 1, rechargeCounter: 999, staffRechargeRemaining: 1 });
        const charm = ItemLoader.spawnCharm('charm_of_health', 0, 0)!;
        charm.cooldownRemaining = 50;
        const game = gameWith(...wands, charm), ground = staff();
        ground.staffRechargeRemaining = 1;
        game.items.push(ground);
        game.player.ringLeft = ring(27);
        const before = wands.map(i => JSON.stringify(i));
        const rngBefore = JSON.stringify(rng);
        for (let i = 0; i < 1000; i++) bridge(game).tickArcanaResources();
        expect(wands.map(i => JSON.stringify(i))).toEqual(before);
        expect(JSON.stringify(rng)).toBe(rngBefore);
        expect([ground.charges, ground.staffRechargeRemaining]).toEqual([0, 1]);
        expect(charm.cooldownRemaining).toBe(0);
    });

    it('actual E3 cast 3->2 then natural recharge 2->3, keeping E/capacity and unknown-state flags', () => {
        const item = staff(3, 3), game = gameWith(item);
        item.identified = false; item.maxChargesKnown = true;
        item.staffRechargeRemaining = 10;
        game.useArcanaItem(item);
        game.cancelArcanaSelection();
        expect([item.charges, item.staffRechargeRemaining]).toEqual([3, 10]);
        game.useArcanaItem(item);
        game.setArcanaTarget(game.player.loc.x + 1, game.player.loc.y);
        game.confirmArcanaTarget(); // spends a charge then 100 objective ticks restores it
        expect(resources(item)).toEqual([3, 3, 3]);
        expect(item.staffRechargeRemaining).toBeGreaterThan(0);
        expect([item.identified, item.maxChargesKnown]).toEqual([false, true]);
        expect(logger.messages.some(m => m.text.includes('Test Staff'))).toBe(false);
    });
});

describe('W-6 recharging scroll: STAFF | CHARM, never WAND', () => {
    it('real read consumes scroll/time, fills every staff, clears every charm cooldown, leaves other resources alone', () => {
        const a = staff(3, 1), b = staff(8, 0), full = staff(2, 2);
        const charms = ItemLoader.charms.slice(0, 2).map(cfg => ItemLoader.spawnCharm(cfg.id, 0, 0)!);
        charms.forEach(c => c.cooldownRemaining = 200);
        const wand = ItemLoader.spawnWand('wand_of_slowness', 0, 0)!;
        wand.charges = 0;
        const r = ring(2), scroll = ItemLoader.spawnScroll('scroll_of_recharging', 0, 0)!;
        const game = gameWith(a, b, full, ...charms, wand, r, scroll);
        const ground = staff(); game.items.push(ground);
        const identity = [a, b, full].map(i => [i.identified, i.maxChargesKnown]);
        const rngCall = vi.spyOn(rng, 'randClumpedRange');
        const beforeTurns = game.stats.turns;
        game.readItem(scroll);
        expect([a, b, full].map(resources)).toEqual([[3, 3, 3], [8, 8, 8], [2, 2, 2]]);
        expect([a, b, full].map(i => i.staffRechargeRemaining)).toEqual([1666, 625, 2500]);
        expect([a, b, full].map(i => [i.identified, i.maxChargesKnown])).toEqual(identity);
        expect(charms.map(c => c.cooldownRemaining)).toEqual([0, 0]);
        expect([wand.charges, ground.charges, r.charges]).toEqual([0, 0, ItemLoader.RING_DELAY_TO_AUTO_ID]);
        expect(game.player.inventory.items).not.toContain(scroll);
        expect(game.stats.turns).toBe(beforeTurns + 1);
        expect(rngCall).not.toHaveBeenCalled();
    });

    it('charm-only is eligible; empty or wand-only pack still consumes scroll but never adds wand uses', () => {
        const charm = ItemLoader.spawnCharm(ItemLoader.charms[0]!.id, 0, 0)!;
        const game = gameWith(charm);
        charm.cooldownRemaining = 123;
        const before = JSON.stringify(rng);
        expect(bridge(game).rechargeStaffsAndCharms()).toBe(true);
        expect(charm.cooldownRemaining).toBe(0);
        expect(JSON.stringify(rng)).toBe(before);
        game.player.inventory.items = [];
        expect(bridge(game).rechargeStaffsAndCharms()).toBe(false);
        const wand = ItemLoader.spawnWand('wand_of_empowerment', 0, 0)!;
        wand.charges = 0;
        const scroll = ItemLoader.spawnScroll('scroll_of_recharging', 0, 0)!;
        game.player.inventory.items = [wand, scroll];
        game.readItem(scroll);
        expect(game.player.inventory.items).toEqual([wand]);
        expect(wand.charges).toBe(0);
        expect(logger.messages.some(m => m.text.includes('No staffs or charms'))).toBe(true);
    });
});

describe('W-6 countdown persistence / zero-RNG legacy fallback', () => {
    it('pack/ground JSON round-trip preserves timer and partial P2 gate; next recharge matches uninterrupted continuation', () => {
        const item = staff(), game = gameWith(item), ground = staff(8, 1);
        item.staffRechargeRemaining = 7; ground.staffRechargeRemaining = 1234;
        game.items.push(ground);
        game.player.applyStatus('haste', 30); game.player.refreshSpeeds();
        wait(game); // 50 tick, no recharge yet
        const snapshot = JSON.parse(JSON.stringify(game.toSnapshot()));
        const rolls = vi.spyOn(rng, 'randClumpedRange').mockReturnValue(1000);
        wait(game);
        expect([item.charges, item.staffRechargeRemaining]).toEqual([1, 997]);
        expect(game.loadSnapshot(snapshot)).toBe(true);
        expect(game.ticksTillUpdateEnvironment).toBe(50);
        const loaded = game.player.inventory.items[0]!;
        expect([loaded.charges, loaded.staffRechargeRemaining]).toEqual([0, 7]);
        expect(game.items.find(i => i.id === ground.id)?.staffRechargeRemaining).toBe(1234);
        wait(game);
        expect([loaded.charges, loaded.staffRechargeRemaining]).toEqual([1, 997]);
        expect(rolls).toHaveBeenCalledTimes(2);
        delete snapshot.ticksTillUpdateEnvironment;
        game.ticksTillUpdateEnvironment = 50;
        expect(game.loadSnapshot(snapshot)).toBe(true);
        expect(game.ticksTillUpdateEnvironment).toBe(100);
    });

    it('signed countdown values round-trip without RNG or spawn', () => {
        const g = bridge(Object.create(Game.prototype)), source = g.serializeItem(staff(3));
        const before = JSON.stringify(rng);
        vi.spyOn(rng, 'randRange').mockImplementation(() => { throw Error('RNG in migration'); });
        vi.spyOn(rng, 'randClumpedRange').mockImplementation(() => { throw Error('RNG in migration'); });
        vi.spyOn(ItemLoader, 'spawnStaff').mockImplementation(() => { throw Error('spawn in migration'); });
        for (const remaining of [-20, 0, 7, 1000]) {
            const loaded = g.deserializeItem({ ...source, staffRechargeRemaining: remaining });
            expect(loaded.staffRechargeRemaining).toBe(remaining);
        }
        expect(JSON.stringify(rng)).toBe(before);
    });

    it('details no longer promise fixed-turn/wand recharge or disclose hidden E through a numeric period', () => {
        for (const item of [staff(8), ItemLoader.spawnWand('wand_of_slowness', 0, 0)!]) {
            item.rechargeTurns = 200; item.identified = false;
            const text = generateItemDetail(item, 12).sections.flatMap(s => s.lines.map(l => l.text)).join('\n');
            expect(text).not.toContain('每 200 回合');
            expect(text).toContain(item.category === ItemCategory.WAND ? '不会自然恢复充能' : '智慧戒指');
        }
    });
});
