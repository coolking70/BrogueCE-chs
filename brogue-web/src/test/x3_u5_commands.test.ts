import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Direction } from '../types';
import { TerrainType as T } from '../engine/Map/Grid';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { logger } from '../engine/Systems/Logger';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';

afterEach(() => vi.restoreAllMocks());
function room(g: Game, corridor = false) {
    g.animationEnabled = false;
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.visibleMonsters.clear(); g.visibleItems.clear(); g.everSeenMonsters.clear(); g.everSeenItems.clear();
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x >= 5 && x <= 45 && (corridor ? y === 10 : y >= 5 && y <= 15) ? T.FLOOR : T.GRANITE);
        const cell = g.grid.getCell(x, y)!;
        Object.assign(cell, { isVisible: false, isExplored: true, hasMemory: true, isMagicMapped: false,
            isClairvoyantVisible: false, autoSearched: true, machineNumber: 0,
            rememberedLayers: [...cell.layers], rememberedItem: null });
    }
    g.player.loc = { x: 10, y: 10 }; g.player.hp = g.player.maxHp = 30;
    g.player.equippedArmor = null; g.player.equippedWeapon = null;
    (g as any).monsterSpawnFuse = 100000;
    (g as any).updateVision(); logger.reset(); g.disturbed = false;
}
function scene(corridor = false) { const g = createHeadlessGame(33005, 'test'); room(g, corridor); return g; }
function drain(g: Game, limit = 150) {
    for (let i = 0; i < limit && g.isAutoTraveling(); i++) g.stepAutoPath();
    expect(g.isAutoTraveling()).toBe(false);
}
function put(g: Game, x: number, y: number, tile: T) {
    g.grid.setTerrain(x, y, tile); const cell = g.grid.getCell(x, y)!;
    if (tile === T.STAIRS_UP) g.levelSeeds[g.depth - 1]!.upStairsLoc = { x, y };
    if (tile === T.STAIRS_DOWN || tile === T.DUNGEON_PORTAL) g.levelSeeds[g.depth - 1]!.downStairsLoc = { x, y };
    cell.rememberedLayers = [...cell.layers]; return cell;
}
function mob(g: Game, x: number, y: number, ally = false) {
    const m = new Monster(x, y, { ...monsters.find(m => m.id === 'rat')!, hp: 100, accuracy: 100, damage: '1d1' } as MonsterData);
    m.isAlly = ally; m.state = MonsterState.HUNTING; m.ticksUntilTurn = 100000;
    g.monsters.push(m); (g as any).updateVision(); return m;
}
function world(g: Game) {
    return structuredClone({ loc: g.player.loc, hp: g.player.hp, turns: g.stats.turns,
        turn: g.absoluteTurnNumber, tick: timeSystem.currentTick, rng: rng.getState(),
        path: g.autoPath, auto: g.toSnapshot().run.autoAction,
        log: logger.messages.filter(m => m.text !== 'Replay finished.') });
}

