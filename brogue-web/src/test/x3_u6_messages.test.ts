import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Logger, logger, MESSAGE_ARCHIVE_ENTRIES, MAX_MESSAGE_REPEATS } from '../engine/Systems/Logger';
import { buildMapToShore, shoreWarning } from '../engine/Map/MapToShore';
import { Grid, TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { rng } from '../engine/Random';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import type { StatusId } from '../entities/Creature';
import { acknowledgmentKeys } from '../ui/messageAcknowledgment';

function room(g: Game) {
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.player.loc = { x: 10, y: 10 };
    g.player.statusDurations = {}; g.player.maxStatus = {};
    g.player.inventory.items = []; g.player.equippedArmor = null; g.player.equippedWeapon = null;
    g.player.refreshSpeeds();
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x >= 4 && x <= 30 && y >= 4 && y <= 20 ? T.FLOOR : T.GRANITE);
        const c = g.grid.getCell(x, y)!;
        Object.assign(c, { isVisible: true, isExplored: true, hasMemory: true, isMagicMapped: false,
            autoSearched: true, rememberedLayers: [...c.layers], rememberedItem: null });
    }
    logger.reset(); g.disturbed = false;
}
function scene() { const g = createHeadlessGame(33006, 'test'); room(g); return g; }
function privateGame(g: Game): any { return g; }
function state(g: Game) { const snapshot = g.toSnapshot(); snapshot.savedAt = 0; return snapshot; }
afterEach(() => { logger.presentAcknowledgments(null); vi.restoreAllMocks(); });

describe('X3-U6 CE message archive', () => {
    it('folds nonadjacent duplicates on the same turn without reordering, and still disturbs', () => {
        const log = new Logger(), disturb = vi.fn(); log.onDisturb = disturb; log.turn = 7;
        log.log('a'); log.log('b'); log.log('a', '#fff', { foldable: true });
        expect(log.messages.map(m => [m.text, m.count, m.turn])).toEqual([['a', 2, 7], ['b', 1, 7]]);
        expect(disturb).toHaveBeenCalledTimes(3);
    });
    it('CE !FOLDABLE allows latest cross-turn folding; combat FOLDABLE does not', () => {
        const log = new Logger(); log.log('a'); log.turn = 1; log.log('a');
        expect(log.messages).toHaveLength(1); expect(log.messages[0]).toMatchObject({ count: 2, turn: 1 });
        log.turn = 2; log.combat('a'); log.flushCombat(); expect(log.messages).toHaveLength(2);
        log.turn = 3; log.log('b'); log.log('a'); expect(log.messages).toHaveLength(4);
    });
    it('caps repeats at 100 and history at 1360; skips empty text', () => {
        const log = new Logger(); log.log('');
        for (let i = 0; i < 150; i++) log.log('repeat');
        expect(log.messages[0]!.count).toBe(MAX_MESSAGE_REPEATS);
        for (let i = 0; i < MESSAGE_ARCHIVE_ENTRIES; i++) log.log(String(i));
        expect(log.messages).toHaveLength(1360); expect(log.messages[0]!.text).toBe('0');
    });
    it('does not search the 1360th old entry when full, matching the CE ring scan', () => {
        const log = new Logger(); for (let i = 0; i < 1360; i++) log.log(String(i));
        log.log('0'); expect(log.messages[0]!.text).toBe('1');
        expect(log.messages[1359]).toMatchObject({ text: '0', count: 1 });
    });
    it('archives flags/turn, keeps pending acknowledgments outside snapshots and clears them on restore', () => {
        const log = new Logger(); log.presentAcknowledgments(() => true);
        log.turn = 9; log.log('danger', '#ff0', { acknowledge: true }); const saved = log.getState();
        expect(saved.messages[0]).toMatchObject({ turn: 9, acknowledge: true });
        expect(log.pendingAcknowledgment?.text).toBe('danger'); log.acknowledgeNext();
        expect(log.getState()).toEqual(saved);
        log.log('next', '#fff', { acknowledge: true }); log.setState(saved);
        expect(log.pendingAcknowledgment).toBeUndefined(); expect(log.getState()).toEqual(saved);
    });
    it('each folded occurrence needs acknowledgment, including after count saturation', () => {
        const log = new Logger(); log.presentAcknowledgments(() => true);
        for (let i = 0; i < 102; i++) log.log('danger', '#ff0', { acknowledge: true });
        for (let i = 0; i < 102; i++) { expect(log.pendingAcknowledgment).toBeDefined(); log.acknowledgeNext(); }
        expect(log.pendingAcknowledgment).toBeUndefined(); expect(log.messages[0]!.count).toBe(100);
    });
});

