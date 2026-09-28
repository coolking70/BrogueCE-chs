import { afterEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import zhCN from '../locales/zh_CN.json';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Item, ItemCategory as C } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { TerrainType as T } from '../engine/Map/Grid';
import { CombatSystem } from '../engine/Combat/Combat';
import { Monster, type MonsterData } from '../entities/Monster';
import monsterData from '../data/monsters.json';
import { logger } from '../engine/Systems/Logger';
import { timeSystem } from '../engine/Systems/Time';
import { rng } from '../engine/Random';

const AVOIDS = 'ITEM_PLAYER_AVOIDS';
afterEach(() => { vi.restoreAllMocks(); void i18next.changeLanguage('en'); });
function room(g: Game) {
    g.animationEnabled = false; g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.visibleItems.clear(); g.visibleMonsters.clear(); g.player.inventory.items = [];
    g.player.equippedWeapon = g.player.equippedArmor = g.player.ringLeft = g.player.ringRight = null;
    g.player.loc = { x: 10, y: 10 };
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x >= 8 && x <= 18 && y >= 8 && y <= 12 ? T.FLOOR : T.GRANITE);
        const c = g.grid.getCell(x, y)!;
        Object.assign(c, { isExplored: true, hasMemory: true, isVisible: true, isMagicMapped: false,
            isClairvoyantVisible: false, isDiscovered: false, machineNumber: 0,
            rememberedLayers: [...c.layers], rememberedItem: null });
    }
    logger.reset();
}
function scene() { const g = createHeadlessGame(33008, 'test'); room(g); return g; }
function item(g: Game, category: C, name = 'Test item') {
    const i = new Item(name, '!', 0xffffff, category); g.player.inventory.addItem(i); return i;
}
const messages = () => logger.messages.map(m => m.text);
function state(g: Game) {
    return structuredClone({ player: g.player, items: g.items, tick: timeSystem.currentTick,
        turn: g.absoluteTurnNumber, stats: g.stats, rng: rng.getState(), knowledge: [...ItemLoader.identifiedItems] });
}
function explore(g: Game) {
    g.executeCommand('auto_explore');
    for (let n = 0; n < 30 && g.autoPath.length; n++) g.executeCommand('auto_step');
    expect(g.autoPath).toHaveLength(0);
}
function rings(g: Game) {
    const left = item(g, C.RING, 'Left ring'), right = item(g, C.RING, 'Right ring'), third = item(g, C.RING, 'Third ring');
    g.player.ringLeft = left; g.player.ringRight = right;
    return { left, right, third };
}

describe('X3-U8b A08 strengthCheck messages', () => {
    for (const category of [C.WEAPON, C.ARMOR]) {
        it.each([0, 4, 20])(`category ${category}, weakness %s uses effective strength with zero-clamped deficiency`, weakness => {
            const g = scene(), gear = item(g, category, 'Heavy gear');
            Object.assign(gear, { strengthRequired: 18, enchantment: 5, runicType: 'slaying', runicKnown: true });
            g.player.weaknessAmount = weakness;
            const end = vi.spyOn(g as any, 'playerTurnEnded').mockImplementation(() => {});
            const beforeRng = rng.getState(), beforeGear = structuredClone(gear), tick = timeSystem.currentTick;
            g.equipItem(gear);
            const deficit = 18 - Math.max(0, 12 - weakness);
            expect(messages()).toContain(category === C.WEAPON
                ? `You can barely lift the Heavy gear; ${deficit} more strength would be ideal.`
                : `You stagger under the weight of the Heavy gear; ${deficit} more strength would be ideal.`);
            expect(structuredClone(gear)).toEqual(beforeGear); expect(rng.getState()).toEqual(beforeRng);
            expect(g.player.strength).toBe(12); expect(g.player.weaknessAmount).toBe(weakness);
            expect(timeSystem.currentTick - tick).toBe(g.player.movementSpeed); expect(end).toHaveBeenCalledOnce();
        });
    }
    it('sufficient strength and rings have no strength warning', () => {
        const g = scene(), sword = item(g, C.WEAPON); sword.strengthRequired = 12;
        g.equipItem(sword); const ring = item(g, C.RING); ring.strengthRequired = 100; g.equipItem(ring);
        expect(messages().some(m => /barely lift|stagger under/.test(m))).toBe(false);
    });
});

