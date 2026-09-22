import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reactive, toRaw } from 'vue';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { canEnchantArcana, enchantArcana } from '../engine/Items/ArcanaEnchantment';
import { staffChargeDuration, tickStaffRecharge } from '../engine/Items/ArcanaRecharge';
import { Random, rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { logger } from '../engine/Systems/Logger';
import { createHeadlessGame } from './harness';

afterEach(() => vi.restoreAllMocks());
function staff(e = 3, charges = 1, timer = 2700): Item {
    const item = new Item('Hidden Lightning', '\\', 0xffffff, ItemCategory.STAFF);
    Object.assign(item, { identityId: 'staff_of_lightning', arcanaInstanceVersion: 1,
        enchantment: e, maxCharges: e, charges, staffRechargeRemaining: timer,
        identified: false, maxChargesKnown: false, timesUsed: 7, magicDetected: true });
    return item;
}
const state = (item: Item) => [item.enchantment, item.maxCharges, item.charges, item.staffRechargeRemaining];
function setup(...items: Item[]) {
    const game = createHeadlessGame(42, 'test');
    game.player.inventory.items = items;
    game.player.equippedWeapon = game.player.equippedArmor = null;
    game.player.ringLeft = game.player.ringRight = null;
    game.monsters = [];
    const scroll = ItemLoader.spawnScroll('scroll_of_enchantment', -1, -1)!;
    game.player.inventory.items.push(scroll);
    return { game, scroll };
}
const flags = (item: Item) => [item.identified, item.maxChargesKnown, item.timesUsed, item.magicDetected];

describe('W-7 CE resource changes, independent E/capacity/current/timer', () => {
    it.each([0, 1, 3])('staff with %i uses: adds one, capacity=new E, timer=500/new E, no discovery/RNG', charges => {
        const item = staff(3, charges), known = flags(item), before = JSON.stringify(rng);
        item.isCursed = true;
        expect(enchantArcana(item)).toBe(true);
        expect(state(item)).toEqual([4, 4, charges + 1, 125]);
        expect(flags(item)).toEqual(known);
        expect(item.isCursed).toBe(false);
        expect(JSON.stringify(rng)).toBe(before);
    });
    it('capacity synchronizes to CE E, never refills missing uses from an old capacity', () => {
        const item = staff(8, 1); item.maxCharges = 2;
        enchantArcana(item);
        expect(state(item)).toEqual([9, 9, 2, 55]);
    });
    it.each([undefined, -20, 0, 1, 2700, 99999])('reset replaces old timer %s, never scales/retains it', timer => {
        const item = staff(); item.staffRechargeRemaining = timer;
        enchantArcana(item);
        expect(item.staffRechargeRemaining).toBe(125);
    });
    it.each([
        ['wand_of_teleportation', 3], ['wand_of_slowness', 2],
        ['wand_of_beckoning', 2], ['wand_of_invisibility', 3], ['wand_of_empowerment', 1],
    ] as const)('%s adds its lower bound %i on every enchant, without a cap or dice', (id, lower) => {
        const item = ItemLoader.spawnWand(id, 0, 0)!;
        Object.assign(item, { enchantment: 8, charges: 0, maxCharges: 1, staffRechargeRemaining: 234 });
        const known = flags(item), before = JSON.stringify(rng);
        enchantArcana(item); enchantArcana(item);
        expect(state(item)).toEqual([8, 1, 2 * lower, 234]);
        expect(flags(item)).toEqual(known);
        expect(JSON.stringify(rng)).toBe(before);
    });
    it('unsupported categories, retired wand ranges, and invalid staffs do not acquire invented rules', () => {
        const badStaff = staff(0);
        for (const item of [badStaff, new Item('food', ':', 0, ItemCategory.FOOD),
            ItemLoader.spawnWand('wand_of_fire', 0, 0)!, ItemLoader.spawnWand('wand_of_lightning', 0, 0)!]) {
            const before = JSON.stringify(item);
            expect(canEnchantArcana(item)).toBe(false);
            expect(enchantArcana(item)).toBe(false);
            expect(JSON.stringify(item)).toBe(before);
        }
    });
});

describe('W-7 / W-6 recharge normalization interaction', () => {
    it('new-E reset avoids draining a charge from the old long timer; control proves the normalization loop still runs', () => {
        const item = staff(3, 1), control = staff(3, 1), random = new Random(71);
        enchantArcana(item); enchantArcana(control);
        control.staffRechargeRemaining = 2700; // counterfactual: incorrectly keep the old cycle
        expect(staffChargeDuration(item)).toBe(1250);
        tickStaffRecharge(item, 0, random);
        tickStaffRecharge(control, 0, random);
        expect(state(item)).toEqual([4, 4, 2, 115]);
        expect(state(control)).toEqual([4, 4, 1, 1440]); // 2700 - 10 - 1250
        expect(random.randomNumbersGenerated).toBe(0);
    });
    it('full enchanted staff retains short timer; W-6 resumes it after the next use', () => {
        const item = staff(3, 3), random = new Random(71);
        enchantArcana(item);
        tickStaffRecharge(item, 0, random);
        expect(state(item)).toEqual([4, 4, 4, 125]);
        item.charges!--;
        tickStaffRecharge(item, 0, random);
        expect(state(item)).toEqual([4, 4, 3, 115]);
    });
    it('at high E the reset expires on the read turn; next interval uses NEW E and retains overshoot', () => {
        const item = staff(50, 0), random = { randClumpedRange: vi.fn(() => 98) };
        enchantArcana(item);
        expect(state(item)).toEqual([51, 51, 1, 9]);
        tickStaffRecharge(item, 0, random);
        expect(state(item)).toEqual([51, 51, 2, 97]);
        expect(random.randClumpedRange).toHaveBeenCalledExactlyOnceWith(32, 163, 3);
    });
});

describe('W-7 real read -> forced pack selection -> one completed turn', () => {
    it('reading identifies only the scroll; invalid/cancel/move/repeated read do not settle time or draw RNG', () => {
        const item = staff(), { game, scroll } = setup(item);
        const before = JSON.stringify(rng), tick = timeSystem.currentTick, turns = game.stats.turns;
        game.readItem(scroll);
        expect(game.pendingEnchantment).toBe(true);
        expect(game.isInventoryOpen).toBe(true);
        expect(game.player.inventory.items).not.toContain(scroll);
        expect(ItemLoader.identifiedItems.has('scroll_of_enchantment')).toBe(true);
        expect(ItemLoader.identifiedItems.has('staff_of_lightning')).toBe(false);
        for (const action of ['escape', 'cancel_target', 'toggle_inventory', 'wait', 'move', 'apply_item', 'throw_item']) {
            game.handlePlayerAction(action, { x: 1, y: 0 }, 'system');
        }
        game.readItem(scroll);
        game.useArcanaItem(item);
        expect(game.chooseEnchantTarget(scroll)).toBe(false);
        expect(game.pendingEnchantment).toBe(true);
        expect(game.pendingArcana).toBeNull();
        expect([timeSystem.currentTick, game.stats.turns]).toEqual([tick, turns]);
        expect(state(item)).toEqual([3, 3, 1, 2700]);
        expect(JSON.stringify(rng)).toBe(before);
        expect(game.chooseEnchantTarget(item)).toBe(true);
        expect(state(item)).toEqual([4, 4, 2, 115]); // 125 reset, then this read's objective block
        expect([timeSystem.currentTick, game.stats.turns]).toEqual([tick + 100, turns + 1]);
        expect(game.pendingEnchantment).toBe(false);
        expect(game.isInventoryOpen).toBe(false);
        expect(game.chooseEnchantTarget(item)).toBe(false);
        expect(ItemLoader.identifiedItems.has('staff_of_lightning')).toBe(false);
        expect(logger.messages.some(m => m.text.includes('Hidden Lightning'))).toBe(false);
        expect(logger.messages.every(m => !m.text.includes('&#x2F;'))).toBe(true);
    });
    it('haste read does not fake a full objective block; next half-turn continues the reset', () => {
        const item = staff(), { game, scroll } = setup(item);
        game.player.applyStatus('haste', 20); game.player.refreshSpeeds();
        game.readItem(scroll); game.chooseEnchantTarget(item);
        expect([item.staffRechargeRemaining, game.ticksTillUpdateEnvironment]).toEqual([125, 50]);
        game.handlePlayerAction('wait', undefined, 'system');
        expect([item.staffRechargeRemaining, game.ticksTillUpdateEnvironment]).toEqual([115, 100]);
    });
    it('selects by live object reference across reorder, rejects same-id clones, proxy, ground and replaced items', () => {
        const a = staff(), b = staff(2, 0), { game, scroll } = setup(a, b);
        game.readItem(scroll);
        const impostor = Object.assign(staff(), { id: a.id });
        expect(game.chooseEnchantTarget(impostor)).toBe(false);
        expect(game.chooseEnchantTarget(reactive(a))).toBe(false);
        game.player.inventory.items.reverse();
        game.player.inventory.items = game.player.inventory.items.filter(i => i !== b);
        game.items.push(b);
        expect(game.chooseEnchantTarget(b)).toBe(false);
        expect(game.chooseEnchantTarget(toRaw(reactive(a)))).toBe(true);
        expect(state(a)).toEqual([4, 4, 2, 115]);
        expect(state(b)).toEqual([2, 2, 0, 2700]);
    });
    it('a stale same-id scroll cannot enter the transaction or identify anything', () => {
        const { game, scroll } = setup(staff());
        const clone = Object.assign(new Item('clone', '?', 0, ItemCategory.SCROLL), scroll);
        const before = JSON.stringify(rng);
        game.readItem(clone);
        expect(game.pendingEnchantment).toBe(false);
        expect(game.player.inventory.items).toContain(scroll);
        expect(ItemLoader.identifiedItems.has('scroll_of_enchantment')).toBe(false);
        expect(JSON.stringify(rng)).toBe(before);
    });
    it('empty/unsupported pack consumes the scroll and completes time without pending selection', () => {
        const { game, scroll } = setup();
        const tick = timeSystem.currentTick;
        game.readItem(scroll);
        expect(game.pendingEnchantment).toBe(false);
        expect(timeSystem.currentTick).toBe(tick + 100);
        expect(game.player.inventory.items).toHaveLength(0);
        expect(ItemLoader.identifiedItems.has('scroll_of_enchantment')).toBe(true);
    });
    it('pending transaction survives JSON reload; stale references fail; completed values/unknown flags persist', () => {
        const item = staff(), { game, scroll } = setup(item);
        game.readItem(scroll);
        const pending = JSON.parse(JSON.stringify(game.toSnapshot()));
        expect(game.loadSnapshot(pending)).toBe(true);
        expect(game.pendingEnchantment).toBe(true);
        expect(game.isInventoryOpen).toBe(true);
        expect(game.chooseEnchantTarget(item)).toBe(false);
        const loaded = game.player.inventory.items[0]!;
        expect(game.chooseEnchantTarget(loaded)).toBe(true);
        const completed = JSON.parse(JSON.stringify(game.toSnapshot()));
        expect(game.loadSnapshot(completed)).toBe(true);
        expect(state(game.player.inventory.items[0]!)).toEqual([4, 4, 2, 115]);
        expect(flags(game.player.inventory.items[0]!)).toEqual(flags(item));
        expect(game.pendingEnchantment).toBe(false);
        delete pending.pendingEnchantment;
        expect(game.loadSnapshot(pending)).toBe(true);
        expect(game.pendingEnchantment).toBe(false);
    });
    it('wand uses beyond initial count survive selection and JSON save/load without exposing identity', () => {
        const wand = ItemLoader.spawnWand('wand_of_teleportation', 0, 0)!;
        wand.charges = wand.maxCharges = 1;
        const { game, scroll } = setup(wand), known = flags(wand);
        game.readItem(scroll); game.chooseEnchantTarget(wand);
        expect(wand.charges).toBe(4);
        const snapshot = JSON.parse(JSON.stringify(game.toSnapshot()));
        game.loadSnapshot(snapshot);
        const loaded = game.player.inventory.items[0]!;
        expect([loaded.enchantment, loaded.maxCharges, loaded.charges]).toEqual([0, 1, 4]);
        expect(flags(loaded)).toEqual(known);
    });
});

describe('W-7 equipment boundary and UI source coverage (S, no Vue import edge)', () => {
    it.each(['weapon', 'armor'] as const)('%s path has exactly the legacy RNG state and result', kind => {
        const game = createHeadlessGame(42, 'test'); game.monsters = [];
        if (kind === 'armor') game.player.equippedWeapon = null;
        const target = (game.player.equippedWeapon ?? game.player.equippedArmor)!;
        target.runicType = undefined; target.enchantment = -1; target.isCursed = true;
        const original = { ...target };
        const scroll = ItemLoader.spawnScroll('scroll_of_enchantment', -1, -1)!;
        game.player.inventory.items.push(scroll);
        const bridge = game as unknown as { enchantEquippedItem(): boolean };
        rng.seedRandomGenerator(12345);
        bridge.enchantEquippedItem();
        const expected = { ...target }, expectedRng = JSON.stringify(rng);
        Object.assign(target, original);
        rng.seedRandomGenerator(12345);
        // Isolate the unchanged equipment mutation footprint from ordinary turn effects.
        vi.spyOn(game as unknown as { playerTurnEnded(): void }, 'playerTurnEnded').mockImplementation(() => {});
        game.readItem(scroll);
        expect(rng.randomNumbersGenerated).toBe(0);
        expect(game.chooseEnchantTarget(target)).toBe(true);
        expect({ ...target }).toEqual(expected);
        expect(JSON.stringify(rng)).toBe(expectedRng);
    });
    it('arcana alternative never invokes equipment 20% rune path; spare gear/rings/charms remain outside scope', () => {
        const item = staff(), { game, scroll } = setup(item);
        const gear = ItemLoader.spawnWeapon('dagger', 0, 0)!;
        game.player.inventory.items.push(gear);
        game.player.equippedWeapon = gear;
        const percent = vi.spyOn(rng, 'randPercent');
        const gearBefore = JSON.stringify(gear);
        game.readItem(scroll); game.chooseEnchantTarget(item);
        expect(percent).not.toHaveBeenCalled();
        expect(JSON.stringify(gear)).toBe(gearBefore);
        game.player.equippedWeapon = null;
        expect(game.canEnchantTarget(gear)).toBe(false);
        for (const category of [ItemCategory.RING, ItemCategory.CHARM]) {
            const other = new Item('other', '=', 0, category);
            game.player.inventory.items.push(other);
            expect(game.canEnchantTarget(other)).toBe(false);
        }
    });
    it('Vue keeps mandatory selection visible, suppresses other actions, and unwraps both item boundaries', () => {
        const src = readFileSync(fileURLToPath(new URL('../components/InventoryOverlay.vue', import.meta.url)), 'utf8');
        expect(src).toContain('activeGame.readItem(toRaw(item))');
        expect(src).toContain('activeGame.chooseEnchantTarget(toRaw(item))');
        expect(src).toContain('activeGame.canEnchantTarget(toRaw(entry.item))');
        expect(src).toContain('if (activeGame.pendingEnchantment) return;');
        expect(src).toContain('!pendingIdentify && !pendingEnchantment');
    });
});