describe('X3-U6 presentation acknowledgments', () => {
    it('blocks commands before recording and confirmation changes no world, time, RNG or decisions', () => {
        const g = scene(); logger.presentAcknowledgments(() => !g.replayRecording);
        logger.log('danger', '#ff0', { acknowledge: true }); const before = state(g), random = rng.getState();
        g.executeCommand('wait'); expect(state(g)).toEqual(before);
        logger.acknowledgeNext(); expect(state(g)).toEqual(before); expect(rng.getState()).toEqual(random);
        g.executeCommand('wait'); expect(g.stats.turns).toBe(before.stats.turns + 1);
    });
    it('consumes one key and its autorepeat/key-up, without dispatching a game command', () => {
        logger.presentAcknowledgments(() => true); const keys = acknowledgmentKeys();
        logger.log('one', '#fff', { acknowledge: true }); logger.log('two', '#fff', { acknowledge: true });
        const key = (repeat = false) => ({ key: 'ArrowRight', code: 'ArrowRight', repeat,
            preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }) as unknown as KeyboardEvent;
        const first = key(); keys.keydown(first); expect(first.stopImmediatePropagation).toHaveBeenCalledOnce();
        expect(logger.pendingAcknowledgment?.text).toBe('two');
        keys.keydown(key(true)); expect(logger.pendingAcknowledgment?.text).toBe('two');
        keys.keyup(key()); keys.keydown(key()); expect(logger.pendingAcknowledgment).toBeUndefined();
        const repeat = key(true); keys.keydown(repeat); expect(repeat.preventDefault).toHaveBeenCalledOnce();
        keys.keyup(key()); const next = key(); keys.keydown(next); expect(next.preventDefault).not.toHaveBeenCalled();
    });
    it('replay/seek bypass pending display and preserve real checkpoints', () => {
        const g = createHeadlessGame(424242); g.executeCommand('wait'); g.executeCommand('wait');
        const recording = g.exportRecording(); logger.presentAcknowledgments(() => !g.replayRecording);
        logger.log('old live warning', '#ff0', { acknowledge: true }); expect(g.loadReplay(recording)).toBe(true);
        logger.log('playback warning', '#ff0', { acknowledge: true });
        expect(logger.pendingAcknowledgment).toBeUndefined(); g.replayStep(); g.replaySeek(2);
        expect(g.replayError).toBeNull(); expect(g.replayCursor).toBe(2);
    });
    it('a warning interrupts an active route through U4 disturbed, without another move', () => {
        const g = scene(); g.handleMouseTravel(25, 10); expect(g.autoPath.length).toBeGreaterThan(0);
        logger.log('danger', '#ff0', { acknowledge: true }); const before = { ...g.player.loc }, turns = g.stats.turns;
        g.stepAutoPath(); expect(g.autoPath).toEqual([]); expect(g.player.loc).toEqual(before); expect(g.stats.turns).toBe(turns);
    });
});