describe('X3-U8b A09 pack and persistent avoidance', () => {
    it('full pack walking emits CE message, marks floor item, and repeated exploration never retries it', () => {
        const g = scene(); item(g, C.FOOD, 'Ration').quantity = 26;
        const loot = new Item('Loot', '!', 0xffffff, C.POTION); loot.loc = { x: 11, y: 10 }; g.items.push(loot);
        g.executeCommand('move', { x: 1, y: 0 });
        expect(messages()).toContain('Your pack is too full to pick up Loot.');
        expect(loot.flags).toContain(AVOIDS); expect(g.items).toContain(loot);
        g.executeCommand('move', { x: -1, y: 0 });
        const add = vi.spyOn(g.player.inventory, 'addItem'); explore(g); explore(g);
        expect(add).not.toHaveBeenCalled(); expect(g.items).toContain(loot);
        expect(messages().filter(m => m.includes('too full'))).toHaveLength(1);
    });
    it('explicit pickup full marks avoidance without a turn or RNG; making room permits retry', () => {
        const g = scene(), food = item(g, C.FOOD); food.quantity = 26;
        const loot = new Item('Loot', '!', 0xffffff, C.POTION); loot.loc = { ...g.player.loc }; g.items.push(loot);
        const old = state(g); g.executeCommand('pickup');
        expect(g.absoluteTurnNumber).toBe(old.turn); expect(rng.getState()).toEqual(old.rng);
        expect(loot.flags).toEqual([AVOIDS]); expect(messages()).toContain('Your pack is too full to pick up Loot.');
        food.quantity--; g.executeCommand('pickup'); expect(g.player.inventory.items).toContain(loot);
    });
    it.each([C.GOLD, C.WEAPON, C.GEM])('full pack keeps gold/stack exception for category %s', category => {
        const g = scene(); item(g, C.FOOD).quantity = 25;
        const held = item(g, category, 'Stack'); held.quiverNumber = category === C.WEAPON ? 77 : undefined; held.originDepth = 1;
        const loot = new Item('Stack', '!', 0xffffff, category);
        Object.assign(loot, { quiverNumber: held.quiverNumber, originDepth: 1, loc: { x: 11, y: 10 }, quantity: 3 });
        g.items.push(loot); g.executeCommand('move', { x: 1, y: 0 });
        expect(g.items).not.toContain(loot); expect(loot.flags ?? []).not.toContain(AVOIDS);
        expect(messages().some(m => m.includes('too full'))).toBe(false);
        if (category === C.GOLD) expect(g.stats.gold).toBe(3); else expect(held.quantity).toBe(4);
    });
    it('drop splits flags independently, persists avoidance, and visible/remembered exploration ignores it', () => {
        const g = scene(), food = item(g, C.FOOD, 'Ration'); food.quantity = 2; food.flags = ['OTHER'];
        g.executeItemCommand('drop', food); const floor = g.items[0]!;
        expect(floor.flags).toEqual(['OTHER', AVOIDS]); expect(food.flags).toEqual(['OTHER']);
        g.executeCommand('move', { x: 1, y: 0 }); explore(g); expect(g.items).toContain(floor);
        const saved = JSON.parse(JSON.stringify(g.toSnapshot())); expect(g.loadSnapshot(saved)).toBe(true);
        const restored = g.items.find(i => i.id === floor.id)!; expect(restored.flags).toEqual(['OTHER', AVOIDS]);
        const c = g.grid.getCell(restored.loc.x, restored.loc.y)!;
        c.isVisible = false; c.rememberedItem = { name: restored.name, char: restored.char, color: restored.color };
        (g as any).recomputeExplorePath(); expect(g.autoPath).toHaveLength(0); expect(g.items).toContain(restored);
        expect(g.player.inventory.items[0]!.flags).toEqual(['OTHER']);
    });
    it('automatic travel crosses avoided loot without pickup; manual walking can recover it', () => {
        const g = scene(), loot = new Item('Loot', '!', 0xffffff, C.FOOD);
        loot.loc = { x: 11, y: 10 }; loot.flags = [AVOIDS]; g.items.push(loot);
        g.executeCommand('mouse_travel', { x: 13, y: 10 });
        for (let n = 0; n < 5 && g.autoPath.length; n++) g.executeCommand('auto_step');
        // Existing movement stops on a floor item even when pickup is skipped.
        expect(g.items).toContain(loot); expect(g.player.x).toBe(11);
        g.executeCommand('move', { x: 1, y: 0 }); g.executeCommand('move', { x: -1, y: 0 });
        expect(g.items).not.toContain(loot); expect(g.player.inventory.items).toContain(loot);
    });
    it('an avoided item does not hide collectable loot on the same cell', () => {
        const g = scene(), avoided = new Item('Avoided', ':', 0xffffff, C.FOOD), loot = new Item('Loot', '!', 0xffffff, C.POTION);
        avoided.flags = [AVOIDS]; avoided.loc = loot.loc = { x: 11, y: 10 }; g.items.push(avoided, loot);
        explore(g); expect(g.items).toContain(avoided); expect(g.items).not.toContain(loot);
        expect(g.player.inventory.items).toContain(loot);
    });
    it('avoidance survives cached-level JSON roundtrip and return, with no RNG consumed by load', () => {
        const g = createHeadlessGame(33008); room(g);
        const food = item(g, C.FOOD, 'Ration');
        g.executeItemCommand('drop', food); const id = food.id;
        g.depth = 2; (g as any).generateDepth(false);
        const saved = JSON.parse(JSON.stringify(g.toSnapshot()));
        expect(saved.levels.find((l: any) => l.depth === 1).items.find((i: any) => i.id === id).flags).toContain(AVOIDS);
        const beforeRng = rng.getState(); expect(g.loadSnapshot(saved)).toBe(true); expect(rng.getState()).toEqual(beforeRng);
        g.depth = 1; (g as any).generateDepth(true);
        expect(g.items.find(i => i.id === id)?.flags).toContain(AVOIDS);
    });
    it.each([C.FOOD, C.WEAPON])('empty throw category %s is avoided with independent remainder; explore does not recover it', category => {
        const g = scene(), thrown = item(g, category); thrown.quantity = 2; thrown.flags = ['OTHER'];
        g.throwItemAt(thrown, 13, 10); const floor = g.items[0]!;
        expect(floor.flags).toEqual(['OTHER', AVOIDS]); expect(thrown.flags).toEqual(['OTHER']);
        explore(g); expect(g.items).toContain(floor);
    });
    it('weapon that misses a creature clears inherited avoidance and becomes an exploration goal', () => {
        const g = scene(), dart = item(g, C.WEAPON, 'Dart'); dart.flags = [AVOIDS, 'OTHER']; dart.quantity = 2;
        const monster = new Monster(13, 10, monsterData.find(m => m.id === 'rat')! as MonsterData); g.monsters.push(monster);
        vi.spyOn(CombatSystem, 'resolveThrownWeapon').mockReturnValue({ hit: false, damage: 0, killed: false });
        const end = vi.spyOn(g as any, 'playerTurnEnded').mockImplementation(() => {});
        g.throwItemAt(dart, 13, 10); end.mockRestore(); g.monsters = [];
        const floor = g.items[0]!; expect(floor.flags).toEqual(['OTHER']); expect(dart.flags).toEqual([AVOIDS, 'OTHER']);
        explore(g); expect(g.items).not.toContain(floor); expect(g.player.inventory.items).toContain(floor);
    });
});

