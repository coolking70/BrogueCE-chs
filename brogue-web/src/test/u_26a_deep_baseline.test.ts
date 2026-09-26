import { describe, expect, it } from 'vitest';
import { createHeadlessGame, terrainFingerprint } from './harness';
import { ItemCategory } from '../engine/Items/Item';
import base from './fixtures/deep_generation_baseline.json';

/** Independent U26a baseline: never extends/reinterprets the legacy D1–26 drift fixture. */
describe('U26a independent D27–40 generation baseline', () => {
    it('four full-run seeds retain deep terrain, population, gem quantity, origins and positions', () => {
        const rows = [];
        for (const seed of base.seeds) {
            const g: any = createHeadlessGame(seed);
            for (let depth = 1; depth <= 40; depth++) {
                if (depth > 1) { g.depth = depth; g.generateDepth(false, false); }
                if (depth <= 26) continue;
                rows.push({ seed, depth, fp: terrainFingerprint(g.grid), n: g.monsters.length,
                    species: [...new Set(g.monsters.map((m: any) => m.name))].sort().join(','), items: g.items.length,
                    gems: g.items.filter((i: any) => i.category === ItemCategory.GEM)
                        .map((i: any) => ({ x: i.x, y: i.y, originDepth: i.originDepth, quantity: i.quantity })) });
            }
        }
        expect(rows).toEqual(base.levels);
    });
});
