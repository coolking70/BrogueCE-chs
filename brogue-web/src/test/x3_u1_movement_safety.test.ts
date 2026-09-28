import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { logger } from '../engine/Systems/Logger';

afterEach(() => vi.restoreAllMocks());

function room(g: Game) {
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.visibleMonsters.clear(); g.visibleItems.clear();
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x && y && x < g.grid.width - 1 && y < g.grid.height - 1 ? T.FLOOR : T.GRANITE);
        const c = g.grid.getCell(x, y)!;
        Object.assign(c, { hasMemory: true, isVisible: true, isClairvoyantVisible: false, isMagicMapped: false,
            isDiscovered: false, isExplored: true, rememberedLayers: [...c.layers] });
    }
    g.player.loc = { x: 10, y: 10 };
    g.player.hp = g.player.maxHp = 500;
    g.player.equippedWeapon = null; g.player.equippedArmor = null;
}
function scene(setup: (g: Game) => void = () => {}) {
    const g = createHeadlessGame(33001, 'test');
    room(g); setup(g);
    return g;
}
function terrain(g: Game, t: T) { g.grid.setTerrain(11, 10, t); return g.grid.getCell(11, 10)!; }
function before(g: Game) {
    return structuredClone({ loc: g.player.loc, hp: g.player.hp, statuses: g.player.statusDurations,
        turn: g.absoluteTurnNumber, stats: g.stats, tick: timeSystem.currentTick, rng: rng.getState(),
        monsters: g.monsters.map(m => ({ loc: m.loc, hp: m.hp })), weapon: g.player.equippedWeapon?.enchantment,
        layers: g.grid.getCell(11, 10)!.layers });
}
function move(g: Game) { g.executeCommand('move', { x: 1, y: 0 }); }
function armor(g: Game, known = true) {
    const a = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
    a.runicType = 'respiration'; a.runicKnown = known; g.player.equippedArmor = a;
}
function weapon(g: Game, id = 'sword') {
    const w = ItemLoader.spawnWeapon(id, -1, -1)!;
    w.enchantment = 0; w.runicType = undefined; w.runicKnown = false; w.isProtected = false;
    g.player.equippedWeapon = w; g.player.strength = 100;
    return w;
}
function acid(g: Game, x = 11, y = 10, id = 'acid_mound') {
    const m = new Monster(x, y, { ...monsters.find(m => m.id === id)!, hp: 500, defense: 0 } as MonsterData);
    m.state = MonsterState.ASLEEP; g.monsters.push(m); return m;
}
const hazardCases = [
    ['flame', T.PLAIN_FIRE, 'Venture into flame?'],
    ['confusion gas', T.CONFUSION_GAS, 'Venture into dangerous gas?'],
    ['paralysis gas', T.PARALYSIS_GAS, 'Venture into dangerous gas?'],
    ['pressure plate', T.PRESSURE_PLATE, 'Step onto the pressure plate?'],
    ['gas trap', T.GAS_TRAP_PARALYSIS, 'Step onto the pressure plate?'],
] as const;