describe('X3-U6 mapToShore and warning latch', () => {
    it('uses all layers, diagonal obstruction, secret shores, and no RNG', () => {
        const grid = new Grid(9, 9);
        for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) grid.setTerrain(x, y, T.GRANITE);
        for (let x = 1; x < 8; x++) grid.setTerrain(x, 4, T.WATER_DEEP);
        grid.setTerrain(1, 4, T.FLOOR); const random = rng.getState();
        expect(buildMapToShore(grid)[4]![4]).toBe(3);
        grid.setTerrainLayer(4, 4, L.SURFACE, T.PLAIN_FIRE); expect(buildMapToShore(grid)[4]![4]).toBe(3);
        grid.setTerrain(4, 3, T.TRAP_DOOR_HIDDEN); expect(buildMapToShore(grid)[4]![4]).toBe(1);
        grid.setTerrain(4, 3, T.GRANITE); grid.setTerrain(1, 4, T.GRANITE); grid.setTerrain(3, 3, T.FLOOR); grid.setTerrain(3, 4, T.GRANITE);
        expect(buildMapToShore(grid)[4]![4]).toBe(30000);
        grid.setTerrain(4, 3, T.DOOR); expect(buildMapToShore(grid)[4]![4]).toBeLessThan(30000);
        expect(rng.getState()).toEqual(random);
    });
    it.each([[3,100,4,'return'], [3,100,3,'return'], [3,100,2,'past'], [3,100,5,null],
        [3,50,1,'return'], [3,200,10,'past'], [3,200,12,'return'], [30000,100,3,null]] as const)
    ('CE distance %i, speed %i, duration %i => %s', (distance, speed, duration, expected) => {
        expect(shoreWarning(distance, speed, duration)).toBe(expected);
    });
    it.each([T.WATER_DEEP, T.LAVA, T.CHASM])('warns over %s once, persists latch, resets on land, zero RNG', tile => {
        const g = scene(); g.grid.setTerrain(10, 10, tile); g.player.setStatusDuration('levitating', 2);
        const random = rng.getState(); privateGame(g).checkShoreWarning();
        expect(logger.messages[0]).toMatchObject({ text: 'better head back to solid ground!', acknowledge: true });
        expect(g.receivedLevitationWarning).toBe(true); privateGame(g).checkShoreWarning(); expect(logger.messages[0]!.count).toBe(1);
        const saved = state(g); expect(g.loadSnapshot(saved)).toBe(true); privateGame(g).checkShoreWarning();
        expect(logger.messages[0]!.count).toBe(1); expect(rng.getState()).toEqual(random);
        g.grid.setTerrain(10, 10, T.FLOOR); privateGame(g).checkShoreWarning(); expect(g.receivedLevitationWarning).toBe(false);
        g.grid.setTerrain(10, 10, tile); privateGame(g).checkShoreWarning(); expect(logger.messages[0]!.count).toBe(2);
        g.startNewGame({ seed: 33006, mode: 'test' }); expect(g.receivedLevitationWarning).toBe(false);
    });
    it('fire immunity protects lava only, uses max duration, and real turn epilogue warns after countdown', () => {
        const g = scene(); g.grid.setTerrain(10, 10, T.LAVA); g.player.setStatusDuration('immune_fire', 3);
        g.player.setStatusDuration('levitating', 1); privateGame(g).checkShoreWarning(); expect(logger.messages).toEqual([]);
        g.executeCommand('wait'); expect(logger.messages.some(m => m.acknowledge && m.text.includes('solid ground'))).toBe(true);
        g.receivedLevitationWarning = false; logger.reset(); g.player.setStatusDuration('levitating', 0);
        g.grid.setTerrain(10, 10, T.WATER_DEEP); privateGame(g).checkShoreWarning(); expect(logger.messages).toEqual([]);
    });
});

