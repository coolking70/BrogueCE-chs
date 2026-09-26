import { describe, expect, it } from 'vitest';
import { createHeadlessGame } from './harness';
import { Item, ItemCategory as C } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { canEnchantChosenItem, enchantChosenItem, prepareThrownItem } from '../engine/Items/ItemUseCoordinator';
import { rng, Random } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { logger } from '../engine/Systems/Logger';
import { effectiveRingEnchant } from '../engine/Items/RingBonuses';

const ports = { updateVision: () => {}, logEnchanted: () => {}, logUncursed: () => {} };
function fixture(game = createHeadlessGame(27027, 'test')) {
    game.monsters = [];
    game.player.inventory.items = [];
    game.player.equippedWeapon = game.player.equippedArmor = null;
    game.player.ringLeft = game.player.ringRight = null;
    const weapon = ItemLoader.spawnWeapon('dagger', -1, -1)!;
    const armor = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
    const darts = ItemLoader.spawnWeapon('dart', -1, -1)!;
    const ring = ItemLoader.spawnRing('ring_of_light', -1, -1)!;
    const staff = ItemLoader.spawnStaff('staff_of_lightning', -1, -1)!;
    const wand = ItemLoader.spawnWand('wand_of_teleportation', -1, -1)!;
    const charm = ItemLoader.spawnCharm('charm_of_health', -1, -1)!;
    const gear = [weapon, armor, darts, ring, staff, wand, charm];
    for (const item of gear) { item.isCursed = true; item.timesEnchanted = 2; game.player.inventory.addItem(item); }
    Object.assign(weapon, { enchantment: -3, strengthRequired: 12, runicType: undefined, runicKnown: false });
    Object.assign(armor, { enchantment: -2, strengthRequired: 0, runicType: 'reflection', runicKnown: false });
    Object.assign(darts, { enchantment: 0, quantity: 15, quiverNumber: 321, strengthRequired: 10, runicType: undefined });
    Object.assign(ring, { enchantment: 7, identified: false });
    Object.assign(staff, { enchantment: 3, maxCharges: 3, charges: 1, staffRechargeRemaining: 2700 });
    Object.assign(wand, { enchantment: 0, maxCharges: 1, charges: 0, timesUsed: 5 });
    Object.assign(charm, { enchantment: 2, cooldownRemaining: 100 });
    const scroll = ItemLoader.spawnScroll('scroll_of_enchantment', -1, -1)!;
    game.player.inventory.addItem(scroll);
    return { game, gear, weapon, armor, darts, ring, staff, wand, charm, scroll };
}

