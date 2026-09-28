import { afterEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import zhCN from '../locales/zh_CN.json';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { TerrainType as T } from '../engine/Map/Grid';
import { Item, ItemCategory as C } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Player } from '../entities/Player';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { logger } from '../engine/Systems/Logger';

afterEach(() => { vi.restoreAllMocks(); void i18next.changeLanguage('en'); });
const slots = ['equippedWeapon', 'equippedArmor', 'ringLeft', 'ringRight'] as const;
type Slot = typeof slots[number];
function room(g: Game) {
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.visibleMonsters.clear(); g.visibleItems.clear();
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x >= 8 && x <= 16 && y >= 8 && y <= 12 ? T.FLOOR : T.GRANITE);
        const c = g.grid.getCell(x, y)!;
        Object.assign(c, { hasMemory: true, isVisible: true, isClairvoyantVisible: false,
            isMagicMapped: false, isDiscovered: false, isExplored: true, machineNumber: 0,
            rememberedLayers: [...c.layers] });
    }
    g.player.loc = { x: 10, y: 10 };
    g.player.inventory.items = [];
    for (const slot of slots) g.player[slot] = null;
}
function install(g: Game, slot: Slot, cursed = true, known = false) {
    const category = slot === 'equippedWeapon' ? C.WEAPON : slot === 'equippedArmor' ? C.ARMOR : C.RING;
    const name = category === C.WEAPON ? 'Sword' : category === C.ARMOR ? 'Leather Armor' : 'Ring';
    const item = new Item(name, '/', 0xffffff, category);
    Object.assign(item, { isCursed: cursed, identified: known, enchantment: -2, armor: 5 });
    g.player.inventory.addItem(item); g.player[slot] = item;
    if (slot === 'equippedArmor') g.player.setStatusDuration('donning', 3);
    return item;
}
function scene(slot: Slot = 'equippedWeapon', cursed = true, known = false) {
    const g = createHeadlessGame(33003, 'test'); room(g);
    return { g, item: install(g, slot, cursed, known) };
}
function state(g: Game) {
    return structuredClone({ player: g.player, items: g.items, tick: timeSystem.currentTick,
        turn: g.absoluteTurnNumber, stats: g.stats, rng: rng.getState(),
        knowledge: [...ItemLoader.identifiedItems], calls: [...ItemLoader.callTitles] });
}
function throwCommand(g: Game, item: Item) {
    g.executeItemCommand('throw', item);
    g.executeCommand('mouse_travel', { x: 13, y: 10 });
}
const lastMessage = () => logger.messages.slice(-1)[0]?.text;

