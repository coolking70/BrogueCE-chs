import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import {
    BlueprintEngine, blueprintQualifies, RETIRED_INVENTED_BLUEPRINT_IDS,
    BP_REWARD, BP_VESTIBULE, BP_ADOPT_ITEM,
    type BlueprintDef, type MachineResult,
} from '../engine/Generator/BlueprintEngine';
import { Grid, DCOLS, DROWS } from '../engine/Map/Grid';
import { rng } from '../engine/Random';
import data from '../data/blueprints.json';
import { createHeadlessGame, terrainFingerprint } from './harness';

const INVENTED_IDS = [
    'reward_library', 'reward_consumables',
    'vestibule_flammable', 'vestibule_guardian', 'vestibule_pit_traps',
    'key_rat_trap', 'key_fire_trap', 'key_flood_trap', 'key_web_room', 'key_lava_moat', 'key_boss',
];
const CATEGORY_REQUEST: Record<string, string> = {
    reward: BP_REWARD, vestibule: BP_VESTIBULE, key_guard: BP_ADOPT_ITEM,
};
// Explicit CE identities and request flags: do not derive this positive control
// from the retirement set or ask key guards for BP_REWARD (a vacuous rejection).
const CE_COUNTERPARTS = [
    { ce: 3, flag: BP_REWARD },
    { ce: 19, flag: BP_VESTIBULE }, { ce: 23, flag: BP_VESTIBULE }, { ce: 25, flag: BP_VESTIBULE },
    ...[29, 31, 32, 37, 38, 57].map(ce => ({ ce, flag: BP_ADOPT_ITEM })),
];
const blueprints = data as BlueprintDef[];

describe('B1 retirement guards', () => {
    it.each(INVENTED_IDS)('rejects %s with its own category request throughout D1–D26', id => {
        const bp = blueprints.find(b => b.id === id)!;
        expect(bp, `${id}: retained data row`).toBeDefined();
        const request = CATEGORY_REQUEST[bp.category]!;
        for (let depth = 1; depth <= 26; depth++) {
            expect(blueprintQualifies(bp, depth, [request]), `${id} D${depth}: must be retired`).toBe(false);
        }
    });

    it.each(INVENTED_IDS)('retains nonzero frequency and complete features for %s', id => {
        const bp = data.find(b => b.id === id)!;
        expect(bp, `${id}: deleted instead of retired`).toBeDefined();
        expect(bp.frequency, `${id}: data weight must survive`).toBeGreaterThan(0);
        expect(bp.features.length, `${id}: data features must survive`).toBeGreaterThan(0);
        expect(bp.ceBlueprintId).toBeNull();
        expect(bp.ceOrigin?.trim().length).toBeGreaterThan(0);
    });

    it('keeps the engine retirement set exactly equal to all null CE identities', () => {
        const retired = [...RETIRED_INVENTED_BLUEPRINT_IDS].sort();
        expect(retired).toEqual([...INVENTED_IDS].sort());
        expect(retired, 'new null CE identity without retirement, or a CE identity retired by mistake')
            .toEqual(data.filter(b => b.ceBlueprintId === null).map(b => b.id).sort());
    });
});

// Stop only at the geometry boundary: qualification, frequency-weighted chooseBP
// and the adopted-item eligibility filter run normally against an unedited row.
// This tests eligibility for selection, not successful construction on this grid.
interface SelectionBoundary {
    findGateRoom(bp: BlueprintDef, analysis: unknown): { kind: 'noCandidates' };
    fillVestibuleInterior(bp: BlueprintDef, origin: { x: number; y: number }): null;
}

