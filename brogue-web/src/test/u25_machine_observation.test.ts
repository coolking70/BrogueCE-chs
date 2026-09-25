import { describe, expect, it } from 'vitest';
import { createHeadlessGame, terrainFingerprint } from './harness';
import baseline from './fixtures/generation_baseline.json';
import { rng } from '../engine/Random';
import { setMachineObservationHook, type MachineTrace } from '../engine/Generator/MachineObservation';

describe('U25 machine observation is generation neutral', () => {
    it('matches fingerprint and both complete RNG streams at every D1–26 for all drift seeds', () => {
        const run = (seed: number, observe: boolean) => {
            const traces: MachineTrace[] = [];
            setMachineObservationHook(observe ? trace => traces.push(trace) : null);
            try {
                const g: any = createHeadlessGame(seed);
                const rows = [];
                for (let depth = 1; depth <= 26; depth++) {
                    if (depth > 1) { g.depth = depth; g.generateDepth(false, false); }
                    const species = [...new Set(g.monsters.map((m: any) => m.name))].sort().join(',');
                    rows.push({ fp: terrainFingerprint(g.grid), n: g.monsters.length,
                        species, items: g.items.length, rng: rng.getState() });
                }
                return { rows, traces };
            } finally { setMachineObservationHook(null); }
        };
        for (const seed of baseline.seeds) {
            const off = run(seed, false);
            const on = run(seed, true);
            expect(on.rows, `seed ${seed}`).toEqual(off.rows);
            expect(on.traces.some(t => t.status === 'committed'), `seed ${seed}: no observed machine`).toBe(true);
        }
    });
});
