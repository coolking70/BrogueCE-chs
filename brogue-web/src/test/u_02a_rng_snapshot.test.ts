import { afterEach, describe, expect, it, vi } from 'vitest';
import { Random, rng, RNGType } from '../engine/Random';
import { normalizeSeed, isSeed } from '../engine/Seed';
import { createHeadlessGame } from './harness';
import { Game, type GameSnapshot } from '../engine/Core/Game';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsterData from '../data/monsters.json';
import { Grid, DCOLS, DROWS, TerrainType } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
afterEach(() => vi.restoreAllMocks());

function draws(r: Random, n: number) {
    return Array.from({ length: n }, (_, i) => {
        r.setRNG(i % 3 === 0 ? RNGType.RNG_COSMETIC : RNGType.RNG_SUBSTANTIVE);
        return [r.randRange(0, 2147483648), r.randClumpedRange(2, 23, 4), r.rollD('3d6+2')];
    });
}

describe('U02a complete dual-stream state', () => {
    for (const prefix of [0, 1, 51, 4096]) {
        it(`JSON restore after ${prefix} mixed draws, with rejection sampling and both counters`, () => {
            const r = new Random(987654321);
            draws(r, prefix);
            r.setRNG(RNGType.RNG_COSMETIC);
            const state = json(r.getState());
            const next = r.randRange(0, 2147483648);
            const continuation = draws(r, 256), end = r.getState();
            const restored = new Random(9);
            const raw = vi.spyOn(restored as any, 'ranval');
            const reseed = vi.spyOn(restored, 'seedRandomGenerator');
            restored.setState(state);
            expect(raw).not.toHaveBeenCalled(); expect(reseed).not.toHaveBeenCalled();
            expect(restored.getState()).toEqual(state);
            expect(restored.randRange(0, 2147483648)).toBe(next);
            expect(draws(restored, 256)).toEqual(continuation);
            expect(restored.getState()).toEqual(end);
            expect(raw.mock.calls.length).toBeGreaterThan(256 * 8); // actual rejected raw draws
        });
    }
    it('export/import are detached value copies and no degenerate draw increments a counter', () => {
        const r = new Random(7), exported = r.getState();
        const original = json(exported);
        exported.streams[0].a = 1;
        expect(r.getState()).toEqual(original);
        r.setState(original);
        original.streams[1].b = 2;
        expect(r.getState().streams[1].b).not.toBe(2);
        for (const stream of [RNGType.RNG_SUBSTANTIVE, RNGType.RNG_COSMETIC]) {
            r.setRNG(stream); const before = r.getState();
            expect(r.randRange(4, 4)).toBe(4); expect(r.randRange(9, 2)).toBe(9);
            expect(r.getState()).toEqual(before);
        }
    });
    const corruptions: Array<(s: any) => void> = [
        s => s.version++, s => s.algorithm = 'future', s => s.currentRNG = 2,
        s => s.streams.pop(), s => s.streams = new Array(2), s => s.streams[0].a = -1, s => s.streams[1].d = 2 ** 32,
        s => s.streams[0].c = 1.5, s => delete s.streams[1].b,
        s => s.randomNumbersGenerated = -1, s => s.cosmeticNumbersGenerated = 2 ** 53,
    ];
    corruptions.forEach((corrupt, index) => it(`invalid state ${index} is rejected atomically`, () => {
        const r = new Random(99), before = r.getState(), bad = json(before); corrupt(bad);
        expect(Random.isState(bad)).toBe(false);
        expect(() => r.setState(bad)).toThrow(); expect(r.getState()).toEqual(before);
    }));
});

