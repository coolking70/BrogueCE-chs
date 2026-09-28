import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHeadlessGame, terrainFingerprint } from '../src/test/harness';
import { ItemCategory } from '../src/engine/Items/Item';
import { TerrainType } from '../src/engine/Map/TerrainType';
import { rng } from '../src/engine/Random';
import shallow from '../src/test/fixtures/generation_baseline.json';

it('records the original four-seed, full-run baseline method without changing fixtures', () => {
    const stage = process.env.X4_R2_STAGE;
    expect(['head', 'final']).toContain(stage);
    const rows = [];
    for (const seed of shallow.seeds) {
        const game: any = createHeadlessGame(seed);
        for (let depth = 1; depth <= 40; depth++) {
            if (depth > 1) { game.depth = depth; game.generateDepth(false, false); }
            const layers: number[] = [];
            const terrain: Record<string, number> = {};
            for (let x = 0; x < game.grid.width; x++) for (let y = 0; y < game.grid.height; y++) {
                for (const tile of game.grid.getCell(x, y).layers) {
                    layers.push(tile);
                    const name = TerrainType[tile];
                    terrain[name] = (terrain[name] ?? 0) + 1;
                }
            }
            rows.push({seed, depth, fp: terrainFingerprint(game.grid), n: game.monsters.length,
                species: [...new Set(game.monsters.map((m: any) => m.name))].sort().join(','), items: game.items.length,
                gems: game.items.filter((i: any) => i.category === ItemCategory.GEM)
                    .map((i: any) => ({x: i.x, y: i.y, originDepth: i.originDepth, quantity: i.quantity})),
                terrain, layers, rng: rng.getState()});
        }
    }
    writeFileSync(`ai_docs/reports/x4-r2-evidence/generation-${stage}.json.gz`, gzipSync(JSON.stringify(rows)));
});
