import { describe, expect, it } from 'vitest';
import { Architect } from '../engine/Generator/Architect';
import { AUTO_GENERATOR_CATALOG } from '../engine/Map/AutoGenerator';
import { rng } from '../engine/Random';

describe('V-2b-8 autoGenerator forced CE blueprints', () => {
    it('wires exactly the seven MT_* rows whose blueprints are in this round', () => {
        const wired = AUTO_GENERATOR_CATALOG.filter(e => e.machine > 0 && e.carrier === 'wired');
        expect(wired.map(e => e.machine)).toEqual([61, 58, 59, 60, 63, 64, 71]);
        // MT_CAMP_AREA=62 is a horde association, not an autoGenerator row in CE.
        expect(AUTO_GENERATOR_CATALOG.some(e => e.machine === 62)).toBe(false);
    });

    it('production generation builds forced thematic machines, not merely catalog data', () => {
        const counts = new Map<string, number>();
        for (const seed of [3, 777, 424242]) {
            for (let depth = 1; depth <= 26; depth++) {
                rng.seedRandomGenerator(seed + depth * 1000003);
                const arch = new Architect();
                arch.generateLevel(depth);
                for (const r of arch.machineResults) {
                    if (r.blueprintId.startsWith('ce_')) counts.set(r.blueprintId, (counts.get(r.blueprintId) ?? 0) + 1);
                }
            }
        }
        expect([...counts.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
        expect([...counts.keys()].some(k => /^ce_(58|59|60|61|63|64|71)_/.test(k))).toBe(true);
        expect(counts.has('ce_62_camp')).toBe(false);
    });
});