describe('X2d CE Items.c:7740, 7806-7899 scroll equipment semantics', () => {
    it('accepts every valid carried category including spare gear and thrown stacks, rejecting objects outside the pack', () => {
        const { game, gear } = fixture();
        for (const item of gear) {
            expect(game.canEnchantTarget(item)).toBe(true);
            expect(game.canEnchantTarget(Object.assign(new Item('clone', '?', 0, item.category), item))).toBe(false);
        }
        for (const category of [C.POTION, C.SCROLL, C.FOOD, C.GOLD, C.KEY, C.AMULET, C.GEM]) {
            const item = new Item('ineligible', '?', 0, category);
            game.player.inventory.addItem(item);
            expect(canEnchantChosenItem(game.player, item)).toBe(false);
        }
    });

    it.each(['weapon', 'armor', 'ring', 'staff', 'wand', 'charm'] as const)('%s increments times, removes curse, keeps knowledge and draws no dice', kind => {
        const f = fixture(), item = f[kind];
        const knowledge = [item.identified, item.runicKnown, item.maxChargesKnown, item.timesUsed, item.magicDetected];
        const before = rng.getState();
        enchantChosenItem(f.game.player, item, ports);
        expect(item.timesEnchanted).toBe(3);
        expect(item.isCursed).toBe(false);
        expect([item.identified, item.runicKnown, item.maxChargesKnown, item.timesUsed, item.magicDetected]).toEqual(knowledge);
        expect(rng.getState()).toEqual(before);
        if (kind === 'weapon') expect([item.enchantment, item.strengthRequired, item.runicType]).toEqual([-2, 11, undefined]);
        if (kind === 'armor') expect([item.enchantment, item.strengthRequired, item.runicType]).toEqual([-1, 0, 'reflection']);
        if (kind === 'ring') expect([item.enchantment, effectiveRingEnchant(item)]).toEqual([8, 4]);
        if (kind === 'staff') expect([item.enchantment, item.maxCharges, item.charges, item.staffRechargeRemaining]).toEqual([4, 4, 2, 125]);
        if (kind === 'wand') expect([item.enchantment, item.maxCharges, item.charges, item.timesUsed]).toEqual([0, 1, 3, 5]);
        if (kind === 'charm') expect([item.enchantment, item.cooldownRemaining]).toEqual([3, 0]);
    });

    it('enchants the entire thrown stack and draws exactly the CE 1..60000 quiver roll', () => {
        const { game, darts } = fixture();
        const reference = new Random(12345);
        const quiver = reference.randRange(1, 60000);
        rng.seedRandomGenerator(12345); rng.resetCounters();
        enchantChosenItem(game.player, darts, ports);
        expect([darts.enchantment, darts.strengthRequired, darts.quantity, darts.timesEnchanted, darts.quiverNumber]).toEqual([1, 9, 15, 3, quiver]);
        expect(rng.getState()).toEqual(reference.getState());
        expect(darts.runicType).toBeUndefined();
        const oldGroup = ItemLoader.spawnWeapon('dart', -1, -1)!;
        Object.assign(oldGroup, { quiverNumber: 321, quantity: 1 });
        game.player.inventory.addItem(oldGroup);
        expect(game.player.inventory.items).toContain(oldGroup);
        expect(darts.quantity).toBe(15);
        const thrown = prepareThrownItem(game.player, darts, game.player.loc, false);
        expect([darts.quantity, thrown.quantity, thrown.quiverNumber, thrown.enchantment]).toEqual([14, 1, quiver, 1]);
        expect(thrown.id).not.toBe(darts.id);
        game.player.inventory.addItem(thrown);
        expect([darts.quantity, oldGroup.quantity]).toEqual([15, 1]);
    });

    it.each([false, true])('core mutation preserves existing rune knowledge=%s; identify reveals it', known => {
        const { game, armor } = fixture();
        armor.runicKnown = known;
        enchantChosenItem(game.player, armor, ports);
        expect(armor.runicKnown).toBe(known);
        ItemLoader.identifyInstance(armor);
        expect(armor.runicKnown).toBe(true);
    });

    it.each([false, true])('CE forced refresh: enchanting the worn armor=%s clears only its DONNING, preserving maxStatus', worn => {
        const { game, armor } = fixture();
        game.player.equippedArmor = worn ? armor : ItemLoader.spawnArmor('plate_mail', -1, -1)!;
        game.player.applyStatus('donning', 8);
        enchantChosenItem(game.player, armor, ports);
        expect(game.player.getStatusDuration('donning')).toBe(worn ? 0 : 8);
        expect(game.player.maxStatus.donning).toBe(8);
        expect(game.player.equippedArmor === armor).toBe(worn);
    });

    it.each([
        ['dagger', C.WEAPON, false], ['sword', C.WEAPON, false], ['broadsword', C.WEAPON, true],
        ['leather_armor', C.ARMOR, false], ['scale_mail', C.ARMOR, false], ['chain_mail', C.ARMOR, true],
    ] as const)('first unknown scroll: CE kind alias at autoIdentify tail, %s reveals rune=%s', (id, category, reveal) => {
        const { game, scroll } = fixture();
        const item = category === C.WEAPON ? ItemLoader.spawnWeapon(id, -1, -1)! : ItemLoader.spawnArmor(id, -1, -1)!;
        Object.assign(item, { runicType: category === C.WEAPON ? 'speed' : 'reflection', runicKnown: false, identified: false });
        game.player.inventory.addItem(item);
        game.readItem(scroll);
        expect(game.chooseEnchantTarget(item)).toBe(true);
        expect(item.runicKnown).toBe(reveal);
        expect(item.identified).toBe(false);
        expect(item.runicType).toBe(category === C.WEAPON ? 'speed' : 'reflection');
    });

    it.each([false, true])('known scroll=%s persists the exact autoIdentify decision while target selection is pending', known => {
        const { game, scroll } = fixture();
        const item = ItemLoader.spawnArmor('chain_mail', -1, -1)!;
        Object.assign(item, { runicType: 'reflection', runicKnown: false, identified: false });
        game.player.inventory.addItem(item);
        if (known) ItemLoader.identifyItemKind(scroll);
        game.readItem(scroll);
        const saved = JSON.parse(JSON.stringify(game.toSnapshot()));
        expect(saved.run.enchantmentScrollWasKnown).toBe(known);
        const invalid = JSON.parse(JSON.stringify(saved));
        delete invalid.run.enchantmentScrollWasKnown;
        expect(game.loadSnapshot(invalid)).toBe(false);
        expect(game.loadSnapshot(saved)).toBe(true);
        const restored = game.player.inventory.items.find(i => i.id === item.id)!;
        expect(game.chooseEnchantTarget(restored)).toBe(true);
        expect(restored.runicKnown).toBe(!known);
        expect(restored.identified).toBe(false);
        expect(game.toSnapshot().run.enchantmentScrollWasKnown).toBeUndefined();
    });

    it.each([
        ['staff_of_lightning', C.STAFF, false], ['staff_of_fire', C.STAFF, false], ['staff_of_poison', C.STAFF, true],
        ['wand_of_teleportation', C.WAND, false], ['wand_of_slowness', C.WAND, false], ['wand_of_beckoning', C.WAND, true],
        ['ring_of_clairvoyance', C.RING, false], ['ring_of_stealth', C.RING, false], ['ring_of_regeneration', C.RING, true],
    ] as const)('first unknown scroll: target kind %s auto-identifies=%s without granting full instance knowledge', (id, category, reveal) => {
        const { game, scroll } = fixture();
        const item = category === C.STAFF ? ItemLoader.spawnStaff(id, -1, -1)!
            : category === C.WAND ? ItemLoader.spawnWand(id, -1, -1)! : ItemLoader.spawnRing(id, -1, -1)!;
        item.enchantment = 3; item.identified = false;
        game.player.inventory.addItem(item);
        game.readItem(scroll); game.chooseEnchantTarget(item);
        expect(ItemLoader.identifiedItems.has(id)).toBe(reveal);
        expect(item.identified).toBe(false);
    });

    it('selects the spare armor while both slots are occupied, then persists all changes and references', () => {
        const { game, weapon, armor, scroll } = fixture();
        const worn = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        game.player.inventory.addItem(worn);
        game.player.equippedWeapon = weapon;
        game.player.equippedArmor = worn;
        const before = [weapon.enchantment, worn.enchantment], turn = game.stats.turns;
        game.readItem(scroll);
        expect(game.chooseEnchantTarget(armor)).toBe(true);
        expect([weapon.enchantment, worn.enchantment]).toEqual(before);
        expect([armor.enchantment, armor.strengthRequired, armor.timesEnchanted, armor.isCursed]).toEqual([-1, 0, 3, false]);
        expect(game.stats.turns).toBe(turn + 1);
        const snapshot = JSON.parse(JSON.stringify(game.toSnapshot()));
        expect(game.loadSnapshot(snapshot)).toBe(true);
        const restored = game.player.inventory.items.find(i => i.id === armor.id)!;
        expect([restored.enchantment, restored.strengthRequired, restored.timesEnchanted, restored.runicKnown]).toEqual([-1, 0, 3, false]);
        expect(game.player.equippedArmor?.id).toBe(worn.id);
    });

    it.each([true, false])('remove curse: effect=%s clears the whole pack only, preserves negative E and auto-identifies once', cursed => {
        const { game, gear, weapon, armor } = fixture();
        for (const item of gear) item.isCursed = cursed;
        const floor = ItemLoader.spawnWeapon('dagger', 0, 0)!;
        floor.isCursed = true; floor.enchantment = -3; game.items.push(floor);
        const before = gear.map(i => [i.enchantment, i.strengthRequired, i.timesEnchanted, i.runicKnown]);
        const scroll = ItemLoader.spawnScroll('scroll_of_remove_curse', -1, -1)!;
        game.player.inventory.addItem(scroll);
        const turn = game.stats.turns;
        game.readItem(scroll);
        expect(gear.every(i => !i.isCursed)).toBe(true);
        expect(gear.map(i => [i.enchantment, i.strengthRequired, i.timesEnchanted, i.runicKnown])).toEqual(before);
        expect([weapon.enchantment, armor.enchantment, floor.isCursed, floor.enchantment]).toEqual([-3, -2, true, -3]);
        expect(game.player.inventory.items).not.toContain(scroll);
        expect(game.stats.turns).toBe(turn + 1);
        expect(ItemLoader.identifiedItems.has('scroll_of_remove_curse')).toBe(true);
        expect(logger.messages.filter(m => m.text.includes('cleansing light'))).toHaveLength(1);
        expect(logger.messages.some(m => m.text.includes(cursed ? 'malevolent energy disperses' : 'nothing happens'))).toBe(true);
    });

    it.each([false, true])('U27 replay, animation=%s: read, rejected cancellation/invalid target, spare gear and stack selection', animated => {
        const f = fixture(), { game, armor, darts, scroll } = f;
        scroll.quantity = 2;
        game.animationEnabled = animated;
        const flush = () => { while (game.isAdvancing) game.stepAdvancement(); };
        const tick = timeSystem.currentTick, before = rng.getState();
        game.executeItemCommand('read', scroll);
        game.executeCommand('escape'); game.executeCommand('cancel_target'); game.executeItemCommand('cancel');
        expect([game.pendingEnchantment, game.isInventoryOpen, timeSystem.currentTick]).toEqual([true, true, tick]);
        expect(rng.getState()).toEqual(before);
        game.executeItemCommand('enchant', scroll);
        expect(game.pendingEnchantment).toBe(true);
        game.executeItemCommand('enchant', armor); flush();
        game.executeItemCommand('read', scroll);
        game.executeItemCommand('enchant', darts); flush();
        const final = game.player.inventory.items.map(i => ({ ...i }));
        const finalRng = rng.getState(), finalTick = timeSystem.currentTick;
        const recording = game.exportRecording();
        expect(recording.events).toHaveLength(8);
        expect(game.loadReplay(recording)).toBe(true);
        // Synthetic inventory fixture, identically reconstructed after new-game replay initialization.
        // No gameplay method or checkpoint is replaced; every recorded command uses U27 dispatch.
        fixture(game).scroll.quantity = 2;
        game.animationEnabled = animated;
        while (game.replayCursor < recording.events.length && !game.replayError) { game.replayStep(); flush(); }
        expect(game.replayError).toBeNull();
        expect(game.replayCursor).toBe(recording.events.length);
        expect(game.player.inventory.items.map(i => ({ ...i }))).toEqual(final);
        expect(rng.getState()).toEqual(finalRng);
        expect(timeSystem.currentTick).toBe(finalTick);
    });
});
