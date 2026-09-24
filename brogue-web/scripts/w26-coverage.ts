/** W-26 repeatable observation probe. Bundle with esbuild; run with an output path. */
import fs from 'node:fs';
import { createHeadlessGame, terrainFingerprint } from '../src/test/harness';
import { ItemCategory, type Item } from '../src/engine/Items/Item';
import { ItemLoader } from '../src/engine/Items/ItemLoader';
import { rng } from '../src/engine/Random';
const seeds = process.argv[3] ? process.argv[3].split(',').map(Number) : [424242, 777, 20260913, 31337, 2, 3, 4, 5];
const rows: any[] = [];
let attempts: any[] = [];
const arcana = (it: Item) => ({ category: ItemCategory[it.category], kind: (it as any).identityId,
    E: it.enchantment, charges: it.charges, capacity: it.maxCharges });
for (const method of ['spawnStaff', 'spawnWand'] as const) {
    const original = ItemLoader[method];
    ItemLoader[method] = function(id, x, y) {
        const before = rng.randomNumbersGenerated;
        const it = original.call(this, id, x, y);
        if (it) attempts.push({ ...arcana(it), draws: rng.randomNumbersGenerated - before });
        return it;
    };
}
const log = console.log;
console.log = () => {};
for (const seed of seeds) {
    const g: any = createHeadlessGame(seed);
    // Exclude the constructor's discarded time-seeded game and reset before fixed seed.
    attempts = [];
    g.startNewGame({ seed, mode: 'normal' });
    for (let depth = 1; depth <= 26; depth++) {
        if (depth > 1) { attempts = []; g.depth = depth; g.generateDepth(false, false); }
        const counts = Object.fromEntries(Object.values(ItemCategory).filter(v => typeof v === 'string').map(v => [v, 0]));
        for (const it of g.items) counts[ItemCategory[it.category]!]++;
        rows.push({ seed, depth, counts, arcana: g.items.filter((it: Item) => [ItemCategory.STAFF, ItemCategory.WAND].includes(it.category)).map(arcana),
            carriedArcana: g.monsters.flatMap((m: any) => m.carriedItem && [ItemCategory.STAFF, ItemCategory.WAND].includes(m.carriedItem.category) ? [arcana(m.carriedItem)] : []),
            attempts: [...attempts], rng: rng.randomNumbersGenerated,
            baseline: { fp: terrainFingerprint(g.grid), n: g.monsters.length, species: [...new Set(g.monsters.map((m: any) => m.name))].sort().join(','), items: g.items.length } });
    }
}
console.log = log;
fs.writeFileSync(process.argv[2]!, JSON.stringify({ seeds, depthRange: [1, 26], rows }, null, 2) + '\n');
log(`W-26 sampled ${rows.length} levels -> ${process.argv[2]}`);