describe('X3-U5 stairs travel and pure rest', () => {
    it.each(['up', 'down'] as const)('%s: unknown stairs report CE failure without exposing the target or spending a turn/RNG', direction => {
        const g = scene(), cell = put(g, 30, 10, direction === 'up' ? T.STAIRS_UP : T.STAIRS_DOWN);
        Object.assign(cell, { isVisible: false, isExplored: false, hasMemory: false, isMagicMapped: false });
        const random = rng.getState(); g.executeCommand('travel_stairs', direction);
        expect(logger.messages[logger.messages.length - 1]?.text).toBe(`I see no way ${direction}.`);
        expect(g.isAutoTraveling()).toBe(false); expect(g.stats.turns).toBe(0); expect(rng.getState()).toEqual(random);
    });
    it.each(['up', 'down'] as const)('%s: already there is a no-turn CE message', direction => {
        const g = scene(); put(g, 10, 10, direction === 'up' ? T.STAIRS_UP : T.STAIRS_DOWN);
        const random = rng.getState(); g.executeCommand('travel_stairs', direction);
        expect(logger.messages[logger.messages.length - 1]?.text).toBe('you are already there.');
        expect(g.depth).toBe(1); expect(g.stats.turns).toBe(0); expect(rng.getState()).toEqual(random);
    });
    it.each(['explored', 'mapped'])('%s stairs queue travel and walking onto them uses the existing depth entrance', known => {
        const g = scene(), cell = put(g, 13, 10, T.STAIRS_DOWN);
        cell.isVisible = false; cell.isExplored = known === 'explored'; cell.isMagicMapped = known === 'mapped';
        g.executeCommand('travel_stairs', 'down'); expect(g.autoPath[g.autoPath.length - 1]).toEqual({ x: 13, y: 10 });
        // Existing stair entry changes depth before the ordinary movement turn.
        drain(g); expect(g.depth).toBe(2); expect(g.stats.turns).toBe(2);
    });
    it('known upstairs use the same route and D1 entrance gate; a blocked route spends no turn', () => {
        const g = scene(); put(g, 13, 10, T.STAIRS_UP);
        g.executeCommand('travel_stairs', 'up'); expect(g.autoPath[g.autoPath.length - 1]).toEqual({ x: 13, y: 10 });
        drain(g); expect(g.depth).toBe(1); expect(g.isGameOver).toBe(false);
        expect(logger.messages[logger.messages.length - 1]?.text).toContain('without the Amulet');
        room(g); put(g, 60, 10, T.STAIRS_DOWN); const before = g.stats.turns;
        g.executeCommand('travel_stairs', 'down'); expect(g.autoPath).toEqual([]); expect(g.stats.turns).toBe(before);
    });
    it('travel_stairs is interrupted by U4 disturbance before another step', () => {
        const g = scene(); put(g, 15, 10, T.STAIRS_DOWN); g.executeCommand('travel_stairs', 'down');
        g.stepAutoPath(); logger.log('stop'); g.stepAutoPath();
        expect(g.player.loc).toEqual({ x: 11, y: 10 }); expect(g.stats.turns).toBe(1); expect(g.isAutoTraveling()).toBe(false);
    });
    it.each([T.STAIRS_DOWN, T.STAIRS_UP, T.DUNGEON_PORTAL])('wait on terrain %s stays on this floor and consumes one rest turn', tile => {
        const g = scene(); put(g, 10, 10, tile); g.executeCommand('wait');
        // Existing REPEL_CREATURES may move a creature off a stair during a turn;
        // pure rest must still never call the stairs command or change depth.
        expect(g.depth).toBe(1); expect(g.stats.turns).toBe(1);
        expect(g.isGameOver).toBe(false);
    });
});

