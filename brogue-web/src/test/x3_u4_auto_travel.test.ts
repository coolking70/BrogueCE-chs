import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { CombatSystem } from '../engine/Combat/Combat';
import { logger, Logger } from '../engine/Systems/Logger';
import { rng } from '../engine/Random';
import { firstSeenFeatures, visibleEntities } from '../engine/Movement/AutoTravelVisibility';

afterEach(() => vi.restoreAllMocks());
function room(g: Game) {
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.visibleMonsters.clear(); g.visibleItems.clear(); g.everSeenMonsters.clear(); g.everSeenItems.clear();
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x >= 5 && x <= 55 && y >= 9 && y <= 11 ? T.FLOOR : T.GRANITE);
        const c = g.grid.getCell(x, y)!;
        Object.assign(c, { isVisible: false, isClairvoyantVisible: false, hasMemory: true,
            isExplored: true, isMagicMapped: false, autoSearched: true, machineNumber: 0,
            rememberedLayers: [...c.layers], rememberedItem: null });
    }
    g.player.setStatusDuration('darkness', 1000); g.player.maxStatus.darkness = 1000; // finite natural lantern range
    g.player.loc = { x: 10, y: 10 }; g.player.hp = g.player.maxHp = 30;
    g.player.equippedWeapon = null; g.player.equippedArmor = null;
    (g as any).updateVision(); logger.reset(); g.disturbed = false;
}
function scene() { const g = createHeadlessGame(33004, 'test'); room(g); return g; }
function mob(g: Game, x = 11, y = 10, damage = '1d1+4') {
    const m = new Monster(x, y, { ...monsters.find(m => m.id === 'rat')!, hp: 500, defense: 0, accuracy: 100, damage } as MonsterData);
    m.state = MonsterState.HUNTING; m.ticksUntilTurn = 100; g.monsters.push(m); return m;
}
function revealCell(g: Game, x = 45, y = 9) {
    const c = g.grid.getCell(x, y)!; c.isExplored = false; c.hasMemory = false; return c;
}
function walk(g: Game, render = false, limit = 50) {
    g.onRenderRequested = render ? () => {} : null;
    for (let i = 0; i < limit && g.autoPath.length; i++) { g.stepAutoPath(); if (render) g.update(); }
}
function state(g: Game) {
    return structuredClone({ loc: g.player.loc, hp: g.player.hp, turn: g.stats.turns, path: g.autoPath,
        exploring: g.toSnapshot().run.isAutoExploring, monsters: g.monsters.map(m => ({ id: m.id, hp: m.hp, loc: m.loc })),
        visible: [...g.visibleMonsters].map(m => m.id), items: [...g.visibleItems].map(i => i.id), rng: rng.getState(),
        log: logger.messages.filter(m => m.text !== 'Replay finished.') });
}

