import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { TerrainType as T, DungeonLayer } from '../engine/Map/Grid';
import { spawnDungeonFeature, type DungeonFeature } from '../engine/Map/DungeonFeature';
import { GasType } from '../engine/Environment/Gas';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { logger } from '../engine/Systems/Logger';
import { rng } from '../engine/Random';

// Same deterministic room is reinstalled at replay initialization. Commands,
// status application, scheduling, both RNG checkpoints and replay are real.
function room(g: Game) {
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.player.loc = { x: 10, y: 10 };
    g.player.statusDurations = {}; g.player.maxStatus = {};
    g.player.hp = g.player.maxHp = 1000;
    g.player.inventory.items = []; g.player.equippedWeapon = null; g.player.equippedArmor = null;
    g.player.refreshSpeeds(); g.player.ticksUntilTurn = 0; g.ticksTillUpdateEnvironment = 100;
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x >= 4 && x <= 30 && y >= 4 && y <= 20 ? T.FLOOR : T.GRANITE);
        const c = g.grid.getCell(x, y)!;
        Object.assign(c, { autoSearched: true, hasMemory: true, isExplored: true, rememberedLayers: [...c.layers] });
    }
    logger.reset(); g.disturbed = false;
}
function scene() { const g = createHeadlessGame(33008, 'test'); room(g); return g; }
function settle(g: Game) {
    let steps = 0;
    while (g.isAdvancing && steps < 10) { g.stepAdvancement(); steps++; }
    expect(g.isAdvancing).toBe(false); expect(g.isInputLocked()).toBe(false);
    expect(g.lastAdvancementError).toBeNull();
    return steps;
}
function state(g: Game) {
    const s = g.toSnapshot(); s.savedAt = 0;
    // Replay consumes its imported log rather than recording new inputs.
    s.run.recordedInputEvents = []; s.run.recordedInputIndex = 0;
    return JSON.parse(JSON.stringify(s));
}
afterEach(() => { vi.restoreAllMocks(); logger.presentAcknowledgments(null); });

describe('X3-U8a B06: one command owns the complete forced wait', () => {
    it.each([false, true])('drains N turns synchronously with animation=%s, without executing the attempted move', animated => {
        for (const duration of [1, 5, 32]) {
            const g = scene(); g.animationEnabled = animated;
            g.player.setStatusDuration('paralyzed', duration);
            const nutrition = g.player.nutrition, scent = g.scent.turnNumber;
            g.executeCommand('move', { x: 1, y: 0 });
            expect(g.player.loc).toEqual({ x: 10, y: 10 });
            expect(g.player.hasStatus('paralyzed')).toBe(false);
            expect(g.stats.turns).toBe(duration); expect(g.absoluteTurnNumber).toBe(duration);
            // CE nutrition pauses during paralysis; only the recovery block eats.
            expect(g.player.nutrition).toBe(nutrition - 1);
            expect(g.scent.turnNumber).toBe(scent + 3 * duration);
            expect(logger.turn).toBe(0); expect(g.isAdvancing).toBe(false);
            expect(g.recordedInputEvents).toHaveLength(1);
            expect(g.recordedInputEvents[0]!.turn).toBe(duration);
            expect(logger.messages.some(m => /cannot act|无法行动/.test(m.text))).toBe(false);
            g.executeCommand('move', { x: 1, y: 0 }); settle(g);
            expect(g.player.loc).toEqual({ x: 11, y: 10 });
            expect(g.stats.turns).toBe(duration + 1);
        }
    });

    // Both species attack at 100 ticks (the jackal's 50-tick speed is movement).
    it.each([['rat', 5], ['jackal', 5]] as const)('%s acts throughout five paralyzed turns', (id, actions) => {
        const g = scene(), m = new Monster(11, 10, monsters.find(m => m.id === id)! as MonsterData);
        m.state = MonsterState.HUNTING; m.ticksUntilTurn = m.movementSpeed;
        g.monsters.push(m); const takeTurn = vi.spyOn(m, 'takeTurn');
        g.player.setStatusDuration('paralyzed', 5);
        const hp = g.player.hp;
        g.executeCommand('wait');
        expect(takeTurn).toHaveBeenCalledTimes(actions);
        expect(g.player.hp).toBeLessThan(hp); expect(g.stats.turns).toBe(5);
        expect(g.recordedInputEvents).toHaveLength(1);
    });

    it.each([['hasted', 10, 5], ['slowed', 3, 6]] as const)('%s preserves subjective/objective clocks', (status, turns, blocks) => {
        const g = scene(); g.animationEnabled = true;
        g.player.setStatusDuration(status, 100); g.player.setStatusDuration('paralyzed', 5);
        g.executeCommand('wait');
        expect(g.stats.turns).toBe(turns); expect(g.absoluteTurnNumber).toBe(blocks);
        expect(g.player.hasStatus('paralyzed')).toBe(false); expect(g.isAdvancing).toBe(false);
    });

    it('stops immediately when poison kills the paralyzed player', () => {
        const g = scene(); g.player.hp = 1; g.player.addPoison(10, 2);
        g.player.setStatusDuration('paralyzed', 50);
        g.executeCommand('wait');
        expect(g.isGameOver).toBe(true); expect(g.stats.turns).toBe(1);
        expect(g.absoluteTurnNumber).toBe(1); expect(g.player.hasStatus('paralyzed')).toBe(true);
        expect(g.recordedInputEvents).toHaveLength(1); expect(g.recordedInputEvents[0]!.end).toBeDefined();
    });

    it.each([false, true])('gas onset during an action, animation=%s: final checkpoint, replay and seek are identical', slowed => {
        const setup = (g: Game) => {
            room(g); if (slowed) g.player.setStatusDuration('slowed', 100);
            g.environment.addGas(10, 10, GasType.PARALYSIS, 1);
        };
        const g = scene(); setup(g); g.animationEnabled = true;
        g.executeCommand('wait');
        expect(g.isAdvancing).toBe(true); expect(g.recordedInputEvents[0]!.turn).toBe(0);
        expect(() => g.exportRecording()).toThrow('advancing');
        expect(settle(g)).toBe(slowed ? 2 : 1);
        expect(g.player.hasStatus('paralyzed')).toBe(false);
        expect(g.stats.turns).toBeGreaterThan(1); expect(logger.turn).toBe(1);
        const recording = g.exportRecording(), final = state(g);
        expect(recording.events).toHaveLength(1);
        expect(recording.events[0]!.turn).toBe(g.absoluteTurnNumber);
        const sync = scene(); setup(sync); sync.executeCommand('wait');
        expect(sync.exportRecording().events).toEqual(recording.events);
        expect(state(sync)).toEqual(final);

        const start = g.startNewGame.bind(g);
        vi.spyOn(g, 'startNewGame').mockImplementation(options => { start(options); setup(g); });
        expect(g.loadReplay(recording)).toBe(true); g.replayStep(true); settle(g);
        expect(g.replayCursor).toBe(1); expect(g.replayError).toBeNull(); expect(state(g)).toEqual(final);
        g.replaySeek(0); g.replaySeek(1);
        expect(g.replayCursor).toBe(1); expect(g.replayError).toBeNull(); expect(state(g)).toEqual(final);
        recording.events[0]!.turn = recording.events[0]!.turn! - 1;
        expect(g.loadReplay(recording)).toBe(true); g.replaySeek(1);
        expect(g.replayError).toContain('OOS at command 1');
    });

    it('automatic travel drains gas paralysis in the triggering step and stays disturbed', () => {
        const g = scene(); g.animationEnabled = true;
        g.environment.addGas(11, 10, GasType.PARALYSIS, 1);
        g.onConfirmRequest = () => true;
        g.autoPath = [{ x: 11, y: 10 }, { x: 12, y: 10 }];
        g.stepAutoPath();
        expect(g.player.hasStatus('paralyzed')).toBe(false); expect(g.isAdvancing).toBe(false);
        expect(g.player.loc).toEqual({ x: 11, y: 10 }); expect(g.stats.turns).toBeGreaterThan(1);
        expect(g.autoPath).toEqual([]); expect(g.recordedInputEvents).toHaveLength(1);
        const turns = g.stats.turns; g.stepAutoPath(); expect(g.stats.turns).toBe(turns);
    });

    it.each([false, true])('DF descriptions remain once per command across paralysis, animation=%s', animated => {
        const g = scene(); g.animationEnabled = animated;
        g.environment.addGas(10, 10, GasType.PARALYSIS, 1);
        const feature: DungeonFeature = { tile: T.NOTHING, layer: DungeonLayer.SURFACE,
            startProbability: 0, probabilityDecrement: 0, flags: 0, description: 'Paralysis turn feature.',
            propagationTerrain: T.NOTHING, subsequentDF: null, lightFlare: '', flashColor: '', effectRadius: 0 };
        const original = (g as any).objectiveTimeBlock.bind(g);
        vi.spyOn(g as any, 'objectiveTimeBlock').mockImplementation(() => {
            original(); spawnDungeonFeature(g.grid, 10, 10, feature, false);
        });
        g.executeCommand('wait'); settle(g);
        expect(logger.messages.find(m => m.text === 'Paralysis turn feature.')?.count).toBe(1);
    });
});