describe('X3-U5 yielded autoRest and long search', () => {
    it('injured rest stops at full health, and full-health rest lasts exactly 100 turns', () => {
        const g = scene(); g.player.hp = 29; g.executeCommand('auto_rest');
        expect(g.stats.turns).toBe(1); expect(g.isAutoTraveling()).toBe(true); drain(g);
        expect(g.player.hp).toBe(30); expect(g.stats.turns).toBeLessThan(100);
        const before = g.stats.turns; g.executeCommand('auto_rest'); drain(g);
        expect(g.stats.turns - before).toBe(100);
    });
    // 验收裁决：任务书 "最多 100 回合" 与 CE 不符。CE Time.c:2361-2388 恢复型休息上限为
    // TURNS_FOR_FULL_REGEN（300，Rogue.h:1123），无需恢复时为 100。
    it('recovery is capped at CE TURNS_FOR_FULL_REGEN (300) turns, without changing regeneration rates', () => {
        const g = scene(); g.player.setStatusDuration('confused', 500); g.executeCommand('auto_rest'); drain(g, 400);
        expect(g.stats.turns).toBe(300); expect(g.player.hasStatus('confused')).toBe(true);
    });
    it('injured rest from 1 HP either recovers fully or stops at the 300-turn cap', () => {
        const g = scene(); g.player.hp = 1; g.executeCommand('auto_rest'); drain(g, 400);
        expect(g.stats.turns).toBeLessThanOrEqual(300);
        if (g.player.hp < g.player.maxHp) expect(g.stats.turns).toBe(300);
    });
    it.each(['confused', 'hallucinating', 'nauseous', 'darkness'] as const)('full-health %s rests until status expiry', status => {
        const g = scene(); g.player.setStatusDuration(status, 3); g.executeCommand('auto_rest'); drain(g);
        expect(g.player.hasStatus(status)).toBe(false); expect(g.stats.turns).toBe(3);
    });
    it('already seen enemy attack interrupts rest on the very first turn', () => {
        const g = scene(), m = mob(g, 11, 10); m.ticksUntilTurn = 100;
        g.player.hp = 20; g.executeCommand('auto_rest');
        expect(g.player.hp).toBeLessThan(20); expect(g.stats.turns).toBe(1); expect(g.isAutoTraveling()).toBe(false);
    });
    it.each(['auto_rest', 'search_long', 'run'])('%s accepts explicit cancellation between turns', action => {
        const g = scene(); g.executeCommand(action, Direction.RIGHT); expect(g.stats.turns).toBe(1);
        expect(g.isAutoTraveling()).toBe(true); g.executeCommand('escape'); g.stepAutoPath();
        expect(g.isAutoTraveling()).toBe(false); expect(g.stats.turns).toBe(1);
    });
    it('rest detects changed cardinal danger without a message', () => {
        const g = scene(); g.executeCommand('auto_rest'); put(g, 10, 9, T.LAVA);
        expect(g.disturbed).toBe(false); g.stepAutoPath();
        expect(g.stats.turns).toBe(2); expect(g.isAutoTraveling()).toBe(false);
    });
    it('long search uses the real five-search cadence and stops immediately on discovery', () => {
        const g = scene(); g.executeCommand('search_long'); drain(g);
        expect(g.stats.turns).toBe(5); expect(logger.messages.some(m => /detailed search/.test(m.text))).toBe(true);
        room(g); const before = g.stats.turns; g.executeCommand('search_long');
        put(g, 11, 10, T.SECRET_DOOR); (g as any).discoverSecretAt(11, 10); g.stepAutoPath();
        expect(g.stats.turns).toBe(before + 1); expect(g.isAutoTraveling()).toBe(false);
    });
});

describe('X3-U5 CE playerRuns stopping rules', () => {
    it('runs a corridor to the wall with no extra turn', () => {
        const g = scene(true); g.executeCommand('run', Direction.RIGHT); drain(g);
        expect(g.player.loc).toEqual({ x: 45, y: 10 }); expect(g.stats.turns).toBe(35);
    });
    it('stops on a side opening, while ignoring the changed cell behind it', () => {
        const g = scene(true); put(g, 13, 9, T.FLOOR); g.executeCommand('run', Direction.RIGHT); drain(g);
        expect(g.player.loc).toEqual({ x: 13, y: 10 });
        room(g, true); g.player.loc.x = 5; g.executeCommand('run', Direction.RIGHT); drain(g);
        expect(g.player.x).toBe(45);
    });
    it('stops before an avoided hazard, and confusion refuses without a turn or RNG', () => {
        const g = scene(true); put(g, 14, 10, T.LAVA); g.executeCommand('run', Direction.RIGHT); drain(g);
        expect(g.player.x).toBe(13); expect(g.isGameOver).toBe(false);
        const before = g.stats.turns; g.player.setStatusDuration('confused', 5); const random = rng.getState();
        g.executeCommand('run', Direction.LEFT); expect(g.stats.turns).toBe(before); expect(rng.getState()).toEqual(random);
    });
    it('diagonal runs ignore cardinal openings but honor diagonal obstructions', () => {
        const g = scene(); put(g, 12, 10, T.GRANITE); g.executeCommand('run', Direction.UPRIGHT); drain(g);
        expect(g.player.loc).toEqual({ x: 15, y: 5 });
        room(g); put(g, 12, 9, T.GRANITE); g.executeCommand('run', Direction.UPRIGHT); drain(g);
        expect(g.player.loc).toEqual({ x: 11, y: 9 });
    });
    it.each(['item', 'enemy', 'ally', 'invisible enemy'] as const)('adjacent %s has CE isDisturbed semantics', kind => {
        const g = scene(true);
        if (kind === 'item') g.items.push(ItemLoader.spawnFood('ration_of_food', 13, 9)!);
        else {
            put(g, 13, 9, T.FLOOR); // Eliminate side-opening changes by running diagonally in an open room.
            room(g); const m = mob(g, 13, 11, kind === 'ally');
            if (kind === 'invisible enemy') { m.setStatusDuration('invisible', 100); (g as any).updateVision(); }
        }
        g.executeCommand('run', Direction.RIGHT); drain(g);
        expect(g.player.x).toBe(kind === 'item' || kind === 'enemy' ? 12 : 45);
    });
});