describe('X3-U8b A10 equipment branches', () => {
    it.each([C.WEAPON, C.ARMOR])('repeated category %s equip command refuses without refreshing or consuming a turn', category => {
        const g = scene(), gear = item(g, category); gear.armor = 4;
        g.executeItemCommand('equip', gear); const old = state(g);
        g.executeItemCommand('equip', gear); expect(state(g)).toEqual(old);
        expect(messages()).toContain('already equipped.');
    });
    it('already worn ring is rejected before filling the second slot or spending a turn', () => {
        const g = scene(), ring = item(g, C.RING); g.player.ringLeft = ring; const old = state(g);
        g.equipItem(ring); expect(state(g)).toEqual(old); expect(messages()).toEqual(['you are already wearing that ring.']);
    });
    it.each(['left', 'right'] as const)('two rings prompt without mutation; replacing %s spends one turn', slot => {
        const g = scene(), r = rings(g), old = state(g); g.executeItemCommand('equip', r.third);
        expect(state(g)).toEqual(old); expect(messages()).toEqual(['You are already wearing two rings; remove which first?']);
        g.executeItemCommand('equip', r.third, r[slot].inventoryLetter);
        expect(slot === 'left' ? g.player.ringLeft : g.player.ringRight).toBe(r.third);
        expect(slot === 'left' ? g.player.ringRight : g.player.ringLeft).toBe(slot === 'left' ? r.right : r.left);
        expect(g.absoluteTurnNumber).toBe(old.turn + 1); expect(timeSystem.currentTick - old.tick).toBe(g.player.movementSpeed);
        expect(g.exportRecording().events.slice(-1)[0]?.data).toBe(`equip|${r.third.inventoryLetter}|${r[slot].inventoryLetter}`);
    });
    it('cancel, invalid target and cursed replacement preserve gameplay and RNG', () => {
        const g = scene(), r = rings(g); r.left.isCursed = true; const old = state(g);
        g.executeItemCommand('equip', r.third); g.executeCommand('escape'); expect(state(g)).toEqual(old);
        g.executeItemCommand('equip', r.third, r.third.inventoryLetter); expect(state(g)).toEqual(old); expect(messages()).toContain('Invalid entry.');
        g.executeItemCommand('equip', r.third, r.left.inventoryLetter); expect(state(g)).toEqual(old);
        expect(messages()).toContain("you can't; your Left ring appears to be cursed.");
    });
    it.each([1, 2])('unequipped quantity %s reports singular/plural without mutation', quantity => {
        const g = scene(), sword = item(g, C.WEAPON, 'Sword'); sword.quantity = quantity; const old = state(g);
        expect(g.unequipItem(sword)).toBe(false); expect(state(g)).toEqual(old);
        expect(messages()).toEqual([`your Sword ${quantity === 1 ? 'was' : 'were'} not equipped.`]);
    });
    it.each([C.FOOD, C.WEAPON, C.ARMOR])('T_OBSTRUCTS_ITEMS refuses category %s before splitting or unequipping', category => {
        const g = scene(), gear = item(g, category); gear.quantity = 2; if (category !== C.FOOD) g.player.equip(gear);
        g.grid.setTerrain(10, 10, T.GRANITE); const old = state(g);
        g.dropItem(gear); expect(state(g)).toEqual(old); expect(messages()).toEqual(['There is already something there.']);
    });
    it('Chinese A08/A09/A10 text uses the same branches', async () => {
        const g = scene(); i18next.addResourceBundle('zh_CN', 'translation', zhCN); await i18next.changeLanguage('zh_CN');
        const gear = item(g, C.WEAPON, 'Sword'); gear.strengthRequired = 18; g.equipItem(gear);
        expect(messages()).toContain('你几乎举不起Sword；还需要 6 点力量。');
        const r = rings(g); g.equipItem(r.left); g.equipItem(r.third);
        expect(messages()).toContain('你已经戴着那枚戒指了。'); expect(messages()).toContain('你已经戴着两枚戒指；先取下哪一枚？');
        g.grid.setTerrain(10, 10, T.GRANITE); g.dropItem(gear); expect(messages()).toContain('那里已经有东西了。');
    });
});

describe('X3-U8b replay and seek', () => {
    it('ring choice, drop and avoidance reconstruct through public commands with zero OOS', () => {
        const g = scene(); let r = rings(g);
        g.executeItemCommand('equip', r.third); g.executeCommand('escape');
        g.executeItemCommand('equip', r.third); g.executeItemCommand('equip', r.third, r.right.inventoryLetter);
        g.executeItemCommand('drop', r.third); g.executeCommand('move', { x: 1, y: 0 }); explore(g);
        const recording = g.exportRecording(), final = state(g), start = g.startNewGame.bind(g);
        vi.spyOn(g, 'startNewGame').mockImplementation(options => { start(options); room(g); r = rings(g); });
        expect(g.loadReplay(recording)).toBe(true);
        for (let n = 0; n < recording.events.length; n++) g.replayStep();
        expect(g.replayError).toBeNull(); expect(state(g)).toEqual(final);
        g.replaySeek(0); g.replaySeek(recording.events.length); expect(g.replayError).toBeNull(); expect(state(g)).toEqual(final);
    });
});
