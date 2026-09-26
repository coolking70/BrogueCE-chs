import fs from 'node:fs';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createHeadlessGame, terrainFingerprint } from '../src/test/harness';
import { ItemCategory } from '../src/engine/Items/Item';
import { rng } from '../src/engine/Random';
import base from '../src/test/fixtures/generation_baseline.json';

const hash = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rows = [];
for (const seed of base.seeds) {
    const g: any = createHeadlessGame(seed);
    for (let depth = 1; depth <= 40; depth++) {
        if (depth > 1) { g.depth = depth; g.generateDepth(false, false); }
        const s = g.toSnapshot();
        rows.push({ seed, depth, fp: terrainFingerprint(g.grid), n: g.monsters.length,
            species: [...new Set(g.monsters.map((m: any) => m.name))].sort().join(','), items: g.items.length,
            terrain: hash(g.grid.cells), entities: hash(s.entityGraph), monsters: hash(s.monsters),
            dormant: hash(s.dormantMonsters), itemState: hash(g.items), rng: rng.getState(),
            foodSpawned: g.foodSpawned, goldGenerated: g.goldGenerated, metered: structuredClone(g.meteredItems),
            gems: g.items.filter((i: any) => i.category === ItemCategory.GEM).map((i: any) => ({ x: i.x, y: i.y, originDepth: i.originDepth, quantity: i.quantity })),
        });
    }
}
fs.writeFileSync(process.argv[2]!, gzipSync(JSON.stringify(rows)));
console.log(`Captured ${rows.length} layers (D1–26 legacy and D27–40 separately comparable).`);