describe('X3-U5 command intent, snapshots and replay', () => {
    it('new automatic commands cannot turn a pending throw into a throw at the stairs or advance through the target modal', () => {
        const g = scene(); put(g, 15, 10, T.STAIRS_DOWN);
        const item = g.player.inventory.items.find(i => i.quantity > 1)!;
        g.executeItemCommand('throw', item); expect(g.isThrowing).toBe(true);
        const before = world(g), quantity = item.quantity;
        g.executeCommand('travel_stairs', 'down'); g.executeCommand('auto_rest');
        g.executeCommand('search_long'); g.executeCommand('run', Direction.RIGHT);
        expect(g.isThrowing).toBe(true); expect(item.quantity).toBe(quantity);
        expect(g.isAutoTraveling()).toBe(false); expect(world(g)).toEqual(before);
    });
    it.each(['equip', 'unequip', 'drop', 'call'] as const)('%s opens inventory with the selected operation without a turn/RNG', operation => {
        const g = scene(), random = rng.getState(); g.executeCommand('inventory_action', operation);
        expect(g.isInventoryOpen).toBe(true); expect(g.inventoryAction).toBe(operation);
        expect(g.stats.turns).toBe(0); expect(rng.getState()).toEqual(random);
        g.executeCommand('travel_stairs', 'down'); g.executeCommand('auto_rest'); g.executeCommand('search_long');
        expect(g.stats.turns).toBe(0); expect(g.isAutoTraveling()).toBe(false);
        g.executeCommand('escape'); expect(g.inventoryAction).toBeNull(); expect(g.isInventoryOpen).toBe(false);
    });
    it.each(['auto_rest', 'search_long', 'run'])('%s survives JSON save/load at the same yielded step', action => {
        const g = scene(); g.executeCommand(action, Direction.RIGHT); const save = JSON.parse(JSON.stringify(g.toSnapshot()));
        drain(g); const expected = world(g);
        expect(g.loadSnapshot(save)).toBe(true); drain(g); expect(world(g)).toEqual(expected);
        g.executeCommand('inventory_action', 'drop'); g.startNewGame({ seed: 33005, mode: 'test' });
        expect(g.isAutoTraveling()).toBe(false); expect(g.inventoryAction).toBeNull();
    });
    it('all new commands and autonomous steps record, replay and seek with zero OOS (including depth travel)', () => {
        const g = scene(); put(g, 15, 10, T.STAIRS_DOWN);
        g.executeCommand('auto_rest'); g.stepAutoPath(); g.executeCommand('escape');
        g.executeCommand('search_long'); drain(g);
        g.executeCommand('run', Direction.RIGHT); g.executeCommand('escape');
        for (const operation of ['equip', 'unequip', 'drop', 'call']) {
            g.executeCommand('inventory_action', operation); g.executeCommand('escape');
        }
        g.executeCommand('travel_stairs', 'down'); drain(g);
        const expected = world(g), recording = g.exportRecording(), start = g.startNewGame.bind(g);
        vi.spyOn(g, 'startNewGame').mockImplementation(options => { start(options); room(g); put(g, 15, 10, T.STAIRS_DOWN); });
        for (const render of [false, true]) {
            expect(g.loadReplay(recording)).toBe(true); g.onRenderRequested = render ? () => {} : null;
            for (const event of recording.events) { g.replayStep(); if (render) g.update(); expect(g.replayError, String(event.index)).toBeNull(); }
            expect(world(g)).toEqual(expected); g.replaySeek(recording.events.length); expect(world(g)).toEqual(expected);
        }
        expect(recording.events.some(e => e.action === 'auto_step')).toBe(true);
    });
});