describe('X3-U4 disturbed and CE startFighting', () => {
    it('every message, including folded text, disturbs; restore/history and blocked combat do not', () => {
        const log = new Logger(), disturb = vi.fn(); log.onDisturb = disturb;
        log.log('same'); log.log('same'); expect(disturb).toHaveBeenCalledTimes(2);
        log.setState(log.getState()); expect(disturb).toHaveBeenCalledTimes(2);
        log.blockCombatText = true; log.combat('hit'); expect(disturb).toHaveBeenCalledTimes(2);
        log.log('special effect'); log.combat('death', '#fff', true); expect(disturb).toHaveBeenCalledTimes(4);
    });
    it.each([100, 0])('already seen enemy attack (accuracy %s, including miss) interrupts the current travel step', accuracy => {
        const g = scene(), m = mob(g, 11, 11); m.accuracy = accuracy;
        (g as any).updateVision(); g.executeCommand('mouse_travel', { x: 50, y: 10 });
        expect(g.everSeenMonsters.has(m)).toBe(true);
        g.stepAutoPath(); expect(g.player.x).toBe(11); expect(g.stats.turns).toBe(1);
        expect(g.disturbed).toBe(true); expect(g.autoPath).toEqual([]);
        const old = state(g); g.stepAutoPath(); expect(state(g)).toEqual(old);
    });
    it('continues ordinary attacks until HP <= expected damage, then cannot restart on another frame', () => {
        const g = scene(), m = mob(g); g.player.hp = g.player.maxHp = 16;
        g.executeCommand('auto_explore'); expect(g.stats.turns).toBe(1); expect(g.autoPath.length).toBe(1);
        walk(g); expect(g.stats.turns).toBe(3); expect(g.player.hp).toBe(1); expect(m.hp).toBeLessThan(500);
        expect(logger.messages.some(m => /hits you|misses you|You hit|You missed/.test(m.text))).toBe(false);
        expect(g.autoPath).toEqual([]); expect(logger.blockCombatText).toBe(false);
        g.stepAutoPath(); expect(g.stats.turns).toBe(3);
    });
    it('easy expectedDamage /5 and weakness adjustment are latched with the combat target', () => {
        const g = scene(), m = mob(g); g.mode = 'easy'; m.ticksUntilTurn = 100000;
        g.executeCommand('auto_explore'); expect((g as any).autoFight.expectedDamage).toBe(1);
        const saved = g.toSnapshot(); expect(saved.run.autoFight?.targetId).toBe(m.id);
        expect(g.loadSnapshot(saved)).toBe(true); expect((g as any).autoFight.expectedDamage).toBe(1);
        g.executeCommand('escape'); g.mode = 'test'; g.monsters[0]!.weaknessAmount = 5;
        g.executeCommand('auto_explore'); expect((g as any).autoFight.expectedDamage).toBeLessThan(5);
    });
    it('hallucination latches tillDeath and does not apply the HP brake', () => {
        const g = scene(); mob(g).ticksUntilTurn = 100000; g.player.hp = 1;
        g.player.setStatusDuration('hallucinating', 100);
        g.executeCommand('auto_explore'); expect((g as any).autoFight?.tillDeath).toBe(true);
        expect(g.autoPath.length).toBeGreaterThan(0);
        // End the status silently to isolate the latched tillDeath from web's
        // pre-existing hallucination stumble (X3-D11, outside U4).
        g.player.setStatusDuration('hallucinating', 0);
        g.stepAutoPath(); expect(g.stats.turns).toBe(2); expect(g.autoPath.length).toBeGreaterThan(0);
    });
    it('special combat messages and environmental damage still interrupt blocked combat', () => {
        const g = scene(), m = mob(g); m.ticksUntilTurn = 100000;
        g.executeCommand('auto_explore'); logger.log('special status message'); g.stepAutoPath();
        expect(g.stats.turns).toBe(1); expect(g.autoPath).toEqual([]);
        g.executeCommand('auto_explore'); expect(g.autoPath.length).toBeGreaterThan(0);
        logger.blockCombatText = true; g.player.takeDamage(1); logger.blockCombatText = false;
        g.stepAutoPath(); expect(g.autoPath).toEqual([]); expect(g.stats.turns).toBe(2);
    });
    it('direct combat misses disturb without relying on hit/miss text', () => {
        const g = scene(), m = mob(g); m.accuracy = 0;
        CombatSystem.attack(m, g.player, { grid: g.grid }); expect(g.disturbed).toBe(true);
        expect(logger.messages).toEqual([]);
    });
    it('a rejected aquatic attack on a levitating player is not an attack attempt', () => {
        const g = scene(), m = mob(g); m.behaviorFlags.add('MONST_RESTRICTED_TO_LIQUID');
        g.player.setStatusDuration('levitating', 5); const random = rng.getState();
        expect(CombatSystem.attack(m, g.player, { grid: g.grid }).hit).toBe(false);
        expect(g.disturbed).toBe(false); expect(rng.getState()).toEqual(random);
    });
    it('new commands clear a stale disturbance; direct damage and secret discovery latch it again', () => {
        const g = scene(); logger.log('old'); g.handleMouseTravel(50, 10); expect(g.disturbed).toBe(false);
        g.player.takeDamage(1); g.stepAutoPath(); expect(g.stats.turns).toBe(0); expect(g.autoPath).toEqual([]);
        g.handleMouseTravel(50, 10); g.grid.setTerrain(11, 9, T.GAS_TRAP_POISON_HIDDEN);
        expect((g as any).discoverSecretAt(11, 9)).toBe(true); expect(g.disturbed).toBe(true);
        g.stepAutoPath(); expect(g.stats.turns).toBe(0);
    });
    it('a disturbed pending route survives snapshot restore and stops without an extra turn', () => {
        const g = scene(); g.handleMouseTravel(50, 10); logger.log('stop'); const save = g.toSnapshot();
        g.handleMouseTravel(50, 10); expect(g.loadSnapshot(save)).toBe(true); g.stepAutoPath();
        expect(g.stats.turns).toBe(0); expect(g.autoPath).toEqual([]);
    });
    it('new runs and command boundaries bind message disturbance to the active Game', () => {
        const first = scene(), second = scene();
        logger.log('second run'); expect(first.disturbed).toBe(false); expect(second.disturbed).toBe(true);
        second.disturbed = false; first.executeCommand('help'); logger.log('first command');
        expect(first.disturbed).toBe(true); expect(second.disturbed).toBe(false);
    });
    it.each([
        [T.ROT_GAS, 'nauseous'], [T.CONFUSION_GAS, 'confused'], [T.PARALYSIS_GAS, 'paralyzed'],
    ] as const)('repeated terrain contact %s disturbs even with unchanged status and no message', (tile, status) => {
        const g = scene(); g.handleMouseTravel(50, 10);
        g.player.setStatusDuration(status, 40); g.grid.setTerrain(g.player.x, g.player.y, tile);
        const random = rng.getState(); logger.blockCombatText = true;
        try { (g as any).applyEnvironmentalEffects(g.player); } finally { logger.blockCombatText = false; }
        expect(g.player.getStatusDuration(status)).toBe(40); expect(logger.messages).toEqual([]);
        expect(g.disturbed).toBe(true); expect(rng.getState()).toEqual(random);
        g.stepAutoPath(); expect(g.stats.turns).toBe(0); expect(g.autoPath).toEqual([]);
    });
});