describe('X3-U3 D08 one engine removal gate', () => {
    for (const slot of slots) for (const operation of ['unequip', 'drop', 'throw'] as const) {
        it.each([false, true])(`${slot} ${operation}, known=%s: refuses without time, RNG, inventory, slots or knowledge mutation`, known => {
            const { g, item } = scene(slot, true, known), ask = vi.fn(() => true);
            g.onConfirmRequest = ask;
            const old = state(g);
            if (operation === 'throw') throwCommand(g, item); else g.executeItemCommand(operation, item);
            expect(state(g)).toEqual(old);
            expect(lastMessage()).toBe(operation === 'throw'
                ? `You cannot unequip your ${item.name}; it appears to be cursed.`
                : `you can't; your ${item.name} appears to be cursed.`);
            expect(ask).toHaveBeenCalledTimes(operation === 'throw' ? 1 : 0);
            expect(g.exportRecording().events.slice(-1)[0]?.decisions).toEqual(operation === 'throw' ? [true] : []);
        });
    }
    it.each(['equippedWeapon', 'equippedArmor'] as const)('%s cannot be replaced, even by an unidentified item', slot => {
        const { g, item } = scene(slot);
        const replacement = new Item('Replacement', '/', 0xffffff, item.category);
        g.player.inventory.addItem(replacement);
        const old = state(g); g.executeItemCommand('equip', replacement);
        expect(state(g)).toEqual(old); expect(g.player[slot]).toBe(item);
        expect(lastMessage()).toBe(`you can't; your ${item.name} appears to be cursed.`);
    });
    it('a full pair of rings keeps both cursed slots when a third ring is equipped', () => {
        const { g, item } = scene('ringLeft'); const right = install(g, 'ringRight');
        const third = new Item('Third Ring', '=', 0xffffff, C.RING); g.player.inventory.addItem(third);
        const old = state(g); g.executeItemCommand('equip', third);
        expect(state(g)).toEqual(old); expect(g.player.ringLeft).toBe(item); expect(g.player.ringRight).toBe(right);
    });
    it.each(slots)('%s low-level unequip refuses; explicit force removes it without revealing its curse', slot => {
        const { g, item } = scene(slot); const old = state(g);
        expect(g.player.unequip(item)).toBe(false); expect(state(g)).toEqual(old);
        expect(g.player.unequip(item, true)).toBe(true); expect(g.player[slot]).toBeNull();
        expect(item.identified).toBe(false); expect(item.isCursed).toBe(true);
        if (slot === 'equippedArmor') expect(g.player.getStatusDuration('donning')).toBe(0);
    });
    it.each([C.WEAPON, C.ARMOR])('Player.equip(%s, false) cannot bypass removal; force remains available to setup', category => {
        const p = new Player(1, 1), a = new Item('Old', '/', 0xffffff, category), b = new Item('New', '/', 0xffffff, category);
        a.isCursed = true; p.equip(a);
        const before = structuredClone(p); expect(p.equip(b, false)).toBe(false); expect(structuredClone(p)).toEqual(before);
        expect(p.equip(b, true)).toBe(true);
        expect(category === C.WEAPON ? p.equippedWeapon : p.equippedArmor).toBe(b);
    });
    for (const slot of slots) for (const operation of ['unequip', 'drop', 'throw'] as const) {
        it(`${slot} ordinary ${operation} succeeds and spends exactly one turn`, () => {
            const { g, item } = scene(slot, false), old = state(g);
            g.onConfirmRequest = () => true;
            if (operation === 'throw') throwCommand(g, item); else g.executeItemCommand(operation, item);
            expect(g.player[slot]).toBeNull(); expect(g.absoluteTurnNumber).toBe(old.turn + 1);
            expect(timeSystem.currentTick - old.tick).toBe(g.player.movementSpeed);
            expect(g.player.inventory.items.includes(item)).toBe(operation === 'unequip');
            expect(g.items.includes(item)).toBe(operation !== 'unequip');
            if (slot === 'equippedArmor') expect(g.player.getStatusDuration('donning')).toBe(0);
        });
    }
    it.each(['equippedWeapon', 'equippedArmor'] as const)('%s ordinary replacement spends only one turn', slot => {
        const { g, item } = scene(slot, false);
        const replacement = new Item('Replacement', '/', 0xffffff, item.category); replacement.armor = 7;
        g.player.inventory.addItem(replacement); const old = state(g);
        g.executeItemCommand('equip', replacement);
        expect(g.player[slot]).toBe(replacement); expect(g.player.inventory.items).toContain(item);
        expect(g.absoluteTurnNumber).toBe(old.turn + 1); expect(timeSystem.currentTick - old.tick).toBe(g.player.movementSpeed);
    });
    it('unknown ring refusal uses its flavor/call name without identifying its kind or enchantment', () => {
        const { g } = scene('ringLeft'); g.player.ringLeft = null; g.player.inventory.items = [];
        const ring = ItemLoader.spawnRing('ring_of_regeneration', -1, -1)!;
        ring.isCursed = true; ring.identified = false; ring.enchantment = -5;
        g.player.ringLeft = ring; g.player.inventory.addItem(ring);
        const name = ring.displayName, old = state(g); g.executeItemCommand('unequip', ring);
        expect(state(g)).toEqual(old); expect(lastMessage()).toBe(`you can't; your ${name} appears to be cursed.`);
        expect(lastMessage()).not.toContain('-5');
    });
    it('unequipped cursed gear may still be dropped and non-enchanted gear thrown', () => {
        const { g, item } = scene(); g.player.equippedWeapon = null;
        const ask = vi.fn(() => false); g.onConfirmRequest = ask; throwCommand(g, item);
        expect(ask).not.toHaveBeenCalled(); expect(g.items).toContain(item);
        const loose = install(g, 'equippedArmor'); g.player.equippedArmor = null;
        g.executeItemCommand('drop', loose); expect(g.items).toContain(loose);
    });
});