describe('U02a uint64 boundary with unchanged low-word generator', () => {
    for (const seed of ['1099511627783', '9007199254740993', '18446744073709551615']) {
        it(`preserves ${seed} while generating from its low 32 bits`, () => {
            const r = new Random(1);
            expect(r.seedRandomGenerator(seed)).toBe(seed);
            const low = Number(BigInt(seed) & 0xffffffffn);
            expect(draws(r, 100)).toEqual(draws(new Random(low), 100));
            expect(normalizeSeed(BigInt(seed))).toBe(seed);
        });
    }
    it('zero means time only before low-word extraction; 2^32 is not zero', () => {
        vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
        const r = new Random(1);
        expect(r.seedRandomGenerator('0')).toBe('447300000');
        expect(r.seedRandomGenerator('4294967296')).toBe('4294967296');
        const once = r.getState();
        vi.mocked(Date.now).mockReturnValue(1900000000000);
        r.seedRandomGenerator('4294967296'); expect(r.getState()).toEqual(once);
        expect(normalizeSeed(' 0007 ')).toBe('7'); expect(isSeed('0007')).toBe(false);
    });
    for (const seed of ['-1', '1.5', '1e3', '7junk', '0x7', '', '18446744073709551616', 9007199254740992, NaN, Infinity, -1]) {
        it(`rejects invalid/unsafe seed ${seed}`, () => expect(() => normalizeSeed(seed)).toThrow());
    }
});

function flavors() {
    return json({ potions: [...ItemLoader.potionFlavorMap], scrolls: [...ItemLoader.scrollFlavorMap],
        arcana: [...ItemLoader.arcanaFlavorMap] });
}
function stable(g: Game) {
    const { savedAt: _savedAt, ...snapshot } = g.toSnapshot();
    return json(snapshot);
}
function cosmeticNoise() {
    rng.setRNG(RNGType.RNG_COSMETIC);
    for (let i = 0; i < 17; i++) rng.randRange(0, 999);
    rng.setRNG(RNGType.RNG_SUBSTANTIVE);
}
function arena() {
    const g = createHeadlessGame(424242);
    g.animationEnabled = false;
    g.grid = new Grid(DCOLS, DROWS);
    for (let x = 1; x < DCOLS - 1; x++) for (let y = 1; y < DROWS - 1; y++) g.grid.setTerrain(x, y, TerrainType.FLOOR);
    g.environment = new EnvironmentManager(g.grid); g.fov = new FOVSys(g.grid); g.lightMap = new LightMap(g.grid);
    g.player.loc = { x: 4, y: 5 }; g.player.hp = g.player.maxHp = 10000;
    g.monsters = []; g.items = []; g.dormantMonsters = []; g.player.equippedWeapon = null;
    const m = new Monster(5, 5, monsterData.find(m => m.id === 'rat')! as MonsterData);
    m.hp = m.maxHp = 10000; m.state = MonsterState.HUNTING;
    g.monsters.push(m);
    return g;
}
function step(g: Game, combat: boolean) {
    cosmeticNoise();
    g.handlePlayerAction(combat ? 'move' : 'wait', combat ? { x: 1, y: 0 } : undefined, 'system');
    return stable(g);
}