describe('X3-U8a D11: hallucination never changes movement or substantive RNG', () => {
    const dirs = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 },
        { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }];
    function walk(hallucinating: boolean, confused = false) {
        const g = scene();
        if (hallucinating) g.player.setStatusDuration('hallucinating', 100);
        if (confused) g.player.setStatusDuration('confused', 100);
        const trace = [];
        for (let i = 0; i < 40; i++) {
            g.player.loc = { x: 10, y: 10 };
            const d = dirs[i % dirs.length]!;
            g.executeCommand('move', d);
            if (!confused) expect(g.player.loc).toEqual({ x: 10 + d.x, y: 10 + d.y });
            const random = rng.getState();
            trace.push({ player: { ...g.player.loc }, rng: random.streams[0], draws: random.randomNumbersGenerated });
        }
        expect(logger.messages.some(m => /stumble in a random|踉跄/.test(m.text))).toBe(false);
        return trace;
    }
    it('all eight requested directions and forty RNG checkpoints match the sober control', () => {
        expect(walk(true)).toEqual(walk(false));
    });
    it('confusion still randomizes among legal directions, identically with/without hallucination', () => {
        const trace = walk(false, true);
        expect(new Set(trace.map(s => `${s.player.x},${s.player.y}`)).size).toBeGreaterThan(1);
        expect(trace.some((s, i) => s.player.x !== 10 + dirs[i % dirs.length]!.x
            || s.player.y !== 10 + dirs[i % dirs.length]!.y)).toBe(true);
        expect(walk(true, true)).toEqual(trace);
    });
    it('confusion uses only the sole physically legal exit, including when hallucinating', () => {
        const g = scene(); g.player.setStatusDuration('confused', 5); g.player.setStatusDuration('hallucinating', 5);
        for (const d of dirs) if (d.x !== -1 || d.y !== 0) g.grid.setTerrain(10 + d.x, 10 + d.y, T.GRANITE);
        g.executeCommand('move', { x: 1, y: 0 });
        expect(g.player.loc).toEqual({ x: 9, y: 10 });
    });
});