describe('X3-U4 first sightings in simulation, never rendering', () => {
    it.each(['ordinary item', 'key', 'ally', 'enemy', 'stairs'] as const)('%s first sight has the CE stop/message policy', kind => {
        const g = scene(); revealCell(g);
        if (kind === 'ordinary item') g.items.push(ItemLoader.spawnFood('ration_of_food', 45, 9)!);
        if (kind === 'key') g.items.push(ItemLoader.spawnKey('iron_key', 45, 9)!);
        if (kind === 'ally' || kind === 'enemy') { const m = mob(g, 45, 9); m.isAlly = kind === 'ally'; m.ticksUntilTurn = 100000; }
        if (kind === 'stairs') g.grid.setTerrain(45, 9, T.STAIRS_DOWN);
        g.executeCommand('mouse_travel', { x: 50, y: 10 }); walk(g);
        const shouldStop = kind === 'key' || kind === 'enemy' || kind === 'stairs';
        expect(g.player.x < 45, JSON.stringify({loc:g.player.loc, log:logger.messages, seen:[...g.everSeenMonsters].map(m=>m.id), monsters:g.monsters.map(m=>({id:m.id,loc:m.loc,ally:m.isAlly,hp:m.hp,visible:g.visibleMonsters.has(m)}))})).toBe(shouldStop);
        if (!shouldStop) expect(g.player.loc).toEqual({ x: 50, y: 10 });
        expect(logger.messages.filter(m => /You see|You sense/.test(m.text))).toHaveLength(shouldStop ? 1 : 0);
        expect(logger.messages.some(m => /You spot|You notice/.test(m.text))).toBe(false);
    });
    it('pure first-seen predicates exclude explored, mapped terrain and clairvoyance without changing RNG/state', () => {
        const g = scene(), c = revealCell(g); g.grid.setTerrain(45, 9, T.STAIRS_DOWN);
        const key = ItemLoader.spawnKey('iron_key', 45, 9)!; g.items.push(key);
        const before = JSON.stringify(c), random = rng.getState();
        expect(firstSeenFeatures(c, true, g.items)).toEqual({ keys: [key], terrain: T.STAIRS_DOWN });
        visibleEntities(g.player, g.grid, g.monsters, g.items);
        expect(JSON.stringify(c)).toBe(before); expect(rng.getState()).toEqual(random);
        c.isMagicMapped = true; expect(firstSeenFeatures(c, true, g.items)).toEqual({ keys: [key], terrain: undefined });
        expect(firstSeenFeatures(c, false, g.items)).toEqual({ keys: [], terrain: undefined });
        c.isExplored = true; expect(firstSeenFeatures(c, true, g.items)).toEqual({ keys: [], terrain: undefined });
    });
    it('manual sighting is silent, render does not commit visible sets or first sightings', () => {
        const g = scene(), m = mob(g, 45, 9); m.ticksUntilTurn = 100000;
        g.player.loc = { x: 44, y: 10 }; g.onRenderRequested = () => {}; (g as any).needsRender = true;
        g.update(); expect(g.visibleMonsters.has(m)).toBe(false); expect(logger.messages).toEqual([]);
        g.executeCommand('wait'); expect(g.visibleMonsters.has(m)).toBe(true); expect(logger.messages).toEqual([]);
    });
    it('clairvoyant sightings use the sense message, without pretending to be direct sight', () => {
        const g = scene(), m = mob(g, 45, 9); m.ticksUntilTurn = 100000;
        g.handleMouseTravel(50, 10);
        Object.assign(g.grid.getCell(45, 9)!, { isVisible: true, isClairvoyantVisible: true });
        const random = rng.getState(); (g as any).refreshVisibleEntities();
        expect(logger.messages.map(m => m.text)).toEqual(['You sense a Rat.']);
        expect(g.disturbed).toBe(true); expect(rng.getState()).toEqual(random);
    });
    it('a seen staircase never stops a second automatic command', () => {
        const g = scene(); revealCell(g); g.grid.setTerrain(45, 9, T.STAIRS_DOWN);
        g.handleMouseTravel(50, 10); walk(g); expect(g.player.x).toBeLessThan(45);
        g.handleMouseTravel(50, 10); walk(g); expect(g.player.x).toBe(50);
        expect(logger.messages.filter(m => /You see/.test(m.text))).toHaveLength(1);
    });
    it.each(['key', 'enemy', 'stairs'] as const)('%s recording and replay stop at identical positions with and without render', kind => {
        const setup = (g: Game) => {
            room(g); revealCell(g);
            if (kind === 'key') g.items.push(ItemLoader.spawnKey('iron_key', 45, 9)!);
            if (kind === 'stairs') g.grid.setTerrain(45, 9, T.STAIRS_DOWN);
            if (kind === 'enemy') mob(g, 45, 9).ticksUntilTurn = 100000;
        };
        const g = scene(); setup(g); g.executeCommand('mouse_travel', { x: 50, y: 10 }); walk(g, true);
        const expected = state(g), recording = g.exportRecording(), start = g.startNewGame.bind(g);
        vi.spyOn(g, 'startNewGame').mockImplementation(options => { start(options); setup(g); });
        for (const render of [false, true]) {
            expect(g.loadReplay(recording)).toBe(true); g.onRenderRequested = render ? () => {} : null;
            for (const _event of recording.events) { g.replayStep(); if (render) g.update(); expect(g.replayError).toBeNull(); }
            expect(state(g)).toEqual(expected); g.replaySeek(recording.events.length); expect(state(g)).toEqual(expected);
        }
    });
});