describe('X3-U3 D09 CE valuable-item confirmation', () => {
    it.each(slots)('%s No is asked before the curse refusal and preserves gameplay state', slot => {
        const { g, item } = scene(slot), ask = vi.fn(() => false), old = state(g);
        g.onConfirmRequest = ask; g.executeItemCommand('throw', item);
        const messages = logger.getState();
        g.executeCommand('mouse_travel', { x: 13, y: 10 });
        expect(ask).toHaveBeenCalledExactlyOnceWith(`Are you sure you want to throw your ${item.name}?`);
        expect(state(g)).toEqual(old); expect(logger.getState()).toEqual(messages);
        expect(g.exportRecording().events.slice(-1)[0]?.decisions).toEqual([false]);
    });
    it.each([false, true])('enchanted unequipped singleton answer=%s uses timesEnchanted and records the decision', answer => {
        const { g, item } = scene('equippedWeapon', false); g.player.equippedWeapon = null;
        item.timesEnchanted = 1; item.enchantment = 0;
        const ask = vi.fn(() => answer), old = state(g); g.onConfirmRequest = ask; throwCommand(g, item);
        expect(ask).toHaveBeenCalledExactlyOnceWith('Are you sure you want to throw your Sword?');
        expect(g.exportRecording().events.slice(-1)[0]?.decisions).toEqual([answer]);
        if (answer) { expect(g.items).toContain(item); expect(g.absoluteTurnNumber).toBe(old.turn + 1); }
        else expect(state(g)).toEqual(old);
    });
    it.each([false, true])('enchanted staff kindKnown=%s: prompt preserves flavor/call name but omits charges', known => {
        const { g } = scene(); g.player.equippedWeapon = null; g.player.inventory.items = [];
        const item = ItemLoader.spawnStaff('staff_of_fire', -1, -1)!;
        item.timesEnchanted = 1; item.identified = true; item.maxChargesKnown = true; item.charges = 3;
        const kind = (item as Item & { identityId: string }).identityId;
        if (known) ItemLoader.identifyItemKind(item);
        else ItemLoader.callTitles.set(kind, 'Sparks');
        g.player.inventory.addItem(item);
        const ask = vi.fn(() => false), old = state(g); g.onConfirmRequest = ask; throwCommand(g, item);
        expect(ask).toHaveBeenCalledExactlyOnceWith(known
            ? `Are you sure you want to throw your ${item.name}?`
            : 'Are you sure you want to throw your staff called Sparks?');
        expect(state(g)).toEqual(old);
    });
    it('natural positive enchantment is not timesEnchanted and does not prompt', () => {
        const { g, item } = scene('equippedWeapon', false); g.player.equippedWeapon = null;
        item.enchantment = 4; item.timesEnchanted = 0;
        const ask = vi.fn(() => false); g.onConfirmRequest = ask; throwCommand(g, item);
        expect(ask).not.toHaveBeenCalled(); expect(g.items).toContain(item);
    });
    it('CE refuses a loose cursed singleton with timesEnchanted >0 after Yes as well', () => {
        const { g, item } = scene(); g.player.equippedWeapon = null; item.timesEnchanted = 1;
        g.onConfirmRequest = () => true; const old = state(g); throwCommand(g, item);
        expect(state(g)).toEqual(old); expect(lastMessage()).toBe('You cannot unequip your Sword; it appears to be cursed.');
    });
    it('cursed equipped enchanted stack throws one without asking; drop still refuses the remainder', () => {
        const { g, item } = scene(); item.quantity = 3; item.timesEnchanted = 2;
        const ask = vi.fn(() => false); g.onConfirmRequest = ask; const oldTurn = g.absoluteTurnNumber;
        throwCommand(g, item);
        expect(ask).not.toHaveBeenCalled(); expect(item.quantity).toBe(2); expect(g.player.equippedWeapon).toBe(item);
        expect(g.items).toHaveLength(1); expect(g.items[0]?.quantity).toBe(1); expect(g.items[0]?.id).not.toBe(item.id);
        expect(g.absoluteTurnNumber).toBe(oldTurn + 1);
        const beforeDrop = state(g); g.executeItemCommand('drop', item); expect(state(g)).toEqual(beforeDrop);
        expect(lastMessage()).toBe("you can't; your Sword appear to be cursed.");
    });
    it('throwing a ring removes it from the equipment effect consumers', () => {
        const { g } = scene('ringLeft', false); g.player.ringLeft = null; g.player.inventory.items = [];
        const ring = ItemLoader.spawnRing('ring_of_regeneration', -1, -1)!;
        ring.isCursed = false; ring.enchantment = 3; ring.identified = true;
        g.player.inventory.addItem(ring); g.equipItem(ring);
        g.onConfirmRequest = () => true; throwCommand(g, ring);
        expect(g.player.ringLeft).toBeNull(); expect(g.player.rings()).toEqual([]); expect(g.items).toContain(ring);
    });
    it('Chinese messages use the same engine gate and confirmation', async () => {
        const { g, item } = scene(); i18next.addResourceBundle('zh_CN', 'translation', zhCN); await i18next.changeLanguage('zh_CN');
        g.executeItemCommand('unequip', item); expect(lastMessage()).toBe('你办不到；你的Sword似乎受到了诅咒。');
        const ask = vi.fn(() => true); g.onConfirmRequest = ask; throwCommand(g, item);
        expect(ask).toHaveBeenCalledExactlyOnceWith('你确定要投掷你的Sword吗？');
        expect(lastMessage()).toBe('你无法卸下Sword；它似乎受到了诅咒。');
    });
});