describe('X3-U5 keyboard dispatch', () => {
    let press: (key: string, options?: Record<string, unknown>) => Array<[string, unknown]>;
    beforeAll(async () => {
        const listeners: Array<(event: any) => void> = [];
        vi.stubGlobal('window', { addEventListener: (type: string, callback: any) => { if (type === 'keydown') listeners.push(callback); } });
        const { InputManager } = await import('../engine/Input'); const input = new InputManager();
        press = (key, options = {}) => {
            const actions: Array<[string, unknown]> = []; input.setCallback((action, data) => actions.push([action, data]));
            for (const listener of listeners) listener({ key, preventDefault() {}, ...options });
            return actions;
        };
    });
    it('x and X explore, z/period/keypad5 rest, Z rests long, Ctrl-S searches long, and S/w/T/M stay free', () => {
        for (const key of ['x', 'X']) expect(press(key)).toEqual([['auto_explore', undefined]]);
        for (const key of ['z', '.', '。']) expect(press(key)).toEqual([['wait', undefined]]);
        expect(press('Clear', { code: 'Numpad5' })).toEqual([['wait', undefined]]);
        expect(press('Z', { shiftKey: true })).toEqual([['auto_rest', undefined]]);
        const preventDefault = vi.fn(); expect(press('s', { ctrlKey: true, preventDefault })).toEqual([['search_long', undefined]]);
        expect(preventDefault).toHaveBeenCalledOnce();
        for (const key of ['S', 'w', 'T', 'M']) expect(press(key)).toEqual([]);
    });
    it('stairs and e/r/d/c pass direction/operation through the command boundary', () => {
        expect(press('>')).toEqual([['travel_stairs', 'down']]); expect(press('<')).toEqual([['travel_stairs', 'up']]);
        for (const [key, operation] of [['e', 'equip'], ['r', 'unequip'], ['d', 'drop'], ['c', 'call']]) {
            expect(press(key!)).toEqual([['inventory_action', operation]]);
        }
    });
    it('eight keypad directions work with NumLock off; shifted/control arrows and vi keys run', () => {
        for (const [number, direction] of [[1, Direction.DOWNLEFT], [2, Direction.DOWN], [3, Direction.DOWNRIGHT],
            [4, Direction.LEFT], [6, Direction.RIGHT], [7, Direction.UPLEFT], [8, Direction.UP], [9, Direction.UPRIGHT]]) {
            expect(press('End', { code: `Numpad${number}` })).toEqual([['move', direction]]);
            expect(press('End', { code: `Numpad${number}`, ctrlKey: true })).toEqual([['run', direction]]);
        }
        expect(press('ArrowUp', { shiftKey: true })).toEqual([['run', Direction.UP]]);
        expect(press('H', { shiftKey: true })).toEqual([['run', Direction.LEFT]]);
        expect(press('u', { ctrlKey: true })).toEqual([['run', Direction.UPRIGHT]]);
        expect(press('e', { target: { tagName: 'INPUT' } })).toEqual([]);
    });
});