describe('B1 anti-vacuum: every CE counterpart stays selectable', () => {
    // Adversary: replace the retirement predicate with category === 'key_guard'.
    // CE 29/31/32/37/38/57 MUST fail both the qualification and actual chooseBP
    // probes. Numeric requestedBp is deliberately -1, never the forced CE path.
    it.each(CE_COUNTERPARTS)('CE $ce qualifies with $flag on every allowed depth', ({ ce, flag }) => {
        const bp = blueprints.find(b => b.ceBlueprintId === ce)!;
        expect(bp, `CE ${ce}: missing counterpart`).toBeDefined();
        expect(bp.frequency).toBeGreaterThan(0);
        for (let depth = bp.depthRange[0]; depth <= bp.depthRange[1]; depth++) {
            expect(blueprintQualifies(bp, depth, [flag]), `CE ${ce} D${depth}: counterpart excluded`).toBe(true);
        }
    });

    it.each(CE_COUNTERPARTS)('CE $ce reaches placement through weighted chooseBP with $flag', ({ ce, flag }) => {
        const bp = blueprints.find(b => b.ceBlueprintId === ce)!;
        const engine = new BlueprintEngine(new Grid(DCOLS, DROWS), bp.depthRange[0], [bp]);
        const boundary = engine as unknown as SelectionBoundary;
        const room = vi.spyOn(boundary, 'findGateRoom').mockReturnValue({ kind: 'noCandidates' });
        const vestibule = vi.spyOn(boundary, 'fillVestibuleInterior').mockReturnValue(null);
        const origin = { x: 10, y: 10 };
        const item = flag === BP_ADOPT_ITEM ? { category: 'KEY', id: 'iron_key', pos: origin } : null;
        rng.seedRandomGenerator(12345);
        try {
            engine.buildAMachine(-1, [flag], item, flag === BP_VESTIBULE ? origin : null);
            const selected = flag === BP_VESTIBULE ? vestibule : room;
            expect(selected.mock.calls.map(call => call[0].id), `CE ${ce}: never selected for placement`).toEqual([bp.id]);
        } finally {
            room.mockRestore();
            vestibule.mockRestore();
        }
    });
});

// Fixed before retirement; includes every rolling-baseline seed. Descend in one
// game per seed so reward quotas and the substantive RNG stream persist.
const CENSUS_SEEDS = [1, 2, 3, 7, 42, 100, 123, 456, 777, 1234, 5678, 9999, 31337, 424242, 20260913, 8675309];

type GameInternals = {
    populateLevel(depth: number, goingUp: boolean, first: boolean, machines: MachineResult[]): void;
    generateDepth(goingUp: boolean, first: boolean): void;
};

describe('B1 construction census', () => {
    it('counts committed machines on the same 16 seed × D1–D26 sample', () => {
        // Observe the final, already flattened production handoff. Counting
        // applyBlueprint/buildAMachine successes would include rolled-back
        // children; recursively flattening this list would double-count them.
        const handoff = vi.spyOn(Game.prototype as unknown as GameInternals, 'populateLevel');
        const counts: Record<string, number> = {};
        const levels = [];
        try {
            for (const seed of CENSUS_SEEDS) {
                const game = createHeadlessGame(seed);
                for (let depth = 1; depth <= 26; depth++) {
                    if (depth > 1) {
                        game.depth = depth;
                        (game as unknown as GameInternals).generateDepth(false, false);
                    }
                    // The constructor's time-seeded D1 is superseded by the
                    // explicit seeded start; only the last handoff belongs here.
                    const call = handoff.mock.calls[handoff.mock.calls.length - 1]!;
                    expect(call[0]).toBe(depth);
                    const machines = call[3];
                    expect(new Set(machines.map(m => m.machineNumber)).size).toBe(machines.length);
                    for (const m of machines) counts[m.blueprintId] = (counts[m.blueprintId] ?? 0) + 1;
                    levels.push({ seed, depth,
                        machines: machines.map(m => ({ id: m.blueprintId, category: m.category, number: m.machineNumber })),
                        fp: terrainFingerprint(game.grid), n: game.monsters.length,
                        species: [...new Set(game.monsters.map(m => m.name))].sort().join(','),
                        items: game.items.length,
                    });
                    handoff.mockClear();
                }
            }
        } finally {
            handoff.mockRestore();
        }
        expect(levels).toHaveLength(CENSUS_SEEDS.length * 26);
        expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
        for (const id of INVENTED_IDS) expect(counts[id] ?? 0, `${id}: retired machine was built`).toBe(0);
        // Natural-stream coverage for all three categories; individual CE
        // selection is proved above without requiring a rare geometry sample.
        for (const category of ['reward', 'vestibule', 'key_guard']) {
            expect(levels.some(row => row.machines.some(m => m.category === category)), `${category}: empty generation`).toBe(true);
        }
        // Optional evidence export; never writes or recaptures the fixture.
        if (process.env.B1_SCAN_OUTPUT) {
            writeFileSync(process.env.B1_SCAN_OUTPUT, JSON.stringify({ seeds: CENSUS_SEEDS, counts, levels }, null, 2) + '\n');
        }
    });
});