describe('U02a game save → JSON → fresh load → continuation', () => {
    for (const seed of ['1099511627783', '9007199254740993', '18446744073709551615']) {
        it(`seed ${seed}, flavor identity and both streams survive fresh load without global reseeding`, () => {
            const g = createHeadlessGame(7); g.startNewGame({ seed });
            draws(rng, 51); rng.setRNG(RNGType.RNG_COSMETIC);
            const snapshot = json(g.toSnapshot()), beforeFlavors = flavors();
            const direct = rng.randRange(1, 100000);
            const fresh = createHeadlessGame(99);
            // A real renderer can consume cosmetic draws while presenting the restored state.
            fresh.onRenderRequested = cosmeticNoise;
            const reseed = vi.spyOn(rng, 'seedRandomGenerator');
            expect(fresh.loadSnapshot(snapshot)).toBe(true);
            expect(reseed).not.toHaveBeenCalled();
            expect(rng.getState()).toEqual(snapshot.rngState);
            expect(fresh.currentSeed).toBe(seed); expect(fresh.toSnapshot().seed).toBe(seed);
            expect(flavors()).toEqual(beforeFlavors);
            expect(rng.randRange(1, 100000)).toBe(direct);
        });
    }
    it('rejects missing/malformed RNG and old numeric seed before changing live state', () => {
        const g = createHeadlessGame(7), before = stable(g);
        for (const alter of [
            (s: any) => delete s.rngState, (s: any) => s.rngState.currentRNG = 2,
            (s: any) => s.seed = 7, (s: any) => s.seed = '18446744073709551616', (s: any) => s.version = 1,
        ]) {
            const bad = json(g.toSnapshot()); alter(bad);
            expect(g.loadSnapshot(bad)).toBe(false); expect(stable(g)).toEqual(before);
        }
        expect(() => g.startNewGame({ seed: 2 ** 53 })).toThrow(); expect(stable(g)).toEqual(before);
    });
    for (const combat of [false, true]) for (const checkpoint of [0, 3, 11]) {
        it(`${combat ? 'combat' : 'natural map wait'} checkpoint ${checkpoint}: 12 steps match every snapshot field and both RNG streams`, () => {
            const g = combat ? arena() : createHeadlessGame(7); g.animationEnabled = false;
            for (let i = 0; i < checkpoint; i++) step(g, combat);
            const snapshot: GameSnapshot = json(g.toSnapshot());
            const before = rng.randomNumbersGenerated;
            const direct = Array.from({ length: 12 }, () => step(g, combat));
            expect(rng.randomNumbersGenerated - before).toBeGreaterThan(12);
            if (combat) expect(g.monsters[0]!.hp).toBeLessThan(snapshot.monsters[0]!.hp);
            const fresh = createHeadlessGame(999); fresh.animationEnabled = false;
            expect(fresh.loadSnapshot(snapshot)).toBe(true);
            const { savedAt: _savedAt, ...savedFields } = snapshot;
            expect(stable(fresh)).toEqual(savedFields);
            const resumed = Array.from({ length: 12 }, () => step(fresh, combat));
            expect(resumed).toEqual(direct);
        });
    }
    it('2^40+7 and 7 have identical initial world and both stream states', () => {
        const g = createHeadlessGame(7);
        const { seed: _low, ...low } = stable(g);
        g.startNewGame({ seed: '1099511627783' });
        const { seed: _high, ...high } = stable(g);
        expect(high).toEqual(low);
    });
    it('waypoint snapshot/import detach arrays without reshuffling or consuming RNG', () => {
        const g = createHeadlessGame(7);
        const saved = json(g.toSnapshot()), before = json(saved.waypoints);
        saved.waypoints.coordinates[0]!.x++;
        expect(g.waypoints.getState()).toEqual(before);
        g.waypoints.setState(before);
        before.coordinates[0]!.x++;
        expect(g.waypoints.coordinates[0]!.x).not.toBe(before.coordinates[0]!.x);
        const raw = vi.spyOn(rng as any, 'ranval');
        expect(g.loadSnapshot(saved)).toBe(true);
        expect(raw).not.toHaveBeenCalled();
    });
    it('unsafe recording seeds are rejected before altering the game', () => {
        const g = createHeadlessGame(7), before = stable(g), rec = g.exportRecording();
        for (const seed of [2 ** 53, -1, NaN, '18446744073709551616', '7junk']) {
            expect(g.loadReplay({ ...rec, seed })).toBe(false);
            expect(stable(g)).toEqual(before);
        }
    });
    it('full-seed recording, restart and seek remain reproducible after a save load', () => {
        const g = createHeadlessGame(7); g.startNewGame({ seed: '18446744073709551615' }); g.animationEnabled = false;
        for (let i = 0; i < 4; i++) g.handlePlayerAction('wait');
        const rec = json(g.exportRecording()), snapshot = json(g.toSnapshot());
        expect(rec.seed).toBe('18446744073709551615');
        expect(g.loadReplay(rec)).toBe(true); g.replaySeek(3); const expected = stable(g);
        expect(g.loadSnapshot(snapshot)).toBe(true); expect(g.loadReplay(rec)).toBe(true);
        g.replaySeek(3); expect(stable(g)).toEqual(expected);
        g.replayRestart(); for (let i = 0; i < 3; i++) g.replayStep(true);
        expect(stable(g)).toEqual(expected);
    });
});
