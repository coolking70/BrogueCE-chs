import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHeadlessGame, terrainFingerprint } from '../src/test/harness';
import { ItemCategory } from '../src/engine/Items/Item';
import { rng } from '../src/engine/Random';
import shallow from '../src/test/fixtures/generation_baseline.json';

it('captures the original four-seed full-run generation method', () => {
    const stage = process.env.X4_R3_STAGE;
    expect(['head', 'final']).toContain(stage);
    const rows = [];
    for (const seed of shallow.seeds) {
        const game: any = createHeadlessGame(seed);
        for (let depth = 1; depth <= 40; depth++) {
            if (depth > 1) { game.depth = depth; game.generateDepth(false, false); }
            const layers: number[] = [];
            for (let x = 0; x < game.grid.width; x++) for (let y = 0; y < game.grid.height; y++) {
                layers.push(...game.grid.getCell(x, y).layers);
            }
            rows.push({seed, depth, fp: terrainFingerprint(game.grid), n: game.monsters.length,
                species: [...new Set(game.monsters.map((m: any) => m.name))].sort().join(','), items: game.items.length,
                gems: game.items.filter((i: any) => i.category === ItemCategory.GEM)
                    .map((i: any) => ({x: i.x, y: i.y, originDepth: i.originDepth, quantity: i.quantity})),
                itemKinds: [...game.items, ...game.monsters.flatMap((m: any) => m.carriedItem ? [m.carriedItem] : [])]
                    .map((item: any) => item.consumableId ?? item.identityId ?? item.category),
                layers, rng: rng.getState()});
        }
    }
    writeFileSync(`output/x4-r3/generation-${stage}.json.gz`, gzipSync(JSON.stringify(rows)));
}, 600000);