describe('X3-U6 CE prose and acknowledgment producers', () => {
    it.each([
        ['haste','your supernatural speed fades.'], ['hasted','your supernatural speed fades.'],
        ['slowed','your normal speed resumes.'], ['immune_fire','you no longer feel immune to fire.'],
        ['confused','you no longer feel confused.'], ['hallucinating','your hallucinations fade.'],
        ['telepathy','your preternatural mental sensitivity fades.'], ['levitating','you are no longer levitating.'],
        ['darkness','the cloak of darkness lifts from your vision.'],
        ['weakened','strength returns to your muscles as the weakening toxin wears off.'],
    ])('expiration %s has its own CE prose', (status, text) => {
        const g = scene(); g.player.setStatusDuration(status as StatusId, 1);
        privateGame(g).tickCreatureStatuses(); expect(logger.messages.some(m => m.text === text && !m.acknowledge)).toBe(true);
    });
    it('regeneration expires silently; confusion and hallucination remain separate on the same turn', () => {
        const g = scene(); g.player.setStatusDuration('regenerating', 1); privateGame(g).tickCreatureStatuses(); expect(logger.messages).toEqual([]);
        g.player.setStatusDuration('confused', 1); g.player.setStatusDuration('hallucinating', 1);
        privateGame(g).tickCreatureStatuses(); expect(logger.messages).toHaveLength(2);
    });
    it.each(['hungry','weak','faint','starving'] as const)('hunger %s has food suffix and CE acknowledgment policy', tier => {
        const g = scene(); privateGame(g).logHungerTransition(tier);
        expect(logger.messages[0]!.acknowledge).toBe(true);
        expect(logger.messages[0]!.text.includes(' and have no food')).toBe(tier !== 'starving');
        logger.reset(); g.player.inventory.addItem(ItemLoader.spawnFood('ration_of_food', -1, -1)!);
        privateGame(g).logHungerTransition(tier);
        expect(!!logger.messages[0]!.acknowledge).toBe(tier !== 'hungry');
        expect(logger.messages[0]!.text).not.toContain('no food');
    });
    it.each(['scroll_of_identify','scroll_of_enchantment'])('%s self-description requires acknowledgment', id => {
        const g = scene(), scroll = ItemLoader.spawnScroll(id,-1,-1)!;
        g.player.inventory.addItem(scroll); g.readItem(scroll);
        expect(logger.messages.find(m => m.text.startsWith('This is a scroll'))?.acknowledge).toBe(true);
    });
    it('invalid enchantment target requires acknowledgment but no turn or loss of selection', () => {
        const g = scene(); g.pendingEnchantment = true;
        const food = ItemLoader.spawnFood('ration_of_food', -1, -1)!; g.player.inventory.addItem(food);
        const turn = g.stats.turns; expect(g.chooseEnchantTarget(food)).toBe(false);
        expect(logger.messages[0]).toMatchObject({ text: "Can't enchant that.", acknowledge: true });
        expect(g.pendingEnchantment).toBe(true); expect(g.stats.turns).toBe(turn);
    });
    it('paralysis and lava are acknowledgment messages', () => {
        const g = scene(); privateGame(g).applyTimedStatus(g.player, 'paralyzed', 5);
        expect(logger.messages[0]!.acknowledge).toBe(true); g.player.setStatusDuration('paralyzed',0);
        g.grid.setTerrain(10,10,T.LAVA); privateGame(g).applyEnvironmentalEffects(g.player);
        expect(logger.messages.find(m => m.text.includes('incinerated'))?.acknowledge).toBe(true);
    });
    it('native plate entry warns for a visible creature; invisible occupant only clicks; unseen stays silent', () => {
        const g = scene(), rat = new Monster(12,10,monsters.find(m => m.id === 'rat')! as MonsterData);
        g.monsters.push(rat); g.grid.setTerrain(12,10,T.GAS_TRAP_POISON_HIDDEN);
        privateGame(g).applyDisplacementTileEntry(rat); expect(logger.messages.some(m => m.acknowledge && m.text.includes('pressure plate'))).toBe(true);
        logger.reset(); g.grid.setTerrain(12,10,T.FLOOR); rat.setStatusDuration('invisible',5); privateGame(g).logPressurePlate(12,10,rat);
        expect(logger.messages[0]).toMatchObject({ text: 'a pressure plate clicks!' }); expect(logger.messages[0]!.acknowledge).toBeUndefined();
        logger.reset(); g.grid.getCell(12,10)!.isVisible = false; privateGame(g).logPressurePlate(12,10,rat); expect(logger.messages).toEqual([]);
    });
    it.each(['pickup','displacement'] as const)('%s names the retained stack and inventory letter, gold bypasses pack', mode => {
        const g = scene(), first = ItemLoader.spawnFood('ration_of_food',-1,-1)!;
        first.quantity = 2; first.inventoryLetter = 'q'; g.player.inventory.addItem(first);
        const second = ItemLoader.spawnFood('ration_of_food',10,10)!; g.items.push(second);
        if (mode === 'pickup') g.executeCommand('pickup'); else privateGame(g).pickUpItemAfterDisplacement();
        expect(logger.messages[0]!.text).toBe('you now have 3 Ration of Food (q).');
        const gold = new Item('Gold','$',0xffff00,ItemCategory.GOLD); gold.quantity = 42; gold.loc = { x:10,y:10 }; g.items.push(gold);
        g.player.inventory.capacity = 0; logger.reset();
        if (mode === 'pickup') g.executeCommand('pickup'); else privateGame(g).pickUpItemAfterDisplacement();
        expect(logger.messages[0]!.text).toBe('you found 42 pieces of gold.'); expect(g.stats.gold).toBe(42);
    });
    it('forced eating requires acknowledgment; unknown immolation does, known immolation does not', () => {
        const g = scene(); g.player.inventory.addItem(ItemLoader.spawnFood('mango', -1, -1)!);
        g.player.nutrition = 2; g.executeCommand('wait');
        expect(logger.messages.find(m => m.text.startsWith('Unable to control'))?.acknowledge).toBe(true);
        room(g); const armor = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        armor.runicType = 'immolation'; armor.runicKnown = false; g.player.equippedArmor = armor;
        const rat = new Monster(11, 10, monsters.find(m => m.id === 'rat')! as MonsterData);
        vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        g.tryTriggerArmorRunic(rat, 1); expect(logger.messages.find(m => m.text.includes('explode out'))?.acknowledge).toBe(true);
        logger.reset(); g.tryTriggerArmorRunic(rat, 1); expect(logger.messages.find(m => m.text.includes('explode out'))?.acknowledge).toBeUndefined();
    });
    it('CE message turns advance for nested forced eating, but not paralyzed turns', () => {
        const g = scene(); g.player.inventory.addItem(ItemLoader.spawnFood('mango', -1, -1)!);
        g.player.nutrition = 2; g.executeCommand('wait');
        expect(logger.turn).toBe(2); expect(g.stats.turns).toBe(2);
        expect(logger.messages.find(m => m.text.startsWith('Unable to control'))?.turn).toBe(1);
        logger.reset(); g.player.setStatusDuration('paralyzed', 3);
        g.executeCommand('wait'); expect(logger.turn).toBe(0);
    });
    it('all normal in-turn messages are stamped with the same new player turn', () => {
        const g = scene(); g.player.setStatusDuration('confused', 1); g.player.setStatusDuration('hallucinating', 1);
        g.executeCommand('wait'); expect(logger.messages.map(m => m.turn)).toEqual([1, 1]);
        expect(logger.turn).toBe(1); g.executeCommand('help'); expect(logger.turn).toBe(1);
    });
    it('secret door discovery has no message but retains disturbance', () => {
        const g = scene(); g.grid.setTerrain(11,10,T.SECRET_DOOR);
        expect(privateGame(g).discoverSecretAt(11,10)).toBe(true);
        expect(g.disturbed).toBe(true); expect(logger.messages).toEqual([]);
    });
    it('distinguishes dark exploration, exhausted exploration, unexplored destination and no path', () => {
        const g = scene(); g.grid.getCell(11,10)!.isExplored = false; g.grid.getCell(11,10)!.hasMemory = false;
        privateGame(g).handleAutoExplore(); expect(logger.messages[0]!.text).toBe("It's too dark to explore!");
        g.grid.getCell(11,10)!.isExplored = true; logger.reset(); privateGame(g).recomputeExplorePath();
        expect(logger.messages[0]!.text).toBe('I see no path for further exploration.');
        Object.assign(g.grid.getCell(25,10)!,{ isVisible:false,hasMemory:false,isExplored:false }); logger.reset(); g.setAutoPath(25,10);
        expect(logger.messages[0]!.text).toBe('You have not explored that location.');
        g.grid.getCell(25,10)!.isMagicMapped = true; g.grid.setTerrain(25,10,T.GRANITE); g.grid.getCell(25,10)!.rememberedLayers = [...g.grid.getCell(25,10)!.layers]; logger.reset(); g.setAutoPath(25,10);
        expect(logger.messages[0]!.text).toBe('No path is available.');
    });
    it('C13 leaves no Chinese defaults in Game and C04 flags every existing CE source family', () => {
        const source = readFileSync('src/engine/Core/Game.ts','utf8');
        expect(source.match(/defaultValue: [^\n]*[\p{Script=Han}]/gu)).toBeNull();
        for (const key of ['fall.flavor_chasm','fall.flavor_trapdoor','fall.flavor_hole','fall.plunge','env.player_incinerated','scroll.reveal_identify','scroll.reveal_enchantment']) {
            expect(source.split('\n').find(line => line.includes(`logger.log(i18next.t('${key}'`))).toContain('acknowledge: true');
        }
    });
});