describe('X3-U3 recording and replay', () => {
    it.each([false, true])('natural starting weapon No then Yes, animation=%s: public replay and seek have zero OOS', animated => {
        const g = createHeadlessGame(33003, 'test'); g.animationEnabled = animated;
        const settle = () => { for (let i = 0; i < 10000 && g.isAdvancing; i++) g.stepAdvancement(); expect(g.isAdvancing).toBe(false); };
        const weapon = g.player.equippedWeapon!; expect(weapon.isCursed).toBe(false); expect(weapon.quantity).toBe(1);
        const target = { ...g.player.loc };
        g.onConfirmRequest = () => false;
        g.executeItemCommand('throw', weapon); g.executeCommand('mouse_travel', target); settle();
        g.onConfirmRequest = () => true;
        g.executeItemCommand('throw', weapon); g.executeCommand('mouse_travel', target); settle();
        const recording = g.exportRecording(), final = state(g);
        expect(recording.events.map(e => e.decisions)).toEqual([[], [false], [], [true]]);
        expect(g.loadReplay(recording)).toBe(true); g.onConfirmRequest = () => { throw new Error('Replay opened UI'); };
        for (let i = 0; i < recording.events.length; i++) { g.replayStep(); settle(); }
        expect(g.replayError).toBeNull(); expect(g.replayCursor).toBe(4); expect(state(g)).toEqual(final);
        g.replaySeek(0); g.replaySeek(4); settle(); expect(g.replayError).toBeNull(); expect(state(g)).toEqual(final);
    });
    it('cursed unequip/drop/replacement/throw replay and seek preserve refusals with zero OOS', () => {
        const { g, item } = scene(); const replacement = new Item('Replacement', '/', 0xffffff, C.WEAPON);
        g.player.inventory.addItem(replacement); g.onConfirmRequest = () => true;
        g.executeItemCommand('unequip', item); g.executeItemCommand('drop', item); g.executeItemCommand('equip', replacement); throwCommand(g, item);
        const recording = g.exportRecording(), final = state(g), start = g.startNewGame.bind(g);
        vi.spyOn(g, 'startNewGame').mockImplementation(options => {
            start(options); room(g); install(g, 'equippedWeapon');
            g.player.inventory.addItem(new Item('Replacement', '/', 0xffffff, C.WEAPON));
        });
        expect(g.loadReplay(recording)).toBe(true); g.onConfirmRequest = () => { throw new Error('Replay opened UI'); };
        for (let i = 0; i < recording.events.length; i++) g.replayStep();
        expect(g.replayError).toBeNull(); expect(state(g)).toEqual(final);
        g.replaySeek(0); g.replaySeek(recording.events.length); expect(g.replayError).toBeNull(); expect(state(g)).toEqual(final);
    });
});