describe('X3-U1 D01-D04 terrain refusal and CE exemptions', () => {
    it.each(['memory', 'mapped'] as const)('refuses known lava (%s) without time, RNG, movement or an executed turn', knowledge => {
        const g = scene(), c = terrain(g, T.LAVA), ask = vi.fn(() => false);
        c.hasMemory = knowledge === 'memory'; c.isMagicMapped = knowledge === 'mapped'; c.isVisible = false;
        g.onConfirmRequest = ask;
        const old = before(g); move(g);
        expect(before(g)).toEqual(old); expect(ask).not.toHaveBeenCalled();
        expect(logger.messages.slice(-1)[0]?.text).toBe('that would be certain death!');
        expect(g.exportRecording().events.slice(-1)[0]).toMatchObject({ turn: old.turn, tick: old.tick, rng: old.rng, decisions: [] });
    });

    it.each(hazardCases)('%s: No preserves the entire action state; Yes performs one move', (_name, t, message) => {
        const g = scene(); terrain(g, t); const ask = vi.fn(() => false); g.onConfirmRequest = ask;
        const old = before(g); move(g);
        expect(ask).toHaveBeenCalledExactlyOnceWith(message); expect(before(g)).toEqual(old);
        expect(g.exportRecording().events.slice(-1)[0]).toMatchObject({ turn: old.turn, tick: old.tick, rng: old.rng, decisions: [false] });
        ask.mockReturnValue(true); move(g);
        expect(g.player.loc).toEqual({ x: 11, y: 10 });
        // CE Time.c:489-490, 2872: accepting this move also owns the full
        // 20-turn paralysis wait; the other hazards still take one turn.
        expect(g.absoluteTurnNumber).toBe(old.turn + (t === T.PARALYSIS_GAS ? 20 : 1));
        expect(g.player.hasStatus('paralyzed')).toBe(false);
        expect(g.exportRecording().events).toHaveLength(2); // rejected input, then one accepted move
        expect(g.exportRecording().events.slice(-1)[0]?.decisions).toEqual([true]);
    });

    // Direct predicate checks isolate CE preconditions from the ensuing terrain
    // damage/status/RNG. Public-command tests above cover the actual consumer.
    it('lava: unknown, levitation/fire immunity >1, confused, entangled and secret exempt; duration 1 does not', () => {
        const g = scene(), c = terrain(g, T.LAVA);
        const allowed = () => (g as any).confirmPlayerMove(11, 10);
        c.hasMemory = false; c.isDiscovered = true; expect(allowed()).toBe(true); c.hasMemory = true;
        for (const status of ['levitating', 'flying', 'immune_fire'] as const) {
            g.player.setStatusDuration(status, 2); expect(allowed()).toBe(true);
            g.player.setStatusDuration(status, 1); expect(allowed()).toBe(false);
            g.player.setStatusDuration(status, 0);
        }
        g.player.setStatusDuration('confused', 5); expect(allowed()).toBe(true); g.player.setStatusDuration('confused', 0);
        g.grid.setTerrainLayer(11, 10, L.SURFACE, T.WEB); expect(allowed()).toBe(true);
        g.grid.setTerrainLayer(11, 10, L.SURFACE, T.NOTHING);
        g.grid.setTerrainLayer(11, 10, L.DUNGEON, T.GAS_TRAP_PARALYSIS_HIDDEN); expect(allowed()).toBe(true);
    });

    it.each([T.PLAIN_FIRE, T.CONFUSION_GAS, T.PARALYSIS_GAS])('fire/gas %s: visibility, confusion, burning and specific immunity gates', t => {
        const g = scene(), c = terrain(g, t), ask = vi.fn(() => false); g.onConfirmRequest = ask;
        const allowed = () => (g as any).confirmPlayerMove(11, 10);
        c.isVisible = false; c.isMagicMapped = true; expect(allowed()).toBe(true);
        c.isClairvoyantVisible = true; expect(allowed()).toBe(false); c.isClairvoyantVisible = false; c.isVisible = true;
        g.player.setStatusDuration('confused', 2); expect(allowed()).toBe(true); g.player.setStatusDuration('confused', 0);
        (g as any).setBurningDuration(g.player, 2); expect(allowed()).toBe(true); (g as any).setBurningDuration(g.player, 0);
        ask.mockClear();
        if (t === T.PLAIN_FIRE) {
            g.player.setStatusDuration('immune_fire', 2); expect(allowed()).toBe(true);
            g.player.setStatusDuration('immune_fire', 1); expect(allowed()).toBe(false);
            g.player.setStatusDuration('immune_fire', 0);
            g.grid.setTerrainLayer(11, 10, L.LIQUID, T.WATER_SHALLOW); expect(allowed()).toBe(true);
        } else {
            armor(g, false); expect(allowed()).toBe(false); g.player.equippedArmor!.runicKnown = true; expect(allowed()).toBe(true);
        }
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it('plates: mapped/clairvoyant count, memory alone does not; secret, depressed, levitation and respiration gates', () => {
        const g = scene(), c = terrain(g, T.GAS_TRAP_PARALYSIS), ask = vi.fn(() => false); g.onConfirmRequest = ask;
        const allowed = () => (g as any).confirmPlayerMove(11, 10);
        c.isVisible = false; expect(allowed()).toBe(true);
        c.isMagicMapped = true; expect(allowed()).toBe(false); c.isMagicMapped = false;
        c.isClairvoyantVisible = true; expect(allowed()).toBe(false); c.isVisible = true;
        g.player.setStatusDuration('levitating', 2); expect(allowed()).toBe(true);
        g.player.setStatusDuration('levitating', 1); expect(allowed()).toBe(false); g.player.setStatusDuration('levitating', 0);
        g.player.setStatusDuration('confused', 2); expect(allowed()).toBe(true); g.player.setStatusDuration('confused', 0);
        (g as any).displacementTrapDepressions = new WeakMap([[g.grid, new Set([10 * g.grid.width + 11])]]);
        expect(allowed()).toBe(true); (g as any).displacementTrapDepressions = undefined;
        armor(g, false); expect(allowed()).toBe(false); g.player.equippedArmor!.runicKnown = true;
        for (const t of [T.GAS_TRAP_POISON, T.GAS_TRAP_CONFUSION, T.GAS_TRAP_PARALYSIS]) { terrain(g, t); expect(allowed()).toBe(true); }
        for (const t of [T.PRESSURE_PLATE, T.NET_TRAP, T.FLAMETHROWER]) { terrain(g, t); expect(allowed()).toBe(false); }
        terrain(g, T.GAS_TRAP_PARALYSIS_HIDDEN); expect(allowed()).toBe(true);
    });

    it('questions are ordered fire -> gas -> plate, and stop at the first No', () => {
        const g = scene(); terrain(g, T.PRESSURE_PLATE);
        g.grid.setTerrainLayer(11, 10, L.SURFACE, T.PLAIN_FIRE); g.grid.setTerrainLayer(11, 10, L.GAS, T.CONFUSION_GAS);
        const ask = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false); g.onConfirmRequest = ask;
        const old = before(g); move(g); expect(before(g)).toEqual(old);
        expect(ask.mock.calls.map(c => c[0])).toEqual(['Venture into flame?', 'Venture into dangerous gas?']);
        expect(g.exportRecording().events.slice(-1)[0]?.decisions).toEqual([true, false]);
    });
});

describe('X3-U1 D07 acidic attack confirmation', () => {
    it.each([
        ['sword', 11, 10], ['whip', 13, 10], ['spear', 12, 10], ['axe', 11, 10],
        ['rapier', 12, 10], ['flail', 11, 11],
    ] as const)('%s cancels the whole attack/movement before nausea, damage and RNG; Yes still attacks', (id, x, y) => {
        const g = scene(); weapon(g, id); const m = acid(g, x, y), ask = vi.fn(() => false); g.onConfirmRequest = ask;
        g.player.setStatusDuration('nauseous', 5);
        const old = before(g); move(g);
        expect(ask).toHaveBeenCalledTimes(1); expect(ask.mock.calls[0]).toEqual([expect.stringMatching(/^Degrade your .+ by attacking .+\?$/)]);
        expect(before(g)).toEqual(old); expect(g.exportRecording().events.slice(-1)[0]?.decisions).toEqual([false]);
        g.player.setStatusDuration('nauseous', 0); ask.mockReturnValue(true); move(g);
        expect(g.stats.turns).toBe(old.stats.turns + 1); expect(m.hp).toBeLessThan(500);
    });

    it('sweep checks every target before hurting any of them and asks only once', () => {
        const g = scene(); weapon(g, 'axe'); const rat = acid(g, 11, 10, 'rat'); acid(g, 10, 11); acid(g, 10, 9);
        const ask = vi.fn(() => false); g.onConfirmRequest = ask; const old = before(g); move(g);
        expect(ask).toHaveBeenCalledTimes(1); expect(before(g)).toEqual(old); expect(rat.hp).toBe(500);
    });

    it('unarmed/protected, unseen, confused, hallucinating and known matching slaying exemptions', () => {
        const g = scene(), m = acid(g, 11, 10, 'acidic_jelly'), ask = vi.fn(() => false); g.onConfirmRequest = ask;
        const abort = () => (g as any).abortAcidicAttack([m]);
        expect(abort()).toBe(false); const w = weapon(g); expect(abort()).toBe(true);
        w.isProtected = true; expect(abort()).toBe(false); w.isProtected = false;
        g.grid.getCell(11, 10)!.isVisible = false; expect(abort()).toBe(false);
        g.grid.getCell(11, 10)!.isClairvoyantVisible = true; expect(abort()).toBe(true);
        g.grid.getCell(11, 10)!.isVisible = true;
        m.applyStatus('invisible', 5); expect(abort()).toBe(false); m.setStatusDuration('invisible', 0);
        g.player.applyStatus('confused', 5); expect(abort()).toBe(false); g.player.setStatusDuration('confused', 0);
        g.player.applyStatus('hallucinating', 5); expect(abort()).toBe(false);
        g.player.applyStatus('telepathy', 5); expect(abort()).toBe(true); g.player.setStatusDuration('hallucinating', 0);
        w.runicType = 'slaying'; w.vorpalEnemy = 'jelly'; w.runicKnown = false; expect(abort()).toBe(true);
        w.runicKnown = true; expect(abort()).toBe(false);
        w.vorpalEnemy = 'animal'; expect(abort()).toBe(true);
    });
});

describe('X3-U1 D10 automation and recording', () => {
    it.each([false, true])('an animated auto step records answer=%s and replay/seek stays stopped with zero OOS', answer => {
        const setup = (g: Game) => {
            terrain(g, T.PLAIN_FIRE); g.grid.getCell(11, 10)!.isVisible = false;
            g.handleMouseTravel(13, 10); g.grid.getCell(11, 10)!.isClairvoyantVisible = true;
        };
        const settle = (g: Game) => { for (let i = 0; i < 100 && g.isAdvancing; i++) g.stepAdvancement(); expect(g.isAdvancing).toBe(false); };
        const g = scene(setup); g.animationEnabled = true;
        g.onConfirmRequest = () => { expect(g.isAutoTraveling()).toBe(false); return answer; };
        g.stepAutoPath(); settle(g);
        const recording = g.exportRecording(), final = before(g);
        expect(recording.events).toHaveLength(1); expect(recording.events[0]?.decisions).toEqual([answer]);
        const start = g.startNewGame.bind(g);
        vi.spyOn(g, 'startNewGame').mockImplementation(options => { start(options); room(g); setup(g); });
        expect(g.loadReplay(recording)).toBe(true);
        g.onConfirmRequest = () => { throw new Error('Replay opened UI'); };
        g.replayStep(); settle(g);
        expect(g.replayError).toBeNull(); expect(g.replayCursor).toBe(1);
        expect(g.isAutoTraveling()).toBe(false); expect(before(g)).toEqual(final);
        g.replaySeek(0); g.replaySeek(1);
        expect(g.replayError).toBeNull(); expect(g.isAutoTraveling()).toBe(false); expect(before(g)).toEqual(final);
    });

    it('existing confused-lava confirmation also stops exploration before consuming movement RNG', () => {
        const g = scene(); terrain(g, T.LAVA); g.player.applyStatus('confused', 10);
        g.autoPath = [{ x: 11, y: 10 }]; (g as any).isAutoExploring = true;
        const old = before(g), ask = vi.fn(() => { expect(g.isAutoTraveling()).toBe(false); return false; });
        g.onConfirmRequest = ask;
        // Same shared requestConfirm used by an exploration step; invoke the
        // move with its enclosing auto-step flag to bypass pre-step path policy.
        (g as any).inAutoTravelStep = true;
        g.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        expect(ask).toHaveBeenCalledExactlyOnceWith('Risk stumbling into lava?');
        expect(before(g)).toEqual(old); expect((g as any).isAutoExploring).toBe(false); expect(g.autoPath).toEqual([]);
    });

    it.each([false, true])('stops an auto step before asking, and stays stopped after answer=%s', answer => {
        const g = scene(); terrain(g, T.PLAIN_FIRE);
        // A newly revealed hazard on a previously safe, remembered route.
        g.grid.getCell(11, 10)!.isVisible = false;
        g.handleMouseTravel(13, 10);
        expect(g.isAutoTraveling()).toBe(true);
        g.grid.getCell(11, 10)!.isClairvoyantVisible = true;
        const ask = vi.fn(() => { expect(g.isAutoTraveling()).toBe(false); expect(g.autoPath).toEqual([]); return answer; });
        g.onConfirmRequest = ask; const old = before(g); g.stepAutoPath();
        expect(ask).toHaveBeenCalledExactlyOnceWith('Venture into flame?');
        expect(g.isAutoTraveling()).toBe(false); expect(g.autoPath).toEqual([]);
        if (!answer) expect(before(g)).toEqual(old);
        else expect(g.player.loc).toEqual({ x: 11, y: 10 });
        const stopped = before(g); g.stepAutoPath(); expect(before(g)).toEqual(stopped);
    });

    it.each([...hazardCases.map(([name, t]) => [name, (g: Game) => terrain(g, t)] as const),
        ['acid attack', (g: Game) => { weapon(g); acid(g); }],
        ['lava refusal', (g: Game) => terrain(g, T.LAVA)],
    ] as const)('%s replays rejected/accepted decisions and seeks without UI or OOS', (_name, setup) => {
        const g = scene(setup), old = before(g); g.onConfirmRequest = () => false; move(g);
        expect(before(g)).toEqual(old);
        g.onConfirmRequest = () => true; move(g);
        const final = before(g), recording = g.exportRecording();
        // Install the same deterministic fixture after replay's normal seeded
        // initialization; command dispatch and checkpoints are all production.
        const start = g.startNewGame.bind(g);
        vi.spyOn(g, 'startNewGame').mockImplementation(options => { start(options); room(g); setup(g); });
        expect(g.loadReplay(recording)).toBe(true);
        g.onConfirmRequest = () => { throw new Error('Replay must consume the decision without opening UI'); };
        g.replayStep(); expect(g.replayError).toBeNull(); expect(before(g)).toEqual(old);
        g.replayStep(); expect(g.replayError).toBeNull(); expect(g.replayCursor).toBe(2); expect(before(g)).toEqual(final);
        g.replaySeek(0); g.replaySeek(2); expect(g.replayError).toBeNull(); expect(before(g)).toEqual(final);
    });
});
