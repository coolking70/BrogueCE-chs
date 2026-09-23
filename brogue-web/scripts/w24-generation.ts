// Read-only attribution first: never writes the rolling baseline.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createHeadlessGame, terrainFingerprint } from '../src/test/harness';
import { ItemLoader } from '../src/engine/Items/ItemLoader';
import { rng } from '../src/engine/Random';
const dir = 'ai_docs/reports/w-24-evidence';
const base = JSON.parse(fs.readFileSync(`${dir}/baseline-before.json`, 'utf8'));
const old = JSON.parse(execFileSync('git', ['show', 'HEAD:brogue-web/src/data/arcana.json'], { encoding: 'utf8' }));
const actual = ItemLoader.genWands;
const spawn = ItemLoader.spawnWand;
function sample(control: boolean) {
    // Only roll back the pool/order/frequency. All other live code stays active.
    ItemLoader.genWands = control ? old.wands.filter((w: any) => !w.excludeFromGeneration) : actual;
    const levels: Record<string, any[]> = {}, traces: Record<string, any[]> = {}, calls: Record<string, number[]> = {};
    for (const seed of base.seeds) {
        let depth = 1;
        const trace: any[] = []; traces[seed] = trace; calls[seed] = [];
        ItemLoader.spawnWand = (id, x, y) => {
            const before = rng.randomNumbersGenerated, item = spawn.call(ItemLoader, id, x, y);
            trace.push({ depth, id, before, after: rng.randomNumbersGenerated, charges: item?.charges });
            return item;
        };
        const g: any = createHeadlessGame(seed), rows = []; levels[seed] = rows;
        // Constructor first makes an unseeded game; discard those diagnostic events.
        trace.length = 0; g.startNewGame({seed});
        for (depth = 1; depth <= 26; depth++) {
            if (depth > 1) { g.depth = depth; g.generateDepth(false, false); }
            rows.push({ fp: terrainFingerprint(g.grid), n: g.monsters.length,
                species: [...new Set(g.monsters.map((m: any) => m.name))].sort().join(','), items: g.items.length });
            calls[seed]!.push(rng.randomNumbersGenerated);
        }
    }
    return { levels, traces, calls };
}
const changes = (a: any, b: any) => base.seeds.flatMap((seed: number) => a[seed].flatMap((row: any, i: number) =>
    Object.keys(row).filter(k => row[k] !== b[seed][i][k]).map(field => ({ seed, depth: i + 1, field, before: row[field], after: b[seed][i][field] }))));
try {
    const current = sample(false), control = sample(true);
    const diff = changes(base.levels, current.levels), controlDiff = changes(base.levels, control.levels);
    const summary = { baselineBeforeSHA256: createHash('sha256').update(fs.readFileSync(`${dir}/baseline-before.json`)).digest('hex'),
        fields: Object.fromEntries(['fp','n','species','items'].map(k => [k, diff.filter(d => d.field === k).length])),
        changedLayers: new Set(diff.map(d => `${d.seed}:${d.depth}`)).size, controlDiff,
        firstWandDivergence: base.seeds.map((seed: number) => {
            const index = current.traces[seed]!.findIndex((v, i) => JSON.stringify(v) !== JSON.stringify(control.traces[seed]![i]));
            return { seed, index, current: current.traces[seed]![index], control: control.traces[seed]![index] };
        }), diff, current, control };
    fs.writeFileSync(`${dir}/drift-attribution.json`, JSON.stringify(summary, null, 2) + '\n');
    if (controlDiff.length) throw Error('Unrelated drift: stop, do not recapture');
    fs.writeFileSync(`${dir}/baseline-candidate.json`, JSON.stringify({ note: '滚动生成基线：W-24 魔杖目录/CE顺序/频率与充能入口。重捕获前归因、旧池对照零偏离及分布/随机调用守卫见 w-24.report.md。', seeds: base.seeds, levels: current.levels }, null, 2) + '\n');
    console.log(JSON.stringify({ fields: summary.fields, changedLayers: summary.changedLayers, controlDiff: controlDiff.length, firstWandDivergence: summary.firstWandDivergence }, null, 2));
} finally { ItemLoader.genWands = actual; ItemLoader.spawnWand = spawn; }