describe('X3-U4 input cancellation and automation-only message suppression', () => {
    it.each(['escape', 'cancel_target', 'discoveries', 'help', 'toggle_inventory', 'interrupt_auto', 'confirm_target', 'cycle_target', 'apply_item'])('%s cancels before an early-return branch', action => {
        const g = scene(); g.handleMouseTravel(50, 10); const oldRng = rng.getState();
        g.executeCommand(action); g.stepAutoPath(); expect(g.autoPath).toEqual([]); expect(g.stats.turns).toBe(0);
        expect(rng.getState()).toEqual(oldRng);
    });
    it('struggle and break-free messages are suppressed while travel retries spent turns', () => {
        const g = scene(); g.grid.setTerrainLayer(10, 10, L.SURFACE, T.WEB); g.player.setStatusDuration('stuck', 3);
        g.handleMouseTravel(50, 10); g.stepAutoPath(); expect(g.player.x).toBe(10); expect(g.autoPath.length).toBeGreaterThan(0);
        g.stepAutoPath(); g.stepAutoPath(); expect(g.player.x).toBe(11); expect(g.stats.turns).toBe(3);
        expect(logger.messages.some(m => /web|struggle/.test(m.text))).toBe(false);
    });
    it('vomit still executes terrain/RNG effects but emits no automation message', () => {
        const g = scene(); g.player.setStatusDuration('nauseous', 20); g.handleMouseTravel(50, 10);
        vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        expect(g.tryVomit(g.player)).toBe(true); expect(logger.messages).toEqual([]); expect(g.disturbed).toBe(false);
        g.executeCommand('escape'); expect(g.tryVomit(g.player)).toBe(true); expect(logger.messages.length).toBeGreaterThan(0);
    });
});
