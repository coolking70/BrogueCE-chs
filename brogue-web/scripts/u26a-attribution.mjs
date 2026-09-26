import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';

const out = 'ai_docs/reports/u-26a-evidence';
const stage = process.argv[2];
const stages = ['s0', 'doors', 'gems', 'final'];
if (!stages.includes(stage)) throw Error('Expected s0, doors, gems or final');
const doorFiles = ['src/engine/Map/LoopMap.ts', 'src/engine/Generator/Architect.ts'];
const gemFiles = ['src/engine/Core/GenerationCoordinator.ts', 'src/engine/Core/Game.ts', 'src/engine/Items/ItemLoader.ts'];
const changed = [...doorFiles, ...gemFiles, 'src/engine/Items/Inventory.ts', 'src/engine/Items/Item.ts', 'src/components/InventoryOverlay.vue', 'src/locales/zh_CN.json'];
const enabled = stage === 's0' ? [] : stage === 'doors' ? doorFiles : stage === 'gems' ? [...doorFiles, ...gemFiles] : changed;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'u26a-'));
try {
    await build({ entryPoints: ['scripts/u26a-observe.ts'], outfile: `${tmp}/observe.mjs`, bundle: true, platform: 'node', format: 'esm',
        plugins: [{ name: 'single-variable', setup(b) { b.onLoad({ filter: /\/src\/.*\.(ts|json)$/ }, a => {
            const file = path.relative(process.cwd(), a.path);
            if (!changed.includes(file) || enabled.includes(file)) return;
            return { contents: execFileSync('git', ['show', `HEAD:brogue-web/${file}`], { encoding: 'utf8' }), loader: file.endsWith('.json') ? 'json' : 'ts' };
        }); } }] });
    const r = spawnSync(process.execPath, [`${tmp}/observe.mjs`, `${out}/generation-${stage}.json.gz`], { stdio: 'inherit' });
    if (r.status) throw Error(`capture failed: ${r.status}`);
    const read = s => JSON.parse(gunzipSync(fs.readFileSync(`${out}/generation-${s}.json.gz`)));
    const comparisons = [];
    for (let i = 1; i < stages.length; i++) {
        const a = stages[i - 1], b = stages[i];
        if (!fs.existsSync(`${out}/generation-${a}.json.gz`) || !fs.existsSync(`${out}/generation-${b}.json.gz`)) continue;
        const before = read(a), after = read(b);
        const changes = after.flatMap((r, j) => Object.keys(r).filter(k => JSON.stringify(r[k]) !== JSON.stringify(before[j][k])).map(field => ({ seed: r.seed, depth: r.depth, field })));
        comparisons.push({ from: a, to: b, shallowChanges: changes.filter(r => r.depth <= 26), deepChanges: changes.filter(r => r.depth > 26) });
    }
    fs.writeFileSync(`${out}/attribution.json`, JSON.stringify(comparisons, null, 2) + '\n');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
